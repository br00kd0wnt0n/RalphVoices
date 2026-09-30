// Nick's walkthrough (29 Sep), items 1–3: shorter lines by default, cutting
// from the Shortlist, and adding a line mid-review. (Item 4, Compliance after
// Pre-flight, needs the database: studioPg.test.ts.) File store, mock client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import * as R from '../src/services/studio/ready.js';
import { FileStore } from '../src/services/studio/store.js';

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-nick-'));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath: path.join(__dirname, '../scripts/studio/rules.example.json') }));
  return S.refreshRules();
}
function recordingApi() {
  const api = new S.Api({ mock: true });
  const calls: Array<{ system: string; user: string }> = [];
  const chat = api.chat.bind(api);
  api.chat = (async (o: any) => { if (o.stage === 'generate') calls.push({ system: o.system, user: o.user }); return chat(o); }) as any;
  return { api, calls };
}

test('1. short by default: the length control starts at short, and the writer aims well inside the visible limits', async () => {
  const r = await fresh();
  const b = S.makeBrief({ territory: 'OWN_CALM', n: 4 });
  assert.equal(b.tone.short_long, 1);
  assert.equal(S.targetChars(125), 75);
  assert.equal(S.targetChars(40), 30);
  assert.equal(S.targetChars(27), 20);
  const { api, calls } = recordingApi();
  await S.generate(b, api, () => {}, { check: false, user: 'nick' });
  const { system, user } = calls[0];
  for (const f of b.fields) assert.ok(system.includes(`aim for ${S.targetChars(r.fields[f].visible)} characters or fewer (${r.fields[f].visible} visible)`), f);
  assert.match(system, /short and punchy/i);
  assert.match(system, /Fragments are welcome/);
  assert.match(user, /aim ≤\d+ chars; \d+ visible/);
});

async function keptRun() {
  await fresh();
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'sl', own_lines: [
    { text: 'Calm at the counter.', field: 'meta_primary' },
    { text: 'One less worry on a Sunday.', field: 'meta_primary' },
  ] }), new S.Api({ mock: true }), () => {}, { ownOnly: true, user: 'nick' });
  for (const l of run.lines) await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
  return run;
}

test('2. cutting on the Shortlist is the same decision as in Review, with undo; a signed-off line says to change the set at Ready', async () => {
  const run = await keptRun();
  const [a, b] = run.lines;
  let rows = await S.shortlist();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].batch, run.id);
  assert.equal(rows[0].decision, 'keep');

  // Cut from the Shortlist: attributed, recorded in the history, gone from the Shortlist, dropped from taste like a Review cut.
  const cut = await S.setDecision(run.id, a.id, { decision: 'cut', source: 'shortlist' }, 'vivan');
  assert.equal(cut.decided_by, 'vivan');
  assert.equal((await S.shortlist()).some(r => r.id === a.id), false);
  assert.equal((await S.loadTaste()).some(t => t.id === a.id), false);
  assert.equal((await S.lineHistory(a.id)).at(-1)!.after.decision, 'cut');
  // Undo: back to what it was.
  await S.setDecision(run.id, a.id, { decision: 'keep' }, 'vivan');
  assert.ok((await S.shortlist()).some(r => r.id === a.id));

  // Signed off at Ready: refused from the Shortlist, with the reason.
  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', line_ids: [b.id], expectation: { line_ids: [b.id], reason: 'Plain.' } }, 'nick');
  rows = await S.shortlist();
  assert.equal(rows.find(r => r.id === b.id)!.signed_off, signoff.id);
  await assert.rejects(() => S.setDecision(run.id, b.id, { decision: 'cut', source: 'shortlist' }, 'vivan'), /Signed off at Ready for production .*take it out of the set there/);
});

test('3. a line added mid-review goes into the same run as your line, with the run\'s region, checked, and can be kept into the Shortlist', async () => {
  await fresh();
  const api = new S.Api({ mock: true });
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'ca', region: 'CA', n: 3 }), api, () => {}, { user: 'nick' });
  const before = run.lines.length;
  // What the Review slot sends: the run's own brief with one new line, into the run.
  const after = await S.generate(S.makeBrief({ ...run.brief, own_lines: [{ text: 'Colour me calm at the counter.', field: 'meta_headline' }] }), api, () => {}, { batchId: run.id, ownOnly: true, user: 'nick' });
  assert.equal(after.id, run.id, 'same run, not a new one');
  assert.equal(after.lines.length, before + 1, 'only the new line is added');
  const added = after.lines.at(-1)!;
  assert.equal(added.model, 'human');
  assert.equal(added.region, 'CA');
  assert.equal(added.field, 'meta_headline');
  assert.equal(added.status, 'checked');
  await S.setDecision(run.id, added.id, { decision: 'keep' }, 'nick');
  assert.ok((await S.shortlist()).find(r => r.id === added.id)!.stub.endsWith('_CA_META'));
});
