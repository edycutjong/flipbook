# Demo video — provenance

How the demo video was made, so its claims can be checked. The video file itself is linked from the Devpost page once it is
uploaded; everything on screen that is product footage was recorded on the Vega Virtual Device.

## Picture
- **Device captures:** Vega Virtual Device (Vega SDK 0.24.12112) on an Apple M-series Mac, recorded with the emulator
  console's `screenrecord` (1920×1080). App builds and on-device log lines for every take: `../vvd/README.md`
  (`devmatch-v2-calibrated-lines.log`, `devmatch-head-lines.log`, `witness-v2-flipbook-lines.log`). The app's own
  overlays (status line, toasts, options panel, calibration card, seek-bar ticks, masked previews, engine log) are
  shown exactly as the device drew them.
- **Edits:** device audio dropped; the school crests inside the broadcast's score graphic blurred (feathered masks);
  the match's opening school-logo frame, which flashes for about 0.15 s while the player starts, filled black.
  Speed-ups are labelled on screen (×2, ×4); where a scene skips time inside one recording the skipped seconds are
  shown; scenes are joined by a wipe and the blind-mode scene joins two takes. Key caps mark the remote keys sent to
  the device, timed from the capture's key log. Zooms and a magnified seek-bar inset are crops of the same frames.
- **Cards and diagrams** (title, problem illustration, contact sheet, mechanism, evidence, limits, close) are motion
  graphics built from this repo's own data: the development match's BIF frames (`fixtures/winchester-2023-320.bif`),
  the recorded scan (`bench/dev-winchester-320-trace.json`), the benchmark (`bench/dev-winchester-320.json`) and the
  device timings (`bench/dev-winchester-320-vvd.json`). The problem scene is labelled on screen as an illustration
  (real BIF frames, scripted scrub).

## Narration
Synthetic voice, ElevenLabs text-to-speech, one voice for every take. The captions file (`.en.srt`, to be uploaded with the
video) is the narration script.

| Take | Generated (UTC) | Voice id ("Daniel") | Model | Length |
|---|---|---|---|---|
| `vo01_cold` | 2026-10-13T13:52:39 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 7.06 s |
| `vo02_never` | 2026-10-13T11:04:50 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 2.51 s |
| `vo03_title` | 2026-10-13T07:20:05 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 2.69 s |
| `vo04_problem` | 2026-10-13T13:52:41 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 11.84 s |
| `vo06_insight` | 2026-10-13T11:04:57 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 13.84 s |
| `vo07_mechanism` | 2026-10-13T07:20:16 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 15.23 s |
| `vo08_device` | 2026-10-13T07:20:18 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 7.85 s |
| `vo09_blind` | 2026-10-13T07:20:20 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 7.48 s |
| `vo10_mask` | 2026-10-13T07:20:22 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 4.46 s |
| `vo11_highlights` | 2026-10-13T07:20:24 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 5.39 s |
| `vo12_jump2` | 2026-10-13T07:20:26 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 6.04 s |
| `vo13_log` | 2026-10-13T07:24:56 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 11.15 s |
| `vo13b_vega` | 2026-10-13T13:52:43 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 6.87 s |
| `vo14_evidence` | 2026-10-13T15:04:29 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 18.20 s |
| `vo15_witness` | 2026-10-13T07:21:32 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 15.28 s |
| `vo16_limits` | 2026-10-13T15:04:53 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 11.66 s |
| `vo17_close` | 2026-10-13T07:20:38 | `onwK4e9ZLuTAKqWW03F9` | `eleven_multilingual_v2` | 3.39 s |

## Music
An instrumental bed we generated earlier with Suno (model V4_5ALL, task `23d528d9ee784b4e3abc99553679ad38`, downloaded
2026-06-28) for another of our projects, reused because no Suno credits were left on 2026-10-13. MD5 of the file used:
`18454ecfff9f0841b8f457be95e4b4bd`. No third-party music.

## Mix
Narration over the bed, the bed ducked under speech; master loudness −16 LUFS integrated, true peak below −1.5 dBTP
(EBU R128, measured with ffmpeg `ebur128`). Under 3:00.
