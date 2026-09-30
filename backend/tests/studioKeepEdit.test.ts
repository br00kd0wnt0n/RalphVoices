// Nick's bug (29 Sep): edit a line, "Save edit", then "Keep", and the Shortlist
// showed the original wording. A saved edit now counts whatever is pressed after
// it (finalText), Keep on an edited line is recorded as edit, and "Revert to
// original" goes back. File store, mock client, example rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import * as R from '../src/services/studio/ready.js';
import { FileStore } from '../src/services/studio/store.js';

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-keepedit-'));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath: path.join(__dirname, '../scripts/studio/rules.example.json') }));
  await S.refreshRules();
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'ke', own_lines: [{ text: 'Calm at the counter, every single time you visit.', field: 'meta_primary' }] }), new S.Api({ mock: true }), () => {}, { ownOnly: true, user: 'nick' });
  return { run, line: run.lines[0] };
}
const EDIT = 'Calm at the counter.';

test('edit → save → keep: Shortlist, Ready, sign-off, exports and taste all use the edited wording', async () => {
  const { run, line } = await fresh();
  await S.setDecision(run.id, line.id, { decision: 'edit', edited_text: EDIT }, 'nick');
  const kept = await S.setDecision(run.id, line.id, { decision: 'keep' }, 'nick');
  assert.equal(kept.decision, 'edit', 'Keep on an edited line is recorded as an edit');
  assert.equal(S.finalText(kept), EDIT);

  assert.equal((await S.shortlist()).find(r => r.id === line.id)!.text, EDIT);
  const view = await R.readyView('OWN', 'OWN_CALM');
  assert.equal(view.lines[0].final_text, EDIT);
  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', line_ids: [line.id], expectation: { line_ids: [line.id], reason: 'Short and plain.' } }, 'nick');
  assert.equal(signoff.lines[0].text, EDIT);
  assert.ok((await R.handoffPack()).csv.includes(EDIT));
  assert.ok((await S.exportBatch(run.id)).md.includes(`*Edited:* ${EDIT}`));
  const taste = (await S.loadTaste()).find(t => t.id === line.id)!;
  assert.equal(taste.text, EDIT);
  assert.equal(taste.original, line.text);
});

test('Keep toggled off and on again keeps the edit; Revert to original goes back and re-checks', async () => {
  const { run, line } = await fresh();
  await S.setDecision(run.id, line.id, { decision: 'edit', edited_text: EDIT }, 'nick');
  await S.setDecision(run.id, line.id, { decision: '' }, 'nick');
  const again = await S.setDecision(run.id, line.id, { decision: 'keep' }, 'nick');
  assert.equal(S.finalText(again), EDIT);
  // Flags found by the model on the original say so once, however often the line is saved.
  assert.ok(again.flags.every(f => (f.why || '').split('(on the original wording)').length <= 2));

  const reverted = await S.setDecision(run.id, line.id, { decision: 'keep', edited_text: '' }, 'nick');
  assert.equal(reverted.decision, 'keep');
  assert.equal(S.finalText(reverted), line.text);
  assert.ok(reverted.flags.every(f => !(f.why || '').includes('(on the original wording)')), 'back on the original, no flag says "on the original wording"');
  assert.equal((await S.shortlist()).find(r => r.id === line.id)!.text, line.text);
  // Saving an "edit" identical to the original is just a keep.
  assert.equal((await S.setDecision(run.id, line.id, { decision: 'edit', edited_text: line.text }, 'nick')).decision, 'keep');
});

test('lines saved before the fix (keep with an edit) read as edited; a cut line never does', async () => {
  const { run, line } = await fresh();
  const l = (await S.loadBatch(run.id)).lines[0];
  Object.assign(l, { decision: 'keep', edited_text: EDIT, decided_at: new Date().toISOString() });
  await S.getStore().saveLine(run.id, l);
  assert.equal((await S.shortlist()).find(r => r.id === line.id)!.text, EDIT);
  assert.equal((await R.readyView('OWN', 'OWN_CALM')).lines[0].final_text, EDIT);
  assert.equal(S.finalText({ ...l, decision: 'cut' }), line.text);
  // A sheet imported with "keep" and an edited wording keeps the edit too.
  const csv = S.toCsv([['id', 'decision', 'edited_text', 'note'], [line.id, 'keep', 'Calm, every time.', '']]);
  await S.ingest(csv, 'nick');
  const after = (await S.loadBatch(run.id)).lines[0];
  assert.equal(after.decision, 'edit');
  assert.equal(S.finalText(after), 'Calm, every time.');
});
