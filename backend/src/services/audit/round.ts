// B2: a whole round. Discover the assets, audit each, write the reports, the
// summary, the features CSV for B3 and the flag sheet. Also the concept-card
// acceptance: the nine round-one cards as text-only assets, against the M3 table.
import fs from 'node:fs';
import path from 'node:path';
import { auditAsset, estimateAsset, type AuditContext, type Persona } from './engine.js';
import { assetMarkdown, featuresCsv, flagSheetCsv, summaryMarkdown } from './report.js';
import { CLIENT_DIR, parseStub, readJson } from './rules.js';
import type { Asset, AssetAudit } from './types.js';

export function loadPersonas(rules: AuditContext['rules']): Record<string, Persona> {
  const seeds = fs.existsSync(path.join(CLIENT_DIR, 'personas.json')) ? readJson(path.join(CLIENT_DIR, 'personas.json')).personas || [] : [];
  const vp = path.join(CLIENT_DIR, 'sm-spike', 'voices.json');
  const voices = fs.existsSync(vp) ? readJson(vp) : {};
  return Object.fromEntries(Object.entries(rules.personas).map(([code, p]) => [code, {
    code, name: p.name, seed: seeds.find((s: any) => s.code === code)?.body || null, voice: voices[code] || '',
  }]));
}

export function estimateRound(assets: Asset[], ctx: Pick<AuditContext, 'api' | 'rules' | 'rubric'>) {
  const per = assets.map(a => ({ asset: a, ...estimateAsset(a, ctx) }));
  return { per, usd: per.reduce((s, x) => s + x.usd, 0), tokens: per.reduce((s, x) => s + x.tokens, 0), calls: per.reduce((s, x) => s + x.calls, 0) };
}

export interface RoundResult { audits: AssetAudit[]; outDir: string; summaryPath: string; featuresPath: string; sheetPath: string }

export async function runRound(assets: Asset[], ctx: AuditContext, o: { round: string; outDir: string; rubricVersion: string; cap: number }): Promise<RoundResult> {
  const reportDir = path.join(o.outDir, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(o.outDir, 'audit.json');
  const prior: Record<string, AssetAudit> = fs.existsSync(jsonPath) ? readJson(jsonPath) : {};
  const audits: AssetAudit[] = [];
  const log = ctx.log || console.log;
  for (const [i, a] of assets.entries()) {
    log(`[${i + 1}/${assets.length}] ${a.stub?.stub || a.name} (${a.kind}, ${a.frames.length || 'text'})`);
    const r = await auditAsset(a, ctx);
    audits.push(r);
    prior[r.stub || r.asset] = r;
    fs.writeFileSync(jsonPath, JSON.stringify(prior, null, 2));
    fs.writeFileSync(path.join(reportDir, `${r.stub || r.asset}.md`), assetMarkdown(r, ctx.rules, { round: o.round, date, rubric: o.rubricVersion }));
    const c = (s: string) => r.flags.filter(f => f.severity === s).length;
    log(`  ${c('red')} red, ${c('amber')} amber, ${c('grey')} grey · $${r.usd.toFixed(3)} · ${r.seconds} s${r.errors.length ? ` · ${r.errors.length} errors` : ''}`);
  }
  // The round's files cover every asset audited so far, not only this run's.
  const all = Object.values(prior);
  const summaryPath = path.join(o.outDir, 'summary.md');
  const featuresPath = path.join(o.outDir, 'features.csv');
  const sheetPath = path.join(o.outDir, 'flag-sheet.csv');
  fs.writeFileSync(summaryPath, summaryMarkdown(all, ctx.rules, { round: o.round, date, reportDir, spent: ctx.api.spent() + (ctx.api.mock ? 0 : ctx.api.usd), cap: o.cap }));
  fs.writeFileSync(featuresPath, featuresCsv(all, ctx.rules as any));
  fs.writeFileSync(sheetPath, flagSheetCsv(all));
  return { audits, outDir: o.outDir, summaryPath, featuresPath, sheetPath };
}

const CARD_FORMAT: Array<[RegExp, string]> = [[/carousel/i, 'CAR'], [/ugc/i, 'UGC'], [/video/i, 'VID'], [/static/i, 'ST']];

/** The nine round-one concept cards as text-only assets (the M3 acceptance). */
export function conceptAssets(): Asset[] {
  const cards = readJson(path.join(CLIENT_DIR, 'concepts.json')).cards as Array<{ code: string; format: string; concept_text: string }>;
  return cards.map(c => {
    const fmt = CARD_FORMAT.find(([re]) => re.test(c.format))?.[1] || 'ST';
    const st = parseStub(`${c.code}_${fmt}_v1_META`);
    return { name: c.code, stub: 'error' in st ? null : st, kind: 'text' as const, source: 'concepts.json', frames: [], copy: {}, copy_labels: {}, text_only: c.concept_text };
  });
}

/** Per-feature agreement with the spike's M3 table (P(Yes), both wordings averaged). */
export function compareM3(audits: AssetAudit[], m3: Record<string, Record<string, number>>) {
  const rows: Array<{ item: string; n: number; meanAbs: number; maxAbs: number; sameSide: number; over: Array<{ code: string; ours: number; spike: number }> }> = [];
  for (const [item, byCode] of Object.entries(m3)) {
    const diffs: number[] = [];
    let same = 0;
    const over: Array<{ code: string; ours: number; spike: number }> = [];
    for (const a of audits) {
      const code = a.asset;
      const spike = byCode[code];
      const ours = a.items[item]?.p;
      if (spike === undefined || ours === undefined) continue;
      const d = Math.abs(ours - spike);
      diffs.push(d);
      if ((ours >= 0.5) === (spike >= 0.5)) same++;
      if (d > 0.3) over.push({ code, ours, spike });
    }
    if (!diffs.length) continue;
    rows.push({ item, n: diffs.length, meanAbs: diffs.reduce((s, x) => s + x, 0) / diffs.length, maxAbs: Math.max(...diffs), sameSide: same, over });
  }
  return rows;
}
