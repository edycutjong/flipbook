#!/usr/bin/env node
/**
 * visibility — Gate C margin: the windowed change distance D at each labelled score change, divided by the
 * largest D anywhere more than 3 frames from a labelled change (clock outside the box, everything else inside).
 * Pass = margin ≥ 2.
 *
 *   npx tsx scripts/visibility.ts <file.bif> --rect x,y,w,h --labels <file.json> [--params json] [--out f]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { guardHeldOut } from './bench';
import { DEFAULT_PARAMS, DetectorParams, FrameOracle, frameAtMs, makeSigSource, readBif, runToEnd, sprocketPass, windowStep } from '../src/flipbook/core';

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const file = process.argv[2];
const [x, y, w, h] = (arg('rect') || '').split(',').map(Number);
guardHeldOut(file, arg('labels'));
const labels = JSON.parse(fs.readFileSync(arg('labels')!, 'utf8')) as { changes: { graphicMs: number; kind: string }[] };
const p: DetectorParams = { ...DEFAULT_PARAMS, ...(arg('params') ? JSON.parse(arg('params')!) : {}) };
const b = fs.readFileSync(file);
const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const r = readBif(buf);
if (!r.ok) throw new Error('bad BIF');
const ix = r.index;
const src = makeSigSource(buf, ix, { x, y, w, h }, p.stride);
const o = new FrameOracle(ix.frameCount, src.sigOf, p.tauAbs);
runToEnd(sprocketPass(o, p)); // learns mask + reference exactly as the app does
const D = new Array<number>(ix.frameCount).fill(0);
for (let i = 0; i < ix.frameCount; i++) {
  const s = o.present(i) ? windowStep(o, i, p) : null;
  D[i] = s ? s.d : 0;
}
const changeFrames = labels.changes.map(c => frameAtMs(ix, c.graphicMs) + (ix.timeMs[frameAtMs(ix, c.graphicMs)] < c.graphicMs ? 1 : 0));
const atChange = changeFrames.map(f => Math.max(...[f - 1, f, f + 1].filter(i => i >= 0 && i < D.length).map(i => D[i])));
let noiseMax = 0;
let noiseAt = -1;
D.forEach((d, i) => {
  if (changeFrames.every(f => Math.abs(i - f) > 3) && d > noiseMax) {
    noiseMax = d;
    noiseAt = i;
  }
});
const out = {
  bif: path.basename(file),
  rect: { x, y, w, h },
  labels: path.basename(arg('labels')!),
  changeD: atChange.map(v => +v.toFixed(1)),
  noiseMaxD: +noiseMax.toFixed(1),
  noiseMaxAtFrame: noiseAt,
  margin: atChange.length && noiseMax > 0 ? +(Math.min(...atChange) / noiseMax).toFixed(2) : null,
  pass: atChange.length > 0 && noiseMax > 0 && Math.min(...atChange) / noiseMax >= 2,
};
if (arg('out')) fs.writeFileSync(arg('out')!, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
