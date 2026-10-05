// Remove a territory's sign-offs (Brook, 5 Oct: three test sign-offs made while trying Build were never a decision).
// The asset goes back to "not signed off" and its codes start again at A1. Run by hand from
// scripts/studio-unsign.ts, never from the app.
//
// What a sign-off writes, and what this does with each:
//   studio_signoffs        the set                          deleted
//   studio_expectations    the expected leader, locked      deleted
//   studio_line_versions   a wording's version, created by  deleted, unless a sign-off that stays uses that version
//                          the first sign-off to use it     (then kept, with its signoff_id cleared)
//   studio_lines.body      `ready` on each signed-off line  removed; or rebuilt from a sign-off that stays and holds
//                          (and `superseded_by` on lines    the line (a shared caption signed off in another territory)
//                          a later set left out)
//   studio_lines.decided_at  set to "now" by the sign-off   put back to the line's last change before the sign-offs,
//                                                           when nothing else has happened to the line since
//   studio_edits           one entry per line per sign-off  kept (it happened), plus one new entry per line saying the
//                                                           sign-offs were removed, so the history explains itself
//   studio_spend           the version checks' cost         kept (the money was spent)
// Nothing else is written by a sign-off: no taste, no studio_inputs, no rounds. Naming codes are not stored anywhere
// but in the sign-offs, so they are free again once those are gone.
//
// It refuses when anything downstream holds one of the codes: an upload, an upload stub, an audit, an asset status or
// a compliance record. Those mean the sign-off was acted on.
import type pg from 'pg';

type Db = Pick<pg.Pool, 'query' | 'connect'>;
type Q = Pick<pg.PoolClient, 'query'>;
export interface UnsignPlan {
  territory: string; region: string;
  signoffs: Array<{ id: string; persona: string; version: number; ready_by: string; ready_at: string; round: string; codes: string[] }>;
  /** Sign-offs of the same territory in another region: listed, never touched. */
  other_regions: string[];
  codes: string[];
  expectations: Array<{ id: string; signoff_id: string; stubs: string[]; reason: string }>;
  line_versions: Array<{ line_id: string; version: number; signoff_id: string; stub: string | null; action: 'delete' | 'keep'; used_by?: string }>;
  lines: Array<{ id: string; batch_id: string; before: any; after: any | null; decided_at_before: string | null; decided_at_after: string | null }>;
  edits_kept: number;
  /** Reasons it must not run. Empty means it can. */
  blockers: string[];
  kept_before: Record<string, number>;
}

const regionOf = (body: any) => String(body?.region || 'US').toUpperCase();
const signoffCodes = (body: any): string[] => [...new Set([
  ...(body?.versions || []).map((v: any) => v.code), ...(body?.on_image || []).map((o: any) => o.visual_key),
  ...(body?.lines || []).flatMap((l: any) => [l.stub, ...(l.codes || [])]),
].filter(Boolean).map(String))];
/** Every (line, version) a sign-off holds. */
const signoffLines = (body: any): Array<{ line_id: string; batch_id: string; version: number; sha256: string; stub: string; codes: string[] }> => {
  const out = new Map<string, any>();
  for (const l of body?.lines || []) out.set(l.line_id, { line_id: l.line_id, batch_id: l.batch_id, version: l.version, sha256: l.sha256, stub: l.stub || '', codes: l.codes || (l.stub ? [l.stub] : []) });
  for (const v of body?.versions || []) for (const f of Object.values(v.fields || {}) as any[]) {
    const cur = out.get(f.line_id) || { line_id: f.line_id, batch_id: f.batch_id, version: f.version, sha256: f.sha256, stub: v.code, codes: [] };
    if (!cur.codes.includes(v.code)) cur.codes.push(v.code);
    out.set(f.line_id, cur);
  }
  for (const o of body?.on_image || []) {
    const cur = out.get(o.line_id) || { line_id: o.line_id, batch_id: o.batch_id, version: o.version, sha256: o.sha256, stub: o.visual_key, codes: [] };
    if (!cur.codes.includes(o.visual_key)) cur.codes.push(o.visual_key);
    out.set(o.line_id, cur);
  }
  return [...out.values()];
};
const keptCounts = async (q: Q, batches: string[]): Promise<Record<string, number>> => {
  if (!batches.length) return {};
  const r = await q.query(`SELECT batch_id, count(*)::int AS n FROM studio_lines WHERE batch_id = ANY($1) AND body->>'decision' IN ('keep', 'edit') GROUP BY batch_id`, [batches]);
  return Object.fromEntries(batches.map(b => [b, r.rows.find(x => x.batch_id === b)?.n || 0]));
};

/** What removing the sign-offs would do. Reads only. */
export async function planUnsign(q: Q, territory: string, region = 'US'): Promise<UnsignPlan> {
  const all = (await q.query(`SELECT id, persona, territory, version, body, ready_by, ready_at FROM studio_signoffs ORDER BY ready_at, version`)).rows;
  const mine = all.filter(s => s.territory === territory && regionOf(s.body) === region.toUpperCase());
  const rest = all.filter(s => !mine.includes(s));
  const ids = mine.map(s => s.id);
  const codes = [...new Set(mine.flatMap(s => signoffCodes(s.body)))].sort();
  const blockers: string[] = [];
  if (!mine.length) blockers.push(`No sign-offs for ${territory} (${region})`);

  // Anything downstream of the codes means the sign-off was acted on.
  const has = async (table: string, col: string) => (await q.query(`SELECT DISTINCT ${col} AS stub FROM ${table} WHERE ${col} = ANY($1)`, [codes])).rows.map(r => r.stub as string);
  for (const [table, col, what] of [['studio_asset_uploads', 'stub', 'an upload'], ['studio_upload_stubs', 'stub', 'an upload stub'], ['studio_audits', 'stub', 'an audit'], ['studio_audit_flags', 'stub', 'audit flags'], ['studio_audit_flags', 'for_stub', 'audit flags'], ['studio_asset_status', 'stub', 'an asset status']] as const) {
    const hit = codes.length ? await has(table, col) : [];
    if (hit.length) blockers.push(`${hit.join(', ')} ${hit.length === 1 ? 'has' : 'have'} ${what} (${table})`);
  }
  // A code some other sign-off also holds would be freed while still in use.
  const shared = codes.filter(c => rest.some(s => signoffCodes(s.body).includes(c)));
  if (shared.length) blockers.push(`${shared.join(', ')} ${shared.length === 1 ? 'is' : 'are'} also in a sign-off that stays`);

  const expectations = ids.length ? (await q.query(`SELECT id, signoff_id, stubs, reason FROM studio_expectations WHERE signoff_id = ANY($1) ORDER BY id`, [ids])).rows : [];
  const restLines = rest.flatMap(s => signoffLines(s.body).map(l => ({ ...l, signoff: s })));
  const versions = ids.length ? (await q.query(`SELECT line_id, version, signoff_id, stub FROM studio_line_versions WHERE signoff_id = ANY($1) ORDER BY line_id, version`, [ids])).rows : [];
  const line_versions = versions.map(v => {
    const user = restLines.find(l => l.line_id === v.line_id && l.version === v.version);
    return { line_id: v.line_id, version: v.version, signoff_id: v.signoff_id, stub: v.stub, action: user ? 'keep' as const : 'delete' as const, ...(user ? { used_by: user.signoff.id } : {}) };
  });

  const rows = ids.length ? (await q.query(
    `SELECT id, batch_id, body, decided_at FROM studio_lines WHERE body->'ready'->>'signoff_id' = ANY($1) OR body->'ready'->>'superseded_by' = ANY($1) OR id = ANY($2) ORDER BY batch_id, position`,
    [ids, [...new Set(mine.flatMap(s => signoffLines(s.body).map(l => l.line_id)))]])).rows : [];
  const lines: UnsignPlan['lines'] = [];
  // The latest sign-off of each set that stays (persona × territory × region): what "signed off" means for a line.
  const latestOf = new Map<string, any>();
  for (const s of rest) latestOf.set(`${s.persona}|${s.territory}|${regionOf(s.body)}`, s);
  for (const row of rows) {
    const ready = row.body.ready || null;
    const byCode = Object.keys(row.body.compliance_by_code || {}).filter(c => codes.includes(c));
    if (byCode.length) blockers.push(`Line ${row.id} has a compliance record for ${byCode.join(', ')}`);
    if (!ready) continue;
    const oursMark = ids.includes(ready.signoff_id), oursSuperseded = ids.includes(ready.superseded_by);
    if (!oursMark && !oursSuperseded) continue;
    let after: any | null;
    if (!oursMark) { const { superseded_by: _gone, ...keep } = ready; after = keep; }
    else {
      // A shared caption also in a set that stays: its mark comes from that set (the most recent one holding it).
      const holder = [...restLines].reverse().find(l => l.line_id === row.id);
      if (holder) {
        const s = holder.signoff, latest = latestOf.get(`${s.persona}|${s.territory}|${regionOf(s.body)}`);
        after = { signoff_id: s.id, version: holder.version, sha256: holder.sha256, ready_by: s.body.ready_by || s.ready_by, ...(s.body.ready_for ? { ready_for: s.body.ready_for } : {}), ready_at: new Date(s.ready_at).toISOString(), stub: holder.stub, codes: holder.codes, changed_since: false, ...(latest && latest.id !== s.id ? { superseded_by: latest.id } : {}) };
      } else after = null;
    }
    // decided_at: the sign-off set it to its own time. Put it back when the sign-offs were the last thing to happen to the line.
    const edits = (await q.query(`SELECT after, at FROM studio_edits WHERE line_id = $1 ORDER BY at, id`, [row.id])).rows;
    const isOurs = (e: any) => !!e.after && typeof e.after === 'object' && 'ready' in e.after && (ids.includes(e.after.ready?.signoff_id) || ids.includes(e.after.ready?.superseded_by));
    const last = edits[edits.length - 1];
    const prior = [...edits].reverse().find(e => !isOurs(e));
    const decidedBefore = row.decided_at ? new Date(row.decided_at).toISOString() : null;
    const decidedAfter = last && isOurs(last) && prior ? new Date(prior.at).toISOString() : decidedBefore;
    lines.push({ id: row.id, batch_id: row.batch_id, before: ready, after, decided_at_before: decidedBefore, decided_at_after: decidedAfter });
  }
  const lineIds = lines.map(l => l.id);
  const edits_kept = lineIds.length ? (await q.query(`SELECT count(*)::int AS n FROM studio_edits WHERE line_id = ANY($1) AND (after->'ready'->>'signoff_id' = ANY($2) OR after->'ready'->>'superseded_by' = ANY($2))`, [lineIds, ids])).rows[0].n : 0;
  const assetEdits = codes.length ? (await q.query(`SELECT DISTINCT line_id FROM studio_edits WHERE line_id = ANY($1)`, [codes.map(c => `asset:${c}`)])).rows.map(r => r.line_id) : [];
  if (assetEdits.length) blockers.push(`There is asset history for ${assetEdits.join(', ')}`);
  return {
    territory, region: region.toUpperCase(),
    signoffs: mine.map(s => ({ id: s.id, persona: s.persona, version: s.version, ready_by: s.ready_by, ready_at: new Date(s.ready_at).toISOString(), round: s.body.round || 'R1', codes: signoffCodes(s.body) })),
    other_regions: all.filter(s => s.territory === territory && !mine.includes(s)).map(s => s.id),
    codes, expectations, line_versions, lines, edits_kept, blockers: [...new Set(blockers)],
    kept_before: await keptCounts(q, [...new Set(lines.map(l => l.batch_id))]),
  };
}

export interface UnsignResult { plan: UnsignPlan; deleted: { signoffs: number; expectations: number; line_versions: number }; kept_versions: number; lines_changed: number; edits_added: number; kept_after: Record<string, number>; codes_left: string[] }

/**
 * Remove them, in one transaction. `expect` is the list of sign-off ids the person saw in the dry run: if the
 * database holds a different list now, nothing is written.
 */
export async function applyUnsign(db: Db, territory: string, region: string, opts: { expect: string[]; by: string; reason?: string }): Promise<UnsignResult> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    // No sign-off can be written while this runs.
    await c.query(`LOCK TABLE studio_signoffs IN SHARE ROW EXCLUSIVE MODE`);
    const plan = await planUnsign(c, territory, region);
    if (plan.blockers.length) throw new Error(`Refusing: ${plan.blockers.join('; ')}`);
    const ids = plan.signoffs.map(s => s.id);
    if (JSON.stringify([...ids].sort()) !== JSON.stringify([...opts.expect].sort())) throw new Error(`Refusing: the sign-offs are now [${ids.join(', ')}], not the ones named [${opts.expect.join(', ')}]. Run the dry run again.`);
    const now = new Date().toISOString();
    let lines_changed = 0, edits_added = 0, kept_versions = 0, deletedVersions = 0;
    for (const l of plan.lines) {
      const r = await c.query(
        `UPDATE studio_lines SET body = (CASE WHEN $2::jsonb IS NULL THEN (body - 'ready') ELSE jsonb_set(body, '{ready}', $2::jsonb) END)
                                   || (CASE WHEN $3::text IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('decided_at', $3::text) END),
                decided_at = $3::timestamptz, updated_at = NOW()
          WHERE id = $1 AND body->'ready' = $4::jsonb`,
        [l.id, l.after === null ? null : JSON.stringify(l.after), l.decided_at_after, JSON.stringify(l.before)]);
      if (r.rowCount !== 1) throw new Error(`Line ${l.id} changed while this ran: nothing was written`);
      lines_changed++;
      await c.query(`INSERT INTO studio_edits (line_id, batch_id, before, after, by_user, at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [l.id, l.batch_id, JSON.stringify({ ready: l.before }), JSON.stringify({ ready: l.after, signoffs_removed: ids, reason: opts.reason || 'Test sign-offs removed' }), opts.by, now]);
      edits_added++;
    }
    for (const v of plan.line_versions) {
      if (v.action === 'delete') deletedVersions += (await c.query(`DELETE FROM studio_line_versions WHERE line_id = $1 AND version = $2 AND signoff_id = $3`, [v.line_id, v.version, v.signoff_id])).rowCount || 0;
      else kept_versions += (await c.query(`UPDATE studio_line_versions SET signoff_id = $4 WHERE line_id = $1 AND version = $2 AND signoff_id = $3`, [v.line_id, v.version, v.signoff_id, v.used_by])).rowCount || 0;
    }
    const exp = (await c.query(`DELETE FROM studio_expectations WHERE signoff_id = ANY($1)`, [ids])).rowCount || 0;
    const so = (await c.query(`DELETE FROM studio_signoffs WHERE id = ANY($1)`, [ids])).rowCount || 0;
    if (so !== ids.length || exp !== plan.expectations.length) throw new Error(`Deleted ${so} sign-offs and ${exp} expectations, expected ${ids.length} and ${plan.expectations.length}: nothing was written`);
    const kept_after = await keptCounts(c, Object.keys(plan.kept_before));
    if (JSON.stringify(kept_after) !== JSON.stringify(plan.kept_before)) throw new Error('The kept lines changed: nothing was written');
    const left = (await c.query(`SELECT body FROM studio_signoffs`)).rows.flatMap(r => signoffCodes(r.body));
    const codes_left = plan.codes.filter(x => left.includes(x));
    if (codes_left.length) throw new Error(`Codes still held by a sign-off: ${codes_left.join(', ')}: nothing was written`);
    await c.query('COMMIT');
    return { plan, deleted: { signoffs: so, expectations: exp, line_versions: deletedVersions }, kept_versions, lines_changed, edits_added, kept_after, codes_left };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

/** The plan in words, row by row. */
export function describePlan(p: UnsignPlan): string {
  const out: string[] = [`Sign-offs for ${p.territory} (${p.region}): ${p.signoffs.length}`];
  for (const s of p.signoffs) out.push(`  DELETE studio_signoffs      ${s.id}  v${s.version}  ${s.round}  by ${s.ready_by}  ${s.ready_at}  codes: ${s.codes.join(', ')}`);
  if (p.other_regions.length) out.push(`  (left alone, another region: ${p.other_regions.join(', ')})`);
  for (const e of p.expectations) out.push(`  DELETE studio_expectations  ${e.id}  expects ${(e.stubs || []).join(', ')}  "${e.reason}"`);
  for (const v of p.line_versions) out.push(v.action === 'delete' ? `  DELETE studio_line_versions ${v.line_id} v${v.version}  (${v.stub || 'no code'}; made by ${v.signoff_id})` : `  KEEP   studio_line_versions ${v.line_id} v${v.version}  (used by ${v.used_by}; its signoff_id moves there)`);
  for (const l of p.lines) {
    out.push(`  UPDATE studio_lines         ${l.id}`);
    out.push(`           ready before: ${JSON.stringify(l.before)}`);
    out.push(`           ready after:  ${l.after === null ? '(removed)' : JSON.stringify(l.after)}`);
    out.push(`           decided_at:   ${l.decided_at_before} -> ${l.decided_at_after}${l.decided_at_before === l.decided_at_after ? ' (unchanged: something else happened to the line since)' : ''}`);
    out.push(`  INSERT studio_edits         ${l.id}  "sign-offs removed"`);
  }
  out.push(`  KEEP   studio_edits         ${p.edits_kept} sign-off entries stay in the history`);
  out.push(`Codes freed: ${p.codes.join(', ') || 'none'}`);
  out.push(`Kept lines per run (must not change): ${Object.entries(p.kept_before).map(([b, n]) => `${b}: ${n}`).join('; ') || 'none'}`);
  out.push(p.blockers.length ? `BLOCKED:\n${p.blockers.map(b => `  - ${b}`).join('\n')}` : 'Nothing blocks it.');
  return out.join('\n');
}
