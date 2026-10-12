/** Test helpers: synthetic signatures and minimal BIF/JPEG builders (independent of the code under test). */
import { encode } from 'jpeg-js';
import { DEFAULT_GRID, FrameOracle, Sig } from '../../src/flipbook/core';

export const SIG_LEN = DEFAULT_GRID.cols * DEFAULT_GRID.rows;
const COLS = DEFAULT_GRID.cols;

export const flat = (v: number): Sig => new Float32Array(SIG_LEN).fill(v);

/**
 * A synthetic score-graphic signature (64×5 grid): a static graphic, a 4×3-cell digit block whose level encodes
 * the score, and a transparent gap (cols 20–23) where the pitch shows through and jitters every frame.
 */
export const scoreSig = (score: number, noise = 0, rnd: () => number = Math.random): Sig => {
  const s = new Float32Array(SIG_LEN).fill(120);
  for (let r = 1; r <= 3; r++) {
    for (let c = 50; c < 54; c++) {
      s[r * COLS + c] = 60 + (score % 4) * 45;
    }
  }
  for (let r = 0; r < 5; r++) {
    for (let c = 20; c < 24; c++) {
      s[r * COLS + c] = 40 + rnd() * 150;
    }
  }
  if (noise) {
    for (let k = 0; k < SIG_LEN; k++) {
      s[k] += (rnd() - 0.5) * 2 * noise;
    }
  }
  return s;
};

/** Graphic absent (replay / ad): the pitch everywhere. */
export const absentSig = (rnd: () => number = Math.random): Sig => {
  const s = new Float32Array(SIG_LEN);
  for (let k = 0; k < SIG_LEN; k++) {
    s[k] = 60 + rnd() * 50;
  }
  return s;
};

export const oracleFor = (sigs: Sig[], tauAbs = 20) => new FrameOracle(sigs.length, i => sigs[i], tauAbs);

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Minimal BIF builder for tests (Roku layout; the production writer is src/flipbook/core/bifWriter.ts). */
export function buildBif(
  frames: Uint8Array[],
  opts: { multiplier?: number; firstTimestamp?: number; terminator?: boolean; badOffsetAt?: number } = {},
): ArrayBuffer {
  const n = frames.length;
  const headerAndIndex = 64 + (n + 1) * 8;
  const total = headerAndIndex + frames.reduce((a, f) => a + f.length, 0);
  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a].forEach((b, i) => v.setUint8(i, b));
  v.setUint32(8, 0, true);
  v.setUint32(12, n, true);
  v.setUint32(16, opts.multiplier ?? 10000, true);
  let off = headerAndIndex;
  const first = opts.firstTimestamp ?? 0;
  for (let i = 0; i < n; i++) {
    v.setUint32(64 + i * 8, first + i, true);
    v.setUint32(64 + i * 8 + 4, i === opts.badOffsetAt ? total + 100 : off, true);
    new Uint8Array(buf, off, frames[i].length).set(frames[i]);
    off += frames[i].length;
  }
  v.setUint32(64 + n * 8, opts.terminator === false ? 0 : 0xffffffff, true);
  v.setUint32(64 + n * 8 + 4, off, true);
  return buf;
}

/**
 * Synthetic broadcast frame W×H with optional letterbox bars, a busy "pitch", and a score graphic at a fixed
 * place in the picture whose digit block brightness encodes the score. score = null → graphic hidden.
 */
export function frameJpeg(
  score: number | null,
  opts: { w?: number; h?: number; bars?: number; seed?: number; quality?: number } = {},
): Uint8Array {
  const w = opts.w ?? 240;
  const h = opts.h ?? 180;
  const bars = opts.bars ?? 0;
  const r = rng(opts.seed ?? 1);
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let lum: number;
      if (y < bars || y >= h - bars) {
        lum = 4;
      } else {
        lum = 70 + Math.floor(r() * 50); // grass texture
        const py = (y - bars) / (h - 2 * bars);
        const px = x / w;
        // score graphic: x 0.05–0.35, y 0.05–0.15 of the picture
        if (score !== null && px >= 0.05 && px < 0.35 && py >= 0.05 && py < 0.15) {
          lum = 230;
          // digit block: x 0.25–0.32
          if (px >= 0.25 && px < 0.32) {
            lum = 40 + (score % 4) * 55;
          }
        }
      }
      data[i] = data[i + 1] = data[i + 2] = lum;
      data[i + 3] = 255;
    }
  }
  return new Uint8Array(encode({ data, width: w, height: h }, opts.quality ?? 80).data);
}

export const toArrayBuffer = (b: Uint8Array | Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
