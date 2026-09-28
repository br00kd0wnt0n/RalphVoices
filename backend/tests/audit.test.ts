// B2 pre-flight audit: stub parsing, sidecars, keyframe times, rule-based copy
// flags, the yes/no item map, the features CSV and a mock asset end to end.
// Uses made-up rules (tests/fixtures/audit/), so it needs no client material,
// key or network. The end-to-end test needs ffmpeg (skipped without it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadRules, loadRubric, parseStub } from '../src/services/audit/rules.js';
import { parseSidecar, keyframeTimes, discoverRound } from '../src/services/audit/assets.js';
import { copyFlags, ocrOnlyWords, type TextBlock } from '../src/services/audit/copyChecks.js';
import { buildItems, genericWordings } from '../src/services/audit/checks.js';
import { AuditApi, probabilityYes, imageTokens } from '../src/services/audit/api.js';
import { auditAsset } from '../src/services/audit/engine.js';
import { mockResponder } from '../src/services/audit/mock.js';
import { featuresCsv, flagSheetCsv, agreement, parseCsvObjects, assetMarkdown } from '../src/services/audit/report.js';

const FX = path.join(__dirname, 'fixtures/audit');
const rules = loadRules(path.join(FX, 'rules.example.json'));
const rubric = loadRubric(path.join(FX, 'rubric.example.json'));
const flagsFor = (blocks: TextBlock[], persona = 'DINK') => copyFlags(blocks, rules, persona);
const img = (text: string, extra: Partial<TextBlock> = {}): TextBlock => ({ where: 'image', text, onImage: true, lead: true, ...extra });

test('stubs parse like B3 reads them (aliases, case, date suffix) and bad names say why', () => {
  assert.deepEqual(parseStub('fam_summer_static_v2_meta.png'), { stub: 'FAM_SUMMER_ST_v2_META', persona: 'FAM', territory: 'SUMMER', format: 'ST', version: 2, platform: 'META' });
  assert.equal((parseStub('DINK_NEVER_UGC_v1_TIKTOK_261013') as any).stub, 'DINK_NEVER_UGC_v1_TT');
  assert.equal((parseStub('CUR_DAY_ONE_CAROUSEL_v3_IG') as any).stub, 'CUR_DAY_ONE_CAR_v3_META');
  assert.match((parseStub('XYZ_A_ST_v1_META') as any).error, /persona/);
  assert.match((parseStub('DINK_A_ST_META') as any).error, /version/);
});

test('sidecar: known labels start fields; other colons stay in the copy', () => {
  const { copy } = parseSidecar('Primary text: Real talk: vet bills add up.\nsecond line\nHeadline: Do the maths\nVoice-over: hello');
  assert.equal(copy.meta_primary, 'Real talk: vet bills add up.\nsecond line');
  assert.equal(copy.meta_headline, 'Do the maths');
  assert.equal(copy.transcript, 'hello');
});

test('keyframes: first, 1.5 s hook, every 3 s, last; capped at 8', () => {
  assert.deepEqual(keyframeTimes(9).map(k => k.at), [0, 1.5, 3, 6, 8.9]);
  const long = keyframeTimes(60);
  assert.equal(long.length, 8);
  assert.equal(long[1].role, 'hook');
  assert.equal(long[7].role, 'last');
});

test('pays-for-itself on the image is red, with the quote and source', () => {
  const f = flagsFor([img('Honestly? It pays for itself.')]).find(x => x.rule === 'COMP_PAYS_FOR_ITSELF');
  assert.ok(f);
  assert.equal(f.severity, 'red');
  assert.equal(f.quote, 'pays for itself');
  assert.equal(f.source, 'LEGAL §5');
});

test('direct pay: red without the caveat, clean with it, amber when the caveat is elsewhere', () => {
  assert.equal(flagsFor([img('We pay your vet directly.')]).find(x => x.rule === 'COMP_DIRECT_PAY')?.severity, 'red');
  assert.equal(flagsFor([img('We pay your vet directly at participating hospitals.')]).find(x => x.rule === 'COMP_DIRECT_PAY'), undefined);
  const split = flagsFor([img('We pay your vet directly.', { where: 'card 1' }), img('At participating hospitals.', { where: 'card 3', lead: false })]);
  assert.equal(split.find(x => x.rule === 'COMP_DIRECT_PAY')?.severity, 'amber');
});

test('words only tesseract read are amber at most', () => {
  const f = flagsFor([img('It pays for itself', { ocrOnly: true })]).find(x => x.rule === 'COMP_PAYS_FOR_ITSELF');
  assert.equal(f?.severity, 'amber');
  assert.deepEqual(ocrOnlyWords('Medical insurance', 'Medical insurance\nparticipating hosp1tals'), ['participating']);
});

test("the other personas' turn-offs come back grey (cross-persona travel)", () => {
  const fl = flagsFor([{ where: 'Primary text', field: 'meta_primary', text: 'For your fur baby.' }], 'DINK');
  assert.equal(fl.find(x => x.rule === 'DINK_T_BABY_CAREFUL')?.severity, 'amber');
  assert.equal(fl.find(x => x.rule === 'CUR_T_BABY')?.severity, 'grey');
});

test('limits, case and figures apply to copy fields; on-image caps are fine', () => {
  const fl = flagsFor([{ where: 'Headline', field: 'meta_headline', text: 'THE BEST COVER FOR A $9,000 SURGERY, HONESTLY' }]);
  assert.ok(fl.find(x => x.rule === 'LIMIT_MAX'));
  assert.ok(fl.find(x => x.rule === 'BR_CASE'));
  assert.equal(fl.find(x => x.rule === 'FIG_UNSOURCED')?.quote, '$9,000');
  assert.equal(fl.find(x => x.rule === 'COMP_SUPERLATIVE')?.severity, 'amber');
  assert.equal(flagsFor([img('Empty nesters in their late 50s, since the 1990s')]).find(x => x.rule === 'FIG_UNSOURCED'), undefined);
  assert.equal(flagsFor([img('SURGERY CAN COST $6,000')]).find(x => x.rule === 'BR_CASE' || x.rule === 'FIG_UNSOURCED'), undefined);
});

test('yes/no items: rubric wordings map to rules ids; video adds the 1.5 s and last-frame checks', () => {
  const items = buildItems(rules, rubric, { video: true });
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  assert.equal(byId.humour.kind, 'feature');
  assert.equal(byId.pet_as_practice.rule, 'DINK_T_PRACTICE');
  assert.equal(byId.one_glance.rule, 'CL_GLANCE');
  assert.equal(byId.one_glance.flagWhen, 'no');
  assert.equal(byId.overpromise.kind, 'table');
  assert.equal(byId.BR_SAD_PET.kind, 'brand');
  assert.equal(byId.video_brand_hook.frame, 'hook');
  assert.equal(buildItems(rules, rubric).some(i => i.kind === 'video'), false);
});

test('P(Yes) from logprobs; image tokens as OpenAI counts them', () => {
  assert.equal(Math.round(probabilityYes([{ token: 'Yes', logprob: Math.log(0.6) }, { token: ' no', logprob: Math.log(0.2) }])! * 100), 75);
  assert.equal(probabilityYes([{ token: 'Maybe', logprob: 0 }]), null);
  assert.equal(imageTokens(1080, 1080, 'low'), 85);
  assert.equal(imageTokens(1080, 1080, 'high'), 765);
  assert.equal(imageTokens(1080, 1920, 'high'), 1105);
});

const hasFfmpeg = (() => { try { execFileSync('which', ['ffmpeg'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('a mock static end to end: red flag, features, features CSV B3 can read, flag sheet round trip', { skip: !hasFfmpeg && 'needs ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
  const round = path.join(dir, 'round');
  fs.mkdirSync(round);
  const png = path.join(round, 'DINK_JOKE_STATIC_v1_META.png');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x320', '-frames:v', '1', png]);
  fs.writeFileSync(path.join(round, 'DINK_JOKE_STATIC_v1_META.txt'), 'Primary text: The best pet insurance.\nHeadline: Surgery can run $6,000\n');
  const [asset] = discoverRound(round, dir);
  assert.equal(asset.stub?.stub, 'DINK_JOKE_ST_v1_META');
  assert.equal(asset.copy.meta_headline, 'Surgery can run $6,000');

  const api = new AuditApi({ mock: mockResponder(() => 'It pays for itself.\nTrupanion'), capUsd: 1, spendPath: path.join(dir, 'spend.json') });
  const r = await auditAsset(asset, { api, rules, rubric, workDir: dir, personas: { DINK: { code: 'DINK', name: 'Example couples', seed: null, voice: '' } } });
  const red = r.flags.filter(f => f.severity === 'red');
  assert.deepEqual(red.map(f => f.rule), ['COMP_PAYS_FOR_ITSELF']);
  assert.ok(r.flags.every(f => f.source), 'every flag has a source');
  assert.ok(r.features.dollar_figure >= 0.5);
  assert.equal(r.objection, 'Mock objection: prove it.');
  assert.ok(r.frames[0].text.includes('pays for itself'));

  // B3's loader reads `stub`, `features` ("a; b") and `angle`.
  const rows = parseCsvObjects(featuresCsv([r], rules as any));
  assert.equal(rows[0].stub, 'DINK_JOKE_ST_v1_META');
  assert.equal(rows[0].features, 'dollar_figure');
  assert.equal(rows[0].angle, 'DINK_A5');

  const sheet = parseCsvObjects(flagSheetCsv([r]));
  assert.equal(sheet.length, r.flags.length);
  sheet.forEach((s, i) => (s.agree = i === 0 ? 'n' : 'y'));
  const ag = agreement(sheet);
  assert.equal(ag.marked, r.flags.length);
  assert.equal(ag.misses.length, 1);

  const md = assetMarkdown(r, rules, { round: 't', date: '2026-09-28', rubric: 'example-1' });
  assert.match(md, /## Flags: 1 red/);
  assert.doesNotMatch(md, /\bscore\b|\brank(ing)?\b/i);
});

test('v2.3 visual brand items: asked of the images with wordings from the rule text; never matched on words', () => {
  const it = buildItems(rules, rubric).find(i => i.id === 'BR_COLLAR');
  assert.equal(it?.kind, 'brand');
  assert.deepEqual(it?.wordings, genericWordings('Never show pets outdoors without a collar.'));
  assert.equal(flagsFor([img('A collar for every dog')]).find(x => x.rule === 'BR_COLLAR'), undefined);
});

test('spoken claims: a transcribed voice-over gets the copy and compliance checks', { skip: !hasFfmpeg && 'needs ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-vo-'));
  const round = path.join(dir, 'round');
  fs.mkdirSync(round);
  // 4 s of blue with a tone: a video that has an audio track.
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x320:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(round, 'FAM_TALK_VID_v1_META.mp4')]);
  const [asset] = discoverRound(round, dir);
  assert.equal(asset.has_audio, true);
  assert.equal(asset.transcript, undefined);
  const api = new AuditApi({ mock: mockResponder(() => ''), mockTranscribe: () => 'Honestly, they pay the whole vet bill.', capUsd: 1, spendPath: path.join(dir, 'spend.json') });
  const r = await auditAsset(asset, { api, rules, rubric, workDir: dir, personas: {} });
  const f = r.flags.find(x => x.rule === 'COMP_PAID_SHARE');
  assert.equal(f?.severity, 'red');
  assert.equal(f?.where, 'voice-over');
  assert.equal(r.transcript?.source, 'mock');

  // A transcript sidecar wins over transcription.
  fs.writeFileSync(path.join(round, 'FAM_TALK_VID_v1_META.transcript.txt'), 'Nothing to file.');
  const [again] = discoverRound(round, dir);
  assert.equal(again.transcript_source, 'sidecar');
  assert.equal(again.transcript, 'Nothing to file.');
});
