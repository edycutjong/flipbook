/**
 * Change-and-hold detector over BIF frame signatures (spec: complexity.md §1).
 *
 *  present_i  ⇔ d(sig_i, ref) < τ_abs                       (ref = signature at calibration)
 *  change at c ⇔ present_c, d(sig_c, state) > τ, and the next `holdFrames` present frames stay within τ_hold of sig_c
 *  anchor(c)  = last present frame before c that still showed the OLD state — any graphic-absent run
 *               (replay, celebration) between it and c is walked back over (E1).
 *
 * Pass 1 ("sprocket", E2) samples every `stride`-th frame and bisects only the windows whose two ends differ.
 * Pass 2 ("verify") reads every frame in order with the sequential rule; it can only add markers.
 * Both passes share one memoised frame oracle, so pass 2 never decodes a frame twice.
 */
import { Sig, sigDistance } from './signature';

export interface DetectorParams {
  /** Change threshold on d(sig, state). */
  tau: number;
  /** Hold threshold: frames after a change must stay this close to it. */
  tauHold: number;
  /** Presence threshold: d(sig, ref) above this means the score graphic is not on screen. */
  tauAbs: number;
  /** Pass-1 sampling stride, frames. */
  stride: number;
  /** Present frames after a change that must hold. */
  holdFrames: number;
  /** How far (frames) to look for those holding frames. */
  holdWindow: number;
}

export const DEFAULT_PARAMS: DetectorParams = {
  tau: 10,
  tauHold: 7,
  tauAbs: 45,
  stride: 8,
  holdFrames: 2,
  holdWindow: 6,
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
  /** d(sig_change, old state). */
  delta: number;
  /** Pass that first found it. */
  pass: 1 | 2;
}

/** Decodes and caches frame signatures on demand; counts decodes. */
export class FrameOracle {
  readonly n: number;
  private sigs: (Sig | undefined)[];
  private pres: Int8Array; // -1 unknown, 0 absent, 1 present
  decodes = 0;
  constructor(
    n: number,
    private decodeSig: (i: number) => Sig,
    private ref: Sig,
    private tauAbs: number,
  ) {
    this.n = n;
    this.sigs = new Array(n);
    this.pres = new Int8Array(n).fill(-1);
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
    if (this.pres[i] < 0) {
      this.pres[i] = sigDistance(this.sig(i), this.ref) < this.tauAbs ? 1 : 0;
    }
    return this.pres[i] === 1;
  }
  refDistance(i: number): number {
    return sigDistance(this.sig(i), this.ref);
  }
}

/** True if the next `holdFrames` present frames after c (within holdWindow) stay within τ_hold of sig_c. */
export function holds(o: FrameOracle, c: number, p: DetectorParams): boolean {
  const sc = o.sig(c);
  let seen = 0;
  for (let j = c + 1; j < o.n && j <= c + p.holdWindow && seen < p.holdFrames; j++) {
    if (!o.present(j)) {
      continue;
    }
    if (sigDistance(o.sig(j), sc) >= p.tauHold) {
      return false;
    }
    seen++;
  }
  // At the very end of the file fewer frames exist: one confirming frame is enough there, none is not.
  return seen >= p.holdFrames || (seen >= 1 && c + p.holdWindow >= o.n - 1);
}

export interface PassProgress {
  pass: 1 | 2;
  /** Furthest frame index read in order (the scan position). */
  readTo: number;
  decodes: number;
}

/**
 * Pass 2 — sequential. Generator: yields after every frame so the caller can pace work on the JS thread.
 * Returns markers (pass = 2 for all; the caller merges with pass 1) and the absent-frame count.
 */
export function* sequentialPass(
  o: FrameOracle,
  p: DetectorParams,
): Generator<PassProgress, { markers: Marker[]; absent: number }, void> {
  const markers: Marker[] = [];
  let state: Sig | null = null;
  let lastOld = -1;
  let absent = 0;
  for (let i = 0; i < o.n; i++) {
    if (!o.present(i)) {
      absent++;
    } else {
      const s = o.sig(i);
      if (state === null) {
        state = s;
        lastOld = i;
      } else {
        const d = sigDistance(s, state);
        if (d <= p.tau) {
          state = s;
          lastOld = i;
        } else if (holds(o, i, p)) {
          markers.push({ ms: lastOld, changeMs: i, frameIndex: i, anchorIndex: lastOld, delta: d, pass: 2 });
          state = s;
          lastOld = i;
        }
        // else: transient (animation, flash) — state unchanged
      }
    }
    yield { pass: 2, readTo: i, decodes: o.decodes };
  }
  return { markers, absent };
}

/**
 * Pass 1 — sprocket + bisect. Samples 0, k, 2k, … (and the last frame). When a present sample differs from
 * the state, the window since the previous present sample is bisected on present frames (falling back to a
 * linear read when a midpoint is absent) to find the first changed frame; the hold rule confirms it.
 */
export function* sprocketPass(
  o: FrameOracle,
  p: DetectorParams,
  sink?: (m: Marker) => void,
): Generator<PassProgress, { markers: Marker[] }, void> {
  const markers: Marker[] = [];
  const k = Math.max(1, p.stride);
  const samples: number[] = [];
  for (let i = 0; i < o.n; i += k) {
    samples.push(i);
  }
  if (samples[samples.length - 1] !== o.n - 1) {
    samples.push(o.n - 1);
  }

  let state: Sig | null = null;
  let a = -1; // last present sample consistent with state

  const differs = (i: number, st: Sig) => sigDistance(o.sig(i), st) > p.tau;

  for (const b of samples) {
    if (o.present(b)) {
      if (state === null) {
        state = o.sig(b);
        a = b;
      } else if (!differs(b, state)) {
        state = o.sig(b);
        a = b;
      } else {
        // Resolve every change inside (a, b].
        let cur = a; // a present frame known to show curState
        let curState: Sig = state;
        let lastOld = a;
        let linear = false; // after a transient or an absent midpoint, read the rest of the window in order
        for (;;) {
          let c = -1;
          if (!linear) {
            let lo = cur;
            let hi = b;
            while (hi - lo > 1) {
              const mid = (lo + hi) >> 1;
              if (!o.present(mid)) {
                linear = true;
                break;
              }
              if (differs(mid, curState)) {
                hi = mid;
              } else {
                lo = mid;
              }
            }
            if (!linear) {
              c = hi;
              lastOld = lo;
            } else {
              cur = lo;
              lastOld = lo;
            }
          }
          if (linear) {
            for (let j = cur + 1; j <= b; j++) {
              if (!o.present(j)) {
                continue;
              }
              if (differs(j, curState)) {
                c = j;
                break;
              }
              lastOld = j;
            }
          }
          if (c < 0) {
            break; // nothing differs any more inside the window
          }
          if (holds(o, c, p)) {
            const m: Marker = {
              ms: lastOld,
              changeMs: c,
              frameIndex: c,
              anchorIndex: lastOld,
              delta: sigDistance(o.sig(c), curState),
              pass: 1,
            };
            markers.push(m);
            sink?.(m);
            curState = o.sig(c);
            cur = c;
            lastOld = c;
            if (c === b || !differs(b, curState)) {
              break;
            }
          } else {
            // transient at c: keep the old state, keep reading in order after it
            cur = c;
            linear = true;
            if (c === b) {
              break;
            }
          }
        }
        // The state follows b only if b is a confirmed part of the current state.
        if (!differs(b, curState)) {
          state = o.sig(b);
          a = b;
        } else {
          state = curState;
          a = lastOld;
        }
      }
    }
    yield { pass: 1, readTo: b, decodes: o.decodes };
  }
  return { markers };
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

/** F3: a box that never holds (e.g. over a running clock). True when > 50% of consecutive present pairs move. */
export function boxIsMoving(sigs: Sig[], tauHold: number): { moving: boolean; movingFraction: number; jitter: number[] } {
  const jitter: number[] = [];
  for (let i = 1; i < sigs.length; i++) {
    jitter.push(sigDistance(sigs[i], sigs[i - 1]));
  }
  const movingCount = jitter.filter(j => j >= tauHold).length;
  const movingFraction = jitter.length ? movingCount / jitter.length : 0;
  return { moving: movingFraction > 0.5, movingFraction, jitter };
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
