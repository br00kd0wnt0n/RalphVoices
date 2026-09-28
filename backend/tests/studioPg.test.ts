// Copy Studio on Postgres (migration 015): the same engine flow as
// studio.test.ts, run against PgStore. Needs a local test database with 015
// applied; set STUDIO_TEST_DATABASE_URL, e.g.
//   STUDIO_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_studio_test npm test
// Skipped when unset. Refuses non-local hosts. Truncates the studio_* tables.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import { PgStore } from '../src/services/studio/pgStore.js';

const URL_ = process.env.STUDIO_TEST_DATABASE_URL || '';
const skip = !URL_ ? 'set STUDIO_TEST_DATABASE_URL to run the Postgres tests' : false;
let store: PgStore;

before(async () => {
  if (skip) return;
  const host = new URL(URL_).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error(`Refusing non-local test database ${host}`);
  store = PgStore.fromUrl(URL_);
  const tables = ['studio_spend', 'studio_compares', 'studio_taste', 'studio_edits', 'studio_line_embeddings', 'studio_lines', 'studio_batches', 'studio_briefs', 'studio_territory_edits', 'studio_inputs', 'studio_rules'];
  await (store as any).db.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  await store.putRules('example-1', rules, { activate: true, by: 'test' });
  // Exports still go to files for Sheets; point them at a temp folder.
  S.setStudioDir(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-pg-')));
  S.setStore(store);
  await S.refreshRules();
});
after(async () => { if (!skip) await store.close(); });

test('rules come from the active database version; a second activation retires the first', { skip }, async () => {
  const r = await S.refreshRules();
  assert.equal(r.version, 'example-1');
  await store.putRules('example-2', { ...r, version: 'example-2' }, { activate: true });
  const list = await store.listRules();
  assert.equal(list.filter((x: any) => x.status === 'active').length, 1);
  assert.equal((await S.refreshRules()).version, 'example-2');
});

test('a run is written, read back, continued and decided on, all in the database', { skip }, async () => {
  const api = new S.Api({ mock: true });
  const b = S.makeBrief({ territory: 'OWN_CALM', n: 6, name: 'pg-own', own_lines: [{ text: 'Calm at the counter, at partner clinics.', field: 'meta_primary' }] });
  const first = await S.generate(b, api, () => {}, { ownOnly: true, user: 'Brook' });
  const more = await S.generate(b, api, () => {}, { batchId: first.id, user: 'Brook' });
  const back = await S.loadBatch(first.id);
  assert.equal(back.lines.length, more.lines.length);
  assert.equal(back.created_by, 'Brook');
  assert.ok(back.lines.every(l => l.status === 'checked'));
  assert.equal(Object.keys(await store.getEmbeddings(first.id)).length, back.lines.length);

  const l = await S.setDecision(first.id, back.lines[1].id, { decision: 'keep', note: 'plain and true' }, 'CD');
  assert.equal(l.decided_by, 'CD');
  assert.equal((await S.lineHistory(l.id)).length, 1);
  assert.equal((await S.listBatches('brook')).length, 1);
  assert.equal((await S.shortlist()).length, 1);
  assert.equal((await S.loadTaste()).length, 1);
});

test("a whole-run save (the checker) doesn't roll back a newer decision on a line", { skip }, async () => {
  const [id] = await store.listBatchIds();
  const stale = await S.loadBatch(id);                 // the checker's copy, taken earlier
  const target = stale.lines[2];
  await S.setDecision(id, target.id, { decision: 'cut', note: 'too cute' }, 'CD');  // someone decides meanwhile
  stale.stats.timings_ms.check = 123;                  // the checker finishes and saves its whole copy
  await S.saveBatch(stale);
  const now = (await S.loadBatch(id)).lines.find(x => x.id === target.id)!;
  assert.equal(now.decision, 'cut');
  assert.equal(now.note, 'too cute');
  assert.equal((await S.loadBatch(id)).stats.timings_ms.check, 123);
});

test('territory edits, compares with a hidden key, and spend live in the database', { skip }, async () => {
  const e = await S.saveTerritory('OWN_CALM', { premise: 'Calmer.' }, 'client feedback', 'Brook');
  assert.equal(e.territory.origin, 'edited');
  assert.equal(S.loadRules().territories.OWN_CALM.premise, 'Calmer.');

  const api = new S.Api({ mock: true });
  const set = await S.compare(S.makeBrief({ territory: 'OWN_CALM', name: 'pg-cmp' }), ['writer-a', 'writer-b'], 3, api);
  const stored = await S.loadCompare(set.name);
  assert.equal(JSON.stringify(stored).includes('writer-a'), false, 'the set itself never names the writers');
  const { labels } = await S.revealCompare(set.name);
  assert.deepEqual(Object.values(labels).sort(), ['writer-a', 'writer-b']);

  await store.addSpend({ label: 'test', usd: 0.25, at: new Date().toISOString() });
  assert.equal((await S.readSpend()).total_usd, 0.25);
});
