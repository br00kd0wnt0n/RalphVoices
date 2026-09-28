// B2: finding assets in a round folder, reading sidecar copy, pulling video
// keyframes with ffmpeg and a tesseract read of every image.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseStub } from './rules.js';
import type { Asset, Frame } from './types.js';
import { defaultTools, type Tools } from './tools.js';

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const VIDEO = /\.(mp4|mov|m4v)$/i;

// Sidecar labels → rules-file field ids. Anything else is kept under its own label
// and still checked for compliance, just without a character limit.
const FIELD_ALIASES: Array<[RegExp, string]> = [
  [/^(meta )?primary( text)?$/i, 'meta_primary'],
  [/^(meta )?headline$/i, 'meta_headline'],
  [/^(meta )?description$/i, 'meta_description'],
  [/^(tiktok )?(hook|on-?screen( text)?)$/i, 'tiktok_hook'],
  [/^(tiktok )?(caption|ad text)$/i, 'tiktok_caption'],
  [/^(voice-?over|vo|transcript)$/i, 'transcript'],

  [/^(cta|call to action|button)$/i, 'cta'],
];

export function fieldFor(label: string): string | null {
  const l = label.trim();
  for (const [re, id] of FIELD_ALIASES) if (re.test(l)) return id;
  return null;
}

/**
 * "Primary text: ..." lines. Only known labels start a field, so copy like
 * "Real talk: vet bills add up" stays inside the field it belongs to; a line
 * without a known label continues the previous field.
 */
export function parseSidecar(text: string): { copy: Record<string, string>; labels: Record<string, string> } {
  const copy: Record<string, string> = {};
  const labels: Record<string, string> = {};
  let cur = '';
  for (const raw of text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^\s*([A-Za-z][A-Za-z \-/]{1,30}?)\s*:\s*(.*)$/.exec(raw);
    const id = m ? fieldFor(m[1]) : null;
    if (m && id) {
      cur = id;
      labels[cur] = m[1].trim();
      copy[cur] = m[2].trim();
    } else if (raw.trim()) {
      if (!cur) { cur = 'untitled'; labels[cur] = 'Unlabelled'; copy[cur] = ''; }
      copy[cur] = `${copy[cur]}\n${raw.trim()}`.trim();
    }
  }
  return { copy, labels };
}

export function videoDuration(file: string, tools: Tools = defaultTools()): number {
  if (!tools.ffprobe) return 0;
  const out = execFileSync(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Number(out.trim()) || 0;
}

export function hasAudio(file: string, tools: Tools = defaultTools()): boolean {
  if (!tools.ffprobe) return false;
  try {
    return execFileSync(tools.ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().length > 0;
  } catch { return false; }
}

/** The soundtrack as 16 kHz mono MP3 (small uploads; plenty for speech). */
export function extractAudio(file: string, out: string, tools: Tools = defaultTools()): string {
  if (!tools.ffmpeg) return file; // the transcription API takes mp4/mov directly (up to 25 MB)
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(tools.ffmpeg, ['-y', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', out]);
  return out;
}

/** Keyframe times: 0, 1.5 s (the hook), then every 3 s, plus the last frame; capped at 8. */
export function keyframeTimes(duration: number, cap = 8): Array<{ at: number; role: Frame['role']; label: string }> {
  const out: Array<{ at: number; role: Frame['role']; label: string }> = [{ at: 0, role: 'first', label: '0.0 s (first frame)' }];
  if (duration > 1.6) out.push({ at: 1.5, role: 'hook', label: '1.5 s (hook)' });
  const last = Math.max(0, duration - 0.1);
  for (let t = 3; t < last - 0.5 && out.length < cap - 1; t += 3) out.push({ at: t, role: undefined, label: `${t.toFixed(1)} s` });
  if (duration > 0.5) out.push({ at: last, role: 'last', label: `${last.toFixed(1)} s (last frame)` });
  return out.slice(0, cap);
}

export function extractKeyframes(file: string, outDir: string, cap = 8, tools: Tools = defaultTools()): { frames: Frame[]; duration: number } {
  if (!tools.ffmpeg || !tools.ffprobe) return { frames: [], duration: 0 };
  fs.mkdirSync(outDir, { recursive: true });
  const duration = videoDuration(file, tools);
  const frames: Frame[] = [];
  keyframeTimes(duration, cap).forEach((k, i) => {
    const p = path.join(outDir, `f${i}-${k.at.toFixed(1)}s.jpg`);
    // Longest side at most 1536 px: what vision reads at detail "high" anyway.
    execFileSync(tools.ffmpeg!, ['-y', '-v', 'error', '-ss', String(k.at), '-i', file, '-frames:v', '1',
      '-vf', "scale='if(gt(iw,ih),min(1536,iw),-2)':'if(gt(iw,ih),-2,min(1536,ih))'", '-q:v', '3', p]);
    if (fs.existsSync(p)) frames.push({ label: k.label, path: p, at: k.at, role: k.role });
  });
  return { frames, duration };
}

/** tesseract's read of one image, as a cross-check on vision. Empty when tesseract isn't installed. */
export function ocr(image: string, tools: Tools = defaultTools()): string {
  if (!tools.tesseract) return '';
  try {
    return execFileSync(tools.tesseract, [image, '-', '--psm', '11'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .replace(/[ \t]+/g, ' ').split('\n').map(s => s.trim()).filter(Boolean).join('\n');
  } catch { return ''; }
}

const byNumber = (a: string, b: string) => {
  const na = Number(/(\d+)/.exec(a)?.[1] ?? NaN), nb = Number(/(\d+)/.exec(b)?.[1] ?? NaN);
  return Number.isNaN(na) || Number.isNaN(nb) || na === nb ? a.localeCompare(b) : na - nb;
};

/**
 * Every asset in a round folder: an image (static), a folder of numbered images
 * (carousel), or a video. Named by naming stub; `<stub>.txt` next to it is the
 * sidecar copy. Frames for video are extracted into workDir/<name>/.
 */
export function discoverRound(roundDir: string, workDir: string, personas?: string[]): Asset[] {
  if (!fs.existsSync(roundDir)) throw new Error(`No round folder at ${roundDir}`);
  const entries = fs.readdirSync(roundDir).filter(n => !n.startsWith('.') && !n.startsWith('_'));
  const sidecars = new Map(entries.filter(n => /\.txt$/i.test(n) && !/\.transcript\.txt$/i.test(n)).map(n => [n.replace(/\.txt$/i, '').toUpperCase(), n]));
  const transcripts = new Map(entries.filter(n => /\.transcript\.txt$/i.test(n)).map(n => [n.replace(/\.transcript\.txt$/i, '').toUpperCase(), n]));
  const assets: Asset[] = [];
  for (const name of entries.sort()) {
    const full = path.join(roundDir, name);
    const isDir = fs.statSync(full).isDirectory();
    if (!isDir && !IMAGE.test(name) && !VIDEO.test(name)) continue;
    const base = isDir ? name : name.replace(/\.[^.]+$/, '');
    const st = parseStub(base, personas);
    const a: Asset = {
      name, stub: 'error' in st ? null : st, stub_error: 'error' in st ? st.error : undefined,
      kind: isDir ? 'carousel' : VIDEO.test(name) ? 'video' : 'static',
      source: full, frames: [], copy: {}, copy_labels: {},
    };
    if (isDir) {
      const cards = fs.readdirSync(full).filter(n => IMAGE.test(n)).sort(byNumber);
      a.frames = cards.map((c, i) => ({ label: `card ${i + 1}`, path: path.join(full, c), role: 'card' as const }));
      const inner = fs.readdirSync(full).find(n => /\.txt$/i.test(n) && !/transcript/i.test(n));
      if (inner) Object.assign(a, sidecarOf(path.join(full, inner)));
      const innerT = fs.readdirSync(full).find(n => /transcript\.txt$/i.test(n));
      if (innerT) a.transcript = fs.readFileSync(path.join(full, innerT), 'utf8').trim();
    } else if (a.kind === 'video') {
      const { frames, duration } = extractKeyframes(full, path.join(workDir, 'frames', base));
      a.frames = frames; a.duration = duration; a.has_audio = hasAudio(full);
    } else {
      a.frames = [{ label: 'image', path: full, role: 'first' }];
    }
    const sc = sidecars.get(base.toUpperCase());
    if (sc) Object.assign(a, sidecarOf(path.join(roundDir, sc)));
    const tr = transcripts.get(base.toUpperCase());
    if (tr) a.transcript = fs.readFileSync(path.join(roundDir, tr), 'utf8').trim();
    if (a.copy.transcript && !a.transcript) a.transcript = a.copy.transcript;
    delete a.copy.transcript;
    if (a.transcript) a.transcript_source = 'sidecar';
    assets.push(a);
  }
  return assets;
}

function sidecarOf(p: string): { copy: Record<string, string>; copy_labels: Record<string, string> } {
  const { copy, labels } = parseSidecar(fs.readFileSync(p, 'utf8'));
  return { copy, copy_labels: labels };
}
