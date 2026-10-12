/**
 * Flipbook player state: Open → Scan → Jump.
 *
 * Owns the BIF corpus for one title, the calibration box, the two-pass scan, the blind/highlights mode, and the
 * remote's skip keys while Flipbook is on. Mounted by PlayerScreen around the sample's player UI.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BackHandler, HWEvent, useTVEventHandler } from '@amazon-devices/react-native-kepler';
import { VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { EVENT_KEY_UP } from '../../constants';
import {
  BifIndex,
  boxIsMoving,
  DEFAULT_LEAD_IN_MS,
  DetectorParams,
  DEFAULT_PARAMS,
  describeBifError,
  formatClock,
  frameBytes,
  makePreviewAsync,
  probeArea,
  PictureArea,
  nextJump,
  NormRect,
  prevJump,
  readBif,
  scanBif,
  ScanProgress,
  ScanResult,
  Sig,
  sigDistance,
  TimedMarker,
} from '../core';

export type FlipbookMode = 'blind' | 'highlights';
export type FlipbookPhase = 'off' | 'loading' | 'no-index' | 'calibrating' | 'scanning' | 'ready';
export type BoxState = 'steady' | 'moving';

/** Per-title Flipbook settings (TitleData.flipbook). */
export interface FlipbookTitleConfig {
  /** Broadcaster graphic the box belongs to; one calibration per source. */
  source: string;
  /** Where the box starts the first time (the viewer moves it onto the score graphic and confirms). */
  defaultRect: NormRect;
  leadInMs?: number;
  params?: Partial<DetectorParams>;
  /** Play the title muted (e.g. original commentary we do not publish). */
  muteAudio?: boolean;
}

const FF_KEYS = new Set(['skip_forward', 'fastforward', 'forward']);
const RW_KEYS = new Set(['skip_backward', 'rewind']);
const PANEL_ITEMS = ['mode', 'box', 'log', 'close'] as const;
export type PanelItem = (typeof PANEL_ITEMS)[number];

const STEP = 0.01; // box nudge, fraction of the picture
const PREVIEW_FRAMES = 30;
const LOG_LINES = 8;

export interface FlipbookApi {
  enabled: boolean;
  phase: FlipbookPhase;
  mode: FlipbookMode;
  rect: NormRect | null;
  resizing: boolean;
  boxState: BoxState | null;
  markers: TimedMarker[];
  progress: ScanProgress | null;
  result: ScanResult | null;
  pass1: { decodes: number; ms: number } | null;
  failure: string | null;
  toast: string | null;
  logTail: string[];
  showLog: boolean;
  panelOpen: boolean;
  panelIndex: number;
  panelItems: readonly PanelItem[];
  persistence: 'saved' | 'session' | null;
  leadInMs: number;
  /** Calibration backdrop: an early BIF frame showing the graphic, and where its picture sits inside it. */
  backdrop: { jpeg: Uint8Array; area: PictureArea; width: number; height: number } | null;
  /** Picture area of this BIF's frames (for the thumbnail mask). */
  geometry: { area: PictureArea; width: number; height: number } | null;
  /** True while Flipbook takes every key (calibration, options panel). */
  capturesKeys: boolean;
  /** True when Flipbook owns ⏩/⏪ (the SeekBar must ignore them). */
  ownsSkipKeys: boolean;
  /** Thumbnails stay off until a mask exists (calibrated box). */
  thumbnailsAllowed: boolean;
  attachBif: (buffer: ArrayBuffer, fetchMs: number, durationMs?: number) => void;
  log: (line: string) => void;
}

const disabledApi: FlipbookApi = {
  enabled: false,
  phase: 'off',
  mode: 'blind',
  rect: null,
  resizing: false,
  boxState: null,
  markers: [],
  progress: null,
  result: null,
  pass1: null,
  failure: null,
  toast: null,
  logTail: [],
  showLog: false,
  panelOpen: false,
  panelIndex: 0,
  panelItems: PANEL_ITEMS,
  persistence: null,
  leadInMs: DEFAULT_LEAD_IN_MS,
  backdrop: null,
  geometry: null,
  capturesKeys: false,
  ownsSkipKeys: false,
  thumbnailsAllowed: true,
  attachBif: () => {},
  log: () => {},
};

const FlipbookCtx = createContext<FlipbookApi>(disabledApi);
export const useFlipbook = () => useContext(FlipbookCtx);

/** Index of the signature with the smallest total distance to the others (the most typical early frame). */
function mostTypical(sigs: Sig[]): number {
  let best = 0;
  let bestSum = Infinity;
  for (let a = 0; a < sigs.length; a++) {
    let sum = 0;
    for (let b = 0; b < sigs.length; b++) {
      sum += sigDistance(sigs[a], sigs[b]);
    }
    if (sum < bestSum) {
      best = a;
      bestSum = sum;
    }
  }
  return best;
}

const rectKey = (source: string) => `flipbook.rect.${source}`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function clampRect(r: NormRect): NormRect {
  const w = Math.max(0.02, Math.min(1, r.w));
  const h = Math.max(0.02, Math.min(1, r.h));
  return { x: clamp01(Math.min(r.x, 1 - w)), y: clamp01(Math.min(r.y, 1 - h)), w, h };
}

export const FlipbookProvider = ({
  config,
  videoRef,
  children,
}: {
  config?: FlipbookTitleConfig;
  videoRef: React.MutableRefObject<VideoPlayer | null>;
  children: React.ReactNode;
}) => {
  const enabled = !!config;
  const [phase, setPhase] = useState<FlipbookPhase>(enabled ? 'loading' : 'off');
  const [mode, setMode] = useState<FlipbookMode>('blind');
  const [rect, setRect] = useState<NormRect | null>(null);
  const [resizing, setResizing] = useState(false);
  const [boxState, setBoxState] = useState<BoxState | null>(null);
  const [markers, setMarkers] = useState<TimedMarker[]>([]);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [pass1, setPass1] = useState<{ decodes: number; ms: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [logTail, setLogTail] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelIndex, setPanelIndex] = useState(0);
  const [persistence, setPersistence] = useState<'saved' | 'session' | null>(null);
  const [backdrop, setBackdrop] = useState<FlipbookApi['backdrop']>(null);
  const [geometry, setGeometry] = useState<FlipbookApi['geometry']>(null);

  const leadInMs = config?.leadInMs ?? DEFAULT_LEAD_IN_MS;
  const params = useMemo<DetectorParams>(() => ({ ...DEFAULT_PARAMS, ...(config?.params || {}) }), [config]);

  const bifRef = useRef<{ buffer: ArrayBuffer; index: BifIndex } | null>(null);
  const scanIdRef = useRef(0);
  const markersRef = useRef<TimedMarker[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<((r: NormRect) => BoxState) | null>(null);
  const lastProgressAt = useRef(0);

  const log = useCallback((line: string) => {
    const stamped = `[flipbook] ${line}`;
    console.info(stamped);
    setLogTail(prev => [...prev.slice(-(LOG_LINES - 1)), line]);
  }, []);

  const showToast = useCallback((text: string, ms = 2000) => {
    setToast(text);
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  useEffect(
    () => () => {
      scanIdRef.current++; // cancels a running scan
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
      }
    },
    [],
  );

  const startScan = useCallback(
    async (r: NormRect) => {
      const bif = bifRef.current;
      if (!bif) {
        return;
      }
      const id = ++scanIdRef.current;
      markersRef.current = [];
      setMarkers([]);
      setResult(null);
      setPass1(null);
      setPhase('scanning');
      log(`scan start frames=${bif.index.frameCount} rect=${r.x.toFixed(3)},${r.y.toFixed(3)},${r.w.toFixed(3)},${r.h.toFixed(3)}`);
      try {
        const res = await scanBif({
          buffer: bif.buffer,
          index: bif.index,
          rect: r,
          refFrame: 'auto',
          params,
          isCancelled: () => scanIdRef.current !== id,
          log,
          onProgress: p => {
            const now = Date.now();
            if (now - lastProgressAt.current > 200) {
              lastProgressAt.current = now;
              setProgress(p);
            }
          },
          onMarker: m => {
            if (scanIdRef.current !== id) {
              return;
            }
            log(`marker anchor=${Math.round(m.ms)}ms change=${Math.round(m.changeMs)}ms d=${m.delta.toFixed(1)} pass=${m.pass}`);
            const next = [...markersRef.current.filter(x => x.frameIndex !== m.frameIndex), m].sort((a, b) => a.ms - b.ms);
            markersRef.current = next;
            setMarkers(next);
          },
          onPass1Done: p => {
            if (scanIdRef.current === id) {
              setPass1({ decodes: p.decodes, ms: p.ms });
              setPhase('ready');
            }
          },
        });
        if (scanIdRef.current !== id || res.cancelled) {
          return;
        }
        markersRef.current = res.markers;
        setMarkers(res.markers);
        setResult(res);
        setProgress({ pass: 2, readToMs: bif.index.timeMs[bif.index.frameCount - 1], decodes: res.jpegDecodes, frames: res.frames, markers: res.markers.length });
        setPhase('ready');
        log(`thumb mode=${'overlay'} video bytes decoded=${res.videoBytesDecoded}`);
      } catch (e) {
        log(`scan failed: ${String(e)}`);
        setFailure('Scan failed — playback unaffected');
        setPhase('no-index');
      }
    },
    [log, params],
  );

  const enterCalibration = useCallback(
    (initial: NormRect) => {
      const bif = bifRef.current;
      if (!bif) {
        return;
      }
      scanIdRef.current++;
      const id = scanIdRef.current;
      setRect(clampRect(initial));
      setResizing(false);
      setBoxState(null);
      setPhase('calibrating');
      // Live preview (F3): the first frames decoded once, in small chunks; each nudge only re-crops them.
      makePreviewAsync(bif.buffer, bif.index, PREVIEW_FRAMES, params.stride)
        .then(preview => {
          if (scanIdRef.current !== id) {
            return;
          }
          previewRef.current = (r: NormRect) => (boxIsMoving(preview.sigsFor(r), params).moving ? 'moving' : 'steady');
          // Backdrop = the most typical of the first frames (graphic on screen, early in the match: no later score).
          const early = preview.sigsFor(clampRect(initial));
          const pick = mostTypical(early);
          setBackdrop({ jpeg: frameBytes(bif.buffer, bif.index, pick), area: preview.area, width: preview.width, height: preview.height });
          log(`calibrate on frame=${pick} (${formatClock(bif.index.timeMs[pick])})`);
          setBoxState(previewRef.current(clampRect(initial)));
        })
        .catch(e => log(`calibration preview failed: ${String(e)}`));
    },
    [log, params],
  );

  const attachBif = useCallback(
    (buffer: ArrayBuffer, fetchMs: number, durationMs?: number) => {
      if (!config) {
        return;
      }
      if (bifRef.current) {
        // The player can recreate its surface; the BIF for this title is already attached.
        log('bif already attached — ignoring a second fetch');
        return;
      }
      log(`bif fetched bytes=${buffer.byteLength} ms=${Math.round(fetchMs)}`);
      const r = readBif(buffer, { durationMs });
      if (!r.ok) {
        const why = describeBifError(r.error);
        log(`no index: ${why}`);
        setFailure('No trickplay index for this title');
        setPhase('no-index');
        return;
      }
      bifRef.current = { buffer, index: r.index };
      log(`bif frames=${r.index.frameCount} interval=${r.index.intervalMs}ms (${r.index.intervalSource})`);
      try {
        const g = probeArea(buffer, r.index, params.stride);
        setGeometry(g);
        log(`picture area rows ${g.area.top}-${g.area.bottom - 1} cols ${g.area.left}-${g.area.right - 1} of ${g.width}x${g.height}`);
      } catch (e) {
        log(`frame decode failed: ${String(e)}`);
        setFailure('No trickplay index for this title');
        setPhase('no-index');
        return;
      }
      AsyncStorage.getItem(rectKey(config.source))
        .then(saved => {
          if (saved) {
            const parsed = clampRect(JSON.parse(saved));
            setRect(parsed);
            setPersistence('saved');
            log(`box restored for ${config.source}`);
            startScan(parsed);
          } else {
            enterCalibration(config.defaultRect);
          }
        })
        .catch(() => enterCalibration(config.defaultRect));
    },
    [config, enterCalibration, log, params.stride, startScan],
  );

  const confirmBox = useCallback(() => {
    if (!config || !rect) {
      return;
    }
    previewRef.current = null;
    setBoxState(null);
    AsyncStorage.setItem(rectKey(config.source), JSON.stringify(rect))
      .then(() => {
        setPersistence('saved');
        log(`box saved for ${config.source}`);
      })
      .catch(e => {
        setPersistence('session');
        log(`box kept for this session only (${String(e)})`);
      });
    startScan(rect);
  }, [config, log, rect, startScan]);

  const nudge = useCallback(
    (dx: number, dy: number) => {
      setRect(prev => {
        if (!prev) {
          return prev;
        }
        const next = clampRect(
          resizing ? { ...prev, w: prev.w + dx, h: prev.h + dy } : { ...prev, x: prev.x + dx, y: prev.y + dy },
        );
        if (previewRef.current) {
          try {
            setBoxState(previewRef.current(next));
          } catch {
            setBoxState(null);
          }
        }
        return next;
      });
    },
    [resizing],
  );

  const jump = useCallback(
    (dir: 1 | -1) => {
      const v = videoRef.current;
      if (!v) {
        return;
      }
      const anchors = markersRef.current.map(m => m.ms);
      const cur = (v.currentTime || 0) * 1000;
      const t = dir > 0 ? nextJump(anchors, cur, leadInMs) : prevJump(anchors, cur, leadInMs);
      if (!t) {
        const scanning = phase === 'scanning';
        showToast(dir > 0 ? (scanning ? 'Still reading — no later change yet' : 'No later change') : 'No earlier change');
        log(`${dir > 0 ? 'next' : 'prev'}: none from ${Math.round(cur)}ms`);
        return;
      }
      log(`seek from=${Math.round(cur)}ms currentTime=${(t.targetMs / 1000).toFixed(1)} anchor=${Math.round(t.anchorMs)}ms`);
      v.currentTime = t.targetMs / 1000;
      if (v.paused) {
        v.play();
      }
      showToast(`→ ${formatClock(t.targetMs)}  (−${Math.round(leadInMs / 1000)} s lead-in)`);
      setTimeout(() => {
        if (videoRef.current) {
          log(`after seek currentTime=${(videoRef.current.currentTime || 0).toFixed(1)}`);
        }
      }, 1500);
    },
    [leadInMs, log, phase, showToast, videoRef],
  );

  const activatePanelItem = useCallback(
    (item: PanelItem) => {
      switch (item) {
        case 'mode': {
          const next = mode === 'blind' ? 'highlights' : 'blind';
          setMode(next);
          showToast(next === 'blind' ? 'BLIND — no ticks, no counts' : 'HIGHLIGHTS — changes marked on the bar');
          log(`mode=${next}`);
          break;
        }
        case 'box':
          setPanelOpen(false);
          enterCalibration(rect || config!.defaultRect);
          break;
        case 'log':
          setShowLog(s => !s);
          break;
        case 'close':
          setPanelOpen(false);
          break;
      }
    },
    [config, enterCalibration, log, mode, rect, showToast],
  );

  const capturesKeys = enabled && (phase === 'calibrating' || panelOpen);

  useTVEventHandler((evt: HWEvent) => {
    if (!enabled || !evt || evt.eventKeyAction !== EVENT_KEY_UP) {
      return;
    }
    const k = evt.eventType;
    if (phase === 'calibrating') {
      if (k === 'up') nudge(0, -STEP);
      else if (k === 'down') nudge(0, STEP);
      else if (k === 'left') nudge(-STEP, 0);
      else if (k === 'right') nudge(STEP, 0);
      else if (k === 'select') setResizing(r => !r);
      else if (k === 'playpause' || k === 'play' || k === 'pause') confirmBox();
      return;
    }
    if (panelOpen) {
      if (k === 'up') setPanelIndex(i => (i + PANEL_ITEMS.length - 1) % PANEL_ITEMS.length);
      else if (k === 'down') setPanelIndex(i => (i + 1) % PANEL_ITEMS.length);
      else if (k === 'select') activatePanelItem(PANEL_ITEMS[panelIndex]);
      else if (k === 'menu') setPanelOpen(false);
      return;
    }
    if (k === 'menu') {
      setPanelIndex(0);
      setPanelOpen(true);
      return;
    }
    if (phase === 'scanning' || phase === 'ready') {
      if (FF_KEYS.has(k)) {
        jump(1);
      } else if (RW_KEYS.has(k)) {
        jump(-1);
      }
    }
  });

  // BACK closes the panel / leaves calibration instead of leaving the player.
  useEffect(() => {
    if (!capturesKeys) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (panelOpen) {
        setPanelOpen(false);
      } else if (phase === 'calibrating') {
        confirmBox();
      }
      return true;
    });
    return () => sub.remove();
  }, [capturesKeys, confirmBox, panelOpen, phase]);

  const api: FlipbookApi = enabled
    ? {
        enabled,
        phase,
        mode,
        rect,
        resizing,
        boxState,
        markers,
        progress,
        result,
        pass1,
        failure,
        toast,
        logTail,
        showLog,
        panelOpen,
        panelIndex,
        panelItems: PANEL_ITEMS,
        persistence,
        leadInMs,
        backdrop,
        geometry,
        capturesKeys,
        ownsSkipKeys: phase === 'scanning' || phase === 'ready' || phase === 'calibrating',
        thumbnailsAllowed: !!rect && !!geometry && phase !== 'calibrating' && phase !== 'loading',
        attachBif,
        log,
      }
    : disabledApi;

  return <FlipbookCtx.Provider value={api}>{children}</FlipbookCtx.Provider>;
};
