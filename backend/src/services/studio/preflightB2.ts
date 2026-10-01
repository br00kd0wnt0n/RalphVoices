// Pre-flight's real audit engine: B2's library (services/audit), adapted to
// preflightEngine.ts. The rules come in whole (with the visual-only items that
// Studio's text checks skip); the M3 rubric and the persona seeds and voices
// come from the Studio store (studio_inputs, loaded by `studio.ts db-import`).

import OpenAI from 'openai';
import { estimateAudit, featuresRow, runAudit, type AuditFile, type AuditReport } from '../audit/index.js';
import type { SignedOffCopy } from '../audit/copyMatch.js';
import * as S from './engine.js';
import type { AuditEngine, AuditFlag, AuditInput, AuditResult, SignedCopy } from './preflightEngine.js';

/** Studio field ids → B2's signed-off copy fields. */
const FIELD: Record<string, keyof SignedOffCopy> = {
  meta_primary: 'primary_text', meta_headline: 'headline', meta_description: 'description', tiktok_hook: 'hook', tiktok_caption: 'caption', meta_on_image_sub: 'on_image_sub',
};
export function signedOffCopy(copy: SignedCopy[]): SignedOffCopy {
  const out: SignedOffCopy = {};
  for (const c of copy) {
    const k = FIELD[c.field] || 'on_image';
    out[k] = out[k] ? `${out[k]} ${c.text}` : c.text;
  }
  return out;
}

/** Name files so B2's "sort by the number in the name" keeps the upload order (frame_index = card position). */
const b2Name = (i: number, filename: string) => `${String(i + 1).padStart(2, '0')}-${filename}`;

/**
 * The rubric and the skeptic's persona context. From the rules file (v2.6+: rubric,
 * personas.<code>.seed and .voice), so an admin's upload is all the hosted Studio
 * needs; the store's inputs (db-import, the local folder) are a fallback only.
 */
async function context() {
  const st = S.getStore();
  const rules: any = await st.getRules();
  const rubric = await S.rubricFor(rules);
  if (!rubric) throw new Error('The live rules have no M3 rubric: an admin uploads studio-rules.json v2.6 or later in the Rules view');
  const needStore = Object.values<any>(rules.personas || {}).some(p => !p.seed || !p.voice);
  const seeds = needStore ? (await st.getInput('personas')) || {} : {};
  const voices = needStore ? (await st.getInput('voices')) || {} : {};
  const personas: Record<string, { name?: string; seed?: any; voice?: string }> = {};
  for (const [code, p] of Object.entries<any>(rules.personas || {})) {
    const list = Array.isArray(seeds) ? seeds : Array.isArray(seeds.personas) ? seeds.personas : null;
    const stored = list ? list.find((x: any) => x.code === code || x.id === code) : seeds[code];
    const voice = voices[code];
    personas[code] = { name: p.name, seed: p.seed || stored?.body || stored, voice: p.voice || (typeof voice === 'string' ? voice : voice?.text) };
  }
  return { rules, rubric, personas };
}

export function b2Engine(opts: { tpm?: number; capUsd?: () => Promise<number>; ffmpegPath?: string; tesseractPath?: string | false; openai?: () => any } = {}): AuditEngine {
  return {
    name: 'b2',
    async estimate(i) {
      // By path when the file is on disk (B2 links it, never reads it whole); bytes only for in-memory files. Rules and rubric come from Preflight.
      const files: AuditFile[] = i.files.map((f, n) => ({ name: b2Name(n, f.filename), mime: f.contentType, ...(f.path ? { path: f.path } : { data: f.data || Buffer.alloc(0) }) }));
      const e = await estimateAudit({ stub: i.stub, persona: i.persona, files }, { rules: i.rules, rubric: i.rubric, ffmpegPath: opts.ffmpegPath, tpm: opts.tpm });
      return { usd: e.usd, seconds: e.seconds };
    },
    async run(i: AuditInput, progress) {
      // Preflight passes the stored rubric; persona seeds and voices (for the skeptic) come from the store.
      const { rubric, personas } = i.rubric ? { rubric: i.rubric, personas: await context().then(c => c.personas).catch(() => undefined) } : await context();
      let openai = opts.openai?.();
      if (!openai) { S.loadKey(false); openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }
      const files: AuditFile[] = i.files.map((f, n) => ({ name: b2Name(n, f.filename), mime: f.contentType, path: f.path }));
      const capUsd = opts.capUsd ? await opts.capUsd() : undefined;
      const report = await runAudit(
        // No copy: the lines were checked at sign-off, and copy match runs in Studio per stub the visual serves.
        { stub: i.stub, persona: i.persona, files },
        {
          rules: i.rules, rubric, openai, personas, ffmpegPath: opts.ffmpegPath, tesseractPath: opts.tesseractPath, tpm: opts.tpm, capUsd,
          onProgress: e => progress(`${e.message}${e.calls_estimated ? ` (${e.calls_done}/${e.calls_estimated})` : ''}`),
        });
      return fromReport(report);
    },
  };
}

export function fromReport(r: AuditReport): AuditResult {
  const onCard = r.kind === 'static' || r.kind === 'carousel';
  const flag = (f: AuditReport['flags'][number]): AuditFlag => ({
    rule: f.rule, severity: f.severity, label: f.rule_text, source: f.source,
    quote: f.quote ?? undefined, why: f.why ?? undefined, where: f.where ?? undefined, persona: f.persona ?? undefined,
    check: /^COPY_(MATCH|CAVEAT)$/.test(f.rule) ? 'copy_match' : undefined,
    frame: f.frame_index === null || f.frame_index === undefined ? undefined
      : onCard ? { asset_position: f.frame_index, label: r.frames[f.frame_index]?.label }
      : { label: r.frames[f.frame_index]?.label, description: r.frames[f.frame_index]?.description },
  });
  return {
    engine: `b2 (report v${r.report_version})`,
    flags: [...r.flags.map(flag), ...r.cross_persona.map(f => ({ ...flag(f), cross_persona: true }))],
    text_found: r.frames.map(f => `${f.label}: ${f.text}`).join('\n'),
    asset_text: [...r.frames.map(f => ({ where: f.label, text: f.text })), ...(r.transcript?.text ? [{ where: 'voice-over', text: r.transcript.text }] : [])],
    transcript: r.transcript?.text,
    features: r.features,
    objection: r.objection,
    notes: [...r.notes, ...r.errors.map(e => `Error: ${e}`)],
    frames_unavailable: r.kind === 'video' && !r.frames.length,
    usd: r.cost.usd,
    report: r,
  };
}

/** B3's features row for a stored report (B2's own format). */
export function b2FeaturesRow(report: AuditReport, featureIds: string[]): Record<string, string | number> {
  return featuresRow(report, featureIds) as any;
}
