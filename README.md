<div align="center">
  <img src="docs/assets/icon.svg" alt="Flipbook Icon" width="144">
  <h1>Flipbook ⏩</h1>
  <p><em>Skip to just before the next goal on a replay you haven't watched — read from the trickplay file your TV already downloads, without decoding any video.</em></p>
  <img src="docs/assets/readme-hero.png" alt="Flipbook — scans a match's trickplay thumbnails on the TV and marks each score change on the seek bar" width="100%">

  <br/>

  [![Built for Amazon Developer Hackathon](https://img.shields.io/badge/Devpost-Amazon_Developer_Hackathon-8b5cf6?style=for-the-badge)](https://amazonappdev2026.devpost.com/)
  [![Landing page](https://img.shields.io/badge/Landing-page-D9A441?style=for-the-badge)](https://edycutjong.github.io/flipbook/)
  [![Pitch deck](https://img.shields.io/badge/Pitch-deck-F2EBDD?style=for-the-badge)](https://edycutjong.github.io/flipbook/pitch/)

  <br/>

  ![Vega OS](https://img.shields.io/badge/Vega_OS-Fire_TV-FF9900?style=flat)
  ![React Native](https://img.shields.io/badge/React_Native-20232A?style=flat&logo=react)
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
  [![CI](https://github.com/edycutjong/flipbook/actions/workflows/ci.yml/badge.svg)](https://github.com/edycutjong/flipbook/actions/workflows/ci.yml)
  [![CodeQL](https://github.com/edycutjong/flipbook/actions/workflows/codeql.yml/badge.svg)](https://github.com/edycutjong/flipbook/actions/workflows/codeql.yml)
  [![License](https://img.shields.io/badge/License-MIT--0-yellow)](LICENSE)

</div>

---

## 📸 See it in Action

Running on the **Vega Virtual Device** (Apple M-series Mac). These stills use Amazon's own webinar trickplay file (the "witness"), not a match: it is the title the sample app itself streams, so it shows the engine without any footage of ours.

| Jump | Scrub: the mask over the thumbnail |
|---|---|
| ![Press ⏩: jump to 30 s before the next change's anchor, the last frame with the old score](docs/images/vvd-jump-toast.png) | ![Scrubbing: the black block is the mask drawn over the scrub thumbnail; on this title the calibrated box covers most of the frame](docs/images/vvd-scrub-mask.png) |

![Calibration: draw the box once around the broadcaster's score graphic](docs/images/vvd-calibration.png)

## 💡 The Problem & Solution

### The Problem
You come home to a full-match replay of a game you haven't seen (a lower-division, women's or amateur match). The seek bar has no chapters. Scrubbing shows you the score on every thumbnail, so you spoil the result while you hunt for the goals.

### The Solution
A player that shows scrub previews from BIF trickplay — as Amazon's Vega video sample does — already downloads a **BIF** file: one small JPEG per ~10 s of the match. Flipbook reads that file instead of the video:

1. **Calibrate once** — draw a box around the broadcaster's score graphic (it is remembered per broadcaster).
2. **Scan** — a two-pass change-and-hold detector compares the box across thumbnails. Pass 1 samples sparse frames so the first ticks appear fast; pass 2 reads every frame to fill gaps and refine. Only a change that *holds* counts, so a replay or a brief graphic dropout does not.
3. **Jump** — ⏩ goes to the next change minus a lead-in (default 30 s), anchored on the last frame that still shows the **old** score, so you land before the play.

Two modes, **blind by default**: the seek bar shows only your position and the thumbnails' score rectangle is masked. **Highlights** (user-selected) adds ticks on the seek bar. Either way, no video is decoded, by construction: the scan only opens the BIF's thumbnail JPEGs (the benchmark records this as `videoBytesDecoded: 0`).

## 🏗️ Architecture & Tech Stack

```
BIF file ──► BifIndex ──► jpeg-js decode, box crop ────────► 64×5 signature
                                   │                              │
                                   ▼                              ▼
                       pass 1 (stride 8)  ──►  pass 2 (all frames)  ──►  markers (anchor = last old-score frame)
                                                                              │
                  KUI SeekBar (ticks, masked thumbnails)  ◄───────────────────┤
                  JumpController (owns ⏩/⏪, sets currentTime)  ◄─────────────┘
```

| Layer | Choice |
|---|---|
| Platform | Vega OS (Fire TV), React Native, TypeScript |
| Player | W3C `VideoPlayer` + Shaka Player (from the forked sample) |
| Detector | Arithmetic change-and-hold on a calibrated rectangle — no ML, no LLM (`src/flipbook/core/`) |
| Detector signature | 64×5 grid, jitter mask, top-3 cell distance, 3-frame median hold (v2; replaced a 16×4 mean-abs signature) |
| Decode | `jpeg-js` 0.4.4 on the device |
| Persistence | AsyncStorage (box per broadcaster) |
| Starting point | Fork of [AmazonAppDev/vega-video-sample](https://github.com/AmazonAppDev/vega-video-sample) (MIT-0) |

## 🏆 Fire TV (Vega) Integration

The judged path uses **four platform surfaces**, plus Amazon's reference BIF service — sample code we forked and extended to hand over the raw bytes (not a platform API):

| Surface | Used for |
|---|---|
| W3C `VideoPlayer` (`@amazon-devices/react-native-w3cmedia`) | playback; `currentTime` set by the jump |
| KUI `SeekBar` | blind/highlights seek bar: `markers` prop for ticks, `displayAboveThumb` overlay masking the score area; `partialDisablingConfiguration` hands ⏩/⏪ to Flipbook |
| TV input and focus (`useTVEventHandler`, `TVFocusGuideView`) | `useTVEventHandler`: skip keys and calibration (arrows move, SELECT toggles resize, PLAY/PAUSE or BACK confirms, MENU opens the panel); `TVFocusGuideView`: keeps focus on the seek bar |
| Vega Virtual Device + CLI | build, run, on-device logs and recordings |
| Amazon's BIF service in the sample (`src/services/bif/*`) | downloads the BIF; one added call (`getBifFile`) hands Flipbook the same bytes, which its own validated parser reads (`src/flipbook/core/bifIndex.ts`); its header and parser defects are entries 6–7 of [`FRICTION_LOG.md`](FRICTION_LOG.md) (11 entries in all) |

Found while verifying: Amazon's own `tv-webinar-hd.bif` has 428 frames at 240×180 and a timestamp-multiplier field of `0xFFFFD8F0`, so a binary search by `positionMillis` would break Amazon's file. Flipbook sanity-checks the header and falls back to a 10 s interval.

The [Kiro](https://kiro.dev) CLI wrote `scripts/make-bif.ts`, `src/flipbook/core/bifWriter.ts` and their tests (18) headless (see the commit history). A `kirocrew run` attempt produced nothing (approval policy and rate limits); that is recorded, not claimed.

## 📊 Engineering Rigor

| Metric | Value | Source |
|---|---|---|
| Tests | 420 passing (69 Flipbook) + 4 upstream skipped; `tsc` clean | `npm test`, `npm run typecheck` |
| Video bytes decoded | 0, by construction (the scan only opens BIF JPEGs) | `src/flipbook/core/scan.ts`; recorded as `videoBytesDecoded` in `evidence/bench/*.json` |
| On-device pass 1 (Amazon's BIF; detector v1 build 5be6a4a, before the v2 signature) | 203 of 428 frames in 4,085 ms (≈ 20 ms per decoded frame) | `evidence/vvd/README.md`, `witness-v1-flipbook-lines.log` |
| Jump without stacked seek | `seek from=50572ms currentTime=199.1`, then `currentTime=199.1` 1.5 s later | `evidence/vvd/witness-v1-flipbook-lines.log` |
| Development match (agent dev labels, **not ground truth**) | 2/2 changes found, 0 false markers, 2/2 jumps land before the play (leads 28 s and 30 s); pass 1 reads 14.9 % of frames | `evidence/bench/dev-winchester-320.json` |
| Visibility margin (dev labels) | 2.64× at 320 px, 2.04× at 240×180 letterboxed | `evidence/bench/visibility-dev-winchester-*.json` |
| Fair baseline | a plain frame differ needs τ = 30 for 2/2 recall and then fires 237 false markers | `evidence/bench/dev-winchester-320.json` → `ablationBaseline` |
| Node timings (not device) | pass 1 p50 210.8 ms, pass 2 p50 1,229.6 ms over 20 runs, labelled "Node (tsx) on Apple M-series" | same file |

Always read pass 1 and pass 2 together: pass 1 reads 14.9 % of frames only to put the first ticks up quickly; pass 2 still reads every frame.

### Honest limits (9)

1. **Virtual device only.** No Fire TV hardware was available; every timing is "Vega virtual device on Apple M-series".
2. **The held-out headline is pending.** The headline metric (goal jumps that land before the play on held-out match B) will be reported only after the human's ground-truth files for matches A and B are committed. Until then no such number is claimed. Detector parameters and calibration boxes are frozen in [`fixtures/PREREG.json`](fixtures/PREREG.json) (detector-params sha256 `6f21e417…`), and `bench`/`visibility` refuse to run on matches A and B without a committed truth file.
3. **The numbers above come from one development match with two labelled changes**, labelled by the detector's author from 2 s stills. The 95 % confidence interval on 2/2 is [0.158, 1]. It shows the pipeline works, not how well it generalises.
4. **Same producer.** Matches A, B and the development match are all Belmont Media Center broadcasts; B has a different overlay design. Read it as "tuned on one match, tested on two more from the same producer."
5. **Disclosure:** to place the calibration boxes the author looked at one 2:00 frame of each of A and B; no detector run has been made on either.
6. **Blind mode still discloses** that a jump reveals a change ahead; "No later change" reveals none; misses are silent.
7. **Scrubbing is coarse:** one thumbnail per ~10 s. A leaked score in the video itself (not the graphic) is outside what the mask covers.
8. **On-device captures still owed:** a calibrated scan of the development match on the VVD, 20 relaunch timings, a 100-frame decode median, and AsyncStorage restore after a relaunch (write is shown, read-back is not). The Mac's screen lock stopped the VVD; see `evidence/vvd/README.md`.
9. **Footage rights.** The three matches are CC0 1.0 on the Internet Archive and show high-school students and school marks; the marks are the schools', not ours, and CC0 does not cover trademarks. We mute the original commentary in everything we publish and use no close-ups.

## 🚀 Getting Started

### Prerequisites

- [Vega Developer Tools](https://developer.amazon.com/docs/vega/latest/install-vega-sdk.html), Node 20 (what the on-device build was verified with; CI runs Node 22, `engines` is `>=22`), JDK 21, Python 3 (the Shaka postinstall needs them)
- Never build from a path that contains a directory named `assets` (the packager embeds host paths and breaks)

### Installation

```bash
npm install                       # also builds Shaka (postinstall)
npm run build:release             # → build/aarch64-release/*.vpkg on Apple M-series
vega virtual-device start --gui
vega run-app build/aarch64-release/keplervideoapp_aarch64.vpkg   # x86_64 hosts: build/x86_64-release/…
```

The "Matches" row plays development media from a local static server and BIFs from `fixtures/`; the "Witness" row streams Amazon's BIF from the sample's own CDN. Build your own BIF from any video with `npm run make-bif`.

## 🧪 Testing & CI

```bash
npm run typecheck
npm test                                  # 420 passing (69 Flipbook)
npm run test:flipbook                     # Flipbook only
npm run bench                             # development-match benchmark, 20 runs, with ablations
npm run trace                             # the scan's read order and per-frame change distance (the landing page replays it)
npm run verify:offline                    # offline checks of the BIF pipeline
```

GitHub Actions runs on every push and pull request (`.github/workflows/`):

- **CI**: `npm ci --ignore-scripts`, typecheck, lint, Jest with the coverage thresholds, `verify:offline`, and `actionlint` on the workflows
- **Security**: gitleaks over the full history, plus a report-only `npm audit` of production dependencies (the open advisories are in the sample's React Native CLI chain and `xmldom`)
- **CodeQL**: JavaScript/TypeScript analysis; results upload to code scanning once the repository is public, and are kept as an artifact until then

Dependabot is limited to patch and security updates because the dependency set is pinned to the Vega toolchain. See [SECURITY.md](SECURITY.md).

## 📁 Project Structure

```
src/flipbook/core/     BIF index + writer, luma, signature, detector, two-pass scan, jump
src/flipbook/app/      context, overlay (calibration, panel), SeekBar parts
scripts/               bench, visibility, trace, make-bif, verify_offline
fixtures/              BIFs for the development match and matches A/B, PREREG.json, truth template
evidence/              bench JSON and on-device VVD logs behind every number above
tools/label/           the human ground-truth labelling page
docs/                  the landing page and pitch deck (GitHub Pages), with the media they use
test/flipbook/         Jest invariants
```

## 🗺️ Roadmap

- [x] BIF → decode → two-pass detector → markers → ⏩ jump on the VVD
- [x] Blind and highlights modes, masked thumbnails, calibration overlay
- [x] Pre-registered parameters and held-out guard
- [ ] Human ground truth for matches A and B, then the held-out result
- [ ] Calibrated on-device recording of the development match
- [ ] Upstream the BIF parser fixes to `vega-video-sample`

## 📄 License

[MIT-0](LICENSE) (inherited from the Amazon sample). Third-party notices: [`LICENSE-THIRD-PARTY`](LICENSE-THIRD-PARTY).

## 🙏 Acknowledgments

Built on [AmazonAppDev/vega-video-sample](https://github.com/AmazonAppDev/vega-video-sample). Match footage recorded by Belmont Media Center and released CC0 1.0 on the Internet Archive; item links, SHA-1s and our obligations are in [`CREDITS.md`](CREDITS.md). `jpeg-js` is BSD-3-Clause.
