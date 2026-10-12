# Vega Virtual Device logs (Apple M-series Mac, VVD from Vega SDK 0.24.12112)

Lines are the app's own `[flipbook] …` log lines and the sample parser's `Parsing BIF with …` line, extracted from
`loggingctl log -f` on the VVD. Timestamps are device UTC.

| File | Build | Title | What it shows |
|---|---|---|---|
| `fb-applog3-flipbook-lines.log` (15:45–15:47) | commit 5be6a4a (detector v1) | Witness: Amazon's `tv-webinar-hd.bif` (428 frames, multiplier field 0xFFFFD8F0) | on-device scan: `pass1 done n=203/428 markers=34 ms=4085`, `pass2 done added=2 lost=0 … ms=4745`, `video bytes decoded=0`; two ⏩ jumps with `currentTime` 1.5 s after the seek equal to the target (no stacked OS seek); box persisted (`box saved`) |
| `fb-applog4-flipbook-lines.log` (16:13–16:26) | commits 8cd29ac–6cfcb7e (detector v2) | Development match, local HLS + BIF | `Parsing BIF with 517 images and a timestamp multiplier of 10000` (the sample's parser on our BIF); BIF fetch 805–3,854 ms; calibration entered; two scans with the box left at its default position (not on the graphic) → `mask kept=0%`, 0 markers — the expected result of an uncalibrated box, not a detection result |

Not yet captured on the VVD (blocked: the host screen locked at 22:36 WIB and the VVD would not boot again — FRICTION_LOG #10):
a calibrated v2 scan of the development match, 20-run timings, and the full Open → Scan → Jump recording.
