// Asset sizes for Pre-flight (Brook, 30 Sep; the client's WBS): statics and hero
// videos come in 1:1, 4:5 and 9:16, carousels in 1:1 and 4:5, TikTok in 9:16.
// One code (ad) carries a file per size (a carousel: its cards in each size) and
// Meta picks the size per placement. Each size is audited on its own.
//
// Stored without a migration: a file's size is in studio_upload_files.role
// ('asset:4x5'), and its position is size slot × 100 + card. Uploads from
// before sizes have role 'asset' and read as their detected size.

import fs from 'node:fs';
import { parseCode } from '../../utils/namingCode.js';

export type Size = '1:1' | '4:5' | '9:16';
export const SIZES: Size[] = ['1:1', '4:5', '9:16'];
const RATIO: Record<Size, number> = { '1:1': 1, '4:5': 0.8, '9:16': 0.5625 };
/** How far off a ratio can be and still count (5%: 1080×1350 is 4:5, 1080×1340 too). */
export const SIZE_TOLERANCE = 0.05;

export const sizeSlug = (s: Size) => s.replace(':', 'x');
export const roleOf = (s: Size) => `asset:${sizeSlug(s)}`;
export const slotOf = (s: Size) => SIZES.indexOf(s);
/** The size stored on a file's role, or null for an upload from before sizes. */
export function sizeOfRole(role: string): Size | null {
  const m = /^asset:(\d+)x(\d+)$/.exec(role || '');
  const s = m ? (`${m[1]}:${m[2]}` as Size) : null;
  return s && SIZES.includes(s) ? s : null;
}
export function parseSize(x: unknown): Size | null {
  const s = String(x ?? '').trim().replace(/x/i, ':') as Size;
  return SIZES.includes(s) ? s : null;
}

/** Snap width × height to 1:1, 4:5 or 9:16 (within the tolerance), or null. */
export function snapSize(w: number, h: number): Size | null {
  if (!(w > 0 && h > 0)) return null;
  const r = w / h;
  let best: Size | null = null, off = Infinity;
  for (const s of SIZES) { const d = Math.abs(r - RATIO[s]) / RATIO[s]; if (d < off) { off = d; best = s; } }
  return off <= SIZE_TOLERANCE ? best : null;
}

/** Width and height from a PNG, JPEG, GIF or WebP header; null for anything else (video, or a file too short). */
export function imageDims(b: Buffer): { w: number; h: number } | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('latin1', 12, 16) === 'IHDR') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length >= 10 && b.toString('latin1', 0, 3) === 'GIF') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const t = b.toString('latin1', 12, 16);
    if (t === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (t === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (t === 'VP8L') { const v = b.readUInt32LE(21); return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) }; }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** A size named in a file name: "…_4x5.png", "hero-9x16.mp4", "1080x1350". */
export function sizeFromName(name: string): Size | null {
  const m = /(?:^|[^0-9])(1x1|4x5|9x16|1:1|4:5|9:16)(?![0-9])/i.exec(name || '');
  if (m) return parseSize(m[1]);
  const d = /(?:^|[^0-9])(\d{3,4})x(\d{3,4})(?![0-9])/i.exec(name || '');
  return d ? snapSize(Number(d[1]), Number(d[2])) : null;
}

/** A file's size: from its pixels (images), else its name; null when neither says. */
export function detectSize(f: { filename: string; buffer?: Buffer; path?: string }): Size | null {
  let head: Buffer | undefined = f.buffer?.subarray(0, 65536);
  if (!head && f.path) {
    try { const fd = fs.openSync(f.path, 'r'); head = Buffer.alloc(65536); const n = fs.readSync(fd, head, 0, 65536, 0); fs.closeSync(fd); head = head.subarray(0, n); } catch { head = undefined; }
  }
  const d = head ? imageDims(head) : null;
  return (d && snapSize(d.w, d.h)) || sizeFromName(f.filename);
}

/**
 * The sizes a code is expected in: TikTok 9:16; a carousel 1:1 and 4:5; a static or video 1:1, 4:5 and 9:16. The rules
 * can override per format (`preflight.sizes`, e.g. { "CAR": ["1:1", "4:5"] }; formats as in codes: ST, CAR, VID, UGC, TT).
 */
export function expectedSizes(code: string, rules?: any): Size[] {
  const p = parseCode(code, null);
  const format = 'error' in p ? '' : p.platform === 'TT' ? 'TT' : p.format;
  const custom = rules?.preflight?.sizes?.[format];
  if (Array.isArray(custom)) { const s = custom.map(parseSize).filter(Boolean) as Size[]; if (s.length) return s; }
  if (format === 'TT') return ['9:16'];
  if (format === 'CAR') return ['1:1', '4:5'];
  return ['1:1', '4:5', '9:16'];
}
