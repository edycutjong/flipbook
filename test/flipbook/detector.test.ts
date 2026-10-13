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
      out.push(what === 'absent' ? absentSig(r) : scoreSig(what, noise, r));
    }
  }
  return out;
}

const run = (sigs: Sig[]) => {
  const o = oracleFor(sigs, P.tauAbs);
  const p1 = runToEnd(sprocketPass(o, P));
  const p1Decodes = o.decodes;
  const p2 = runToEnd(sequentialPass(o, P));
  const merged = mergePasses(p1.markers, p2.markers);
  return { p1: p1.markers, p2: p2.markers, merged, absent: p2.absent, p1Decodes, kept: p1.kept };
};

describe('detector — change and hold (v2: masked top-K distance, 3-frame median windows)', () => {
  it('finds one score change with its anchor on the last old-score frame', () => {
    const r = run(seq([[0, 100], [1, 60]]));
    expect(r.p2.map(m => m.frameIndex)).toEqual([100]);
    expect(r.p2[0].anchorIndex).toBe(99);
    expect(r.p1.map(m => m.frameIndex)).toEqual([100]);
  });

  it('masks the transparent gap: cells that jitter every frame never produce a change', () => {
    const r = run(seq([[0, 200]], 1));
    expect(r.p2).toHaveLength(0);
    expect(r.kept).toBeGreaterThan(0.9);
    expect(r.kept).toBeLessThan(1);
  });

  it('E1: walks the anchor back over a graphic-absent run (replay) before the change', () => {
    const r = run(seq([[0, 101], ['absent', 9], [1, 50]]));
    expect(r.p2.map(m => m.frameIndex)).toEqual([110]);
    expect(r.p2[0].anchorIndex).toBe(100);
    expect(r.p1[0].anchorIndex).toBe(100);
    expect(r.absent).toBe(9);
  });

  it('finds a change across a long absent run (half-time) when reach covers it', () => {
    const sigs = seq([[0, 100], ['absent', 60], [1, 60]]);
    const o = oracleFor(sigs, P.tauAbs);
    runToEnd(sprocketPass(o, P)); // pass 1: short reach, cannot see across 60 absent frames
    const r = runToEnd(sequentialPass(o, { ...P, reach: 90 })); // pass 2: scanBif sets 15 min ÷ interval = 90
    expect(r.markers.map(m => [m.anchorIndex, m.frameIndex])).toEqual([[99, 160]]);
  });

  it('pass 1 reads one fresh frame per step too: a replay before the update never decodes a burst', () => {
    const o = oracleFor(seq([[0, 101], ['absent', 9], [1, 50]]), P.tauAbs);
    const gen = sprocketPass(o, P);
    let last = o.decodes;
    let maxBurst = 0;
    for (let r = gen.next(); !r.done; r = gen.next()) {
      maxBurst = Math.max(maxBurst, o.decodes - last);
      last = o.decodes;
    }
    expect(maxBurst).toBeLessThanOrEqual(1);
  });

  it('pass 2 reads ahead one frame per step: no step decodes a burst through a long absent run', () => {
    const sigs = seq([[0, 100], ['absent', 80], [1, 60]]);
    const o = oracleFor(sigs, P.tauAbs);
    runToEnd(sprocketPass(o, P));
    const gen = sequentialPass(o, { ...P, reach: 90 });
    let last = o.decodes;
    let maxBurst = 0;
    for (let r = gen.next(); !r.done; r = gen.next()) {
      maxBurst = Math.max(maxBurst, o.decodes - last);
      last = o.decodes;
    }
    expect(maxBurst).toBeLessThanOrEqual(1);
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

  it('F3: a box over moving content keeps almost no cells, reads as moving and yields no markers', () => {
    const rnd = rng(3);
    const sigs: Sig[] = [];
    for (let i = 0; i < 300; i++) {
      sigs.push(absentSig(rnd));
    }
    expect(boxIsMoving(sigs.slice(0, 60), P).moving).toBe(true);
    expect(boxIsMoving(seq([[0, 60]]), P).moving).toBe(false);
    const o = oracleFor(sigs, 256); // every frame "present": the worst case for false markers
    runToEnd(sprocketPass(o, P));
    expect(runToEnd(sequentialPass(o, P)).markers).toHaveLength(0);
  });

  it('E2: an A→B→A change inside one sprocket window is missed by pass 1 and added by pass 2', () => {
    const r = run(seq([[0, 100], [1, 3], [0, 100]]));
    expect(r.p1).toHaveLength(0);
    expect(r.p2.map(m => m.frameIndex)).toEqual([100, 103]);
    expect(r.merged.added).toBe(2);
    expect(r.merged.lostFromPass1).toHaveLength(0);
  });

  it('E2: pass 1 decodes a small fraction of a long match', () => {
    // ~3 h at 10 s per frame, 6 changes, each followed by a short replay without the graphic
    const runs: Array<[number | 'absent', number]> = [];
    for (let s = 0; s < 6; s++) runs.push([s, 150], ['absent', 6]);
    runs.push([6, 140]);
    const r = run(seq(runs));
    const n = runs.reduce((a, [, l]) => a + l, 0);
    expect(r.p1).toHaveLength(6);
    expect(r.p2).toHaveLength(6);
    expect(r.p1Decodes / n).toBeLessThan(0.2);
  });

  it('invariant pass1 ⊆ pass2 on 200 random matches (score runs, replays, noise)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const runs: Array<[number | 'absent', number]> = [];
      let score = 0;
      const changes = Math.floor(r() * 8);
      for (let c = 0; c <= changes; c++) {
        runs.push([score, 4 + Math.floor(r() * 120)]);
        if (r() < 0.6) runs.push(['absent', 1 + Math.floor(r() * 12)]);
        score = (score + 1 + Math.floor(r() * 2)) % 4;
      }
      const out = run(seq(runs, 1.5, seed));
      expect(out.merged.lostFromPass1).toHaveLength(0);
    }
  });
});
