#!/usr/bin/env node
/**
 * verify_offline — reruns the detector over the committed fixtures with `fetch` stubbed to throw (the detector has no
 * network path; only the app's stream does) and checks the committed results still hold.
 *   npx tsx scripts/verify_offline.ts
 */
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeStats, readBif, scanBif } from '../src/flipbook/core';

(globalThis as { fetch?: unknown }).fetch = () => {
  throw new Error('network disabled in verify_offline');
};

const checks = [
  { bif: 'fixtures/winchester-2023-320.bif', rect: { x: 0.155, y: 0.868, w: 0.497, h: 0.058 }, expectChangeMs: [1020000, 2970000] },
  { bif: 'fixtures/winchester-2023-240lb.bif', rect: { x: 0.155, y: 0.868, w: 0.497, h: 0.058 }, expectChangeMs: [1020000, 2970000] },
];

(async () => {
  let ok = true;
  for (const c of checks) {
    const b = fs.readFileSync(c.bif);
    const side = JSON.parse(fs.readFileSync(`${c.bif}.json`, 'utf8'));
    const sha = createHash('sha256').update(b).digest('hex');
    const shaOk = sha === side.bifSha256;
    const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    const r = readBif(buf);
    if (!r.ok) throw new Error(`${c.bif}: ${JSON.stringify(r.error)}`);
    const before = decodeStats.jpegBytes;
    const res = await scanBif({ buffer: buf, index: r.index, rect: c.rect, refFrame: 'auto', yieldFn: async () => {} });
    // Measured: every decode is a JPEG view into this BIF's buffer, each frame decoded at most once, so the bytes the
    // decoder consumed are bounded by the BIF's size (res.videoBytesDecoded is a type-level 0, not a measurement).
    const jpegBytes = decodeStats.jpegBytes - before;
    const bytesOk = jpegBytes > 0 && jpegBytes <= b.byteLength;
    const got = res.markers.map(m => m.changeMs);
    const same = JSON.stringify(got) === JSON.stringify(c.expectChangeMs);
    ok = ok && shaOk && same && bytesOk;
    console.log(
      `${shaOk && same && bytesOk ? 'PASS' : 'FAIL'} ${c.bif} sha256=${shaOk ? 'match' : 'MISMATCH'} markers=${JSON.stringify(got)} jpegBytesDecoded=${jpegBytes} of ${b.byteLength} BIF bytes${bytesOk ? '' : ' OUT OF BOUND'}`,
    );
  }
  process.exit(ok ? 0 : 1);
})();
