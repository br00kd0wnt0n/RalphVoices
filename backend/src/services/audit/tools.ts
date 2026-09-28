// B2: the external binaries the audit uses, found once. Any of them can be
// missing: without ffmpeg/ffprobe a video gets no frames (and a clear note),
// without tesseract there's no OCR cross-check.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface Tools { ffmpeg: string | null; ffprobe: string | null; tesseract: string | null }

function which(bin: string): string | null {
  try { return execFileSync('which', [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}
const exists = (p?: string | null) => (p && fs.existsSync(p) ? p : null);

/** ffmpegPath if given (ffprobe beside it), else PATH. `tesseract: false` turns OCR off. */
export function detectTools(o: { ffmpegPath?: string; ffprobePath?: string; tesseractPath?: string | false } = {}): Tools {
  const ffmpeg = exists(o.ffmpegPath) || (o.ffmpegPath ? null : which('ffmpeg'));
  const beside = ffmpeg ? path.join(path.dirname(ffmpeg), 'ffprobe') : null;
  const ffprobe = exists(o.ffprobePath) || exists(beside) || which('ffprobe');
  const tesseract = o.tesseractPath === false ? null : exists(o.tesseractPath || null) || which('tesseract');
  return { ffmpeg, ffprobe, tesseract };
}

let cached: Tools | null = null;
/** The tools on PATH (the CLI's default). */
export function defaultTools(): Tools { return (cached ||= detectTools()); }
