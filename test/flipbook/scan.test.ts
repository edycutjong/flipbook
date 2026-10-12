import { describe, expect, it } from '@jest/globals';
import { decodeStats, readBif, scanBif, writeBif } from '../../src/flipbook/core';
import { frameJpeg, toArrayBuffer } from './helpers';

/** A synthetic letterboxed 240×180 match: score 0 → 1 at frame 60, a replay without the graphic before it. */
function syntheticMatch() {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < 140; i++) {
    let score: number | null = i < 60 ? 0 : 1;
    if (i >= 54 && i < 60) {
      score = null; // replay: graphic hidden
    }
    frames.push(frameJpeg(score, { bars: 22, seed: i + 1 }));
  }
  return writeBif(frames, { intervalMs: 10000 });
}

describe('scanBif end to end on real JPEG frames (letterboxed like Amazon’s 240×180 BIF)', () => {
  const bif = toArrayBuffer(syntheticMatch());
  const parsed = readBif(bif);
  if (!parsed.ok) throw new Error('bif');
  const rect = { x: 0.04, y: 0.04, w: 0.33, h: 0.13 }; // around the graphic, in picture coordinates

  it('finds the picture area inside the letterbox bars', async () => {
    const r = await scanBif({ buffer: bif, index: parsed.index, rect, refFrame: 'auto', yieldFn: async () => {} });
    expect(r.area.top).toBeGreaterThanOrEqual(20);
    expect(r.area.top).toBeLessThanOrEqual(24);
    expect(r.area.bottom).toBeGreaterThanOrEqual(156);
    expect(r.area.bottom).toBeLessThanOrEqual(160);
  });

  it('marks the change at frame 60 with the anchor before the replay (E1), and reads only BIF JPEGs', async () => {
    const before = decodeStats.jpegBytes;
    const r = await scanBif({ buffer: bif, index: parsed.index, rect, refFrame: 'auto', yieldFn: async () => {} });
    expect(r.markers.map(m => m.frameIndex)).toEqual([60]);
    expect(r.markers[0].anchorIndex).toBe(53);
    expect(r.markers[0].ms).toBe(530000);
    expect(r.markers[0].changeMs).toBe(600000);
    expect(r.skippedAbsent).toBe(6);
    expect(r.lostFromPass1).toBe(0);
    expect(r.videoBytesDecoded).toBe(0);
    // every decoded byte came out of the BIF buffer
    expect(decodeStats.jpegBytes - before).toBeLessThanOrEqual(bif.byteLength);
    expect(r.pass1.decodes).toBeLessThan(r.frames * 0.35);
  });

  it('can be cancelled between batches', async () => {
    let calls = 0;
    const r = await scanBif({
      buffer: bif,
      index: parsed.index,
      rect,
      refFrame: 'auto',
      batchDecodes: 4,
      yieldFn: async () => {
        calls++;
      },
      isCancelled: () => calls >= 2,
    });
    expect(r.cancelled).toBe(true);
  });
});
