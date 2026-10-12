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
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import { DetectorParams, formatClock, readBif, scanBif, ScanResult, TimedMarker } from '../src/flipbook/core';

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

/** Clopper-Pearson exact 95 % interval for k successes in n trials. */
export function clopperPearson(k: number, n: number, alpha = 0.05): [number, number] {
  if (n === 0) return [0, 1];
  const logC = (m: number, i: number) => {
    let v = 0;
    for (let j = 1; j <= i; j++) v += Math.log(m - i + j) - Math.log(j);
    return v;
  };
  // P(X <= x) for X ~ Bin(n, p), 0 < p < 1
  const cdf = (x: number, p: number) => {
    let sum = 0;
    for (let i = 0; i <= x; i++) sum += Math.exp(logC(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
    return sum;
  };
  const bisect = (f: (p: number) => number, target: number, increasing: boolean) => {
    let lo = 1e-12;
    let hi = 1 - 1e-12;
    for (let it = 0; it < 80; it++) {
      const mid = (lo + hi) / 2;
      if ((f(mid) < target) === increasing) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const lower = k === 0 ? 0 : bisect(p => 1 - cdf(k - 1, p), alpha / 2, true);
  const upper = k === n ? 1 : bisect(p => cdf(k, p), alpha / 2, false);
  return [+lower.toFixed(3), +upper.toFixed(3)];
}

/** Held-out matches (match-*.bif) are scored only against a committed human truth file. */
export function guardHeldOut(bifPath: string, labelsPath: string | undefined) {
  if (!/^match-/.test(path.basename(bifPath))) return;
  if (!labelsPath) throw new Error(`${path.basename(bifPath)} is a held-out match: a committed human truth file is required (--labels fixtures/<match>.truth.json)`);
  const doc = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));
  const placeholder = /<name>|<YYYY/.test(JSON.stringify(doc));
  if (!/GROUND TRUTH/.test(doc.status || '') || !doc.labelledBy || placeholder) {
    throw new Error('labels file is not a filled-in human ground-truth file');
  }
  if (!(doc.changes || []).some((c: Change) => c.graphicMs > 0)) throw new Error('truth file has no labelled change');
  const match = path.basename(bifPath).replace(/-(320|240lb)\.bif$/, '');
  if (doc.match !== match) throw new Error(`truth file is for "${doc.match}", BIF is "${match}"`);
  let committed = '';
  try {
    committed = execFileSync('git', ['log', '--format=%H', '--', labelsPath], { encoding: 'utf8' }).trim();
  } catch {
    committed = '';
  }
  if (!committed) throw new Error(`truth file ${labelsPath} is not committed: commit it before any detector run (independence rule)`);
  try {
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', labelsPath]);
  } catch {
    throw new Error(`truth file ${labelsPath} has uncommitted changes`);
  }
}

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
    recallCI95: clopperPearson(found, labels.changes.length),
    matchToleranceMs: tol,
    falseMarkers,
    falseMarkersPer90min: durationMs ? (falseMarkers * 5_400_000) / durationMs : null,
    goalJumps: jumps.length,
    goalJumpsBeforePlay: jumps.filter(j => j.beforePlay).length,
    goalJumpsSpoiled: jumps.filter(j => j.spoiled).length,
    goalJumpsBeforePlayCI95: clopperPearson(jumps.filter(j => j.beforePlay).length, jumps.length),
    graphicLagS: goals.map(g => (g.change.graphicMs - g.change.playMs!) / 1000),
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
  const runs = Math.max(1, Number(arg('runs') || 5));
  const leadInMs = Number(arg('lead-in') || 30) * 1000;
  const labels: Labels | null = arg('labels') ? JSON.parse(fs.readFileSync(arg('labels')!, 'utf8')) : null;
  const ablate = (arg('ablate') || '').split(',').filter(Boolean);
  guardHeldOut(file, arg('labels'));

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
    params: res.params,
    pass2Reach: res.pass2Reach,
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
        what: 'naive anchor: jump to (first changed frame − leadIn) instead of (last old-score frame − leadIn). Compare lead and before-play counts; on footage where the graphic is never hidden after goals, E1 only changes the lead.',
        score: score(res.markers, labels, res.intervalMs, durationMs, leadInMs, true),
      };
    }
    if (ablate.includes('baseline')) {
      // A fair simple differ: no hold window, no mask, its OWN best τ chosen on the same labels (dev match only).
      const grid = [8, 12, 16, 20, 25, 30, 40, 50, 60, 80];
      const rows: { tau: number; markers: number; recall: number | null; falseMarkers: number }[] = [];
      for (const tau of grid) {
        const s = await scan(buf, rect, { ...params, window: 1, jitterMax: 255, tau, tauCand: tau });
        const sc = score(s.res.markers, labels, s.res.intervalMs, durationMs, leadInMs);
        rows.push({ tau, markers: s.res.markers.length, recall: sc.recall, falseMarkers: sc.falseMarkers });
      }
      const best = [...rows].sort((a, b) => (b.recall ?? 0) - (a.recall ?? 0) || a.falseMarkers - b.falseMarkers)[0];
      out.ablationBaseline = { what: 'simple frame differ (window 1, every cell), τ swept and the best kept', sweep: rows, best };
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

if (/bench\.ts$/.test(process.argv[1] || '')) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
