// B2 pre-flight audit: one asset in, flags with sources, features and the
// skeptic's objection out. Never a score.
//
// Layers, in order:
//   1. Read every image or frame (gpt-4o, detail high): all visible text, and a
//      literal description. tesseract reads the same image as a cross-check.
//   2. Rule-based copy checks on the sidecar copy and the on-image text.
//   3. Yes/no items (features, turn-offs, brand, clarity), each asked in two
//      wordings with the images at detail low; P(Yes) from logprobs, averaged.
//   4. Compliance yes/no on all the words (gpt-4o-mini, two wordings each).
//   5. One reviewer call that quotes the words or frame behind any rule it sees hit.
//   6. The skeptic's one-line objection, in the intended persona's voice.
// Severity needs agreement: a red needs a rule match, or the reviewer and the
// yes/no reads leaning the same way. A lone yes/no read needs P >= 0.8.
import fs from 'node:fs';
import path from 'node:path';
import type { AuditApi, Content } from './api.js';
import { FatalError } from './api.js';
import { buildItems, type YesNoItem } from './checks.js';
import { addFlag, copyFlags, labelOf, ocrOnlyWords, sevOf, wordCount, type TextBlock } from './copyChecks.js';
import { extractAudio, ocr, runTool } from './assets.js';
import { CONFIG } from './config.js';
import { copyMatch, type SignedOffCopy } from './copyMatch.js';
import { defaultTools, type Tools } from './tools.js';
import { disclaimerTexts, withoutSmallPrint } from './smallPrint.js';
import type { Asset, AssetAudit, Flag, FrameText, Rubric, RuleItem, Rules, YesNo } from './types.js';
import { CURRENT_PATTERN } from '../../utils/namingCode.js';

export const MODELS = CONFIG.models;

export const ASSET_SYSTEM = 'You check finished social ads against a checklist. You see the ad itself (a static image, carousel cards or video keyframes) and a transcription of its words. Judge only what the ad actually shows or says (images, on-image text, copy, voice-over). Do not guess at intent or at what a different cut of the ad might contain.';
const COPY_SYSTEM = 'You check the words of a social ad for Trupanion (medical insurance for cats and dogs) against a compliance checklist. Judge only the words given, as written.';

export interface Persona { code: string; name: string; seed: any; voice: string }

export interface AuditContext {
  api: AuditApi;
  rules: Rules;
  rubric: Rubric;
  workDir: string;              // frames, low-detail copies
  personas: Record<string, Persona>;
  concurrency?: number;
  log?: (s: string) => void;
  tools?: Tools;
  signedOff?: SignedOffCopy;     // Studio's signed-off copy for this stub: the copy-match check
  onProgress?: (e: Progress) => void;
}

export interface Progress { stage: 'read' | 'transcribe' | 'checks' | 'compliance' | 'review' | 'objection' | 'done'; calls_done: number; calls_estimated: number; message: string }

async function pool<T>(tasks: Array<() => Promise<T>>, n: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  let fatal: unknown = null;
  async function worker() {
    while (next < tasks.length && !fatal) {
      const i = next++;
      try { out[i] = await tasks[i](); } catch (e) { if (e instanceof FatalError) { fatal = e; return; } throw e; }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, n) }, worker));
  if (fatal) throw fatal;
  return out;
}

const img = (p: string, detail: 'low' | 'high') => ({ type: 'image' as const, image: { path: p, detail } });
const txt = (text: string) => ({ type: 'text' as const, text });
const withWording = (source: string, w: string) => (w.startsWith('B2') || w === 'rules' || source.includes(w) ? source : `${source}; ${w}`);
/** A rule's "not a breach" lines (rules v2.13+), as Studio's line checks give them (services/studio/engine.ts). */
const notExamples = (i: { not_examples?: string[] }) => (i.not_examples?.length ? ` Not a breach, for example: ${i.not_examples.map(x => `"${x}"`).join('; ')}.` : '');
const noLines = (i: { not_examples?: string[] }) => (i.not_examples?.length ? `Lines like these are a No: ${i.not_examples.map(x => `"${x}"`).join('; ')}.\n` : '');
const normText = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9$%]+/g, ' ').trim();
/**
 * A reviewer hit resting on a line some rule lists as not a breach is set aside, whichever rule the reviewer filed it
 * under (production, 1 Oct: "Build your plan in 60 seconds!", a claim-speed not_example, came back under the
 * fact-framing rule with the reason "Overclaims speed").
 */
export function listedAsNotABreach(quote: string | undefined, rules: { compliance: Array<{ not_examples?: string[] }>; brand: Array<{ not_examples?: string[] }> }): boolean {
  const q = normText(quote || '');
  if (!q) return false;
  // The whole listed line, or most of it: a fragment ("in 60 seconds") could come from a real breach.
  return [...rules.compliance, ...rules.brand].flatMap(i => i.not_examples || []).map(normText).some(x => x && (q.includes(x) || (x.includes(q) && q.length >= x.length * 0.7)));
}
const yesNoPrompt = (ad: string, q: string) => `AD:\n${ad}\n\n${q} Answer with exactly one word: Yes or No.`;

/** A 512 px copy for detail-low questions: smaller uploads, same tokens (85). */
async function lowCopy(src: string, dir: string, tools: Tools): Promise<string> {
  if (!tools.ffmpeg) return src;
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, path.basename(src).replace(/\.[^.]+$/, '') + '-512.jpg');
  if (fs.existsSync(out)) return out;
  try {
    await runTool(tools.ffmpeg, ['-y', '-v', 'error', '-i', src, '-vf', "scale='if(gt(iw,ih),min(512,iw),-2)':'if(gt(iw,ih),-2,min(512,ih))'", '-q:v', '3', out]);
    return out;
  } catch { return src; }
}

const FORMAT_WORDS: Record<string, string> = { ST: 'static image', CAR: 'carousel', VID: 'video', TT: 'TikTok video', UGC: 'UGC video' };

/** The ad as the checklist reads it: format, then each image or frame's words and what it shows, then the copy. */
export function describeAsset(a: Asset, frames: FrameText[]): string {
  if (a.text_only) return a.text_only;
  const plat = a.stub?.platform === 'TT' ? 'TikTok' : a.stub?.platform === 'META' ? 'Meta' : 'social';
  const fmt = a.kind === 'carousel' ? `carousel, ${frames.length} cards` : a.kind === 'video' ? `${FORMAT_WORDS[a.stub?.format || 'VID'] || 'video'}, ${Math.round((a.duration || 0) * 10) / 10} s; keyframes shown` : 'static image';
  const lines = [`Trupanion social ad. Format: ${fmt} (${plat} feed).`];
  for (const f of frames) {
    lines.push(`[${f.label}] On-image text: ${f.text.trim() ? `"${f.text.trim().replace(/\n+/g, ' / ')}"` : '(none)'}`);
    if (f.description) lines.push(`[${f.label}] Shows: ${f.description}`);
  }
  for (const [k, v] of Object.entries(a.copy)) if (v.trim()) lines.push(`${a.copy_labels[k] || k}: "${v.trim()}"`);
  if (a.transcript) lines.push(`Voice-over: "${a.transcript.trim()}"`);
  return lines.join('\n');
}

async function readFrames(a: Asset, ctx: AuditContext, errors: string[]): Promise<FrameText[]> {
  return pool(a.frames.map(f => async () => {
    let r;
    try { r = await ctx.api.chat({
      stage: `read ${a.name} ${f.label}`, model: MODELS.vision, max_tokens: 700, temperature: 0, json: true,
      system: 'You transcribe and describe social ad images for a compliance check. Be literal and complete; never paraphrase the words.',
      content: [img(f.path, 'high'), txt('Return JSON {"text": "every word visible in the image, exactly as written, in reading order, one line per block of text; include small print, legal lines, logos and buttons", "description": "two to four plain, factual sentences on what the image shows: the people (rough ages; any children), the animals (species; whether each looks happy, neutral, sad, scared or unwell), the setting, and whether a Trupanion name or logo is visible"}')],
    }); } catch (e: any) {
      if (e instanceof FatalError) throw e;
      errors.push(`read ${f.label}: ${e?.message}`);
      r = { text: '{}' };
    }
    let j: any = {};
    try { j = JSON.parse(r.text || '{}'); } catch { /* keep empty */ }
    const tess = await ocr(f.path, ctx.tools || defaultTools());
    ctx.onProgress?.({ stage: 'read', calls_done: ctx.api.calls, calls_estimated: 0, message: `read ${f.label}` });
    const text = String(j.text || '');
    return { label: f.label, text, ocr: tess, ocr_only: ocrOnlyWords(text, tess), description: String(j.description || '') };
  }), ctx.concurrency || 3);
}

function textBlocks(a: Asset, frames: FrameText[]): { blocks: TextBlock[]; ocrBlocks: TextBlock[] } {
  const blocks: TextBlock[] = [];
  for (const [k, v] of Object.entries(a.copy)) blocks.push({ where: a.copy_labels[k] || k, field: k, text: v, lead: ['meta_headline', 'tiktok_hook', 'meta_description', 'meta_on_image'].includes(k) });
  // A concept card mixes description and copy: only its quoted words are copy.
  if (a.text_only) {
    const quoted = [...a.text_only.matchAll(/"([^"]+)"|“([^”]+)”/g)].map(m => m[1] || m[2]);
    quoted.forEach((q, i) => blocks.push({ where: 'concept card', text: q, lead: i === 0 }));
  }
  frames.forEach((f, i) => blocks.push({ where: f.label, text: f.text, onImage: true, lead: i === 0 || /hook/.test(f.label) }));
  if (a.transcript) blocks.push({ where: 'voice-over', text: a.transcript });
  const ocrBlocks = frames.filter(f => f.ocr_only.length).map(f => ({ where: f.label, text: f.ocr, onImage: true, ocrOnly: true }));
  return { blocks, ocrBlocks };
}

function allRuleItems(rules: Rules): Array<RuleItem & { persona?: string }> {
  return [
    ...rules.compliance, ...rules.brand, ...rules.clarity,
    ...Object.entries(rules.personas).flatMap(([code, p]) => p.turn_offs.map(t => ({ ...t, persona: code }))),
  ];
}

async function reviewer(a: Asset, ad: string, images: Content, ctx: AuditContext): Promise<Array<{ rule: string; where?: string; quote?: string; why?: string }>> {
  const r = ctx.rules;
  const items = [
    ...r.compliance.filter(c => c.check !== 'structure' && c.check !== 'verbatim'),
    ...r.brand,
    ...Object.entries(r.personas).flatMap(([code, p]) => p.turn_offs.map(t => ({ ...t, id: t.id, rule: `(${code}: ${p.name}) ${t.rule}` }))),
  ];
  const system = `You check one finished social ad for Trupanion (medical insurance for cats and dogs) against fixed rules. Judge only what the ad shows and says. A rule is hit only when the ad itself does what the rule forbids; don't flag an ad for touching a topic. For every hit, say where (the card, frame or copy field) and quote the exact words, or describe the image in a few words if it's visual. File each hit under the rule your reason is about: if the reason belongs to another rule, use that rule's id; if a rule lists the words as not a breach, report nothing for them.

RULES (id: rule):
${items.map(i => `${i.id}: ${i.rule}${notExamples(i as any)}`).join('\n')}

Return JSON only: {"hits":[{"rule":"<id>","where":"<card/frame/field>","quote":"<exact words, or what the image shows>","why":"<12 words or fewer>"}]}. Use "hits":[] when nothing is hit.`;
  const res = await ctx.api.chat({ stage: `review ${a.name}`, model: MODELS.reviewer, max_tokens: 700, temperature: 0, json: true, system, content: [...images, txt(`AD:\n${ad}`)] });
  let j: any = {};
  try { j = JSON.parse(res.text || '{}'); } catch { /* none */ }
  const ids = new Set(items.map(i => i.id));
  return (Array.isArray(j.hits) ? j.hits : []).filter((h: any) => ids.has(h?.rule) && !listedAsNotABreach(h?.quote, r));
}

async function objection(a: Asset, ad: string, images: Content, persona: Persona | undefined, ctx: AuditContext): Promise<string> {
  if (!persona) return '';
  const seed = persona.seed;
  const res = await ctx.api.chat({
    stage: `objection ${a.name}`, model: MODELS.objection, max_tokens: 70, temperature: 0.7,
    system: `You are a skeptical member of this audience: ${persona.name}${seed ? ` (${seed.household}; ${seed.occupation})` : ''}. You are not an assistant and you're not reviewing ads for anyone.${persona.voice ? `\nHow you talk:\n${persona.voice}` : ''}\nYou see this ad in your feed. Say the first objection you'd actually have, in your own words, in one or two short sentences (under 30 words). No preamble, no quotation marks.`,
    content: [...images, txt(`The ad:\n${ad}`)],
  });
  return res.text.trim().replace(/^["“]|["”]$/g, '');
}

/** Audit one asset. `persona` is the intended persona (from the stub). */
export async function auditAsset(a: Asset, ctx: AuditContext): Promise<AssetAudit> {
  const t0 = Date.now();
  const usd0 = ctx.api.usd, calls0 = ctx.api.calls;
  const persona = a.persona || a.stub?.persona || null;
  const errors: string[] = [];
  const log = ctx.log || (() => {});
  const n = ctx.concurrency || 3;
  const tools = ctx.tools || defaultTools();
  const notes: string[] = [];
  const timings: Record<string, number> = {};
  let tStage = Date.now();
  const lap = (k: string) => { timings[k] = Math.round((Date.now() - tStage) / 100) / 10; tStage = Date.now(); };
  const est = estimateAsset(a, ctx).calls;
  const progress = (stage: Progress['stage'], message: string) => ctx.onProgress?.({ stage, calls_done: ctx.api.calls - calls0, calls_estimated: est, message });
  if (a.kind === 'video' && !a.frames.length) notes.push(tools.ffmpeg && tools.ffprobe ? 'Video frames unavailable (ffmpeg could not read the file); checked on the copy and voice-over only.' : 'Video frames unavailable (ffmpeg not installed); checked on the copy and voice-over only.');
  if (!a.text_only && a.frames.length && !tools.tesseract) notes.push('No OCR cross-check (tesseract not installed); on-image text is vision only.');

  // 1. Read the frames; transcribe the voice-over when there's no transcript sidecar.
  progress('read', `reading ${a.frames.length} image${a.frames.length === 1 ? '' : 's'}`);
  const frames = a.text_only ? [] : await readFrames(a, ctx, errors);
  if (errors.some(e => e.startsWith('read '))) notes.push(`Some images couldn't be read (${errors.filter(e => e.startsWith('read ')).length}); their text is missing from the checks.`);
  lap('read');
  if (a.kind === 'video' && !a.transcript && (a.has_audio || !tools.ffprobe)) {
    try {
      progress('transcribe', 'transcribing the voice-over');
      const mp3 = await extractAudio(a.source, path.join(ctx.workDir, 'audio', `${a.stub?.stub || a.name}.mp3`), tools);
      a.transcript = await ctx.api.transcribe(`transcribe ${a.name}`, MODELS.transcribe, mp3, a.duration || 0);
      a.transcript_source = ctx.api.mock ? 'mock' : 'openai';
      log(`  transcribed ${Math.round(a.duration || 0)} s of audio (${a.transcript.length} chars)`);
    } catch (e: any) { if (e instanceof FatalError) throw e; errors.push(`transcribe: ${e?.message}`); notes.push(`Voice-over not transcribed (${String(e?.message || e).slice(0, 80)}).`); }
    lap('transcribe');
  }
  log(`  read ${frames.length} image${frames.length === 1 ? '' : 's'}`);
  const ad = describeAsset(a, frames);
  const lowDir = path.join(ctx.workDir, 'low', a.stub?.stub || a.name);
  const lows = await Promise.all(a.frames.map(f => lowCopy(f.path, lowDir, tools)));
  const images: Content = lows.map(p => img(p, 'low'));

  // 2. Rule-based copy checks.
  const { blocks, ocrBlocks } = textBlocks(a, frames);
  const flags: Flag[] = copyFlags(blocks, ctx.rules, persona);
  for (const f of copyFlags(ocrBlocks, ctx.rules, persona)) {
    if (!flags.some(x => x.rule === f.rule && x.where === f.where)) addFlag(flags, { ...f, by: ['ocr'] });
  }

  // 2b. Copy match against the signed-off copy, when Studio passes it.
  let matchRows: AssetAudit['copy_match'] = [];
  if (ctx.signedOff && !a.text_only) {
    const cm = copyMatch(ctx.signedOff, [...frames.map(f => ({ where: f.label, text: f.text })), ...(a.transcript ? [{ where: 'voice-over', text: a.transcript }] : [])], ctx.rules);
    matchRows = cm.rows;
    for (const f of cm.flags) flags.push(f);
  }

  // 3. Yes/no items, two wordings each.
  progress('checks', 'yes/no checks');
  const items = buildItems(ctx.rules, ctx.rubric, { video: a.kind === 'video', visual: !a.text_only });
  const frameFor = (it: YesNoItem): Content => {
    if (!it.frame) return images;
    const i = a.frames.findIndex(f => f.role === it.frame);
    return i >= 0 ? [img(lows[i], 'low')] : images;
  };
  const frameText = (it: YesNoItem): string => {
    if (!it.frame) return ad;
    const f = frames.find((_, i) => a.frames[i]?.role === it.frame);
    return f ? `Trupanion social ad, one frame (${f.label}).\nOn-image text: ${f.text.trim() ? `"${f.text.trim().replace(/\n+/g, ' / ')}"` : '(none)'}\nShows: ${f.description}` : ad;
  };
  const asked = a.kind === 'video' && a.frames.length ? items : items.filter(i => !i.frame);
  const system = a.text_only ? ctx.rubric.system : ASSET_SYSTEM;
  const tasks = asked.flatMap(it => it.wordings.map((w, k) => async () => {
    const content: Content = a.text_only ? [txt(yesNoPrompt(ad, w))] : [...frameFor(it), txt(yesNoPrompt(frameText(it), w))];
    try { const p = await ctx.api.yesNo(`${a.name} ${it.id} ${'AB'[k]}`, MODELS.yesno, system, content); progress('checks', it.id); return { id: it.id, k, p }; }
    catch (e: any) { if (e instanceof FatalError) throw e; errors.push(`${it.id} ${'AB'[k]}: ${e?.message}`); return { id: it.id, k, p: null }; }
  }));
  const reads = await pool(tasks, n);
  const yn: Record<string, YesNo> = {};
  for (const it of asked) {
    const pa = reads.find(r => r.id === it.id && r.k === 0)?.p ?? null;
    const pb = reads.find(r => r.id === it.id && r.k === 1)?.p ?? null;
    const both = [pa, pb].filter((x): x is number => x !== null);
    if (both.length) yn[it.id] = { id: it.id, p: Math.round((both.reduce((s, x) => s + x, 0) / both.length) * 1000) / 1000, pa, pb };
  }
  log(`  ${reads.length} yes/no reads`);
  lap('checks');
  progress('compliance', 'compliance checks');

  // 4. Compliance yes/no on the words alone.
  // The asset's legal small print isn't ad copy (smallPrint.ts): only the disclaimer check reads it.
  const disclaimerText = disclaimerTexts(ctx.rules as any);
  const words = blocks.map(b => (b.onImage ? withoutSmallPrint(b.text, disclaimerText) : b.text)).filter(t => t.trim()).join('\n');
  const compItems = ctx.rules.compliance.filter(c => c.wordings && c.wordings.length === 2);
  const compReads = words.trim() ? await pool(compItems.flatMap(c => c.wordings!.map((w, k) => async () => {
    try { return { id: c.id, k, p: await ctx.api.yesNo(`${a.name} ${c.id} ${'AB'[k]}`, MODELS.compliance, COPY_SYSTEM, [txt(`AD COPY (all the words in the ad):\n${words}\n\n${noLines(c)}${w} Answer with exactly one word: Yes or No.`)]) }; }
    catch (e: any) { if (e instanceof FatalError) throw e; errors.push(`${c.id} ${'AB'[k]}: ${e?.message}`); return { id: c.id, k, p: null }; }
  })), n) : [];
  const compP: Record<string, number> = {};
  for (const c of compItems) {
    const ps = compReads.filter(r => r.id === c.id && r.p !== null).map(r => r.p as number);
    if (ps.length) compP[c.id] = Math.round((ps.reduce((s, x) => s + x, 0) / ps.length) * 1000) / 1000;
  }

  lap('compliance');
  // 5. The reviewer's quoted hits; 6. the skeptic.
  progress('review', 'reviewer');
  let hits: Awaited<ReturnType<typeof reviewer>> = [];
  let obj = '';
  try { hits = await reviewer(a, ad, a.text_only ? [] : images, ctx); } catch (e: any) { if (e instanceof FatalError) throw e; errors.push(`reviewer: ${e?.message}`); }
  lap('review');
  progress('objection', 'the skeptic');
  try { obj = await objection(a, ad, a.text_only ? [] : images, persona ? ctx.personas[persona] : undefined, ctx); } catch (e: any) { if (e instanceof FatalError) throw e; errors.push(`objection: ${e?.message}`); }

  lap('objection');
  // Assemble flags.
  const byId = new Map(allRuleItems(ctx.rules).map(i => [`${i.persona || ''}:${i.id}`, i]));
  const ruleOf = (id: string) => [...byId.values()].find(i => i.id === id);
  const own = (p?: string) => !p || p === persona;

  // Compliance: rule match (already red), or reviewer + yes/no agreeing.
  // A reviewer hit the yes/no reads clearly disagree with (P < 0.2), or on a
  // required caveat the rule check found in place, is set aside, not flagged.
  const setAside: AssetAudit['set_aside'] = [];
  const lone: RuleItem[] = [];
  for (const c of ctx.rules.compliance) {
    const p = compP[c.id];
    const h = hits.find(x => x.rule === c.id);
    const ruled = flags.find(f => f.rule === c.id && f.by.includes('rule'));
    if (ruled) { if (p !== undefined) ruled.p = p; if (h) ruled.by.push('model'); continue; }
    const caveatInPlace = c.check === 'require' && (c.requires_patterns || []).some(rp => new RegExp(rp, 'i').test(words));
    if (h && (caveatInPlace || (p !== undefined && p < 0.2))) { setAside.push({ rule: c.id, quote: h.quote, why: caveatInPlace ? 'the required caveat is in the ad' : `the yes/no reads ${p}` }); continue; }
    if (h && p !== undefined && p >= 0.5) addFlag(flags, { severity: sevOf(c.severity, 'red'), rule: c.id, label: labelOf(c), source: c.source, quote: h.quote, where: h.where, why: h.why, by: ['model', 'yesno'], p });
    else if (h) addFlag(flags, { severity: 'amber', rule: c.id, label: labelOf(c), source: c.source, quote: h.quote, where: h.where, why: `${h.why || ''} (reviewer; the yes/no reads ${p ?? 'n/a'})`.trim(), by: ['model'], p });
    else if (p !== undefined && p >= CONFIG.lone_yesno_min) lone.push(c);
  }
  // A lone gpt-4o-mini read (no rule match, no quote) is loose on short copy:
  // it's asked again on gpt-4o with the same two wordings, and flagged only if both agree.
  for (const c of lone) {
    const ps = (await pool(c.wordings!.map((w, k) => async () => {
      try { return await ctx.api.yesNo(`${a.name} ${c.id} confirm ${'AB'[k]}`, MODELS.yesno, COPY_SYSTEM, [txt(`AD COPY (all the words in the ad):\n${words}\n\n${noLines(c)}${w} Answer with exactly one word: Yes or No.`)]); }
      catch (e: any) { if (e instanceof FatalError) throw e; return null; }
    }), 2)).filter((x): x is number => x !== null);
    const p2 = ps.length ? Math.round((ps.reduce((s, x) => s + x, 0) / ps.length) * 1000) / 1000 : null;
    if (p2 !== null && p2 >= 0.5) addFlag(flags, { severity: 'amber', rule: c.id, label: labelOf(c), source: c.source, why: `Yes/no reads lean yes on both models (gpt-4o-mini ${compP[c.id]}, gpt-4o ${p2}); no quote found`, by: ['yesno'], p: p2 });
    else setAside.push({ rule: c.id, why: `gpt-4o-mini read ${compP[c.id]}; gpt-4o didn't confirm (${p2 ?? 'n/a'})` });
  }

  // Turn-offs and brand: amber for the intended persona, grey for the other two.
  const qualify = (p: number | undefined, hit: boolean) => hit || (p !== undefined && p >= CONFIG.lone_yesno_min);
  for (const it of items.filter(i => i.kind === 'turnoff' || i.kind === 'brand')) {
    const rule = ruleOf(it.rule!)!;
    const p = yn[it.id]?.p;
    const h = hits.find(x => x.rule === it.rule);
    if (!qualify(p, !!h) || (h && p !== undefined && p < 0.2 && !h.quote)) continue;
    const existing = flags.find(f => f.rule === rule.id && (f.persona || '') === (it.persona || ''));
    if (existing) { existing.p = p; if (h) existing.by.push('model'); if (p !== undefined && p >= 0.5) existing.by.push('yesno'); continue; }
    const sev = own(it.persona) ? sevOf(rule.severity) : 'grey';
    addFlag(flags, { severity: sev, rule: rule.id, label: labelOf(rule), source: withWording(rule.source, it.wordingSource), quote: h?.quote, where: h?.where, why: h?.why, by: [...(h ? ['model'] : []), ...(p !== undefined && p >= 0.5 ? ['yesno'] : [])], p, persona: it.persona });
  }
  // Reviewer hits on turn-offs or brand items no yes/no asks about.
  for (const h of hits) {
    const rule = ruleOf(h.rule);
    if (!rule || flags.some(f => f.rule === h.rule) || ctx.rules.compliance.some(c => c.id === h.rule)) continue;
    const ownerPersona = (rule as any).persona as string | undefined;
    addFlag(flags, { severity: own(ownerPersona) ? sevOf(rule.severity) : 'grey', rule: rule.id, label: labelOf(rule), source: rule.source, quote: h.quote, where: h.where, why: h.why, by: ['model'], persona: ownerPersona });
  }

  // Clarity: flag when the averaged read says No.
  for (const it of items.filter(i => i.kind === 'clarity' || i.kind === 'video')) {
    const p = yn[it.id]?.p;
    if (p === undefined || p >= 0.5) continue;
    const rule = ruleOf(it.rule!)!;
    const label = it.id === 'video_brand_hook' ? 'Brand or product not clear by the 1.5 s frame' : it.id === 'video_brand_end' ? 'Brand or product not clear on the last frame' : labelOf(rule);
    const f = it.frame ? frames.find((_, i) => a.frames[i]?.role === it.frame)?.label : undefined;
    addFlag(flags, { severity: 'amber', rule: it.id === 'one_glance' || it.id === 'clear_product' ? rule.id : `${rule.id}:${it.id}`, label, source: withWording(rule.source, it.wordingSource), where: f, why: `P(Yes) ${p}`, by: ['yesno'], p });
  }

  // Real people or testimony: the cast must be Trupanion members.
  const ugc = ctx.rules.compliance.find(c => c.check === 'structure');
  const peopleP = Math.max(yn.real_people?.p ?? 0, yn.member_testimony?.p ?? 0);
  if (ugc && (peopleP >= 0.5 || a.stub?.format === 'UGC')) addFlag(flags, { severity: sevOf(ugc.severity, 'grey'), rule: ugc.id, label: ugc.rule, source: ugc.source, why: a.stub?.format === 'UGC' ? 'UGC format' : `Real people or testimony (P ${Math.round(peopleP * 100) / 100})`, by: ['yesno'] });

  // On-image text load.
  let textLoad: AssetAudit['text_load'] = null;
  if (frames.length) {
    const first = frames[0];
    const w = wordCount(first.text);
    textLoad = { words: w, where: first.label };
    if (w > CONFIG.text_load.max_words) addFlag(flags, { severity: 'amber', rule: 'TEXT_LOAD', label: `Heavy on-image text: ${w} words on the ${first.label}`, source: CONFIG.text_load.source, where: first.label, by: ['rule'] });
  }
  if (!a.stub) addFlag(flags, { severity: 'amber', rule: 'NAMING', label: `Name doesn't parse as a naming stub (${a.stub_error}); B3 can't join its features`, source: `Naming convention with Add3 (${CURRENT_PATTERN}, or the earlier PERSONA_TERRITORY_FORMAT_v#_PLATFORM)`, by: ['rule'] });

  const features: Record<string, number> = {};
  for (const it of items) if (yn[it.id] && (it.kind === 'feature')) features[it.id] = yn[it.id].p;

  progress('done', 'done');
  const order = { red: 0, amber: 1, grey: 2 } as const;
  flags.sort((x, y) => order[x.severity] - order[y.severity] || (x.persona || '').localeCompare(y.persona || ''));
  return {
    asset: a.name, stub: a.stub?.stub || null, persona, kind: a.kind, frames, copy: a.copy,
    transcript: a.transcript ? { text: a.transcript, source: a.transcript_source || 'sidecar' } : a.kind === 'video' ? { text: '', source: a.has_audio ? 'transcription failed' : 'no audio track' } : null,
    features, items: yn, flags, set_aside: setAside, copy_match: matchRows, notes, timings, objection: obj, text_load: textLoad,
    usd: ctx.api.usd - usd0, seconds: Math.round((Date.now() - t0) / 100) / 10, calls: ctx.api.calls - calls0, errors,
  };
}

/** Rough cost and token count for an asset before running it (for the $2 ask). */
export function estimateAsset(a: Asset, ctx: Pick<AuditContext, 'api' | 'rules' | 'rubric'>): { usd: number; tokens: number; calls: number } {
  const items = buildItems(ctx.rules, ctx.rubric, { video: a.kind === 'video', visual: !a.text_only });
  const nFrames = a.frames.length;
  const adChars = a.text_only ? a.text_only.length : 250 + nFrames * 450 + Object.values(a.copy).join(' ').length + (a.transcript?.length || 0);
  const highTok = a.frames.reduce((s, f) => s + ctx.api.estTokens({ system: '', content: [img(f.path, 'high')] }), 0);
  const yesTok = (items.length * 2) * (nFrames * 85 + adChars / 4 + 120);
  const compTok = ctx.rules.compliance.filter(c => c.wordings).length * 2 * (adChars / 4 + 80);
  const revTok = 2 * (nFrames * 85 + adChars / 4 + 1800);
  const g = 2.5 / 1e6, out = 10 / 1e6;
  const audio = a.kind === 'video' && a.has_audio && !a.transcript ? ((a.duration || 0) / 60) * CONFIG.transcribe_usd_per_minute : 0;
  const usd = audio + (highTok + nFrames * 150) * g + nFrames * 300 * out + yesTok * g + compTok * 0.15 / 1e6 + revTok * g + 700 * out;
  return { usd, tokens: Math.round(highTok + yesTok + revTok), calls: nFrames + items.length * 2 + ctx.rules.compliance.filter(c => c.wordings).length * 2 + 2 };
}
