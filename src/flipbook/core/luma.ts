/**
 * BIF frame (baseline JPEG) → luma plane, and the picture area inside letterbox/pillarbox bars.
 *
 * Decoding uses jpeg-js (pure JS) — there is no native pixel-access image API in the Vega corpus. Only BIF
 * thumbnail JPEGs ever reach this decoder; Flipbook never decodes a video byte.
 */
// Import the decoder only: jpeg-js's index also loads the encoder.
const decodeJpeg: (data: Uint8Array, opts: Record<string, unknown>) => DecodedImage = require('jpeg-js/lib/decoder');

interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface LumaFrame {
  width: number;
  height: number;
  /** One byte per pixel, row-major. */
  y: Uint8Array;
}

/** Picture area in pixels (inclusive top/left, exclusive bottom/right). */
export interface PictureArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Counts every call so tests and the log tail can prove what was decoded. */
export const decodeStats = { frames: 0, jpegBytes: 0 };

export function decodeLuma(jpeg: Uint8Array): LumaFrame {
  const img = decodeJpeg(jpeg, {
    useTArray: true,
    formatAsRGBA: false,
    tolerantDecoding: true,
    // A BIF thumbnail is ~0.06 MP. Past 1 MP it is not a thumbnail: refuse it at the frame header (before any pixel
    // is decoded) instead of pinning the single JS thread for seconds. jpeg-js's default is 100 MP.
    maxResolutionInMP: 1,
    maxMemoryUsageInMB: 64,
  });
  decodeStats.frames++;
  decodeStats.jpegBytes += jpeg.byteLength;
  const n = img.width * img.height;
  const y = new Uint8Array(n);
  const rgb = img.data;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    // BT.601 luma, integer form
    // eslint-disable-next-line no-bitwise
    y[i] = (77 * rgb[j] + 150 * rgb[j + 1] + 29 * rgb[j + 2]) >> 8;
  }
  return { width: img.width, height: img.height, y };
}

/** A row/column counts as bar when no pixel in it is brighter than this (Amazon's bars measured ≤ 24). */
export const BAR_MAX_LUMA = 28;

/**
 * Finds the picture area of one frame: rows from the top/bottom and columns from the left/right whose
 * brightest pixel is ≤ BAR_MAX_LUMA. A fully dark frame returns the whole frame.
 */
export function pictureAreaOf(f: LumaFrame): PictureArea {
  const { width: w, height: h, y } = f;
  const rowDark = (r: number) => {
    for (let x = 0, i = r * w; x < w; x++, i++) {
      if (y[i] > BAR_MAX_LUMA) {
        return false;
      }
    }
    return true;
  };
  const colDark = (c: number, top: number, bottom: number) => {
    for (let r = top; r < bottom; r++) {
      if (y[r * w + c] > BAR_MAX_LUMA) {
        return false;
      }
    }
    return true;
  };
  let top = 0;
  while (top < h && rowDark(top)) {
    top++;
  }
  if (top === h) {
    return { top: 0, bottom: h, left: 0, right: w };
  }
  let bottom = h;
  while (bottom > top && rowDark(bottom - 1)) {
    bottom--;
  }
  let left = 0;
  while (left < w && colDark(left, top, bottom)) {
    left++;
  }
  let right = w;
  while (right > left && colDark(right - 1, top, bottom)) {
    right--;
  }
  return { top, bottom, left, right };
}

/**
 * Picture area over several frames: the median of each edge. Bars are constant, the picture is not, so a dark
 * scene in one frame cannot shrink the area.
 */
export function medianPictureArea(areas: PictureArea[], width: number, height: number): PictureArea {
  if (!areas.length) {
    return { top: 0, bottom: height, left: 0, right: width };
  }
  const med = (vals: number[]) => {
    const s = [...vals].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return {
    top: med(areas.map(a => a.top)),
    bottom: med(areas.map(a => a.bottom)),
    left: med(areas.map(a => a.left)),
    right: med(areas.map(a => a.right)),
  };
}
