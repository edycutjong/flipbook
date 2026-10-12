#!/usr/bin/env node
/**
 * make-bif — CLI tool to extract trickplay frames from a video and write a Roku BIF file.
 *
 * Usage:
 *   npx tsx scripts/make-bif.ts <video> --out <file.bif> [--interval 10] [--width 320]
 *                               [--letterbox 240x180] [--quality 5]
 *
 * Options:
 *   --out       Output BIF file path (required).
 *   --interval  Seconds between frames (default: 10).
 *   --width     Output JPEG width in pixels (default: 320). Ignored when --letterbox is set.
 *   --letterbox WxH   Scale the frame to fit inside WxH, keeping aspect ratio, and pad
 *                     to exactly WxH with black bars (letterbox / pillarbox). Overrides --width.
 *   --quality   ffmpeg JPEG quality, 2–31, lower = better (default: 5).
 *
 * Outputs:
 *   <out>       BIF file.
 *   <out>.json  Sidecar metadata file.
 *
 * The script is deterministic: identical inputs produce byte-identical output.
 * The SHA-256 of the BIF is printed to stdout at the end.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { writeBif } from '../src/flipbook/core/bifWriter';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  video: string;
  out: string;
  intervalSec: number;
  width: number;
  letterbox: { w: number; h: number } | null;
  quality: number;
} {
  const args = argv.slice(2); // strip 'node' and script name

  let video: string | undefined;
  let out: string | undefined;
  let intervalSec = 10;
  let width = 320;
  let letterbox: { w: number; h: number } | null = null;
  let quality = 5;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--out':
        out = args[++i];
        break;
      case '--interval':
        intervalSec = Number(args[++i]);
        if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
          die('--interval must be a positive number');
        }
        break;
      case '--width':
        width = Number(args[++i]);
        if (!Number.isInteger(width) || width <= 0) {
          die('--width must be a positive integer');
        }
        break;
      case '--letterbox': {
        const spec = args[++i];
        const m = spec.match(/^(\d+)x(\d+)$/i);
        if (!m) die('--letterbox must be in WxH format, e.g. 240x180');
        letterbox = { w: Number(m[1]), h: Number(m[2]) };
        break;
      }
      case '--quality':
        quality = Number(args[++i]);
        if (!Number.isInteger(quality) || quality < 1 || quality > 31) {
          die('--quality must be an integer between 1 and 31');
        }
        break;
      default:
        if (!args[i].startsWith('--')) {
          video = args[i];
        } else {
          die(`Unknown option: ${args[i]}`);
        }
    }
  }

  if (!video) die('Missing positional argument: <video>');
  if (!out) die('Missing required option: --out');

  return { video: video!, out: out!, intervalSec, width, letterbox, quality };
}

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  console.error(
    'Usage: npx tsx scripts/make-bif.ts <video> --out <file.bif> [--interval 10] [--width 320] [--letterbox WxH] [--quality 5]',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Build the ffmpeg -vf filter string. */
function buildVfFilter(
  intervalSec: number,
  width: number,
  letterbox: { w: number; h: number } | null,
): string {
  const fpsFilter = `fps=1/${intervalSec}`;

  if (letterbox) {
    // Scale to fit inside letterbox, keeping aspect ratio, then pad to exact size.
    const scaleFilter = `scale=${letterbox.w}:${letterbox.h}:force_original_aspect_ratio=decrease`;
    const padFilter = `pad=${letterbox.w}:${letterbox.h}:(ow-iw)/2:(oh-ih)/2:black`;
    return `${fpsFilter},${scaleFilter},${padFilter}`;
  }

  return `${fpsFilter},scale=${width}:-2`;
}

/** Run ffmpeg synchronously and return stdout+stderr combined as a string. */
function runFfmpeg(args: string[]): void {
  try {
    execFileSync('/Users/edycu/homebrew/bin/ffmpeg', args, { stdio: 'pipe' });
  } catch (err: unknown) {
    const execErr = err as { stderr?: Buffer; message?: string };
    const stderr = execErr.stderr ? execErr.stderr.toString() : String(execErr.message ?? err);
    throw new Error(`ffmpeg failed:\n${stderr}`);
  }
}

/** Get ffmpeg version string (first line). */
function getFfmpegVersion(): string {
  try {
    const result = execFileSync('/Users/edycu/homebrew/bin/ffmpeg', ['-version'], {
      stdio: 'pipe',
    });
    return result.toString().split('\n')[0].trim();
  } catch {
    return 'unknown';
  }
}

/** Probe the video for width/height using ffprobe. */
function probeVideoDimensions(
  video: string,
): { width: number; height: number } | null {
  try {
    const result = execFileSync(
      path.join(path.dirname('/Users/edycu/homebrew/bin/ffmpeg'), 'ffprobe'),
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=s=x:p=0',
        video,
      ],
      { stdio: 'pipe' },
    );
    const [w, h] = result
      .toString()
      .trim()
      .split('x')
      .map(Number);
    if (w > 0 && h > 0) return { width: w, height: h };
  } catch {
    // ignore — not critical
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { video, out, intervalSec, width, letterbox, quality } =
    parseArgs(process.argv);

  if (!fs.existsSync(video)) {
    die(`Input file not found: ${video}`);
  }

  // Compute source SHA-256 (for the sidecar JSON).
  const sourceBuffer = fs.readFileSync(video);
  const sourceSha256 = sha256Hex(sourceBuffer);

  // Create a temp directory for extracted frames.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-bif-'));

  try {
    const intervalMs = intervalSec * 1000;
    const vfFilter = buildVfFilter(intervalSec, width, letterbox);

    console.log(`Extracting frames (interval=${intervalSec}s) …`);
    runFfmpeg([
      '-i', video,
      '-vf', vfFilter,
      '-q:v', String(quality),
      '-an',
      '-map_metadata', '-1',
      '-fflags', '+bitexact',
      '-flags:v', '+bitexact',
      path.join(tmpDir, 'frame%08d.jpg'),
    ]);

    // Collect frames in deterministic order.
    const frameFiles = fs
      .readdirSync(tmpDir)
      .filter(f => f.endsWith('.jpg'))
      .sort(); // lexicographic = chronological for frame%08d

    if (frameFiles.length === 0) {
      throw new Error('ffmpeg produced no frames — check your input file and interval');
    }

    console.log(`  Extracted ${frameFiles.length} frames.`);

    const frames: Uint8Array[] = frameFiles.map(f =>
      new Uint8Array(fs.readFileSync(path.join(tmpDir, f))),
    );

    // Write the BIF.
    // timestamp k = k (0-based), multiplier = intervalMs → frame k is at k × intervalMs ms.
    const bifBytes = writeBif(frames, { intervalMs, firstTimestamp: 0 });
    const bifBuffer = Buffer.from(
      bifBytes.buffer,
      bifBytes.byteOffset,
      bifBytes.byteLength,
    );
    fs.writeFileSync(out, bifBuffer);
    const bifSha256 = sha256Hex(bifBuffer);

    // Probe actual dimensions of the first extracted frame (for the sidecar).
    let actualWidth = letterbox ? letterbox.w : width;
    let actualHeight = letterbox ? letterbox.h : 0;
    if (!letterbox) {
      const dims = probeVideoDimensions(path.join(tmpDir, frameFiles[0]));
      if (dims) actualHeight = dims.height;
    }

    // Write the sidecar JSON.
    const ffmpegVersion = getFfmpegVersion();
    const sidecar = {
      source: video,
      sourceSha256,
      intervalMs,
      width: actualWidth,
      height: actualHeight,
      mode: letterbox ? 'letterbox' : 'scale',
      quality,
      frames: frameFiles.length,
      frameTimeRule: 'frame k = k*interval s (ffmpeg fps filter)',
      bifSha256,
      ffmpegVersion,
    };
    fs.writeFileSync(`${out}.json`, JSON.stringify(sidecar, null, 2) + '\n');

    console.log(`Written: ${out}`);
    console.log(`Sidecar: ${out}.json`);
    console.log(`BIF SHA-256: ${bifSha256}`);
  } finally {
    // Always clean up temp files.
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
