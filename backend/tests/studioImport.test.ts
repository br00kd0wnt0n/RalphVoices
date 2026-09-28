// db-import carry-over (Brook, 28 Sep): only the chosen runs come across, with
// their briefs, history and taste; planted-line checks never do; compares only
// on request; old decisions get attributed. Temp folder, mock client.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import { FileStore } from '../src/services/studio/store.js';
import { attributeDecisions, planImport } from '../src/services/studio/importPlan.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-import-'));
const store = new FileStore(dir, { rulesPath: path.join(__dirname, '../scripts/studio/rules.example.json') });
let oldRun = '', newRun = '', other = '';

before(async () => {
  S.setStudioDir(dir);
  S.setStore(store);
  await S.refreshRules();
  const api = new S.Api({ mock: true });
  const mk = async (name: string, created: string, user: string) => {
    const brief = S.makeBrief({ territory: 'OWN_CALM', n: 3, name });
    await S.saveBrief(brief);  // the server saves the brief with each run
    const b = await S.generate(brief, api, () => {}, { check: false, user });
    const saved = await store.getBatch(b.id);
    saved.created = created;
    await store.saveBatch(saved);
    return b.id;
  };
  oldRun = await mk('old', '2026-09-25T21:45:00.000Z', 'Brook');
  newRun = await mk('kickoff', '2026-09-28T14:50:00.000Z', 'Brook');
  other = await mk('cd', '2026-09-29T10:00:00.000Z', 'nick');
  // Decisions on both runs; the kickoff one also has a taste example.
  await S.setDecision(oldRun, `${oldRun}-L01`, { decision: 'keep' }, 'Brook');
  await S.setDecision(newRun, `${newRun}-L01`, { decision: 'keep', note: 'plain' }, 'Brook');
  // A planted-line check on the kickoff day never comes across.
  await S.checkTexts('OWN', 'OWN_CALM', [{ text: 'Planted.', field: 'meta_primary' }], api);
  await S.compare(S.makeBrief({ territory: 'OWN_CALM', name: 'cmp' }), ['a', 'b'], 1, api);
});

test('--since keeps the kickoff runs and what follows from them', async () => {
  const history = (fs.readFileSync(path.join(dir, 'edits.jsonl'), 'utf8').split('\n').filter(Boolean)).map(l => JSON.parse(l));
  const briefs = fs.readdirSync(path.join(dir, 'briefs'));
  const p = await planImport(store, { since: '2026-09-28' }, history, briefs);
  assert.deepEqual(p.runs.map(r => r.id).sort(), [newRun, other].sort());
  assert.ok(p.skipped.some(s => s.id === oldRun && /before/.test(s.why)));
  assert.ok(p.skipped.some(s => s.id.startsWith('adhoc-') && s.why === 'planted-line check'));
  assert.ok(p.taste.every(t => t.batch !== oldRun), 'taste from skipped runs stays behind');
  assert.ok(p.taste.some(t => t.batch === newRun));
  assert.ok(p.history.every(e => e.batch_id !== oldRun));
  assert.deepEqual(p.compares, [], 'compares only on request');
  assert.equal(p.briefs.length, 2);
  assert.equal(p.runs.find(r => r.id === newRun)!.kept, 1);
});

test('--runs picks exact runs; an unknown id is an error; a bad date is an error', async () => {
  const p = await planImport(store, { runs: [newRun] });
  assert.deepEqual(p.runs.map(r => r.id), [newRun]);
  await assert.rejects(() => planImport(store, { runs: ['NOPE'] }), /No run NOPE/);
  await assert.rejects(() => planImport(store, { since: '28 Sep' }), /date like/);
  const withCompares = await planImport(store, { since: '2026-09-28', compares: true });
  assert.equal(withCompares.compares.length, 1);
});

test('decisions from before attribution are credited to the run author, with an imported history record', async () => {
  const b = await store.getBatch(newRun);
  delete b.lines[0].decided_by;
  delete b.lines[0].decided_at;
  b.updated = '2026-09-28T15:00:00.000Z';
  const made = attributeDecisions(b, []);
  assert.equal(b.lines[0].decided_by, 'Brook');
  assert.equal(b.lines[0].decided_at, '2026-09-28T15:00:00.000Z');
  assert.equal(made.length, 1);
  assert.equal((made[0].after as any).imported, true);
  assert.equal(attributeDecisions(b, made).length, 0, 'lines whose history already exists get no second record');
});
