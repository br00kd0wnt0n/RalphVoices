// What `studio.ts db-import` carries from a studio folder into the database.
// Brook's decision (28 Sep): import only the kickoff runs (from 28 Sep) with
// their decisions and taste examples; everything else starts clean. So runs are
// chosen by date (`since`) or by id (`runs`), planted-line checks (adhoc-*)
// are never carried, and everything else follows the chosen runs: the briefs
// they were written from, their decision history, their taste examples. Blind
// compares are a separate exercise and come across only when asked for.

import type { EditRecord, StudioStore } from './store.js';

export interface ImportOptions {
  /** Keep runs created on or after this date (YYYY-MM-DD, UTC). */
  since?: string;
  /** Keep exactly these run ids (overrides since). */
  runs?: string[];
  /** Also carry blind compares created on or after `since` (or all, with no since). */
  compares?: boolean;
}

export interface ImportPlan {
  runs: Array<{ id: string; created: string; created_by: string; lines: number; decided: number; kept: number }>;
  skipped: Array<{ id: string; created: string; why: string }>;
  briefs: string[];
  taste: any[];
  history: EditRecord[];
  compares: string[];
  skippedCompares: string[];
}

export async function planImport(src: StudioStore, opts: ImportOptions, historyRecords: EditRecord[] = [], briefNames: string[] = []): Promise<ImportPlan> {
  if (opts.since && !/^\d{4}-\d{2}-\d{2}$/.test(opts.since)) throw new Error(`--since takes a date like 2026-09-28, not "${opts.since}"`);
  const wanted = opts.runs?.length ? new Set(opts.runs) : null;
  const plan: ImportPlan = { runs: [], skipped: [], briefs: [], taste: [], history: [], compares: [], skippedCompares: [] };
  const briefsWanted = new Set<string>();
  for (const id of (await src.listBatchIds()).sort()) {
    const b = await src.getBatch(id);
    const created = String(b.created || '');
    const why = id.startsWith('adhoc-') ? 'planted-line check'
      : wanted ? (wanted.has(id) ? '' : 'not listed')
      : opts.since && created.slice(0, 10) < opts.since ? `before ${opts.since}` : '';
    if (why) { plan.skipped.push({ id, created, why }); continue; }
    const lines = b.lines || [];
    plan.runs.push({
      id, created, created_by: b.created_by || '', lines: lines.length,
      decided: lines.filter((l: any) => l.decision).length,
      kept: lines.filter((l: any) => l.decision === 'keep' || l.decision === 'edit').length,
    });
    if (b.brief?.name) briefsWanted.add(b.brief.name);
  }
  if (wanted) for (const id of wanted) if (!plan.runs.some(r => r.id === id)) throw new Error(`No run ${id} in the folder`);
  const ids = new Set(plan.runs.map(r => r.id));
  // Line ids are `<run id>-L01`; match on the run id itself, since runs started in the same second are `<id>-2`.
  const runOf = (lineId: string) => lineId.replace(/-L\d+$/, '');
  plan.briefs = briefNames.filter(n => briefsWanted.has(n.replace(/\.json$/, '')));
  plan.taste = (await src.getTaste()).filter((t: any) => ids.has(String(t.batch || runOf(String(t.id || '')))));
  plan.history = historyRecords.filter(e => ids.has(e.batch_id));
  for (const name of await src.listCompares()) {
    const set = await src.getCompare(name);
    const ok = opts.compares && (!opts.since || String(set.created || '').slice(0, 10) >= opts.since);
    (ok ? plan.compares : plan.skippedCompares).push(name);
  }
  return plan;
}

export function describePlan(p: ImportPlan): string {
  const out = ['Runs to import:'];
  for (const r of p.runs) out.push(`  ${r.id}  ${r.created.slice(0, 16)}  ${r.created_by || '(no name)'}  ${r.lines} lines, ${r.decided} decided, ${r.kept} kept`);
  if (!p.runs.length) out.push('  (none)');
  out.push(`Skipped runs: ${p.skipped.length ? p.skipped.map(s => `${s.id} (${s.why})`).join(', ') : 'none'}`);
  out.push(`Briefs: ${p.briefs.length ? p.briefs.join(', ') : 'none'}`);
  out.push(`Taste examples: ${p.taste.length}`);
  out.push(`Decision-history records: ${p.history.length}`);
  out.push(`Blind compares: ${p.compares.length ? p.compares.join(', ') : 'none'}${p.skippedCompares.length ? ` (not imported: ${p.skippedCompares.join(', ')})` : ''}`);
  return out.join('\n');
}

/**
 * Decisions made before attribution existed (B1-lite) have no decided_by or
 * decided_at. On import they're attributed to the person who ran the batch,
 * at the batch's last save, and each gets one history record marked imported,
 * unless the folder's history already covers that line. Changes the batch in place.
 */
export function attributeDecisions(b: any, existing: EditRecord[]): EditRecord[] {
  const out: EditRecord[] = [];
  const covered = new Set(existing.map(e => e.line_id));
  const by = b.created_by || 'unknown';
  const at = b.updated || b.created || new Date().toISOString();
  for (const l of b.lines || []) {
    if (!l.decision) continue;
    if (!l.decided_by) l.decided_by = by;
    if (!l.decided_at) l.decided_at = at;
    if (!covered.has(l.id)) {
      out.push({
        line_id: l.id, batch_id: b.id, by: l.decided_by, at: l.decided_at,
        before: { decision: '', edited_text: '', note: '' },
        after: { decision: l.decision, edited_text: l.edited_text || '', note: l.note || '', imported: true },
      });
    }
  }
  return out;
}
