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

/** Test ads as live versions: each primary text with one shared headline (Meta needs both), on visual A unless given. */
const adsOf = (primaryIds: string[], headId: string, visuals: Record<string, string> = {}) => primaryIds.map(id => ({ visual: visuals[id] || 'A', fields: { meta_primary: id, meta_headline: headId } }));
/** The primary line of a signed-off code. */
const primaryOf = (so: any, code: string) => so.versions.find((v: any) => v.code === code).fields.meta_primary;
const HEAD = { text: 'Calm, covered.', field: 'meta_headline' };

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
    { text: 'A second primary text, also post only.', field: 'meta_primary' },
  ] }), api, () => {}, { ownOnly: true, user: 'nick' });
  const [line, head, p1, p2] = run.lines;
  for (const l of run.lines) {
    await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
    for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find(x => x.id === l.id)!)) await R.overrideFlag(run.id, l.id, f.rule, 'Test line for Pre-flight', 'nick');
  }
  // Live versions: the TikTok hook on its own (A1 TT), and two Meta ads sharing the headline (A1, A2 META).
  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: [
    { visual: 'A', fields: { tiktok_hook: line.id } },
    { visual: 'A', fields: { meta_primary: p1.id, meta_headline: head.id } },
    { visual: 'A', fields: { meta_primary: p2.id, meta_headline: head.id } },
  ], expectation: { codes: ['OWN_CALM_UGC_A1_US_TT'], reason: 'The hook.' } }, 'nick');
  assert.deepEqual(signoff.versions!.map(v => v.code), ['OWN_CALM_UGC_A1_US_TT', 'OWN_CALM_UGC_A1_US_META', 'OWN_CALM_UGC_A2_US_META']);
  const stub = 'OWN_CALM_UGC_A1_US_TT', headlineStub = 'OWN_CALM_UGC_A1_US_META', postStub = 'OWN_CALM_UGC_A2_US_META';

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
  const pos1 = (await pf.report(stub)).upload!.files[0].position;   // size slot × 100 + card
  assert.ok(Buffer.compare((await pf.file(up1.upload_id, pos1)).data, bad) === 0, 'the file comes back byte for byte');
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
  assert.deepEqual(hand[0].slice(0, 2), ['Naming code', 'Region']);
  const ST = hand[0].indexOf('Status');
  assert.ok(ST > 0 && hand[0].includes('Sizes missing'));
  assert.equal(hand[0][2], 'Month');
  // Pre-flight passed isn't Ready to traffic until Trupanion's compliance is cleared (Brook, 30 Sep).
  assert.equal(hand.find(r => r[0] === stub)![ST], 'Pre-flight passed · Compliance pending');
  assert.equal(hand.find(r => r[0] === stub)![hand[0].indexOf('Ready to traffic')], 'no');
  assert.equal(hand.find(r => r[0] === postStub)![ST], 'Not uploaded');
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
  assert.equal(pr.post_copy[0].text, 'A second primary text, also post only.');
  assert.equal(hr.post_copy[0].text, 'Primary text that only runs in the post.');
  assert.ok(pr.audit!.result.copy_match.every((r: any) => r.status === 'match'), 'the shared headline matches for both codes');
  assert.equal((await pf.setReady(postStub, true, 'nick')).status, 'ready');
  assert.equal((await pf.report(headlineStub)).status.status, 'open', 'each code is marked on its own');
  assert.deepEqual(await pf.estimate(shared.upload_id), shared.estimate, 'the estimate is stored at upload and reused');
  // A shared visual is audited for one persona, so it can only serve codes of the same persona and territory.
  const other = new Preflight((store as any).db, mockEngine, { storage: 'db' });
  const realFind = (other as any).findStub.bind(other);
  (other as any).findStub = async (x: string) => x === postStub ? { ...(await realFind(x)), signoff: { ...(await realFind(x)).signoff, persona: 'DINK', territory: 'DINK_NEVER' } } : realFind(x);
  await assert.rejects(() => other.upload(headlineStub, [{ buffer: png('x'), filename: 'x.png', contentType: 'image/png' }], 'nick', [postStub]), /same persona and territory only/);
  const hand2 = S.parseCsv(await pf.handoffCsv());
  assert.equal(hand2.find(r => r[0] === postStub)![hand2[0].indexOf('Same visual as')], headlineStub, 'the handoff says which codes share the visual');

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
    const pos = (await pf.report(stub)).upload!.files[0].position;   // size slot × 100 + card
    const file = await fetch(`${base}/preflight/files/${body.upload_id}/${pos}`);
    assert.ok(Buffer.compare(Buffer.from(await file.clone().arrayBuffer()), png(caveatLine)) === 0, 'uploaded through disk, stored and served byte for byte');
    assert.equal(file.headers.get('content-type'), 'image/png');
    const ready = await fetch(`${base}/preflight/stubs/${stub}/ready`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(ready.status, 403, 'only the creative lead or an admin sets Ready to traffic');
    assert.equal(((await (await fetch(`${base}/meta`)).json()) as any).preflight.enabled, true);
  } finally { server.close(); }
});

test('Pre-flight by region: US and Canadian codes listed apart, same-visual codes share a key, a US visual never serves a Canadian code', { skip }, async () => {
  const { Preflight } = await import('../src/services/studio/preflight.js');
  const { mockEngine } = await import('../src/services/studio/preflightEngine.js');
  const R = await import('../src/services/studio/ready.js');
  const tables = ['studio_asset_status', 'studio_audit_agreements', 'studio_audit_flags', 'studio_audits', 'studio_upload_files', 'studio_asset_uploads', 'studio_expectations', 'studio_line_versions', 'studio_signoffs', 'studio_edits', 'studio_line_embeddings', 'studio_lines', 'studio_batches', 'studio_taste', 'studio_spend'];
  await (store as any).db.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  const api = new S.Api({ mock: true });
  const signOffRegion = async (region: 'US' | 'CA', texts: string[]) => {
    const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: `pf-${region}`, region, own_lines: [...texts.map(text => ({ text, field: 'meta_primary' })), HEAD] }), api, () => {}, { ownOnly: true, user: 'nick' });
    for (const l of run.lines) {
      await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
      for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find(x => x.id === l.id)!)) await R.overrideFlag(run.id, l.id, f.rule, 'Test line for regions', 'nick');
    }
    // Four ads: the fourth goes on visual B.
    const prims = run.lines.slice(0, -1).map(l => l.id), head = run.lines.at(-1)!.id;
    return (await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', region, versions: adsOf(prims, head, { [prims[3] ?? '-']: 'B' }), expectation: { codes: [`OWN_CALM_UGC_A1_${region}_META`], reason: 'The plain one.' } }, 'nick')).signoff;
  };
  await signOffRegion('US', ['Calm at the counter.', 'One less worry.', 'Home by nine.', 'Calm on a Sunday.']);
  await signOffRegion('CA', ['Calm at the counter, in colour.', 'Your favourite kind of calm.']);

  const pf = new Preflight((store as any).db, mockEngine, { storage: 'db' });
  const rows = await pf.stubs();
  assert.deepEqual(rows.map(r => `${r.stub} ${r.region}`).sort(), [
    'OWN_CALM_UGC_A1_CA_META CA', 'OWN_CALM_UGC_A1_US_META US', 'OWN_CALM_UGC_A2_CA_META CA', 'OWN_CALM_UGC_A2_US_META US', 'OWN_CALM_UGC_A3_US_META US', 'OWN_CALM_UGC_B1_US_META US',
  ]);
  const key = (s: string) => rows.find(r => r.stub === s)!.visual_key;
  assert.equal(key('OWN_CALM_UGC_A1_US_META'), key('OWN_CALM_UGC_A3_US_META'));
  assert.notEqual(key('OWN_CALM_UGC_A1_US_META'), key('OWN_CALM_UGC_B1_US_META'));
  assert.equal((await pf.stubs({ region: 'CA' })).length, 2);

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('fake image VOICES_TEXT: Calm at the counter.')]);
  const file = () => [{ buffer: png, filename: 'a.png', contentType: 'image/png' }];
  // One visual for A1-A3: fine. Canada is a separate visual: refused.
  const up = await pf.upload('OWN_CALM_UGC_A1_US_META', file(), 'nick', ['OWN_CALM_UGC_A2_US_META', 'OWN_CALM_UGC_A3_US_META']);
  assert.equal(up.stubs.length, 3);
  assert.equal(up.format_notes.some(n => /another visual/.test(n)), false);
  await assert.rejects(() => pf.upload('OWN_CALM_UGC_A1_US_META', file(), 'nick', ['OWN_CALM_UGC_A1_CA_META']), /US and Canadian ads are separate visuals/);
  // Sharing across letters is allowed, with a note; the codes stay as signed off.
  const across = await pf.upload('OWN_CALM_UGC_A1_US_META', file(), 'nick', ['OWN_CALM_UGC_B1_US_META']);
  assert.ok(across.format_notes.some(n => /OWN_CALM_UGC_B1_US_META was signed off on another visual/.test(n)));
  const rep = await pf.report('OWN_CALM_UGC_A1_CA_META');
  assert.equal(rep.region, 'CA');
  const hand = S.parseCsv(await pf.handoffCsv());
  assert.equal(hand.find(r => r[0] === 'OWN_CALM_UGC_A1_CA_META')![1], 'CA');
});

test('Compliance after Pre-flight: per asset, copy and visual together; changes go back to the copy or the visual; a new upload reopens it', { skip }, async () => {
  const { Preflight } = await import('../src/services/studio/preflight.js');
  const { mockEngine } = await import('../src/services/studio/preflightEngine.js');
  const R = await import('../src/services/studio/ready.js');
  const tables = ['studio_asset_status', 'studio_audit_agreements', 'studio_audit_flags', 'studio_audits', 'studio_upload_files', 'studio_asset_uploads', 'studio_expectations', 'studio_line_versions', 'studio_signoffs', 'studio_edits', 'studio_line_embeddings', 'studio_lines', 'studio_batches', 'studio_taste', 'studio_spend'];
  await (store as any).db.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  const api = new S.Api({ mock: true });
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'comp', own_lines: [
    { text: 'Calm at the counter.', field: 'meta_primary' }, { text: 'One less worry.', field: 'meta_primary' }, { text: 'Home by nine.', field: 'meta_primary' }, HEAD,
  ] }), api, () => {}, { ownOnly: true, user: 'nick' });
  for (const l of run.lines) {
    await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
    for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find(x => x.id === l.id)!)) await R.overrideFlag(run.id, l.id, f.rule, 'Test line for compliance', 'nick');
  }
  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: adsOf(run.lines.slice(0, 3).map(l => l.id), run.lines[3].id), expectation: { codes: ['OWN_CALM_UGC_A1_US_META'], reason: 'Plain.' } }, 'nick');
  const [A1, A2, A3] = signoff.versions!.map(v => v.code);
  // A status set per line on Ready before this step existed is still read (and not lost): here on A3's primary and the shared headline.
  await R.setCompliance(run.id, primaryOf(signoff, A3).line_id, 'cleared', 'Cleared by legal, 29 Sep (on Ready)', 'vivan');
  await R.setCompliance(run.id, run.lines[3].id, 'cleared', 'Cleared by legal, 29 Sep (on Ready)', 'vivan');

  const pf = new Preflight((store as any).db, mockEngine, { storage: 'db' });
  const png = (t: string) => [{ buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(`fake VOICES_TEXT: ${t}`)]), filename: 'v.png', contentType: 'image/png' }];
  const up = await pf.upload(A1, png('Calm at the counter.'), 'nick', [A2]);
  await pf.runAudit(await pf.createAudit(up.upload_id));

  let view = await pf.complianceAssets();
  assert.equal(view.assets.length, 1, 'one asset serving two codes');
  assert.deepEqual(view.assets[0].codes.map(c => c.stub), [A1, A2]);
  assert.equal(view.assets[0].status, 'pending');
  assert.deepEqual(view.waiting.map(w => w.stub), [A3]);
  assert.equal((await pf.codeCompliance(A3, null)).status, 'cleared', 'the per-line status from Ready is read');
  assert.equal((await pf.codeCompliance(A3, null)).on_asset, false);

  // Changes requested needs a note and says what goes back.
  // The decision is Trupanion's: who made it is required; the producer only records it.
  await assert.rejects(() => pf.setAssetCompliance(up.upload_id, { status: 'cleared', note: 'fine' }, 'vivan'), /who at Trupanion/);
  await assert.rejects(() => pf.setAssetCompliance(up.upload_id, { status: 'changes_requested', note: 'x', client_by: 'J. Doe' }, 'vivan'), /what goes back/);
  await assert.rejects(() => pf.setAssetCompliance(up.upload_id, { status: 'changes_requested', send_back: 'asset', client_by: 'J. Doe' }, 'vivan'), /what needs changing/);

  // Back to the visual: the codes stop being Ready to traffic, and Pre-flight shows the note.
  await pf.setReady(A1, true, 'nick').catch(() => {});
  await pf.setAssetCompliance(up.upload_id, { status: 'changes_requested', note: 'Disclaimer too small on the last card', send_back: 'asset', client_by: 'J. Doe (Trupanion legal)' }, 'vivan');
  view = await pf.complianceAssets();
  assert.equal(view.assets[0].status, 'changes_requested');
  assert.equal((await pf.report(A1)).status.status, 'open');
  const rep = await pf.report(A2);
  assert.equal(rep.compliance!.status, 'changes_requested');
  assert.equal(rep.compliance!.send_back, 'asset');
  assert.equal(rep.compliance!.note, 'Disclaimer too small on the last card');
  // The line carries it too (Ready shows it read-only).
  const line = (await S.loadBatch(run.id)).lines.find(l => l.id === primaryOf(signoff, A1).line_id)!;
  assert.equal(line.compliance_by_code![A1].upload_id, up.upload_id, 'recorded per code');

  // A new upload reopens the review: pending, with what happened before.
  const up2 = await pf.upload(A1, png('Calm at the counter.'), 'nick', [A2]);
  const c = await pf.codeCompliance(A1, up2.upload_id);
  assert.equal(c.status, 'pending');
  assert.match(c.note!, /New upload after "Changes requested": Disclaimer too small/);
  // Cleared (with a note, since the lines went through with overrides in this example).
  await pf.setAssetCompliance(up2.upload_id, { status: 'cleared', client_by: 'J. Doe (Trupanion legal)' }, 'vivan');
  assert.equal((await pf.complianceAssets()).assets[0].status, 'cleared');
  // The old upload can't be reviewed any more.
  await assert.rejects(() => pf.setAssetCompliance(up.upload_id, { status: 'cleared', client_by: 'J. Doe' }, 'vivan'), /replaced/);

  // Handoffs: per code (copy) and per asset.
  const hand = S.parseCsv(await pf.handoffCsv());
  const col = hand[0].indexOf('Compliance');
  assert.ok(col > 0);
  assert.equal(hand.find(r => r[0] === A1)![col], 'Cleared');
  assert.equal(hand.find(r => r[0] === A3)![col], 'Cleared');
  const copy = S.parseCsv((await R.handoffPack()).csv);
  const cc = copy[0].indexOf('Compliance status');
  assert.equal(copy.find(r => r[0] === A2)![cc], 'Cleared');
});

test('Ready to traffic needs Pre-flight passed AND compliance cleared, per code on a shared visual (Brook, 30 Sep)', { skip }, async () => {
  const { Preflight, COMPLIANCE_GATE_FROM } = await import('../src/services/studio/preflight.js');
  const { mockEngine } = await import('../src/services/studio/preflightEngine.js');
  const R = await import('../src/services/studio/ready.js');
  const tables = ['studio_asset_status', 'studio_audit_agreements', 'studio_audit_flags', 'studio_audits', 'studio_upload_files', 'studio_asset_uploads', 'studio_expectations', 'studio_line_versions', 'studio_signoffs', 'studio_edits', 'studio_line_embeddings', 'studio_lines', 'studio_batches', 'studio_taste', 'studio_spend'];
  await (store as any).db.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  const api = new S.Api({ mock: true });
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'gate', own_lines: [
    { text: 'Calm at the counter.', field: 'meta_primary' }, { text: 'One less worry.', field: 'meta_primary' }, { text: 'Home by nine.', field: 'meta_primary' }, HEAD,
  ] }), api, () => {}, { ownOnly: true, user: 'nick' });
  for (const l of run.lines) {
    await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
    for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find(x => x.id === l.id)!)) await R.overrideFlag(run.id, l.id, f.rule, 'Test line for the traffic gate', 'nick');
  }
  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: adsOf(run.lines.slice(0, 3).map(l => l.id), run.lines[3].id), expectation: { codes: ['OWN_CALM_UGC_A1_US_META'], reason: 'Plain.' } }, 'nick');
  const [A1, A2, A3] = signoff.versions!.map(v => v.code);
  const pf = new Preflight((store as any).db, mockEngine, { storage: 'db' });
  const png = () => [{ buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('fake VOICES_TEXT: Calm at the counter. One less worry. Home by nine.')]), filename: 'v.png', contentType: 'image/png' }];
  const up = await pf.upload(A1, png(), 'nick', [A2, A3]);
  await pf.runAudit(await pf.createAudit(up.upload_id));
  for (const x of [A1, A2, A3]) await pf.setReady(x, true, 'nick');
  const t = async (x: string) => pf.traffic(x);

  // Pre-flight passed alone isn't Ready to traffic; the two parts are shown apart.
  assert.equal((await t(A1)).ready, false);
  assert.equal((await t(A1)).words, 'Pre-flight passed · Compliance pending');

  // Per code on one shared upload: A1 and A2 cleared, A3's copy sent back.
  await pf.setAssetCompliance(up.upload_id, { status: 'cleared', codes: [A1, A2], client_by: 'J. Doe (Trupanion legal)' }, 'vivan');
  await pf.setAssetCompliance(up.upload_id, { status: 'changes_requested', codes: [A3], send_back: 'copy', note: 'Say "at participating hospitals"', client_by: 'J. Doe (Trupanion legal)' }, 'vivan');
  assert.equal((await t(A1)).ready, true);
  assert.equal((await t(A1)).words, 'Ready to traffic');
  assert.equal((await t(A2)).ready, true);
  const a3 = await t(A3);
  assert.equal(a3.ready, false);
  assert.equal(a3.words, 'Pre-flight passed · Compliance changes requested');
  assert.match(a3.blocker!, /changes to the copy/);
  // Who at Trupanion decided is on the record; the producer only recorded it.
  const c1 = await pf.codeCompliance(A1, up.upload_id);
  assert.equal(c1.client_by, 'J. Doe (Trupanion legal)');
  assert.equal(c1.by, 'vivan');
  // The page groups the asset under "changes requested" while showing each code's own status.
  const asset = (await pf.complianceAssets()).assets[0];
  assert.equal(asset.status, 'changes_requested');
  assert.deepEqual(asset.codes.map(c => [c.stub, c.compliance.status, c.traffic.ready]), [[A1, 'cleared', true], [A2, 'cleared', true], [A3, 'changes_requested', false]]);
  // A code not on this upload any more is refused by name.
  await assert.rejects(() => pf.setAssetCompliance(up.upload_id, { status: 'cleared', codes: ['OWN_CALM_UGC_Z9_US_META'], client_by: 'x' }, 'vivan'), /Not on this upload now/);

  // Add3 only sees cleared codes marked ready: both handoffs.
  const hand = S.parseCsv(await pf.handoffCsv());
  const rt = hand[0].indexOf('Ready to traffic');
  assert.deepEqual([A1, A2, A3].map(x => hand.find(r => r[0] === x)![rt]), ['yes', 'yes', 'no']);
  assert.equal(hand.find(r => r[0] === A1)![hand[0].indexOf('Cleared at Trupanion by')], 'J. Doe (Trupanion legal)');
  const pack = S.parseCsv((await R.handoffPack({}, x => pf.traffic(x))).csv);
  const pr = pack[0].indexOf('Ready to traffic');
  assert.deepEqual([A1, A2, A3].map(x => pack.find(r => r[0] === x)![pr]), ['Ready to traffic', 'Ready to traffic', 'Pre-flight passed · Compliance changes requested']);

  // Edited wording takes a code out of Ready to traffic until it's signed off (and reviewed) again.
  const l2 = primaryOf(signoff, A2);
  await S.setDecision(l2.batch_id, l2.line_id, { decision: 'edit', edited_text: 'One less worry, every time.' }, 'nick');
  assert.equal((await t(A2)).ready, false);
  assert.match((await t(A2)).words, /Wording edited since sign-off/);

  // A new upload takes everything out: Pre-flight is open again and compliance is pending on the new asset.
  const up2 = await pf.upload(A1, png(), 'nick', [A2, A3]);
  assert.equal((await t(A1)).ready, false);
  assert.equal((await t(A1)).words, 'Pre-flight open · Compliance pending');
  void up2;

  // Marked ready before the gate, with no compliance recorded: stays ready, and says so.
  const run2 = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'legacy', own_lines: [{ text: 'Calm on a Sunday.', field: 'meta_primary' }, { text: 'Sunday, covered.', field: 'meta_headline' }] }), api, () => {}, { ownOnly: true, user: 'nick' });
  for (const x of run2.lines) {
    await S.setDecision(run2.id, x.id, { decision: 'keep' }, 'nick');
    for (const f of R.unresolvedRed((await S.loadBatch(run2.id)).lines.find(y => y.id === x.id)!)) await R.overrideFlag(run2.id, x.id, f.rule, 'Test line for the traffic gate', 'nick');
  }
  // The same persona × territory × region: this set replaces A1–A3 (its version is a new ad, so it gets A4).
  const legacyCode = (await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: adsOf([run2.lines[0].id], run2.lines[1].id), expectation: { codes: ['OWN_CALM_UGC_A4_US_META'], reason: 'Old.' } }, 'nick')).signoff.versions![0].code;
  const up3 = await pf.upload(legacyCode, png(), 'nick');
  await pf.runAudit(await pf.createAudit(up3.upload_id));
  await pf.setReady(legacyCode, true, 'nick');
  await (store as any).db.query(`UPDATE studio_asset_status SET ready_at = $2 WHERE stub = $1`, [legacyCode, new Date(Date.parse(COMPLIANCE_GATE_FROM) - 86400000)]);
  const legacy = await t(legacyCode);
  assert.equal(legacy.ready, true);
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.words, 'Ready to traffic · compliance not recorded');
  // Once a decision is recorded, the gate applies.
  await pf.setAssetCompliance(up3.upload_id, { status: 'changes_requested', send_back: 'copy', note: 'Check the claim', client_by: 'J. Doe' }, 'vivan');
  assert.equal((await t(legacyCode)).ready, false);
});

test('clearing a code that went through with an overridden red flag needs a note saying what Trupanion accepted (copy or Pre-flight)', { skip }, async () => {
  const { Preflight } = await import('../src/services/studio/preflight.js');
  const { mockEngine } = await import('../src/services/studio/preflightEngine.js');
  const R = await import('../src/services/studio/ready.js');
  const tables = ['studio_asset_status', 'studio_audit_agreements', 'studio_audit_flags', 'studio_audits', 'studio_upload_files', 'studio_asset_uploads', 'studio_expectations', 'studio_line_versions', 'studio_signoffs', 'studio_edits', 'studio_line_embeddings', 'studio_lines', 'studio_batches', 'studio_taste', 'studio_spend'];
  await (store as any).db.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  const api = new S.Api({ mock: true });
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'accepted', own_lines: [
    { text: 'Calm at the counter.', field: 'meta_primary' }, { text: 'Home by nine.', field: 'meta_primary' }, { text: 'Honestly, the policy pays for itself.', field: 'meta_primary' }, HEAD,
  ] }), api, () => {}, { ownOnly: true, user: 'nick' });
  const risky = run.lines[2];
  for (const l of run.lines) {
    await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
    const reds = R.unresolvedRed((await S.loadBatch(run.id)).lines.find(x => x.id === l.id)!);
    if (l.id !== risky.id) { assert.equal(reds.length, 0, `${l.text} should have no red flag`); continue; }
    assert.ok(reds.some(f => f.rule === 'COMP_PAYS_FOR_ITSELF'));
    for (const f of reds) await R.overrideFlag(run.id, l.id, f.rule, 'Legal agreed the framing for this test', 'nick');
  }
  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: adsOf(run.lines.slice(0, 3).map(l => l.id), run.lines[3].id), expectation: { codes: ['OWN_CALM_UGC_A1_US_META'], reason: 'Plain.' } }, 'nick');
  const [A1, A2, A3] = signoff.versions!.map(v => v.code);
  const pf = new Preflight((store as any).db, mockEngine, { storage: 'db' });
  const png = (t: string) => [{ buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(`fake VOICES_TEXT: ${t}`)]), filename: 'v.png', contentType: 'image/png' }];

  // 1. A copy override at Ready, on A3 only.
  const up = await pf.upload(A1, png('Calm at the counter.'), 'nick', [A2, A3]);
  await pf.runAudit(await pf.createAudit(up.upload_id));
  assert.deepEqual((await pf.overriddenReds(up.upload_id, [A1, A2])), []);
  // A1 and A2 have nothing overridden: cleared with just the reviewer's name.
  await pf.setAssetCompliance(up.upload_id, { status: 'cleared', codes: [A1, A2], client_by: 'J. Doe (Trupanion legal)' }, 'vivan');
  // A3 went through with an overridden red flag: refused without a note, naming it.
  await assert.rejects(() => pf.setAssetCompliance(up.upload_id, { status: 'cleared', codes: [A3], client_by: 'J. Doe (Trupanion legal)' }, 'vivan'), (err: any) => {
    assert.match(err.message, /overridden red flag .*pays for itself.*add a note saying what Trupanion accepted/i);
    assert.deepEqual(err.overridden.map((x: any) => [x.code, x.where]), [[A3, 'copy']]);
    return true;
  });
  // Clearing every code at once is refused too (A3 is among them).
  await assert.rejects(() => pf.setAssetCompliance(up.upload_id, { status: 'cleared', client_by: 'J. Doe' }, 'vivan'), /what Trupanion accepted/);
  // Changes requested and pending don't need it.
  await pf.setAssetCompliance(up.upload_id, { status: 'pending', codes: [A3] }, 'vivan');
  await pf.setAssetCompliance(up.upload_id, { status: 'cleared', codes: [A3], client_by: 'J. Doe (Trupanion legal)', note: 'Trupanion legal accepted the "pays for itself" framing for this ad' }, 'vivan');
  assert.equal((await pf.codeCompliance(A3, up.upload_id)).status, 'cleared');

  // 2. A Pre-flight override on the visual concerns every code it serves.
  const up2 = await pf.upload(A1, png('Honestly, it pays for itself.'), 'nick', [A2, A3]);
  await pf.runAudit(await pf.createAudit(up2.upload_id));
  const red = (await pf.report(A1)).flags.find((f: any) => f.severity === 'red' && f.rule === 'COMP_PAYS_FOR_ITSELF')!;
  assert.ok(red, 'the visual carries a red flag');
  await pf.override(red.id, 'Creative lead: the visual line is the approved campaign line', 'nick');
  const acc = await pf.overriddenReds(up2.upload_id, [A1]);
  assert.deepEqual(acc.map(x => [x.code, x.where]), [[A1, 'pre-flight']]);
  await assert.rejects(() => pf.setAssetCompliance(up2.upload_id, { status: 'cleared', codes: [A1], client_by: 'J. Doe' }, 'vivan'), /what Trupanion accepted/);
  await pf.setAssetCompliance(up2.upload_id, { status: 'cleared', codes: [A1], client_by: 'J. Doe', note: 'Accepted the visual line as the approved campaign line' }, 'vivan');
  assert.equal((await pf.codeCompliance(A1, up2.upload_id)).note, 'Accepted the visual line as the approved campaign line');
});

// ---------- two people at once (two-user test, 30 Sep): items 1–5 ----------

async function freshStudio() {
  const tables = ['studio_asset_status', 'studio_audit_agreements', 'studio_audit_flags', 'studio_audits', 'studio_upload_files', 'studio_asset_uploads', 'studio_expectations', 'studio_line_versions', 'studio_signoffs', 'studio_edits', 'studio_line_embeddings', 'studio_lines', 'studio_batches', 'studio_taste', 'studio_spend'];
  await (store as any).db.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  const R = await import('../src/services/studio/ready.js');
  const api = new S.Api({ mock: true });
  return { R, api };
}
async function keptRun(R: any, api: S.Api, texts: string[], opts: { region?: 'US' | 'CA'; name?: string } = {}) {
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: opts.name || `c-${Date.now()}`, region: opts.region, own_lines: [...texts.map(text => ({ text, field: 'meta_primary' })), HEAD] }), api, () => {}, { ownOnly: true, user: 'nick' });
  for (const l of run.lines) {
    await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
    for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find((x: any) => x.id === l.id)!)) await R.overrideFlag(run.id, l.id, f.rule, 'Test line for concurrency', 'nick');
  }
  // The last line is the shared headline; the rest are primary texts (one ad each).
  return Object.assign(run, { prims: run.lines.slice(0, -1).map(l => l.id), head: run.lines.at(-1)!.id });
}
/** The code the first version of a set would get, for the expectation. */
async function leadOf(R: any, versions: any[], region = 'US') {
  return (await R.readyView('OWN', 'OWN_CALM', region, { versions, on_image: {} }, { user: 'nick' })).plan.versions[0].code;
}
/** Every history entry's `before` is the previous entry's `after` (for entries that carry the same keys). */
async function chained(lineId: string, key: string) {
  const h = ((await (store as any).db.query(`SELECT before, after FROM studio_edits WHERE line_id = $1 ORDER BY id`, [lineId])).rows as any[]).filter(x => x.after && key in x.after && x.before && key in x.before);
  let broken = 0;
  for (let i = 1; i < h.length; i++) if (JSON.stringify(h[i].before) !== JSON.stringify(h[i - 1].after)) broken++;
  return { entries: h.length, broken };
}

test('1. two people deciding on the same line: applied one after the other, history chains, nothing lost', { skip }, async () => {
  const { R, api } = await freshStudio();
  const run = await keptRun(R, api, ['Calm at the counter.', 'Home by nine.']);
  const id = run.lines[0].id;
  for (let k = 0; k < 20; k++) {
    await Promise.all([
      S.setDecision(run.id, id, { decision: 'edit', edited_text: `N${k}` }, 'nick'),
      S.setDecision(run.id, id, { decision: 'cut', note: `B${k}` }, 'brook'),
    ]);
    const row = (await (store as any).db.query(`SELECT decision, decided_by, body FROM studio_lines WHERE id = $1`, [id])).rows[0];
    const last = (await (store as any).db.query(`SELECT after, by_user FROM studio_edits WHERE line_id = $1 ORDER BY id DESC LIMIT 1`, [id])).rows[0];
    assert.equal(row.decision, last.after.decision, `round ${k}: stored decision is the last one recorded`);
    assert.equal(row.decided_by, last.by_user);
    assert.equal(row.body.decided_by, row.decided_by, 'column and body agree');
  }
  const c = await chained(id, 'decision');
  assert.equal(c.broken, 0, `history chains (${c.entries} entries)`);
});

test('1b. a compliance status and an edit on the same line at once: both kept', { skip }, async () => {
  const { R, api } = await freshStudio();
  const run = await keptRun(R, api, ['Calm at the counter.']);
  const id = run.lines[0].id;
  for (let k = 0; k < 20; k++) {
    await Promise.all([
      R.setCompliance(run.id, id, k % 2 ? 'cleared' : 'pending', `vivan ${k}`, 'vivan'),
      S.setDecision(run.id, id, { decision: 'edit', edited_text: `Nick edit ${k}.` }, 'nick'),
    ]);
    const b = (await (store as any).db.query(`SELECT body FROM studio_lines WHERE id = $1`, [id])).rows[0].body;
    assert.equal(b.edited_text, `Nick edit ${k}.`, `round ${k}: the edit is kept`);
    assert.equal(b.compliance.note, `vivan ${k}`, `round ${k}: the status is kept`);
  }
});

test('2. two people adding a line to one run at once: both lines kept, each with its own id and author', { skip }, async () => {
  const { R, api } = await freshStudio();
  const run = await keptRun(R, api, ['Calm at the counter.']);
  const brief = (text: string) => S.makeBrief({ ...run.brief, own_lines: [{ text, field: 'meta_headline' }] });
  for (let k = 0; k < 5; k++) {
    await Promise.all([
      S.generate(brief(`Nick's idea ${k}.`), api, () => {}, { batchId: run.id, ownOnly: true, user: 'nick' }),
      S.generate(brief(`Brook's idea ${k}.`), api, () => {}, { batchId: run.id, ownOnly: true, user: 'brook' }),
    ]);
  }
  const lines = (await S.loadBatch(run.id)).lines;
  assert.equal(lines.length, 12, 'two own lines, then ten added');
  assert.equal(new Set(lines.map(l => l.id)).size, 12, 'ids are unique');
  for (let k = 0; k < 5; k++) {
    const n = lines.find(l => l.text === `Nick's idea ${k}.`)!, b = lines.find(l => l.text === `Brook's idea ${k}.`)!;
    assert.ok(n && b, `round ${k}: both lines are there`);
    assert.equal(n.added_by, 'nick'); assert.equal(b.added_by, 'brook');
    assert.equal(n.status, 'checked'); assert.equal(b.status, 'checked');
    const h = await S.lineHistory(b.id);
    assert.deepEqual([h[0].by, (h[0].after as any).added], ['brook', true]);
  }
  assert.equal((await S.loadBatch(run.id)).brief.own_lines!.length, 12, 'the run keeps every line written on it');
});

test('3. a Shortlist cut racing a sign-off: a line is never both cut and signed off', { skip }, async () => {
  const { R, api } = await freshStudio();
  for (let k = 0; k < 6; k++) {
    const run = await keptRun(R, api, ['Calm at the counter.', 'Home by nine.', 'One less worry.'], { name: `race-${k}` });
    const ids = run.prims;
    const victim = ids[1 + (k % 2)];
    const ads = adsOf(ids, run.head);
    const lead = await leadOf(R, ads);
    const [so, cut] = await Promise.allSettled([
      R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: ads, expectation: { codes: [lead], reason: 'race' } }, 'nick'),
      new Promise(r => setTimeout(r, k)).then(() => S.setDecision(run.id, victim, { decision: 'cut', source: 'shortlist' }, 'brook')),
    ]);
    const line = (await S.loadBatch(run.id)).lines.find(l => l.id === victim)!;
    const signed = so.status === 'fulfilled' && so.value.signoff.versions.some((v: any) => v.fields.meta_primary.line_id === victim);
    assert.ok(!(line.decision === 'cut' && signed), `round ${k}: cut ${cut.status}, sign-off ${so.status}`);
    assert.ok(so.status === 'fulfilled' || cut.status === 'fulfilled', 'one of them goes through');
    if (cut.status === 'rejected') assert.match(String((cut as any).reason?.message), /Signed off at Ready/);
    if (so.status === 'rejected') assert.match(String((so as any).reason?.message), /Not kept lines/);
    // The next round's sign-off would supersede this one's lines; clear signoffs between rounds.
    await (store as any).db.query(`TRUNCATE studio_expectations, studio_line_versions, studio_signoffs`);
  }
});

test('4. racing sign-offs: one wins, the other gets a clear 409; one version count, no orphans, codes unique; US and CA both go through', { skip }, async () => {
  const { R, api } = await freshStudio();
  const run = await keptRun(R, api, ['Calm at the counter.', 'Home by nine.', 'One less worry.', 'Sunday calm.']);
  const ids = run.prims;
  const lead = await leadOf(R, adsOf(ids.slice(0, 1), run.head));
  const so = (who: string, set: string[]) => R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: adsOf(set, run.head), expectation: { codes: [lead], reason: who }, expect_latest: null }, who);
  const [a, b] = await Promise.allSettled([so('nick', ids.slice(0, 3)), so('brook', ids.slice(1, 4))]);
  const ok = [a, b].filter(x => x.status === 'fulfilled'), no = [a, b].filter(x => x.status === 'rejected') as PromiseRejectedResult[];
  assert.equal(ok.length, 1, 'one wins');
  assert.equal(no[0].reason.status, 409);
  assert.match(no[0].reason.message, /(nick|brook) just signed this set off \(v1/);
  // Without expect_latest (a script, not the page), the loser's codes move on: a clear 409, not "must be among the versions".
  const late = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: adsOf(ids.slice(2, 4), run.head), expectation: { codes: [lead], reason: 'late' } }, 'nick').catch((e: any) => e);
  assert.equal(late.status, 409);
  assert.match(late.message, /The codes changed since the screen loaded \((nick|brook) signed off v1\)/);
  const db = (store as any).db;
  assert.equal(Number((await db.query(`SELECT count(*) FROM studio_line_versions v WHERE v.signoff_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM studio_signoffs s WHERE s.id = v.signoff_id)`)).rows[0].count), 0, 'no orphan line versions');
  const fieldsOfCode = new Map<string, Set<string>>();
  for (const s of await S.getStore().listSignoffs() as any[]) for (const v of s.versions || []) {
    const m = fieldsOfCode.get(v.code) || new Set<string>();
    m.add(JSON.stringify(Object.fromEntries(Object.entries(v.fields).map(([f, x]: any) => [f, x.line_id]))));
    fieldsOfCode.set(v.code, m);
  }
  assert.ok([...fieldsOfCode.values()].every(m => m.size === 1), 'codes unique: one ad per code');

  // US and CA of the same persona × territory at once: both go through, each with its own version number.
  const ca = await keptRun(R, api, ['Calm, eh.', 'Colour me calm.'], { region: 'CA', name: 'ca' });
  const won = (ok[0] as any).value.signoff.versions.map((v: any) => v.fields.meta_primary.line_id);
  const usAds = adsOf([...won, ...ids.filter(x => !won.includes(x))], run.head), caAds = adsOf(ca.prims, ca.head);
  const [usLead, caLead] = [await leadOf(R, usAds), await leadOf(R, caAds, 'CA')];
  const [u, c] = await Promise.all([
    R.signOff({ persona: 'OWN', territory: 'OWN_CALM', region: 'US', versions: usAds, expectation: { codes: [usLead], reason: 'us' } }, 'nick'),
    R.signOff({ persona: 'OWN', territory: 'OWN_CALM', region: 'CA', versions: caAds, expectation: { codes: [caLead], reason: 'ca' } }, 'brook'),
  ]);
  assert.deepEqual([u.signoff.version, c.signoff.version].sort(), [2, 3]);

  // A later set that leaves a line out: the line no longer shows as signed off, keeps its code, and can be cut again.
  const one = adsOf([ids[0]], run.head);
  const shrink = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', region: 'US', versions: one, expectation: { codes: [await leadOf(R, one)], reason: 'just one' } }, 'nick');
  const code = u.signoff.versions.find((v: any) => v.fields.meta_primary.line_id === ids[1])!.code;
  assert.equal(shrink.signoff.versions[0].code, u.signoff.versions.find((v: any) => v.fields.meta_primary.line_id === ids[0])!.code, 'the ad that stays keeps its code');
  const left = (await S.loadBatch(run.id)).lines.find(l => l.id === ids[1])!;
  assert.equal(left.ready!.superseded_by, shrink.signoff.id);
  assert.equal((await S.shortlist()).find(r => r.id === ids[1])!.signed_off, '');
  assert.equal(left.ready!.stub, code, 'the line left out keeps the code it went out under');
  await S.setDecision(run.id, ids[1], { decision: 'cut', source: 'shortlist' }, 'brook');
});

test('5. taste: people deciding on different lines at once never lose each other’s examples; each records who', { skip }, async () => {
  const { R, api } = await freshStudio();
  const run = await keptRun(R, api, ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.']);
  for (let k = 0; k < 10; k++) {
    const dec = k % 2 ? 'keep' : 'cut';
    await Promise.all(run.lines.map((l, j) => S.setDecision(run.id, l.id, { decision: dec as any, note: '' }, j % 2 ? 'brook' : 'nick')));
    const t = new Map((await S.loadTaste()).map(x => [x.id, x]));
    for (const [j, l] of run.lines.entries()) {
      assert.equal(t.has(l.id), dec === 'keep', `round ${k}: ${l.id}`);
      if (dec === 'keep') assert.equal(t.get(l.id)!.by, j % 2 ? 'brook' : 'nick');
    }
  }
});

test('8. an edit after sign-off: Ready and Compliance show it as needing review, not "cleared"', { skip }, async () => {
  const { R, api } = await freshStudio();
  const run = await keptRun(R, api, ['Calm at the counter.']);
  const l = run.lines[0];
  const ads = adsOf([l.id], run.head);
  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: ads, expectation: { codes: [await leadOf(R, ads)], reason: 'x' } }, 'nick');
  const code = signoff.versions[0].code;
  for (const id of [l.id, run.head]) await R.setCompliance(run.id, id, 'cleared', 'fine', 'vivan');
  assert.equal((await R.readyView('OWN', 'OWN_CALM')).plan.versions[0].compliance.status, 'cleared');
  await S.setDecision(run.id, l.id, { decision: 'edit', edited_text: 'Calm at the counter, every time.' }, 'nick');
  const v = { stub: code, compliance: (await R.readyView('OWN', 'OWN_CALM')).plan.versions[0].compliance };
  assert.equal(v.compliance.status, 'pending');
  assert.match(v.compliance.note!, /Edited since/);
  const { Preflight } = await import('../src/services/studio/preflight.js');
  const { mockEngine } = await import('../src/services/studio/preflightEngine.js');
  const pf = new Preflight((store as any).db, mockEngine, { storage: 'db' });
  const c = await pf.codeCompliance(v.stub, null);
  assert.equal(c.status, 'pending');
  assert.equal(c.stale, 'Wording edited since sign-off');
});

// ---------- live versions end to end (Brook, 30 Sep): one code = one ad ----------

test('live versions: A1–A3 share a headline and visual A has on-image text → one shared upload, on-image matched on all three, compliance per code, handoff one row per code', { skip }, async () => {
  const { R, api } = await freshStudio();
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  rules.fields.meta_on_image = { platform: 'META', label: 'On-image text', visible: 40, max: 60, source: 'HOUSE: test' };
  await store.putRules('example-onimage', rules, { activate: true, by: 'test' });
  await S.refreshRules();
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'live', own_lines: [
    { text: 'Calm at the counter.', field: 'meta_primary' }, { text: 'One less worry on a Sunday.', field: 'meta_primary' }, { text: 'Home by nine, bill sorted.', field: 'meta_primary' },
    HEAD, { text: 'Vet visits, calmer', field: 'meta_on_image' },
  ] }), api, () => {}, { ownOnly: true, user: 'nick' });
  for (const l of run.lines) {
    await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
    for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find(x => x.id === l.id)!)) await R.overrideFlag(run.id, l.id, f.rule, 'Test line', 'nick');
  }
  const [p1, p2, p3, head, img] = run.lines.map(l => l.id);

  // Ready's default: three primaries paired with the one headline on visual A, the on-image line on A.
  const dv = await R.readyView('OWN', 'OWN_CALM');
  assert.deepEqual(dv.draft.versions.map((v: any) => [v.visual, v.fields.meta_primary, v.fields.meta_headline]), [['A', p1, head], ['A', p2, head], ['A', p3, head]]);
  assert.deepEqual(dv.draft.on_image, { A: img });
  assert.deepEqual(dv.plan.versions.map((v: any) => v.code), ['OWN_CALM_UGC_A1_US_META', 'OWN_CALM_UGC_A2_US_META', 'OWN_CALM_UGC_A3_US_META']);
  assert.equal(dv.lines.find((x: any) => x.line.id === head)!.in.length, 3, 'the headline is in all three');

  // An incomplete version is refused, and says what it needs.
  await assert.rejects(() => R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: [{ visual: 'A', fields: { meta_primary: p1 } }], expectation: { codes: ['OWN_CALM_UGC_A1_US_META'], reason: 'x' } }, 'nick'),
    (e: any) => e instanceof R.DraftError && /needs headline/.test(e.message));

  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions: dv.draft.versions, on_image: dv.draft.on_image, expectation: { codes: ['OWN_CALM_UGC_A2_US_META'], reason: 'The Sunday one.' } }, 'nick');
  const [A1, A2, A3] = signoff.versions!.map(v => v.code);
  assert.equal(signoff.on_image![0].visual_key, 'OWN_CALM_UGC_A_US_META');
  // Each version stores its lines, fields and per-field hash.
  assert.ok(signoff.versions!.every(v => v.fields.meta_headline.line_id === head && /^[0-9a-f]{64}$/.test(v.fields.meta_primary.sha256)));

  // Pre-flight: one upload for the visual serves all three codes; the on-image text is on every one of them (must be on the asset).
  const { Preflight } = await import('../src/services/studio/preflight.js');
  const { mockEngine } = await import('../src/services/studio/preflightEngine.js');
  const pf = new Preflight((store as any).db, mockEngine, { storage: 'db' });
  const rows = await pf.stubs({ persona: 'OWN' });
  assert.deepEqual(rows.map(r => r.stub), [A1, A2, A3]);
  assert.ok(rows.every(r => r.copy.some(c => c.field === 'meta_on_image' && c.text === 'Vet visits, calmer')), 'on-image copy on every code of the visual');
  assert.equal(new Set(rows.map(r => r.visual_key)).size, 1, 'same visual: one upload suggested');
  const png = (t: string) => [{ buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(`fake VOICES_TEXT: ${t}`)]), filename: 'a.png', contentType: 'image/png' }];
  const up = await pf.upload(A1, png('Vet visits, calmer. Calm, covered.'), 'nick', [A2, A3]);
  assert.deepEqual(up.stubs.sort(), [A1, A2, A3]);
  await pf.runAudit(await pf.createAudit(up.upload_id));
  for (const code of [A1, A2, A3]) {
    const rep = await pf.report(code);
    const oi = rep.audit!.result.copy_match.find((r: any) => r.field === 'on_image');
    assert.ok(oi, `${code}: on-image text is matched`);
    assert.deepEqual([oi.status, oi.signed_off], ['match', 'Vet visits, calmer']);
    assert.equal(rep.flags.some((f: any) => f.check === 'copy_match'), false);
    assert.ok(rep.post_copy.some((c: any) => c.field === 'meta_primary'), 'primary text is post copy, never compared with the asset');
  }
  // Without the on-image text on the visual: every code on it gets the copy-match flag.
  const up2 = await pf.upload(A1, png('Calm, covered.'), 'nick', [A2, A3]);
  await pf.runAudit(await pf.createAudit(up2.upload_id));
  for (const code of [A1, A2, A3]) assert.ok((await pf.report(code)).flags.some((f: any) => f.check === 'copy_match'), `${code}: missing on-image text flagged`);
  const up3 = await pf.upload(A1, png('Vet visits, calmer. Calm, covered.'), 'nick', [A2, A3]);
  await pf.runAudit(await pf.createAudit(up3.upload_id));

  // Compliance: one asset, the on-image text shown once; decided per code.
  const cv = await pf.complianceAssets();
  assert.equal(cv.assets.length, 1);
  assert.deepEqual(cv.assets[0].codes.map((c: any) => c.stub), [A1, A2, A3]);
  await pf.setAssetCompliance(up3.upload_id, { status: 'cleared', codes: [A1, A2], client_by: 'J. Doe (Trupanion legal)', note: 'Fine' }, 'vivan');
  await pf.setAssetCompliance(up3.upload_id, { status: 'changes_requested', codes: [A3], send_back: 'copy', note: 'Primary text too strong', client_by: 'J. Doe (Trupanion legal)' }, 'vivan');
  assert.deepEqual(await Promise.all([A1, A2, A3].map(async c => (await pf.codeCompliance(c, up3.upload_id)).status)), ['cleared', 'cleared', 'changes_requested']);
  const headLine = (await S.loadBatch(run.id)).lines.find(l => l.id === head)!;
  assert.deepEqual(Object.keys(headLine.compliance_by_code || {}).sort(), [A1, A2, A3], 'the shared headline has a status per code');

  // Handoff: one row per code, a column per field, the visual's on-image text repeated on each row.
  const pack = await R.handoffPack();
  const csv = S.parseCsv(pack.csv);
  const h = csv[0];
  for (const c of ['Meta primary text', 'Meta headline', 'On-image text (the visual)']) assert.ok(h.includes(c), c);
  const body = csv.slice(1).filter(r => r[0].startsWith('OWN_CALM_UGC_A'));
  assert.deepEqual(body.map(r => r[0]), [A1, A2, A3]);
  assert.ok(body.every(r => r[h.indexOf('Meta headline')] === 'Calm, covered.' && r[h.indexOf('On-image text (the visual)')] === 'Vet visits, calmer'));
  assert.deepEqual(body.map(r => r[h.indexOf('Compliance status')]), ['Cleared', 'Cleared', 'Changes requested']);
  assert.match(pack.md, /### Visual A \(Meta\)[\s\S]*Vet visits, calmer/);
  const comp = S.parseCsv(pack.complianceCsv);
  assert.deepEqual(comp.filter(r => r[0]?.startsWith('OWN_CALM_UGC_A')).map(r => r[0]), [A1, A2, A3], 'compliance sheet: one row per code');
  assert.ok(comp[0].includes('On-image text (the visual)'));
  await store.putRules('example-1', { ...rules, fields: { ...rules.fields, meta_on_image: undefined } }, { activate: true, by: 'test' }).catch(() => {});
});

test('Postgres: leftover reservations older than 2 hours are cleared, newer ones and real spend stay', { skip }, async () => {
  await freshStudio();
  const { clearStaleReservations } = await import('../src/services/studio/router.js');
  const old = new Date(Date.now() - 3 * 3600_000).toISOString(), recent = new Date(Date.now() - 600_000).toISOString();
  await store.addSpend({ label: 'reserved: preflight x 1-a', usd: 0.5, at: old, user: 'nick' });
  await store.addSpend({ label: 'reserved: preflight x 2-b', usd: 0.4, at: recent, user: 'nick' });
  await store.addSpend({ label: 'preflight x', usd: 0.3, at: old, user: 'nick' });
  const logs: string[] = [];
  assert.equal(await clearStaleReservations(m => logs.push(m)), 1);
  assert.match(logs[0], /reserved: preflight x 1-a/);
  assert.deepEqual((await store.listSpend()).map(x => x.label).sort(), ['preflight x', 'reserved: preflight x 2-b']);
});

// ---------- carousel cards (item E, 30 Sep) ----------

test('carousel: a 4-card visual with A1–A3 → sign-off → Pre-flight card by card (in order passes, swapped amber, missing red) → handoff; a caveat-carrying headline is post copy', { skip }, async () => {
  const { R, api } = await freshStudio();
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  rules.fields.meta_on_image = { platform: 'META', label: 'On-image text', visible: 40, max: 60, source: 'HOUSE: test', in_version: 'per_visual' };
  rules.territories.OWN_CARDS = { ...rules.territories.OWN_CALM, name: 'Calm, card by card', format: 'CAROUSEL' };
  await store.putRules('example-carousel', rules, { activate: true, by: 'test' });
  await S.refreshRules();
  const CARDS = ['Vet bill at 2am?', 'You pay the vet as normal', 'We sort the rest', 'Calm, covered.'];
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CARDS', name: 'car', own_lines: [
    { text: 'Calm at the counter.', field: 'meta_primary' }, { text: 'One less worry on a Sunday.', field: 'meta_primary' }, { text: 'Home by nine, bill sorted.', field: 'meta_primary' },
    // The headline carries the direct-pay caveat; it isn't on the image, and that's fine now (post copy).
    { text: 'Paid at checkout, at partner clinics.', field: 'meta_headline' },
    ...CARDS.map(text => ({ text, field: 'meta_on_image' })),
  ] }), api, () => {}, { ownOnly: true, user: 'nick' });
  for (const l of run.lines) {
    await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
    for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find(x => x.id === l.id)!)) await R.overrideFlag(run.id, l.id, f.rule, 'Test line', 'nick');
  }
  const ids = run.lines.map(l => l.id);
  const [p1, p2, p3, head] = ids;
  const cards = ids.slice(4);
  const versions = [p1, p2, p3].map(p => ({ visual: 'A', fields: { meta_primary: p, meta_headline: head } }));
  const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CARDS', versions, on_image: { A: cards }, expectation: { codes: ['OWN_CARDS_CAR_A1_US_META'], reason: 'Hook first.' } }, 'nick');
  const [A1, A2, A3] = signoff.versions!.map(v => v.code);
  assert.deepEqual([A1, A2, A3], ['OWN_CARDS_CAR_A1_US_META', 'OWN_CARDS_CAR_A2_US_META', 'OWN_CARDS_CAR_A3_US_META']);
  assert.deepEqual(signoff.on_image!.map(o => o.card), [1, 2, 3, 4]);

  const { Preflight } = await import('../src/services/studio/preflight.js');
  const { mockEngine } = await import('../src/services/studio/preflightEngine.js');
  const pf = new Preflight((store as any).db, mockEngine, { storage: 'db' });
  const rows = await pf.stubs({ persona: 'OWN', territory: 'OWN_CARDS' });
  assert.deepEqual(rows.map(r => r.stub), [A1, A2, A3]);
  assert.deepEqual(rows[0].copy.filter(c => c.card).map(c => [c.card, c.text, c.label]), CARDS.map((t, i) => [i + 1, t, `On-image text, card ${i + 1}`]));
  const card = (i: number, t: string) => ({ buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(`fake VOICES_TEXT: ${t}`)]), filename: `card${i + 1}.png`, contentType: 'image/png' });
  const upload = async (texts: string[]) => {
    const up = await pf.upload(A1, texts.map((t, i) => card(i, t)), 'nick', [A2, A3]);
    assert.equal(up.kind, 'carousel');
    await pf.runAudit(await pf.createAudit(up.upload_id));
    return Promise.all([A1, A2, A3].map(c => pf.report(c)));
  };
  const flagsOf = (rep: any) => rep.flags.filter((f: any) => f.check === 'copy_match').map((f: any) => [f.rule, f.severity]);

  // In order: every card matched, on every code; the caveat headline isn't looked for on the image.
  for (const rep of await upload(CARDS)) {
    assert.deepEqual(flagsOf(rep), []);
    assert.deepEqual(rep.audit!.result.copy_match.filter((r: any) => r.card).map((r: any) => [r.card, r.status]), [[1, 'match'], [2, 'match'], [3, 'match'], [4, 'match']]);
    assert.ok(rep.post_copy.some((c: any) => c.field === 'meta_headline'), 'the headline is post copy');
    assert.equal(rep.flags.some((f: any) => f.rule === 'COPY_CAVEAT'), false, 'no red for the caveat headline against the image');
  }
  // Cards 2 and 3 swapped: amber on each, saying where it was found.
  const sw = await upload([CARDS[0], CARDS[2], CARDS[1], CARDS[3]]);
  for (const rep of sw) assert.deepEqual(flagsOf(rep), [['COPY_CARD_ORDER', 'amber'], ['COPY_CARD_ORDER', 'amber']]);
  assert.match(sw[0].flags.find((f: any) => f.rule === 'COPY_CARD_ORDER').why, /On card 3, expected card 2/);
  // Card 3's text missing from the asset: red.
  const ms = await upload([CARDS[0], CARDS[1], 'Summer, sorted', CARDS[3]]);
  for (const rep of ms) assert.deepEqual(flagsOf(rep), [['COPY_CARD_MISSING', 'red']]);

  // Compliance shows the cards once for the asset; the handoff lists them in order on every code's row.
  const cv = await pf.complianceAssets();
  assert.deepEqual(cv.assets.find((a: any) => a.codes.some((c: any) => c.stub === A1))!.codes.map((c: any) => c.stub), [A1, A2, A3]);
  const csv = S.parseCsv((await R.handoffPack({ territory: 'OWN_CARDS' })).csv);
  const h = csv[0];
  assert.deepEqual(csv.slice(1).map(r => [r[0], ...[1, 2, 3, 4].map(k => r[h.indexOf(`On-image card ${k}`)])]), [A1, A2, A3].map(c => [c, ...CARDS]));
  await store.putRules('example-1', JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8')), { activate: true, by: 'test' }).catch(() => {});
});

// ---------- rounds (Brook, 30 Sep): R0 test round, then R1 ----------

test('rounds on Postgres: Pre-flight lists the active round; a test round\'s codes never reach the asset handoff or B3\'s features; R1 starts at A', { skip }, async () => {
  const { R, api } = await freshStudio();
  const Rounds = await import('../src/services/studio/rounds.js');
  await (store as any).db.query(`DELETE FROM studio_inputs WHERE key = 'rounds'`);
  await store.putRules('example-rounds', JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8')), { activate: true, by: 'test' }).catch(() => {});
  await S.refreshRules();
  const { Preflight } = await import('../src/services/studio/preflight.js');
  const { mockEngine } = await import('../src/services/studio/preflightEngine.js');
  const pf = new Preflight((store as any).db, mockEngine, { storage: 'db' });
  const png = (t: string) => [{ buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(`fake VOICES_TEXT: ${t}`)]), filename: 'a.png', contentType: 'image/png' }];
  const signAndAudit = async (name: string) => {
    const run = await keptRun(R, api, [`${name} primary.`], { name });
    const versions = adsOf(run.prims, run.head);
    const { signoff } = await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions, expectation: { codes: [await leadOf(R, versions)], reason: name } }, 'nick');
    const code = signoff.versions[0].code;
    const up = await pf.upload(code, png('Calm, covered.'), 'nick');
    await pf.runAudit(await pf.createAudit(up.upload_id));
    return code;
  };

  await Rounds.saveRound({ id: 'R0', name: 'Test run-through', test: true }, 'brook');
  // Nick works in the test round (stored per person in studio_inputs); the active round stays R1.
  await Rounds.setWorkingRound('nick', 'R0', true);
  assert.equal((await Rounds.workingRound('nick')).id, 'R0', 'stored in studio_inputs');
  assert.equal((await Rounds.getRounds()).active, 'R1');
  const c0 = await signAndAudit('r0');
  assert.equal(c0, 'OWN_CALM_UGC_A1_US_META_TEST');
  await Rounds.setWorkingRound('nick', 'R1', true);
  const c1 = await signAndAudit('r1');
  assert.equal(c1, 'OWN_CALM_UGC_A1_US_META', 'R1 starts at A');

  assert.deepEqual((await pf.stubs()).map(s => [s.stub, s.round, s.test]), [[c1, 'R1', false]], 'the active round by default');
  assert.deepEqual((await pf.stubs({ round: 'all' })).map(s => [s.stub, s.test]).sort(), [[c1, false], [c0, true]].sort());
  assert.deepEqual((await pf.complianceAssets()).assets.flatMap((a: any) => a.codes.map((c: any) => c.stub)), [c1]);
  const hand = S.parseCsv(await pf.handoffCsv('all'));
  assert.deepEqual(hand.slice(1).map(r => [r[0], r[2]]), [[c1, 'Month 1']], 'asset handoff: never a test code');
  const feats = S.parseCsv(await pf.featuresCsv());
  assert.equal(feats[0].at(-1), 'round');
  assert.deepEqual(feats.slice(1).map(r => [r[0], r.at(-1)]), [[c1, 'R1']], 'features for B3: every real round, never a test round');
  // The test round's own asset handoff (a demo): its codes, marked TEST; still never in the features.
  const demo = await pf.handoffCsv('R0');
  assert.match(demo, /^TEST – not for trafficking\r?\n/);
  assert.ok(demo.includes(c0) && !demo.includes(`${c1},`));
  await (store as any).db.query(`DELETE FROM studio_inputs WHERE key = 'rounds' OR key LIKE 'working_round:%'`);
});

// ---------- multi-size Pre-flight (Brook, 30 Sep; the client's WBS) ----------

test('sizes: a static in 3 sizes, one missing its on-image text → a flag on that size only; a missing size is amber; a carousel in 2 sizes × 4 cards; the estimate counts sizes', { skip }, async () => {
  const { R, api } = await freshStudio();
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  rules.fields.meta_on_image = { platform: 'META', label: 'On-image text', visible: 40, max: 60, source: 'HOUSE: test', in_version: 'per_visual' };
  rules.territories.OWN_STILL = { ...rules.territories.OWN_CALM, name: 'Still', format: 'STATIC' };
  rules.territories.OWN_CARDS = { ...rules.territories.OWN_CALM, name: 'Cards', format: 'CAROUSEL' };
  await store.putRules('example-sizes', rules, { activate: true, by: 'test' });
  await S.refreshRules();
  const { Preflight } = await import('../src/services/studio/preflight.js');
  const { mockEngine } = await import('../src/services/studio/preflightEngine.js');
  const pf = new Preflight((store as any).db, mockEngine, { storage: 'db' });
  const img = (t: string, name = 'a.png') => ({ buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(`fake VOICES_TEXT: ${t}`)]), filename: name, contentType: 'image/png' });
  const signOff = async (territory: string, onImage: string[]) => {
    const run = await S.generate(S.makeBrief({ territory, name: territory, own_lines: [{ text: 'Calm at the counter.', field: 'meta_primary' }, HEAD, ...onImage.map(text => ({ text, field: 'meta_on_image' }))] }), api, () => {}, { ownOnly: true, user: 'nick' });
    for (const l of run.lines) {
      await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
      for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find((x: any) => x.id === l.id)!)) await R.overrideFlag(run.id, l.id, f.rule, 'Test line', 'nick');
    }
    const [p, h, ...oi] = run.lines.map(l => l.id);
    const versions = [{ visual: 'A', fields: { meta_primary: p, meta_headline: h } }];
    const on_image = { A: oi.length > 1 ? oi : oi[0] };
    const v = await R.readyView('OWN', territory, 'US', { versions, on_image } as any);
    return (await R.signOff({ persona: 'OWN', territory, versions, on_image, expectation: { codes: [v.plan.versions[0].code], reason: 'x' } } as any, 'nick')).signoff.versions[0].code;
  };
  const report = (c: string) => pf.report(c);
  const copyFlags = (rep: any) => rep.flags.filter((f: any) => f.check === 'copy_match').map((f: any) => [f.rule, f.severity, f.size, f.label]);

  // A static: 3 sizes in one upload; 9:16 doesn't carry the on-image text.
  const still = await signOff('OWN_STILL', ['Vet visits, calmer']);
  assert.equal(still, 'OWN_STILL_ST_A1_US_META');
  const up = await pf.upload(still, [img('Vet visits, calmer', 's-1x1.png'), img('Vet visits, calmer', 's-4x5.png'), img('Summer, sorted', 's-9x16.png')], 'nick', [], ['1:1', '4:5', '9:16']);
  assert.deepEqual(up.sizes.map(x => x.size), ['1:1', '4:5', '9:16']);
  assert.equal(up.estimate.sizes, 3, 'one audit per size');
  assert.equal(up.estimate.seconds, 3 * (2 + 1), 'the estimate is the sum over sizes');
  await pf.runAudit(await pf.createAudit(up.upload_id));
  let rep = await report(still);
  assert.deepEqual(copyFlags(rep), [['COPY_MATCH', 'amber', '9:16', '9:16: On-image text (signed off) not found on the asset']], 'a flag on 9:16 only');
  assert.deepEqual(rep.flags.filter((f: any) => f.rule === 'CROSS_PERSONA').map((f: any) => [f.label, f.size]), [['How another persona might read it', undefined]], 'the same finding in every size is one flag');
  assert.deepEqual(rep.sizes, { expected: ['1:1', '4:5', '9:16'], uploaded: ['1:1', '4:5', '9:16'], missing: [] });
  assert.deepEqual(rep.audit!.result.copy_match.filter((r: any) => r.field === 'on_image').map((r: any) => [r.size, r.status]), [['1:1', 'match'], ['4:5', 'match'], ['9:16', 'not on asset']]);
  assert.deepEqual(rep.upload!.files.map((f: any) => [f.aspect, f.position]), [['1:1', 0], ['4:5', 100], ['9:16', 200]]);

  // Sizes read from the file names when not given; a missing size is amber, and Pre-flight can still be passed.
  const up2 = await pf.upload(still, [img('Vet visits, calmer', 'still_1x1.png'), img('Vet visits, calmer', 'still_4x5.png')], 'nick');
  assert.deepEqual(up2.sizes.map(x => x.size), ['1:1', '4:5']);
  assert.match(up2.format_notes.join(' '), /9:16 not uploaded/);
  await pf.runAudit(await pf.createAudit(up2.upload_id));
  rep = await report(still);
  assert.deepEqual(rep.flags.filter((f: any) => f.check === 'sizes').map((f: any) => [f.rule, f.severity, f.label]), [['SIZE_MISSING', 'amber', '9:16 not uploaded']]);
  assert.deepEqual(rep.sizes.missing, ['9:16']);
  assert.equal((await pf.setReady(still, true, 'nick')).status, 'ready', 'a missing size is noted, not a block');
  const hand = S.parseCsv(await pf.handoffCsv());
  const row = hand.find(r => r[0] === still)!;
  assert.equal(row[hand[0].indexOf('Sizes missing')], '9:16');
  assert.equal(row[hand[0].indexOf('File')], '1:1: still_1x1.png | 4:5: still_4x5.png', 'files per size');

  // A carousel: 2 sizes × 4 cards (card order within each size); 4:5 has cards 2 and 3 swapped.
  const CARDS = ['Vet bill at 2am?', 'You pay the vet as normal', 'We sort the rest', 'Calm, covered.'];
  const car = await signOff('OWN_CARDS', CARDS);
  const swapped = [CARDS[0], CARDS[2], CARDS[1], CARDS[3]];
  const up3 = await pf.upload(car, [...CARDS.map((t, i) => img(t, `c${i + 1}.png`)), ...swapped.map((t, i) => img(t, `d${i + 1}.png`))], 'nick', [], [...Array(4).fill('1:1'), ...Array(4).fill('4:5')]);
  assert.equal(up3.kind, 'carousel');
  assert.deepEqual(up3.sizes.map(x => [x.size, x.files.length]), [['1:1', 4], ['4:5', 4]]);
  await pf.runAudit(await pf.createAudit(up3.upload_id));
  rep = await report(car);
  assert.deepEqual(copyFlags(rep).map((x: any) => [x[0], x[2]]), [['COPY_CARD_ORDER', '4:5'], ['COPY_CARD_ORDER', '4:5']], '1:1 in order passes; 4:5 swapped');
  assert.equal(rep.flags.some((f: any) => f.check === 'sizes'), false, 'a carousel expects 1:1 and 4:5 only');
  assert.ok(rep.flags.filter((f: any) => f.rule === 'COPY_CARD_ORDER').every((f: any) => f.frame?.position >= 100 && f.frame?.position < 200), 'the flags point at the 4:5 cards');
  await store.putRules('example-1', JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8')), { activate: true, by: 'test' }).catch(() => {});
});
