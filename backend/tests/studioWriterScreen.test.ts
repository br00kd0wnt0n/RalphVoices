// Writer quality (production test, 1 Oct): a red direct-pay line, primary texts that never said what's sold, and
// headlines past their visible length all reached Review. The writer is now told the hard rules as MUST, and
// written lines that break a deterministic red or run past a headline's or hook's visible length are dropped (and
// rewritten in the next round) before anyone sees them. Example rules, mock client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import { FileStore } from '../src/services/studio/store.js';

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-screen-'));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath: path.join(__dirname, '../scripts/studio/rules.example.json') }));
  return S.refreshRules();
}
const cell = (field: string) => ({ field, structure: 'plain_promise' as const });

test('screen: a deterministic red or an over-length headline/hook is dropped; a clean line, or a long primary text, is not', async () => {
  const r = await fresh();
  const b = { persona: 'OWN', banned_words: [] };
  const direct = S.screenWritten('Skip the paperwork: we pay your vet directly.', cell('meta_primary'), r, b);
  assert.equal(direct?.rule, 'COMP_DIRECT_PAY');
  assert.match(direct!.reason, /broke a client rule/);
  assert.equal(S.screenWritten('We pay your vet directly at partner clinics.', cell('meta_primary'), r, b), null);
  assert.equal(S.screenWritten('Honestly, it pays for itself.', cell('meta_primary'), r, b)?.rule, 'COMP_PAYS_FOR_ITSELF');
  // Headlines and hooks past their visible length (27 for the example's headline).
  assert.equal(S.screenWritten('Even superheroes need a sidekick.', cell('meta_headline'), r, b)?.rule, 'LIMIT_VISIBLE');
  assert.equal(S.screenWritten('Calm at the counter.', cell('meta_headline'), r, b), null);
  // Primary text past its visible length is long, not dropped (Review sorts it last).
  assert.equal(S.screenWritten('Calm '.repeat(30).trim() + '.', cell('meta_primary'), r, b), null);
  assert.equal(S.droppedSummary([{ text: 'x', cell: 'a', reason: 'broke', rule: 'COMP_DIRECT_PAY' }, { text: 'y', cell: 'b', reason: 'long', rule: 'LIMIT_VISIBLE' }, { text: 'z', cell: 'c', dup_of: 'L1', similarity: 0.95 }]),
    '2 lines dropped before you saw them: broke a client rule (1), over the visible length (1)');
  assert.equal(S.droppedSummary([]), '');
});

test('writer prompt: the hard rules are MUST, primary text names the product, short fields state their limit', async () => {
  const r = await fresh();
  const sys = S.writerSystem(S.makeBrief({ territory: 'OWN_CALM', fields: ['meta_primary', 'meta_headline'] }), r);
  const must = sys.split('MUST')[1].split('RULES THAT BIND EVERY LINE')[0];
  assert.match(must, /Direct pay always says 'at partner clinics'/);
  assert.match(must, /pays for itself/i);
  assert.match(must, /Every primary text and caption names Trupanion or says medical insurance for pets/);
  assert.match(must, /27 characters/);
  assert.match(must, /Figures only from the facts list/);
});

test('generate: a written line that breaks direct pay is dropped, recorded with its reason, and replaced', async () => {
  await fresh();
  const api = new S.Api({ mock: true });
  const BAD = 'Who wants paperwork when Trupanion pays your vet directly?';
  const chat = api.chat.bind(api);
  let injected = false;
  api.chat = (async (o: any) => {
    const res = await chat(o);
    if (o.stage === 'generate' && !injected) {
      const j = JSON.parse(res.text);
      j.lines[0].text = BAD;
      injected = true;
      return { ...res, text: JSON.stringify(j) };
    }
    return res;
  }) as any;
  const statuses: string[] = [];
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', fields: ['meta_primary'], n: 4, field_counts: { meta_primary: 4 } }), api, e => { if (e.type === 'status') statuses.push(e.message); }, { check: false, user: 'nick' });
  assert.ok(!run.lines.some(l => l.text === BAD), 'never shown');
  const d = run.dropped.find(x => x.text === BAD);
  assert.equal(d?.rule, 'COMP_DIRECT_PAY');
  assert.equal(run.lines.filter(l => l.field === 'meta_primary').length, 4, 'the count is still met');
  assert.ok(statuses.some(m => /1 line dropped before you saw it: broke a client rule \(1\)/.test(m)));
});
