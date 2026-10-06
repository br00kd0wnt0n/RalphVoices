// The Studio HTTP API (services/studio/router.ts), as both the local server and
// the hosted app use it: over real HTTP, on the mock client and a temp folder,
// plus the hosted allowlist. No key, network or database.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import * as S from '../src/services/studio/engine.js';
import { createStudioRouter, monthStart } from '../src/services/studio/router.js';
import { studioAccess } from '../src/utils/studioAccess.js';

S.setStudioDir(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-router-')));
S.setRulesPath(path.join(__dirname, '../scripts/studio/rules.example.json'));

let server: ReturnType<express.Express['listen']>;
let base = '';
const who = (req: express.Request) => String(req.headers['x-studio-user'] || '') || undefined;

before(async () => {
  const app = express();
  app.use('/api/studio', createStudioRouter({ who, api: req => new S.Api({ mock: true, user: who(req) }), mock: true, cap: 50, capWindow: 'month', askOver: 2 }));
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/studio`;
});
after(() => server.close());

const call = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-User': 'nick' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
};
/** Read a job's server-sent events until the stream ends. */
const events = async (job: string) => (await (await fetch(`${base}/jobs/${encodeURIComponent(job)}/events`)).text())
  .split('\n\n').filter(Boolean).map(x => JSON.parse(x.replace(/^data: /, '')));

test('meta reports the monthly budget and never the local folder when hosted-style options are off', async () => {
  const m = await call('GET', '/meta');
  assert.equal(m.status, 200);
  assert.equal(m.body.cap, 50);
  assert.equal(m.body.cap_window, 'month');
  assert.ok(m.body.territories.OWN_CALM);
});

test('a run over HTTP: generate, stream, decide, history, resume, export', async () => {
  const g = await call('POST', '/generate', { brief: { territory: 'OWN_CALM', n: 4, name: 'http-run' } });
  assert.equal(g.status, 200);
  const ev = await events(g.body.job);
  assert.ok(ev.some(e => e.type === 'done'), JSON.stringify(ev.filter(e => e.type === 'error')));
  const run = (await call('GET', `/batches/${g.body.batch}`)).body;
  assert.equal(run.created_by, 'nick');

  const line = run.lines[0].id;
  const d = await call('PATCH', `/batches/${run.id}/lines/${line}`, { decision: 'keep' });
  assert.equal(d.body.decided_by, 'nick');
  assert.equal((await call('GET', `/lines/${line}/history`)).body.length, 1);

  const r = await call('POST', `/batches/${run.id}/resume`);
  assert.ok((await events(r.body.job)).some(e => e.type === 'done'));

  const csv = await call('GET', `/batches/${run.id}/export.csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.body, /keep/);
});

test('a job the server no longer has says how to recover', async () => {
  const ev = await events('gone~1');
  assert.match(ev[0].message, /resume/);
});

test('rules endpoints only exist on the hosted router', async () => {
  assert.equal((await call('GET', '/rules')).status, 404);
});

test('bad input is a 400 with a message, not a crash', async () => {
  const r = await call('GET', '/docs/../../etc/passwd');
  assert.ok([400, 404].includes(r.status));
  assert.equal((await call('GET', '/batches/nope')).status, 400);
});

test('hosted access: STUDIO_EMAILS or ADMIN_EMAILS, case-insensitive, closed when unset', () => {
  const env = { STUDIO_EMAILS: 'Nick.Larson@ralph.world, vivan@ralph.world', ADMIN_EMAILS: 'brook@ralph.world' } as NodeJS.ProcessEnv;
  assert.deepEqual(studioAccess('nick.larson@ralph.world', env), { allowed: true, admin: false });
  assert.deepEqual(studioAccess('BROOK@ralph.world', env), { allowed: true, admin: true });
  assert.deepEqual(studioAccess('someone@ralph.world', env), { allowed: false, admin: false });
  assert.deepEqual(studioAccess('nick.larson@ralph.world', {} as NodeJS.ProcessEnv), { allowed: false, admin: false });
  assert.deepEqual(studioAccess(undefined, env), { allowed: false, admin: false });
});

test('the monthly window starts on the 1st (UTC)', () => {
  assert.equal(monthStart(new Date('2026-09-28T12:00:00Z')), '2026-09-01T00:00:00.000Z');
});

test('compliance status is set by the producer or an admin; everyone else gets a clear 403', async () => {
  const { canSetCompliance } = await import('../src/utils/studioAccess.js');
  const env = { STUDIO_COMPLIANCE_EMAILS: 'vivan@ralph.world', ADMIN_EMAILS: 'brook@ralph.world' } as NodeJS.ProcessEnv;
  assert.equal(canSetCompliance('Vivan@ralph.world', env), true);
  assert.equal(canSetCompliance('brook@ralph.world', env), true);
  assert.equal(canSetCompliance('nick.larson@ralph.world', env), false);
  const app = express();
  app.use('/s', createStudioRouter({ who: () => 'nick', api: () => new S.Api({ mock: true }), mock: true, cap: 50, capWindow: 'month', askOver: 2, canSetCompliance: () => false }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/s`;
  try {
    const res = await fetch(`${b}/batches/x/lines/y/compliance`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"status":"cleared"}' });
    assert.equal(res.status, 403);
    assert.equal(((await (await fetch(`${b}/meta`)).json()) as any).can_set_compliance, false);
  } finally { srv.close(); }
});

test('the live rules in plain words: every item with its source, visual-only brand items marked', async () => {
  const r = await call('GET', '/rules/active');
  assert.equal(r.status, 200);
  assert.ok(r.body.compliance.every((x: any) => x.rule && x.source));
  assert.ok(r.body.brand.some((x: any) => x.applies_to === 'visual'), 'the visual-only items are listed (marked), unlike in the text checks');
  assert.ok(Object.values<any>(r.body.personas).every(p => Array.isArray(p.triggers) && Array.isArray(p.turn_offs)));
});

test('meta carries persona context from the rules file (who, triggers with detail and source, turn-offs, language)', async () => {
  const m = (await call('GET', '/meta')).body;
  const p: any = Object.values(m.personas)[0];
  assert.ok(p.triggers.every((t: any) => 'detail' in t && 'source' in t));
  assert.ok(Array.isArray(p.context.turn_offs) && Array.isArray(p.context.language));
  assert.ok(m.sources && typeof m.sources === 'object');
});

test('Pre-flight notes an asset whose type doesn’t fit the code’s format (never blocks)', async () => {
  const { formatNote } = await import('../src/services/studio/preflight.js');
  assert.equal(formatNote('DINK_NEVER_STATIC_v1_META', 'static'), null);
  assert.match(formatNote('DINK_NEVER_UGC_v1_TIKTOK', 'static')!, /a video \(UGC\).*static was uploaded/);
  assert.match(formatNote('DINK_NEVER_CAROUSEL_v2_META', 'static')!, /carousel cards/);
  assert.equal(formatNote('DINK_NEVER_VIDEO_v1_TIKTOK', 'video'), null);
  assert.equal(formatNote('ODD_NAME', 'static'), null);
});

test('Pre-flight storage: production with R2 needs the private bucket, never the public one', async () => {
  const { preflightStorage } = await import('../src/services/studio/preflight.js');
  const prod = { NODE_ENV: 'production', ENABLE_R2_STORAGE: 'true', R2_BUCKET_NAME: 'public-bucket' } as NodeJS.ProcessEnv;
  const refused = preflightStorage(prod, true);
  assert.equal(refused.mode, 'refuse');
  assert.match(refused.reason!, /set STUDIO_R2_BUCKET to a private bucket/);
  assert.equal(preflightStorage({ ...prod, STUDIO_R2_BUCKET: 'private' }, true).mode, 'r2');
  assert.equal(preflightStorage({ ...prod, ENABLE_R2_STORAGE: 'true' }, false).mode, 'refuse', 'R2 on but unusable still refuses in production');
  assert.equal(preflightStorage({ NODE_ENV: 'development' } as NodeJS.ProcessEnv, false).mode, 'db');
  assert.equal(preflightStorage({ NODE_ENV: 'development', R2_BUCKET_NAME: 'public-bucket' } as NodeJS.ProcessEnv, true).mode, 'db', 'never the public bucket, even in dev');
});

test('an audit from older rules or older checks says so (never re-run automatically)', async () => {
  const { staleness, PREFLIGHT_LOGIC_VERSION } = await import('../src/services/studio/preflight.js');
  assert.equal(staleness({ status: 'done', rules_version: 'v2.4', result: { logic_version: PREFLIGHT_LOGIC_VERSION } }, 'v2.4'), null);
  assert.match(staleness({ status: 'done', rules_version: 'v2.3', result: { logic_version: PREFLIGHT_LOGIC_VERSION } }, 'v2.4')!, /older rules \(v2\.3; live: v2\.4\): audit again/);
  assert.match(staleness({ status: 'done', rules_version: 'v2.4', result: {} }, 'v2.4')!, /older version of the checks/);
  assert.equal(staleness({ status: 'failed', rules_version: 'v1' }, 'v2.4'), null);
});

test('a red flag on copy is overridden only by the Ready to traffic people or an admin; everyone else gets a 403', async () => {
  const app = express();
  app.use('/s', createStudioRouter({ who: () => 'vivan', api: () => new S.Api({ mock: true }), mock: true, cap: 50, capWindow: 'month', askOver: 2, canOverride: () => false }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  const b = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/s`;
  try {
    const res = await fetch(`${b}/batches/x/lines/y/override`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"rule":"COMP_X","reason":"Looks fine to me"}' });
    assert.equal(res.status, 403);
    assert.match(((await res.json()) as any).error, /creative lead|admin/);
    assert.equal(((await (await fetch(`${b}/meta`)).json()) as any).can_override, false);
  } finally { srv.close(); }
  // Locally (no role check) the route still reaches the override logic.
  const local = await call('POST', '/batches/nope/lines/L1/override', { rule: 'X', reason: 'A reason here' });
  assert.notEqual(local.status, 403);
});

test('lines only go into a run of the same persona and territory: a brief for another is a 409, never silently moved', async () => {
  const g = await call('POST', '/generate', { brief: { territory: 'OWN_CALM', n: 2, name: 'mismatch-run' } });
  await events(g.body.job);
  const other = await call('POST', '/generate', { brief: { persona: 'DINK', territory: 'DINK_NEVER', own_lines: [{ text: 'A DINK line', field: 'meta_headline' }] }, batch: g.body.batch, own_only: true });
  assert.equal(other.status, 409);
  assert.match(other.body.error, /^This run is for .*Start a new run for /);
  const run = (await call('GET', `/batches/${g.body.batch}`)).body;
  assert.equal(run.lines.some((l: any) => l.text === 'A DINK line'), false, 'nothing was added to the other run');
  // The same persona and territory still go in.
  const same = await call('POST', '/generate', { brief: { territory: 'OWN_CALM', own_lines: [{ text: 'Another calm line', field: 'meta_headline' }] }, batch: g.body.batch, own_only: true });
  assert.equal(same.status, 200);
});

test('the disclaimer on the last screen: off (grey) until the rules carry the text, then red when the last card or frame lacks it', async () => {
  const { disclaimerCheck } = await import('../src/services/studio/preflight.js');
  const made = 'Made-up disclaimer: coverage subject to terms, exclusions and waiting periods. Policies underwritten by Example Co.';
  const rules = (text: string | null) => ({ disclaimer: { id: 'DISCLAIMER_LAST_SCREEN', rule: 'The approved disclaimer appears on the final frame or card of every asset.', severity: 'compliance', applies_to: 'visual', text, source: 'Trupanion brand notes, email 29 Sep 2026' } });
  assert.deepEqual(disclaimerCheck({}, [], 'static'), [], 'older rules: no check at all');
  const off = disclaimerCheck(rules(null), [{ where: 'image', text: 'anything' }], 'static');
  assert.equal(off.length, 1);
  assert.equal(off[0].severity, 'grey');
  assert.match(off[0].label, /Disclaimer check off: no approved text in the rules yet/);
  // Small print over three lines, different case and punctuation, on the last card: a match.
  const split = 'MADE-UP DISCLAIMER\ncoverage subject to terms, exclusions\nand waiting periods — policies underwritten by Example Co';
  assert.deepEqual(disclaimerCheck(rules(made), [{ where: 'card 1', text: 'Hook' }, { where: 'card 2', text: split }], 'carousel', 2), []);
  // On card 1 but not the last card: red, pointing at the last card.
  const red = disclaimerCheck(rules(made), [{ where: 'card 1', text: split }, { where: 'card 2', text: 'Get a quote' }], 'carousel', 2);
  assert.equal(red[0].severity, 'red');
  assert.equal(red[0].frame?.asset_position, 1);
  assert.match(red[0].why!, /isn't on card 2/);
  // A last card with no readable text at all (the mock drops empty cards).
  assert.equal(disclaimerCheck(rules(made), [{ where: 'card 1', text: 'Hook' }], 'carousel', 2)[0].severity, 'red');
  // One OCR slip out of the small print still matches; the voice-over never counts.
  assert.deepEqual(disclaimerCheck(rules(made), [{ where: 'image', text: split.replace('exclusions', 'exc1usions') }], 'static'), []);
  assert.equal(disclaimerCheck(rules(made), [{ where: '8.9 s (last frame)', text: 'Trupanion' }, { where: 'voice-over', text: made }], 'video')[0].severity, 'red');
  assert.deepEqual(disclaimerCheck(rules(made), [{ where: '8.9 s (last frame)', text: made }], 'video'), []);
  assert.equal(disclaimerCheck(rules(made), [{ where: 'voice-over', text: made }], 'video')[0].severity, 'grey', 'no frames: a note, not a pass');
});

test('red brand items with two wordings are asked as yes/no too, so red still needs agreement', () => {
  const r: any = { compliance: [{ id: 'C1', wordings: ['a', 'b'] }, { id: 'C2' }], brand: [{ id: 'B_RED', severity: 'compliance', wordings: ['a', 'b'] }, { id: 'B_WARN', severity: 'warn', wordings: ['a', 'b'] }] };
  assert.deepEqual(S.yesNoItems(r).map(i => i.id), ['C1', 'B_RED']);
  // A lone model call on a red brand rule is amber, not red.
  const line: any = { text: 'x', edited_text: '', flags: [{ rule: 'B_RED', severity: 'compliance', label: '', source: '', quote: '', by: ['model'], p: 0.1 }], probes: {} };
  S.reconcile(line, r);
  assert.equal(line.flags[0].severity, 'warn');
});

test('the disclaimer by region (rules v2.16): an asset needs its own region\'s version or the North America one; every approved version is small print', async () => {
  const { disclaimerCheck, disclaimerVersions } = await import('../src/services/studio/preflight.js');
  const { withoutSmallPrint, disclaimerTexts } = await import('../src/services/audit/smallPrint.js');
  // Made-up texts with the shape of the real ones: a shared opening, a US address and licence, a Canadian address, registration and phone.
  const US = 'Example is a registered trademark owned by Example, Inc. Example policies are underwritten by First Example Insurance Company, 100-4th Ave S, Springfield, WA 98000 sold and administered by Example Managers USA, Inc. (CA license No. 0X00000, NPN 1234567).';
  const CA = 'Example is a registered trademark owned by Example, Inc. Example policies are underwritten by Northern Example Insurance Company of Canada, and sold and administered by Canada Example Services, Inc. dba Example, 309-1277 Maple Valley Road, North Harbour, BC, V7J 0A2, a registered damage insurance agency and claims adjuster in Quebec #603927. To verify your underwriter please consult the declarations page of your policy or contact us at 1.888.555.0100.';
  const NA = `${US.replace('100-4th Ave S, Springfield, WA 98000 sold', 'in the United States, and sold').replace('(CA license', '100 4th Ave S, Springfield, WA 98000, (CA license')} ${CA.replace('Example is a registered trademark owned by Example, Inc. ', '').replace('Company of Canada, and', 'Company of Canada in Canada, and')}`;
  const rules = { disclaimer: { id: 'DISCLAIMER_LAST_SCREEN', rule: 'The approved disclaimer appears on the final frame or card of every asset.', severity: 'compliance', applies_to: 'visual', text: US, text_by_region: { US, CA, NA }, source: 'test' } };
  const on = (text: string) => [{ where: 'image', text: `Vet visits, calmer\n${text}` }];
  const check = (text: string, region: string) => disclaimerCheck(rules, on(text), 'static', 1, region);
  assert.deepEqual(disclaimerVersions(rules, 'CA').map(v => v.key), ['CA', 'NA']);
  // The right version for the region passes; so does the North America one, in either region.
  assert.deepEqual([check(US, 'US'), check(CA, 'CA'), check(NA, 'US'), check(NA, 'CA')], [[], [], [], []]);
  // Small print over lines, in capitals, still matches.
  assert.deepEqual(check(CA.toUpperCase().replace(/, /g, ',\n'), 'CA'), []);
  // A Canadian asset with the US disclaimer is red, and says which version it carries and which it needs.
  const red = check(US, 'CA');
  assert.deepEqual([red.length, red[0].severity], [1, 'red']);
  assert.match(red[0].label, /the Canada disclaimer, or the North America disclaimer is expected on this Canada asset/);
  assert.match(red[0].why!, /carries the US disclaimer; this asset needs the Canada disclaimer/);
  assert.match(red[0].quote!, /^approved: "Example is a registered trademark.*1\.888\.555\.0100\."$/);
  // And the other way round; with none at all it says what is missing.
  assert.match(check(CA, 'US')[0].why!, /carries the Canada disclaimer; this asset needs the US disclaimer/);
  assert.match(check('Get a quote', 'CA')[0].why!, /The Canada disclaimer, or the North America disclaimer isn't on image/);
  // Rules without regional versions behave as before: `text` for every region, the rule as the label.
  const plain = { disclaimer: { ...rules.disclaimer, text_by_region: undefined } };
  assert.deepEqual(disclaimerCheck(plain, on(US), 'static', 1, 'CA'), []);
  assert.equal(disclaimerCheck(plain, on('Get a quote'), 'static', 1, 'CA')[0].label, rules.disclaimer.rule);
  assert.equal(disclaimerCheck(plain, on('Get a quote'), 'static')[0].why, "The approved disclaimer isn't on image (0% of its words found)");

  // Any approved version is small print for the copy and figure checks, whatever the region: nothing of the Canadian
  // address, registration or phone number is left to be read as ad copy or a figure.
  const all = disclaimerTexts(rules);
  assert.equal(all.length, 3);
  for (const text of [CA, CA.replace(/, /g, ',\n'), NA, US]) {
    const left = withoutSmallPrint(`Vet visits, calmer\nWe pay 90% of eligible bills.\n${text}`, all);
    assert.equal(left, 'Vet visits, calmer\nWe pay 90% of eligible bills.', text.slice(60, 100));
  }
  // With only the US text known (rules before v2.16), the Canadian numbers would be left in: this is what the change fixes.
  assert.match(withoutSmallPrint(`Vet visits, calmer\n${CA.replace(/, /g, ',\n')}`, US), /603927|309-1277/);
});
