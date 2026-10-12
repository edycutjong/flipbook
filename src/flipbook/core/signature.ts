/**
 * Signature of the calibrated rectangle: mean luma on a 16×4 grid. d(a, b) = mean absolute difference.
 */
import { LumaFrame, PictureArea } from './luma';

export const GRID_COLS = 16;
export const GRID_ROWS = 4;
export const SIG_LEN = GRID_COLS * GRID_ROWS;

export type Sig = Float32Array;

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

export function signature(f: LumaFrame, area: PictureArea, rect: NormRect): Sig {
  const { x0, y0, x1, y1 } = rectToPixels(rect, area);
  const rw = x1 - x0;
  const rh = y1 - y0;
  const sig = new Float32Array(SIG_LEN);
  for (let gy = 0; gy < GRID_ROWS; gy++) {
    // Each cell covers at least one pixel, so a rect smaller than the grid still yields a full signature.
    const cy0 = y0 + Math.floor((gy * rh) / GRID_ROWS);
    const cy1 = Math.max(cy0 + 1, y0 + Math.floor(((gy + 1) * rh) / GRID_ROWS));
    for (let gx = 0; gx < GRID_COLS; gx++) {
      const cx0 = x0 + Math.floor((gx * rw) / GRID_COLS);
      const cx1 = Math.max(cx0 + 1, x0 + Math.floor(((gx + 1) * rw) / GRID_COLS));
      let sum = 0;
      let n = 0;
      for (let yy = cy0; yy < cy1 && yy < y1; yy++) {
        const row = yy * f.width;
        for (let xx = cx0; xx < cx1 && xx < x1; xx++) {
          sum += f.y[row + xx];
          n++;
        }
      }
      sig[gy * GRID_COLS + gx] = n ? sum / n : 0;
    }
  }
  return sig;
}

export function sigDistance(a: Sig, b: Sig): number {
  let s = 0;
  for (let i = 0; i < SIG_LEN; i++) {
    s += Math.abs(a[i] - b[i]);
  }
  return s / SIG_LEN;
}

function clampInt(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
