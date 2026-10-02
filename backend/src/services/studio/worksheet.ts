// The worksheet (Brook, 2 Oct): the month's copy as one table per step, the way the Round 1 spreadsheet worked.
// Step 1: every on-image headline, subhead and carousel card, by persona and asset (a territory; one territory is
// one asset). Step 2: the shared primary texts and captions. Step 3: the shared headline bank.
//
// It is a view over the runs: nothing new is stored. This file has the rows (`worksheet`), the sheet (`exportXlsx`,
// the Round 1 workbook's shape with the line id and wording hash in two hidden columns) and the way back
// (`parseXlsx` → `previewImport` → `applyImport`: Keep / Cut / Rewrite and new lines, shown before anything is
// written, recorded for the person named, rewrites re-checked).
import ExcelJS from 'exceljs';
import * as S from './engine.js';
import type { Api, Line, Rules, StudioEvent } from './engine.js';
import type { Region } from '../../utils/namingCode.js';
import * as Bulk from './bulk.js';
import * as R from './ready.js';
import { isSubField } from './versions.js';
import { inView, roundOf, type RoundView } from './rounds.js';
import { chipName } from '../../utils/flagChips.js';

export type Step = 'on_image' | 'primary' | 'headline';
export const STEPS: Array<{ key: Step; tab: string; prefix: string; title: string }> = [
  { key: 'on_image', tab: '1 On-image copy', prefix: 'O', title: 'On-image copy' },
  { key: 'primary', tab: '2 Primary text', prefix: 'P', title: 'Primary text and captions' },
  { key: 'headline', tab: '3 Headlines', prefix: 'H', title: 'Headlines' },
];
export interface WsRow {
  /** The display number (O1, P3, H2): positional, never a key. `id` (the line id) is the key. */
  n: string; id: string; run: string; step: Step;
  persona: string; persona_name: string; territory: string; asset: string; region: Region;
  field: string; where: string; card?: number;
  text: string; chars: number; visible: number; max: number;
  status: 'red' | 'amber' | 'clear';
  /** name: the chip's plain words; detail: what it found (the lengths, the line it resembles), when that helps. */
  flags: Array<{ level: 'red' | 'amber' | 'grey'; name: string; rule: string; detail?: string }>;
  /** keep (kept or edited), cut, or '' (undecided). `implied`: typed or pasted by a person and not decided since, which counts as kept. */
  call: 'keep' | 'cut' | ''; implied?: boolean; edited: boolean;
  sha256: string; decided_by?: string; decided_for?: string; signed_off?: boolean;
}
export interface Worksheet {
  round: string; round_label: string; region: Region | 'all'; rules?: string;
  steps: Record<Step, WsRow[]>;
  counts: Record<Step, { total: number; kept: number; cut: number; undecided: number; red: number; amber: number; clear: number }>;
  /** Lines in the month that belong to none of the three steps (a persona's own post copy, TikTok hooks): not on the sheet. */
  other: number;
}

/** Which step a line belongs to, or null (a persona's own post copy isn't on the worksheet: captions are shared). */
export function stepOf(l: Pick<Line, 'field' | 'persona'>, r: Rules): Step | null {
  if (l.persona === S.SHARED_PERSONA) return S.isOnImageField(l.field, r) ? null : S.PRODUCT_FIELDS.includes(l.field) ? 'primary' : 'headline';
  return S.isOnImageField(l.field, r) ? 'on_image' : null;
}
const whereOf = (l: Pick<Line, 'field' | 'card'>, r: Rules) => {
  const sub = isSubField(l.field, r);
  return l.card ? `Card ${l.card}${sub ? ' subhead' : ''}` : sub ? 'Subhead' : S.isOnImageField(l.field, r) ? 'Headline' : r.fields[l.field]?.label || l.field;
};
const isKept = (l: Line) => l.decision === 'keep' || l.decision === 'edit';
/** A person's own line with no decision yet counts as kept (it's how the board counts pasted copy). */
const impliedKeep = (l: Line) => !l.decision && l.model === 'human';

export async function worksheet(view: RoundView, region: Region | 'all' = 'US'): Promise<Worksheet> {
  const r = S.loadRules();
  const round = view.ids ? [...view.ids][0] : view.active.id;
  const personaOrder = Object.keys(r.personas), territoryOrder = Object.keys(r.territories);
  const all: Array<Omit<WsRow, 'n'>> = [];
  let other = 0;
  for (const run of await S.listBatches(undefined, view)) {
    const b = await S.loadBatch(run.id);
    for (const l of b.lines) {
      const lineRegion = S.regionOfLine(l, b.brief);
      if (!inView(view, roundOf(l, b.brief)) || (region !== 'all' && lineRegion !== region)) continue;
      const step = stepOf(l, r);
      if (!step) { other++; continue; }
      const text = S.finalText(l);
      const lim = S.fieldLimits(l.field, r, l);
      const flags = l.flags.filter(x => !(l.overrides || []).some(o => o.rule === x.rule)).map(x => ({
        level: Bulk.SEV[x.severity] || 'grey', name: chipName(x.rule), rule: x.rule,
        ...(/^LIMIT_/.test(x.rule) && lim ? { detail: `${[...text].length}, ${x.rule === 'LIMIT_MAX' ? `${lim.max} at most` : `${lim.visible} ${x.rule === 'LIMIT_ON_ASSET' ? 'is the guide' : 'visible'}`}` } : x.rule === 'NEAR_DUP' ? { detail: /Close to (L\d+)/.exec(x.label)?.[1] ? `${b.id}-${/Close to (L\d+)/.exec(x.label)![1]}` : '' } : {}),
      }));
      all.push({
        id: l.id, run: b.id, step, persona: l.persona, persona_name: r.personas[l.persona]?.name || l.persona, territory: l.territory,
        asset: (r.territories[l.territory]?.name || l.territory).replace(/\.$/, ''), region: lineRegion, field: l.field, where: whereOf(l, r), ...(l.card ? { card: l.card } : {}),
        text, chars: [...text].length, visible: lim?.visible ?? 0, max: lim?.max ?? 0,
        status: flags.some(x => x.level === 'red') ? 'red' : flags.some(x => x.level === 'amber') ? 'amber' : 'clear', flags,
        call: l.decision === 'cut' ? 'cut' : isKept(l) || impliedKeep(l) ? 'keep' : '', ...(impliedKeep(l) ? { implied: true } : {}), edited: S.isEdited(l),
        sha256: S.lineHash(l), ...(l.decided_by ? { decided_by: l.decided_by } : {}), ...(l.decided_for ? { decided_for: l.decided_for } : {}),
        ...(l.ready && !l.ready.superseded_by ? { signed_off: true } : {}),
      });
    }
  }
  // Step 1 reads persona, then asset, then headline → subhead, or card by card; the pools read in the order written.
  const rank = (x: Omit<WsRow, 'n'>) => (x.card ? x.card * 2 + (isSubField(x.field, r) ? 1 : 0) : isSubField(x.field, r) ? 1 : 0);
  const idx = (list: string[], k: string) => { const i = list.indexOf(k); return i < 0 ? list.length : i; };
  const cmp = (a: Omit<WsRow, 'n'>, b: Omit<WsRow, 'n'>) =>
    idx(personaOrder, a.persona) - idx(personaOrder, b.persona) || idx(territoryOrder, a.territory) - idx(territoryOrder, b.territory) || a.territory.localeCompare(b.territory)
    || a.region.localeCompare(b.region) || (a.step === 'on_image' ? rank(a) - rank(b) : 0) || a.id.localeCompare(b.id, undefined, { numeric: true });
  const steps = {} as Worksheet['steps'], counts = {} as Worksheet['counts'];
  for (const s of STEPS) {
    const rows = all.filter(x => x.step === s.key).sort(cmp).map((x, i) => ({ ...x, n: `${s.prefix}${i + 1}` }));
    steps[s.key] = rows;
    // "Similar line" names its neighbour by the sheet's own number (P6), not the run's.
    for (const x of rows) for (const f of x.flags) if (f.rule === 'NEAR_DUP') { const o = all.find(y => y.id === f.detail); const on = o && STEPS.flatMap(t => steps[t.key] || []).find(y => y.id === o.id); f.detail = on ? `to ${on.n}` : undefined; if (!f.detail) delete f.detail; }
    const live = rows.filter(x => x.call !== 'cut');
    counts[s.key] = {
      total: rows.length, kept: rows.filter(x => x.call === 'keep').length, cut: rows.filter(x => x.call === 'cut').length, undecided: rows.filter(x => !x.call).length,
      red: live.filter(x => x.status === 'red').length, amber: live.filter(x => x.status === 'amber').length, clear: live.filter(x => x.status === 'clear').length,
    };
  }
  const label = view.state.rounds.find(x => x.id === round);
  return { round, round_label: (label as any)?.label || (label as any)?.name || round, region, rules: r.version, steps, counts, other };
}

// ---------- the sheet ----------

const YELLOW = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF2CC' } };
const HEAD_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFEDEDED' } };
const STATUS_WORD = { red: 'Red', amber: 'Amber', clear: 'Clear' } as const;
const LEVEL_WORD = { red: 'Red', amber: 'Amber', grey: 'Note' } as const;
const CALL_WORD = { keep: 'Keep', cut: 'Cut', '': '' } as const;
const NEW_ROWS = 6;
const META_SHEET = '_studio';
const colLetter = (n: number) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const flagText = (f: WsRow['flags'][number]) => `${f.level === 'red' ? 'RED: ' : ''}${f.name}${f.detail ? ` (${f.detail})` : ''}${f.level === 'grey' ? ' (note)' : ''}`;
const flagsText = (x: WsRow) => x.flags.map(flagText).join('\n');

/** The month as a workbook, in the Round 1 worksheet's shape. Yellow cells are the person's; the last two columns (hidden) are Studio's. */
export async function exportXlsx(ws: Worksheet, opts: { by?: string; due?: Partial<Record<Step, string>>; now?: Date } = {}): Promise<Buffer> {
  const r = S.loadRules();
  const wb = new ExcelJS.Workbook();
  wb.created = opts.now || new Date();
  const both = ws.region === 'all';
  const regionWords = both ? 'US and Canada' : ws.region === 'CA' ? 'Canada' : 'US';

  const start = wb.addWorksheet('Start here');
  start.columns = [{ width: 8 }, { width: 20 }, { width: 62 }, { width: 62 }, { width: 14 }];
  start.addRow([`Trupanion ${ws.round_label}: copy worksheet`]).font = { bold: true, size: 14 };
  start.addRow([`How the copy moves forward, one tab per step. Yellow cells are yours: choose Keep, Cut or Rewrite, and type a rewrite beside the line. Don't change the other cells, or move or delete rows: Studio reads the sheet back by row. ${regionWords} · exported ${(opts.now || new Date()).toISOString().slice(0, 10)}${opts.by ? ` by ${opts.by}` : ''}.`]).alignment = { wrapText: true };
  start.mergeCells('A2:E2'); start.getRow(2).height = 48;
  start.addRow([]);
  start.addRow(['Step', 'Tab', 'What it is', 'What we need from you', 'By']).eachCell(c => { c.font = { bold: true }; c.fill = HEAD_FILL; });
  const c = ws.counts;
  start.addRow(['1', STEPS[0].tab, `${c.on_image.total} on-image lines (headlines, subheads and carousel cards), by persona and asset.`, 'Keep, cut or rewrite each line.', opts.due?.on_image || '']);
  start.addRow(['2', STEPS[1].tab, `${c.primary.total} shared primary texts and captions: the same pool runs under every persona's assets.`, `Keep, cut or rewrite; add your own in rows N1 to N${NEW_ROWS}.`, opts.due?.primary || '']);
  start.addRow(['3', STEPS[2].tab, `${c.headline.total} shared headlines, the same way.`, `Keep, cut or rewrite; add your own in rows N1 to N${NEW_ROWS}.`, opts.due?.headline || '']);
  start.addRow([]);
  start.addRow(['Red breaks a client rule as written and needs a rewrite. Amber is only "have a look": it is yours to keep as it is. Clear has no flags. The "Flag key" tab says what each flag means.']).alignment = { wrapText: true };
  start.mergeCells(`A${start.rowCount}:E${start.rowCount}`); start.getRow(start.rowCount).height = 34;
  for (let i = 5; i <= 7; i++) start.getRow(i).alignment = { wrapText: true, vertical: 'top' };

  for (const s of STEPS) {
    const rows = ws.steps[s.key];
    const sh = wb.addWorksheet(s.tab);
    const onImage = s.key === 'on_image';
    const lead = onImage ? ['Persona', 'Asset', 'Where'] : [];
    const head = ['#', ...(both ? ['Region'] : []), ...lead, 'Line', 'Chars', ...(onImage ? ['Visible'] : []), 'Status', 'Flags', 'Your call', 'Your rewrite', 'Rewrite chars', 'Row id', 'Hash'];
    const at = (name: string) => head.indexOf(name) + 1, L = (name: string) => colLetter(at(name));
    const widths: Record<string, number> = { '#': 6, Region: 8, Persona: 20, Asset: 26, Where: 12, Line: 60, Chars: 7, Visible: 8, Status: 9, Flags: 44, 'Your call': 12, 'Your rewrite': 60, 'Rewrite chars': 9, 'Row id': 30, Hash: 12 };
    sh.columns = head.map(h => ({ width: widths[h] }));
    const cc = ws.counts[s.key];
    sh.addRow([`Step ${STEPS.indexOf(s) + 1}. ${s.title}${onImage ? ', by persona and asset' : ' (shared across personas)'}`]).font = { bold: true, size: 13 };
    sh.addRow([`${cc.total} lines: ${cc.red} red, ${cc.amber} amber, ${cc.clear} clear${cc.cut ? ` (${cc.cut} cut, not counted)` : ''}. Yellow cells are yours: choose Keep, Cut or Rewrite, and type the rewrite beside the line.`]);
    const guide = onImage ? null : S.fieldLimits(s.key === 'primary' ? 'meta_primary' : 'meta_headline', r);
    sh.addRow(onImage ? ['Visible: the guide for what reads comfortably on the image (carousel cards have a looser one). Nothing is cut off; it is about how much there is to read.']
      : [`Visible characters before the text is cut off: ${guide?.visible ?? ''}`]);
    sh.addRow([]);
    sh.addRow(head).eachCell(cell => { cell.font = { bold: true }; cell.fill = HEAD_FILL; cell.alignment = { wrapText: true, vertical: 'top' }; });
    const first = 6;
    const put = (x: WsRow | null, i: number) => {
      const n = first + i;
      const line = `${L('Line')}${n}`, rw = `${L('Your rewrite')}${n}`;
      const v: Record<string, ExcelJS.CellValue> = {
        '#': x ? x.n : `N${i - rows.length + 1}`, Region: x?.region || (both ? '' : ws.region), Persona: x?.persona_name || '', Asset: x?.asset || '', Where: x?.where || '', Line: x?.text || '',
        Chars: x ? { formula: `LEN(${line})`, result: x.chars } : { formula: `IF(${line}="","",LEN(${line}))`, result: '' }, Visible: x ? x.visible : '',
        Status: x ? STATUS_WORD[x.status] : '', Flags: x ? flagsText(x) : '', 'Your call': x ? CALL_WORD[x.call] : '', 'Your rewrite': '',
        'Rewrite chars': { formula: `IF(${rw}="","",LEN(${rw}))`, result: '' }, 'Row id': x?.id || '', Hash: x ? `h${x.sha256.slice(0, 16)}` : '',
      };
      const row = sh.addRow(head.map(h => v[h]));
      row.alignment = { wrapText: true, vertical: 'top' };
      for (const h of x ? ['Your call', 'Your rewrite'] : ['Your call', 'Your rewrite', 'Line', ...lead, ...(both ? ['Region'] : [])]) row.getCell(at(h)).fill = YELLOW;
      if (x) row.getCell(at('Status')).font = { bold: x.status !== 'clear', color: { argb: x.status === 'red' ? 'FFC00000' : x.status === 'amber' ? 'FF9C5700' : 'FF3A7D44' } };
      row.getCell(at('Your call')).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Keep,Cut,Rewrite"'] };
    };
    rows.forEach((x, i) => put(x, i));
    for (let i = 0; i < NEW_ROWS; i++) put(null, rows.length + i);
    sh.getColumn(at('Row id')).hidden = true; sh.getColumn(at('Hash')).hidden = true;
    sh.views = [{ state: 'frozen', xSplit: at('Line'), ySplit: 5 }];
  }

  const key = wb.addWorksheet('Flag key');
  key.columns = [{ width: 34 }, { width: 9 }, { width: 110 }];
  key.addRow(['What the flags mean']).font = { bold: true, size: 13 };
  key.addRow(['Red breaks a client rule as written and needs a rewrite. Amber is worth a look and is yours to keep. A note is for information.']);
  key.addRow([]);
  key.addRow(['Flag', 'Level', 'Meaning']).eachCell(cell => { cell.font = { bold: true }; cell.fill = HEAD_FILL; });
  const rule = Object.fromEntries([...r.compliance, ...r.brand, ...r.clarity].map((i: any) => [i.id, i]));
  const builtin: Record<string, string> = {
    LIMIT_ON_ASSET: 'More text than reads comfortably in the artwork. Nothing is cut off; shorter is easier to read.', LIMIT_VISIBLE: 'Longer than what shows before the feed cuts it off: keep the point in the first characters.',
    LIMIT_MAX: 'Longer than the field allows.', NEAR_DUP: 'Very close to another line in the same pool.',
    FIG_UNSOURCED: 'A figure that is not in the facts list as written. Use a figure from the list, exactly, or take it out.', FIG_CITATION: 'A survey figure that needs its citation.', FIG_ATTRIBUTION: 'A figure credited to the wrong source.', CHECK_FAILED: 'The check did not finish for this line: re-check it.', SHARED_CTA: 'A shared primary text or caption should end on what to do next (e.g. get a quote).',
  };
  const seen = new Map<string, [string, string, string]>();
  const order = { red: 0, amber: 1, grey: 2 };
  for (const x of STEPS.flatMap(s => ws.steps[s.key])) for (const f of x.flags) {
    if (!seen.has(f.rule)) seen.set(f.rule, [f.name, f.level, [rule[f.rule]?.rule, rule[f.rule]?.what_to_do].filter(Boolean).join(' What to do: ') || builtin[f.rule] || '']);
  }
  for (const [name, level, meaning] of [...seen.values()].sort((a, b) => order[a[1] as 'red'] - order[b[1] as 'red'] || a[0].localeCompare(b[0]))) key.addRow([name, LEVEL_WORD[level as 'red'], meaning]).alignment = { wrapText: true, vertical: 'top' };

  // What Studio needs to read the sheet back: which month and region it was, and when.
  const meta = wb.addWorksheet(META_SHEET, { state: 'veryHidden' });
  for (const [k, v] of Object.entries({ kind: 'studio-worksheet', version: 1, round: ws.round, region: ws.region, rules: ws.rules || '', exported_at: (opts.now || new Date()).toISOString(), exported_by: opts.by || '' })) meta.addRow([k, String(v)]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- reading it back ----------

export interface SheetRow {
  tab: string; step: Step; row: number; n: string; id: string; hash: string;
  line: string; call: 'keep' | 'cut' | 'rewrite' | ''; call_raw: string; rewrite: string;
  persona: string; asset: string; where: string; region: string;
}
export interface SheetParse { round: string; region: string; exported_at: string; rows: SheetRow[]; problems: string[] }

/** A cell's text: formulas give their cached value, rich text its words; smart whitespace is trimmed. */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString();
    if ('richText' in v) return v.richText.map(t => t.text).join('').trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String((v as any).text ?? '').trim();
    if ('error' in v) return '';
    return '';
  }
  return String(v).replace(/ /g, ' ').trim();
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();

export async function parseXlsx(buf: Buffer): Promise<SheetParse> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as any); } catch { throw Object.assign(new Error("That file isn't an Excel workbook (.xlsx). From Google Sheets: File → Download → Microsoft Excel."), { status: 400 }); }
  const meta: Record<string, string> = {};
  wb.getWorksheet(META_SHEET)?.eachRow(row => { meta[cellText(row.getCell(1).value)] = cellText(row.getCell(2).value); });
  const out: SheetParse = { round: meta.round || '', region: meta.region || '', exported_at: meta.exported_at || '', rows: [], problems: [] };
  let found = 0;
  for (const s of STEPS) {
    // The tab by name, or by its number ("1 …") if it was renamed.
    const sh = wb.worksheets.find(w => norm(w.name) === norm(s.tab)) || wb.worksheets.find(w => w.name.trim().startsWith(`${STEPS.indexOf(s) + 1} `));
    if (!sh) { out.problems.push(`No "${s.tab}" tab: its rows weren't read.`); continue; }
    found++;
    let headRow = 0; const col: Record<string, number> = {};
    sh.eachRow((row, i) => {
      if (headRow) return;
      const cells: string[] = []; row.eachCell({ includeEmpty: true }, (cell, c) => { cells[c] = norm(cellText(cell.value)); });
      if (cells.includes('#') && cells.includes('your call')) { headRow = i; cells.forEach((h, c) => { if (h && !(h in col)) col[h] = c; }); }
    });
    if (!headRow) { out.problems.push(`"${sh.name}": no header row with "#" and "Your call": its rows weren't read.`); continue; }
    if (!col['row id']) out.problems.push(`"${sh.name}": the hidden "Row id" column is missing, so its existing lines can't be matched. Export a fresh sheet and copy your calls into it.`);
    const get = (row: ExcelJS.Row, name: string) => (col[name] ? cellText(row.getCell(col[name]).value) : '');
    sh.eachRow((row, i) => {
      if (i <= headRow) return;
      const raw = get(row, 'your call'), w = norm(raw);
      const call: SheetRow['call'] = /^keep/.test(w) ? 'keep' : /^cut/.test(w) ? 'cut' : /^(rewrite|edit|change)/.test(w) ? 'rewrite' : '';
      const x: SheetRow = {
        tab: sh.name, step: s.key, row: i, n: get(row, '#'), id: get(row, 'row id'), hash: get(row, 'hash'), line: get(row, 'line'), call, call_raw: raw, rewrite: get(row, 'your rewrite'),
        persona: get(row, 'persona'), asset: get(row, 'asset'), where: get(row, 'where'), region: get(row, 'region'),
      };
      if (x.id || x.line || x.rewrite || raw) out.rows.push(x);
    });
  }
  if (!found) throw Object.assign(new Error('This workbook has none of the worksheet tabs (1 On-image copy, 2 Primary text, 3 Headlines). Export the sheet from Studio and fill that one in.'), { status: 400 });
  return out;
}

export type Action = 'keep' | 'cut' | 'rewrite' | 'new' | 'none' | 'conflict' | 'error';
export interface PreviewRow {
  tab: string; row: number; n: string; step: Step; action: Action; id?: string; run?: string;
  /** The wording now in Studio (existing lines), and the wording that will be written (a rewrite or a new line). */
  now?: string; text?: string; chars?: number; visible?: number;
  /** Why nothing happens, what clashes, or what's wrong. */
  note?: string;
  /** New lines: where they go. */
  persona?: string; territory?: string; field?: string; card?: number; region?: Region; where?: string;
}
export interface ImportPreview {
  round: string; region: string; exported_at: string; problems: string[]; rows: PreviewRow[];
  counts: Record<Action, number>;
  /** The checks this import runs (each rewrite and each new line is checked in full). */
  estimate: { usd: number; seconds: number; checks: number };
}

/** Where a new on-image row goes: persona and asset by name or code, the field and card from "Where". */
function placeNew(x: SheetRow, r: Rules): { persona: string; territory: string; field: string; card?: number } | { error: string } {
  const find = <T extends { name: string }>(o: Record<string, T>, w: string) => Object.keys(o).find(k => k.toLowerCase() === w.toLowerCase() || norm(o[k].name) === norm(w) || norm(o[k].name.replace(/\s*\(.*\)$/, '')) === norm(w));
  if (x.step !== 'on_image') return { persona: S.SHARED_PERSONA, territory: S.SHARED_TERRITORY, field: x.step === 'primary' ? 'meta_primary' : 'meta_headline' };
  if (!x.asset) return { error: 'A new on-image line needs its asset (the Asset column)' };
  const territory = find(r.territories, x.asset);
  if (!territory || territory === S.SHARED_TERRITORY) return { error: `No asset called "${x.asset}" in Studio` };
  if (r.territories[territory].status === 'retired') return { error: `"${x.asset}" is retired: it takes no new lines` };
  const persona = r.territories[territory].persona;
  if (x.persona && find(r.personas, x.persona) !== persona) return { error: `"${x.asset}" belongs to ${r.personas[persona]?.name || persona}, not "${x.persona}"` };
  const w = norm(x.where || 'headline');
  const card = /(card|slide)\s*(\d+)/.exec(w);
  const sub = /sub/.test(w);
  const field = Object.keys(r.fields).find(f => S.isOnImageField(f, r) && String(r.fields[f].platform).toUpperCase().startsWith('META') && isSubField(f, r) === sub);
  if (!field) return { error: sub ? 'These rules have no on-image subhead field' : 'These rules have no on-image field' };
  if (!card && !/^(headline|subhead|sub|on image.*)$/.test(w)) return { error: `"${x.where}" isn't Headline, Subhead or Card N` };
  return { persona, territory, field, ...(card ? { card: Number(card[2]) } : {}) };
}

/**
 * What an import would do, row by row, against Studio as it is now. Nothing is written. A row whose wording changed in
 * Studio after the sheet was exported is a conflict: it's shown with both wordings and left alone unless `accept` names it.
 */
export async function previewImport(sheet: SheetParse, view: RoundView, opts: { accept?: string[] } = {}): Promise<ImportPreview> {
  const r = S.loadRules();
  const round = view.ids ? [...view.ids][0] : view.active.id;
  const problems = [...sheet.problems];
  if (sheet.round && sheet.round !== round) problems.push(`This sheet was exported from ${sheet.round}; you are working in ${round}. Lines are matched by id, and new lines go into ${round}.`);
  const accept = new Set(opts.accept || []);
  const lines = new Map<string, { l: Line; run: string; brief: S.Brief }>();
  const wording = new Set<string>();
  for (const run of await S.listBatches(undefined, undefined)) {
    const b = await S.loadBatch(run.id);
    for (const l of b.lines) {
      lines.set(l.id, { l, run: b.id, brief: b.brief });
      if (inView(view, roundOf(l, b.brief)) && l.decision !== 'cut') wording.add(`${l.persona}|${l.territory}|${l.field}|${S.regionOfLine(l, b.brief)}|${S.finalText(l).trim()}`);
    }
  }
  const rows: PreviewRow[] = [];
  let usd = 0, checks = 0;
  const seenIds = new Set<string>();
  const defaultRegion = (sheet.region === 'CA' ? 'CA' : 'US') as Region;
  for (const x of sheet.rows) {
    const base = { tab: x.tab, row: x.row, n: x.n, step: x.step };
    if (x.call_raw && !x.call) { rows.push({ ...base, action: 'error', id: x.id || undefined, note: `"${x.call_raw}" isn't Keep, Cut or Rewrite` }); continue; }
    if (!x.id) {
      // A new line: typed in the Line cell of a blank row (or in "Your rewrite", if that's where it was typed).
      const text = (x.line || x.rewrite).trim();
      if (!text || x.call === 'cut') continue;
      const place = placeNew(x, r);
      if ('error' in place) { rows.push({ ...base, action: 'error', text, note: place.error }); continue; }
      const region = (/^ca/i.test(x.region) ? 'CA' : /^us/i.test(x.region) ? 'US' : defaultRegion) as Region;
      const where = whereOf(place, r);
      const k = `${place.persona}|${place.territory}|${place.field}|${region}|${text}`;
      if (wording.has(k)) { rows.push({ ...base, action: 'none', text, note: 'Already in Studio with this wording' }); continue; }
      wording.add(k);
      rows.push({ ...base, action: 'new', text, chars: [...text].length, visible: S.fieldLimits(place.field, r, place)?.visible, ...place, region, where });
      continue;
    }
    const hit = lines.get(x.id);
    if (!hit) { rows.push({ ...base, action: 'error', id: x.id, note: 'This row id isn\'t a line in Studio (the row may come from another sheet)' }); continue; }
    if (seenIds.has(x.id)) { rows.push({ ...base, action: 'error', id: x.id, note: 'This line is on the sheet twice (a copied row): only the first is read' }); continue; }
    seenIds.add(x.id);
    const { l, run } = hit;
    const now = S.finalText(l);
    const self = { ...base, id: l.id, run, now, visible: S.fieldLimits(l.field, r, l)?.visible };
    const rewrite = x.rewrite.trim();
    const wants: 'keep' | 'cut' | 'rewrite' | '' = x.call === 'cut' ? 'cut' : (x.call === 'rewrite' || (rewrite && x.call !== 'keep')) ? 'rewrite' : x.call === 'keep' && rewrite ? 'rewrite' : x.call;
    if (!wants) continue;
    if (x.call === 'rewrite' && !rewrite) { rows.push({ ...self, action: 'error', note: 'Rewrite chosen, but the rewrite cell is empty' }); continue; }
    // A person's own undecided line already counts as kept, so "Keep" on it is no change.
    const current = l.decision === 'cut' ? 'cut' : isKept(l) || impliedKeep(l) ? 'keep' : '';
    const same = wants === 'cut' ? current === 'cut' : wants === 'keep' ? current === 'keep' : rewrite === now && current === 'keep';
    if (same) continue;
    const changed = !!x.hash && !`h${S.lineHash(l)}`.startsWith(x.hash);
    if (changed && !accept.has(l.id)) { rows.push({ ...self, action: 'conflict', text: wants === 'rewrite' ? rewrite : undefined, note: `Changed in Studio since the sheet was exported (the sheet had "${x.line}"): the sheet's ${wants} isn't applied unless you choose it` }); continue; }
    if (l.ready && !l.ready.superseded_by && wants !== 'keep') { rows.push({ ...self, action: 'error', note: `Signed off in Build (${l.ready.signoff_id}): change it there` }); continue; }
    if (wants === 'rewrite' && rewrite !== now) {
      usd += S.estimate({ ...hit.brief, own_lines: [{ text: rewrite, field: l.field }] }, { ownOnly: true }).usd; checks++;
      rows.push({ ...self, action: 'rewrite', text: rewrite, chars: [...rewrite].length });
    } else rows.push({ ...self, action: wants === 'rewrite' ? 'keep' : wants });
  }
  const fresh = newRows(rows);
  if (fresh.length) { const e = Bulk.estimateBulk(fresh); usd += e.usd; checks += fresh.length; }
  const counts = { keep: 0, cut: 0, rewrite: 0, new: 0, none: 0, conflict: 0, error: 0 } as Record<Action, number>;
  for (const x of rows) counts[x.action]++;
  return { round: sheet.round, region: sheet.region, exported_at: sheet.exported_at, problems, rows, counts, estimate: { usd: Math.round(usd * 1000) / 1000, seconds: checks * 8, checks } };
}
const newRows = (rows: PreviewRow[]): Bulk.BulkRow[] => rows.filter(x => x.action === 'new').map((x, i) => ({ n: i + 1, persona: x.persona!, territory: x.territory!, field: x.field!, text: x.text!, region: x.region!, notes: [], ...(x.card ? { card: x.card } : {}) }));

export interface ImportResult { applied: Record<'keep' | 'cut' | 'rewrite' | 'new', number>; skipped: number; failed: Array<{ n: string; tab: string; error: string }>; runs: string[]; bulk?: string }

/**
 * Apply the sheet: the preview is worked out again against Studio as it is at this moment, then each row is written
 * through the same calls the screens use (so locks, history and "for" are the same). Rewrites are re-checked; new
 * lines are filed and checked as a copy check.
 */
export async function applyImport(sheet: SheetParse, view: RoundView, api: Api, opts: { user?: string; for?: string; accept?: string[] }, out: (e: StudioEvent) => void = () => {}): Promise<ImportResult> {
  // The copy check inside reports its own "done"; this job has one, at the end, with the result.
  const emit = (e: StudioEvent) => { if (e.type !== 'done') out(e); };
  const p = await previewImport(sheet, view, { accept: opts.accept });
  const res: ImportResult = { applied: { keep: 0, cut: 0, rewrite: 0, new: 0 }, skipped: p.counts.conflict + p.counts.error + p.counts.none, failed: [], runs: [] };
  const todo = p.rows.filter(x => x.action === 'keep' || x.action === 'cut' || x.action === 'rewrite');
  let done = 0;
  for (const x of todo) {
    emit({ type: 'status', message: `${x.action === 'rewrite' ? 'Re-checking the rewrite of' : x.action === 'cut' ? 'Cutting' : 'Keeping'} ${x.n} (${done} of ${todo.length} done)` });
    try {
      if (x.action === 'rewrite') {
        await S.setDecision(x.run!, x.id!, { decision: 'keep', edited_text: x.text! }, opts.user, opts.for);
        await R.recheckLine(x.run!, x.id!, api, opts.user);
      } else await S.setDecision(x.run!, x.id!, { decision: x.action as 'keep' | 'cut' }, opts.user, opts.for);
      res.applied[x.action as 'keep']++;
    } catch (e: any) { res.failed.push({ n: x.n, tab: x.tab, error: e.message }); }
    done++;
  }
  const fresh = newRows(p.rows);
  if (fresh.length) {
    const rec = await Bulk.runBulk({ rows: fresh, errors: [], header: true }, api, { user: opts.user, for: opts.for }, emit);
    res.applied.new = rec.lines; res.runs = rec.runs; res.bulk = rec.id;
  }
  out({ type: 'done', batch: 'worksheet-import', result: res });
  return res;
}
