// What goes to Trupanion about an overridden red flag (production test, 1 Oct, finding 16): one sentence per
// override, "<field>: '<quote>' went through sign-off despite '<rule>'. Please check it.", never the internal rule
// text, the reason, who, or "approved".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import * as R from '../src/services/studio/ready.js';
import { FileStore } from '../src/services/studio/store.js';

test('rule names: the rules\' short name, else the first clause only', () => {
  const r = { compliance: [
    { id: 'A', rule: 'Every figure in a line must come from the facts list. Small counts are allowed. The largest payout stays out until confirmed.' },
    { id: 'B', rule: "Direct pay is always stated 'at participating hospitals' (or 'participating veterinary practices', the client's wording)." },
    { id: 'C', rule: 'No overclaiming claim speed: the allowed fact is…', short: 'claim speed' },
  ], brand: [], figure_rule: { id: 'FIG', rule: 'Every figure must come from the facts list.' } } as any;
  assert.equal(R.ruleName(r, 'A'), 'Every figure in a line must come from the facts list');
  assert.equal(R.ruleName(r, 'B'), "Direct pay is always stated 'at participating hospitals'");
  assert.equal(R.ruleName(r, 'C'), 'claim speed');
  assert.equal(R.ruleName(r, 'FIG'), 'Every figure must come from the facts list');
  assert.equal(R.clientOverrideLine('Meta primary text', '$5,000', 'Every figure must come from the facts list'),
    'Meta primary text: “$5,000” went through sign-off despite “Every figure must come from the facts list”. Please check it.');
});

test("the compliance sheet's Please check is a client-ready sentence per override", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-client-'));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath: path.join(__dirname, '../scripts/studio/rules.example.json') }));
  await S.refreshRules();
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'cw', own_lines: [{ text: 'Over 7,000 owners switched this year.', field: 'meta_primary' }, { text: 'Calm, covered.', field: 'meta_headline' }] }), new S.Api({ mock: true }), () => {}, { ownOnly: true, user: 'nick' });
  const [p, h] = run.lines;
  for (const l of run.lines) await S.setDecision(run.id, l.id, { decision: 'keep' }, 'nick');
  for (const f of R.unresolvedRed((await S.loadBatch(run.id)).lines.find(x => x.id === p.id)!)) await R.overrideFlag(run.id, p.id, f.rule, 'Figure confirmed by the client.', 'nick');
  const versions = [{ visual: 'A', fields: { meta_primary: p.id, meta_headline: h.id } }];
  const v = await R.readyView('OWN', 'OWN_CALM', 'US', { versions, on_image: {} } as any);
  await R.signOff({ persona: 'OWN', territory: 'OWN_CALM', versions, expectation: { codes: [v.plan.versions[0].code], reason: 'x' } } as any, 'nick');
  const csv = S.parseCsv((await R.handoffPack()).complianceCsv);
  const check = csv[1][csv[0].indexOf('Please check')];
  assert.equal(check, 'Meta primary text: “7,000” went through sign-off despite “Every figure must come from the facts list”. Please check it.');
  assert.doesNotMatch(check, /overridden|nick|confirmed by the client|approved/i, 'no reason, names or "approved"');
});
