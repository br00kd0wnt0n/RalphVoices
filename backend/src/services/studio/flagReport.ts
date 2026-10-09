// The Pre-flight flag report (Brook, 9 Oct): one document for the ads in view on Assets, to send to the team. Internal:
// it is not Trupanion's compliance decision and carries none of it. Pure: the Preflight service gathers the ads
// (flagReport in preflight.ts), this writes them as Markdown, a page that pastes cleanly into a doc (HTML), and CSV.
// A rule with an open question prints its status note from the rules file (`flag_notes`), so the team doesn't read
// an unanswered question as a design error; nothing here knows which rule that is.
import { whoWords } from '../../utils/actor.js';

export type Severity = 'red' | 'amber' | 'grey';
export interface ReportFlag {
  rule: string; severity: Severity; label: string; source?: string; quote?: string; why?: string; where?: string; size?: string;
  check?: string; cross_persona?: boolean; persona?: string;
  /** The copy options the flag was found with, when not every one on the ad (their numbers). */
  options?: number[];
  override?: { reason: string; by: string; for?: string; at: string } | null;
  agreements?: Array<{ by: string; agree: boolean; note?: string; at: string }>;
}
export interface ReportAd {
  /** The ad's name (the visual-level code). */
  ad: string;
  /** The asset (territory) in words, and its persona. */
  asset: string; persona: string; region: string;
  kind?: string;
  upload: null | { files: Array<{ filename: string; size?: string | null }>; uploaded_by: string; uploaded_at: string };
  sizes: { expected: string[]; uploaded: string[]; missing: string[] };
  audit: null | { status: string; finished_at?: string | null; started_by?: string | null; rules_version?: string | null; stale?: string | null; error?: string | null; notes?: string[] };
  /** Pre-flight marked passed: by whom. */
  passed?: string;
  flags: ReportFlag[];
}
export interface FlagReportInput {
  title: string;
  /** e.g. "Month 1 · US · DINKs". */
  scope: string;
  at: string;
  by?: string;
  rules_version?: string;
  ads: ReportAd[];
  /** Rule id → a status note printed beside its flags (rules file `flag_notes`). */
  notes?: Record<string, string>;
  /** Marks a test round's report. */
  test?: boolean;
}

const SEV_WORD: Record<Severity, string> = { red: 'Red', amber: 'Amber', grey: 'Note' };
const SEVS: Severity[] = ['red', 'amber', 'grey'];
const day = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const stop = (s: string) => s.trim().replace(/[.:]$/, '');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Where a flag applies: its size, and its card or frame. */
export function flagPlace(f: ReportFlag): string {
  const where = f.where && !/^image$/i.test(f.where) ? f.where : '';
  return [f.size, where].filter(Boolean).join(', ');
}
const checked = (a: ReportAd) => a.audit?.status === 'done';
const openReds = (a: ReportAd) => a.flags.filter(f => f.severity === 'red' && !f.override);

/** One line on what needs doing, from the flags alone. */
export function needsDoing(a: ReportAd, notes: Record<string, string> = {}): string {
  if (!a.upload) return 'Artwork not uploaded yet.';
  if (!a.audit) return 'Uploaded, not checked yet.';
  if (a.audit.status === 'queued' || a.audit.status === 'running') return 'Being checked.';
  if (!checked(a)) return 'The check did not finish: run it again in Assets.';
  const red = openReds(a);
  const waiting = red.filter(f => notes[f.rule]), fix = red.filter(f => !notes[f.rule]);
  // A long rule ("…: the US disclaimer is expected on this asset") is named by its first clause; the ad's section has it whole.
  const names = (fs: ReportFlag[]) => [...new Set(fs.map(f => stop(f.label).split(': ')[0]))].join('; ');
  const parts: string[] = [];
  if (fix.length) parts.push(`Fix or override ${fix.length} red: ${names(fix)}.`);
  if (waiting.length) parts.push(`${plural(waiting.length, 'red')} on an open question: ${names(waiting)}.`);
  const overridden = a.flags.filter(f => f.severity === 'red' && f.override).length;
  if (!red.length) parts.push(overridden ? `No open red (${overridden} overridden).` : 'No red flags.');
  const amber = a.flags.filter(f => f.severity === 'amber').length;
  if (amber) parts.push(`${amber} amber to look at.`);
  if (a.sizes.missing.length) parts.push(`${a.sizes.missing.join(', ')} not uploaded.`);
  if (a.audit.stale) parts.push('Checked before the latest rules or checks: check it again.');
  return parts.join(' ');
}

// ---------- the document, then its two renderings ----------

type Inline = string;
type Block = { h: 1 | 2 | 3; text: string } | { p: Inline } | { ul: Inline[] } | { table: { head: string[]; rows: string[][] } };

function flagLine(f: ReportFlag, notes: Record<string, string>): string {
  const place = flagPlace(f);
  const head = `**${stop(f.label)}**${place ? ` (${place})` : ''}${f.options?.length ? ` (copy option ${f.options.join(', ')} only)` : ''}`;
  const bits: string[] = [];
  if (f.quote) bits.push(quoteWords(f.quote));
  if (f.why) bits.push(stop(f.why));
  if (f.cross_persona && f.persona) bits.push(`How ${f.persona} would read it; this ad is not aimed at them`);
  if (notes[f.rule]) bits.push(`_Status: ${stop(notes[f.rule])}_`);
  if (f.override) bits.push(`Overridden by ${whoWords(f.override.by, f.override.for)}, ${day(f.override.at)}: “${f.override.reason}”`);
  for (const g of f.agreements || []) bits.push(`${g.by} ${g.agree ? 'agrees' : 'disagrees'}${g.note ? `: “${g.note}”` : ''}`);
  if (f.source) bits.push(`Rule: ${stop(f.source)}`);
  return `${head}. ${bits.join('. ')}${bits.length ? '.' : ''}`;
}

/** A flag's quote: one that says what it is ("signed off: …", "approved: …") stays as written; a bare one is from the asset. */
export function quoteWords(q: string): string {
  const t = q.trim();
  return /^[a-z][a-z0-9 ]{2,40}:\s/i.test(t) ? stop(t.charAt(0).toUpperCase() + t.slice(1)) : `On the asset: “${t}”`;
}

export function flagReportBlocks(r: FlagReportInput): Block[] {
  const notes = r.notes || {};
  const withArt = r.ads.filter(a => a.upload), without = r.ads.filter(a => !a.upload);
  const out: Block[] = [];
  out.push({ h: 1, text: `${r.test ? 'TEST: ' : ''}${r.title}` });
  out.push({ p: `${r.scope}. Written from Voices Studio on ${day(r.at)}${r.by ? ` by ${r.by}` : ''}. **Internal: for the Ralph team, not for Add3 or Trupanion.** Trupanion’s compliance decision is recorded separately and is not part of this report.` });
  out.push({ p: `${plural(withArt.length, 'ad')} with artwork${without.length ? `; ${without.length} with none yet` : ''}. Each ad’s artwork was compared with the copy signed off in Studio, the client’s compliance and brand rules, and what puts its audience off.` });
  out.push({ ul: [
    '**Red** breaks a client rule. It must be fixed, or overridden with a reason, before Pre-flight can be passed.',
    '**Amber** is worth a look. It does not block anything.',
    '**Note** is for information, mostly how other audiences would read the ad.',
  ] });
  if (withArt.length) {
    out.push({ h: 2, text: 'Summary' });
    out.push({ table: { head: ['Ad', 'Sizes checked', 'Red', 'Amber', 'What needs doing'], rows: withArt.map(a => [
      `${a.asset} (${a.persona}${a.kind ? `, ${a.kind}` : ''})`, a.sizes.uploaded.join(', ') || '-',
      checked(a) ? String(a.flags.filter(f => f.severity === 'red').length) : '-', checked(a) ? String(a.flags.filter(f => f.severity === 'amber').length) : '-', needsDoing(a, notes),
    ]) } });
  }
  if (without.length) out.push({ p: `**No artwork uploaded yet (${without.length}):** ${without.map(a => `${a.asset} (${a.persona})`).join(', ')}.` });

  // Rules with an open question, said once, before the ads.
  const open = Object.keys(notes).filter(rule => withArt.some(a => a.flags.some(f => f.rule === rule)));
  if (open.length) {
    out.push({ h: 2, text: 'Open questions behind some flags' });
    out.push({ ul: open.map(rule => {
      const hit = withArt.filter(a => a.flags.some(f => f.rule === rule));
      const label = stop(hit[0].flags.find(f => f.rule === rule)!.label);
      return `**${label}** (${plural(hit.length, 'ad')}: ${hit.map(a => a.asset).join(', ')}). ${stop(notes[rule])}. Until it is settled the flag stays as it is; it is not a design error.`;
    }) });
  }

  for (const a of withArt) {
    out.push({ h: 2, text: `${a.asset} (${a.persona})` });
    out.push({ p: `Ad name: ${a.ad}. ${needsDoing(a, notes)}${a.passed ? ` Pre-flight passed by ${a.passed}.` : ''}` });
    if (!checked(a)) continue;
    for (const sev of SEVS) {
      const fs = a.flags.filter(f => f.severity === sev);
      if (!fs.length) continue;
      out.push({ h: 3, text: `${SEV_WORD[sev]} (${fs.length})` });
      out.push({ ul: fs.map(f => flagLine(f, notes)) });
    }
    if (!a.flags.length) out.push({ p: 'No flags.' });
  }

  out.push({ h: 2, text: 'What was checked' });
  out.push({ ul: [
    ...withArt.map(a => `**${a.asset} (${a.persona}):** ${a.upload!.files.map(f => `${f.filename}${f.size ? ` (${f.size})` : ''}`).join(', ')}. Uploaded by ${a.upload!.uploaded_by || 'unknown'}, ${day(a.upload!.uploaded_at)}.${a.audit ? ` ${checked(a) ? 'Checked' : `Check ${a.audit.status}`}${a.audit.finished_at ? ` ${day(a.audit.finished_at)}` : ''}${a.audit.started_by ? ` (started by ${a.audit.started_by})` : ''}${a.audit.rules_version ? `, rules ${a.audit.rules_version}` : ''}.` : ''}${a.audit?.notes?.length ? ` ${a.audit.notes.map(stop).join('. ')}.` : ''}${a.audit?.error ? ` Error: ${stop(a.audit.error)}.` : ''}`),
    ...(r.rules_version ? [`Rules in force now: ${r.rules_version}.`] : []),
    'Flags are prompts for a person to look, not a verdict on the ad. Sign-off stays with the creative lead and compliance clearance with Trupanion.',
  ] });
  return out;
}

const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
export function blocksToMarkdown(blocks: Block[]): string {
  return blocks.map(b => {
    if ('h' in b) return `${'#'.repeat(b.h)} ${b.text}`;
    if ('p' in b) return b.p;
    if ('ul' in b) return b.ul.map(x => `- ${x}`).join('\n');
    return [`| ${b.table.head.join(' | ')} |`, `|${b.table.head.map(() => '---').join('|')}|`, ...b.table.rows.map(r => `| ${r.map(mdCell).join(' | ')} |`)].join('\n');
  }).join('\n\n') + '\n';
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** The **bold** and _italic_ this report uses, as HTML (after escaping). */
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])_(.+?)_(?=[\s.,)]|$)/g, '$1<em>$2</em>');
/** A plain page: opens in a browser or Word, and pastes into a doc with its headings, lists and table. */
export function blocksToHtml(blocks: Block[], title: string): string {
  const body = blocks.map(b => {
    if ('h' in b) return `<h${b.h}>${esc(b.text)}</h${b.h}>`;
    if ('p' in b) return `<p>${inline(b.p)}</p>`;
    if ('ul' in b) return `<ul>\n${b.ul.map(x => `<li>${inline(x)}</li>`).join('\n')}\n</ul>`;
    return `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">\n<thead><tr>${b.table.head.map(h => `<th align="left">${esc(h)}</th>`).join('')}</tr></thead>\n<tbody>\n${b.table.rows.map(r => `<tr>${r.map(c => `<td valign="top">${inline(c)}</td>`).join('')}</tr>`).join('\n')}\n</tbody>\n</table>`;
  }).join('\n');
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>\n<style>body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.45;max-width:820px;margin:32px auto;padding:0 16px;color:#111}h1{font-size:20pt}h2{font-size:14pt;margin-top:28px}h3{font-size:11pt;margin-bottom:4px}li{margin-bottom:6px}th{background:#eee}</style>\n</head><body>\n${body}\n</body></html>\n`;
}

/** One row per flag, for a sheet (an ad with no flags, or no artwork, still has a row). */
export function flagReportRows(r: FlagReportInput): string[][] {
  const notes = r.notes || {};
  const head = ['Ad', 'Asset', 'Persona', 'Region', 'Severity', 'Size / card', 'Flag', 'On the asset / signed off', 'Why', 'Status note', 'Overridden', 'Marks', 'Rule source', 'Rule id', 'Copy options', 'Files checked', 'Uploaded', 'Checked', 'Rules'];
  const rows: string[][] = [];
  for (const a of r.ads) {
    const base = [a.ad, a.asset, a.persona, a.region];
    const tail = [a.upload ? a.upload.files.map(f => f.filename).join('; ') : '', a.upload ? `${a.upload.uploaded_by}, ${day(a.upload.uploaded_at)}` : '', a.audit?.finished_at ? day(a.audit.finished_at) : a.audit?.status || '', a.audit?.rules_version || ''];
    if (!a.upload || !checked(a) || !a.flags.length) { rows.push([...base, '', '', needsDoing(a, notes), '', '', '', '', '', '', '', '', ...tail]); continue; }
    for (const sev of SEVS) for (const f of a.flags.filter(x => x.severity === sev)) {
      rows.push([...base, SEV_WORD[sev], flagPlace(f), stop(f.label), f.quote || '', f.why || '', notes[f.rule] || '',
        f.override ? `${whoWords(f.override.by, f.override.for)}, ${day(f.override.at)}: ${f.override.reason}` : '',
        (f.agreements || []).map(g => `${g.by} ${g.agree ? 'agrees' : 'disagrees'}${g.note ? `: ${g.note}` : ''}`).join('; '),
        f.source || '', f.rule, f.options?.length ? f.options.join(', ') : 'all', ...tail]);
    }
  }
  return [[r.test ? 'TEST: internal, not for Add3 or Trupanion' : 'Internal: not for Add3 or Trupanion'], head, ...rows];
}

/** The copy option number of a code (A2 → 2; a v# code → its number). */
export const optionOf = (code: string): number => Number(/_[A-Z](\d+)_/.exec(code)?.[1] || /_v(\d+)_/i.exec(code)?.[1] || 1);

/** An ad's flags from its codes' flags: one entry per flag, saying which copy options when not all of them. */
export function mergeAdFlags(byCode: Array<{ code: string; flags: ReportFlag[] }>): ReportFlag[] {
  // The same flag on several sizes is one entry naming the sizes ("1:1, 4:5"); a size-tagged label loses its tag.
  const bare = (f: ReportFlag) => (f.size && f.label.startsWith(`${f.size}: `) ? f.label.slice(f.size.length + 2) : f.label);
  const seen = new Map<string, { flag: ReportFlag; codes: string[]; sizes: string[] }>();
  for (const { code, flags } of byCode) for (const f of flags) {
    const k = [f.rule, f.severity, f.where || '', bare(f), f.quote || ''].join('|');
    const cur = seen.get(k) || { flag: { ...f, label: bare(f) }, codes: [], sizes: [] };
    if (!cur.codes.includes(code)) cur.codes.push(code);
    if (f.size && !cur.sizes.includes(f.size)) cur.sizes.push(f.size);
    seen.set(k, cur);
  }
  const rank: Record<Severity, number> = { red: 0, amber: 1, grey: 2 };
  return [...seen.values()]
    .map(({ flag, codes, sizes }) => ({ ...flag, ...(sizes.length ? { size: sizes.join(', ') } : {}), ...(codes.length < byCode.length ? { options: codes.map(optionOf).sort((a, b) => a - b) } : {}) }))
    .sort((x, y) => rank[x.severity] - rank[y.severity] || Number(!!x.cross_persona) - Number(!!y.cross_persona));
}
