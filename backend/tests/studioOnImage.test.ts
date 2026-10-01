// A new META field in the rules (rules v2.10's meta_on_image: text on the image)
// flows through without code changes: Write & brief, the writer prompt, the
// deterministic checks (limits, sentence case), Shortlist codes, Ready, and
// Pre-flight's copy match (as on-image copy, which must be on the asset).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import * as R from '../src/services/studio/ready.js';
import { FileStore } from '../src/services/studio/store.js';
import { signedOffCopy } from '../src/services/studio/preflightB2.js';
import { COPY_FIELDS } from '../src/services/audit/copyMatch.js';

const ON_IMAGE = { platform: 'META', label: 'On-image text (static, carousel card, video end card)', visible: 40, max: 60, source: 'HOUSE: test' };

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-onimage-'));
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  rules.fields.meta_on_image = ON_IMAGE;
  const rulesPath = path.join(dir, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify(rules));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath }));
  return S.refreshRules();
}

test('meta_on_image: listed, briefed, written for the visual, checked, coded and matched on the asset', async () => {
  const r = await fresh();
  assert.ok((await S.meta()).fields.meta_on_image, 'Write & brief lists it (meta.fields)');
  const b = S.makeBrief({ territory: 'OWN_CALM', fields: ['meta_on_image'], n: 3 });
  assert.deepEqual(b.fields, ['meta_on_image']);

  // The writer is told what it is: text on the image, with the visual, not a second headline; and its target length.
  const api = new S.Api({ mock: true });
  const systems: string[] = [];
  const chat = api.chat.bind(api);
  api.chat = (async (o: any) => { if (o.stage === 'generate') systems.push(o.system); return chat(o); }) as any;
  await S.generate(b, api, () => {}, { check: false, user: 'nick' });
  assert.match(systems[0], /meta_on_image: On-image text .* aim for 30 characters or fewer \(40 visible\)\. This is the text that sits on the image itself/);
  assert.match(systems[0], /not a second headline/);
  assert.equal(S.fieldGuidance('meta_on_image', { ...r, fields: { ...r.fields, meta_on_image: { ...ON_IMAGE, writer_note: 'From the rules.' } } } as any), 'From the rules.', 'the rules can say it instead');

  // Deterministic checks: its own limits, and all caps is a warning (sentence case; caps are a design treatment).
  const long = S.deterministicFlags({ text: 'Your summer trip stays booked, whatever the vet says today', field: 'meta_on_image', structure: 'plain_promise', persona: 'OWN' }, r).flags;
  assert.ok(long.some(f => f.rule === 'LIMIT_ON_ASSET' && /^Long for on-image text/.test(f.label)), 'long for the image, never "truncated" (1 Oct)');
  const caps = S.deterministicFlags({ text: 'VET BILL? SORTED.', field: 'meta_on_image', structure: 'plain_promise', persona: 'OWN' }, r).flags;
  assert.ok(caps.some(f => f.rule === 'BR_CASE'), 'all caps is flagged');

  // Shortlist codes and Ready: a META code, like any other META field.
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'oi', own_lines: [{ text: 'Vet bill? Sorted.', field: 'meta_on_image' }] }), api, () => {}, { ownOnly: true, user: 'nick' });
  await S.setDecision(run.id, run.lines[0].id, { decision: 'keep' }, 'nick');
  const row = (await S.shortlist()).find(x => x.id === run.lines[0].id)!;
  assert.equal(row.stub, '', 'on-image text gets no code of its own: it goes with a visual (at Ready)');
  const rv = await R.readyView('OWN', 'OWN_CALM');
  assert.equal(rv.lines[0].line.field, 'meta_on_image');
  assert.equal(rv.lines[0].role, 'per_visual');

  // Pre-flight: signed-off on-image copy must be on the asset, and the audit's rule checks see it as meta_on_image.
  const copy = signedOffCopy([{ line_id: 'x', field: 'meta_on_image', label: ON_IMAGE.label, text: 'Vet bill? Sorted.', version: 1 }]);
  assert.deepEqual(copy, { on_image: 'Vet bill? Sorted.' });
  assert.equal(COPY_FIELDS.on_image.onAsset, 'must');
  assert.equal(COPY_FIELDS.on_image.field, 'meta_on_image');
});
