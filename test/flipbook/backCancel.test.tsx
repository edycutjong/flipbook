/**
 * BACK in calibration cancels, it never confirms (TV convention; outside judge review, 2026-10-15). With a confirmed
 * box the viewer gets that box back; on a first calibration Flipbook stays off and saves nothing.
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
  useFlipbook,
} from '../../src/flipbook/app/FlipbookContext';
import { statusText } from '../../src/flipbook/app/FlipbookOverlay';
import { buildBif, frameJpeg } from './helpers';

const mockHandlers: Array<(e: unknown) => void> = [];
const mockBack: Array<() => boolean> = [];
jest.mock('@amazon-devices/react-native-kepler', () => ({
  __esModule: true,
  useTVEventHandler: (handler: (e: unknown) => void) => {
    mockHandlers.push(handler);
  },
  BackHandler: {
    addEventListener: (_: string, fn: () => boolean) => {
      mockBack.push(fn);
      return {
        remove: () => {
          const i = mockBack.indexOf(fn);
          if (i >= 0) {
            mockBack.splice(i, 1);
          }
        },
      };
    },
  },
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

const key = (eventType: string) =>
  act(() => {
    mockHandlers[mockHandlers.length - 1]({
      eventType,
      eventKeyAction: EVENT_KEY_UP,
    });
  });

/** BACK as the platform delivers it: the latest registered listener; returns whether it was consumed. */
const back = () => {
  let consumed = false;
  act(() => {
    const fn = mockBack[mockBack.length - 1];
    consumed = fn ? fn() : false;
  });
  return consumed;
};

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
  });

let tree: ReactTestRenderer;
let video: { paused: boolean; pause: jest.Mock; play: jest.Mock; currentTime: number };
async function mountCalibrating() {
  video = { paused: true, pause: jest.fn(), play: jest.fn(), currentTime: 0 };
  act(() => {
    tree = create(
      <FlipbookProvider config={config} videoRef={{ current: video } as never}>
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

async function untilScanDone() {
  for (let i = 0; i < 20 && !api.result; i++) {
    await flush();
  }
  expect(api.result).not.toBeNull();
}

/** MENU → down to "Redraw score box" → SELECT. */
function openRedraw() {
  key('menu');
  const steps = api.panelItems.indexOf('box');
  for (let i = 0; i < steps; i++) {
    key('down');
  }
  act(() => api.select());
}

beforeEach(async () => {
  mockBack.length = 0;
  await AsyncStorage.clear();
  jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

describe('BACK in calibration', () => {
  it('first calibration: BACK cancels — no box, nothing saved, thumbnails and the skip keys stay with the player', async () => {
    await mountCalibrating();
    key('right'); // a nudge that must not be saved
    expect(back()).toBe(true); // consumed: it does not leave the player
    await flush();
    expect(api.phase).toBe('no-box');
    expect(api.rect).toBeNull();
    expect(api.thumbnailsAllowed).toBe(false);
    expect(api.ownsSkipKeys).toBe(false);
    expect(api.capturesKeys).toBe(false);
    expect(await AsyncStorage.getItem('flipbook.rect.test-broadcaster')).toBeNull();
    expect(video.play).toHaveBeenCalled();
    expect(statusText(api)).toEqual({ head: 'NO BOX', detail: 'MENU → Redraw score box to turn Flipbook on' });
    expect(mockBack.length).toBe(0); // the next BACK is the player's again
  });

  it('after a cancelled first calibration, MENU → Redraw score box calibrates again', async () => {
    await mountCalibrating();
    back();
    openRedraw();
    expect(api.phase).toBe('calibrating');
    expect(api.rect).toEqual(config.defaultRect);
  });

  it('redraw: BACK restores the confirmed box and its markers, and leaves the saved box alone', async () => {
    await mountCalibrating();
    key('playpause'); // confirm the default box
    await untilScanDone();
    const confirmed = api.rect;
    const markers = api.markers;
    const saved = await AsyncStorage.getAllKeys().then((k) => AsyncStorage.multiGet(k));
    openRedraw();
    expect(api.phase).toBe('calibrating');
    key('right');
    key('right');
    expect(api.rect).not.toEqual(confirmed);
    back();
    await flush();
    expect(api.phase).toBe('ready');
    expect(api.rect).toEqual(confirmed);
    expect(api.markers).toBe(markers);
    expect(api.thumbnailsAllowed).toBe(true);
    expect(await AsyncStorage.getAllKeys().then((k) => AsyncStorage.multiGet(k))).toEqual(saved);
  });

  it('PLAY/PAUSE still confirms', async () => {
    await mountCalibrating();
    key('playpause');
    await flush();
    expect(['scanning', 'ready']).toContain(api.phase);
    expect(api.rect).toEqual(config.defaultRect);
  });
});
