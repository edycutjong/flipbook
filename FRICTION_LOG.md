# Friction log — building Flipbook on Vega

First-hand, dated entries from building Flipbook on the Vega SDK 0.24.12112 (Vega CLI 1.4.4) and the Vega Virtual
Device (VVD) on an Apple M-series Mac, macOS 26.5, with Kiro CLI 2.29.1 / Kiro Crew 0.8.0 and the Amazon Devices
Builder Tools MCP 1.0.17. Every entry has the same fields: **task**, **steps**, **expected**, **actual**, **severity**,
**workaround**, **suggestion**. Entries are first-hand notes; logs are committed under `evidence/` where we have them. Time cost is given only where we wrote it down at the time ("—" otherwise). Severity: *blocker* (stops the project until worked around), *high* (broke a core path, or gave silently wrong values), *medium* (cost minutes, confusing), *low* (annoyance).

| # | Date | Area | Severity | Time cost |
|---|---|---|---|---|
| 1 | 2026-10-12 | vega-video-sample docs | low | — |
| 2 | 2026-10-12 | Packager | blocker | ≈ 90 min |
| 3 | 2026-10-12 | Home screen (sample) | high | — |
| 4 | 2026-10-12 | W3C media player | high | — |
| 5 | 2026-10-12 | W3C media player | high | — |
| 6 | 2026-10-12 | Amazon's sample BIF | high | silent wrong values |
| 7 | 2026-10-12 | Sample BIF parser | medium | — |
| 8 | 2026-10-12 | KUI SeekBar | medium | — |
| 9 | 2026-10-12 | Logs | medium | every device run |
| 10 | 2026-10-12 | VVD | blocker | resolved 2026-10-13 |
| 11 | 2026-10-12 | Kiro Crew | high | ≈ 40 min |
| 12 | 2026-10-12 | Vega CLI | low | every new shell |
| 13 | 2026-10-12 | Shaka postinstall | medium | — |
| 14 | 2026-10-13 | Release build | medium | — |
| 15 | 2026-10-13 | Builder Tools MCP | low | — |
| 16 | 2026-10-13 | Remote input (`useTVEventHandler`) | high | — |
| 17 | 2026-10-13 | Focus / controls timeout | high | — |
| 18 | 2026-10-13 | VVD | medium | restart between long sessions |

---

### 1 · Node range contradicts itself — 2026-10-12 · low
- **Task:** install the toolchain for `vega-video-sample`.
- **Steps:** read the sample's README, then its `package.json`.
- **Expected:** one supported Node range.
- **Actual:** the README asks for Node 18–20; `package.json` says `engines.node >= 22`. We built with Node 20.20.2 + JDK 21 and it worked; CI later ran on 22.
- **Workaround:** pinned Node 20 + JDK 21 per shell.
- **Suggestion:** one supported Node range, stated in both places.

### 2 · A project under a directory named `assets` builds a broken vpkg — 2026-10-12 · blocker
- **Task:** build and run the sample on the VVD (our first build-and-run check).
- **Steps:** `npm run build:release` and `vega run-app` from a checkout that sat under `…/assets/probe/…`.
- **Expected:** a package that installs and launches, or a build error naming the cause.
- **Actual:** the vpkg's entries embed the host path. The app either installs but hangs in "Creating surfaces" (ANR after about 15 s) or fails to install with "Missing icon file". No message points at the path. About 90 minutes.
- **Workaround:** build from a path with no `assets` component (our repo lives at `…/build/`).
- **Suggestion:** fail the build with a clear message when the project path contains an `assets/` directory, or stop embedding host paths.

### 3 · A one-row, two-tile home screen hangs the app — 2026-10-12 · high
- **Task:** replace the sample's catalogue with one "Matches" row of two titles.
- **Steps:** edit the home data to a single row with two tiles; build; launch on the VVD.
- **Expected:** a short row renders.
- **Actual:** the app hangs at launch (ANR, "Creating surfaces"). Two rows work.
- **Workaround:** two rows, "Matches" and "Witness".
- **Suggestion:** document the minimum item counts of the carousel / grid, or handle short rows.

### 4 · `http://` media URIs are refused, and the error does not say so — 2026-10-12 · high
- **Task:** play our development match from a local static server.
- **Steps:** load an `http://` MP4 URL through the W3C `VideoPlayer`.
- **Expected:** playback, or an error naming the cause.
- **Actual:** the native player logs `isUriSchemeSecure Got an insecure protocol/scheme http`; JS receives only a generic "Streaming Error". JS `fetch` and image loads over http work.
- **Workaround:** serve the match as HLS and play it through Shaka (MSE), which fetches segments in JS.
- **Suggestion:** say "https required for URL sources" in the error the app receives.

### 5 · Loading a large MP4 from a redirecting host kills the app — 2026-10-12 · high
- **Task:** play an Internet Archive MP4 directly.
- **Steps:** `load()` a URL with a 302 redirect, slow first bytes and a 5.6 MB `moov` atom.
- **Expected:** a slow load, or a timeout error.
- **Actual:** the JS thread froze for about 8 s and the Life Cycle Manager killed the app as an ANR.
- **Workaround:** local HLS instead.
- **Suggestion:** keep `load()` off the JS thread, or time out without an ANR.

### 6 · Amazon's hosted `tv-webinar-hd.bif` has a corrupt-looking header — 2026-10-12 · high
- **Task:** read the sample's own BIF as the witness for our parser.
- **Steps:** parse `tv-webinar-hd.bif`; compare the header with the parser's use of it.
- **Expected:** a timestamp multiplier of 1000 or similar, and a catalogue `duration` that matches the video.
- **Actual:** the multiplier field is `0xFFFFD8F0`; the sample parser multiplies it in (about 4.29e9 ms per frame) and works only because `getEndIndex` ignores the parsed times and assumes 10 s. The catalogue entry says `duration: 190` for a 71-minute video. A "binary-search by `positionMillis`" fix would have broken Amazon's own file.
- **Workaround:** Flipbook's `readBif` treats multipliers outside 1 ms–60 s as corrupt and takes the unit from the asset duration, else 10 s (evidence: `evidence/witness-tv-webinar-header.txt`).
- **Suggestion:** fix the hosted file's header; make the sample's lookup use the parsed interval when it is sane.

### 7 · The sample's BIF parser accepts a file with no terminator — 2026-10-12 · medium
- **Task:** feed the parser a truncated BIF in a test.
- **Steps:** drop the `0xffffffff` terminator entry and parse.
- **Expected:** a rejected file.
- **Actual:** a warning is logged and the trailing offset is still trusted, so the last frame is read from a corrupt range.
- **Workaround:** `readBif` rejects it ("No trickplay index for this title").
- **Suggestion:** validate the final offset against `byteLength`.

### 8 · The SeekBar props an app needs are not shown anywhere in the sample — 2026-10-12 · medium
- **Task:** draw our own ticks on the seek bar and take over ⏩ / ⏪.
- **Steps:** look for it in the sample, in the docs, then in `node_modules/@amazon-devices/kepler-ui-components/dist/`.
- **Expected:** an example using `markers` and `partialDisablingConfiguration`.
- **Actual:** both are exactly right for an app that owns fast-forward / rewind, but we found them by reading `dist/`; the sample uses neither. (On 2026-10-13 the Builder Tools MCP's `search_documentation` did return both props with their doc pages — see entry 15 — so the knowledge exists, it is just not where a developer starts.)
- **Workaround:** used both.
- **Suggestion:** show them in the sample.

### 9 · App logs are hard to read on the device — 2026-10-12 · medium
- **Task:** read our own `console.info` lines while testing on the VVD.
- **Steps:** `loggingctl log -f`; try `-S -60s` for history.
- **Expected:** app lines, with history.
- **Actual:** app lines appear only while a follower is attached, mixed into about 100 lines/s of system output; `-S -60s` is unsupported.
- **Workaround:** `loggingctl log -f -o short_precise` piped through grep for `[flipbook]`.
- **Suggestion:** a per-app log tail (`vega logs <pkg>`) with history.

### 10 · The VVD stops drawing, then never boots, after the host screen locks — 2026-10-12 · blocker (resolved 2026-10-13)
- **Task:** record the calibrated scan of our development match.
- **Steps:** the Mac's screen locked at 22:36 WIB with the VVD running; kept working; restarted the VVD at 23:27.
- **Expected:** the VVD keeps running, or restarts.
- **Actual:** the running VVD kept working for a while; from about 23:13 one title's React Native overlay stopped drawing; the restarted VVD never booted (QEMU "hanging thread 'QEMU2 main loop'" after GPU init, also with `--no-gui` and on a fresh instance). The lock is the most likely cause; it is not proven.
- **Workaround:** unlock the Mac and keep the display awake before using the VVD. Confirmed 2026-10-13: with the screen unlocked and the display held awake (`caffeinate -dimsu`), `vega virtual-device start --gui` reported "Virtual device ready" within about 40 s and the owed captures were recorded (`evidence/vvd/README.md`).
- **Suggestion:** detect a locked or asleep host display and say so; offer a software-GL fallback on macOS.

### 11 · `kirocrew run` produced nothing unattended — 2026-10-12 · high
- **Task:** have Kiro Crew write `make-bif` and its round-trip test.
- **Steps:** `kirocrew run TASK.md`, unattended, about 40 min.
- **Expected:** files in our repo, or a clear approval prompt.
- **Actual:** the run uses its own workspace; its write and shell tools were denied by the approval policy; it hit 429 `CREDIT_CONSUMPTION_RATE_EXCEEDED` repeatedly and produced nothing. `kiro-cli chat --no-interactive --trust-all-tools` in the repo did the same task in about 2 minutes (plus our review).
- **Workaround:** used `kiro-cli` headless (evidence: [`docs/KIRO.md`](docs/KIRO.md) and `evidence/kiro/`).
- **Suggestion:** let `kirocrew run` target an existing directory with a pre-approved tool policy.

### 12 · `vega` is not on PATH in a fresh shell — 2026-10-12 · low
- **Task:** run `vega` commands from a new terminal and from scripted sessions.
- **Steps:** open a new shell; run `vega --version`.
- **Expected:** `vega` resolves in any shell.
- **Actual:** command not found in the non-login shells our scripts used until `~/vega/env` was sourced (the SDK's env file).
- **Workaround:** `source ~/vega/env` plus Node 20 / JDK 21 exports, wrapped in a script.
- **Suggestion:** say in the install docs which file to source, so scripted sessions can do it.

### 13 · The Shaka postinstall leaves untracked output and a nested `.git` — 2026-10-12 · medium
- **Task:** `npm install` in a fresh clone of the sample, then commit.
- **Steps:** `npm install` (postinstall builds Shaka); `git status`.
- **Expected:** a clean tree.
- **Actual:** the postinstall needs Python 3 and a JDK, writes `shaka-setup/shaka-player/` (which carries its own `.git`) and generated files under `src/w3cmedia/shakaplayer/dist/`, all untracked. Our monorepo check flagged the nested `.git` as a second repository.
- **Workaround:** gitignored the build output; CI installs with `--ignore-scripts` because Jest and `tsc` do not need Shaka.
- **Suggestion:** document the postinstall's Python/JDK needs and ignore its output in the sample's `.gitignore`.

### 14 · `npm run build:release` rewrites `manifest.toml` — 2026-10-13 · medium
- **Task:** confirm the package still builds after adding the landing page's media under `docs/`.
- **Steps:** `npm run build:release`; `git status`.
- **Expected:** a build artifact only.
- **Actual:** the working tree is dirty afterwards: many `[[needs.module]]` lines were appended to `manifest.toml`. Committing it would change the app manifest as a side effect of a verification step.
- **Workaround:** `git checkout -- manifest.toml` after every release build.
- **Suggestion:** generate the module list into the build directory, not the tracked manifest.

### 15 · Builder Tools MCP: docs and tool output disagree on small things — 2026-10-13 · low
- **Task:** install the Amazon Devices Builder Tools MCP into Kiro and use it.
- **Steps:** `npx -y @amazon-devices/amazon-devices-buildertools-mcp@latest init-context --agent kiro -p <dir> --force`, then `check-status --agent kiro`, then a headless `kiro-cli chat` asking for the tool list and the SeekBar props.
- **Expected:** what the docs page shows: a three-column status table and the agent list on the page (`cursor, cline, kiro, claude-code-cli, claude-code-desktop, github-copilot, amazon-q, other`).
- **Actual:** it worked: Kiro called `list_documents`, `set_project_context` and `search_documentation` and returned the SeekBar docs page (`seekbar.html`, versions 0.21 to 0.24) covering `markers` and `partialDisablingConfiguration`. But the `--agent` option text in `--help` lists six agent types where the docs page (developer.amazon.com/docs/vega/0.24/mcp-server) lists eight (no `claude-code-desktop` or `amazon-q`), the status table has a fourth column (`Agent (--install-agent)`), and `check-status` reports the context document "Not found" (we passed a custom `-p` path) and the agent as "Not installed" (we did not use `--install-agent`), summarising "Partially configured: 1" for a setup that works. The default flow also copied 20 skills into `~/.kiro/skills/`; separately, the first `npx` run printed nine `npm warn deprecated` lines (`evidence/kiro/task-02-npm-warnings.log`).
- **Workaround:** none needed; treat "Not found" for a custom path as expected.
- **Suggestion:** make `check-status` look at the `-p` path (or print where it looked), and bring the docs page in line with `--help`.

---

### 16 · SELECT never reaches `useTVEventHandler` while a view has focus — 2026-10-13 · high
- **Task:** use SELECT to toggle the calibration box between move and resize, and to pick an item in Flipbook's options panel.
- **Steps:** registered `useTVEventHandler` in the player (it receives the arrows, PLAY/PAUSE, MENU and fast-forward); pressed SELECT with the KUI SeekBar focused.
- **Expected:** a `select` event in the handler, like the other keys.
- **Actual:** no `select` event: the platform consumes SELECT as a press on the focused view (the device log shows `Consumed key:Return`). Resize mode and the panel never reacted.
- **Workaround:** while Flipbook takes the keys, the seek bar's own `onPress` is routed to Flipbook (`src/components/Seekbar.tsx`, `FlipbookContext.select`), de-duplicated in case a platform delivers both; tests in `test/flipbook/selectRouting.test.tsx`.
- **Suggestion:** document which keys reach `useTVEventHandler` when a focusable view has focus, or deliver SELECT to the handler as well.

### 17 · Controls that time out unmount the focused view, and focus walks into the screen behind — 2026-10-13 · high
- **Task:** draw the score box with the D-pad while the player's controls are hidden by the sample's 5-second timer.
- **Steps:** opened a title, entered calibration (Flipbook takes every key, so no key re-shows the controls), pressed DOWN seven times, then SELECT.
- **Expected:** the arrows move the box; nothing else happens.
- **Actual:** when the controls timed out the seek bar that held TV focus unmounted; DOWN moved focus into the details screen underneath and SELECT opened a related title.
- **Workaround:** keep the controls mounted while Flipbook takes the keys and trap focus on the seek bar (`src/w3cmedia/mediacontrols/VideoPlayerUI.tsx`, `TVFocusGuideView trapFocus*`); tests in `test/flipbook/playerFocus.test.tsx`.
- **Suggestion:** when the focused view unmounts, keep focus inside the current screen instead of the one underneath.

### 18 · After ~20 minutes the VVD stops drawing text and plain views — 2026-10-13 · medium
- **Task:** record several takes of the app on the VVD in one session.
- **Steps:** VVD up for about 20 minutes with repeated installs, relaunches and screen recordings.
- **Expected:** the app keeps drawing normally.
- **Actual:** text and plain views stopped drawing while icons still drew; it survived an app relaunch; no error in the app's log.
- **Workaround:** `vega virtual-device stop`, then `vega virtual-device start --gui` (about 40 s); everything drew again.
- **Suggestion:** log a renderer or texture-cache error when drawing stops, or recover without a VVD restart.

## Feature requests

| # | Request | Why it matters to Flipbook | Priority |
|---|---|---|---|
| F1 | A pixel read-back API for the player surface (or a frame-grab call) | Flipbook can only look at frames inside a BIF and decodes JPEGs in JS; a read-back call would let any app read live frames. | Important |
| F2 | A BIF lookup in the sample that uses the file's own interval and offset (and a corrected hosted `tv-webinar-hd.bif`) | The sample's per-index lookup and the hosted file's multiplier are why Flipbook reads BIFs with its own parser (entries 6–7). | Important |
| F3 | `vega logs <pkg>` — a per-app log tail with history | entry 9 | Nice-to-have |
| F4 | A VVD that boots with the host display locked, or says it cannot | It cost every on-device capture after the VVD failed to boot (23:27 WIB) (entry 10); it matters most to anyone recording unattended. | Critical |
| F5 | A short-row-safe carousel / grid, or documented minimum item counts | entry 3 | Nice-to-have |
