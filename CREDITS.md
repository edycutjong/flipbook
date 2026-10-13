# Credits and licences

## Code
- Copied (upstream history not kept; not a GitHub fork) from [AmazonAppDev/vega-video-sample](https://github.com/AmazonAppDev/vega-video-sample) at
  `ef8e4da89b22ef7973d0d41beedfa2b42f7bb272` — MIT-0 (see `LICENSE`, `LICENSE-THIRD-PARTY`). Flipbook's own
  additions (`src/flipbook/`, `scripts/`, `test/flipbook/`, `tools/label/`, `fixtures/`) are also released under MIT-0,
  copyright 2026 Edy Cu; `LICENSE` is left exactly as upstream so GitHub detects `MIT-0`.
- [jpeg-js](https://github.com/jpeg-js/jpeg-js) 0.4.4 — BSD-3-Clause (on-device JPEG decode of BIF frames).
- `scripts/make-bif.ts`, `src/flipbook/core/bifWriter.ts`, `test/flipbook/bifWriter.test.ts` were written by Kiro
  (kiro-cli 2.29.1, headless) from our task brief and reviewed; see the commit history.

## Match footage (demo and test data)
All matches are full-match recordings by **Belmont Media Center** (Belmont, MA public-access TV), published on the
Internet Archive under **CC0 1.0** (`https://creativecommons.org/publicdomain/zero/1.0/`, read from each item's
`licenseurl` metadata on 2026-10-12).

| Use | Internet Archive item | File | SHA-1 (archive.org) |
|---|---|---|---|
| Development match (thresholds tuned here only) | [snafuinfinitysoccer-girls_091923-vs-winchester](https://archive.org/details/snafuinfinitysoccer-girls_091923-vs-winchester) | soccer-girls_091923-vs-winchester.mp4 | e4c3982a1a87840f8f2e64ef538235ee4a1d6ce0 |
| Match A (tuning of lead-in after human labels) | [snafuinfinitysoccer-boys_102323-vs-woburn](https://archive.org/details/snafuinfinitysoccer-boys_102323-vs-woburn) | soccer-boys_102323-vs-woburn.mp4 | 36845cd5410ce95fc8ee6655676b6a74816163e7 |
| Match B (held out) | [snafuinfinitysoccer-boys_092124-vs-woburn](https://archive.org/details/snafuinfinitysoccer-boys_092124-vs-woburn) | soccer-boys_092124-vs-woburn.mp4 | 966e9477b6498f5073f73f498c554ede1fb33714 |

Our own obligations (beyond what CC0 requires): the original commentary audio is removed from everything we host
or publish; the matches show high-school students and school marks — the marks belong to the schools, and we use
no close-ups. CC0 covers the recordings, not trademarks.

## Witness BIF
Amazon's own `tv-webinar-hd.bif` and `tv-webinar.mp4`, fetched at run time from the sample's CloudFront domain,
exactly as the sample does. Not redistributed.

## Demo video
- Recorded on the Vega Virtual Device (Apple M-series Mac) with the emulator console's `screenrecord`; device audio
  dropped, original match commentary never used, school crests blurred, time skips labelled on screen.
- The Internet Archive item for the development match carries the video files, thumbnails and metadata only — no
  chapters and no event data (`https://archive.org/metadata/snafuinfinitysoccer-girls_091923-vs-winchester`).
- The Witness title and its BIF are Amazon's own `vega-video-sample` assets, streamed from the sample's CDN (not
  redistributed); slide logos and webcam tiles are blurred in the video.
- Narration: synthetic voice generated with ElevenLabs. Music: our own Suno generation (instrumental). Fonts: Big
  Shoulders Display, Atkinson Hyperlegible, IBM Plex Mono (SIL OFL 1.1, as on the landing page).
