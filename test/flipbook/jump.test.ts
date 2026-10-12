import { describe, expect, it } from '@jest/globals';
import { formatClock, jumpTargetMs, nextJump, prevJump } from '../../src/flipbook/core';

const anchors = [600_000, 2_051_000, 4_000_000];
const LEAD = 30_000;

describe('jump targets (⏩ / ⏪ in Flipbook mode)', () => {
  it('⏩ goes to anchor − leadIn of the first change ahead', () => {
    expect(nextJump(anchors, 0, LEAD)?.targetMs).toBe(570_000);
    expect(nextJump(anchors, 600_000, LEAD)?.targetMs).toBe(2_021_000);
  });

  it('⏩ inside a lead-in window advances to the next change instead of re-seeking', () => {
    expect(nextJump(anchors, 570_000, LEAD)?.markerIndex).toBe(1);
    expect(nextJump(anchors, 569_500, LEAD)?.markerIndex).toBe(1); // within the 1 s minimum
  });

  it('⏩ after the last change returns null (UI says "No later change", never wraps)', () => {
    expect(nextJump(anchors, 3_990_000, LEAD)).toBeNull();
    expect(nextJump([], 0, LEAD)).toBeNull();
  });

  it('⏪ shortly after a jump goes to the previous change, not the same one', () => {
    // just jumped to 2_021_000 and watched 5 s
    expect(prevJump(anchors, 2_026_000, LEAD)?.markerIndex).toBe(0);
    expect(prevJump(anchors, 2_200_000, LEAD)?.markerIndex).toBe(1);
    expect(prevJump(anchors, 500_000, LEAD)).toBeNull();
  });

  it('never seeks before 0', () => {
    expect(jumpTargetMs(10_000, LEAD)).toBe(0);
  });

  it('formats match positions', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(2_050_000)).toBe('34:10');
    expect(formatClock(4_320_000)).toBe('1:12:00');
  });
});
