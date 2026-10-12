/**
 * Jump targets for the remote's skip keys (the Jump step). Pure functions over marker anchors.
 *
 * ⏩ goes to the first marker whose target (anchor − leadIn) is more than `minAheadMs` ahead, so pressing it
 * inside a lead-in window advances to the next change instead of re-seeking to the same one.
 * ⏪ goes to the last marker whose target is more than `graceMs` behind, so pressing it shortly after a jump
 * goes to the previous change (DVD-chapter behaviour), not back to the start of the same lead-in.
 */

export const DEFAULT_LEAD_IN_MS = 30_000;

export interface JumpTarget {
  targetMs: number;
  markerIndex: number;
  anchorMs: number;
}

export function jumpTargetMs(anchorMs: number, leadInMs: number): number {
  return Math.max(0, anchorMs - leadInMs);
}

export function nextJump(
  anchorsMs: readonly number[],
  currentMs: number,
  leadInMs = DEFAULT_LEAD_IN_MS,
  minAheadMs = 1000,
): JumpTarget | null {
  for (let i = 0; i < anchorsMs.length; i++) {
    const t = jumpTargetMs(anchorsMs[i], leadInMs);
    if (t > currentMs + minAheadMs) {
      return { targetMs: t, markerIndex: i, anchorMs: anchorsMs[i] };
    }
  }
  return null;
}

export function prevJump(
  anchorsMs: readonly number[],
  currentMs: number,
  leadInMs = DEFAULT_LEAD_IN_MS,
  graceMs = 10_000,
): JumpTarget | null {
  for (let i = anchorsMs.length - 1; i >= 0; i--) {
    const t = jumpTargetMs(anchorsMs[i], leadInMs);
    if (t < currentMs - graceMs) {
      return { targetMs: t, markerIndex: i, anchorMs: anchorsMs[i] };
    }
  }
  return null;
}

/** "1:12:00" / "34:10" — the only position format blind mode shows. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
}
