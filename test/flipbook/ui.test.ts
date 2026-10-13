import { describe, expect, it } from '@jest/globals';
import { FlipbookApi, thumbnailsAllowedFor, visibleLog } from '../../src/flipbook/app/FlipbookContext';
import { statusText } from '../../src/flipbook/app/FlipbookOverlay';
import { maskRectOnThumbnail, thumbnailDisabled } from '../../src/flipbook/app/FlipbookSeekbarParts';

const base = {
  enabled: true,
  phase: 'scanning',
  mode: 'blind',
  markers: [1, 2, 3, 4, 5, 6].map(i => ({ ms: i * 600000, changeMs: i * 600000 + 10000, frameIndex: i * 60, anchorIndex: i * 60 - 1, delta: 30, pass: 1 })),
  progress: { pass: 1, readToMs: 4320000, decodes: 166, frames: 1084, markers: 6 },
  result: null,
  failure: null,
} as unknown as FlipbookApi;

describe('blind mode leaks nothing', () => {
  const phases = ['scanning', 'ready'] as const;
  for (const phase of phases) {
    it(`status in ${phase} shows a match position only — no count, no decode number`, () => {
      const s = statusText({ ...base, phase } as FlipbookApi)!;
      const text = `${s.head} ${s.detail}`;
      expect(text).not.toMatch(/\d+ CHANGE/i);
      expect(text).not.toMatch(/\b166\b|\b1,?084\b|\b6\b/);
      expect(text).not.toMatch(/skipped/i);
    });
  }
  it('ready after pass 2 still shows no count in blind mode', () => {
    const s = statusText({ ...base, phase: 'ready', result: { frames: 1084, skippedAbsent: 212 } } as unknown as FlipbookApi)!;
    expect(`${s.head} ${s.detail}`).not.toMatch(/212|1,?084|\d+ CHANGE/);
  });
  it('highlights mode adds the count and the frames read', () => {
    const s = statusText({ ...base, mode: 'highlights' } as FlipbookApi)!;
    expect(s.head).toBe('6 CHANGES');
    expect(s.detail).toMatch(/166 of 1084/);
  });
  it('F1: a title without a usable index says so in both modes', () => {
    for (const mode of ['blind', 'highlights']) {
      const s = statusText({ ...base, mode, phase: 'no-index', failure: null } as unknown as FlipbookApi)!;
      expect(s.detail).toBe('No trickplay index for this title');
    }
  });
});

describe('engine log tail in blind mode', () => {
  const lines = [
    'bif fetched bytes=6575564 ms=823',
    'scan start frames=517 rect=0.155,0.868,0.497,0.058',
    'marker anchor=1010000ms change=1020000ms d=32.0 pass=1',
    'pass1 done n=77/517 markers=2 ms=2392',
    'pass2 done n=440 added=0 lost=0 absent=5 ms=6545',
    'seek from=50572ms currentTime=199.1 anchor=229147ms',
    'next: none from 4000000ms',
  ];
  it('blind mode hides every line that reveals change positions or counts', () => {
    const shown = visibleLog(lines, 'blind').join('\n');
    expect(shown).toMatch(/bif fetched/);
    expect(shown).not.toMatch(/marker|markers=|added=|absent=|anchor=|next:/);
  });
  it('highlights mode shows everything', () => {
    expect(visibleLog(lines, 'highlights')).toHaveLength(lines.length);
  });
});

describe('failure lines are identical in both modes', () => {
  it('a moving / off-graphic box says CHECK BOX, nothing else', () => {
    for (const mode of ['blind', 'highlights']) {
      const s = statusText({ ...base, mode, phase: 'ready', failure: 'Box is moving — shrink it off the clock (MENU)' } as unknown as FlipbookApi)!;
      expect(s.head).toBe('CHECK BOX');
      expect(s.detail).not.toMatch(/\d+ CHANGE/);
    }
  });
});

describe('ThumbnailMask — no unmasked thumbnail', () => {
  it('thumbnails stay off for a Flipbook title until a mask exists, whatever the key (FF, RW, RIGHT, hold)', () => {
    const noMask = { enabled: true, thumbnailsAllowed: false };
    for (const skipping of [true, false]) {
      expect(thumbnailDisabled(skipping, noMask)).toBe(true);
    }
    expect(thumbnailDisabled(true, { enabled: true, thumbnailsAllowed: true })).toBe(false);
    // sample behaviour untouched for other titles
    expect(thumbnailDisabled(true, { enabled: false, thumbnailsAllowed: false })).toBe(false);
    expect(thumbnailDisabled(false, { enabled: false, thumbnailsAllowed: false })).toBe(true);
  });

  it('the mask covers the calibrated box (plus margin) on the stretched thumbnail, with and without bars', () => {
    const cases = [
      { area: { top: 0, bottom: 180, left: 0, right: 320 }, width: 320, height: 180 },
      { area: { top: 23, bottom: 163, left: 0, right: 240 }, width: 240, height: 180 },
    ];
    const rects = [
      { x: 0.155, y: 0.868, w: 0.497, h: 0.058 },
      { x: 0.02, y: 0.03, w: 0.3, h: 0.08 },
      { x: 0.7, y: 0.9, w: 0.29, h: 0.09 },
    ];
    for (const c of cases) {
      for (const r of rects) {
        const m = maskRectOnThumbnail(r, c.area, c.width, c.height);
        const aw = c.area.right - c.area.left;
        const ah = c.area.bottom - c.area.top;
        const bx0 = (c.area.left + r.x * aw) / c.width;
        const by0 = (c.area.top + r.y * ah) / c.height;
        const bx1 = (c.area.left + (r.x + r.w) * aw) / c.width;
        const by1 = (c.area.top + (r.y + r.h) * ah) / c.height;
        expect(m.x).toBeLessThanOrEqual(bx0);
        expect(m.y).toBeLessThanOrEqual(by0);
        expect(m.x + m.w).toBeGreaterThanOrEqual(Math.min(1, bx1) - 1e-9);
        expect(m.y + m.h).toBeGreaterThanOrEqual(Math.min(1, by1) - 1e-9);
      }
    }
  });
});

describe('seek thumbnails never show over a box the scan rejected', () => {
  it('a rejected box (moving / not found) or a failed scan turns thumbnails off', () => {
    const ok = { rect: { x: 0.1, y: 0.8, w: 0.5, h: 0.08 }, geometry: {}, failure: null, phase: 'ready' as const };
    expect(thumbnailsAllowedFor(ok)).toBe(true);
    expect(thumbnailsAllowedFor({ ...ok, failure: 'Box is moving — shrink it off the clock (MENU)' })).toBe(false);
    expect(thumbnailsAllowedFor({ ...ok, failure: 'Score graphic not found for most of this match — redraw the box (MENU)' })).toBe(false);
    expect(thumbnailsAllowedFor({ ...ok, phase: 'no-index', failure: 'Scan failed — playback unaffected' })).toBe(false);
    expect(thumbnailsAllowedFor({ ...ok, phase: 'calibrating' })).toBe(false);
    expect(thumbnailsAllowedFor({ ...ok, phase: 'loading' })).toBe(false);
    expect(thumbnailsAllowedFor({ ...ok, rect: null })).toBe(false);
    expect(thumbnailsAllowedFor({ ...ok, geometry: null })).toBe(false);
  });
});
