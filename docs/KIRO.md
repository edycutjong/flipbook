# How Kiro was used in Flipbook (AWS Builder)

Everything here is first-hand and has a log in [`evidence/kiro/`](../evidence/kiro/). What did not work is listed too.

| What | Tool | Result | Evidence |
|---|---|---|---|
| Wrote the BIF writer (`src/flipbook/core/bifWriter.ts`), the `make-bif` CLI (`scripts/make-bif.ts`) and 18 round-trip tests (`test/flipbook/bifWriter.test.ts`) from a written brief, including a regression fixture with the header of Amazon's `tv-webinar-hd.bif` | **Kiro CLI** 2.29.1, `kiro-cli chat --no-interactive --trust-all-tools`, in the repo, about two minutes | 3 files, 18 tests passing, `tsc` clean; we then reviewed and changed it (ffmpeg from PATH, streamed source hash, no local paths in the sidecar) | commits `024142d` (Kiro's output) and `154bda2` (our review fixes); log `evidence/kiro/task-01-kiro-cli.log` |
| Installed the **Amazon Devices Builder Tools MCP** (1.0.17) into Kiro: `init-context --agent kiro` | Builder Tools MCP + Kiro | MCP server registered in Kiro's settings; context document and Vega skills copied; `check-status` reports "MCP Configuration ✅ Configured" (Context Document "Not found" because we wrote it to a scratch directory) | `evidence/kiro/task-02-init-context.log`, `task-02-check-status.log` |
| Used the MCP from Kiro: asked it for the server's tool list and whether the SeekBar documents `markers` and `partialDisablingConfiguration` | Kiro CLI → `list_documents`, `set_project_context`, `search_documentation` | Returned the nine tools (`analyze_perfetto_traces`, `get_app_hot_functions`, `list_documents`, `read_document`, `read_asset`, `report_workflow_status`, `search_documentation`, `set_project_context`, `symbolicate_acr`) and the two SeekBar docs pages, which are the props Flipbook uses | `evidence/kiro/task-02-kiro-uses-mcp.log` |

## What did not work

- **`kirocrew run`** (Kiro Crew 0.8.0), unattended, on the first task: no files produced in about 40 minutes. Its write and shell
  tools were denied by the approval policy and the backend returned HTTP 429 `CREDIT_CONSUMPTION_RATE_EXCEEDED` 14 times. We
  stopped it and used `kiro-cli` instead. Run-level transcript: `evidence/kiro/kirocrew-run-attempt.md`. (Friction log entry 11.)
- **No performance profiling.** `analyze_perfetto_traces` / `get_app_hot_functions` were not run: no perfetto trace was captured
  because the Vega Virtual Device has not booted since the host screen locked (friction log entry 10).
- **No runtime AWS service** (Bedrock, AgentCore, SageMaker, S3 ...) is called by the app.

Kiro never touched the detector (`src/flipbook/core/detector.ts`, `scan.ts`, `signature.ts`), which is plain arithmetic.
