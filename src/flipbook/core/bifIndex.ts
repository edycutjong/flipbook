/**
 * Validated, index-based reader for Roku BIF files.
 *
 * The sample's `BifParser` (src/services/bif/BifFileParser.ts) is built for one job: give the seek bar a
 * thumbnail for a position. Flipbook reads the BIF as a corpus, frame by frame, so it needs three things the
 * sample does not check:
 *   1. the file is complete (terminator present, every offset inside the buffer, offsets increasing);
 *   2. a usable time for every frame, even when the header's multiplier is not sane — Amazon's own
 *      `tv-webinar-hd.bif` stores 0xFFFFD8F0 there, which the sample turns into ~4.29e9 ms per frame;
 *   3. byte access by frame index, not by position.
 * Pure TypeScript, no platform imports: the same file runs on the Vega device and in Node (tests, bench).
 */

export const BIF_MAGIC = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER_BYTES = 64;
const ENTRY_BYTES = 8;
const TERMINATOR = 0xffffffff;

/** A timestamp unit outside this range is treated as corrupt (1 ms … 60 s per unit). */
export const SANE_MULTIPLIER_MIN_MS = 1;
export const SANE_MULTIPLIER_MAX_MS = 60_000;
/** The sample's own hard-coded assumption, used only when nothing better is known. */
export const FALLBACK_UNIT_MS = 10_000;

export type IntervalSource = 'header' | 'duration' | 'fallback-10s';

export interface BifIndex {
  frameCount: number;
  /** Raw uint32 at byte 16 of the header. */
  rawMultiplier: number;
  /** Milliseconds per timestamp unit actually used. */
  unitMs: number;
  intervalSource: IntervalSource;
  /** Raw timestamps from the index, one per frame. */
  timestamps: Uint32Array;
  /** Byte offset of each frame, plus one trailing entry = end of the last frame. */
  offsets: Uint32Array;
  /** Position of each frame in the video, in ms. */
  timeMs: Float64Array;
  /** Median spacing between frames, ms. */
  intervalMs: number;
  byteLength: number;
}

export type BifError =
  | { kind: 'bad-magic' }
  | { kind: 'bad-version'; version: number }
  | { kind: 'empty' }
  | { kind: 'truncated'; detail: string }
  | { kind: 'irregular'; detail: string };

export type BifReadResult = { ok: true; index: BifIndex } | { ok: false; error: BifError };

export interface ReadBifOptions {
  /** Asset duration in ms, if known. Used to derive the timestamp unit when the header's multiplier is not sane. */
  durationMs?: number;
}

export function isSaneMultiplier(raw: number): boolean {
  return raw >= SANE_MULTIPLIER_MIN_MS && raw <= SANE_MULTIPLIER_MAX_MS;
}

export function readBif(buffer: ArrayBuffer, opts: ReadBifOptions = {}): BifReadResult {
  const byteLength = buffer.byteLength;
  if (byteLength < HEADER_BYTES + ENTRY_BYTES) {
    return { ok: false, error: { kind: 'truncated', detail: `file is ${byteLength} bytes` } };
  }
  const view = new DataView(buffer);
  for (let i = 0; i < BIF_MAGIC.length; i++) {
    if (view.getUint8(i) !== BIF_MAGIC[i]) {
      return { ok: false, error: { kind: 'bad-magic' } };
    }
  }
  const version = view.getUint32(8, true);
  if (version !== 0) {
    return { ok: false, error: { kind: 'bad-version', version } };
  }
  const frameCount = view.getUint32(12, true);
  if (frameCount === 0) {
    return { ok: false, error: { kind: 'empty' } };
  }
  const indexEnd = HEADER_BYTES + (frameCount + 1) * ENTRY_BYTES;
  if (indexEnd > byteLength) {
    return {
      ok: false,
      error: { kind: 'truncated', detail: `index needs ${indexEnd} bytes, file has ${byteLength}` },
    };
  }
  const rawMultiplier = view.getUint32(16, true);

  const timestamps = new Uint32Array(frameCount);
  const offsets = new Uint32Array(frameCount + 1);
  for (let i = 0; i < frameCount; i++) {
    const at = HEADER_BYTES + i * ENTRY_BYTES;
    timestamps[i] = view.getUint32(at, true);
    offsets[i] = view.getUint32(at + 4, true);
  }
  const termAt = HEADER_BYTES + frameCount * ENTRY_BYTES;
  const terminator = view.getUint32(termAt, true);
  offsets[frameCount] = view.getUint32(termAt + 4, true);

  // Upstream defect #2: the sample warns on a missing terminator but still trusts the trailing offset.
  if (terminator !== TERMINATOR) {
    return { ok: false, error: { kind: 'truncated', detail: 'missing 0xffffffff terminator entry' } };
  }
  for (let i = 0; i <= frameCount; i++) {
    if (offsets[i] > byteLength) {
      return {
        ok: false,
        error: { kind: 'truncated', detail: `frame ${i} offset ${offsets[i]} beyond ${byteLength} bytes` },
      };
    }
    if (i > 0 && offsets[i] <= offsets[i - 1]) {
      return { ok: false, error: { kind: 'irregular', detail: `offsets not increasing at frame ${i}` } };
    }
  }
  if (offsets[0] < indexEnd) {
    return { ok: false, error: { kind: 'irregular', detail: 'first frame overlaps the index' } };
  }
  for (let i = 1; i < frameCount; i++) {
    if (timestamps[i] <= timestamps[i - 1]) {
      return { ok: false, error: { kind: 'irregular', detail: `timestamps not increasing at frame ${i}` } };
    }
  }

  // Upstream defect #1: pick the timestamp unit. Header if sane; else asset duration ÷ last timestamp
  // (keeping the file's own timestamps, so its offset is kept); else the sample's 10 s assumption.
  let unitMs: number;
  let intervalSource: IntervalSource;
  if (rawMultiplier === 0) {
    unitMs = 1000; // Roku spec: 0 means 1000 ms (same rule as the sample's parser)
    intervalSource = 'header';
  } else if (isSaneMultiplier(rawMultiplier)) {
    unitMs = rawMultiplier;
    intervalSource = 'header';
  } else if (opts.durationMs && opts.durationMs > 0 && timestamps[frameCount - 1] > 0) {
    unitMs = opts.durationMs / timestamps[frameCount - 1];
    intervalSource = 'duration';
  } else {
    unitMs = FALLBACK_UNIT_MS;
    intervalSource = 'fallback-10s';
  }

  const timeMs = new Float64Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    timeMs[i] = timestamps[i] * unitMs;
  }
  const gaps: number[] = [];
  for (let i = 1; i < frameCount; i++) {
    gaps.push(timeMs[i] - timeMs[i - 1]);
  }
  gaps.sort((a, b) => a - b);
  const intervalMs = gaps.length ? gaps[gaps.length >> 1] : unitMs;
  // A BIF whose spacing varies wildly cannot be mapped to positions honestly.
  if (gaps.length && gaps[gaps.length - 1] > 4 * intervalMs) {
    return {
      ok: false,
      error: { kind: 'irregular', detail: `frame spacing up to ${gaps[gaps.length - 1]} ms vs median ${intervalMs} ms` },
    };
  }

  return {
    ok: true,
    index: {
      frameCount,
      rawMultiplier,
      unitMs,
      intervalSource,
      timestamps,
      offsets,
      timeMs,
      intervalMs,
      byteLength,
    },
  };
}

/** JPEG bytes of frame `i` (a view, no copy). */
export function frameBytes(buffer: ArrayBuffer, index: BifIndex, i: number): Uint8Array {
  const start = index.offsets[i];
  return new Uint8Array(buffer, start, index.offsets[i + 1] - start);
}

/** Frame whose time is the latest one ≤ positionMs (clamped to the first/last frame). */
export function frameAtMs(index: BifIndex, positionMs: number): number {
  const t = index.timeMs;
  if (positionMs <= t[0]) {
    return 0;
  }
  let lo = 0;
  let hi = index.frameCount - 1;
  if (positionMs >= t[hi]) {
    return hi;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= positionMs) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export function describeBifError(e: BifError): string {
  switch (e.kind) {
    case 'bad-magic':
      return 'not a BIF file (bad magic number)';
    case 'bad-version':
      return `unsupported BIF version ${e.version}`;
    case 'empty':
      return 'BIF has no frames';
    case 'truncated':
      return `truncated BIF: ${e.detail}`;
    case 'irregular':
      return `irregular BIF: ${e.detail}`;
  }
}
