// B2: the written output. A Markdown report per asset, a round summary (assets
// with red flags first), the features CSV B3's `weekly.ts features --file`
// reads, and a flag sheet for the human agreement check. Never a score or a
// ranking of assets.
import type { AssetAudit, Flag, Rules } from './types.js';

const ICON: Record<Flag['severity'], string> = { red: '🔴 red', amber: '🟠 amber', grey: '⚪ grey' };
const esc = (s: string | undefined) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' / ');
const pct = (p: number | undefined | null) => (p === undefined || p === null ? '' : p.toFixed(2));

export const FEATURE_THRESHOLD = 0.5;

export function taggedFeatures(a: AssetAudit): string[] {
  return Object.entries(a.features).filter(([, p]) => p >= FEATURE_THRESHOLD).map(([k]) => k).sort();
}

function flagRows(flags: Flag[]): string[] {
  const out = ['| | Rule | Where | Quoted or seen | Why | Source | Found by |', '|---|---|---|---|---|---|---|'];
  for (const f of flags) {
    out.push(`| ${ICON[f.severity]} | **${f.rule}**${f.persona ? ` (${f.persona})` : ''}: ${esc(f.label)} | ${esc(f.where)} | ${f.quote ? `"${esc(f.quote)}"` : ''} | ${esc(f.why)} | ${esc(f.source)} | ${f.by.join(', ')}${f.p !== undefined ? ` (P ${pct(f.p)})` : ''} |`);
  }
  return out;
}

export function assetMarkdown(a: AssetAudit, rules: Rules, meta: { round: string; date: string; rubric: string }): string {
  const p = a.persona ? rules.personas[a.persona] : null;
  const own = a.flags.filter(f => !f.persona || f.persona === a.persona || f.severity !== 'grey');
  const cross = a.flags.filter(f => !own.includes(f));
  const count = (s: Flag['severity']) => a.flags.filter(f => f.severity === s).length;
  const L: string[] = [
    `# ${a.stub || a.asset}: pre-flight audit`,
    '',
    `Asset \`${a.asset}\` · ${a.kind}${a.frames.length ? ` (${a.frames.length} ${a.kind === 'video' ? 'keyframes' : a.kind === 'carousel' ? 'cards' : 'image'})` : ''} · intended persona **${p ? `${a.persona} (${p.name})` : 'unknown'}** · round ${meta.round} · ${meta.date} · rules ${rules.version}, rubric ${meta.rubric}`,
    '',
    'Flags, not scores. Red: a compliance rule. Amber: a warning (turn-off, brand, clarity, limits). Grey: a note, including how the asset travels to the other personas. Every flag names its source.',
    '',
    `## Flags: ${count('red')} red, ${count('amber')} amber, ${count('grey')} grey`,
    '',
  ];
  if (own.length) L.push(...flagRows(own), ''); else L.push('No flags for the intended persona.', '');
  if (cross.length) L.push('### Other personas (grey notes: how it travels)', '', ...flagRows(cross), '');

  L.push('## Features', '', `Tagged when P(Yes) ≥ ${FEATURE_THRESHOLD} (both wordings averaged). These are the tags B3's weekly read learns from.`, '', '| Feature | Tagged | P(Yes) | A / B |', '|---|---|---|---|');
  for (const [k, v] of Object.entries(a.features)) {
    const it = a.items[k];
    L.push(`| ${k}: ${esc(rules.features.items[k])} | ${v >= FEATURE_THRESHOLD ? 'yes' : ''} | ${pct(v)} | ${pct(it?.pa)} / ${pct(it?.pb)} |`);
  }
  L.push('');
  if (a.text_load) L.push(`On-image text load: ${a.text_load.words} words on the ${a.text_load.where}.`, '');

  L.push(`## The skeptic${p ? ` (${p.name})` : ''}`, '', a.objection ? `> ${a.objection}` : '_No objection (no intended persona)._', '');

  L.push('## Extracted text', '');
  for (const f of a.frames) {
    L.push(`**${f.label}**`, '', f.text.trim() ? '```\n' + f.text.trim() + '\n```' : '_(no text)_');
    if (f.description) L.push('', `Shows: ${f.description}`);
    if (f.ocr_only.length) L.push('', `tesseract also read: ${f.ocr_only.join(', ')} (check for missed or garbled words)`);
    L.push('');
  }
  const copy = Object.entries(a.copy).filter(([, v]) => v.trim());
  if (copy.length) {
    L.push('**Sidecar copy**', '');
    for (const [k, v] of copy) L.push(`- ${k} (${[...v].length} chars): ${v.replace(/\n/g, ' / ')}`);
    L.push('');
  }

  if (a.set_aside?.length) L.push('## Set aside (not flags)', '', 'Reads one layer raised and another contradicted, listed so nothing is hidden:', '', ...a.set_aside.map(x => `- ${x.rule}${x.quote ? `: "${x.quote}"` : ''} (${x.why})`), '');
  L.push('## All yes/no reads', '', '| Item | P(Yes) | A / B |', '|---|---|---|');
  for (const it of Object.values(a.items)) L.push(`| ${it.id} | ${pct(it.p)} | ${pct(it.pa)} / ${pct(it.pb)} |`);
  L.push('', `Run: ${a.calls} calls, $${a.usd.toFixed(3)}, ${a.seconds} s.${a.errors.length ? ` Errors: ${a.errors.length} (${a.errors.slice(0, 3).join('; ')})` : ''}`, '');
  return L.join('\n');
}

export function summaryMarkdown(audits: AssetAudit[], rules: Rules, meta: { round: string; date: string; reportDir: string; spent: number; cap: number }): string {
  const n = (a: AssetAudit, s: Flag['severity']) => a.flags.filter(f => f.severity === s).length;
  // Triage order only: red flags first, then by name. Not a ranking of the assets.
  const sorted = [...audits].sort((x, y) => (n(y, 'red') > 0 ? 1 : 0) - (n(x, 'red') > 0 ? 1 : 0) || (x.stub || x.asset).localeCompare(y.stub || y.asset));
  const usd = audits.reduce((s, a) => s + a.usd, 0);
  const secs = audits.reduce((s, a) => s + a.seconds, 0);
  const L = [
    `# Pre-flight audit: round ${meta.round}`,
    '',
    `${meta.date} · ${audits.length} assets · rules ${rules.version}. Assets with red flags come first; otherwise by name. This is triage order, not a ranking: there are no scores.`,
    '',
    '| Asset | Persona | Kind | Red | Amber | Grey | Red flags | Report |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const a of sorted) {
    const reds = a.flags.filter(f => f.severity === 'red').map(f => `${f.rule}${f.quote ? ` "${esc(f.quote).slice(0, 40)}"` : ''}`).join('; ');
    const file = `${a.stub || a.asset}.md`;
    L.push(`| ${a.stub || a.asset} | ${a.persona || '?'} | ${a.kind} | ${n(a, 'red')} | ${n(a, 'amber')} | ${n(a, 'grey')} | ${reds} | [${file}](reports/${encodeURI(file)}) |`);
  }
  L.push('', '## Features by asset', '', `| Asset | ${Object.keys(rules.features.items).join(' | ')} |`, `|---|${Object.keys(rules.features.items).map(() => '---').join('|')}|`);
  for (const a of sorted) L.push(`| ${a.stub || a.asset} | ${Object.keys(rules.features.items).map(k => (a.features[k] === undefined ? '' : a.features[k] >= FEATURE_THRESHOLD ? `**${a.features[k].toFixed(2)}**` : a.features[k].toFixed(2))).join(' | ')} |`);
  L.push('', '## Cost and time', '', '| Asset | Calls | Cost | Time |', '|---|---|---|---|');
  for (const a of sorted) L.push(`| ${a.stub || a.asset} | ${a.calls} | $${a.usd.toFixed(3)} | ${a.seconds} s |`);
  L.push(`| **Total** | ${audits.reduce((s, a) => s + a.calls, 0)} | $${usd.toFixed(2)} | ${Math.round(secs)} s |`, '');
  L.push(`Per asset: $${(usd / Math.max(1, audits.length)).toFixed(3)} and ${Math.round(secs / Math.max(1, audits.length))} s on average. Session spend: $${meta.spent.toFixed(2)} of the $${meta.cap} cap.`, '');
  return L.join('\n');
}

function csvCell(v: unknown, guard = false): string {
  let s = String(v ?? '');
  if (guard && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Features for B3's `weekly.ts features --file` (joined by naming stub):
 * `stub`, `features` ("a; b") and `angle` (from the territory, so B3 tags
 * `angle:<id>`), plus the P(Yes) behind each tag and the flag counts for people.
 */
export function featuresCsv(audits: AssetAudit[], rules: Rules & { territories?: Record<string, { angle?: string }> }): string {
  const keys = Object.keys(rules.features.items);
  const head = ['stub', 'features', 'angle', 'persona', 'asset', 'kind', 'red', 'amber', 'grey', ...keys.map(k => `p_${k}`)];
  const rows = [head.join(',')];
  for (const a of audits) {
    if (!a.stub) continue;
    const terr = a.stub.split('_').slice(0, -3).join('_');
    const angle = rules.territories?.[terr]?.angle || '';
    const n = (s: Flag['severity']) => a.flags.filter(f => f.severity === s).length;
    rows.push([a.stub, taggedFeatures(a).join('; '), angle, a.persona, a.asset, a.kind, n('red'), n('amber'), n('grey'), ...keys.map(k => (a.features[k] === undefined ? '' : a.features[k].toFixed(3)))].map(v => csvCell(v)).join(','));
  }
  return rows.join('\n') + '\n';
}

/** One row per flag, for Brook to mark agree / disagree (the ≥90% acceptance check). */
export function flagSheetCsv(audits: AssetAudit[]): string {
  const rows = [['stub', 'n', 'severity', 'rule', 'persona', 'where', 'quote', 'why', 'source', 'found_by', 'agree', 'note'].join(',')];
  for (const a of audits) a.flags.forEach((f, i) => rows.push([a.stub || a.asset, i + 1, f.severity, f.rule, f.persona || '', f.where || '', f.quote || '', f.why || '', f.source, f.by.join(' + '), '', ''].map(v => csvCell(v, true)).join(',')));
  return rows.join('\n') + '\n';
}

/** Agreement from a marked flag sheet: agree = y/yes/agree/1, disagree = n/no/disagree/0. */
export function agreement(rows: Array<Record<string, string>>): { marked: number; agree: number; rate: number; misses: Array<Record<string, string>>; bySeverity: Record<string, { marked: number; agree: number }> } {
  let marked = 0, agree = 0;
  const misses: Array<Record<string, string>> = [];
  const bySeverity: Record<string, { marked: number; agree: number }> = {};
  for (const r of rows) {
    const v = String(r.agree || '').trim().toLowerCase();
    const yes = /^(y|yes|agree|1|true|✓)$/.test(v), no = /^(n|no|disagree|0|false|✗)$/.test(v);
    if (!yes && !no) continue;
    marked++;
    const s = (bySeverity[r.severity] ||= { marked: 0, agree: 0 });
    s.marked++;
    if (yes) { agree++; s.agree++; } else misses.push(r);
  }
  return { marked, agree, rate: marked ? agree / marked : 0, misses, bySeverity };
}

/** RFC 4180 CSV to objects (quoted fields, doubled quotes, CRLF, line breaks in cells). */
export function parseCsvObjects(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.some(x => x.trim()));
  return (body || []).map(r => Object.fromEntries((head || []).map((h, i) => [h.trim(), r[i] ?? ''])));
}
