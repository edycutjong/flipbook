/**
 * Signature of the calibrated rectangle: mean luma on a cols×rows grid (default 64×5 — at 320-wide BIFs a
 * score digit is ~5 px wide, so cells must be ~2–3 px to see one change).
 *
 * Distances are taken over a CELL MASK: cells that jitter while nothing changes (transparent gaps between the
 * graphic's boxes, where the pitch shows through) are dropped. A score change touches only a few cells, so the
 * change distance is the mean of the K largest masked cell differences; presence uses the plain masked mean.
 */
import { LumaFrame, PictureArea } from './luma';

export const DEFAULT_GRID = { cols: 64, rows: 5 };

export type Sig = Float32Array;
/** 1 = cell used, 0 = ignored. */
export type CellMask = Uint8Array;

/** Rectangle in normalised coordinates of the PICTURE area (not of the frame), 0..1. */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pixel bounds of a normalised rect inside the picture area, at least 1×1. */
export function rectToPixels(rect: NormRect, area: PictureArea) {
  const pw = area.right - area.left;
  const ph = area.bottom - area.top;
  const x0 = clampInt(area.left + Math.floor(rect.x * pw), area.left, area.right - 1);
  const y0 = clampInt(area.top + Math.floor(rect.y * ph), area.top, area.bottom - 1);
  const x1 = clampInt(area.left + Math.ceil((rect.x + rect.w) * pw), x0 + 1, area.right);
  const y1 = clampInt(area.top + Math.ceil((rect.y + rect.h) * ph), y0 + 1, area.bottom);
  return { x0, y0, x1, y1 };
}

export function signature(f: LumaFrame, area: PictureArea, rect: NormRect, cols = DEFAULT_GRID.cols, rows = DEFAULT_GRID.rows): Sig {
  const { x0, y0, x1, y1 } = rectToPixels(rect, area);
  const rw = x1 - x0;
  const rh = y1 - y0;
  const sig = new Float32Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) {
    // Each cell covers at least one pixel, so a rect smaller than the grid still yields a full signature.
    const cy0 = y0 + Math.floor((gy * rh) / rows);
    const cy1 = Math.max(cy0 + 1, y0 + Math.floor(((gy + 1) * rh) / rows));
    for (let gx = 0; gx < cols; gx++) {
      const cx0 = x0 + Math.floor((gx * rw) / cols);
      const cx1 = Math.max(cx0 + 1, x0 + Math.floor(((gx + 1) * rw) / cols));
      let sum = 0;
      let n = 0;
      for (let yy = cy0; yy < cy1 && yy < y1; yy++) {
        const row = yy * f.width;
        for (let xx = cx0; xx < cx1 && xx < x1; xx++) {
          sum += f.y[row + xx];
          n++;
        }
      }
      sig[gy * cols + gx] = n ? sum / n : 0;
    }
  }
  return sig;
}

export const fullMask = (len: number): CellMask => new Uint8Array(len).fill(1);

/** Mean absolute difference over masked cells (presence test). */
export function sigDistance(a: Sig, b: Sig, mask?: CellMask): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (!mask || mask[i]) {
      s += Math.abs(a[i] - b[i]);
      n++;
    }
  }
  return n ? s / n : 0;
}

/** Mean of the K largest absolute cell differences over masked cells (change test). */
export function topKDistance(a: Sig, b: Sig, mask: CellMask | undefined, k: number): number {
  const top: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (mask && !mask[i]) {
      continue;
    }
    const d = Math.abs(a[i] - b[i]);
    if (top.length < k) {
      top.push(d);
      top.sort((p, q) => p - q);
    } else if (d > top[0]) {
      top[0] = d;
      top.sort((p, q) => p - q);
    }
  }
  if (!top.length) {
    return 0;
  }
  let s = 0;
  for (const d of top) {
    s += d;
  }
  return s / top.length;
}

/** Element-wise median of a few signatures (window smoothing: transient noise drops out, a held change stays). */
export function medianSig(sigs: Sig[]): Sig {
  const len = sigs[0].length;
  const out = new Float32Array(len);
  const col = new Array<number>(sigs.length);
  for (let i = 0; i < len; i++) {
    for (let k = 0; k < sigs.length; k++) {
      col[k] = sigs[k][i];
    }
    col.sort((p, q) => p - q);
    const m = col.length;
    out[i] = m % 2 ? col[(m - 1) / 2] : (col[m / 2 - 1] + col[m / 2]) / 2;
  }
  return out;
}

/**
 * Cell mask from frames that (mostly) show no change: a cell is kept when its median frame-to-frame change is
 * ≤ jitterMax. Returns the mask and the kept fraction (a box that is mostly jitter is "moving", F3).
 */
export function cellMask(sigs: Sig[], jitterMax: number): { mask: CellMask; kept: number } {
  const len = sigs[0].length;
  const mask = new Uint8Array(len);
  if (sigs.length < 3) {
    mask.fill(1);
    return { mask, kept: 1 };
  }
  const diffs = new Array<number>(sigs.length - 1);
  let kept = 0;
  for (let i = 0; i < len; i++) {
    for (let k = 1; k < sigs.length; k++) {
      diffs[k - 1] = Math.abs(sigs[k][i] - sigs[k - 1][i]);
    }
    diffs.sort((p, q) => p - q);
    const med = diffs[Math.floor(diffs.length / 2)];
    if (med <= jitterMax) {
      mask[i] = 1;
      kept++;
    }
  }
  return { mask, kept: kept / len };
}

function clampInt(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
