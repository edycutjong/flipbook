/**
 * Round-trip test for bifWriter ↔ BifParser / BifFrameImageSource.
 *
 * Three groups of tests:
 *  1. "round-trip" — 12 synthetic frames at 10 000 ms interval
 *  2. "regression fixture" — 428-frame file matching Amazon's tv-webinar-hd.bif header values
 *  3. "errors" — empty frame list and zero intervalMs must throw
 */

import { BifParser } from '../../src/services/bif/BifFileParser';
import { writeBif } from '../../src/flipbook/core/bifWriter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Uint8Array (or subarray view) to a plain number[] so that
 * Jest's `toEqual` produces a readable diff.
 */
function toBytes(u8: Uint8Array | null): number[] | null {
  if (u8 === null) return null;
  return Array.from(u8);
}

/**
 * Build a minimal but distinct synthetic JPEG-like frame.
 * Starts with 0xFF 0xD8, ends with 0xFF 0xD9, with a unique byte in between.
 */
function makeFrame(index: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, index & 0xff, 0x00, 0xcc, 0xff, 0xd9]);
}

// ---------------------------------------------------------------------------
// Round-trip test (12 frames, 10 000 ms interval)
// ---------------------------------------------------------------------------

describe('writeBif → BifParser round-trip', () => {
  const FRAME_COUNT = 12;
  const INTERVAL_MS = 10_000;

  // Build the 12 synthetic frames once.
  const frames: Uint8Array[] = Array.from({ length: FRAME_COUNT }, (_, i) =>
    makeFrame(i),
  );

  let parsedSource: ReturnType<BifParser['parse']>;

  beforeAll(() => {
    const bifBytes = writeBif(frames, { intervalMs: INTERVAL_MS });
    // BifParser.parse expects an ArrayBuffer.
    const buffer = bifBytes.buffer.slice(
      bifBytes.byteOffset,
      bifBytes.byteOffset + bifBytes.byteLength,
    );
    parsedSource = new BifParser().parse(buffer);
  });

  it('parse() returns a non-null FrameImageSource', () => {
    expect(parsedSource).not.toBeNull();
  });

  it('getImageData(0) returns exactly frame 0', () => {
    expect(parsedSource).not.toBeNull();
    const data = parsedSource!.getImageData(0);
    expect(toBytes(data)).toEqual(toBytes(frames[0]));
  });

  it('getImageData(10000) returns frame 1  (ceil(10000/10000)+1=2, index 1)', () => {
    expect(parsedSource).not.toBeNull();
    const data = parsedSource!.getImageData(10_000);
    expect(toBytes(data)).toEqual(toBytes(frames[1]));
  });

  it('getImageData(15000) returns frame 2  (ceil(1.5)+1=3, index 2)', () => {
    expect(parsedSource).not.toBeNull();
    const data = parsedSource!.getImageData(15_000);
    expect(toBytes(data)).toEqual(toBytes(frames[2]));
  });

  it('getImageData(110000) returns frame 11  (ceil(11)+1=12, index 11)', () => {
    expect(parsedSource).not.toBeNull();
    const data = parsedSource!.getImageData(110_000);
    expect(toBytes(data)).toEqual(toBytes(frames[11]));
  });
});

// ---------------------------------------------------------------------------
// Regression fixture matching Amazon's tv-webinar-hd.bif header
// ---------------------------------------------------------------------------

describe('regression fixture — tv-webinar-hd.bif header values', () => {
  /**
   * Amazon's real BIF has:
   *   - 428 frames
   *   - multiplier field = 0xFFFFD8F0  (large uint32, not zero)
   *   - timestamps 1 … 428  (firstTimestamp = 1)
   *   - terminator 0xFFFFFFFF present
   *
   * We reproduce only the header structure; actual frame pixels are tiny stubs.
   */
  const FRAME_COUNT = 428;
  const RAW_MULTIPLIER = 0xffff_d8f0; // 4 294 957 296
  const FIRST_TIMESTAMP = 1;

  const frames: Uint8Array[] = Array.from({ length: FRAME_COUNT }, (_, i) =>
    makeFrame(i % 256),
  );

  let bifBytes: Uint8Array;
  let view: DataView;
  let parsedSource: ReturnType<BifParser['parse']>;

  beforeAll(() => {
    bifBytes = writeBif(frames, {
      intervalMs: 10_000,
      firstTimestamp: FIRST_TIMESTAMP,
      rawMultiplier: RAW_MULTIPLIER,
    });
    view = new DataView(
      bifBytes.buffer,
      bifBytes.byteOffset,
      bifBytes.byteLength,
    );
    const buffer = bifBytes.buffer.slice(
      bifBytes.byteOffset,
      bifBytes.byteOffset + bifBytes.byteLength,
    );
    parsedSource = new BifParser().parse(buffer);
  });

  // --- Header byte verification ---

  it('magic bytes 0–7 are correct', () => {
    const magic = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < 8; i++) {
      expect(view.getUint8(i)).toBe(magic[i]);
    }
  });

  it('version uint32 at byte 8 is 0', () => {
    expect(view.getUint32(8, true)).toBe(0);
  });

  it('frame count uint32 at byte 12 is 428', () => {
    expect(view.getUint32(12, true)).toBe(428);
  });

  it('multiplier uint32 at byte 16 is 0xFFFFD8F0', () => {
    expect(view.getUint32(16, true)).toBe(RAW_MULTIPLIER >>> 0);
  });

  it('first index entry (byte 64) has timestamp = 1', () => {
    expect(view.getUint32(64, true)).toBe(FIRST_TIMESTAMP);
  });

  it('last real index entry (frame 427, i.e. entry 427) has timestamp = 428', () => {
    // Entry k is at byte 64 + k*8.
    const entryOffset = 64 + 427 * 8;
    expect(view.getUint32(entryOffset, true)).toBe(FIRST_TIMESTAMP + 427);
  });

  it('terminator entry (entry 428) has 0xFFFFFFFF as its timestamp field', () => {
    const terminatorOffset = 64 + FRAME_COUNT * 8;
    expect(view.getUint32(terminatorOffset, true)).toBe(0xffff_ffff);
  });

  // --- Parser still works correctly ---

  it('BifParser.parse() returns non-null', () => {
    expect(parsedSource).not.toBeNull();
  });

  it('getImageData(0) returns frame 0 data', () => {
    expect(parsedSource).not.toBeNull();
    const data = parsedSource!.getImageData(0);
    expect(toBytes(data)).toEqual(toBytes(frames[0]));
  });

  /**
   * getImageData(30000): getEndIndex = ceil(30000/10000)+1 = 3+1 = 4
   *   → endIndex=4, startIndex=3 → frame 3.
   *
   * The huge multiplier means the parser gives each frame a positionMillis of
   * (timestamp × 0xFFFFD8F0) which is enormous, but getEndIndex ignores
   * positionMillis stored in imageOffsets — it re-derives the index directly
   * from the requested positionMillis using the hard-coded ÷10 s rule.
   * So the ÷10 index logic still holds regardless of the multiplier.
   */
  it('getImageData(30000) returns frame 3  (ceil(3)+1=4, index 3)', () => {
    expect(parsedSource).not.toBeNull();
    const data = parsedSource!.getImageData(30_000);
    expect(toBytes(data)).toEqual(toBytes(frames[3]));
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('writeBif error handling', () => {
  it('throws when frames array is empty', () => {
    expect(() => writeBif([], { intervalMs: 10_000 })).toThrow();
  });

  it('throws when intervalMs is 0', () => {
    expect(() =>
      writeBif([makeFrame(0)], { intervalMs: 0 }),
    ).toThrow();
  });

  it('throws when intervalMs is negative', () => {
    expect(() =>
      writeBif([makeFrame(0)], { intervalMs: -1 }),
    ).toThrow();
  });
});
