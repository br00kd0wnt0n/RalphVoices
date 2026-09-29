// B2: the external binaries the audit uses, found once. Any of them can be
// missing: without ffmpeg/ffprobe a video gets no frames (and a clear note),
// without tesseract there's no OCR cross-check.
import fs from 'node:fs';
import path from 'node:path';

export interface Tools { ffmpeg: string | null; ffprobe: string | null; tesseract: string | null }

/** The first executable `bin` on PATH (no child process). */
function which(bin: string): string | null {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, bin);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return null;
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
