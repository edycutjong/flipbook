/**
 * scanBif — the Open → Scan step. Runs pass 1 (sprocket + bisect) then pass 2 (verify) over a BIF buffer,
 * yielding to the JS thread every `batchDecodes` decodes so the remote stays responsive on the device.
 * The same function runs in the app (Vega JS runtime) and in Node (tests, bench) — the bench measures the shipped code.
 */
import { BifIndex, frameBytes } from './bifIndex';
import {
  DEFAULT_PARAMS,
  DetectorParams,
  FrameOracle,
  Marker,
  mergePasses,
  PassProgress,
  sequentialPass,
  sprocketPass,
} from './detector';
import { decodeLuma, LumaFrame, medianPictureArea, PictureArea, pictureAreaOf } from './luma';
import { DEFAULT_GRID, NormRect, Sig, signature } from './signature';

export interface TimedMarker extends Marker {
  /** Anchor time, ms (jump target = ms − leadIn). */
  ms: number;
  /** First frame with the new score, ms. */
  changeMs: number;
}

export interface ScanProgress {
  pass: 1 | 2;
  /** Position in the match the scan has read to, ms (blind mode shows only this). */
  readToMs: number;
  /** Frames decoded so far (highlights mode / log tail only). */
  decodes: number;
  frames: number;
  markers: number;
}

export interface ScanResult {
  frames: number;
  intervalMs: number;
  intervalSource: BifIndex['intervalSource'];
  rect: NormRect;
  refFrame: number;
  /** Fraction of grid cells kept by the jitter mask. */
  maskKept: number;
  area: PictureArea;
  frameSize: { width: number; height: number };
  markers: TimedMarker[];
  pass1: { decodes: number; ms: number; markers: number };
  pass2: { decodes: number; ms: number; added: number };
  /** Pass-1 markers pass 2 did not reproduce (invariant: 0). */
  lostFromPass1: number;
  skippedAbsent: number;
  jpegDecodes: number;
  params: DetectorParams;
  /** Flipbook only ever decodes BIF thumbnail JPEGs. */
  videoBytesDecoded: 0;
  cancelled: boolean;
}

export interface ScanOptions {
  buffer: ArrayBuffer;
  index: BifIndex;
  rect: NormRect;
  /** Presence reference frame, or 'auto' = medoid of 9 frames spread over the file (see reference.ts). */
  refFrame: number | 'auto';
  params?: Partial<DetectorParams>;
  batchDecodes?: number;
  /** Skip pass 2 (bench ablations, tests). */
  pass1Only?: boolean;
  now?: () => number;
  /** Yield to the event loop; defaults to setTimeout(0). Node bench can pass a no-op. */
  yieldFn?: () => Promise<void>;
  isCancelled?: () => boolean;
  onProgress?: (p: ScanProgress) => void;
  onMarker?: (m: TimedMarker) => void;
  onPass1Done?: (r: { decodes: number; ms: number; markers: TimedMarker[] }) => void;
  log?: (line: string) => void;
}

const defaultNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const defaultYield = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Frames used to find the letterbox/pillarbox bars: spread over the file, snapped to the pass-1 stride. */
export function areaProbeFrames(n: number, stride: number, count = 5): number[] {
  const out = new Set<number>();
  for (let q = 1; q <= count; q++) {
    const raw = Math.floor((n * q) / (count + 1));
    out.add(Math.min(n - 1, Math.round(raw / stride) * stride));
  }
  return [...out];
}

/** Builds the frame-signature function for one BIF + rect: decodes, finds the picture area once, crops. */
export function makeSigSource(buffer: ArrayBuffer, index: BifIndex, rect: NormRect, stride: number, grid = DEFAULT_GRID) {
  const lumaCache = new Map<number, LumaFrame>();
  let jpegDecodes = 0;
  const decode = (i: number) => {
    const cached = lumaCache.get(i);
    if (cached) {
      lumaCache.delete(i);
      return cached;
    }
    jpegDecodes++;
    return decodeLuma(frameBytes(buffer, index, i));
  };
  const probes = areaProbeFrames(index.frameCount, stride);
  const probeFrames = probes.map(i => {
    jpegDecodes++;
    const f = decodeLuma(frameBytes(buffer, index, i));
    lumaCache.set(i, f);
    return f;
  });
  const { width, height } = probeFrames[0];
  const area = medianPictureArea(probeFrames.map(pictureAreaOf), width, height);
  const sigOf = (i: number): Sig => signature(decode(i), area, rect, grid.cols, grid.rows);
  return { sigOf, area, frameSize: { width, height }, jpegDecodes: () => jpegDecodes };
}

export async function scanBif(opts: ScanOptions): Promise<ScanResult> {
  const params: DetectorParams = { ...DEFAULT_PARAMS, ...(opts.params || {}) };
  const now = opts.now || defaultNow;
  const yieldFn = opts.yieldFn || defaultYield;
  const batch = opts.batchDecodes ?? 50;
  const log = opts.log || (() => {});
  const { index, buffer } = opts;
  const n = index.frameCount;
  const toTimed = (m: Marker): TimedMarker => ({ ...m, ms: index.timeMs[m.anchorIndex], changeMs: index.timeMs[m.frameIndex] });

  const t0 = now();
  const src = makeSigSource(buffer, index, opts.rect, params.stride);
  const oracle = new FrameOracle(n, src.sigOf, params.tauAbs);
  let cancelled = false;

  const drive = async <R>(gen: Generator<PassProgress, R, void>, onStep: (p: PassProgress) => void): Promise<R | null> => {
    let lastYieldAt = oracle.decodes;
    for (;;) {
      const r = gen.next();
      if (r.done) {
        return r.value;
      }
      onStep(r.value);
      if (oracle.decodes - lastYieldAt >= batch) {
        lastYieldAt = oracle.decodes;
        await yieldFn();
        if (opts.isCancelled && opts.isCancelled()) {
          cancelled = true;
          return null;
        }
      }
    }
  };

  // Pass 1 — sprocket + bisect. Markers are emitted as soon as each is confirmed.
  let emitted = 0;
  let pass1Markers: Marker[] = [];
  const p1 = sprocketPass(
    oracle,
    params,
    m => {
      emitted++;
      opts.onMarker?.(toTimed(m));
    },
    opts.refFrame === 'auto' ? undefined : Math.max(0, Math.min(n - 1, opts.refFrame)),
  );
  const p1res = await drive(p1, step => {
    opts.onProgress?.({ pass: 1, readToMs: index.timeMs[step.readTo], decodes: src.jpegDecodes(), frames: n, markers: emitted });
  });
  let refFrame = -1;
  let maskKept = 0;
  if (p1res) {
    pass1Markers = p1res.markers;
    refFrame = p1res.ref;
    maskKept = p1res.kept;
    log(`ref frame=${refFrame} mask kept=${(maskKept * 100).toFixed(0)}% area=${src.area.top},${src.area.bottom},${src.area.left},${src.area.right}`);
  }
  const t1 = now();
  const pass1 = { decodes: src.jpegDecodes(), ms: t1 - t0, markers: pass1Markers.length };
  log(`pass1 done n=${pass1.decodes}/${n} markers=${pass1.markers} ms=${Math.round(pass1.ms)}`);
  opts.onPass1Done?.({ decodes: pass1.decodes, ms: pass1.ms, markers: pass1Markers.map(toTimed) });

  let finalMarkers: Marker[] = pass1Markers;
  let added = 0;
  let lost = 0;
  let skippedAbsent = 0;
  if (!cancelled && !opts.pass1Only) {
    const p2 = sequentialPass(oracle, params);
    const p2res = await drive(p2, step => {
      opts.onProgress?.({ pass: 2, readToMs: index.timeMs[step.readTo], decodes: src.jpegDecodes(), frames: n, markers: emitted });
    });
    if (p2res) {
      const merged = mergePasses(pass1Markers, p2res.markers);
      finalMarkers = merged.merged;
      added = merged.added;
      lost = merged.lostFromPass1.length;
      skippedAbsent = p2res.absent;
      for (const m of finalMarkers) {
        if (m.pass === 2) {
          opts.onMarker?.(toTimed(m));
        }
      }
    }
  }
  const t2 = now();
  const pass2 = { decodes: src.jpegDecodes() - pass1.decodes, ms: t2 - t1, added };
  if (!opts.pass1Only) {
    log(`pass2 done added=${added} lost=${lost} absent=${skippedAbsent} ms=${Math.round(pass2.ms)}`);
  }

  return {
    frames: n,
    intervalMs: index.intervalMs,
    intervalSource: index.intervalSource,
    rect: opts.rect,
    refFrame,
    maskKept,
    area: src.area,
    frameSize: src.frameSize,
    markers: finalMarkers.map(toTimed),
    pass1,
    pass2,
    lostFromPass1: lost,
    skippedAbsent,
    jpegDecodes: src.jpegDecodes(),
    params,
    videoBytesDecoded: 0,
    cancelled,
  };
}

/**
 * Calibration preview (F3): decodes the first `count` frames and the bar probes ONCE; each box nudge only re-crops.
 */
export function makePreview(buffer: ArrayBuffer, index: BifIndex, count: number, stride: number) {
  const n = Math.min(count, index.frameCount);
  const frames: LumaFrame[] = [];
  for (let i = 0; i < n; i++) {
    frames.push(decodeLuma(frameBytes(buffer, index, i)));
  }
  const probes = areaProbeFrames(index.frameCount, stride).map(i => decodeLuma(frameBytes(buffer, index, i)));
  const { width, height } = frames[0] || probes[0];
  const area = medianPictureArea(probes.map(pictureAreaOf), width, height);
  return {
    area,
    width,
    height,
    sigsFor: (rect: NormRect): Sig[] => frames.map(f => signature(f, area, rect)),
  };
}

/** Picture area of a BIF from the bar probes only (5 decodes). */
export function probeArea(buffer: ArrayBuffer, index: BifIndex, stride: number) {
  const probes = areaProbeFrames(index.frameCount, stride).map(i => decodeLuma(frameBytes(buffer, index, i)));
  const { width, height } = probes[0];
  return { area: medianPictureArea(probes.map(pictureAreaOf), width, height), width, height };
}
