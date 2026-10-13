/**
 * Regression (Vega Virtual Device, 2026-10-13): while Flipbook took every key for calibration, the player's controls
 * timed out and unmounted the seek bar that holds TV focus; seven DOWN presses then walked focus into the details
 * screen underneath and SELECT opened a related title. The controls now stay mounted while Flipbook captures keys.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { calCardAtTop } from '../../src/flipbook/app/FlipbookOverlay';
import { DISMISS_CONTROLS_DELAY } from '../../src/utils/videoPlayerValues';

// A real context, as in the app: VideoPlayerUI is React.memo'd on its title, so only a context change re-renders it.
jest.mock('../../src/flipbook/app/FlipbookContext', () => {
  const R = require('react');
  const MockFbCtx = R.createContext({ capturesKeys: false });
  return { MockFbCtx, useFlipbook: () => R.useContext(MockFbCtx) };
});
jest.mock('../../src/flipbook/app/FlipbookOverlay', () => ({
  ...(jest.requireActual('../../src/flipbook/app/FlipbookOverlay') as object),
  FlipbookOverlay: () => null,
}));
jest.mock('../../src/components/Seekbar', () => {
  const { Text: T } = require('react-native');
  return {
    __esModule: true,
    default: () => <T testID="seekbar-stub">seek bar</T>,
  };
});
jest.mock('../../src/w3cmedia/mediacontrols/ControlBar', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../src/w3cmedia/mediacontrols/ControlBarMenu', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../src/w3cmedia/mediacontrols/VideoPlayerHeader', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../src/w3cmedia/mediacontrols/PlaybackControls', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@amazon-devices/kepler-content-personalization', () => ({
  __esModule: true,
  ContentPersonalizationServer: jest.fn(),
}));
jest.mock('../../src/config/AppConfig', () => ({
  isRunningOnAutomotive: jest.fn(() => false),
  isContentPersonalizationEnabled: jest.fn(() => false),
}));

import VideoPlayerUI from '../../src/w3cmedia/mediacontrols/VideoPlayerUI';

const { MockFbCtx } = jest.requireMock(
  '../../src/flipbook/app/FlipbookContext',
) as {
  MockFbCtx: React.Context<{ capturesKeys: boolean }>;
};
let mockFbState = { capturesKeys: false };
const ui = () => (
  <MockFbCtx.Provider value={mockFbState}>
    <VideoPlayerUI
      videoRef={{ current: null }}
      title="t"
      navigateBack={() => {}}
      setCaptionStatus={() => {}}
      setSelectedCaptionInVideoPlayer={() => {}}
      bifFrameImagesRef={{ current: null }}
      videoData={{ id: 'x' } as never}
    />
  </MockFbCtx.Provider>
);
const seekBarMounted = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => n.type === Text && n.props.testID === 'seekbar-stub')
    .length > 0;

let tree: ReactTestRenderer;
beforeEach(() => {
  jest.useFakeTimers();
  mockFbState = { capturesKeys: false };
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.useRealTimers();
});

describe('player controls while Flipbook takes the keys', () => {
  it('without Flipbook capturing, the controls (and the seek bar) time out as in the sample', () => {
    act(() => {
      tree = create(ui());
    });
    expect(seekBarMounted(tree)).toBe(true);
    act(() => {
      jest.advanceTimersByTime(DISMISS_CONTROLS_DELAY + 100);
    });
    expect(seekBarMounted(tree)).toBe(false);
  });

  it('while calibrating, the seek bar stays mounted past the timeout, so TV focus cannot leave the player', () => {
    mockFbState = { capturesKeys: true };
    act(() => {
      tree = create(ui());
    });
    act(() => {
      jest.advanceTimersByTime(DISMISS_CONTROLS_DELAY * 3);
    });
    expect(seekBarMounted(tree)).toBe(true);
  });

  it('when calibration ends the controls show again and then time out normally', () => {
    mockFbState = { capturesKeys: true };
    act(() => {
      tree = create(ui());
    });
    act(() => {
      jest.advanceTimersByTime(DISMISS_CONTROLS_DELAY * 2);
    });
    mockFbState = { capturesKeys: false };
    act(() => {
      tree.update(ui());
    });
    expect(seekBarMounted(tree)).toBe(true);
    act(() => {
      jest.advanceTimersByTime(DISMISS_CONTROLS_DELAY + 100);
    });
    expect(seekBarMounted(tree)).toBe(false);
  });
});

describe('calibration card placement', () => {
  it('a box in the lower half (the score graphics we tested) puts the instructions at the top', () => {
    expect(calCardAtTop({ y: 0.87, h: 0.06 })).toBe(true);
    expect(calCardAtTop({ y: 0.8, h: 0.08 })).toBe(true);
  });
  it('a box in the upper half keeps the instructions at the bottom', () => {
    expect(calCardAtTop({ y: 0.05, h: 0.9 })).toBe(false);
    expect(calCardAtTop({ y: 0.04, h: 0.08 })).toBe(false);
  });
});
