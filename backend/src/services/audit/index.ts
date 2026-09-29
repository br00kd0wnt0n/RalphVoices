// B2 pre-flight audit as a library: the engine behind the hosted Studio's
// Pre-flight step (and under scripts/audit.ts).
//
//   estimateAudit(input, opts)  → Promise<{ calls, usd, seconds }>
//   runAudit(input, opts)       → AuditReport (JSON, report_version 1)
//   featuresRow(report)         → one row for B3's `weekly.ts features --file`
//
// Nothing here reads the Claude outputs folders: the rules, the rubric and the
// files come in as arguments. Temporary files (frames, audio) go under tmpDir
// and are removed when the audit ends. Flags with sources; never a score.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuditApi, type OpenAILike } from './api.js';
import { extractKeyframes, hasAudio, keyframeTimes, videoDuration } from './assets.js';
import { CONFIG } from './config.js';
import { COPY_FIELDS, type SignedOffCopy } from './copyMatch.js';
import { auditAsset, estimateAsset, type Persona, type Progress } from './engine.js';
import { parseStub } from './rules.js';
import { detectTools, type Tools } from './tools.js';
import type { Asset, AssetAudit, Flag, Frame, Rubric, Rules } from './types.js';

export const REPORT_VERSION = 1;

export interface AuditFile { name: string; mime: string; data: Buffer }

export interface AuditInput {
  stub: string;                        // PERSONA_TERRITORY_FORMAT_v#_PLATFORM
  persona?: string;                    // intended persona; defaults to the stub's
  files: AuditFile[];                  // one image (static), several (carousel, in name order) or one video
  copy?: SignedOffCopy;                // the signed-off copy for the stub: checked, and matched against the asset
  transcript?: string;                 // voice-over; if absent and the video has sound, it's transcribed
}

export interface AuditOptions {
  rules: Rules;                        // the Studio rules file (v2.3+), parsed
  rubric: Rubric;                      // the M3 rubric (features' wordings), parsed
  openai: OpenAILike;                  // an OpenAI SDK client (new OpenAI({ apiKey }))
  personas?: Record<string, { name?: string; seed?: any; voice?: string }>;  // for the skeptic's voice; defaults to the rules' persona names
  onProgress?: (e: Progress) => void;
  ffmpegPath?: string;                 // else ffmpeg on PATH; without it video gets no frames (noted in the report)
  tesseractPath?: string | false;      // else tesseract on PATH; false turns the OCR cross-check off
  tmpDir?: string;                     // default os.tmpdir()
  tpm?: number;                        // gpt-4o tokens per minute to pace to (default config: 15000)
  capUsd?: number;                     // stop the audit if its own spend would pass this
  concurrency?: number;                // default 3
}

export interface ReportFlag {
  severity: 'red' | 'amber' | 'grey';
  rule: string;                        // rules-file id, or COPY_MATCH / COPY_CAVEAT / TEXT_LOAD / LIMIT_* / NAMING
  rule_text: string;
  source: string;
  quote: string | null;                // the words it rests on (or what the image shows)
  where: string | null;                // "card 2", "1.5 s (hook)", "Meta headline", "voice-over"
  frame_index: number | null;          // index into frames[], when the flag is on an image or frame
  why: string | null;
  by: string[];                        // rule, ocr, model (reviewer), yesno
  p: number | null;                    // averaged P(Yes) of the two wordings, when asked
  persona: string | null;              // for turn-offs
}

export interface AuditReport {
  report_version: number;
  stub: string | null;
  stub_error: string | null;
  persona: string | null;
  persona_name: string | null;
  territory: string | null;
  angle: string | null;
  kind: 'static' | 'carousel' | 'video' | 'text';
  rules_version: string;
  rubric_version: string;
  created_at: string;
  flags: ReportFlag[];                 // for the intended persona (red, amber, grey), red first
  cross_persona: ReportFlag[];         // the other personas' turn-offs, as grey notes (how the asset travels)
  set_aside: Array<{ rule: string; quote?: string; why: string }>;  // raised by one layer, contradicted by another; not flags
  counts: { red: number; amber: number; grey: number };
  features: Record<string, number>;    // feature id → averaged P(Yes)
  tagged_features: string[];           // P(Yes) ≥ feature_threshold: what B3 learns from
  frames: Array<{ index: number; label: string; at: number | null; text: string; ocr_only: string[]; description: string }>;
  transcript: { text: string; source: string } | null;
  clarity: {
    glance: { p: number | null; ok: boolean | null };
    product: { p: number | null; ok: boolean | null };
    text_load: { words: number; where: string; max: number; over: boolean } | null;
    brand_by_hook: { p: number | null; ok: boolean | null } | null;   // video only: the 1.5 s frame
    brand_at_end: { p: number | null; ok: boolean | null } | null;    // video only: the last frame
  };
  copy_match: Array<{ field: string; signed_off: string; found: string; similarity: number; status: string }>;
  objection: string;                   // the skeptic, in the intended persona's voice
  yesno: Record<string, { p: number; pa: number | null; pb: number | null }>;
  notes: string[];
  errors: string[];
  cost: { usd: number; calls: number };
  timings: { total_s: number; stages: Record<string, number> };
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v)$/i;
const isVideo = (f: AuditFile) => /^video\//.test(f.mime) || VIDEO_EXT.test(f.name);
const isImage = (f: AuditFile) => /^image\//.test(f.mime) || IMAGE_EXT.test(f.name);
const byNumber = (a: AuditFile, b: AuditFile) => {
  const na = Number(/(\d+)/.exec(a.name)?.[1] ?? NaN), nb = Number(/(\d+)/.exec(b.name)?.[1] ?? NaN);
  return Number.isNaN(na) || Number.isNaN(nb) || na === nb ? a.name.localeCompare(b.name) : na - nb;
};
const safe = (name: string, i: number) => `${String(i + 1).padStart(2, '0')}-${path.basename(name).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)}`;

/** Signed-off copy → the copy fields the rule checks see (limits, price lead). On-image text isn't a field. */
function copyFields(copy: SignedOffCopy = {}): { copy: Record<string, string>; labels: Record<string, string> } {
  const out: Record<string, string> = {}, labels: Record<string, string> = {};
  for (const [k, v] of Object.entries(copy) as Array<[keyof SignedOffCopy, string | undefined]>) {
    const def = COPY_FIELDS[k];
    if (!def?.field || !v || !v.trim()) continue;
    out[def.field] = v;
    labels[def.field] = def.label;
  }
  return { copy: out, labels };
}

function stubOf(input: AuditInput, rules: Rules) {
  const st = parseStub(input.stub, Object.keys(rules.personas));
  return 'error' in st ? { stub: null, error: st.error } : { stub: st, error: undefined };
}

function kindOf(files: AuditFile[]): { kind: Asset['kind']; media: AuditFile[] } {
  const videos = files.filter(isVideo), images = files.filter(isImage);
  if (videos.length > 1) throw new Error('One video per audit: got ' + videos.length);
  if (videos.length) return { kind: 'video', media: videos };
  if (!images.length) throw new Error('No image or video in files (by mime type or extension)');
  return { kind: images.length > 1 ? 'carousel' : 'static', media: [...images].sort(byNumber) };
}

/** Write the files, pull keyframes, and build the engine's asset. */
async function materialise(input: AuditInput, rules: Rules, dir: string, tools: Tools): Promise<Asset> {
  const { kind, media } = kindOf(input.files);
  const { stub, error } = stubOf(input, rules);
  const paths = media.map((f, i) => { const p = path.join(dir, safe(f.name, i)); fs.writeFileSync(p, f.data); return p; });
  const { copy, labels } = copyFields(input.copy);
  const a: Asset = {
    name: input.stub, stub, stub_error: error, persona: input.persona || stub?.persona, kind, source: paths[0],
    frames: [], copy, copy_labels: labels,
    transcript: input.transcript?.trim() || undefined, transcript_source: input.transcript?.trim() ? 'sidecar' : undefined,
  };
  if (kind === 'video') {
    const { frames, duration } = await extractKeyframes(paths[0], path.join(dir, 'frames'), 8, tools);
    a.frames = frames; a.duration = duration; a.has_audio = await hasAudio(paths[0], tools);
  } else {
    a.frames = paths.map((p, i): Frame => ({ label: kind === 'carousel' ? `card ${i + 1}` : 'image', path: p, role: kind === 'carousel' ? 'card' : 'first' }));
  }
  return a;
}

function personasFor(rules: Rules, given?: AuditOptions['personas']): Record<string, Persona> {
  return Object.fromEntries(Object.entries(rules.personas).map(([code, p]) => [code, {
    code, name: given?.[code]?.name || p.name, seed: given?.[code]?.seed ?? null, voice: given?.[code]?.voice || '',
  }]));
}

/**
 * Calls, cost and time before running. For video it probes the duration
 * (ffprobe) to count keyframes and audio minutes; nothing is sent to OpenAI.
 */
export async function estimateAudit(input: AuditInput, opts: Pick<AuditOptions, 'rules' | 'rubric' | 'ffmpegPath' | 'tmpDir' | 'tpm' | 'concurrency'>): Promise<{ calls: number; usd: number; seconds: number }> {
  const tools = detectTools({ ffmpegPath: opts.ffmpegPath, tesseractPath: false });
  const dir = fs.mkdtempSync(path.join(opts.tmpDir || os.tmpdir(), 'voices-audit-est-'));
  try {
    const { kind, media } = kindOf(input.files);
    const { stub, error } = stubOf(input, opts.rules);
    const paths = media.map((f, i) => { const p = path.join(dir, safe(f.name, i)); fs.writeFileSync(p, f.data); return p; });
    let frames: Frame[] = paths.map(p => ({ label: 'image', path: p }));
    let duration = 0, audio = false;
    if (kind === 'video') {
      duration = await videoDuration(paths[0], tools);
      audio = (await hasAudio(paths[0], tools)) || !tools.ffprobe;
      // Frame size for the token count: 1080×1920 (vertical video) is the common case.
      frames = tools.ffprobe ? keyframeTimes(duration).map(() => ({ label: 'frame', path: paths[0] })) : [];
    }
    const { copy, labels } = copyFields(input.copy);
    const a: Asset = { name: input.stub, stub, stub_error: error, kind, source: paths[0], frames, copy, copy_labels: labels, transcript: input.transcript || undefined, has_audio: audio, duration };
    const api = new AuditApi({ mock: () => ({ text: '', top: [], usd: 0, usage: {} }), ffprobe: tools.ffprobe });
    const e = estimateAsset(a, { api, rules: opts.rules, rubric: opts.rubric });
    // Rate-bound on gpt-4o, with a latency floor per call (measured 28 Sep: a static ~80 s at 22k TPM).
    const tpm = opts.tpm || CONFIG.tpm_default;
    const seconds = Math.round(Math.max((e.tokens / tpm) * 60, (e.calls / (opts.concurrency || 3)) * 1.6) + frames.length * 6);
    return { calls: e.calls, usd: Math.round(e.usd * 1000) / 1000, seconds };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Run the audit on one asset. Throws only on bad input or a fatal API error (out of credits, cap reached). */
export async function runAudit(input: AuditInput, opts: AuditOptions): Promise<AuditReport> {
  const tools = detectTools({ ffmpegPath: opts.ffmpegPath, tesseractPath: opts.tesseractPath });
  const dir = fs.mkdtempSync(path.join(opts.tmpDir || os.tmpdir(), 'voices-audit-'));
  const t0 = Date.now();
  try {
    const asset = await materialise(input, opts.rules, dir, tools);
    const api = new AuditApi({
      client: opts.openai, capUsd: opts.capUsd, ffprobe: tools.ffprobe,
      tpm: { [CONFIG.models.yesno]: opts.tpm || CONFIG.tpm_default, [CONFIG.models.compliance]: 150000 },
      transcribeUsdPerMinute: CONFIG.transcribe_usd_per_minute,
    });
    const audit = await auditAsset(asset, {
      api, rules: opts.rules, rubric: opts.rubric, workDir: dir, tools,
      personas: personasFor(opts.rules, opts.personas), signedOff: input.copy,
      onProgress: opts.onProgress, concurrency: opts.concurrency,
    });
    return toReport(audit, opts.rules, opts.rubric, { stub_error: asset.stub_error, total_s: (Date.now() - t0) / 1000 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The engine's result as the stable report JSON. Also used by the CLI. */
export function toReport(a: AssetAudit, rules: Rules & { territories?: Record<string, { angle?: string }> }, rubric: Rubric, extra: { stub_error?: string; total_s?: number } = {}): AuditReport {
  const labelIndex = new Map(a.frames.map((f, i) => [f.label, i]));
  const conv = (f: Flag): ReportFlag => ({
    severity: f.severity, rule: f.rule, rule_text: f.label, source: f.source,
    quote: f.quote ?? null, where: f.where ?? null, frame_index: f.where !== undefined && labelIndex.has(f.where) ? labelIndex.get(f.where)! : null,
    why: f.why ?? null, by: [...new Set(f.by)], p: f.p ?? null, persona: f.persona ?? null,
  });
  const cross = a.flags.filter(f => f.persona && a.persona && f.persona !== a.persona && f.severity === 'grey');
  const own = a.flags.filter(f => !cross.includes(f));
  const yn = (id: string) => (a.items[id] ? { p: a.items[id].p, ok: a.items[id].p >= 0.5 } : { p: null, ok: null });
  const parts = a.stub?.split('_') || [];
  const territory = parts.length >= 5 ? parts.slice(1, -3).join('_') : null;
  const terrKey = a.stub ? parts.slice(0, -3).join('_') : '';
  const tagged = Object.entries(a.features).filter(([, p]) => p >= CONFIG.feature_threshold).map(([k]) => k).sort();
  return {
    report_version: REPORT_VERSION,
    stub: a.stub, stub_error: extra.stub_error ?? null, persona: a.persona,
    persona_name: a.persona ? rules.personas[a.persona]?.name ?? null : null,
    territory, angle: rules.territories?.[terrKey]?.angle ?? null,
    kind: a.kind, rules_version: rules.version, rubric_version: rubric.version, created_at: new Date().toISOString(),
    flags: own.map(conv), cross_persona: cross.map(conv), set_aside: a.set_aside,
    counts: { red: own.filter(f => f.severity === 'red').length, amber: own.filter(f => f.severity === 'amber').length, grey: own.filter(f => f.severity === 'grey').length },
    features: a.features, tagged_features: tagged,
    frames: a.frames.map((f, i) => ({ index: i, label: f.label, at: (() => { const m = /^([\d.]+) s/.exec(f.label); return m ? Number(m[1]) : null; })(), text: f.text, ocr_only: f.ocr_only, description: f.description })),
    transcript: a.transcript,
    clarity: {
      glance: yn('one_glance'), product: yn('clear_product'),
      text_load: a.text_load ? { ...a.text_load, max: CONFIG.text_load.max_words, over: a.text_load.words > CONFIG.text_load.max_words } : null,
      brand_by_hook: a.kind === 'video' ? yn('video_brand_hook') : null,
      brand_at_end: a.kind === 'video' ? yn('video_brand_end') : null,
    },
    copy_match: a.copy_match, objection: a.objection,
    yesno: Object.fromEntries(Object.values(a.items).map(i => [i.id, { p: i.p, pa: i.pa, pb: i.pb }])),
    notes: a.notes, errors: a.errors,
    cost: { usd: Math.round(a.usd * 10000) / 10000, calls: a.calls },
    timings: { total_s: Math.round((extra.total_s ?? a.seconds) * 10) / 10, stages: a.timings },
  };
}

/**
 * One row for B3's `weekly.ts features --file`: `stub`, `features` ("a; b") and
 * `angle` are what it reads; the rest is for people.
 */
export function featuresRow(r: AuditReport, featureIds: string[] = Object.keys(r.features)): Record<string, string> {
  return {
    stub: r.stub || '', features: r.tagged_features.join('; '), angle: r.angle || '', persona: r.persona || '', kind: r.kind,
    red: String(r.counts.red), amber: String(r.counts.amber), grey: String(r.counts.grey),
    ...Object.fromEntries(featureIds.map(k => [`p_${k}`, r.features[k] === undefined ? '' : r.features[k].toFixed(3)])),
  };
}

const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** Rows as CSV (header from the first row). */
export function featuresCsvFromReports(reports: AuditReport[], featureIds: string[]): string {
  const rows = reports.filter(r => r.stub).map(r => featuresRow(r, featureIds));
  if (!rows.length) return 'stub,features,angle\n';
  const head = Object.keys(rows[0]);
  return [head.join(','), ...rows.map(r => head.map(h => cell(r[h] ?? '')).join(','))].join('\n') + '\n';
}

export type { Progress } from './engine.js';
export type { SignedOffCopy } from './copyMatch.js';
export type { Rules, Rubric } from './types.js';
export type { OpenAILike } from './api.js';
