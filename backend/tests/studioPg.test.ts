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
import { scenario as readyScenario } from './helpers/readyScenario.js';

const URL_ = process.env.STUDIO_TEST_DATABASE_URL || '';
const skip = !URL_ ? 'set STUDIO_TEST_DATABASE_URL to run the Postgres tests' : false;
let store: PgStore;

before(async () => {
  if (skip) return;
  const host = new URL(URL_).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error(`Refusing non-local test database ${host}`);
  store = PgStore.fromUrl(URL_);
  const tables = ['studio_expectations', 'studio_line_versions', 'studio_signoffs', 'studio_assets', 'studio_spend', 'studio_compares', 'studio_taste', 'studio_edits', 'studio_line_embeddings', 'studio_lines', 'studio_batches', 'studio_briefs', 'studio_territory_edits', 'studio_inputs', 'studio_rules'];
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
  assert.equal((r as any).version, 'example-1');
  await store.putRules('example-2', { ...r, version: 'example-2' }, { activate: true });
  const list = await store.listRules();
  assert.equal(list.filter((x: any) => x.status === 'active').length, 1);
  assert.equal(((await S.refreshRules()) as any).version, 'example-2');
});

test('a run is written, read back, continued and decided on, all in the database', { skip }, async () => {
  const api = new S.Api({ mock: true });
  const b = S.makeBrief({ territory: 'OWN_CALM', n: 6, name: 'pg-own', own_lines: [{ text: 'Calm at the counter, at partner clinics.', field: 'meta_primary' }] });
  const first = await S.generate(b, api, () => {}, { ownOnly: true, user: 'Brook' });
  const more = await S.generate(b, api, () => {}, { batchId: first.id, user: 'Brook' });
  const back = await S.loadBatch(first.id);
  assert.equal(back.lines.length, more.lines.length);
  assert.equal(back.created_by, 'Brook');
  assert.equal(back.rules_version, 'example-2');
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

  await store.addSpend({ label: 'last month', usd: 1, at: '2000-01-01T00:00:00Z' });
  await store.addSpend({ label: 'test', usd: 0.25, at: new Date().toISOString() });
  assert.equal((await S.readSpend()).total_usd, 1.25);
  const monthly = new S.Api({ cap: 50, capWindow: 'month' });
  (monthly as any).mock = false;
  assert.equal(await monthly.loadSpent(), 0.25);
});

test('reference documents and the client logo are served from the database', { skip }, async () => {
  assert.equal((await S.referenceDocs()).find(d => d.id === 'readout')!.available, false);
  await store.putAsset('doc:readout', { contentType: 'text/markdown', data: Buffer.from('# Readout'), filename: 'readout.md' });
  assert.equal((await S.referenceDocs()).find(d => d.id === 'readout')!.available, true);
  assert.equal((await S.referenceDoc('readout')).asset.data.toString(), '# Readout');
});

test('hosted rules endpoints: anyone lists, only admins upload or activate, versions are never overwritten', { skip }, async () => {
  const express = (await import('express')).default;
  const { createStudioRouter } = await import('../src/services/studio/router.js');
  const app = express();
  const isAdmin = (req: any) => req.headers['x-admin'] === '1';
  app.use('/s', createStudioRouter({ who: () => 'brook', api: () => new S.Api({ mock: true }), mock: true, cap: 50, capWindow: 'month', askOver: 2, rules: { store, isAdmin } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/s`;
  const call = async (method: string, p: string, body?: unknown, admin = false) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(admin ? { 'X-Admin': '1' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: (await res.json()) as any };
  };
  try {
    const current = S.loadRules();
    assert.equal((await call('GET', '/rules')).status, 200);
    assert.equal((await call('POST', '/rules', { version: 'example-3', rules: current })).status, 403);
    assert.match((await call('POST', '/rules', { version: 'bad', rules: { personas: {} } }, true)).body.error, /missing sources/);
    const up = await call('POST', '/rules', { version: 'example-3', rules: current, notes: 'test' }, true);
    assert.equal(up.status, 200);
    assert.equal(up.body.find((x: any) => x.version === 'example-3').status, 'draft');
    assert.equal((await call('POST', '/rules', { version: 'example-3', rules: current }, true)).status, 400);
    assert.equal((await call('POST', '/rules/example-3/activate', {})).status, 403);
    const act = await call('POST', '/rules/example-3/activate', {}, true);
    assert.equal(act.body.filter((x: any) => x.status === 'active').map((x: any) => x.version).join(), 'example-3');
    assert.equal(((await S.refreshRules()) as any).version, 'example-3');
    assert.equal((await call('POST', '/rules/nope/activate', {}, true)).status, 400);
  } finally { server.close(); }
});

test('Ready for production on Postgres (sign-off gate, overrides, versions, expectations, handoff)', { skip }, async () => {
  const tables = ['studio_expectations', 'studio_line_versions', 'studio_signoffs', 'studio_edits', 'studio_line_embeddings', 'studio_lines', 'studio_batches', 'studio_taste'];
  await (store as any).db.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  await store.putRules('ready-1', { ...rules, version: 'ready-1' }, { activate: true });
  await S.refreshRules();
  await readyScenario();
});

test('a fresh database with no rules: routes say no_rules, and an admin can still upload and activate them', { skip }, async () => {
  const express = (await import('express')).default;
  const { createStudioRouter } = await import('../src/services/studio/router.js');
  await (store as any).db.query('TRUNCATE studio_rules');
  const app = express();
  const isAdmin = (req: any) => req.headers['x-admin'] === '1';
  app.use('/s', createStudioRouter({ who: () => 'brook', api: () => new S.Api({ mock: true }), mock: true, cap: 50, capWindow: 'month', askOver: 2, rules: { store, isAdmin } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/s`;
  const call = async (method: string, p: string, body?: unknown) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Admin': '1' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: (await res.json()) as any };
  };
  try {
    const meta = await call('GET', '/meta');
    assert.equal(meta.status, 503);
    assert.equal(meta.body.error, 'no_rules');
    assert.equal((await call('GET', '/rules')).status, 200);
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
    assert.equal((await call('POST', '/rules', { version: 'first', rules })).status, 200);
    assert.equal((await call('GET', '/meta')).status, 503, 'uploaded as a draft: still nothing active');
    assert.equal((await call('POST', '/rules/first/activate', {})).status, 200);
    assert.equal((await call('GET', '/meta')).status, 200);
  } finally { server.close(); }
});
