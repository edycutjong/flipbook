import { describe, expect, it } from '@jest/globals';
import { describeBifError, frameAtMs, frameBytes, readBif } from '../../src/flipbook/core';
import { buildBif } from './helpers';

const frames = (n: number) => Array.from({ length: n }, (_, i) => new Uint8Array([0xff, 0xd8, i & 0xff, (i * 7) & 0xff, 0xff, 0xd9]));

describe('readBif — validated index (upstream defects #1 and #2)', () => {
  it('reads a well-formed BIF with a sane multiplier from the header', () => {
    const r = readBif(buildBif(frames(12)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.index.frameCount).toBe(12);
    expect(r.index.intervalSource).toBe('header');
    expect(r.index.intervalMs).toBe(10000);
    expect(Array.from(r.index.timeMs.slice(0, 3))).toEqual([0, 10000, 20000]);
  });

  it('returns frame bytes by index', () => {
    const fr = frames(5);
    const buf = buildBif(fr);
    const r = readBif(buf);
    if (!r.ok) throw new Error('parse');
    for (let i = 0; i < 5; i++) {
      expect(Array.from(frameBytes(buf, r.index, i))).toEqual(Array.from(fr[i]));
    }
  });

  it("treats Amazon's 0xFFFFD8F0 multiplier as corrupt and falls back to 10 s per timestamp unit", () => {
    const r = readBif(buildBif(frames(428), { multiplier: 0xffffd8f0, firstTimestamp: 1 }));
    if (!r.ok) throw new Error('parse');
    expect(r.index.rawMultiplier).toBe(4294957296);
    expect(r.index.intervalSource).toBe('fallback-10s');
    expect(r.index.timeMs[0]).toBe(10000); // keeps the file's own offset (timestamp 1)
    expect(r.index.timeMs[427]).toBe(4280000);
  });

  it('derives the unit from the asset duration when the multiplier is corrupt and the duration is known', () => {
    const r = readBif(buildBif(frames(428), { multiplier: 0xffffd8f0, firstTimestamp: 1 }), { durationMs: 4264135 });
    if (!r.ok) throw new Error('parse');
    expect(r.index.intervalSource).toBe('duration');
    expect(r.index.unitMs).toBeCloseTo(4264135 / 428, 3);
  });

  it('multiplier 0 means 1000 ms (Roku spec, same as the sample parser)', () => {
    const r = readBif(buildBif(frames(3), { multiplier: 0 }));
    if (!r.ok) throw new Error('parse');
    expect(r.index.unitMs).toBe(1000);
  });

  it('F1: rejects a BIF without the terminator entry (the sample only warns)', () => {
    const r = readBif(buildBif(frames(4), { terminator: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(describeBifError(r.error)).toMatch(/terminator/);
  });

  it('F1: rejects a truncated download (trailing frames cut off)', () => {
    const full = buildBif(frames(10));
    const r = readBif(full.slice(0, full.byteLength - 4));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('truncated');
  });

  it('F1: rejects an offset outside the file and non-BIF bytes and an empty buffer', () => {
    expect(readBif(buildBif(frames(4), { badOffsetAt: 2 })).ok).toBe(false);
    expect(readBif(new Uint8Array(100).buffer).ok).toBe(false);
    expect(readBif(new ArrayBuffer(0)).ok).toBe(false);
  });

  it('frameAtMs maps positions to the latest frame at or before them', () => {
    const r = readBif(buildBif(frames(6)));
    if (!r.ok) throw new Error('parse');
    expect(frameAtMs(r.index, -5)).toBe(0);
    expect(frameAtMs(r.index, 0)).toBe(0);
    expect(frameAtMs(r.index, 9999)).toBe(0);
    expect(frameAtMs(r.index, 10000)).toBe(1);
    expect(frameAtMs(r.index, 55000)).toBe(5);
    expect(frameAtMs(r.index, 1e9)).toBe(5);
  });
});
