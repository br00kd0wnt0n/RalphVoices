// The Ready for production acceptance scenario (Brook, 28 Sep), shared by
// studioReady.test.ts (file store) and studioPg.test.ts (Postgres, run in
// sequence with the other database tests so they don't truncate each other).
import assert from 'node:assert/strict';
import * as S from '../../src/services/studio/engine.js';
import * as R from '../../src/services/studio/ready.js';

export async function scenario() {
  const api = new S.Api({ mock: true });
  // Two of the creative director's own lines: one clean, one with a red (compliance) flag.
  const b = S.makeBrief({ territory: 'OWN_CALM', name: 'ready', own_lines: [
    { text: 'Calm at the counter, at partner clinics.', field: 'meta_primary' },
    { text: 'Honestly, the policy pays for itself.', field: 'meta_primary' },
  ] });
  const run = await S.generate(b, api, () => {}, { ownOnly: true, user: 'nick' });
  const [clean, risky] = run.lines;
  assert.ok(R.unresolvedRed(risky).some(f => f.rule === 'COMP_PAYS_FOR_ITSELF'), 'the planted line carries a red flag');
  await S.setDecision(run.id, clean.id, { decision: 'keep' }, 'nick');
  await S.setDecision(run.id, risky.id, { decision: 'keep' }, 'nick');
  const ids = [clean.id, risky.id];
  const expectation = { line_ids: [clean.id], reason: 'Plain promise, lowest effort to read; Owners told us they hate hype.' };

  // 1. An unresolved red flag blocks sign-off, and the gate names the line and the flag.
  await assert.rejects(() => R.signOff({ persona: 'OWN', territory: 'OWN_CALM', line_ids: ids, expectation }, 'nick'), (err: any) => {
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
  // The expectations record is required and must pick from the lines being signed off.
  await assert.rejects(() => R.signOff({ persona: 'OWN', territory: 'OWN_CALM', line_ids: ids, expectation: { line_ids: [], reason: '' } }, 'nick'), /expect to lead/);
  await assert.rejects(() => R.signOff({ persona: 'OWN', territory: 'OWN_CALM', line_ids: [risky.id], expectation }, 'nick'), /among the lines/);

  const { signoff, expectation: exp } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', line_ids: ids, expectation }, 'nick');
  assert.equal(signoff.version, 1);
  assert.equal(signoff.ready_by, 'nick');
  assert.ok(signoff.lines.find(x => x.line_id === risky.id)!.overrides!.length, 'the override travels with the sign-off');

  // 4. The expectations record is saved, dated and hashed over the sign-off.
  const stored = (await S.getStore().listExpectations()).find((e: any) => e.id === exp.id);
  assert.ok(stored);
  assert.match(stored.sha256, /^[0-9a-f]{64}$/);
  // The naming code is stored on the expectation and on every signed-off version (B3b joins live results on it).
  assert.deepEqual(stored.stubs, [signoff.lines.find(x => x.line_id === clean.id)!.stub]);
  assert.match(stored.stubs[0], /^OWN_/);
  assert.equal(stored.sha256, S.sha256(JSON.stringify({ persona: 'OWN', territory: 'OWN_CALM', signoff_id: signoff.id, signoff_sha256: signoff.sha256, line_ids: [clean.id], stubs: stored.stubs, reason: expectation.reason, created_by: 'nick', created_at: stored.created_at })));

  // 3. An edit after sign-off creates version 2 and keeps version 1; the sign-off is untouched.
  const v1Text = signoff.lines.find(x => x.line_id === clean.id)!.text;
  const edited = await S.setDecision(run.id, clean.id, { decision: 'edit', edited_text: 'Calm at the counter, at partner clinics. Every time.' }, 'nick');
  assert.equal(edited.ready!.changed_since, true);
  const versions = await S.getStore().listLineVersions(clean.id);
  assert.deepEqual(versions.map((v: any) => v.version), [1, 2]);
  assert.equal(versions[0].text, v1Text);
  assert.notEqual(versions[0].sha256, versions[1].sha256);
  assert.ok(versions.every((v: any) => v.stub === stored.stubs[0]), 'every version carries the naming code');
  const again = (await S.getStore().listSignoffs()).find((s: any) => s.id === signoff.id);
  assert.equal(again.lines.find((x: any) => x.line_id === clean.id).text, v1Text, 'the signed-off wording is never rewritten');

  // Compliance status: set by anyone on the list, doesn't block, shows in the handoff.
  await assert.rejects(() => R.setCompliance(run.id, risky.id, 'approved', '', 'vivan'), /one of/);
  // A line with an overridden red flag can't be cleared without a note.
  await assert.rejects(() => R.setCompliance(run.id, risky.id, 'cleared', '', 'vivan'), /add a note/);
  await assert.rejects(() => R.setCompliance(run.id, risky.id, 'cleared', '   ', 'vivan'), /add a note/);
  await R.setCompliance(run.id, risky.id, 'changes_requested', undefined, 'vivan');  // other statuses need no note
  await R.setCompliance(run.id, risky.id, 'cleared', 'Cleared by Trupanion legal (J. Doe), 28 Sep', 'vivan');
  await R.setCompliance(run.id, clean.id, 'cleared', undefined, 'vivan');  // no override: no note needed

  // 5. The handoff pack: CSV that parses cleanly, Markdown, and a clean compliance sheet.
  const pack = await R.handoffPack();
  const rows = S.parseCsv(pack.csv);
  assert.equal(rows.length, 3, 'header plus two lines');
  assert.ok(rows.every(r => r.length === rows[0].length), 'every row has the same columns');
  assert.deepEqual(rows[0].slice(0, 3), ['Naming code', 'Persona', 'Territory']);
  const byText = new Map(rows.slice(1).map(r => [r[6], r]));
  assert.ok(byText.has(v1Text), 'the handoff carries the signed-off wording (v1), not the later edit');
  assert.equal(byText.get(v1Text)![14], 'yes: a newer version exists');
  // Compliance was given on the later wording, so the signed-off v1 row says so rather than claiming it's cleared.
  assert.equal(byText.get(v1Text)![9], 'Pending');
  assert.equal(byText.get(v1Text)![10], 'Reviewed on a different wording');
  assert.equal(byText.get('Honestly, the policy pays for itself.')![9], 'Cleared');
  // The internal handoff shows the override next to the status.
  assert.equal(rows[0][11], 'Red flag overridden');
  assert.match(byText.get('Honestly, the policy pays for itself.')![11], /pays for itself.*overridden by nick.*Legal cleared this claim/);
  assert.equal(byText.get(v1Text)![11], '');
  assert.match(pack.md, /Red flag overridden: .*overridden by nick/);
  assert.match(pack.md, /Expected to lead/);
  assert.match(pack.md, /not compliance clearance/);
  const sheet = S.parseCsv(pack.complianceCsv);
  assert.deepEqual(sheet[0], ['Naming code', 'Field', 'Platform', 'Final text', 'Characters', 'Please check']);
  // The overridden line tells the reviewer which rule to look at, in the rule's plain words; clean lines say nothing.
  const riskyRow = sheet.find(r => r[3] === 'Honestly, the policy pays for itself.')!;
  assert.equal(riskyRow[5], 'Please check specifically: Never say it pays for itself');
  assert.equal(sheet.find(r => r[3] === v1Text)![5], '');
  const all = pack.complianceCsv.toLowerCase();
  for (const internal of ['comp_pays_for_itself', 'legal cleared', 'skeptic', 'override', 'nick', 'vivan', 'j. doe', 'legal §4', 'owners told us']) assert.equal(all.includes(internal), false, `compliance sheet leaks "${internal}"`);
  // Never "approved" (the compliance status "cleared" is the one exception).
  assert.equal(/approved/i.test(pack.csv + pack.md + pack.complianceCsv), false);

  // A second sign-off is version 2 of the set; version 1 stays.
  const second = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', line_ids: ids, expectation }, 'nick');
  assert.equal(second.signoff.version, 2);
  assert.equal(second.signoff.lines.find(x => x.line_id === clean.id)!.version, 2);
  assert.equal((await R.readyView('OWN', 'OWN_CALM')).signoffs.length, 2);
  // Compliance was reviewed on the same wording for the risky line; the clean line is pending.
  const pack2 = S.parseCsv((await R.handoffPack()).csv);
  assert.equal(pack2.find(r => r[6] === 'Honestly, the policy pays for itself.')![9], 'Cleared');
  assert.equal(pack2.find(r => r[6].endsWith('Every time.'))![9], 'Cleared', 'cleared on the wording that is now signed off');
}
