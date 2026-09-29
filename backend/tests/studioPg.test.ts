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

test('the client logo is served from the database when one exists (production has none: the page shows the wordmark)', { skip }, async () => {
  await assert.rejects(() => S.brandAsset('client-logo'), /isn't available/);
  await store.putAsset('brand:client-logo', { contentType: 'image/png', data: Buffer.from('png'), filename: 'logo.png' });
  assert.equal((await S.brandAsset('client-logo')).data.toString(), 'png');
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
    // Hosted: the rules file carries the rubric and each persona's seed and voice, or the upload is refused (never an error at audit time).
    const hosted = express();
    hosted.use('/h', createStudioRouter({ who: () => 'brook', api: () => new S.Api({ mock: true }), mock: true, cap: 50, capWindow: 'month', askOver: 2, rules: { store, isAdmin: () => true, selfContained: true } }));
    const hs = hosted.listen(0, '127.0.0.1');
    await new Promise(r => hs.once('listening', r));
    try {
      const { rubric: _r, ...noRubric } = current as any;
      const res = await fetch(`http://127.0.0.1:${(hs.address() as any).port}/h/rules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 'no-rubric', rules: noRubric }) });
      assert.equal(res.status, 400);
      assert.match(((await res.json()) as any).error, /no-rubric is missing rubric/);
    } finally { hs.close(); }
    const up = await call('POST', '/rules', { version: 'example-3', rules: current, notes: 'test' }, true);
    assert.equal(up.status, 200);
    assert.equal(up.body.find((x: any) => x.version === 'example-3').status, 'draft');
    assert.equal((await call('POST', '/rules', { version: 'example-3', rules: current }, true)).status, 400);
    assert.equal((await call('POST', '/rules/example-3/activate', {})).status, 403);
    const act = await call('POST', '/rules/example-3/activate', {}, true);
    assert.equal(act.body.filter((x: any) => x.status === 'active').map((x: any) => x.version).join(), 'example-3');
    const live = act.body.find((x: any) => x.version === 'example-3');
    assert.equal(live.activated_by, 'brook', 'the Rules view says who made it live');
    assert.ok(live.activated_at);
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

test('Pre-flight end to end: upload, audit, copy-match red, agree, override, Ready to traffic, exports', { skip }, async () => {
  const { Preflight } = await import('../src/services/studio/preflight.js');
  const { mockEngine } = await import('../src/services/studio/preflightEngine.js');
  const R = await import('../src/services/studio/ready.js');
  const tables = ['studio_asset_status', 'studio_audit_agreements', 'studio_audit_flags', 'studio_audits', 'studio_upload_files', 'studio_asset_uploads', 'studio_expectations', 'studio_line_versions', 'studio_signoffs', 'studio_edits', 'studio_line_embeddings', 'studio_lines', 'studio_batches', 'studio_taste', 'studio_spend'];
  await (store as any).db.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  await store.putRules('pf-1', { ...rules, version: 'pf-1' }, { activate: true });
  await S.refreshRules();

  // Sign off one line with a caveat (the direct-pay one).
  const api = new S.Api({ mock: true });
  const caveatLine = 'Your vet gets paid directly. At partner clinics.';
  // The caveat line is an on-asset field (the TikTok hook); a Meta primary text line is post copy, never compared with the asset.
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'pf', own_lines: [
    { text: caveatLine, field: 'tiktok_hook' },
    { text: 'Calm at the counter, every time.', field: 'meta_headline' },
    { text: 'Primary text that only runs in the post.', field: 'meta_primary' },
  ] }), api, () => {}, { ownOnly: true, user: 'nick' });
  const line = run.lines[0];
  for (const l of run.lines) {
    await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
    for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find(x => x.id === l.id)!)) await R.overrideFlag(run.id, l.id, f.rule, 'Test line for Pre-flight', 'nick');
  }
  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', line_ids: run.lines.map(l => l.id), expectation: { line_ids: [line.id], reason: 'The hook.' } }, 'nick');
  const stubOf = (id: string) => signoff.lines.find(x => x.line_id === id)!.stub;
  const stub = stubOf(line.id), headlineStub = stubOf(run.lines[1].id), postStub = stubOf(run.lines[2].id);

  const pf = new Preflight((store as any).db, mockEngine, { storage: 'db' });
  const png = (text: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(`fake image VOICES_TEXT: ${text}`)]);
  const stubs = await pf.stubs();
  assert.deepEqual(stubs.map(s => s.stub).sort(), [stub, headlineStub, postStub].sort());
  assert.equal(stubs.find(s => s.stub === stub)!.copy[0].text, caveatLine);
  await assert.rejects(() => pf.upload('NOPE_v1_META', [{ buffer: png('x'), filename: 'a.png', contentType: 'image/png' }]), /isn't in a Ready for production sign-off/);
  await assert.rejects(() => pf.upload(stub, [{ buffer: Buffer.alloc(26 * 1024 * 1024), filename: 'huge.png', contentType: 'image/png' }]), /limit is 25 MB/);
  await assert.rejects(() => pf.upload(stub, [{ buffer: png('x'), filename: 'a.pdf', contentType: 'application/pdf' }]), /Upload images/);

  // 1. The asset drops the caveat: copy match is red, and the headline flag.
  const bad = png('Your vet gets paid directly.');
  const up1 = await pf.upload(stub, [{ buffer: bad, filename: 'static-v1.png', contentType: 'image/png' }], 'nick');
  assert.equal(up1.kind, 'static');
  assert.ok(Buffer.compare((await pf.file(up1.upload_id, 0)).data, bad) === 0, 'the file comes back byte for byte');
  const a1 = await pf.createAudit(up1.upload_id, 'nick');
  const events: any[] = [];
  await pf.runAudit(a1, e => events.push(e), 'nick');
  assert.ok(events.some(e => e.type === 'done'));
  let rep = await pf.report(stub, 'brook');
  assert.equal(rep.flags[0].check, 'copy_match');
  assert.equal(rep.flags[0].severity, 'red');
  assert.equal(rep.flags[0].rule, 'COPY_CAVEAT');
  assert.match(rep.flags[0].quote, /partner clinics/i);
  assert.ok(rep.audit!.result.copy_match.some((r: any) => r.field === 'hook' && r.status !== 'match'));
  assert.equal(rep.audit!.result.text_found, 'Your vet gets paid directly.');
  assert.ok(rep.audit!.result.objection);

  // 2. Agree or disagree, per person; the round's rate.
  await pf.agree(rep.flags[0].id, true, undefined, 'brook');
  await pf.agree(rep.flags[1].id, false, 'Not relevant here', 'brook');
  await pf.agree(rep.flags[0].id, true, undefined, 'nick');
  const ag = await pf.agreement();
  assert.deepEqual([ag.marked, ag.agree], [3, 2]);
  assert.equal(ag.rate, 0.667);
  assert.equal((await pf.report(stub, 'brook')).flags[1].mine, false);

  // 3. Ready to traffic is blocked by the red, then allowed after an override with a reason.
  await assert.rejects(() => pf.setReady(stub, true, 'nick'), /1 red flag to fix/);
  await assert.rejects(() => pf.override(rep.flags[0].id, '', 'nick'), /written reason/);
  await assert.rejects(() => pf.override(rep.flags.find((f: any) => f.severity === 'grey').id, 'a grey note', 'nick'), /Only red flags/);
  await pf.override(rep.flags[0].id, 'The caveat is in the caption for this placement.', 'nick');
  assert.equal((await pf.setReady(stub, true, 'nick')).status, 'ready');
  rep = await pf.report(stub);
  assert.equal(rep.flags[0].override.by, 'nick');
  assert.equal(rep.status.ready_by, 'nick');

  // 4. A new upload reopens the stub; a fixed asset clears copy match without an override.
  const up2 = await pf.upload(stub, [{ buffer: png(caveatLine), filename: 'static-v2.png', contentType: 'image/png' }], 'nick');
  assert.equal((await pf.report(stub)).status.status, 'open');
  await assert.rejects(() => pf.setReady(stub, true, 'nick'), /Run the audit on the latest upload/);
  await pf.runAudit(await pf.createAudit(up2.upload_id, 'nick'));
  assert.equal((await pf.report(stub)).flags.some((f: any) => f.check === 'copy_match'), false);
  assert.equal((await pf.agreement()).marked, 3, 'verdicts on the replaced upload still count towards the round');
  assert.equal((await pf.setReady(stub, true, 'brook')).status, 'ready');
  assert.equal((await pf.report(stub)).history.length, 2);

  // 5. Exports: the features CSV in B2's format for B3, and the handoff list.
  const feats = S.parseCsv(await pf.featuresCsv());
  assert.deepEqual(feats[0].slice(0, 8), ['stub', 'features', 'angle', 'persona', 'kind', 'red', 'amber', 'grey']);
  assert.equal(feats[1][0], stub);
  assert.equal(feats[1][1], 'direct_vet_pay');
  const hand = S.parseCsv(await pf.handoffCsv());
  assert.equal(hand[0][6], 'Status');
  assert.equal(hand.find(r => r[0] === stub)![6], 'Ready to traffic');
  assert.equal(hand.find(r => r[0] === postStub)![6], 'Not uploaded');
  assert.equal(/approved/i.test(await pf.handoffCsv()), false);

  // 6. Carousel and video kinds.
  assert.equal((await pf.upload(stub, [1, 2].map(i => ({ buffer: png(`card ${i}`), filename: `card${i}.png`, contentType: 'image/png' })))).kind, 'carousel');
  const vid = await pf.upload(stub, [{ buffer: png('Your vet gets paid directly. At partner clinics.'), filename: 'hero.mp4', contentType: 'video/mp4' }]);
  assert.equal(vid.kind, 'video');
  await pf.runAudit(await pf.createAudit(vid.upload_id));
  assert.equal((await pf.report(stub)).audit!.result.frames_unavailable, true);

  // One visual, several codes: audited once, copy match per code, post copy never compared.
  const shared = await pf.upload(headlineStub, [{ buffer: png('Calm at the counter, every time.'), filename: 'shared.png', contentType: 'image/png' }], 'nick', [postStub]);
  assert.deepEqual(shared.stubs.sort(), [headlineStub, postStub].sort());
  await pf.runAudit(await pf.createAudit(shared.upload_id));
  const hr = await pf.report(headlineStub), pr = await pf.report(postStub);
  assert.deepEqual(hr.same_visual_as, [postStub]);
  assert.equal(hr.audit!.id, pr.audit!.id, 'audited once');
  assert.equal(hr.flags.some((f: any) => f.check === 'copy_match'), false, 'the headline is on the visual');
  assert.equal(pr.flags.some((f: any) => f.check === 'copy_match'), false, 'post copy is never compared with the asset');
  assert.equal(pr.post_copy[0].text, 'Primary text that only runs in the post.');
  assert.deepEqual(pr.audit!.result.copy_match.map((r: any) => r.status), []);
  assert.equal((await pf.setReady(postStub, true, 'nick')).status, 'ready');
  assert.equal((await pf.report(headlineStub)).status.status, 'open', 'each code is marked on its own');
  assert.deepEqual(await pf.estimate(shared.upload_id), shared.estimate, 'the estimate is stored at upload and reused');
  // A shared visual is audited for one persona, so it can only serve codes of the same persona and territory.
  const other = new Preflight((store as any).db, mockEngine, { storage: 'db' });
  const realFind = (other as any).findStub.bind(other);
  (other as any).findStub = async (x: string) => x === postStub ? { ...(await realFind(x)), signoff: { ...(await realFind(x)).signoff, persona: 'DINK', territory: 'DINK_NEVER' } } : realFind(x);
  await assert.rejects(() => other.upload(headlineStub, [{ buffer: png('x'), filename: 'x.png', contentType: 'image/png' }], 'nick', [postStub]), /same persona and territory only/);
  const hand2 = S.parseCsv(await pf.handoffCsv());
  assert.equal(hand2.find(r => r[0] === postStub)![5], headlineStub, 'the handoff says which codes share the visual');

  // An OpenAI outage fails the audit as retryable; running it again on the same upload works.
  const { FatalError } = await import('../src/services/audit/api.js');
  const down = new Preflight((store as any).db, { ...mockEngine, name: 'down', run: async () => { throw new FatalError('OpenAI unreachable: 3 calls failed in a row'); } }, { storage: 'db' });
  const upOut = await pf.upload(stub, [{ buffer: png(caveatLine), filename: 'retry.png', contentType: 'image/png' }]);
  const failed = await down.createAudit(upOut.upload_id);
  await assert.rejects(() => down.runAudit(failed), /unreachable/);
  const rf = await pf.report(stub);
  assert.equal(rf.audit!.status, 'failed');
  assert.equal(rf.audit!.result.retryable, true);
  assert.match(rf.audit!.error!, /run the audit again/);
  await pf.runAudit(await pf.createAudit(upOut.upload_id));
  assert.equal((await pf.report(stub)).audit!.status, 'done');

  // Nothing imported from a laptop: the store has no rubric, persona seeds or voices; the audit gets the rubric from the live rules.
  assert.equal(await S.getStore().getInput('rubric'), null);
  assert.equal(await S.getStore().getInput('personas'), null);
  const seen: any[] = [];
  const spy = new Preflight((store as any).db, { ...mockEngine, run: async (i, p) => { seen.push(i.rubric); return mockEngine.run(i, p); } }, { storage: 'db' });
  await spy.runAudit(await spy.createAudit(upOut.upload_id));
  assert.ok(seen[0]?.items?.length, 'the rubric came from the rules file');
  assert.ok(S.personaSeed('OWN') && S.voiceSample('OWN'), 'the skeptic’s seed and voice come from the rules file');

  // An audit orphaned by a restart (no progress for STUCK_MINUTES) reads as failed and retryable, and Audit again works.
  const orphan = await pf.createAudit(upOut.upload_id);
  await (store as any).db.query(`UPDATE studio_audits SET status = 'running', heartbeat_at = NOW() - interval '11 minutes' WHERE id = $1`, [orphan]);
  const ro = await pf.report(stub);
  assert.equal(ro.audit!.id, orphan);
  assert.equal(ro.audit!.status, 'failed');
  assert.equal(ro.audit!.result.retryable, true);
  assert.match(ro.audit!.error!, /server restarted.*run the audit again/);
  const live = await pf.createAudit(upOut.upload_id);
  await (store as any).db.query(`UPDATE studio_audits SET status = 'running', heartbeat_at = NOW() - interval '1 minute' WHERE id = $1`, [live]);
  assert.equal((await pf.report(stub)).audit!.status, 'running', 'a long audit that is still reporting progress is left alone');
  await pf.runAudit(live);

  // 7. Over HTTP: a real multipart upload through the shared router.
  const express = (await import('express')).default;
  const { createStudioRouter } = await import('../src/services/studio/router.js');
  const app = express();
  app.use('/s', createStudioRouter({ who: () => 'nick', api: () => new S.Api({ mock: true }), mock: true, cap: 50, capWindow: 'month', askOver: 2, preflight: { service: pf, canSetReady: () => false } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/s`;
  try {
    const form = new FormData();
    form.append('files', new Blob([png(caveatLine)], { type: 'image/png' }), 'upload.png');
    const up = await fetch(`${base}/preflight/stubs/${stub}/uploads`, { method: 'POST', body: form });
    const body: any = await up.json();
    assert.equal(up.status, 200, JSON.stringify(body));
    assert.equal(body.kind, 'static');
    assert.ok(body.estimate.seconds > 0);
    const file = await fetch(`${base}/preflight/files/${body.upload_id}/0`);
    assert.ok(Buffer.compare(Buffer.from(await file.clone().arrayBuffer()), png(caveatLine)) === 0, 'uploaded through disk, stored and served byte for byte');
    assert.equal(file.headers.get('content-type'), 'image/png');
    const ready = await fetch(`${base}/preflight/stubs/${stub}/ready`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(ready.status, 403, 'only the creative lead or an admin sets Ready to traffic');
    assert.equal(((await (await fetch(`${base}/meta`)).json()) as any).preflight.enabled, true);
  } finally { server.close(); }
});
