# Security policy

Flipbook is a hackathon prototype that runs on the Vega virtual device. It holds no accounts, tokens or user data:
the scan reads a trickplay (BIF) file the app already downloads, and the only thing stored on the device is the
calibration box.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting (Security tab → Report a vulnerability) rather than a public issue.
Expect a first reply within a few days.

## What is checked automatically

- gitleaks over the full git history on every push and pull request (`.github/workflows/security.yml`)
- CodeQL for JavaScript/TypeScript (`.github/workflows/codeql.yml`)
- `npm audit` on production dependencies, report-only (the open advisories are in the sample's React Native CLI chain and `xmldom`, not in Flipbook's code)
- Dependabot for npm and GitHub Actions (`.github/dependabot.yml`)

Most of the dependency tree comes from Amazon's `vega-video-sample`; advisories there are tracked but are not
always ours to fix.
