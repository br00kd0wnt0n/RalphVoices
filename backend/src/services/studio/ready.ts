// Ready for production: the last step of a Studio run, after Shortlist.
// The creative lead signs off a set of kept lines per persona × territory.
// Red (compliance) flags must be cleared by an edit or overridden with a
// written reason first; amber and grey don't block. The signed-off set is
// locked: each line's wording is stored as a hashed version, and a later edit
// becomes a new version, never a rewrite. The team's expectations (which
// line(s) should lead, and why) are dated, hashed and locked with the
// sign-off, for B4 (expected vs actual). Compliance status (pending, cleared,
// changes requested) is tracked per line and doesn't block.
//
// Wording: "Ready for production", never "approved" (creative sign-off isn't
// compliance clearance); the only exception is the compliance status
// "cleared". No scores.

import {
  type Api, type Batch, type ComplianceStatus, type Flag, type Line, type LineVersion,
  checkBatch, finalText, getStore, lineHash, loadBatch, loadRules, sha256, shortlist, toCsv,
} from './engine.js';

export class GateError extends Error {
  constructor(message: string, public blocking: Array<{ line_id: string; text: string; flags: Flag[] }>) { super(message); }
}

export interface Signoff {
  id: string; persona: string; territory: string; version: number;
  ready_by: string; ready_at: string; sha256: string;
  lines: Array<{ line_id: string; batch_id: string; version: number; sha256: string; stub: string; field: string; text: string; chars: number; overrides: Line['overrides'] }>;
  expectation_id: string;
}
export interface Expectation { id: string; persona: string; territory: string; signoff_id: string; line_ids: string[]; stubs: string[]; reason: string; created_by: string; created_at: string; sha256: string }

const COMPLIANCE: ComplianceStatus[] = ['pending', 'cleared', 'changes_requested'];

/** Red flags on a line that are neither cleared nor overridden. */
export function unresolvedRed(l: Line): Flag[] {
  const over = new Set((l.overrides || []).map(o => o.rule));
  return l.flags.filter(f => f.severity === 'compliance' && !over.has(f.rule));
}

async function lineAt(batchId: string, lineId: string): Promise<{ batch: Batch; line: Line }> {
  const batch = await loadBatch(batchId);
  const line = batch.lines.find(x => x.id === lineId);
  if (!line) throw new Error(`No line ${lineId}`);
  return { batch, line };
}
async function write(batchId: string, l: Line, before: unknown, after: unknown, user?: string) {
  const st = getStore();
  l.decided_at = new Date().toISOString();
  await st.saveLine(batchId, l);
  await st.recordEdit({ line_id: l.id, batch_id: batchId, before, after, by: user || 'unknown', at: l.decided_at });
  return l;
}

/** Override one red flag with a written reason. Recorded with who and when, and shown on the line from then on. */
export async function overrideFlag(batchId: string, lineId: string, rule: string, reason: string, user?: string): Promise<Line> {
  const why = String(reason || '').trim();
  if (why.length < 5) throw new Error('An override needs a written reason');
  const { line } = await lineAt(batchId, lineId);
  if (!line.flags.some(f => f.rule === rule && f.severity === 'compliance')) throw new Error(`${rule} isn't a red flag on this line`);
  const before = { overrides: line.overrides || [] };
  line.overrides = [...(line.overrides || []).filter(o => o.rule !== rule), { rule, reason: why, by: user || 'unknown', at: new Date().toISOString() }];
  return write(batchId, line, before, { overrides: line.overrides }, user);
}

/** Compliance review status for a line. Anyone on the Studio list can set it; it never blocks sign-off. */
export async function setCompliance(batchId: string, lineId: string, status: string, note: string | undefined, user?: string): Promise<Line> {
  if (!COMPLIANCE.includes(status as ComplianceStatus)) throw new Error(`Compliance status must be one of ${COMPLIANCE.join(', ')}`);
  const { line } = await lineAt(batchId, lineId);
  const before = { compliance: line.compliance || { status: 'pending' } };
  line.compliance = { status: status as ComplianceStatus, note: note ? String(note) : undefined, by: user, at: new Date().toISOString(), sha256: lineHash(line) };
  return write(batchId, line, before, { compliance: line.compliance }, user);
}

/**
 * Run the full checks again on a line's final wording (after an edit). Until
 * then, model flags from the original wording stay on the line, so an edit
 * only clears a red flag once it has been re-checked.
 */
export async function recheckLine(batchId: string, lineId: string, api: Api, user?: string): Promise<Line> {
  const { batch, line } = await lineAt(batchId, lineId);
  const scratch: Batch = {
    ...batch, id: `adhoc-recheck-${Date.now()}`, stats: { ...batch.stats, timings_ms: {}, usd: {}, calls: {}, tokens: {}, usd_total: 0 },
    lines: [{ ...line, text: finalText(line), decision: '', edited_text: '', flags: [], status: 'generated' }],
  };
  await api.resetRun();
  await checkBatch(scratch, api);
  await api.commit(`recheck ${lineId}`, user);
  const checked = scratch.lines[0];
  const before = { flags: line.flags.map(f => f.rule) };
  line.flags = checked.flags;
  line.objection = checked.objection;
  line.probes = checked.probes;
  line.rechecked_at = new Date().toISOString();
  return write(batchId, line, before, { flags: line.flags.map(f => f.rule), rechecked: true }, user);
}

/** Everything the Ready for production screen needs for one persona × territory. */
export async function readyView(persona: string, territory: string) {
  const st = getStore();
  const lines: Line[] = [];
  for (const id of await st.listBatchIds()) {
    if (id.startsWith('adhoc-')) continue;
    const b: Batch = await st.getBatch(id);
    if (b.brief.persona !== persona || b.brief.territory !== territory) continue;
    lines.push(...b.lines.filter(l => l.decision === 'keep' || l.decision === 'edit'));
  }
  const signoffs = ((await st.listSignoffs()) as Signoff[]).filter(s => s.persona === persona && s.territory === territory).sort((a, b) => a.version - b.version);
  const expectations = ((await st.listExpectations()) as Expectation[]).filter(e => e.persona === persona && e.territory === territory);
  const stubs = new Map((await shortlist()).map(r => [r.id, r.stub]));
  const out = [];
  for (const l of lines) {
    out.push({
      line: l, final_text: finalText(l), sha256: lineHash(l),
      // The naming code it was signed off under, or the one it would get now.
      stub: l.ready?.stub || stubs.get(l.id) || l.id,
      red: unresolvedRed(l),
      compliance: l.compliance || { status: 'pending' as const },
      versions: (await st.listLineVersions(l.id)) as LineVersion[],
    });
  }
  out.sort((a, b) => a.stub.localeCompare(b.stub, undefined, { numeric: true }));
  return { persona, territory, lines: out, signoffs, expectations, latest: signoffs[signoffs.length - 1] || null };
}

/**
 * Sign off a set of kept lines as Ready for production, with the expectations
 * record. Throws GateError (listing the lines) while any red flag is unresolved.
 */
export async function signOff(input: { persona: string; territory: string; line_ids: string[]; expectation: { line_ids: string[]; reason: string } }, user?: string): Promise<{ signoff: Signoff; expectation: Expectation }> {
  const by = user || 'unknown';
  const { persona, territory } = input;
  const ids = [...new Set(input.line_ids || [])];
  if (!ids.length) throw new Error('Choose at least one line to sign off');
  const view = await readyView(persona, territory);
  const byId = new Map(view.lines.map(x => [x.line.id, x]));
  const missing = ids.filter(id => !byId.has(id));
  if (missing.length) throw new Error(`Not kept lines for ${persona} × ${territory}: ${missing.join(', ')}`);
  const unchecked = ids.filter(id => byId.get(id)!.line.status !== 'checked');
  if (unchecked.length) throw new Error(`Still being checked: ${unchecked.join(', ')}`);
  const blocking = ids.map(id => byId.get(id)!).filter(x => x.red.length).map(x => ({ line_id: x.line.id, text: x.final_text, flags: x.red }));
  if (blocking.length) throw new GateError(`${blocking.length} line${blocking.length === 1 ? ' has' : 's have'} red flags to fix or override first`, blocking);

  const exp = input.expectation || { line_ids: [], reason: '' };
  const expIds = [...new Set(exp.line_ids || [])];
  const reason = String(exp.reason || '').trim();
  if (!expIds.length || !reason) throw new Error('Record which line(s) you expect to lead, and why');
  if (expIds.some(id => !ids.includes(id))) throw new Error('The expected leaders must be among the lines being signed off');

  const st = getStore();
  const now = new Date().toISOString();
  const version = (view.latest?.version || 0) + 1;
  const id = `${territory}-ready-v${version}`;
  const stubs = new Map((await shortlist()).map(r => [r.id, r.stub]));
  const signed: Signoff['lines'] = [];
  for (const lineId of ids) {
    const { line: l } = byId.get(lineId)!;
    const h = lineHash(l);
    const stub = l.ready?.stub || stubs.get(l.id) || l.id;
    const versions = (await st.listLineVersions(l.id)) as LineVersion[];
    let v = versions.find(x => x.sha256 === h);
    if (!v) {
      v = { line_id: l.id, batch_id: l.batch, version: Math.max(0, ...versions.map(x => x.version)) + 1, field: l.field, text: finalText(l), sha256: h, created_by: by, created_at: now, signoff_id: id, stub };
      await st.saveLineVersion(v);
    }
    signed.push({ line_id: l.id, batch_id: l.batch, version: v.version, sha256: h, stub, field: l.field, text: v.text, chars: [...v.text].length, overrides: l.overrides || [] });
  }
  signed.sort((a, b) => a.stub.localeCompare(b.stub));
  const setHash = sha256(JSON.stringify(signed.map(x => [x.line_id, x.version, x.sha256])));
  const expStubs = expIds.map(x => signed.find(y => y.line_id === x)!.stub);
  const expectation: Expectation = { id: `${id}-expectation`, persona, territory, signoff_id: id, line_ids: expIds, stubs: expStubs, reason, created_by: by, created_at: now, sha256: '' };
  expectation.sha256 = sha256(JSON.stringify({ persona, territory, signoff_id: id, signoff_sha256: setHash, line_ids: expIds, stubs: expStubs, reason, created_by: by, created_at: now }));
  const signoff: Signoff = { id, persona, territory, version, ready_by: by, ready_at: now, sha256: setHash, lines: signed, expectation_id: expectation.id };
  await st.saveSignoff(signoff);
  await st.saveExpectation(expectation);

  for (const x of signed) {
    const { line } = await lineAt(x.batch_id, x.line_id);
    const before = { ready: line.ready || null };
    line.ready = { signoff_id: id, version: x.version, sha256: x.sha256, ready_by: by, ready_at: now, stub: x.stub, changed_since: false };
    await write(x.batch_id, line, before, { ready: line.ready }, by);
  }
  return { signoff, expectation };
}

// ---------- handoff pack ----------

export interface HandoffRow {
  line_id: string; stub: string; persona: string; territory: string; field: string; placement: string; platform: string; format: string;
  text: string; chars: number; version: number; compliance: string; compliance_note: string; ready_by: string; ready_at: string; changed_since: string;
}

/** The latest sign-off per persona × territory, one row per line, with the signed-off wording. */
export async function handoffRows(filter: { persona?: string; territory?: string } = {}): Promise<HandoffRow[]> {
  const r = loadRules();
  const st = getStore();
  const latest = new Map<string, Signoff>();
  for (const s of (await st.listSignoffs()) as Signoff[]) {
    if (filter.persona && s.persona !== filter.persona) continue;
    if (filter.territory && s.territory !== filter.territory) continue;
    const k = `${s.persona}|${s.territory}`;
    if (!latest.has(k) || latest.get(k)!.version < s.version) latest.set(k, s);
  }
  const rows: HandoffRow[] = [];
  for (const s of [...latest.values()].sort((a, b) => a.territory.localeCompare(b.territory))) {
    for (const x of s.lines) {
      let current: Line | undefined;
      try { current = (await loadBatch(x.batch_id)).lines.find(l => l.id === x.line_id); } catch { /* run removed; keep the signed record */ }
      const c = current?.compliance;
      const reviewedOther = c?.sha256 && c.sha256 !== x.sha256;
      rows.push({
        line_id: x.line_id, stub: x.stub, persona: s.persona, territory: s.territory, field: x.field,
        placement: r.fields[x.field]?.label || x.field, platform: r.fields[x.field]?.platform || '',
        format: r.territories[s.territory]?.format || '', text: x.text, chars: x.chars, version: x.version,
        compliance: reviewedOther ? 'pending' : (c?.status || 'pending'),
        compliance_note: reviewedOther ? 'Reviewed on a different wording' : (c?.note || ''),
        ready_by: s.ready_by, ready_at: s.ready_at,
        changed_since: current?.ready?.signoff_id === s.id && current.ready.changed_since ? 'yes: a newer version exists' : '',
      });
    }
  }
  return rows;
}

const STATUS_WORDS: Record<string, string> = { pending: 'Pending', cleared: 'Cleared', changes_requested: 'Changes requested' };

export async function handoffPack(filter: { persona?: string; territory?: string } = {}) {
  const rows = await handoffRows(filter);
  const cols: Array<[keyof HandoffRow, string]> = [
    ['stub', 'Naming code'], ['persona', 'Persona'], ['territory', 'Territory'], ['placement', 'Field'], ['platform', 'Platform'], ['format', 'Format'],
    ['text', 'Final text'], ['chars', 'Characters'], ['version', 'Version'], ['compliance', 'Compliance status'], ['compliance_note', 'Compliance note'],
    ['ready_by', 'Ready for production by'], ['ready_at', 'Ready for production at'], ['changed_since', 'Changed since sign-off'],
  ];
  const csv = toCsv([cols.map(c => c[1]), ...rows.map(x => cols.map(([k]) => k === 'compliance' ? STATUS_WORDS[x.compliance] || x.compliance : String(x[k])))]);

  const expectations = (await getStore().listExpectations()) as Expectation[];
  const md = ['# Ready for production: handoff', '', 'Creative sign-off, not compliance clearance. Compliance status is shown per line.', ''];
  let last = '';
  for (const x of rows) {
    const g = `${x.persona} · ${x.territory}`;
    if (g !== last) {
      last = g;
      md.push(`## ${g}`, '', `Ready for production by ${x.ready_by}, ${x.ready_at.slice(0, 16).replace('T', ' ')} UTC.`, '');
      const e = expectations.filter(y => y.persona === x.persona && y.territory === x.territory).pop();
      if (e) md.push(`**Expected to lead:** ${e.line_ids.map(id => `\`${rows.find(r => r.line_id === id)?.stub || id}\``).join(', ')}. ${e.reason.replace(/\s*\n\s*/g, ' ')}`, '');
    }
    md.push(`- \`${x.stub}\` (${x.placement}, ${x.chars} chars, v${x.version}): ${x.text.replace(/\s*\n\s*/g, ' ')}  \n  Compliance: ${STATUS_WORDS[x.compliance] || x.compliance}${x.compliance_note ? ` (${x.compliance_note})` : ''}${x.changed_since ? ` · ${x.changed_since}` : ''}`);
  }

  // For Trupanion's compliance team: the words only, nothing internal.
  const complianceCsv = toCsv([['Naming code', 'Field', 'Platform', 'Final text', 'Characters'], ...rows.map(x => [x.stub, x.placement, x.platform, x.text, String(x.chars)])]);
  return { count: rows.length, csv, md: md.join('\n') + '\n', complianceCsv };
}
