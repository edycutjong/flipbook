import { describe, expect, it } from '@jest/globals';
import {
  boxIsMoving,
  DEFAULT_PARAMS,
  mergePasses,
  runToEnd,
  sequentialPass,
  Sig,
  sprocketPass,
} from '../../src/flipbook/core';
import { absentSig, oracleFor, rng, scoreSig } from './helpers';

const P = DEFAULT_PARAMS;

/** Builds a frame sequence from runs: [score | 'absent', length]. */
function seq(runs: Array<[number | 'absent', number]>, noise = 1, seed = 7): Sig[] {
  const r = rng(seed);
  const out: Sig[] = [];
  for (const [what, len] of runs) {
    for (let i = 0; i < len; i++) {
      out.push(what === 'absent' ? absentSig() : scoreSig(what, noise, r));
    }
  }
  return out;
}

const run = (sigs: Sig[]) => {
  const ref = scoreSig(0);
  const o = oracleFor(sigs, ref, P.tauAbs);
  const p1 = runToEnd(sprocketPass(o, P));
  const p1Decodes = o.decodes;
  const p2 = runToEnd(sequentialPass(o, P));
  const merged = mergePasses(p1.markers, p2.markers);
  return { p1: p1.markers, p2: p2.markers, merged, absent: p2.absent, p1Decodes, total: o.decodes };
};

describe('detector — change and hold', () => {
  it('finds one score change with its anchor on the last old-score frame', () => {
    const r = run(seq([[0, 100], [1, 60]]));
    expect(r.p2).toHaveLength(1);
    expect(r.p2[0].frameIndex).toBe(100);
    expect(r.p2[0].anchorIndex).toBe(99);
    expect(r.p1).toHaveLength(1);
    expect(r.p1[0].frameIndex).toBe(100);
  });

  it('E1: walks the anchor back over a graphic-absent run (replay) before the change', () => {
    // old score, then 9 frames of replay without the graphic, then the new score
    const r = run(seq([[0, 101], ['absent', 9], [1, 50]]));
    expect(r.p2).toHaveLength(1);
    expect(r.p2[0].frameIndex).toBe(110);
    expect(r.p2[0].anchorIndex).toBe(100);
    expect(r.p1[0].anchorIndex).toBe(100);
    expect(r.absent).toBe(9);
  });

  it('absent frames (ads, half-time) never produce a change', () => {
    const r = run(seq([[0, 50], ['absent', 90], [0, 50]]));
    expect(r.p2).toHaveLength(0);
    expect(r.p1).toHaveLength(0);
  });

  it('hold rule: a one-frame flash of the graphic is not a change', () => {
    const r = run(seq([[0, 60], [2, 1], [0, 60]]));
    expect(r.p2).toHaveLength(0);
    expect(r.p1).toHaveLength(0);
  });

  it('F3: a box that never holds (over a running clock) yields no markers and reads as moving', () => {
    const rnd = rng(3);
    const sigs: Sig[] = [];
    for (let i = 0; i < 300; i++) {
      sigs.push(scoreSig(i % 4, 2, rnd));
    }
    const r = run(sigs);
    expect(r.p2.length).toBe(0);
    expect(boxIsMoving(sigs.slice(0, 60), P.tauHold).moving).toBe(true);
    expect(boxIsMoving(seq([[0, 60]]), P.tauHold).moving).toBe(false);
  });

  it('E2: an A→B→A change inside one sprocket window is missed by pass 1 and added by pass 2', () => {
    const r = run(seq([[0, 100], [1, 3], [0, 100]]));
    expect(r.p1).toHaveLength(0);
    expect(r.p2).toHaveLength(2);
    expect(r.merged.added).toBe(2);
    expect(r.merged.lostFromPass1).toHaveLength(0);
  });

  it('E2: pass 1 decodes a small fraction of a long match', () => {
    // ~3 h at 10 s per frame, 6 changes
    const runs: Array<[number | 'absent', number]> = [];
    for (let s = 0; s < 6; s++) runs.push([s, 150], ['absent', 6]);
    runs.push([6, 140]);
    const r = run(seq(runs));
    const n = runs.reduce((a, [, l]) => a + l, 0);
    expect(r.p1).toHaveLength(6);
    expect(r.p1Decodes / n).toBeLessThan(0.2);
  });

  it('invariant pass1 ⊆ pass2 on 200 random matches (score runs, replays, noise)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const runs: Array<[number | 'absent', number]> = [];
      let score = 0;
      const changes = Math.floor(r() * 8);
      for (let c = 0; c <= changes; c++) {
        runs.push([score, 3 + Math.floor(r() * 120)]);
        if (r() < 0.6) runs.push(['absent', 1 + Math.floor(r() * 12)]);
        score = (score + 1 + Math.floor(r() * 2)) % 4;
      }
      const out = run(seq(runs, 1.5, seed));
      expect(out.merged.lostFromPass1).toHaveLength(0);
    }
  });
});
