#!/usr/bin/env node
/**
 * trace — records the order in which the two-pass scan reads a BIF's frames, when each marker is emitted, and the
 * windowed change distance D at every frame. The landing page replays this file; nothing on it is drawn by hand.
 *
 * It drives the same exported pieces scanBif uses (makeSigSource, FrameOracle, sprocketPass, sequentialPass,
 * mergePasses) and then runs scanBif itself on the same bytes: the trace is refused unless the markers and both
 * passes' decode counts are identical. D is computed exactly as scripts/visibility.ts does (pass-1 parameters,
 * mask and reference learned by pass 1).
 *
 *   npx tsx scripts/trace.ts <file.bif> --rect x,y,w,h [--out evidence/bench/<name>-trace.json]
 *
 * Held-out matches (match-*.bif) are refused: no detector run on them before the ground-truth commit.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  areaProbeFrames,
  DEFAULT_PARAMS,
  DetectorParams,
  formatClock,
  FrameOracle,
  makeSigSource,
  Marker,
  mergePasses,
  NormRect,
  readBif,
  REACH_MS,
  runToEnd,
  scanBif,
  sequentialPass,
  sprocketPass,
  windowStep,
} from '../src/flipbook/core';

/** One frame read by the detector: [frame index, pass, phase] — s = sprocket sample, b = bisect/confirm, v = verify. */
export type Read = [number, 1 | 2, 's' | 'b' | 'v'];

export interface ScanTrace {
  frames: number;
  intervalMs: number;
  rect: NormRect;
  params: DetectorParams;
  pass2Reach: number;
  /** Frames decoded first to find the letterbox bars (reused later from cache, so not re-read). */
  probes: number[];
  reads: Read[];
  /** Markers in emission order; `afterRead` = how many reads had happened when it was emitted. */
  events: { afterRead: number; frame: number; anchor: number; pass: 1 | 2; changeAt: string; anchorAt: string; D: number }[];
  markers: { frame: number; anchor: number; changeAt: string; anchorAt: string; changeMs: number; anchorMs: number; D: number; pass: 1 | 2 }[];
  pass1: { jpegDecodes: number; reads: number };
  pass2: { jpegDecodes: number; reads: number };
  /** D at every frame (1 decimal); null where the graphic is absent or a window has too few present frames. */
  D: (number | null)[];
  absent: number[];
  maskKept: number;
  refFrame: number;
  videoBytesDecoded: 0;
}

export function traceScan(buf: ArrayBuffer, rect: NormRect, params: DetectorParams = DEFAULT_PARAMS): ScanTrace {
  const parsed = readBif(buf);
  if (!parsed.ok) {
    throw new Error('not a readable BIF');
  }
  const ix = parsed.index;
  const n = ix.frameCount;
  const params2: DetectorParams = { ...params, reach: Math.max(params.reach, Math.ceil(REACH_MS / Math.max(1, ix.intervalMs))) };
  const src = makeSigSource(buf, ix, rect, params.stride);
  const reads: Read[] = [];
  let pass: 1 | 2 = 1;
  const isSample = (i: number) => i % Math.max(1, params.stride) === 0 || i === n - 1;
  const o = new FrameOracle(
    n,
    i => {
      reads.push([i, pass, pass === 2 ? 'v' : isSample(i) ? 's' : 'b']);
      return src.sigOf(i);
    },
    params.tauAbs,
  );
  const clock = (i: number) => formatClock(ix.timeMs[i]);
  const events: ScanTrace['events'] = [];
  const emit = (m: Marker) =>
    events.push({ afterRead: reads.length, frame: m.frameIndex, anchor: m.anchorIndex, pass: m.pass, changeAt: clock(m.frameIndex), anchorAt: clock(m.anchorIndex), D: +m.delta.toFixed(1) });

  const p1 = runToEnd(sprocketPass(o, params, emit));
  const pass1 = { jpegDecodes: src.jpegDecodes(), reads: reads.length };
  pass = 2;
  const p2 = runToEnd(sequentialPass(o, params2));
  const merged = mergePasses(p1.markers, p2.markers);
  const kept = merged.lostFromPass1.filter(m => !merged.merged.some(x => Math.abs(x.frameIndex - m.frameIndex) <= params.window));
  const final = [...merged.merged, ...kept].sort((a, b) => a.frameIndex - b.frameIndex);
  for (const m of final) {
    if (m.pass === 2) {
      emit(m);
    }
  }
  const pass2 = { jpegDecodes: src.jpegDecodes() - pass1.jpegDecodes, reads: reads.length - pass1.reads };

  const D: (number | null)[] = [];
  const absent: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!o.present(i)) {
      absent.push(i);
      D.push(null);
      continue;
    }
    const s = windowStep(o, i, params);
    D.push(s ? +s.d.toFixed(1) : null);
  }
  return {
    frames: n,
    intervalMs: ix.intervalMs,
    rect,
    params,
    pass2Reach: params2.reach,
    probes: areaProbeFrames(n, params.stride),
    reads,
    events,
    markers: final.map(m => ({
      frame: m.frameIndex,
      anchor: m.anchorIndex,
      changeAt: clock(m.frameIndex),
      anchorAt: clock(m.anchorIndex),
      changeMs: ix.timeMs[m.frameIndex],
      anchorMs: ix.timeMs[m.anchorIndex],
      D: +m.delta.toFixed(1),
      pass: m.pass,
    })),
    pass1,
    pass2,
    D,
    absent,
    maskKept: +p1.kept.toFixed(4),
    refFrame: p1.ref,
    videoBytesDecoded: 0,
  };
}

/** Refuses the trace unless scanBif, run on the same bytes, gives the same markers and decode counts. */
export async function checkAgainstScanBif(buf: ArrayBuffer, t: ScanTrace): Promise<void> {
  const parsed = readBif(buf);
  if (!parsed.ok) {
    throw new Error('not a readable BIF');
  }
  const r = await scanBif({ buffer: buf, index: parsed.index, rect: t.rect, refFrame: 'auto', params: t.params, yieldFn: async () => {} });
  const a = JSON.stringify(r.markers.map(m => [m.frameIndex, m.anchorIndex, m.pass]));
  const b = JSON.stringify(t.markers.map(m => [m.frame, m.anchor, m.pass]));
  if (a !== b) {
    throw new Error(`trace markers ${b} differ from scanBif ${a}`);
  }
  if (r.pass1.decodes !== t.pass1.jpegDecodes || r.pass2.decodes !== t.pass2.jpegDecodes) {
    throw new Error(`decode counts differ: scanBif ${r.pass1.decodes}/${r.pass2.decodes}, trace ${t.pass1.jpegDecodes}/${t.pass2.jpegDecodes}`);
  }
}

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const file = process.argv[2];
  if (!file) {
    throw new Error('usage: trace.ts <file.bif> --rect x,y,w,h [--out file.json]');
  }
  if (/^match-/.test(path.basename(file))) {
    throw new Error(`${path.basename(file)} is a held-out match: no trace before the ground-truth commit`);
  }
  const [x, y, w, h] = (arg('rect') || '').split(',').map(Number);
  if (![x, y, w, h].every(Number.isFinite)) {
    throw new Error('--rect x,y,w,h is required');
  }
  const b = fs.readFileSync(file);
  const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const t = traceScan(buf, { x, y, w, h });
  await checkAgainstScanBif(buf, t);
  const out = { bif: path.basename(file), bytes: b.byteLength, checkedAgainstScanBif: true, ...t };
  // Readable header, then the long per-frame arrays one per line.
  const { probes, reads, D, absent, ...head } = out;
  const long = { probes, reads, D, absent };
  const json = `${JSON.stringify(head, null, 1).replace(/\n}$/, '')},\n${Object.entries(long)
    .map(([k, v]) => ` "${k}": ${JSON.stringify(v)}`)
    .join(',\n')}\n}`;
  if (arg('out')) {
    fs.writeFileSync(arg('out')!, json + '\n');
  }
  console.log(
    `${out.bif}: ${t.frames} frames · pass 1 decoded ${t.pass1.jpegDecodes} (${((t.pass1.jpegDecodes / t.frames) * 100).toFixed(1)} %) · pass 2 decoded ${t.pass2.jpegDecodes} · ` +
      `markers ${t.markers.map(m => `${m.changeAt} (anchor ${m.anchorAt})`).join(', ') || 'none'} · matches scanBif`,
  );
}

if (/trace\.ts$/.test(process.argv[1] || '')) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
