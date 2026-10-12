import { describe, expect, it } from '@jest/globals';
import { writeBif } from '../../src/flipbook/core';
import { checkAgainstScanBif, traceScan } from '../../scripts/trace';
import { frameJpeg, toArrayBuffer } from './helpers';

/** The same synthetic match as scan.test.ts: score 0 → 1 at frame 60, a replay without the graphic before it. */
function syntheticMatch() {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < 140; i++) {
    let score: number | null = i < 60 ? 0 : 1;
    if (i >= 54 && i < 60) {
      score = null;
    }
    frames.push(frameJpeg(score, { bars: 22, seed: i + 1 }));
  }
  return writeBif(frames, { intervalMs: 10000 });
}

describe('trace (the landing page replay) records the shipped scan, not a drawing of it', () => {
  const bif = toArrayBuffer(syntheticMatch());
  const rect = { x: 0.04, y: 0.04, w: 0.33, h: 0.13 };

  it('reads every frame exactly once, all of pass 1 before pass 2, and agrees with scanBif', async () => {
    const t = traceScan(bif, rect);
    expect(t.reads).toHaveLength(t.frames);
    expect(new Set(t.reads.map(r => r[0])).size).toBe(t.frames);
    const firstPass2 = t.reads.findIndex(r => r[1] === 2);
    expect(firstPass2).toBe(t.pass1.reads);
    expect(t.reads.slice(firstPass2).every(r => r[1] === 2 && r[2] === 'v')).toBe(true);
    expect(t.markers.map(m => [m.frame, m.anchor])).toEqual([[60, 53]]);
    await expect(checkAgainstScanBif(bif, t)).resolves.toBeUndefined();
  });

  it('labels sprocket samples, emits the marker inside pass 1, and reports D and the absent run', () => {
    const t = traceScan(bif, rect);
    const samples = t.reads.filter(r => r[2] === 's').map(r => r[0]);
    expect(samples.every(i => i % t.params.stride === 0 || i === t.frames - 1)).toBe(true);
    expect(t.events).toHaveLength(1);
    expect(t.events[0].pass).toBe(1);
    expect(t.events[0].afterRead).toBeLessThanOrEqual(t.pass1.reads);
    expect(t.absent).toEqual([54, 55, 56, 57, 58, 59]);
    expect(t.D[60]).toBeGreaterThan(t.params.tau);
    expect(t.videoBytesDecoded).toBe(0);
  });

  it('refuses a trace whose markers differ from scanBif', async () => {
    const t = traceScan(bif, rect);
    await expect(checkAgainstScanBif(bif, { ...t, markers: [] })).rejects.toThrow(/differ/);
  });
});
