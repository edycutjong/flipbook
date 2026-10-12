/**
 * Integration: how the sample's Seekbar wires Flipbook into the KUI SeekBar (props mockCaptured from a mocked KUI).
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, create } from 'react-test-renderer';

const mockCaptured: Record<string, any> = {};
jest.mock('@amazon-devices/kepler-ui-components', () => {
  const R = require('react');
  return {
    SeekBar: R.forwardRef((props: any, _ref: any) => {
      Object.assign(mockCaptured, props);
      return null;
    }),
  };
});

// The Jest environment renders TVFocusGuideView as nothing; pass its children through.
jest.mock('@amazon-devices/react-native-kepler', () => {
  const actual = jest.requireActual('@amazon-devices/react-native-kepler') as Record<string, unknown>;
  const passThrough = ({ children }: { children: unknown }) => children;
  return new Proxy(actual, { get: (t, k) => (k === 'TVFocusGuideView' ? passThrough : t[k as string]) });
});

let mockFbState: any = {};
jest.mock('../../src/flipbook/app/FlipbookContext', () => ({
  useFlipbook: () => mockFbState,
}));

import Seekbar from '../../src/components/Seekbar';

const markers = [
  { ms: 600000, changeMs: 610000, frameIndex: 61, anchorIndex: 60, delta: 30, pass: 1 },
  { ms: 1800000, changeMs: 1810000, frameIndex: 181, anchorIndex: 180, delta: 30, pass: 1 },
];
const base = {
  enabled: true,
  phase: 'ready',
  mode: 'blind',
  markers,
  rect: { x: 0.155, y: 0.868, w: 0.497, h: 0.058 },
  geometry: { area: { top: 0, bottom: 180, left: 0, right: 320 }, width: 320, height: 180 },
  thumbnailsAllowed: true,
  capturesKeys: false,
  ownsSkipKeys: true,
  progress: null,
  result: null,
  log: () => {},
};

let mockLastTree: any = null;
afterEach(() => {
  act(() => mockLastTree?.unmount());
  mockLastTree = null;
});

function render(state: any) {
  mockFbState = state;
  for (const k of Object.keys(mockCaptured)) delete mockCaptured[k];
  const videoRef = { current: { currentTime: 0, duration: 5168, paused: false } } as any;
  let tree: any;
  act(() => {
    tree = create(
      <Seekbar videoRef={videoRef} videoData={{} as any} bifFrameImagesRef={{ current: null }} seekBarRef={{ current: null }} handleShowControlsOnKeyEvent={() => {}} />,
    );
  });
  mockLastTree = tree;
  return tree;
}

describe('Seekbar ↔ KUI SeekBar wiring for Flipbook titles', () => {
  it('blind mode passes NO markers to the SeekBar', () => {
    render(base);
    expect(mockCaptured.currentValue).toBeDefined(); // the KUI SeekBar did render
    expect(mockCaptured.markers).toBeUndefined();
  });

  it('highlights mode passes one tick per change, positioned in seconds at the anchor', () => {
    render({ ...base, mode: 'highlights' });
    expect(mockCaptured.markers.map((m: any) => m.position)).toEqual([600, 1800]);
  });

  it('while Flipbook owns ⏩/⏪ the SeekBar ignores exactly those two keys', () => {
    render(base);
    expect(mockCaptured.partialDisablingConfiguration).toEqual({ skipForward: true, skipBackward: true });
  });

  it('while calibrating / in the panel the SeekBar ignores EVERY key (KUI ignores `disabled` once a partial config exists)', () => {
    render({ ...base, phase: 'calibrating', capturesKeys: true });
    const p = mockCaptured.partialDisablingConfiguration;
    for (const k of ['back', 'playPause', 'skipForward', 'skipBackward', 'left', 'right']) {
      expect(p[k]).toBe(true);
    }
    // select stays focusable; its handlers are removed instead
    expect(p.select).toBeUndefined();
    expect(mockCaptured.onPress).toBeUndefined();
    expect(mockCaptured.onPlayPause).toBeUndefined();
  });

  it('thumbnails are disabled (not skipping) and stretched; the above-thumb renderer carries the mask', () => {
    render(base);
    expect(mockCaptured.disableThumbnail).toBe(true);
    expect(mockCaptured.thumbnailImageResizeMode).toBe('stretch');
    expect(typeof mockCaptured.displayAboveThumb).toBe('function');
  });

  it('before a box exists, thumbnails stay disabled', () => {
    render({ ...base, rect: null, geometry: null, thumbnailsAllowed: false });
    expect(mockCaptured.disableThumbnail).toBe(true);
  });

  it('non-Flipbook titles keep the sample behaviour', () => {
    render({ enabled: false, markers: [], capturesKeys: false, ownsSkipKeys: false, thumbnailsAllowed: true, log: () => {} });
    expect(mockCaptured.markers).toBeUndefined();
    expect(mockCaptured.partialDisablingConfiguration).toBeUndefined();
    expect(mockCaptured.thumbnailImageResizeMode).toBeUndefined();
  });
});
