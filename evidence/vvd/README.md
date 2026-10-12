# Vega Virtual Device logs (Apple M-series Mac, VVD from Vega SDK 0.24.12112)

Lines are the app's own `[flipbook] …` log lines and the sample parser's `Parsing BIF with …` line, extracted from
`loggingctl log -f` on the VVD. Timestamps are device UTC (WIB = UTC+7).

| File | Build | Title | What it shows |
|---|---|---|---|
| `witness-v1-flipbook-lines.log` (15:45:57–15:47:09 UTC) | commit 5be6a4a (detector v1) | Witness: Amazon's `tv-webinar-hd.bif` (428 frames, multiplier field 0xFFFFD8F0) | the scan running on the device: `pass1 done n=203/428 markers=34 ms=4085` (≈20 ms per decoded frame, pass 1), `pass2 done added=2 lost=0 … ms=4745` (pass-2 decode count not logged by that build); two ⏩ jumps: `seek from=50572ms currentTime=199.1` then `after seek currentTime=199.1` 1.5 s later — `from` is the time before the press, and the value after equals the target, so no extra 30 s OS seek stacked on the jump; `box saved` = the AsyncStorage write succeeded (read-back across a relaunch is NOT shown: each reinstall wiped app data) |
| `devmatch-v2-flipbook-lines.log` (16:13–16:26 UTC) | commits 8cd29ac–6cfcb7e (detector v2) | Development match, local HLS + BIF | `Parsing BIF with 517 images and a timestamp multiplier of 10000` (the sample's own parser on our BIF, on device); BIF fetch 805–3,854 ms; calibration entered; two scans with the box on or one step off its default (y=0.79, then 0.80) — NOT on the graphic → `mask kept=0%`, 0 markers: the expected result of an uncalibrated box, not a detection result |

Not yet captured on the VVD: a calibrated v2 scan of the development match, 20-run timings, a 100-frame decode median,
a thumbnail-mask screenshot, and the full Open → Scan → Jump recording. The Mac's screen locked at 22:36 WIB
(15:36 UTC; `CGSSessionScreenLockedTime` from `ioreg`). The already-running VVD kept working (both logs above are after
the lock); from about 23:13 WIB the dev title's calibration overlay did not draw, and after a VVD restart at 23:27 WIB
the VVD never booted again (QEMU "hanging thread" after GPU init, also with `--no-gui` and on a fresh instance). The
lock is the most likely cause; it is not proven.
