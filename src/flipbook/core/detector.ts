/**
 * Change-and-hold detector over BIF frame signatures.
 *
 *  mask       = cells whose median change between pass-1 samples is ≤ jitterMax (static parts of the graphic)
 *  present_i  ⇔ masked mean d(sig_i, ref) < τ_abs              (ref = medoid of the pass-1 samples)
 *  D(c)       = topK( median(sig of c and the next W−1 present frames) − median(sig of the W present frames before c) )
 *  change at c ⇔ D(c) > τ and c is the first frame closer to the new state than to the old one — i.e. the new
 *               graphic HOLDS for most of a W-frame window (a one-frame flash or a noisy frame cannot)
 *  anchor(c)  = last present frame before c (still the OLD score) — any graphic-absent run (replay,
 *               celebration) between it and c is walked back over (E1).
 *
 * Pass 1 ("sprocket", E2) decodes every `stride`-th frame, learns the mask and the reference from them, and
 * bisects only the windows whose two ends differ by more than τ_cand. Pass 2 ("verify") reads every frame with the
 * sequential rule and can only add markers. Both passes share one memoised frame oracle.
 * Thresholds were tuned on the development match only (see DEMO.md); held-out matches never tune them.
 */
import { CellMask, cellMask, medianSig, Sig, sigDistance, topKDistance } from './signature';

export interface DetectorParams {
  /** Windowed change threshold (top-K units, luma). */
  tau: number;
  /** Pass-1 candidate threshold between two single sprocket samples. */
  tauCand: number;
  /** Presence threshold: masked mean distance to the reference. */
  tauAbs: number;
  /** Cells averaged for the change distance. */
  topK: number;
  /** Frames in each median window (odd). */
  window: number;
  /** A cell whose median change between samples exceeds this is masked out. */
  jitterMax: number;
  /** F3: when fewer than this fraction of cells survive the mask, the box is "moving". */
  movingKeptMin: number;
  /** Pass-1 sampling stride, frames. */
  stride: number;
  /** How far (frames) to look for the W present neighbours on each side. scanBif uses this for pass 1 and
   *  raises it to cover 15 min (REACH_MS) for pass 2, which reads every frame anyway. */
  reach: number;
}

export const DEFAULT_PARAMS: DetectorParams = {
  tau: 20,
  tauCand: 12,
  tauAbs: 20,
  topK: 3,
  window: 3,
  jitterMax: 2.5,
  movingKeptMin: 0.4,
  stride: 8,
  reach: 12,
};

/** Detector output. `ms`/`changeMs` hold frame INDICES inside the passes; `scan.ts` converts them to ms. */
export interface Marker {
  /** Anchor: time of the last frame still showing the old score (E1). The jump goes to ms − leadIn. */
  ms: number;
  /** Time of the first frame showing the new score. */
  changeMs: number;
  /** Frame index of the change. */
  frameIndex: number;
  /** Frame index of the anchor. */
  anchorIndex: number;
  /** D(c), the windowed change distance. */
  delta: number;
  /** Pass that first found it. */
  pass: 1 | 2;
}

/** Decodes and caches frame signatures on demand; counts decodes. */
export class FrameOracle {
  readonly n: number;
  private sigs: (Sig | undefined)[];
  private pres: Int8Array; // -1 unknown, 0 absent, 1 present
  private ref: Sig | null = null;
  mask: CellMask | null = null;
  decodes = 0;
  constructor(
    n: number,
    private decodeSig: (i: number) => Sig,
    private tauAbs: number,
  ) {
    this.n = n;
    this.sigs = new Array(n);
    this.pres = new Int8Array(n).fill(-1);
  }
  setReference(ref: Sig, mask: CellMask) {
    this.ref = ref;
    this.mask = mask;
    this.pres.fill(-1);
  }
  has(i: number) {
    return this.sigs[i] !== undefined;
  }
  sig(i: number): Sig {
    let s = this.sigs[i];
    if (!s) {
      s = this.decodeSig(i);
      this.sigs[i] = s;
      this.decodes++;
    }
    return s;
  }
  present(i: number): boolean {
    if (!this.ref) {
      return true;
    }
    if (this.pres[i] < 0) {
      this.pres[i] = sigDistance(this.sig(i), this.ref, this.mask || undefined) < this.tauAbs ? 1 : 0;
    }
    return this.pres[i] === 1;
  }
}

/** Up to `w` present frame indices before c (nearest last), looking back at most `reach` frames. */
export function presentBefore(o: FrameOracle, c: number, w: number, reach: number): number[] {
  const out: number[] = [];
  for (let j = c - 1; j >= 0 && j >= c - reach && out.length < w; j--) {
    if (o.present(j)) {
      out.unshift(j);
    }
  }
  return out;
}

/** c (if present) and the next present frames, up to `w`, looking ahead at most `reach` frames. */
export function presentFrom(o: FrameOracle, c: number, w: number, reach: number): number[] {
  const out: number[] = [];
  for (let j = c; j < o.n && j <= c + reach && out.length < w; j++) {
    if (o.present(j)) {
      out.push(j);
    }
  }
  return out;
}

/** D(c) with its two medians, or null when there are not enough present frames on a side. */
export function windowStep(o: FrameOracle, c: number, p: DetectorParams) {
  const before = presentBefore(o, c, p.window, p.reach);
  const after = presentFrom(o, c, p.window, p.reach);
  const need = Math.ceil(p.window / 2);
  if (before.length < need || after.length < need) {
    return null;
  }
  const oldS = medianSig(before.map(i => o.sig(i)));
  const newS = medianSig(after.map(i => o.sig(i)));
  return { d: topKDistance(newS, oldS, o.mask || undefined, p.topK), oldS, newS };
}

const closerToNew = (o: FrameOracle, j: number, oldS: Sig, newS: Sig, p: DetectorParams) =>
  topKDistance(o.sig(j), newS, o.mask || undefined, p.topK) < topKDistance(o.sig(j), oldS, o.mask || undefined, p.topK);

/** Confirms a change near c: returns the first frame of the new state and its D, or null. */
export function confirmAt(o: FrameOracle, c: number, p: DetectorParams): { c: number; d: number } | null {
  if (!o.present(c)) {
    return null;
  }
  const ws = windowStep(o, c, p);
  if (!ws || ws.d <= p.tau) {
    return null;
  }
  // Settle on the first frame that already looks like the new state (c may sit one frame early in a window).
  let first = c;
  const back = presentBefore(o, c, 1, p.reach);
  if (back.length && closerToNew(o, back[0], ws.oldS, ws.newS, p)) {
    first = back[0];
  } else if (!closerToNew(o, c, ws.oldS, ws.newS, p)) {
    const next = presentFrom(o, c + 1, 1, p.reach);
    if (!next.length) {
      return null;
    }
    first = next[0];
  }
  const ws2 = first === c ? ws : windowStep(o, first, p);
  return ws2 && ws2.d > p.tau ? { c: first, d: ws2.d } : null;
}

function markerAt(o: FrameOracle, c: number, d: number, pass: 1 | 2, reach: number): Marker {
  // E1 walk-back over the absent run, bounded by reach (pass 2's reach covers 15 min; pass 1 stays short).
  const prev = presentBefore(o, c, 1, reach);
  const anchor = prev.length ? prev[0] : c;
  return { ms: anchor, changeMs: c, frameIndex: c, anchorIndex: anchor, delta: d, pass };
}

export interface PassProgress {
  pass: 1 | 2;
  /** Furthest frame index read in order (the scan position). */
  readTo: number;
  decodes: number;
}

export function sprocketSamples(n: number, stride: number): number[] {
  const k = Math.max(1, stride);
  const s: number[] = [];
  for (let i = 0; i < n; i += k) {
    s.push(i);
  }
  if (s[s.length - 1] !== n - 1) {
    s.push(n - 1);
  }
  return s;
}

/** Medoid of the given frames under the (masked) mean distance: the most typical look of the graphic. */
export function medoid(o: FrameOracle, idx: number[], mask: CellMask, radius: number): number {
  let best = idx[0];
  let bestCount = -1;
  let bestSum = Infinity;
  for (const a of idx) {
    let count = 0;
    let sum = 0;
    for (const b of idx) {
      const d = sigDistance(o.sig(a), o.sig(b), mask);
      sum += d;
      if (d <= radius) {
        count++;
      }
    }
    if (count > bestCount || (count === bestCount && sum < bestSum)) {
      best = a;
      bestCount = count;
      bestSum = sum;
    }
  }
  return best;
}

/**
 * Pass 1 — sprocket + bisect. Phase A decodes the sprocket samples (left to right) and learns the cell mask and
 * the presence reference from them. Phase B compares consecutive present samples; a pair that differs by more
 * than τ_cand is bisected (single frames, classified as nearer the old or the new sample) and the found frame must
 * pass the windowed hold test. Generator: yields after every sample so the caller can pace the JS thread.
 */
export function* sprocketPass(
  o: FrameOracle,
  p: DetectorParams,
  sink?: (m: Marker) => void,
  refFrame?: number,
): Generator<PassProgress, { markers: Marker[]; mask: CellMask; kept: number; ref: number }, void> {
  const samples = sprocketSamples(o.n, p.stride);
  for (const s of samples) {
    o.sig(s);
    yield { pass: 1, readTo: s, decodes: o.decodes };
  }
  const { mask, kept } = cellMask(
    samples.map(s => o.sig(s)),
    p.jitterMax,
  );
  // Reference = medoid of at most 24 evenly spaced samples (O(m²), so capped to stay short on the JS thread).
  const step = Math.max(1, Math.ceil(samples.length / 24));
  const candidates = samples.filter((_, k) => k % step === 0);
  const ref = refFrame !== undefined ? refFrame : medoid(o, candidates, mask, p.tauAbs / 2);
  o.setReference(o.sig(ref), mask);

  const markers: Marker[] = [];
  const present = samples.filter(s => o.present(s));
  for (let k = 1; k < present.length; k++) {
    const a = present[k - 1];
    const b = present[k];
    if (topKDistance(o.sig(a), o.sig(b), mask, p.topK) > p.tauCand) {
      const sa = o.sig(a);
      const sb = o.sig(b);
      let lo = a;
      let hi = b;
      let linear = false;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (!o.present(mid)) {
          linear = true;
          break;
        }
        if (closerToNew(o, mid, sa, sb, p)) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      if (linear) {
        hi = b;
        for (let j = lo + 1; j <= b; j++) {
          if (o.present(j) && closerToNew(o, j, sa, sb, p)) {
            hi = j;
            break;
          }
        }
      }
      const found = confirmAt(o, hi, p);
      if (found && !markers.some(m => Math.abs(m.frameIndex - found.c) <= p.window)) {
        const m = markerAt(o, found.c, found.d, 1, p.reach);
        markers.push(m);
        sink?.(m);
      }
    }
    yield { pass: 1, readTo: b, decodes: o.decodes };
  }
  return { markers, mask, kept, ref };
}

/**
 * Pass 2 — sequential verify over every frame (after pass 1 set the mask and reference).
 * Returns markers (pass = 2; the caller merges with pass 1) and the absent-frame count.
 */
export function* sequentialPass(
  o: FrameOracle,
  p: DetectorParams,
): Generator<PassProgress, { markers: Marker[]; absent: number }, void> {
  const markers: Marker[] = [];
  let absent = 0;
  let skipUntil = -1;
  let prefetched = -1;
  for (let i = 0; i < o.n; i++) {
    // Read ahead one frame per step, so the look-ahead below (up to `reach` frames through a long graphic-absent
    // run) never decodes a burst inside a single step: the JS thread gets a turn every few decodes.
    const want = Math.min(o.n - 1, i + p.reach);
    while (prefetched < want) {
      prefetched++;
      const fresh = !o.has(prefetched);
      o.sig(prefetched);
      if (fresh) {
        yield { pass: 2, readTo: Math.max(0, i - 1), decodes: o.decodes };
      }
    }
    if (!o.present(i)) {
      absent++;
    } else if (i > skipUntil) {
      const found = confirmAt(o, i, p);
      if (found) {
        markers.push(markerAt(o, found.c, found.d, 2, p.reach));
        // Leave the window that straddles this change before testing again.
        const after = presentFrom(o, found.c, p.window, p.reach);
        skipUntil = after.length ? after[after.length - 1] - 1 : found.c;
      }
    }
    yield { pass: 2, readTo: i, decodes: o.decodes };
  }
  return { markers, absent };
}

/**
 * Merge: the final list is pass 2's (it reads every frame). A pass-2 marker within `tolerance` frames of a
 * pass-1 marker keeps pass = 1. Returns the pass-1 markers pass 2 did not reproduce (the invariant
 * pass1 ⊆ pass2 says this list is empty).
 */
export function mergePasses(pass1: Marker[], pass2: Marker[], tolerance = 1) {
  const used = new Set<number>();
  const merged = pass2.map(m2 => {
    const hit = pass1.findIndex((m1, idx) => !used.has(idx) && Math.abs(m1.frameIndex - m2.frameIndex) <= tolerance);
    if (hit >= 0) {
      used.add(hit);
      return { ...m2, pass: 1 as const };
    }
    return { ...m2, pass: 2 as const };
  });
  const lostFromPass1 = pass1.filter((_, idx) => !used.has(idx));
  const added = merged.filter(m => m.pass === 2).length;
  return { merged, added, lostFromPass1 };
}

/** F3: a box that is mostly jitter (e.g. over a running clock, or the pitch). */
export function boxIsMoving(sigs: Sig[], p: Pick<DetectorParams, 'jitterMax' | 'movingKeptMin'>) {
  const { kept } = cellMask(sigs, p.jitterMax);
  return { moving: kept < p.movingKeptMin, kept };
}

/** Drives a pass generator to completion synchronously (Node: tests, bench). */
export function runToEnd<R>(gen: Generator<PassProgress, R, void>): R {
  for (;;) {
    const r = gen.next();
    if (r.done) {
      return r.value;
    }
  }
}
