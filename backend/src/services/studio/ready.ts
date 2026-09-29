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
  checkBatch, codeInput, finalText, getStore, keptLines, lineHash, loadBatch, loadRules, sha256, signedCodes, toCsv,
} from './engine.js';
import { CodeBook, regionOf, visualLetter } from './codes.js';
import { DEFAULT_REGION, REGION_NAMES, parseCode, type Region } from '../../utils/namingCode.js';

export class GateError extends Error {
  constructor(message: string, public blocking: Array<{ line_id: string; text: string; flags: Flag[] }>) { super(message); }
}

/**
 * One sign-off of a persona × territory × region. `version` counts every
 * sign-off of the persona × territory (both regions share the count, so the
 * database's unique persona/territory/version holds); the latest per region is
 * the one that counts. Sign-offs from before regions have none: US.
 */
export interface Signoff {
  id: string; persona: string; territory: string; region?: Region; version: number;
  ready_by: string; ready_at: string; sha256: string;
  lines: Array<{ line_id: string; batch_id: string; version: number; sha256: string; stub: string; field: string; text: string; chars: number; overrides: Line['overrides'] }>;
  expectation_id: string;
}
export interface Expectation { id: string; persona: string; territory: string; signoff_id: string; line_ids: string[]; stubs: string[]; reason: string; created_by: string; created_at: string; sha256: string }

const COMPLIANCE: ComplianceStatus[] = ['pending', 'cleared', 'changes_requested'];
const regionOfSignoff = (s: Pick<Signoff, 'region'>): Region => s.region || DEFAULT_REGION;
/** The visual letter in a code, or '' for a v# code. */
const visualOf = (code: string) => { const p = parseCode(code, null); return 'error' in p ? '' : p.visual || ''; };

/** The latest sign-off per persona × territory × region (what Pre-flight and the handoff pack work from). */
export async function latestSignoffs(filter: { persona?: string; territory?: string; region?: string } = {}): Promise<Signoff[]> {
  const latest = new Map<string, Signoff>();
  for (const s of (await getStore().listSignoffs()) as Signoff[]) {
    if (filter.persona && s.persona !== filter.persona) continue;
    if (filter.territory && s.territory !== filter.territory) continue;
    if (filter.region && regionOfSignoff(s) !== filter.region) continue;
    const k = `${s.persona}|${s.territory}|${regionOfSignoff(s)}`;
    if (!latest.has(k) || latest.get(k)!.version < s.version) latest.set(k, s);
  }
  return [...latest.values()].sort((a, b) => a.territory.localeCompare(b.territory) || regionOfSignoff(b).localeCompare(regionOfSignoff(a)));
}

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
  const flag = line.flags.find(f => f.rule === rule && f.severity === 'compliance');
  if (!flag) throw new Error(`${rule} isn't a red flag on this line`);
  const before = { overrides: line.overrides || [] };
  line.overrides = [...(line.overrides || []).filter(o => o.rule !== rule), { rule, label: flag.label, reason: why, by: user || 'unknown', at: new Date().toISOString() }];
  return write(batchId, line, before, { overrides: line.overrides }, user);
}

/** Compliance review status for a line. Anyone on the Studio list can set it; it never blocks sign-off. */
export async function setCompliance(batchId: string, lineId: string, status: string, note: string | undefined, user?: string): Promise<Line> {
  if (!COMPLIANCE.includes(status as ComplianceStatus)) throw new Error(`Compliance status must be one of ${COMPLIANCE.join(', ')}`);
  const { line } = await lineAt(batchId, lineId);
  // A line that went through with an overridden red flag can only be cleared with a note saying who cleared it.
  if (status === 'cleared' && line.overrides?.length && !String(note || '').trim()) {
    throw new Error('This line has an overridden red flag: add a note to clear it (e.g. who at Trupanion cleared it)');
  }
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

/**
 * Everything the Ready for production screen needs for one persona × territory
 * × region. `visuals` (line id → letter) previews the codes with the lead's
 * choice of visual, and `include` (the lines in the set) gets its codes first,
 * so the codes shown are the ones a sign-off of that set gives. Lines already
 * signed off keep the code they were signed off under.
 */
export async function readyView(persona: string, territory: string, region: Region = DEFAULT_REGION, visuals: Record<string, string> = {}, include?: string[]) {
  const st = getStore();
  if (!REGION_NAMES[region]) throw new Error(`Region must be ${Object.keys(REGION_NAMES).join(' or ')}`);
  const lines = (await keptLines()).filter(l => l.persona === persona && l.territory === territory && l.region === region);
  const all = ((await st.listSignoffs()) as Signoff[]).filter(s => s.persona === persona && s.territory === territory);
  const signoffs = all.filter(s => regionOfSignoff(s) === region).sort((a, b) => a.version - b.version);
  const ids = new Set(signoffs.map(s => s.id));
  const expectations = ((await st.listExpectations()) as Expectation[]).filter(e => ids.has(e.signoff_id));
  const codes = await assignCodes(lines, visuals, include ? new Set(include) : undefined);
  const out = [];
  for (const l of lines) {
    const stub = codes.get(l.id)!;
    out.push({
      line: l, final_text: finalText(l), sha256: lineHash(l),
      // The naming code it was signed off under, or the one it would get if signed off now.
      stub, visual: visualOf(stub), fixed: !!l.ready?.stub,
      red: unresolvedRed(l),
      compliance: l.compliance || { status: 'pending' as const },
      versions: (await st.listLineVersions(l.id)) as LineVersion[],
    });
  }
  out.sort((a, b) => a.stub.localeCompare(b.stub, undefined, { numeric: true }));
  return { persona, territory, region, lines: out, signoffs, expectations, latest: signoffs[signoffs.length - 1] || null };
}

/**
 * Codes for a set of kept lines: a signed-off line keeps its own; then the
 * lines in the set (all, without `include`) before the others, and within
 * each, lines with a chosen visual first, then the rest packed three to a
 * visual in the order they were written. Codes signed off anywhere are never
 * handed out again.
 */
async function assignCodes(lines: Line[], visuals: Record<string, string>, include?: Set<string>): Promise<Map<string, string>> {
  const book = new CodeBook(await signedCodes());
  const out = new Map<string, string>();
  for (const l of lines) if (l.ready?.stub) out.set(l.id, l.ready.stub);
  const groups = include ? [lines.filter(l => include.has(l.id)), lines.filter(l => !include.has(l.id))] : [lines];
  for (const g of groups) {
    for (const l of g) if (!out.has(l.id) && visualLetter(visuals[l.id])) out.set(l.id, book.assign(codeInput(l), visualLetter(visuals[l.id])));
    for (const l of g) if (!out.has(l.id)) out.set(l.id, book.assign(codeInput(l)));
  }
  return out;
}

/**
 * Sign off a set of kept lines as Ready for production, with the expectations
 * record. Throws GateError (listing the lines) while any red flag is unresolved.
 */
export async function signOff(input: { persona: string; territory: string; region?: string; line_ids: string[]; visuals?: Record<string, string>; expectation: { line_ids: string[]; reason: string } }, user?: string): Promise<{ signoff: Signoff; expectation: Expectation }> {
  const by = user || 'unknown';
  const { persona, territory } = input;
  const region = String(input.region || DEFAULT_REGION).toUpperCase() as Region;
  if (!REGION_NAMES[region]) throw new Error(`Region must be ${Object.keys(REGION_NAMES).join(' or ')}`);
  const ids = [...new Set(input.line_ids || [])];
  if (!ids.length) throw new Error('Choose at least one line to sign off');
  const visuals = input.visuals || {};
  for (const v of Object.values(visuals)) visualLetter(v);
  const view = await readyView(persona, territory, region, visuals, ids);
  const byId = new Map(view.lines.map(x => [x.line.id, x]));
  const missing = ids.filter(id => !byId.has(id));
  if (missing.length) throw new Error(`Not kept lines for ${persona} × ${territory}${region === DEFAULT_REGION ? '' : ` (${REGION_NAMES[region]})`}: ${missing.join(', ')}`);
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
  // One count per persona × territory across regions (see Signoff).
  const version = Math.max(0, ...((await st.listSignoffs()) as Signoff[]).filter(s => s.persona === persona && s.territory === territory).map(s => s.version)) + 1;
  const id = `${territory}${region === DEFAULT_REGION ? '' : `-${region}`}-ready-v${version}`;
  const signed: Signoff['lines'] = [];
  for (const lineId of ids) {
    const { line: l } = byId.get(lineId)!;
    const h = lineHash(l);
    // The code the screen showed for this set (a line signed off before keeps its own).
    const stub = byId.get(lineId)!.stub;
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
  const signoff: Signoff = { id, persona, territory, region, version, ready_by: by, ready_at: now, sha256: setHash, lines: signed, expectation_id: expectation.id };
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
  line_id: string; stub: string; region: Region; visual: string; persona: string; territory: string; field: string; placement: string; platform: string; format: string;
  text: string; chars: number; version: number; compliance: string; compliance_note: string;
  /** Internal: each overridden red flag with its reason and who (handoff only). */
  overrides: string;
  /** For Trupanion's reviewers: the rules to look at on this line, in plain words (no reasons or names). */
  check_specifically: string;
  ready_by: string; ready_at: string; changed_since: string;
}

/** The latest sign-off per persona × territory × region, one row per line, with the signed-off wording. */
export async function handoffRows(filter: { persona?: string; territory?: string; region?: string } = {}): Promise<HandoffRow[]> {
  const r = loadRules();
  const rows: HandoffRow[] = [];
  for (const s of await latestSignoffs(filter)) {
    for (const x of s.lines) {
      let current: Line | undefined;
      try { current = (await loadBatch(x.batch_id)).lines.find(l => l.id === x.line_id); } catch { /* run removed; keep the signed record */ }
      const c = current?.compliance;
      const labelOf = (o: { rule: string; label?: string }) => o.label || current?.flags.find(f => f.rule === o.rule)?.label || o.rule;
      const ovs = x.overrides || [];
      const reviewedOther = c?.sha256 && c.sha256 !== x.sha256;
      rows.push({
        line_id: x.line_id, stub: x.stub, region: regionOfSignoff(s), visual: visualOf(x.stub), persona: s.persona, territory: s.territory, field: x.field,
        placement: r.fields[x.field]?.label || x.field, platform: r.fields[x.field]?.platform || '',
        format: r.territories[s.territory]?.format || '', text: x.text, chars: x.chars, version: x.version,
        compliance: reviewedOther ? 'pending' : (c?.status || 'pending'),
        compliance_note: reviewedOther ? 'Reviewed on a different wording' : (c?.note || ''),
        overrides: ovs.map(o => `${labelOf(o).replace(/\.$/, '')}: overridden by ${o.by}, “${o.reason}”`).join(' | '),
        check_specifically: ovs.length ? `Please check specifically: ${ovs.map(o => labelOf(o).replace(/\.$/, '')).join('; ')}` : '',
        ready_by: s.ready_by, ready_at: s.ready_at,
        changed_since: current?.ready?.signoff_id === s.id && current.ready.changed_since ? 'yes: a newer version exists' : '',
      });
    }
  }
  return rows;
}

const STATUS_WORDS: Record<string, string> = { pending: 'Pending', cleared: 'Cleared', changes_requested: 'Changes requested' };

export async function handoffPack(filter: { persona?: string; territory?: string; region?: string } = {}) {
  const rows = await handoffRows(filter);
  const cols: Array<[keyof HandoffRow, string]> = [
    ['stub', 'Naming code'], ['region', 'Region'], ['visual', 'Visual'], ['persona', 'Persona'], ['territory', 'Territory'], ['placement', 'Field'], ['platform', 'Platform'], ['format', 'Format'],
    ['text', 'Final text'], ['chars', 'Characters'], ['version', 'Version'], ['compliance', 'Compliance status'], ['compliance_note', 'Compliance note'], ['overrides', 'Red flag overridden'],
    ['ready_by', 'Ready for production by'], ['ready_at', 'Ready for production at'], ['changed_since', 'Changed since sign-off'],
  ];
  const csv = toCsv([cols.map(c => c[1]), ...rows.map(x => cols.map(([k]) => k === 'compliance' ? STATUS_WORDS[x.compliance] || x.compliance : String(x[k])))]);

  const expectations = (await getStore().listExpectations()) as Expectation[];
  const signoffOf = new Map((await latestSignoffs(filter)).flatMap(s => s.lines.map(l => [`${l.line_id}|${regionOfSignoff(s)}`, s.id] as const)));
  const md = ['# Ready for production: handoff', '', 'Creative sign-off, not compliance clearance. Compliance status is shown per line.', ''];
  let last = '';
  for (const x of rows) {
    const g = `${x.persona} · ${x.territory} · ${REGION_NAMES[x.region]}`;
    if (g !== last) {
      if (last) md.push('');
      last = g;
      md.push(`## ${g}`, '', `Ready for production by ${x.ready_by}, ${x.ready_at.slice(0, 16).replace('T', ' ')} UTC.`, '');
      const so = signoffOf.get(`${x.line_id}|${x.region}`);
      const e = expectations.filter(y => y.signoff_id === so).pop();
      if (e) md.push(`**Expected to lead:** ${e.line_ids.map(id => `\`${rows.find(r => r.line_id === id)?.stub || id}\``).join(', ')}. ${e.reason.replace(/\s*\n\s*/g, ' ')}`, '');
    }
    md.push(`- \`${x.stub}\` (${x.placement}, ${x.chars} chars, v${x.version}): ${x.text.replace(/\s*\n\s*/g, ' ')}  \n  Compliance: ${STATUS_WORDS[x.compliance] || x.compliance}${x.compliance_note ? ` (${x.compliance_note})` : ''}${x.overrides ? ` · Red flag overridden: ${x.overrides}` : ''}${x.changed_since ? ` · ${x.changed_since}` : ''}`);
  }

  // For Trupanion's compliance team: the words only, nothing internal.
  // A line that went through with an overridden red flag says which rule to look at, in plain words; never the reason or who.
  const complianceCsv = toCsv([['Naming code', 'Region', 'Field', 'Platform', 'Final text', 'Characters', 'Please check'], ...rows.map(x => [x.stub, REGION_NAMES[x.region], x.placement, x.platform, x.text, String(x.chars), x.check_specifically])]);
  return { count: rows.length, csv, md: md.join('\n') + '\n', complianceCsv };
}
