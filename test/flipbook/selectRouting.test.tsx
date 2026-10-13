/**
 * Regression (Vega Virtual Device, 2026-10-13): SELECT never reaches useTVEventHandler on the device — the platform
 * consumes it as a press on the focused view — so the calibration resize toggle and the options panel did nothing.
 * The seek bar now forwards its press to `select()`; these tests drive the provider the way the device does.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { EVENT_KEY_UP } from '../../src/constants';
import {
  FlipbookApi,
  FlipbookProvider,
  SELECT_DEDUPE_MS,
  useFlipbook,
} from '../../src/flipbook/app/FlipbookContext';
import { buildBif, frameJpeg } from './helpers';

// The provider registers BACK while it takes the keys; the global Kepler mock has no BackHandler.
const mockHandlers: Array<(e: unknown) => void> = [];
jest.mock('@amazon-devices/react-native-kepler', () => ({
  __esModule: true,
  useTVEventHandler: (handler: (e: unknown) => void) => {
    mockHandlers.push(handler);
  },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
}));

const config = {
  source: 'test-broadcaster',
  defaultRect: { x: 0.1, y: 0.8, w: 0.5, h: 0.08 },
};
let api: FlipbookApi;
const Probe = () => {
  api = useFlipbook();
  return null;
};

/** Calls the key handler from the provider's latest render, as the platform would. */
const key = (eventType: string) =>
  act(() => {
    mockHandlers[mockHandlers.length - 1]({
      eventType,
      eventKeyAction: EVENT_KEY_UP,
    });
  });

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
  });

let tree: ReactTestRenderer;
async function mountCalibrating() {
  const videoRef = {
    current: {
      paused: true,
      pause: jest.fn(),
      play: jest.fn(),
      currentTime: 0,
    },
  } as never;
  act(() => {
    tree = create(
      <FlipbookProvider config={config} videoRef={videoRef}>
        <Probe />
      </FlipbookProvider>,
    );
  });
  const frames = [0, 0, 0, 0, 1, 1, 1, 1].map((s, i) =>
    frameJpeg(s, { seed: i + 1 }),
  );
  act(() => api.attachBif(buildBif(frames), 5));
  await flush();
  expect(api.phase).toBe('calibrating');
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

describe('SELECT while Flipbook takes the keys', () => {
  it('calibration: a seek-bar press toggles resize, so UP then shrinks the box instead of moving it', async () => {
    await mountCalibrating();
    const before = api.rect!;
    act(() => api.select());
    expect(api.resizing).toBe(true);
    key('up');
    expect(api.rect!.y).toBeCloseTo(before.y, 6);
    expect(api.rect!.h).toBeCloseTo(before.h - 0.01, 6);
  });

  it('one SELECT delivered twice (press, then key event) toggles once', async () => {
    await mountCalibrating();
    act(() => api.select());
    key('select');
    expect(api.resizing).toBe(true);
  });

  it('two presses further apart than the de-duplication window both count', async () => {
    await mountCalibrating();
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    act(() => api.select());
    now.mockReturnValue(1_000_000 + SELECT_DEDUPE_MS + 1);
    act(() => api.select());
    expect(api.resizing).toBe(false);
  });

  it('options panel: a seek-bar press on "Mode" switches blind → highlights', async () => {
    await mountCalibrating();
    key('playpause'); // confirm the box → scan starts
    await flush();
    key('menu');
    expect(api.panelOpen).toBe(true);
    expect(api.mode).toBe('blind');
    act(() => api.select());
    expect(api.mode).toBe('highlights');
  });

  it('outside calibration and the panel, select() does nothing', async () => {
    await mountCalibrating();
    key('playpause');
    await flush();
    const mode = api.mode;
    act(() => api.select());
    expect(api.mode).toBe(mode);
    expect(api.panelOpen).toBe(false);
  });
});
