// Bulk check + report (Brook, 1 Oct): Nick writes in Google Docs; Brook pastes his copy (a table: persona, territory,
// field, text) and Studio checks every line as "Check my lines" does, files each into a run per persona × territory
// (persona-less post copy into the shared captions run) in the person's working round, keeps the lines so they can be
// built and signed off later, and gives back a report to share: one row per line with its flags in plain words.
//
// Attribution: the runs and lines carry `created_for` / `added_for` / `decided_for` (the person whose copy it is) beside
// the usual `_by` (who entered it). "On behalf of" in full (sign-off, overrides, Pre-flight, compliance) will use the
// same `<verb>_for` beside each `<verb>_by`, so nothing here needs migrating.

import * as S from './engine.js';
import type { Api, Batch, Flag, Line, Rules, StudioEvent } from './engine.js';
import { DEFAULT_REGION, REGIONS, type Region } from '../../utils/namingCode.js';

/** The shared captions pool: post copy that is generic across personas (engine.ts adds it to the loaded rules). */
const { SHARED_PERSONA, SHARED_TERRITORY } = S;
export { SHARED_PERSONA, SHARED_TERRITORY };

export interface BulkRow { n: number; persona: string; territory: string; field: string; text: string; region: Region; notes: string[] }
export interface BulkParse { rows: BulkRow[]; errors: Array<{ n: number; error: string; raw: string }>; header: boolean }
export interface BulkDefaults { persona?: string; territory?: string; field?: string; region?: string }

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** What people call the fields in a doc → the rules' field ids (only those the rules have). */
const FIELD_WORDS: Array<[RegExp, string]> = [
  [/^(on image |in asset |asset |image |artwork )?(sub ?head(line)?|sub copy|subcopy|sub)$/, 'meta_on_image_sub'],
  [/^(on image|in asset|asset|image|artwork|on image text|on image headline|in asset headline|asset headline|image headline|card|card text)$/, 'meta_on_image'],
  [/^(primary|primary text|primary copy|post copy|body|body copy|meta primary( text)?)$/, 'meta_primary'],
  [/^(headline|meta headline|post headline|link headline)$/, 'meta_headline'],
  [/^(description|meta description|link description)$/, 'meta_description'],
  [/^(caption|tiktok caption)$/, 'tiktok_caption'],
  [/^(hook|tiktok hook|on screen text|on screen)$/, 'tiktok_hook'],
];
export function resolveField(raw: string, r: Pick<Rules, 'fields'>): string | null {
  const w = norm(raw);
  if (!w) return null;
  if (r.fields[raw.trim()]) return raw.trim();
  const byLabel = Object.entries(r.fields).find(([, f]) => norm(f.label) === w);
  if (byLabel) return byLabel[0];
  const hit = FIELD_WORDS.find(([re]) => re.test(w));
  return hit && r.fields[hit[1]] ? hit[1] : null;
}

/** A persona by code or name ("DINK", "DINKs with pets", "busy families"); blank, "all", "shared" or "generic" is the shared pool. */
export function resolvePersona(raw: string, r: Pick<Rules, 'personas'>): string | null {
  const w = norm(raw);
  if (!w || /^(all|shared|generic|any|everyone|all personas|shared captions?)$/.test(w)) return SHARED_PERSONA;
  const codes = Object.keys(r.personas).filter(k => k !== SHARED_PERSONA);
  const code = codes.find(k => k.toLowerCase() === w.replace(/s$/, '') || k.toLowerCase() === w);
  if (code) return code;
  const words = w.split(' ').filter(x => x.length > 2);
  const scored = codes.map(k => ({ k, hits: words.filter(x => norm(r.personas[k].name).split(' ').some(y => y === x || y.replace(/s$/, '') === x.replace(/s$/, ''))).length })).sort((a, b) => b.hits - a.hits);
  return scored[0]?.hits && scored[0].hits > (scored[1]?.hits || 0) ? scored[0].k : null;
}

/** A territory of the persona by code or name (current or pitched); none given is the persona's first active one, with a note. */
export function resolveTerritory(raw: string, persona: string, r: Pick<Rules, 'territories'>): { code: string | null; note?: string } {
  if (persona === SHARED_PERSONA) return { code: SHARED_TERRITORY };
  const mine = Object.entries(r.territories).filter(([, t]) => t.persona === persona && t.status !== 'retired');
  const w = norm(raw);
  if (!w) return mine[0] ? { code: mine[0][0], note: `No territory given: filed under ${mine[0][1].name.replace(/\.$/, '')}` } : { code: null };
  const exact = mine.find(([k, t]) => k.toLowerCase() === raw.trim().toLowerCase() || norm(t.name) === w || norm((t as any).pitched_name || '') === w);
  if (exact) return { code: exact[0] };
  const part = mine.filter(([k, t]) => norm(t.name).includes(w) || w.includes(norm(t.name)) || norm(k).includes(w) || norm((t as any).pitched_name || ' ').includes(w));
  return part.length === 1 ? { code: part[0][0] } : { code: null };
}

const HEADER = /^(persona|audience|territory|concept|field|type|text|copy|line|region|market)$/;
const COLS: Record<string, keyof BulkDefaults | 'text'> = { persona: 'persona', audience: 'persona', territory: 'territory', concept: 'territory', field: 'field', type: 'field', text: 'text', copy: 'text', line: 'text', region: 'region', market: 'region' };

/** Rows of cells from a pasted table: tab-separated (a Google Docs or Sheets table), else comma-separated (quotes honoured). */
function cells(text: string, r: Rules): string[][] {
  const t = text.replace(/\r\n?/g, '\n');
  if (t.includes('\t')) return t.split('\n').map(l => l.split('\t').map(c => c.trim()));
  // No tabs: comma-separated only if it looks like a table (the first cell is a header word, a persona or a field).
  // Otherwise each line is one piece of copy, commas and all ("Summer plans, covered").
  const csv = S.parseCsv(t).map(row => row.map(c => c.trim())).filter(row => row.some(c => c));
  const tabular = (c: string) => HEADER.test(norm(c)) || !!resolveField(c, r) || (!!norm(c) && resolvePersona(c, r) !== null && resolvePersona(c, r) !== S.SHARED_PERSONA);
  if (csv.length && csv.every(row => row.length > 1) && tabular(csv[0][0])) return csv;
  return t.split('\n').map(l => [l.trim()]);
}

/**
 * Parse a pasted table. With a header row, columns are found by name (persona, territory, field, text, region; any
 * order). Without one: 4 columns = persona, territory, field, text; 3 = persona, field, text; 2 = field, text (shared
 * captions unless a default persona is given); 1 = text (needs a default field). Lines that can't be placed are errors,
 * each saying why; nothing is guessed silently (a missing territory is filed under the persona's first, with a note).
 */
export function parseBulk(text: string, r: Rules, defaults: BulkDefaults = {}): BulkParse {
  const table = cells(text, r).filter(row => row.some(c => c));
  const errors: BulkParse['errors'] = [];
  const rows: BulkRow[] = [];
  if (!table.length) return { rows, errors, header: false };
  const first = table[0].map(norm);
  const header = first.filter(c => HEADER.test(c)).length >= 2 || (first.length === 1 && HEADER.test(first[0]));
  type Col = keyof BulkDefaults | 'text' | null;
  const headed: Col[] = first.map(c => COLS[c] ?? null);
  // Without a header, each row is read by its own number of cells (a doc's table rows all have the same).
  const byWidth = (w: number): Col[] => (w >= 4 ? ['persona', 'territory', 'field', 'text'] : w === 3 ? ['persona', 'field', 'text'] : w === 2 ? ['field', 'text'] : ['text']);
  if (header && !headed.includes('text')) return { rows, errors: [{ n: 1, error: 'The header has no text column (text, copy or line)', raw: table[0].join(' | ') }], header };
  table.slice(header ? 1 : 0).forEach((row, i) => {
    const n = i + (header ? 2 : 1);
    const order = header ? headed : byWidth(row.length);
    const get = (k: keyof BulkDefaults | 'text') => { const j = order.indexOf(k); return (j >= 0 ? row[j] : '') || ''; };
    const fail = (error: string) => { errors.push({ n, error, raw: row.filter(Boolean).join(' | ') }); };
    const body = get('text').replace(/^["“]|["”]$/g, '').trim();
    if (!body) return fail('No text');
    const notes: string[] = [];
    const fieldRaw = get('field') || defaults.field || '';
    const field = resolveField(fieldRaw, r);
    if (!field) return fail(fieldRaw ? `Unknown field "${fieldRaw}" (on-image, subhead, primary, headline, description, caption or hook)` : 'No field (on-image, subhead, primary, headline, caption or hook)');
    const personaRaw = get('persona') || defaults.persona || '';
    const persona = resolvePersona(personaRaw, r);
    if (!persona) return fail(`Unknown persona "${personaRaw}"`);
    // Artwork copy is the persona's (Brook, 1 Oct): on-image text with no persona can't be filed.
    if (persona === SHARED_PERSONA && S.isOnImageField(field, r)) return fail(`${r.fields[field].label} is persona-specific: say which persona it is for`);
    const terr = resolveTerritory(get('territory') || (persona === resolvePersona(defaults.persona || '', r) ? defaults.territory || '' : ''), persona, r);
    if (!terr.code) return fail(get('territory') ? `Unknown territory "${get('territory')}" for ${r.personas[persona].name}` : `No territory for ${r.personas[persona].name}`);
    if (terr.note) notes.push(terr.note);
    const regionRaw = (get('region') || defaults.region || DEFAULT_REGION).toUpperCase().replace(/^CANADA$/, 'CA').replace(/^(USA|UNITED STATES)$/, 'US');
    if (!REGIONS.includes(regionRaw as Region)) return fail(`Unknown region "${get('region')}" (US or CA)`);
    if (rows.some(x => x.persona === persona && x.territory === terr.code && x.field === field && x.region === regionRaw && x.text === body)) return fail('The same line is in the table twice');
    rows.push({ n, persona, territory: terr.code, field, text: body, region: regionRaw as Region, notes });
  });
  return { rows, errors, header };
}

/** The runs a set of rows makes: one per persona × territory × region, in the order they first appear. */
export function groupRows(rows: BulkRow[]): Array<{ persona: string; territory: string; region: Region; rows: BulkRow[] }> {
  const out = new Map<string, { persona: string; territory: string; region: Region; rows: BulkRow[] }>();
  for (const x of rows) {
    const k = `${x.persona}|${x.territory}|${x.region}`;
    out.set(k, out.get(k) || { persona: x.persona, territory: x.territory, region: x.region, rows: [] });
    out.get(k)!.rows.push(x);
  }
  return [...out.values()];
}

/** What checking the rows costs: the sum of each run's "check my lines" estimate. */
export function estimateBulk(rows: BulkRow[]): { usd: number; seconds: number; lines: number; runs: number } {
  const groups = groupRows(rows);
  const usd = groups.reduce((t, g) => t + S.estimate(S.makeBrief({ persona: g.persona, territory: g.territory, region: g.region, own_lines: g.rows.map(x => ({ text: x.text, field: x.field })) }), { ownOnly: true }).usd, 0);
  // About 6 lines checked at a time, ~8 s a line; never less than 10 s a run.
  return { usd: Math.round(usd * 1000) / 1000, seconds: Math.round(groups.reduce((t, g) => t + Math.max(10, Math.ceil(g.rows.length / 6) * 8 + 6), 0)), lines: rows.length, runs: groups.length };
}

export interface BulkRecord { id: string; at: string; by: string; for?: string; runs: string[]; lines: number; errors: BulkParse['errors'] }

/**
 * Check the rows: one "own lines" run per persona × territory × region (the same checks as Check my lines), each line
 * then kept (they're Nick's lines, to build and sign off later; a red flag stays on the line and in the report).
 */
export async function runBulk(parse: BulkParse, api: Api, opts: { user?: string; for?: string; id?: string }, emit: (e: StudioEvent) => void = () => {}): Promise<BulkRecord> {
  const id = opts.id || `bulk-${new Date().toISOString().replace(/[-:T]/g, '').slice(2, 14)}`;
  const groups = groupRows(parse.rows);
  const runs: string[] = [];
  let done = 0;
  for (const g of groups) {
    const r = S.loadRules();
    emit({ type: 'status', message: `Checking ${g.rows.length} line${g.rows.length === 1 ? '' : 's'} for ${r.personas[g.persona].name} · ${r.territories[g.territory].name.replace(/\.$/, '')} (${done} of ${parse.rows.length} done)` });
    const brief = S.makeBrief({ persona: g.persona, territory: g.territory, region: g.region, name: `${id} ${g.territory}`, fields: [...new Set(g.rows.map(x => x.field))], own_lines: g.rows.map(x => ({ text: x.text, field: x.field })) });
    (brief as any).bulk = { id, for: opts.for || undefined };
    const batch = await S.generate(brief, api, () => {}, { ownOnly: true, user: opts.user });
    await S.stampFor(batch.id, { bulk: id, for: opts.for, user: opts.user });
    for (const l of batch.lines) await S.setDecision(batch.id, l.id, { decision: 'keep' }, opts.user, opts.for);
    runs.push(batch.id);
    done += g.rows.length;
  }
  const rec: BulkRecord = { id, at: new Date().toISOString(), by: opts.user || 'unknown', for: opts.for || undefined, runs, lines: parse.rows.length, errors: parse.errors };
  // Under a lock, so two copy checks finishing together both stay on the list.
  await S.getStore().withLock(['bulk_checks'], async () => {
    const list = ((await S.getStore().getInput('bulk_checks')) || []) as BulkRecord[];
    await S.getStore().putInput('bulk_checks', [...list.filter(x => x.id !== id), rec]);
  });
  emit({ type: 'done', batch: id });
  return rec;
}

export async function listBulk(): Promise<BulkRecord[]> {
  return (((await S.getStore().getInput('bulk_checks')) || []) as BulkRecord[]).sort((a, b) => b.at.localeCompare(a.at));
}

// ---------- the report ----------

export interface ReportRow {
  persona: string; territory: string; region: Region; field: string; text: string; chars: number; visible: number; over: boolean;
  status: 'red' | 'amber' | 'clear';
  flags: Array<{ severity: 'red' | 'amber' | 'grey'; name: string; what: string; quote: string; todo: string }>;
  objection: string; run: string; line_id: string;
  /** In the shared captions pool (no persona). */
  shared: boolean;
}
export interface BulkReport { id: string; at: string; by: string; for?: string; rows: ReportRow[]; errors: BulkParse['errors']; summary: string; counts: { checked: number; red: number; amber: number; clear: number } }

const SEV: Record<string, 'red' | 'amber' | 'grey'> = { compliance: 'red', warn: 'amber', note: 'grey' };
/** A flag's short name in plain words: the rule's first clause (never the internal notes after it). */
const flagName = (f: Flag) => f.label.split(/(?<=[a-z0-9’'”)])[.:;]\s|\s\(/)[0].replace(/[.:;]$/, '').trim();

export async function bulkReport(id?: string): Promise<BulkReport> {
  const list = await listBulk();
  const rec = id ? list.find(x => x.id === id) : list[0];
  if (!rec) throw new Error(id ? `No copy check ${id}` : 'No copy check has been run yet');
  const r = S.loadRules();
  const todo = Object.fromEntries([...r.compliance, ...r.brand, ...r.clarity].filter((i: any) => i.what_to_do).map((i: any) => [i.id, i.what_to_do]));
  const rows: ReportRow[] = [];
  for (const run of rec.runs) {
    let b: Batch;
    try { b = await S.loadBatch(run); } catch { continue; }
    for (const l of b.lines.filter((x: Line) => x.model === 'human')) {
      const f = r.fields[l.field];
      const text = S.finalText(l);
      const flags = l.flags.filter(x => !(l.overrides || []).some(o => o.rule === x.rule)).map(x => ({
        severity: SEV[x.severity] || 'grey', name: flagName(x), what: reason(x.why || ''), quote: x.quote || '', todo: todo[x.rule] || '',
      }));
      rows.push({
        persona: r.personas[l.persona]?.name || l.persona, territory: (r.territories[l.territory]?.name || l.territory).replace(/\.$/, ''), region: S.regionOfLine(l, b.brief),
        field: f?.label || l.field, text, chars: [...text].length, visible: f?.visible ?? 0, over: !!f && [...text].length > f.visible,
        status: flags.some(x => x.severity === 'red') ? 'red' : flags.some(x => x.severity === 'amber') ? 'amber' : 'clear',
        flags, objection: l.objection || '', run, line_id: l.id, shared: l.persona === SHARED_PERSONA,
      });
    }
  }
  const counts = { checked: rows.length, red: rows.filter(x => x.status === 'red').length, amber: rows.filter(x => x.status === 'amber').length, clear: rows.filter(x => x.status === 'clear').length };
  const summary = `${counts.checked} checked · ${counts.red} red · ${counts.amber} amber · ${counts.clear} clear${rec.errors.length ? ` · ${rec.errors.length} not checked` : ''}`;
  return { id: rec.id, at: rec.at, by: rec.by, for: rec.for, rows, errors: rec.errors, summary, counts };
}

const WORD = { red: 'Red', amber: 'Amber', grey: 'Note', clear: 'Clear' } as const;
/** The check's own reason, when it's words (not a probability or an internal note). */
const reason = (what: string) => (what && !/^\s*P\(|P=|yes\/no|on the original wording/i.test(what) ? what.replace(/\.$/, '') : '');
const flagLine = (x: ReportRow['flags'][number]) => `${WORD[x.severity]}: ${x.name}${x.quote ? ` (“${x.quote}”)` : ''}${reason(x.what) ? `: ${reason(x.what)}` : ''}${x.todo ? `. What to do: ${x.todo}` : ''}`;

/** One row per line, for a sheet: persona, territory, field, the text, its length, the verdict and each flag in plain words. */
export function reportCsv(rep: BulkReport): string {
  return S.toCsv([
    ['Persona', 'Territory', 'Region', 'Field', 'Text', 'Characters', 'Visible', 'Result', 'Flags', 'What a skeptic would say'],
    ...rep.rows.map(x => [x.persona, x.territory, x.region, x.field, x.text, String(x.chars), x.visible ? `${x.visible}${x.over ? ' (over)' : ''}` : '', WORD[x.status], x.flags.map(flagLine).join('\n'), x.objection]),
    ...rep.errors.map(e => ['', '', '', '', e.raw, '', '', 'Not checked', e.error, '']),
  ]);
}

/** The same, to paste back into a doc or a message: grouped by persona and territory, red first within each. */
export function reportMd(rep: BulkReport): string {
  const out = [`# Copy check${rep.for ? ` for ${rep.for}` : ''}`, '', `${rep.summary}. Checked ${rep.at.slice(0, 16).replace('T', ' ')} UTC by ${rep.by}.`, '', 'Red breaks a client rule: fix it, or it needs an override with a reason. Amber is worth a look. Notes are for information.', ''];
  const order = { red: 0, amber: 1, clear: 2 };
  let last = '';
  for (const x of [...rep.rows].sort((a, b) => `${a.persona}|${a.territory}`.localeCompare(`${b.persona}|${b.territory}`) || order[a.status] - order[b.status])) {
    const g = `${x.persona} · ${x.territory}${x.region !== DEFAULT_REGION ? ` · ${x.region === 'CA' ? 'Canada' : x.region}` : ''}`;
    if (g !== last) { if (last) out.push(''); out.push(`## ${g}`, ''); last = g; }
    out.push(`- **${WORD[x.status]}** · ${x.field} · ${x.chars}${x.visible ? `/${x.visible}` : ''} characters${x.over ? ' (over what shows)' : ''}  `, `  “${x.text}”`);
    for (const f of x.flags) out.push(`  - ${flagLine(f)}`);
  }
  if (rep.errors.length) out.push('', '## Not checked', '', ...rep.errors.map(e => `- Row ${e.n}: ${e.error} (“${e.raw}”)`));
  return out.join('\n') + '\n';
}
