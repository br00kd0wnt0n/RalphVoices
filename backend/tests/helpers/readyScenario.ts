// The Ready for production acceptance scenario (Brook, 28 Sep; live versions,
// 30 Sep), shared by studioReady.test.ts (file store) and studioPg.test.ts
// (Postgres, run in sequence with the other database tests so they don't
// truncate each other). Two primary texts share one headline: versions A1 and A2.
import assert from 'node:assert/strict';
import * as S from '../../src/services/studio/engine.js';
import * as R from '../../src/services/studio/ready.js';

export async function scenario() {
  const api = new S.Api({ mock: true });
  // The creative director's lines: two primary texts (one clean, one with a red flag) and one headline.
  const b = S.makeBrief({ territory: 'OWN_CALM', name: 'ready', own_lines: [
    { text: 'Calm at the counter, at partner clinics.', field: 'meta_primary' },
    { text: 'Honestly, the policy pays for itself.', field: 'meta_primary' },
    { text: 'Calm, covered.', field: 'meta_headline' },
  ] });
  const run = await S.generate(b, api, () => {}, { ownOnly: true, user: 'nick' });
  const [clean, risky, head] = run.lines;
  assert.ok(R.unresolvedRed(risky).some(f => f.rule === 'COMP_PAYS_FOR_ITSELF'), 'the planted line carries a red flag');
  for (const l of run.lines) await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
  const versions = [{ visual: 'A', fields: { meta_primary: clean.id, meta_headline: head.id } }, { visual: 'A', fields: { meta_primary: risky.id, meta_headline: head.id } }];
  const base = { persona: 'OWN', territory: 'OWN_CALM', versions };
  const expectation = { codes: ['OWN_CALM_UGC_A1_US_META'], reason: 'Plain promise, lowest effort to read; Owners told us they hate hype.' };

  // The screen's default: the kept lines paired into versions, three to a visual, with codes and nothing missing.
  const view = await R.readyView('OWN', 'OWN_CALM');
  assert.deepEqual(view.plan.versions.map(v => [v.code, v.fields.meta_primary, v.fields.meta_headline]), [['OWN_CALM_UGC_A1_US_META', clean.id, head.id], ['OWN_CALM_UGC_A2_US_META', risky.id, head.id]]);
  assert.deepEqual(view.plan.issues, []);

  // 1. An unresolved red flag blocks sign-off, and the gate names the line and the flag.
  await assert.rejects(() => R.signOff({ ...base, expectation }, 'nick'), (err: any) => {
    assert.ok(err instanceof R.GateError);
    assert.equal(err.blocking.length, 1);
    assert.equal(err.blocking[0].line_id, risky.id);
    return true;
  });
  // A reason is required to override.
  await assert.rejects(() => R.overrideFlag(run.id, risky.id, 'COMP_PAYS_FOR_ITSELF', '', 'nick'), /written reason/);
  // Amber/grey can't be "overridden" through the gate: only red flags are listed.
  await assert.rejects(() => R.overrideFlag(run.id, clean.id, 'COMP_PAYS_FOR_ITSELF', 'not on this line', 'nick'), /isn't a red flag/);

  // 2. An override with a reason unblocks it, and shows on the line.
  const overridden = await R.overrideFlag(run.id, risky.id, 'COMP_PAYS_FOR_ITSELF', 'Legal cleared this claim for the Owners test on 27 Sep.', 'nick');
  assert.equal(overridden.overrides![0].by, 'nick');
  assert.equal(R.unresolvedRed(overridden).length, 0);
  // A version must be complete: Meta needs a primary text and a headline.
  await assert.rejects(() => R.signOff({ ...base, versions: [{ visual: 'A', fields: { meta_primary: clean.id } }], expectation }, 'nick'), (err: any) => {
    assert.ok(err instanceof R.DraftError);
    assert.match(err.issues[0], /OWN_CALM_UGC_A1_US_META: needs headline/);
    return true;
  });
  // The expectations record is required and must pick from the versions being signed off.
  await assert.rejects(() => R.signOff({ ...base, expectation: { codes: [], reason: '' } }, 'nick'), /expect to lead/);
  await assert.rejects(() => R.signOff({ ...base, expectation: { codes: ['OWN_CALM_UGC_B7_US_META'], reason: 'x' } }, 'nick'), /among the versions/);

  const { signoff, expectation: exp } = await R.signOff({ ...base, expectation }, 'nick');
  assert.equal(signoff.version, 1);
  assert.equal(signoff.ready_by, 'nick');
  assert.deepEqual(signoff.versions!.map(v => [v.code, Object.keys(v.fields).sort()]), [['OWN_CALM_UGC_A1_US_META', ['meta_headline', 'meta_primary']], ['OWN_CALM_UGC_A2_US_META', ['meta_headline', 'meta_primary']]]);
  assert.ok(signoff.versions![1].fields.meta_primary.overrides!.length, 'the override travels with the sign-off');
  // The shared headline is signed once, in both codes.
  assert.deepEqual(signoff.lines.find(x => x.line_id === head.id)!.codes, ['OWN_CALM_UGC_A1_US_META', 'OWN_CALM_UGC_A2_US_META']);
  assert.equal(signoff.lines.length, 3);

  // 4. The expectations record is saved, dated and hashed over the sign-off, with the codes (versions) expected to lead.
  const stored = (await S.getStore().listExpectations()).find((e: any) => e.id === exp.id);
  assert.ok(stored);
  assert.match(stored.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(stored.stubs, ['OWN_CALM_UGC_A1_US_META']);
  assert.deepEqual([...stored.line_ids].sort(), [clean.id, head.id].sort());
  assert.equal(stored.sha256, S.sha256(JSON.stringify({ persona: 'OWN', territory: 'OWN_CALM', signoff_id: signoff.id, signoff_sha256: signoff.sha256, line_ids: stored.line_ids, stubs: stored.stubs, reason: expectation.reason, created_by: 'nick', created_at: stored.created_at })));

  // 3. An edit after sign-off creates version 2 and keeps version 1; the sign-off is untouched.
  const v1Text = signoff.versions![0].fields.meta_primary.text;
  const edited = await S.setDecision(run.id, clean.id, { decision: 'edit', edited_text: 'Calm at the counter, at partner clinics. Every time.' }, 'nick');
  assert.equal(edited.ready!.changed_since, true);
  const lineVersions = await S.getStore().listLineVersions(clean.id);
  assert.deepEqual(lineVersions.map((v: any) => v.version), [1, 2]);
  assert.equal(lineVersions[0].text, v1Text);
  assert.notEqual(lineVersions[0].sha256, lineVersions[1].sha256);
  assert.ok(lineVersions.every((v: any) => v.stub === 'OWN_CALM_UGC_A1_US_META'), 'every version carries the code(s)');
  assert.equal((await S.getStore().listLineVersions(head.id))[0].stub, 'OWN_CALM_UGC_A1_US_META,OWN_CALM_UGC_A2_US_META', 'a shared line lists every code');
  const again = (await S.getStore().listSignoffs()).find((s: any) => s.id === signoff.id);
  assert.equal(again.versions[0].fields.meta_primary.text, v1Text, 'the signed-off wording is never rewritten');

  // Compliance status per code (the Compliance step's record): the shared headline can differ between A1 and A2.
  const at = (code: string, l: S.Line) => ({ upload_id: 'up_test', code, sha256: S.lineHash(l), client_by: 'J. Doe' });
  await assert.rejects(() => R.setCompliance(run.id, risky.id, 'approved', '', 'vivan'), /one of/);
  await assert.rejects(() => R.setCompliance(run.id, risky.id, 'cleared', '', 'vivan', at('OWN_CALM_UGC_A2_US_META', risky)), /add a note/);
  await R.setCompliance(run.id, risky.id, 'cleared', 'Cleared by Trupanion legal (J. Doe), 28 Sep', 'vivan', at('OWN_CALM_UGC_A2_US_META', risky));
  await R.setCompliance(run.id, head.id, 'cleared', undefined, 'vivan', at('OWN_CALM_UGC_A2_US_META', head));
  await R.setCompliance(run.id, head.id, 'changes_requested', 'Shorter headline for A1', 'vivan', at('OWN_CALM_UGC_A1_US_META', head));
  await R.setCompliance(run.id, clean.id, 'cleared', undefined, 'vivan', { ...at('OWN_CALM_UGC_A1_US_META', clean), sha256: S.lineHash(edited) });

  // 5. The handoff pack: one row per code, a column per field; Markdown; a clean compliance sheet.
  const pack = await R.handoffPack();
  const rows = S.parseCsv(pack.csv);
  assert.equal(rows.length, 3, 'header plus two codes');
  assert.ok(rows.every(r => r.length === rows[0].length), 'every row has the same columns');
  assert.deepEqual(rows[0].slice(0, 5), ['Naming code', 'Region', 'Visual', 'Version', 'Persona']);
  const col = (name: string) => { const i = rows[0].indexOf(name); assert.ok(i >= 0, `handoff has a ${name} column`); return i; };
  const [PRIMARY, HEAD, STATUS, NOTE, OVERRIDE, CHANGED] = ['Meta primary text', 'Meta headline', 'Compliance status', 'Compliance note', 'Red flag overridden', 'Changed since sign-off'].map(col);
  const a1 = rows.find(r => r[0] === 'OWN_CALM_UGC_A1_US_META')!, a2 = rows.find(r => r[0] === 'OWN_CALM_UGC_A2_US_META')!;
  assert.equal(a1[PRIMARY], v1Text, 'the signed-off wording (v1), not the later edit');
  assert.equal(a1[HEAD], 'Calm, covered.');
  assert.equal(a2[HEAD], 'Calm, covered.', 'the shared headline is on both rows');
  assert.equal(a1[CHANGED], 'yes: a newer version of a line exists');
  assert.ok(rows.slice(1).every(r => r[1] === 'US' && r[2] === 'A'));
  assert.deepEqual([a1[3], a2[3]], ['1', '2']);
  // A1: the headline was sent back for A1, and the primary was reviewed on its later wording.
  assert.equal(a1[STATUS], 'Changes requested');
  assert.equal(a2[STATUS], 'Cleared', 'the same headline, cleared for A2');
  assert.match(a2[OVERRIDE], /pays for itself.*overridden by nick.*Legal cleared this claim/);
  assert.equal(a1[OVERRIDE], '');
  assert.ok(a1[NOTE]);
  assert.match(pack.md, /Red flag overridden: .*overridden by nick/);
  assert.match(pack.md, /\*\*Expected to lead:\*\* `OWN_CALM_UGC_A1_US_META`/);
  assert.match(pack.md, /### Visual A \(Meta\)/);
  assert.match(pack.md, /not compliance clearance/);
  const sheet = S.parseCsv(pack.complianceCsv);
  assert.deepEqual(sheet[0], ['Naming code', 'Region', 'Platform', 'Meta primary text', 'Meta headline', 'Please check']);
  // The ad with the overridden line tells the reviewer which rule to look at, in the rule's plain words; clean ones say nothing.
  assert.equal(sheet.find(r => r[0] === 'OWN_CALM_UGC_A2_US_META')![5], 'Please check specifically: Never say it pays for itself');
  assert.equal(sheet.find(r => r[0] === 'OWN_CALM_UGC_A1_US_META')![5], '');
  const all = pack.complianceCsv.toLowerCase();
  for (const internal of ['comp_pays_for_itself', 'legal cleared', 'skeptic', 'override', 'nick', 'vivan', 'j. doe', 'legal §4', 'owners told us']) assert.equal(all.includes(internal), false, `compliance sheet leaks "${internal}"`);
  // Never "approved" (the compliance status "cleared" is the one exception).
  assert.equal(/approved/i.test(pack.csv + pack.md + pack.complianceCsv), false);

  // A second sign-off is version 2 of the set; version 1 stays. The same lines keep their codes.
  const second = await R.signOff({ ...base, expectation }, 'nick');
  assert.equal(second.signoff.version, 2);
  assert.deepEqual(second.signoff.versions!.map(v => v.code), ['OWN_CALM_UGC_A1_US_META', 'OWN_CALM_UGC_A2_US_META']);
  assert.equal(second.signoff.versions![0].fields.meta_primary.version, 2);
  assert.equal((await R.readyView('OWN', 'OWN_CALM')).signoffs.length, 2);
  const pack2 = S.parseCsv((await R.handoffPack()).csv);
  assert.equal(pack2.find(r => r[0] === 'OWN_CALM_UGC_A2_US_META')![STATUS], 'Cleared');

  // A new version (different lines) never takes a code already signed off; one reusing the lines keeps its code.
  const late = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'late', own_lines: [{ text: 'Calm, even on a Sunday.', field: 'meta_primary' }] }), api, () => {}, { ownOnly: true, user: 'nick', batchId: 'OWN_CALM-000000-000000' });
  const lateLine = late.lines[0];
  await S.setDecision(late.id, lateLine.id, { decision: 'keep' }, 'nick');
  const third = await R.signOff({ ...base, versions: [{ visual: 'A', fields: { meta_primary: lateLine.id, meta_headline: head.id } }, ...versions], expectation }, 'nick');
  assert.deepEqual(third.signoff.versions!.map(v => v.code), ['OWN_CALM_UGC_A3_US_META', 'OWN_CALM_UGC_A1_US_META', 'OWN_CALM_UGC_A2_US_META']);
  const everSigned = new Map<string, string>();
  for (const so of await S.getStore().listSignoffs()) for (const v of so.versions || []) {
    const key = JSON.stringify(Object.entries(v.fields).map(([f, x]: any) => [f, x.line_id]).sort());
    assert.ok(!everSigned.has(v.code) || everSigned.get(v.code) === key, `${v.code} was signed off for two different ads`);
    everSigned.set(v.code, key);
  }
}
