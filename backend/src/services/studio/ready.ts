// Ready for production: the last step of a Studio run, after Shortlist.
// The creative lead builds live versions from the kept lines (versions.ts: one
// code = one ad = a set of fields, e.g. primary text + headline; up to three
// per visual; on-image text once per visual) and signs them off per
// persona × territory × region.
// Red (compliance) flags must be cleared by an edit or overridden with a
// written reason first; amber and grey don't block. The signed-off set is
// locked: each line's wording is stored as a hashed version, and a later edit
// becomes a new version, never a rewrite. The team's expectations (which
// line(s) should lead, and why) are dated, hashed and locked with the
// sign-off, for B4 (expected vs actual). Compliance status (pending, cleared,
// changes requested) is set later, at the Compliance step after Pre-flight
// (per asset, copy and visual together; preflight.ts), stored on each line,
// and doesn't block sign-off.
//
// Wording: "Ready for production", never "approved" (creative sign-off isn't
// compliance clearance); the only exception is the compliance status
// "cleared". No scores.

import {
  type Api, type Batch, type ComplianceStatus, type Flag, type Line, type LineVersion,
  checkBatch, finalText, getStore, keptLines, lineHash, loadBatch, loadRules, runLock, sha256, signedCodes, toCsv,
} from './engine.js';
import { DEFAULT_REGION, REGION_NAMES, parseCode, type Region } from '../../utils/namingCode.js';
import {
  type Draft, type SignedField, type SignedOnImage, type SignedVersion,
  complianceFor, defaultDraft, fieldRole, planDraft, platformOf, signoffOnImage, signoffVersions, versionFields,
} from './versions.js';
import { type VersionCheck, checkVersions, estimateConflicts, seedConflicts, uncheckedAds } from './versionChecks.js';

/** Someone else changed what this request was based on (e.g. signed the same set off first): reload and try again. */
export class ConflictError extends Error { status = 409; }
const runOf = (lineId: string) => lineId.replace(/-L\d+$/, '');

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
  /** Every line signed off, once each. stub: its first code (or its visual key, for on-image text); codes: every code it's in. */
  lines: Array<SignedField & { stub: string; codes?: string[] }>;
  /** The live versions, one code each (sign-offs from before 1 Oct have none: one code per line, see signoffVersions). */
  versions?: SignedVersion[];
  /** Text on the image, one per visual. */
  on_image?: SignedOnImage[];
  /** The version checks as they stood at sign-off (versionChecks.ts), one per code: flags inform, never block. */
  checks?: VersionCheck[];
  expectation_id: string;
}
/** Which version(s) are expected to lead: `stubs` holds their codes; `line_ids` the lines in them. */
export interface Expectation { id: string; persona: string; territory: string; signoff_id: string; line_ids: string[]; stubs: string[]; reason: string; created_by: string; created_at: string; sha256: string }
/** A sign-off can't go through yet: what's missing, per version. */
export class DraftError extends Error { constructor(message: string, public issues: string[]) { super(message); } }

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
  return runLock(batchId, async () => {
    const { line } = await lineAt(batchId, lineId);
    const flag = line.flags.find(f => f.rule === rule && f.severity === 'compliance');
    if (!flag) throw new Error(`${rule} isn't a red flag on this line`);
    const before = { overrides: line.overrides || [] };
    line.overrides = [...(line.overrides || []).filter(o => o.rule !== rule), { rule, label: flag.label, reason: why, by: user || 'unknown', at: new Date().toISOString() }];
    return write(batchId, line, before, { overrides: line.overrides }, user);
  });
}

/** Compliance review status for a line. Anyone on the Studio list can set it; it never blocks sign-off. */
export async function setCompliance(batchId: string, lineId: string, status: string, note: string | undefined, user?: string, asset?: { upload_id: string; code: string; sha256: string; send_back?: 'copy' | 'asset'; client_by?: string }): Promise<Line> {
  if (!COMPLIANCE.includes(status as ComplianceStatus)) throw new Error(`Compliance status must be one of ${COMPLIANCE.join(', ')}`);
  // Under the run's lock, on the line as it is now: a status never overwrites someone's edit, or the other way round.
  return runLock(batchId, async () => {
    const { line } = await lineAt(batchId, lineId);
    // A line that went through with an overridden red flag can only be cleared with a note saying who cleared it.
    if (status === 'cleared' && line.overrides?.length && !String(note || '').trim()) {
      throw new Error('This line has an overridden red flag: add a note to clear it (e.g. who at Trupanion cleared it)');
    }
    const rec = { status: status as ComplianceStatus, note: note ? String(note) : undefined, by: user, at: new Date().toISOString(), sha256: asset?.sha256 || lineHash(line),
      ...(asset ? { upload_id: asset.upload_id, code: asset.code, send_back: status === 'changes_requested' ? asset.send_back : undefined, client_by: asset.client_by } : {}) };
    if (asset) {
      // At the Compliance step the review is per code (per ad): a headline shared by A1 and A2 can be cleared in one and not the other.
      const before = { compliance: line.compliance_by_code?.[asset.code] || { status: 'pending' }, code: asset.code };
      line.compliance_by_code = { ...(line.compliance_by_code || {}), [asset.code]: rec };
      return write(batchId, line, before, { compliance: rec, code: asset.code }, user);
    }
    // Per line (the earlier Ready screen's control; kept for reading old data): of the current wording.
    const before = { compliance: line.compliance || { status: 'pending' } };
    line.compliance = rec;
    return write(batchId, line, before, { compliance: line.compliance }, user);
  });
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
  // The checks ran without the lock (they take a while); they're applied under it, only if the wording is still what was checked.
  return runLock(batchId, async () => {
    const { line: now } = await lineAt(batchId, lineId);
    if (finalText(now) !== finalText(line)) throw new ConflictError('The wording changed while it was being re-checked: re-check it again');
    const before = { flags: now.flags.map(f => f.rule) };
    now.flags = checked.flags;
    now.objection = checked.objection;
    now.probes = checked.probes;
    now.rechecked_at = new Date().toISOString();
    return write(batchId, now, before, { flags: now.flags.map(f => f.rule), rechecked: true }, user);
  });
}

/**
 * Everything the Ready for production screen needs for one persona × territory × region: the kept lines (to fix red
 * flags and edit wording), the versions being built (`draft`: what the screen sends, or by default the last
 * sign-off's versions or a first pairing of the lines) with their codes and what's missing (`plan`), and the history.
 */
export async function readyView(persona: string, territory: string, region: Region = DEFAULT_REGION, draft?: Draft) {
  const st = getStore();
  if (!REGION_NAMES[region]) throw new Error(`Region must be ${Object.keys(REGION_NAMES).join(' or ')}`);
  const r = loadRules();
  const lines = (await keptLines()).filter(l => l.persona === persona && l.territory === territory && l.region === region);
  const all = ((await st.listSignoffs()) as Signoff[]).filter(s => s.persona === persona && s.territory === territory);
  const signoffs = all.filter(s => regionOfSignoff(s) === region).sort((a, b) => a.version - b.version);
  const latest = signoffs[signoffs.length - 1] || null;
  const ids = new Set(signoffs.map(s => s.id));
  const expectations = ((await st.listExpectations()) as Expectation[]).filter(e => ids.has(e.signoff_id));
  const d = draft || defaultDraft(lines, r, latest);
  const plan = planDraft(d, lines, { persona, territory, region, format: r.territories[territory]?.format || 'STATIC', rules: r }, await signedCodes(), latest);
  const byId = new Map(lines.map(l => [l.id, l]));
  // Version checks: the free ones always; the conflicts check from what's been run on this wording (seeded from sign-offs).
  for (const s of signoffs) seedConflicts(s.checks);
  const checks = await checkVersions(plan, lines, r);
  const check_estimate = estimateConflicts(uncheckedAds(plan, lines, r));
  // Compliance per version (set at the Compliance step, per code); a status given on another wording shows as needing review.
  const versions = plan.versions.map(v => {
    const ls = [...Object.values(v.fields), ...plan.on_image.filter(o => o.visual === v.visual).map(o => o.line_id)].map(id => byId.get(id)!).filter(Boolean);
    const cs = ls.map(l => { const c = complianceFor(l, v.code); return c && c.status !== 'pending' && c.sha256 && c.sha256 !== lineHash(l) ? { ...c, status: 'pending' as const, edited: true } : c; });
    const status = cs.some(c => c?.status === 'changes_requested') ? 'changes_requested' : cs.length && cs.every(c => c?.status === 'cleared') ? 'cleared' : 'pending';
    const latestC = cs.filter(Boolean).sort((a, b) => String(b!.at || '').localeCompare(String(a!.at || '')))[0];
    return { ...v, checks: checks[plan.versions.indexOf(v)], compliance: { status, note: cs.some(c => (c as any)?.edited) ? 'Edited since Trupanion’s review: the new wording needs their review' : latestC?.note, client_by: latestC?.client_by, by: latestC?.by, at: latestC?.at, send_back: latestC?.send_back } };
  });
  const inCodes = (id: string) => [...versions.filter(v => Object.values(v.fields).includes(id)).map(v => v.code), ...plan.on_image.filter(o => o.line_id === id).map(o => `on-image ${o.visual}`)];
  const out = [];
  for (const l of lines) {
    out.push({
      line: l, final_text: finalText(l), sha256: lineHash(l), role: fieldRole(l.field, r), platform: platformOf(l.field, r),
      in: inCodes(l.id), red: unresolvedRed(l),
      versions: (await st.listLineVersions(l.id)) as LineVersion[],
    });
  }
  const platforms = [...new Set([...lines.map(l => platformOf(l.field, r)), ...versions.map(v => v.platform)])].sort();
  const fields = Object.fromEntries(platforms.map(p => [p, versionFields(p, r)]));
  return { persona, territory, region, lines: out, draft: d, plan: { ...plan, versions, check_estimate }, fields, signoffs, expectations, latest };
}

/** Run the conflicts check (a model call per version whose wording hasn't been checked) on a draft, then show it. */
export async function checkDraft(persona: string, territory: string, region: Region, draft: Draft, api: Api) {
  const view = await readyView(persona, territory, region, draft);
  const lines = view.lines.map(x => x.line);
  await checkVersions(view.plan, lines, loadRules(), api);
  await api.commit(`version-check ${persona} ${territory}`);
  return readyView(persona, territory, region, draft);
}

/**
 * Sign off the versions (and on-image text) of one persona × territory × region as Ready for production, with the
 * expectations record (which version(s) should lead, and why). Refused while a version is incomplete (DraftError)
 * or a line in it has an unresolved red flag (GateError).
 */
export async function signOff(input: { persona: string; territory: string; region?: string; versions: Draft['versions']; on_image?: Draft['on_image']; expectation: { codes: string[]; reason: string }; expect_latest?: string | null }, user?: string, opts: { api?: Api } = {}): Promise<{ signoff: Signoff; expectation: Expectation }> {
  const { persona, territory } = input;
  const region = String(input.region || DEFAULT_REGION).toUpperCase() as Region;
  if (!REGION_NAMES[region]) throw new Error(`Region must be ${Object.keys(REGION_NAMES).join(' or ')}`);
  const draft: Draft = { versions: input.versions || [], on_image: input.on_image || {} };
  const ids = [...new Set([...draft.versions.flatMap(v => Object.values(v.fields || {})), ...Object.values(draft.on_image)].filter(Boolean))];
  if (!ids.length) throw new Error('Build at least one version to sign off');
  // The conflicts check runs before the locks (it takes a few seconds); the sign-off stores whatever it found.
  if (opts.api) {
    const pre = await readyView(persona, territory, region, draft);
    if (!pre.plan.issues.length) { await checkVersions(pre.plan, pre.lines.map(x => x.line), loadRules(), opts.api); await opts.api.commit(`version-check ${persona} ${territory}`, user); }
  }
  // One sign-off at a time per persona × territory (both regions share its version count), holding the runs of the
  // lines being signed off, so a line can't be cut or edited half way through. It all commits together, or not at all.
  const locks = [`signoff:${persona}|${territory}`, ...new Set(ids.map(x => `run:${runOf(x)}`))];
  return getStore().withLock(locks, async () => {
    const view = await readyView(persona, territory, region, draft);
    // Someone else signed this set off since the screen was loaded: say so, rather than quietly making another version.
    if ('expect_latest' in input && (input.expect_latest || null) !== (view.latest?.id || null)) {
      const l = view.latest;
      throw new ConflictError(l ? `${l.ready_by} just signed this set off (v${l.version}, ${l.ready_at.slice(11, 16)} UTC): reload to see it, then sign off again if you still need to` : 'The sign-offs for this set changed: reload and try again');
    }
    // Lines in the previous set that this one leaves out are marked (their runs are locked too).
    const dropped = (view.latest?.lines || []).filter(x => !ids.includes(x.line_id));
    return getStore().withLock(dropped.map(x => `run:${x.batch_id}`), () => signOffLocked(input, user, region, ids, view, dropped));
  });
}

async function signOffLocked(input: { persona: string; territory: string; expectation: { codes: string[]; reason: string } }, user: string | undefined, region: Region, ids: string[], view: Awaited<ReturnType<typeof readyView>>, dropped: Signoff['lines']): Promise<{ signoff: Signoff; expectation: Expectation }> {
  const by = user || 'unknown';
  const { persona, territory } = input;
  const byId = new Map(view.lines.map(x => [x.line.id, x]));
  const missing = ids.filter(id => !byId.has(id));
  if (missing.length) throw new Error(`Not kept lines for ${persona} × ${territory}${region === DEFAULT_REGION ? '' : ` (${REGION_NAMES[region]})`}: ${missing.join(', ')}`);
  if (view.plan.issues.length) throw new DraftError(`Not ready to sign off: ${view.plan.issues.join('; ')}`, view.plan.issues);
  const unchecked = ids.filter(id => byId.get(id)!.line.status !== 'checked');
  if (unchecked.length) throw new Error(`Still being checked: ${unchecked.join(', ')}`);
  const blocking = ids.map(id => byId.get(id)!).filter(x => x.red.length).map(x => ({ line_id: x.line.id, text: x.final_text, flags: x.red }));
  if (blocking.length) throw new GateError(`${blocking.length} line${blocking.length === 1 ? ' has' : 's have'} red flags to fix or override first`, blocking);

  const codes = view.plan.versions.map(v => v.code);
  const exp = input.expectation || { codes: [], reason: '' };
  const expCodes = [...new Set(exp.codes || [])];
  const reason = String(exp.reason || '').trim();
  if (!expCodes.length || !reason) throw new Error('Record which version(s) you expect to lead, and why');
  if (expCodes.some(c => !codes.includes(c))) throw new Error('The expected leaders must be among the versions being signed off');

  const st = getStore();
  const now = new Date().toISOString();
  // One count per persona × territory across regions (see Signoff).
  const version = Math.max(0, ...((await st.listSignoffs()) as Signoff[]).filter(s => s.persona === persona && s.territory === territory).map(s => s.version)) + 1;
  const id = `${territory}${region === DEFAULT_REGION ? '' : `-${region}`}-ready-v${version}`;
  // Each line once: its wording as a hashed version, with every code it's in (a headline can serve A1 and A2).
  const codesOf = (lineId: string) => [...view.plan.versions.filter(v => Object.values(v.fields).includes(lineId)).map(v => v.code), ...view.plan.on_image.filter(o => o.line_id === lineId).map(o => o.visual_key)];
  const signed = new Map<string, SignedField & { stub: string; codes: string[] }>();
  for (const lineId of ids) {
    const { line: l } = byId.get(lineId)!;
    const h = lineHash(l);
    const lineCodes = codesOf(lineId);
    const versions = (await st.listLineVersions(l.id)) as LineVersion[];
    let v = versions.find(x => x.sha256 === h);
    if (!v) {
      // line_versions.stub: the codes this wording went out under (comma-separated when a line serves several versions).
      v = { line_id: l.id, batch_id: l.batch, version: Math.max(0, ...versions.map(x => x.version)) + 1, field: l.field, text: finalText(l), sha256: h, created_by: by, created_at: now, signoff_id: id, stub: lineCodes.join(',') };
      await st.saveLineVersion(v);
    }
    signed.set(lineId, { line_id: l.id, batch_id: l.batch, version: v.version, sha256: h, field: l.field, text: v.text, chars: [...v.text].length, overrides: l.overrides || [], stub: lineCodes[0] || '', codes: lineCodes });
  }
  const strip = (x: SignedField & { stub?: string; codes?: string[] }): SignedField => ({ line_id: x.line_id, batch_id: x.batch_id, version: x.version, sha256: x.sha256, field: x.field, text: x.text, chars: x.chars, overrides: x.overrides });
  const versions: SignedVersion[] = view.plan.versions.map(v => ({ code: v.code, visual: v.visual, number: v.number, platform: v.platform, fields: Object.fromEntries(Object.entries(v.fields).map(([f, lid]) => [f, strip(signed.get(lid)!)])) }));
  const on_image: SignedOnImage[] = view.plan.on_image.map(o => ({ ...strip(signed.get(o.line_id)!), visual: o.visual, visual_key: o.visual_key }));
  const lines = [...signed.values()].sort((a, b) => a.stub.localeCompare(b.stub, undefined, { numeric: true }));
  const setHash = sha256(JSON.stringify([versions.map(v => [v.code, Object.entries(v.fields).map(([f, x]) => [f, x.line_id, x.version, x.sha256])]), on_image.map(o => [o.visual_key, o.line_id, o.version, o.sha256])]));
  const expLines = [...new Set(versions.filter(v => expCodes.includes(v.code)).flatMap(v => Object.values(v.fields).map(f => f.line_id)))];
  const expectation: Expectation = { id: `${id}-expectation`, persona, territory, signoff_id: id, line_ids: expLines, stubs: expCodes, reason, created_by: by, created_at: now, sha256: '' };
  expectation.sha256 = sha256(JSON.stringify({ persona, territory, signoff_id: id, signoff_sha256: setHash, line_ids: expLines, stubs: expCodes, reason, created_by: by, created_at: now }));
  const checks = view.plan.versions.map(v => v.checks).filter(Boolean) as VersionCheck[];
  const signoff: Signoff = { id, persona, territory, region, version, ready_by: by, ready_at: now, sha256: setHash, lines, versions, on_image, checks, expectation_id: expectation.id };
  await st.saveSignoff(signoff);
  await st.saveExpectation(expectation);

  for (const x of lines) {
    const { line } = await lineAt(x.batch_id, x.line_id);
    const before = { ready: line.ready || null };
    line.ready = { signoff_id: id, version: x.version, sha256: x.sha256, ready_by: by, ready_at: now, stub: x.stub, codes: x.codes, changed_since: false };
    await write(x.batch_id, line, before, { ready: line.ready }, by);
  }
  // Left out of this set: no longer shown as signed off (its record stays in the earlier set).
  for (const x of dropped) {
    const { line } = await lineAt(x.batch_id, x.line_id);
    if (!line.ready || line.ready.superseded_by) continue;
    const before = { ready: line.ready };
    line.ready = { ...line.ready, superseded_by: id };
    await write(x.batch_id, line, before, { ready: line.ready }, by);
  }
  return { signoff, expectation };
}

// ---------- handoff pack ----------

/** One row per code (live version): its fields' signed-off wording as columns, the visual's on-image text repeated. */
export interface HandoffRow {
  stub: string; region: Region; visual: string; number: number; persona: string; territory: string; platform: string; format: string;
  fields: Record<string, { text: string; chars: number; version: number; line_id: string }>;
  on_image: { text: string; chars: number; version: number; line_id: string } | null;
  compliance: string; compliance_note: string;
  /** Internal: each overridden red flag with its reason and who (handoff only). */
  overrides: string;
  /** For Trupanion's reviewers: the rules to look at in this ad, in plain words (no reasons or names). */
  check_specifically: string;
  ready_by: string; ready_at: string; changed_since: string;
  /** From Pre-flight and Compliance when the Studio has the database ("Ready to traffic", or what's outstanding); '' otherwise. */
  traffic: string;
  signoff_id: string;
}
/** Ready to traffic per code, from Pre-flight (preflight.ts traffic()); the file store has none. */
export type TrafficOf = (stub: string) => Promise<{ ready: boolean; words: string }>;

/** The latest sign-off per persona × territory × region, one row per code, with the signed-off wording. */
export async function handoffRows(filter: { persona?: string; territory?: string; region?: string } = {}, trafficOf?: TrafficOf): Promise<HandoffRow[]> {
  const r = loadRules();
  const rows: HandoffRow[] = [];
  const cache = new Map<string, Batch | null>();
  const lineNow = async (x: SignedField): Promise<Line | undefined> => {
    if (!cache.has(x.batch_id)) { try { cache.set(x.batch_id, await loadBatch(x.batch_id)); } catch { cache.set(x.batch_id, null); /* run removed; keep the signed record */ } }
    return cache.get(x.batch_id)?.lines.find(l => l.id === x.line_id);
  };
  for (const s of await latestSignoffs(filter)) {
    const onImage = signoffOnImage(s);
    for (const v of signoffVersions(s)) {
      const oi = onImage.find(o => o.visual === v.visual && o.visual_key && (parseCode(v.code, null) as any).platform === platformOf(o.field, r));
      const parts = [...Object.values(v.fields), ...(oi ? [oi] : [])];
      // Compliance for this code: every line in the ad, on the wording signed off.
      let status = parts.length ? 'cleared' : 'pending', note = '';
      const labels: string[] = [], overrides: string[] = [];
      let changed = false;
      for (const x of parts) {
        const now = await lineNow(x);
        const c = now ? complianceFor(now, v.code) : undefined;
        const reviewedOther = c?.sha256 && c.sha256 !== x.sha256;
        const st = !c || reviewedOther ? 'pending' : c.status;
        if (st === 'changes_requested') status = 'changes_requested';
        else if (st !== 'cleared' && status !== 'changes_requested') status = 'pending';
        if (reviewedOther) note = 'Reviewed on a different wording';
        else if (c?.note && !note) note = c.note;
        if (now?.ready?.signoff_id === s.id && now.ready.changed_since) changed = true;
        const labelOf = (o: { rule: string; label?: string }) => (o.label || now?.flags.find(f => f.rule === o.rule)?.label || o.rule).replace(/\.$/, '');
        for (const o of x.overrides || []) { labels.push(labelOf(o)); overrides.push(`${labelOf(o)} (${r.fields[x.field]?.label || x.field}): overridden by ${o.by}, “${o.reason}”`); }
      }
      const p = parseCode(v.code, null);
      rows.push({
        stub: v.code, region: regionOfSignoff(s), visual: v.visual, number: v.number, persona: s.persona, territory: s.territory,
        platform: v.platform || ('error' in p ? '' : p.platform), format: r.territories[s.territory]?.format || '',
        fields: Object.fromEntries(Object.entries(v.fields).map(([f, x]) => [f, { text: x.text, chars: x.chars, version: x.version, line_id: x.line_id }])),
        on_image: oi ? { text: oi.text, chars: oi.chars, version: oi.version, line_id: oi.line_id } : null,
        compliance: status, compliance_note: note, overrides: overrides.join(' | '),
        check_specifically: labels.length ? `Please check specifically: ${[...new Set(labels)].join('; ')}` : '',
        ready_by: s.ready_by, ready_at: s.ready_at, changed_since: changed ? 'yes: a newer version of a line exists' : '',
        traffic: trafficOf ? (await trafficOf(v.code)).words : '', signoff_id: s.id,
      });
    }
  }
  return rows;
}

const STATUS_WORDS: Record<string, string> = { pending: 'Pending', cleared: 'Cleared', changes_requested: 'Changes requested' };

export async function handoffPack(filter: { persona?: string; territory?: string; region?: string } = {}, trafficOf?: TrafficOf) {
  const r = loadRules();
  const rows = await handoffRows(filter, trafficOf);
  // A column per field that appears in any version, in the rules' order; then the visual's on-image text.
  const present = new Set(rows.flatMap(x => Object.keys(x.fields)));
  const fieldCols = [...Object.keys(r.fields).filter(f => present.has(f)), ...[...present].filter(f => !r.fields[f])];
  const label = (f: string) => r.fields[f]?.label || f;
  const hasOnImage = rows.some(x => x.on_image);
  const head = ['Naming code', 'Region', 'Visual', 'Version', 'Persona', 'Territory', 'Platform', 'Format', ...fieldCols.map(label), ...(hasOnImage ? ['On-image text (the visual)'] : []),
    'Compliance status', 'Compliance note', 'Ready to traffic', 'Red flag overridden', 'Ready for production by', 'Ready for production at', 'Changed since sign-off'];
  const csv = toCsv([head, ...rows.map(x => [x.stub, x.region, x.visual, String(x.number), x.persona, x.territory, x.platform, x.format,
    ...fieldCols.map(f => x.fields[f]?.text || ''), ...(hasOnImage ? [x.on_image?.text || ''] : []),
    STATUS_WORDS[x.compliance] || x.compliance, x.compliance_note, x.traffic, x.overrides, x.ready_by, x.ready_at, x.changed_since])]);

  const expectations = (await getStore().listExpectations()) as Expectation[];
  const md = ['# Ready for production: handoff', '', 'Creative sign-off, not compliance clearance. One naming code per ad (a live version: its fields together); compliance status per code.', ''];
  let last = '', lastVisual = '';
  for (const x of rows) {
    const g = `${x.persona} · ${x.territory} · ${REGION_NAMES[x.region]}`;
    if (g !== last) {
      if (last) md.push('');
      last = g; lastVisual = '';
      md.push(`## ${g}`, '', `Ready for production by ${x.ready_by}, ${x.ready_at.slice(0, 16).replace('T', ' ')} UTC.`, '');
      const e = expectations.filter(y => y.signoff_id === x.signoff_id).pop();
      if (e) md.push(`**Expected to lead:** ${(e.stubs || []).map(c => `\`${c}\``).join(', ')}. ${e.reason.replace(/\s*\n\s*/g, ' ')}`, '');
    }
    const vk = `${x.visual}|${x.platform}`;
    if (vk !== lastVisual) {
      lastVisual = vk;
      md.push(`### Visual ${x.visual || '?'} (${x.platform === 'TT' ? 'TikTok' : 'Meta'})`, '');
      if (x.on_image) md.push(`On-image text: ${x.on_image.text.replace(/\s*\n\s*/g, ' ')} (${x.on_image.chars} chars)`, '');
    }
    const parts = Object.entries(x.fields).map(([f, v]) => `${label(f)}: ${v.text.replace(/\s*\n\s*/g, ' ')} (${v.chars} chars)`);
    md.push(`- \`${x.stub}\`: ${parts.join(' · ')}  \n  Compliance: ${STATUS_WORDS[x.compliance] || x.compliance}${x.compliance_note ? ` (${x.compliance_note})` : ''}${x.traffic ? ` · ${x.traffic}` : ''}${x.overrides ? ` · Red flag overridden: ${x.overrides}` : ''}${x.changed_since ? ` · ${x.changed_since}` : ''}`);
  }

  // For Trupanion's compliance team: the words only, nothing internal. An ad that went through with an overridden red
  // flag says which rule to look at, in plain words; never the reason or who.
  const complianceCsv = toCsv([['Naming code', 'Region', 'Platform', ...fieldCols.map(label), ...(hasOnImage ? ['On-image text (the visual)'] : []), 'Please check'],
    ...rows.map(x => [x.stub, REGION_NAMES[x.region], x.platform, ...fieldCols.map(f => x.fields[f]?.text || ''), ...(hasOnImage ? [x.on_image?.text || ''] : []), x.check_specifically])]);
  return { count: rows.length, csv, md: md.join('\n') + '\n', complianceCsv };
}
