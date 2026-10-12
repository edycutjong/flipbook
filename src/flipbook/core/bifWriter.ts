/**
 * Roku BIF ("Base Index Frames") writer.
 *
 * Pure TypeScript — no Node.js imports so this module compiles cleanly for
 * React Native as well as in scripts and tests.
 *
 * BIF specification:
 *   https://developer.roku.com/docs/developer-program/media-playback/trick-mode/bif-file-creation.md
 *
 * Binary layout (all multi-byte values are little-endian):
 *   Bytes  0–7   : magic  89 42 49 46 0D 0A 1A 0A
 *   Bytes  8–11  : version uint32 = 0
 *   Bytes 12–15  : frame count uint32
 *   Bytes 16–19  : timestamp multiplier uint32  (ms per timestamp unit; 0 means 1000 ms)
 *   Bytes 20–63  : reserved (zero)
 *   Byte  64+    : index — one 8-byte entry per frame [timestamp uint32][absolute offset uint32]
 *                  followed by terminator entry [0xFFFFFFFF][offset of byte past last frame]
 *   After index  : raw frame bytes, back to back
 */

export type BifWriteOptions = {
  /** Milliseconds between frames, e.g. 10 000 for a 10-second interval. */
  intervalMs: number;
  /** Timestamp stored in the index for frame 0 (default 0). */
  firstTimestamp?: number;
  /**
   * Override the raw uint32 written at byte 16.
   * Defaults to `intervalMs` so that timestamp k = firstTimestamp + k
   * maps back to k × intervalMs milliseconds when multiplied by this value.
   */
  rawMultiplier?: number;
};

const MAGIC = new Uint8Array([0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEADER_SIZE = 64; // bytes before the index section
const INDEX_ENTRY_SIZE = 8; // timestamp uint32 + offset uint32

/**
 * Builds a valid BIF file from an array of raw JPEG (or any) frame bytes.
 *
 * @param frames    Non-empty array of frame payloads.
 * @param opts      Timing and multiplier options.
 * @returns         A `Uint8Array` containing the complete BIF file.
 */
export function writeBif(frames: Uint8Array[], opts: BifWriteOptions): Uint8Array {
  const { intervalMs, firstTimestamp = 0, rawMultiplier } = opts;

  if (frames.length === 0) {
    throw new Error('writeBif: frames array must not be empty');
  }
  if (intervalMs <= 0) {
    throw new Error('writeBif: intervalMs must be a positive number');
  }

  const frameCount = frames.length;
  const multiplier = rawMultiplier !== undefined ? rawMultiplier : intervalMs;

  // Index section: frameCount entries + 1 terminator, each 8 bytes.
  const indexSize = (frameCount + 1) * INDEX_ENTRY_SIZE;

  // Total payload size of all frames.
  const totalFrameBytes = frames.reduce((sum, f) => sum + f.length, 0);

  // Allocate the full output buffer.
  const totalSize = HEADER_SIZE + indexSize + totalFrameBytes;
  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);

  // --- Write magic ---
  output.set(MAGIC, 0);

  // --- Write header fields ---
  view.setUint32(8, 0, true);            // version = 0
  view.setUint32(12, frameCount, true);  // frame count
  view.setUint32(16, multiplier >>> 0, true); // timestamp multiplier (coerce to uint32)
  // Bytes 20–63 are already zero (Uint8Array is zero-initialised).

  // --- Write index entries ---
  let indexOffset = HEADER_SIZE;
  // Absolute byte offset of frame data starts right after the index section.
  let dataOffset = HEADER_SIZE + indexSize;

  for (let k = 0; k < frameCount; k++) {
    const timestamp = (firstTimestamp + k) >>> 0; // uint32
    view.setUint32(indexOffset, timestamp, true);
    view.setUint32(indexOffset + 4, dataOffset, true);
    indexOffset += INDEX_ENTRY_SIZE;
    dataOffset += frames[k].length;
  }

  // --- Write terminator entry ---
  view.setUint32(indexOffset, 0xffffffff, true);
  view.setUint32(indexOffset + 4, dataOffset, true); // dataOffset now points past the last frame

  // --- Write frame payloads ---
  let writePos = HEADER_SIZE + indexSize;
  for (const frame of frames) {
    output.set(frame, writePos);
    writePos += frame.length;
  }

  return output;
}
