/**
 * One BIF download per open. The video surface is created more than once per open (every Vega Virtual Device run
 * logged "Parsing BIF" twice); each setSurface used to start its own download and parse of the multi-MB BIF.
 */
import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import React from 'react';
import PlayerScreen from '../../src/screens/PlayerScreen';

const mockGetBifFile = jest.fn();
jest.mock('../../src/services/bif/bifService', () => ({
  getBifFile: (url: string) => mockGetBifFile(url),
}));

// The handler's preBufferVideo marks the media initialised, so the (globally mocked) surface view renders and calls
// onSurfaceViewCreated on every render — at least twice per open, as on the device.
jest.mock('../../src/utils/VideoHandler', () => ({
  VideoHandler: jest.fn().mockImplementation((...args: unknown[]) => {
    const videoRef = args[0] as { current: unknown };
    const setIsVideoInitialized = args[3] as CallableFunction;
    return {
      preBufferVideo: () => {
        videoRef.current = {
          setSurfaceHandle: () => {},
          clearSurfaceHandle: () => {},
          setCaptionViewHandle: () => {},
          clearCaptionViewHandle: () => {},
          play: () => Promise.resolve(),
          duration: 60,
        };
        setIsVideoInitialized(true);
      },
      destroyVideoElements: () => {},
    };
  }),
}));
jest.mock('../../src/w3cmedia/mediacontrols/VideoPlayerUI', () => () => null);
jest.mock('../../src/components/BufferingWindow', () => () => null);
jest.mock('@amazon-devices/react-native-safe-area-context', () => ({
  __esModule: true,
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));
jest.mock('@amazon-devices/kepler-content-personalization', () => ({
  __esModule: true,
  ContentPersonalizationServer: { reportNewPlaybackEvent: () => {} },
  PlaybackState: {},
}));
jest.mock('../../src/config/AppConfig', () => ({
  isContentPersonalizationEnabled: () => false,
}));
jest.mock('@amazon-devices/react-native-kepler', () => ({
  __esModule: true,
  useTVEventHandler: () => {},
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  useKeplerAppStateManager: () => ({
    getComponentInstance: () => ({}),
    addAppStateListener: () => ({ remove: () => {} }),
  }),
}));

const surfaces = () =>
  (console.info as jest.Mock).mock.calls.filter((c) => String(c[0]).includes('onSurfaceViewCreated')).length;

const open = async (bifUrl = 'http://127.0.0.1:8000/match.bif') => {
  const route = { key: 'p', name: 'PlayerScreen', params: { data: { id: 't', title: 't', bifUrl } } };
  render(<PlayerScreen navigation={{ goBack: () => {} } as never} route={route as never} />);
  await act(async () => {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
  });
};

beforeEach(() => {
  mockGetBifFile.mockReset();
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('downloads the BIF once although the surface is created more than once', async () => {
  mockGetBifFile.mockReturnValue(
    Promise.resolve({ arrayBuffer: new ArrayBuffer(0), frameImageSource: null, fetchMs: 1 }),
  );
  await open();
  expect(surfaces()).toBeGreaterThanOrEqual(2);
  expect(mockGetBifFile).toHaveBeenCalledTimes(1);
});

it('does not keep a failed download: a later surface tries again', async () => {
  mockGetBifFile.mockReturnValue(Promise.reject(new Error('HTTP error, status = 503')));
  await open();
  expect(surfaces()).toBeGreaterThanOrEqual(2);
  expect(mockGetBifFile.mock.calls.length).toBeGreaterThanOrEqual(2);
});
