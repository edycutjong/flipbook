#!/usr/bin/env node
/**
 * bench — runs the shipped scanner (src/flipbook/core) over a BIF and scores it.
 *
 *   npx tsx scripts/bench.ts <file.bif> --rect x,y,w,h [--labels <truth-or-devlabels.json>]
 *        [--params '{"tau":20}'] [--runs 20] [--lead-in 30] [--ablate hold,anchor]
 *        [--vvd-log <file> ...] [--out <results.json>]
 *
 * Every number it prints is measured here. Timings from Node are labelled "Node, Apple M-series" and are NOT
 * device timings; device timings come only from `[flipbook] pass1 done … ms=` lines in Vega virtual device logs
 * passed with --vvd-log, labelled "Vega virtual device on Apple M-series".
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

import { DEFAULT_PARAMS, DetectorParams, formatClock, readBif, scanBif, ScanResult, TimedMarker } from '../src/flipbook/core';

type Change = { graphicMs: number; playMs?: number; kind: 'goal' | 'correction' | 'period'; note?: string };
type Labels = { match?: string; status?: string; precisionMs?: number; changes: Change[] };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}
const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};
const median = (xs: number[]) => pct(xs, 50);

async function scan(buf: ArrayBuffer, rect: { x: number; y: number; w: number; h: number }, params: Partial<DetectorParams>) {
  const r = readBif(buf);
  if (!r.ok) throw new Error(`BIF rejected: ${JSON.stringify(r.error)}`);
  const t0 = performance.now();
  const res = await scanBif({ buffer: buf, index: r.index, rect, refFrame: 'auto', params, yieldFn: async () => {}, now: () => performance.now() });
  return { res, index: r.index, ms: performance.now() - t0 };
}

/** Matches markers to labelled changes: a marker matches when its change frame time is within one frame interval of graphicMs. */
function score(markers: TimedMarker[], labels: Labels, intervalMs: number, durationMs: number, leadInMs: number, naiveAnchor = false) {
  const tol = intervalMs + (labels.precisionMs || 0);
  const used = new Set<number>();
  const matched: { change: Change; marker: TimedMarker | null }[] = labels.changes.map(c => {
    let best = -1;
    let bestD = Infinity;
    markers.forEach((m, i) => {
      const d = Math.abs(m.changeMs - c.graphicMs);
      if (!used.has(i) && d <= tol && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    if (best >= 0) used.add(best);
    return { change: c, marker: best >= 0 ? markers[best] : null };
  });
  const found = matched.filter(x => x.marker).length;
  const falseMarkers = markers.length - used.size;
  const goals = matched.filter(x => x.change.kind === 'goal' && x.change.playMs !== undefined);
  const jumps = goals.map(g => {
    if (!g.marker) return { playMs: g.change.playMs!, targetMs: null as number | null, beforePlay: false, spoiled: false, leadMs: null as number | null };
    const anchor = naiveAnchor ? g.marker.changeMs : g.marker.ms;
    const target = Math.max(0, anchor - leadInMs);
    return {
      playMs: g.change.playMs!,
      targetMs: target,
      beforePlay: target < g.change.playMs!,
      spoiled: target >= g.change.graphicMs,
      leadMs: g.change.playMs! - target,
    };
  });
  return {
    changesLabelled: labels.changes.length,
    changesFound: found,
    recall: labels.changes.length ? found / labels.changes.length : null,
    falseMarkers,
    falseMarkersPer90min: durationMs ? (falseMarkers * 5_400_000) / durationMs : null,
    goalJumps: jumps.length,
    goalJumpsBeforePlay: jumps.filter(j => j.beforePlay).length,
    goalJumpsSpoiled: jumps.filter(j => j.spoiled).length,
    medianLeadS: jumps.filter(j => j.leadMs !== null).length ? median(jumps.filter(j => j.leadMs !== null).map(j => j.leadMs!)) / 1000 : null,
    jumps,
  };
}

function parseVvdLogs(files: string[]) {
  const p1: number[] = [];
  const p2: number[] = [];
  const decodes: number[] = [];
  for (const f of files) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const a = line.match(/pass1 done n=(\d+)\/(\d+) markers=\d+ ms=(\d+)/);
      if (a) {
        decodes.push(+a[1] / +a[2]);
        p1.push(+a[3]);
      }
      const b = line.match(/pass2 done .* ms=(\d+)/);
      if (b) p2.push(+b[1]);
    }
  }
  return {
    label: 'Vega virtual device on Apple M-series (logged runs)',
    runs: p1.length,
    pass1Ms: { p50: median(p1), p95: pct(p1, 95), all: p1 },
    pass2Ms: { p50: median(p2), p95: pct(p2, 95), all: p2 },
    pass1DecodeFraction: decodes,
  };
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('usage: npx tsx scripts/bench.ts <file.bif> --rect x,y,w,h [--labels f] [--runs n] [--ablate hold,anchor] [--vvd-log f] [--out f]');
    process.exit(1);
  }
  const rectArg = (arg('rect') || '').split(',').map(Number);
  if (rectArg.length !== 4 || rectArg.some(v => !Number.isFinite(v))) throw new Error('--rect x,y,w,h required');
  const rect = { x: rectArg[0], y: rectArg[1], w: rectArg[2], h: rectArg[3] };
  const params: Partial<DetectorParams> = arg('params') ? JSON.parse(arg('params')!) : {};
  const runs = Number(arg('runs') || 5);
  const leadInMs = Number(arg('lead-in') || 30) * 1000;
  const labels: Labels | null = arg('labels') ? JSON.parse(fs.readFileSync(arg('labels')!, 'utf8')) : null;
  const ablate = (arg('ablate') || '').split(',').filter(Boolean);

  const b = fs.readFileSync(file);
  const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

  const times: { total: number; pass1: number; pass2: number }[] = [];
  let first: { res: ScanResult; index: Awaited<ReturnType<typeof scan>>["index"] } | null = null;
  for (let i = 0; i < runs; i++) {
    const s = await scan(buf, rect, params);
    times.push({ total: s.ms, pass1: s.res.pass1.ms, pass2: s.res.pass2.ms });
    if (!first) first = { res: s.res, index: s.index };
  }
  const res = first!.res;
  const index = first!.index;
  const durationMs = index.timeMs[index.frameCount - 1] + index.intervalMs;

  const out: Record<string, unknown> = {
    bif: path.basename(file),
    frames: res.frames,
    intervalMs: res.intervalMs,
    intervalSource: res.intervalSource,
    rect,
    params: { ...DEFAULT_PARAMS, ...params },
    maskKept: res.maskKept,
    markers: res.markers.map(m => ({ changeAt: formatClock(m.changeMs), anchorAt: formatClock(m.ms), changeMs: m.changeMs, anchorMs: m.ms, D: +m.delta.toFixed(1), pass: m.pass })),
    pass1: { decodes: res.pass1.decodes, decodeFraction: +(res.pass1.decodes / res.frames).toFixed(3) },
    pass2: { added: res.pass2.added },
    lostFromPass1: res.lostFromPass1,
    skippedAbsent: res.skippedAbsent,
    videoBytesDecoded: res.videoBytesDecoded,
    nodeTimings: {
      label: 'Node (tsx) on Apple M-series — NOT device timings',
      runs,
      pass1Ms: { p50: +median(times.map(t => t.pass1)).toFixed(1), p95: +pct(times.map(t => t.pass1), 95).toFixed(1) },
      pass2Ms: { p50: +median(times.map(t => t.pass2)).toFixed(1), p95: +pct(times.map(t => t.pass2), 95).toFixed(1) },
    },
  };
  if (labels) {
    out.labels = { file: path.basename(arg('labels')!), status: labels.status || '' };
    out.score = score(res.markers, labels, res.intervalMs, durationMs, leadInMs);
    if (ablate.includes('anchor')) {
      out.ablationAnchor = {
        what: 'naive anchor: jump to (first changed frame − leadIn) instead of (last old-score frame − leadIn)',
        score: score(res.markers, labels, res.intervalMs, durationMs, leadInMs, true),
      };
    }
    if (ablate.includes('hold')) {
      const s = await scan(buf, rect, { ...params, window: 1, jitterMax: 255 });
      out.ablationHold = {
        what: 'no hold window and no jitter mask (window = 1, every cell kept)',
        markers: s.res.markers.length,
        score: score(s.res.markers, labels, s.res.intervalMs, durationMs, leadInMs),
      };
    }
  }
  const vvd = args('vvd-log');
  if (vvd.length) out.vvdTimings = parseVvdLogs(vvd);

  const json = JSON.stringify(out, null, 2);
  if (arg('out')) {
    fs.mkdirSync(path.dirname(arg('out')!), { recursive: true });
    fs.writeFileSync(arg('out')!, json + '\n');
  }
  console.log(json);
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
