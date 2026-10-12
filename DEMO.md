# DEMO — see it, then re-run every number

Flipbook runs on the **Vega Virtual Device** (Apple M-series Mac). No Fire TV hardware was available, so no timing here
is from a real device. The demo video, linked from the Devpost page once it is uploaded, shows the app on the virtual device.

## 1. See it on the virtual device

```bash
npm install && npm run build:release   # npm install also builds Shaka (needs Python 3 and a JDK)
vega virtual-device start --gui
vega run-app build/aarch64-release/keplervideoapp_aarch64.vpkg
```

Two rows on the home screen: **Matches** (the development match: local HLS + the BIF in `fixtures/`) and **Witness**
(Amazon's own `tv-webinar-hd.bif`, streamed from the sample's CDN). Open a title, press MENU for the Flipbook panel
(mode, redraw box, engine log), calibrate the box once (arrows move, SELECT toggles resize, PLAY/PAUSE or BACK
confirms), then ⏩ jumps to the next change minus the lead-in. Blind mode is the default; Highlights adds ticks.
Never build from a path containing a directory named `assets` (the packager embeds host paths).

## 2. Re-run the numbers (no credentials, no device)

For the tests and the benchmark alone, `npm ci --ignore-scripts` is enough (it skips the Shaka build, which only the device build needs).

| Claim | Command | Evidence file it must match |
|---|---|---|
| Tests (420 passing, 69 Flipbook, 4 upstream skipped) | `npm test` | — |
| Types clean | `npm run typecheck` | — |
| Development-match result, ablations, Node timings (20 runs) | `npm run bench` | `evidence/bench/dev-winchester-320.json` |
| The scan's read order, which the landing page replays | `npm run trace` | `evidence/bench/dev-winchester-320-trace.json` |
| BIF pipeline offline checks | `npm run verify:offline` | — |
| Visibility margin of the score box (dev labels) | `npx tsx scripts/visibility.ts fixtures/winchester-2023-240lb.bif --rect <box> --labels fixtures/winchester-2023.devlabels.json` | `evidence/bench/visibility-dev-winchester-*.json` |
| Amazon's BIF header (428 frames, multiplier `0xFFFFD8F0`) | `evidence/witness-tv-webinar-header.txt` | same file |
| On-device pass 1 and the jump without a stacked seek | read `evidence/vvd/witness-v1-flipbook-lines.log` | `evidence/vvd/README.md` |

## 3. What is not measured yet

- **The held-out headline** (goal jumps that land before the play on match B). It is computed only from a committed,
  human-labelled truth file; `bench` and `visibility` refuse to run on matches A and B without one. Parameters are frozen
  in `fixtures/PREREG.json`. Until then no such number is claimed anywhere.
- On-device captures of a calibrated scan of the development match, 20 relaunch timings, a 100-frame decode median and
  the AsyncStorage restore after a relaunch (see README, honest limit 8).
- Everything above on the development match was labelled by the detector's author (`fixtures/winchester-2023.devlabels.json`)
  and is evidence that the pipeline works, not how well it generalises.
