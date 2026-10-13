/**
 * The status line sits where the seek bar's preview opens (seen on the Vega Virtual Device: it hid most of the
 * masked thumbnail); it steps aside while the viewer scrubs and comes back after.
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

let mockFb: Record<string, unknown> = {};
jest.mock('../../src/flipbook/app/FlipbookContext', () => ({
  ...(jest.requireActual('../../src/flipbook/app/FlipbookContext') as object),
  useFlipbook: () => mockFb,
}));

import { FlipbookOverlay } from '../../src/flipbook/app/FlipbookOverlay';

const ready = {
  enabled: true,
  phase: 'ready',
  mode: 'blind',
  markers: [],
  progress: { pass: 2, readToMs: 5160000, decodes: 517, frames: 517, markers: 2 },
  result: { frames: 517, skippedAbsent: 5 },
  failure: null,
  toast: null,
  panelOpen: false,
  showLog: false,
  logTail: [],
  scrubbing: false,
};

const statusShown = (scrubbing: boolean) => {
  mockFb = { ...ready, scrubbing };
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FlipbookOverlay controlsVisible />);
  });
  const shown = tree.root.findAll(n => n.props.testID === 'flipbook-status').length > 0;
  act(() => tree.unmount());
  return shown;
};

const toastStyle = (panelOpen: boolean) => {
  mockFb = { ...ready, toast: 'HIGHLIGHTS — changes marked on the bar', panelOpen, panelItems: [], panelIndex: 0 };
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FlipbookOverlay controlsVisible />);
  });
  const node = tree.root.findAll((n) => n.props.testID === 'flipbook-toast')[0];
  const style = StyleSheet.flatten(node.props.style);
  act(() => tree.unmount());
  return style;
};

describe('mode toast vs the options panel', () => {
  it('is centred when the panel is closed', () => {
    expect(toastStyle(false).alignSelf).toBe('center');
  });
  it('moves to the left edge while the panel (right side, same height) is open, so it is never covered', () => {
    const s = toastStyle(true);
    expect(s.alignSelf).toBe('flex-start');
    expect(s.left).toBe('5%');
  });
});

describe('status line vs the seek preview', () => {
  it('shows with the controls when nobody is scrubbing', () => {
    expect(statusShown(false)).toBe(true);
  });
  it('steps aside while the viewer scrubs (the masked preview opens there)', () => {
    expect(statusShown(true)).toBe(false);
  });
});
