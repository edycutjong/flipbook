/**
 * Where Flipbook's demo media lives.
 *
 * Development: a static server on the builder's Mac, as seen from the Vega Virtual Device (QEMU user networking
 * maps the host to 10.0.2.2). It serves the CC0 match video (original commentary audio removed) and the BIF that
 * `scripts/make-bif.ts` generated from it — the same two files a provider would host.
 * See DEMO.md for how to reproduce the files and their SHA-256.
 */
export const FLIPBOOK_MEDIA_HOST = 'http://10.0.2.2:8765/flipbook';
