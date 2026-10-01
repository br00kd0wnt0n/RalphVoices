// Who to cast (rules v2.12, from Trupanion's 60-day breed data): a top-level
// `casting` block is kept when rules load, passed to the page on /meta (every
// persona's "Who this is" panel and the Rules view), and its writer_note goes
// into the writer prompt as a PETS line. Made-up notes on the example rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import { FileStore } from '../src/services/studio/store.js';

async function fresh(casting?: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-casting-'));
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  if (casting) rules.casting = casting;
  const rulesPath = path.join(dir, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify(rules));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath }));
  return S.refreshRules();
}
const CASTING = {
  _note: 'Example only.',
  notes: [{ text: 'Cats are a big share of new pets: plan cat-led assets.', source: 'Example breed data' }, { text: 'Flat-faced breeds sparingly.', source: 'Example brand guide', caution: true }],
  writer_note: 'Write for cats as often as dogs; everyday mixed breeds lead.',
};
async function writerSystem() {
  const api = new S.Api({ mock: true });
  let system = '';
  const chat = api.chat.bind(api);
  api.chat = (async (o: any) => { if (o.stage === 'generate' && !system) system = o.system; return chat(o); }) as any;
  await S.generate(S.makeBrief({ territory: 'OWN_CALM', n: 2 }), api, () => {}, { check: false, user: 'nick' });
  return system;
}

test('a casting block loads with the rules, reaches /meta (notes, sources, caution) and the writer (a PETS line)', async () => {
  const r = await fresh(CASTING);
  assert.equal(r.casting?.notes?.length, 2, 'kept when the rules load (unknown top-level keys are accepted)');
  const m: any = await S.meta();
  assert.deepEqual(m.casting, { notes: [{ text: CASTING.notes[0].text, source: 'Example breed data', caution: false }, { text: CASTING.notes[1].text, source: 'Example brand guide', caution: true }] });
  assert.match(await writerSystem(), /PETS: Write for cats as often as dogs; everyday mixed breeds lead\./);
});

test('without a casting block: nothing on /meta, no PETS line', async () => {
  await fresh();
  assert.equal(((await S.meta()) as any).casting, null);
  assert.doesNotMatch(await writerSystem(), /PETS:/);
});
