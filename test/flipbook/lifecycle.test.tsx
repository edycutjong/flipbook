/**
 * A BIF that lands after the player unmounted (BACK, HOME, or a play() failure → navigateBack) must start nothing:
 * PlayerScreen's surface callback still holds the provider's attachBif when the download settles.
 */
import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import {
  FlipbookApi,
  FlipbookProvider,
  useFlipbook,
} from '../../src/flipbook/app/FlipbookContext';
import { buildBif, frameJpeg } from './helpers';

jest.mock('@amazon-devices/react-native-kepler', () => ({
  __esModule: true,
  useTVEventHandler: () => {},
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
}));

const config = {
  source: 'lifecycle-test',
  defaultRect: { x: 0.04, y: 0.04, w: 0.33, h: 0.13 },
};
const bif = () =>
  buildBif(
    Array.from({ length: 60 }, (_, i) => frameJpeg(i < 30 ? 0 : 1, { seed: i + 1 })),
  );
const lines: string[] = [];
let api: FlipbookApi;
const Probe = () => {
  api = useFlipbook();
  return null;
};
const ticks = async (n: number) => {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};
const mount = () => {
  let tree!: ReactTestRenderer;
  const videoRef = {
    current: { paused: false, pause: jest.fn(), play: jest.fn(), currentTime: 0 },
  } as never;
  act(() => {
    tree = create(
      <FlipbookProvider config={config} videoRef={videoRef}>
        <Probe />
      </FlipbookProvider>,
    );
  });
  return tree;
};

beforeEach(async () => {
  lines.length = 0;
  await AsyncStorage.clear();
  // A returning viewer: the saved box sends a late attach straight into a scan.
  await AsyncStorage.setItem(`flipbook.rect.${config.source}`, JSON.stringify(config.defaultRect));
  jest.spyOn(console, 'info').mockImplementation((l: unknown) => {
    lines.push(String(l));
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('a BIF that lands after the player unmounted starts nothing', async () => {
  const tree = mount();
  const lateAttach = api.attachBif; // what PlayerScreen's flipbookAttachRef still holds
  act(() => tree.unmount());
  lateAttach(bif(), 5);
  await ticks(400);
  expect(lines.filter((l) => /box restored|scan start|pass2 done|calibrate on/.test(l))).toEqual([]);
});

it('a scan running at unmount is still cancelled', async () => {
  const tree = mount();
  act(() => api.attachBif(bif(), 5));
  await ticks(3);
  act(() => tree.unmount());
  await ticks(400);
  expect(lines.some((l) => l.includes('scan start'))).toBe(true);
  expect(lines.some((l) => l.includes('pass2 done'))).toBe(false);
});
