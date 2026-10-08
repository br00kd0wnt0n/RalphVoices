// Fields by format (rules v2.17, Brook 7 Oct): a video's lines (opening on-screen line, end line, script, other supers)
// are offered only on video territories, so adding them to the rules changes nothing on a static or a carousel; and a
// TikTok-native build is a territory format of its own. Example rules with the v2.17 field shapes, mock client, file store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import * as R from '../src/services/studio/ready.js';
import * as Bulk from '../src/services/studio/bulk.js';
import { versionFields } from '../src/services/studio/versions.js';
import { copyMatchForStub } from '../src/services/studio/preflight.js';
import { FileStore } from '../src/services/studio/store.js';

const VIDEO = { in_version: 'per_visual', default_count: 0, source: 'HOUSE: test' };
async function fresh(withVideoFields = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-video-'));
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  rules.fields.meta_on_image = { platform: 'META', label: 'On-image text', visible: 40, max: 60, source: 'HOUSE: test', in_version: 'per_visual' };
  rules.fields.meta_on_image_sub = { platform: 'META', label: 'On-image subhead', visible: 60, max: 90, source: 'HOUSE: test', in_version: 'per_visual', on_image_role: 'sub' };
  if (withVideoFields) Object.assign(rules.fields, {
    video_open: { ...VIDEO, platform: 'META', label: 'Opening on-screen line (video)', visible: 40, max: 60, formats: ['VIDEO', 'UGC'], video_role: 'open' },
    video_end: { ...VIDEO, platform: 'META', label: 'End line (video)', visible: 60, max: 90, formats: ['VIDEO', 'UGC'], video_role: 'end' },
    video_script: { ...VIDEO, platform: 'META', label: 'Script / voice-over (video)', visible: 600, max: 1500, formats: ['VIDEO', 'UGC'], video_role: 'script' },
    tiktok_end: { ...VIDEO, platform: 'TIKTOK', label: 'TikTok end line', visible: 60, max: 90, formats: ['TIKTOK'], video_role: 'end' },
    tiktok_script: { ...VIDEO, platform: 'TIKTOK', label: 'TikTok script', visible: 600, max: 1500, formats: ['TT'], video_role: 'script' },
  });
  if (withVideoFields && rules.fields.tiktok_hook) rules.fields.tiktok_hook.video_role = 'open';
  rules.territories.OWN_STILL = { ...rules.territories.OWN_CALM, name: 'Still', format: 'STATIC' };
  rules.territories.OWN_CARDS = { ...rules.territories.OWN_CALM, name: 'Cards', format: 'CAROUSEL' };
  rules.territories.OWN_FILM = { ...rules.territories.OWN_CALM, name: 'Film', format: 'VIDEO' };
  const rulesPath = path.join(dir, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify(rules));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath }));
  return S.refreshRules();
}

test('video fields are offered on video territories only: a static and a carousel are exactly as they were', async () => {
  const before = await fresh(false);
  const plain = { still: versionFields('META', before, 'STATIC'), cards: versionFields('META', before, 'CAROUSEL'), defaults: [S.defaultFields('OWN_STILL', before), S.defaultFields('OWN_CARDS', before)] };
  const r = await fresh(true);
  assert.deepEqual(versionFields('META', r, 'STATIC'), plain.still, 'the same slots in Build for a static');
  assert.deepEqual(versionFields('META', r, 'CAROUSEL'), plain.cards);
  assert.deepEqual([S.defaultFields('OWN_STILL', r), S.defaultFields('OWN_CARDS', r)], plain.defaults, 'the same fields ticked in Write');
  // A video has its own lines; with no format given (older callers) every field is listed, as before.
  assert.deepEqual(versionFields('META', r, 'VIDEO').per_visual, ['meta_on_image', 'meta_on_image_sub', 'video_open', 'video_end', 'video_script']);
  assert.ok(versionFields('META', r).per_visual.includes('video_script'));
  assert.deepEqual(S.defaultFields('OWN_FILM', r), ['meta_primary', 'meta_headline', 'video_open', 'video_end']);
  assert.deepEqual([S.fieldFitsFormat('video_open', 'STATIC', r), S.fieldFitsFormat('video_open', 'UGC', r), S.fieldFitsFormat('tiktok_script', 'TIKTOK', r), S.fieldFitsFormat('tiktok_end', 'TT', r), S.fieldFitsFormat('meta_primary', 'STATIC', r)], [false, true, true, true, true]);
  assert.deepEqual([S.fieldByRole('open', 'VIDEO', r), S.fieldByRole('open', 'TIKTOK', r), S.fieldByRole('script', 'TT', r), S.fieldByRole('end', 'STATIC', r)], ['video_open', r.fields.tiktok_hook ? 'tiktok_hook' : null, 'tiktok_script', null]);
  // Build's data for a signed-off-style static: no video slots.
  const run = await S.generate(S.makeBrief({ territory: 'OWN_STILL', name: 's', own_lines: [{ field: 'meta_primary', text: 'Trupanion pays the vet at partner clinics.' }, { field: 'meta_headline', text: 'Calm, covered.' }, { field: 'meta_on_image', text: 'Vet visits, calmer' }] }), new S.Api({ mock: true }), () => {}, { ownOnly: true, user: 'nick' });
  for (const l of run.lines) await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
  assert.deepEqual((await R.readyView('OWN', 'OWN_STILL')).fields.META.per_visual, ['meta_on_image', 'meta_on_image_sub']);
});

test('a TikTok-native build is a territory format: it can be created, and its lengths read as a script or an opening line', async () => {
  const r = await fresh(true);
  assert.ok(S.FORMATS.includes('TIKTOK'));
  const made = await S.saveTerritory(null, { persona: 'OWN', name: 'Sock Eater', angle: r.personas.OWN.triggers[0].id, format: 'TIKTOK', premise: 'The static, as a TikTok build.' }, 'Month 1 TikTok build', 'brook');
  assert.equal(made.code, 'OWN_SOCK_EATER');
  await assert.rejects(() => S.saveTerritory(null, { persona: 'OWN', name: 'X', format: 'GIF' }, '', 'brook'), /Format must be one of/);
  const rules = await S.refreshRules();
  if (rules.fields.tiktok_hook) assert.deepEqual(S.defaultFields('OWN_SOCK_EATER', rules).filter(f => /tiktok/.test(f)), ['tiktok_hook', 'tiktok_end', 'tiktok_caption'].filter(f => rules.fields[f]));
  // Length flags in the field's own words: a script is "long for a script", never "long for the image".
  const long = (field: string, n: number) => S.deterministicFlags({ text: 'x'.repeat(n), field, structure: 'plain_promise', persona: 'OWN' }, rules).flags.find(f => /^LIMIT/.test(f.rule))?.label;
  assert.equal(long('video_script', 700), 'Long for a script: 700 characters (aim for 600 or fewer)');
  assert.equal(long('video_open', 50), 'Long for an opening on-screen line: 50 characters (aim for 40 or fewer)');
  assert.equal(long('video_end', 70), 'Long for an end line: 70 characters (aim for 60 or fewer)');
  assert.equal(long('video_script', 500), undefined);
});

test('Check copy reads a video\'s words: opening line, end line, script and caption land in the right field for the territory\'s format', async () => {
  const r = await fresh(true);
  const p = Bulk.parseBulk(['persona\tterritory\tfield\ttext',
    'OWN\tFilm\topening line\tHe gets the best of everything.',
    'OWN\tFilm\tEnd line\tTrupanion. Medical insurance for pets. Get a quote.',
    'OWN\tFilm\tscript\tThis is Molly. She has been with us about a year.',
    'OWN\tFilm\tcaption\tTrupanion is medical insurance for pets. Get a quote.',
    'OWN\tStill\topening line\tNot a video',
    'OWN\tStill\tscript\tNot a video either',
    'OWN\tStill\ton-image\tVet visits, calmer',
  ].join('\n'), r);
  assert.deepEqual(p.rows.map(x => [x.territory, x.field]), [['OWN_FILM', 'video_open'], ['OWN_FILM', 'video_end'], ['OWN_FILM', 'video_script'], ['OWN_FILM', 'meta_primary'], ['OWN_STILL', 'meta_on_image']]);
  assert.deepEqual(p.errors.map(e => [e.n, /is a video's line, and Still is a static ad/.test(e.error)]), [[6, true], [7, true]]);
  // A video field named outright on a static is refused the same way.
  const q = Bulk.parseBulk('persona\tterritory\tfield\ttext\nOWN\tStill\tvideo_end\tx', r);
  assert.match(q.errors[0].error, /isn't used on a static ad/);
});

test('Pre-flight copy match: a script is spoken, so it is not looked for in the frames; the opening and end lines are', () => {
  const rules = { compliance: [], fields: { video_script: { video_role: 'script' }, video_open: { video_role: 'open' } } };
  const copy = (field: string, text: string) => ({ line_id: field, field, label: field, text, version: 1 });
  const lines = [copy('video_open', 'He gets the best of everything.'), copy('video_script', 'This is Molly. She has been with us about a year.'), copy('meta_primary', 'Post copy')];
  const frames = [{ where: 'frame 1', text: 'He gets the best of everything.' }, { where: 'last frame', text: 'Trupanion' }];
  const res = copyMatchForStub(lines, frames, rules, 'video');
  assert.equal(res.flags.some(f => /script|Molly/i.test(`${f.label} ${f.quote || ''}`)), false);
  assert.equal(res.rows.some((x: any) => /Molly/.test(JSON.stringify(x))), false);
});
