/**
 * Presence reference for a match. The box is drawn once per broadcaster graphic, but each match has its own
 * team names and scores inside it, so the reference signature is chosen per match: the medoid of a handful of
 * frames spread over the file — the score graphic is on screen most of the time, replays and breaks are not.
 */
import { Sig, sigDistance } from './signature';

export function referenceCandidates(n: number, stride: number, count = 9): number[] {
  const out = new Set<number>();
  for (let q = 1; q <= count; q++) {
    const raw = Math.floor((n * q) / (count + 1));
    out.add(Math.min(n - 1, Math.round(raw / stride) * stride));
  }
  return [...out];
}

/** Index (from `candidates`) whose signature has the most neighbours within `radius`; ties → smallest total distance. */
export function pickReference(candidates: number[], sigOf: (i: number) => Sig, radius: number): number {
  const sigs = candidates.map(i => sigOf(i));
  let best = candidates[0];
  let bestCount = -1;
  let bestSum = Infinity;
  for (let a = 0; a < sigs.length; a++) {
    let count = 0;
    let sum = 0;
    for (let b = 0; b < sigs.length; b++) {
      const d = sigDistance(sigs[a], sigs[b]);
      sum += d;
      if (d <= radius) {
        count++;
      }
    }
    if (count > bestCount || (count === bestCount && sum < bestSum)) {
      best = candidates[a];
      bestCount = count;
      bestSum = sum;
    }
  }
  return best;
}
