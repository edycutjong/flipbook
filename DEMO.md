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

### The "Matches" row needs its media on a local server

`src/flipbook/media.ts` points the row at `http://10.0.2.2:8765/flipbook`: from inside the Vega Virtual Device, `10.0.2.2` is your Mac.
The files are not in the repo (the recording is about 500 MB); rebuild them from the CC0 recording:

```bash
mkdir -p ~/flipbook-serve/flipbook/winchester-2023/hls && cd ~/flipbook-serve/flipbook/winchester-2023
# 1. the CC0 development match (Internet Archive item snafuinfinitysoccer-girls_091923-vs-winchester, see CREDITS.md)
curl -L -o match.mp4 https://archive.org/download/snafuinfinitysoccer-girls_091923-vs-winchester/soccer-girls_091923-vs-winchester.mp4
shasum -a 1 match.mp4            # must print e4c3982a1a87840f8f2e64ef538235ee4a1d6ce0
# 2. the BIF Flipbook reads (should match fixtures/winchester-2023-320.bif if your ffmpeg is like ours, 8.1.1; run from this repo)
(cd <path to this repo> && npm run make-bif -- ~/flipbook-serve/flipbook/winchester-2023/match.mp4 --out ~/flipbook-serve/flipbook/winchester-2023/match.bif --interval 10 --width 320)
# 3. video-only HLS, commentary audio removed (the player rejects http:// MP4s, so the row plays HLS through Shaka)
ffmpeg -i match.mp4 -an -c:v copy -f hls -hls_time 8 -hls_playlist_type vod -hls_segment_filename 'hls/seg%05d.ts' hls/index.m3u8
# 4. serve it (stop it when you are done: it serves that folder to your network)
python3 <path to this repo>/scripts/serve-media.py ~/flipbook-serve 8765
```

Step 2's SHA-256 is in `fixtures/winchester-2023-320.bif.json` (`bifSha256`). The step-3 command is the stream-copy recipe we used
in spirit; our own HLS cut has slightly different segment boundaries, and we have not re-played this exact output on the device
(the device runs used our own earlier HLS cut), so if the player complains, adjust `-hls_time`. The "Witness" row needs none of this.

## 2. Re-run the numbers (no credentials, no device)

For the tests and the benchmark alone, `npm ci --ignore-scripts` is enough (it skips the Shaka build, which only the device build needs).

| Claim | Command | Evidence file it must match |
|---|---|---|
| Tests (444 passing + 4 skipped, 93 Flipbook) | `npm test` | — |
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
- A dedicated 100-frame decode median on the device. (The calibrated scan, 19 relaunch timings and the AsyncStorage restore after a relaunch are captured for the development match; see `evidence/vvd/README.md` and README, honest limit 8.)
- Everything above on the development match was labelled by the detector's author, an AI agent (Claude Code) (`fixtures/winchester-2023.devlabels.json`)
  and is evidence that the pipeline works, not how well it generalises.
