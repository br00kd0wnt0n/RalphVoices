// Production test, 1 Oct, findings 11–13 (example rules, mock client):
// 11. "Build your plan in 60 seconds!" read as claim speed: the rule's not_examples clear it; a real one stays red.
// 12. "worth every cent" and "the math adds up" went unflagged: deterministic patterns on the not-an-investment rule.
// 13. A US survey figure in a Canadian line: facts carry regions; a CA brief isn't offered it and a CA line using it
//     is flagged, saying why. And no "eh": a Canadian cliché is dropped before anyone sees it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import { FileStore } from '../src/services/studio/store.js';

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-rulesfix-'));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath: path.join(__dirname, '../scripts/studio/rules.example.json') }));
  return S.refreshRules();
}
const det = (r: S.Rules, text: string, region: 'US' | 'CA' = 'US', field = 'meta_primary') => S.deterministicFlags({ text, field, structure: 'plain_promise', persona: 'OWN', region }, r).flags;

test('11. a speed that is not about claims is clear; claims paid in seconds is still red', async () => {
  await fresh();
  const api = new S.Api({ mock: true });
  const [plan, every] = await S.checkTexts('OWN', 'OWN_CALM', [{ text: 'Build your plan in 60 seconds!', field: 'meta_primary' }, { text: 'Every claim paid in seconds, at partner clinics.', field: 'meta_primary' }], api);
  assert.equal(plan.flags.find(f => f.rule === 'COMP_CLAIM_SPEED'), undefined);
  assert.equal(every.flags.find(f => f.rule === 'COMP_CLAIM_SPEED')?.severity, 'compliance');
  // Without the not_example, the mock makes the live false positive.
  const r = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/studio/rules.example.json'), 'utf8'));
  delete r.compliance.find((c: any) => c.id === 'COMP_CLAIM_SPEED').not_examples;
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-')), 'rules.json');
  fs.writeFileSync(p, JSON.stringify(r));
  S.setRulesPath(p);
  S.setStore(new FileStore(fs.mkdtempSync(path.join(os.tmpdir(), 'rf2-')), { rulesPath: p }));
  await S.refreshRules();
  const [again] = await S.checkTexts('OWN', 'OWN_CALM', [{ text: 'Build your plan in 60 seconds!', field: 'meta_primary' }], api);
  assert.ok(again.flags.find(f => f.rule === 'COMP_CLAIM_SPEED'));
});

test('12. "worth every cent", "the math adds up" and "worth the money" are flagged on the words alone; "worth it" is a warning', async () => {
  const r = await fresh();
  const of = (t: string) => det(r, t).find(f => f.rule === 'COMP_NOT_INVESTMENT');
  assert.equal(of('One big vet bill made it worth every cent.')?.severity, 'compliance');
  assert.equal(of('Vet bill math adds up.')?.severity, 'compliance');
  assert.equal(of('Worth the money, every month.')?.severity, 'compliance');
  assert.equal(of('Your dog? Worth it.')?.severity, 'warn');
  assert.equal(of('Vet bills add up fast.'), undefined, 'costs adding up is not a value claim');
  // The writer is told: the rule is in its MUST list.
  assert.match(S.writerSystem(S.makeBrief({ territory: 'OWN_CALM' }), r), /MUST[\s\S]*worth every cent[\s\S]*RULES THAT BIND/);
});

test('13. a US-only fact is not offered to a Canadian brief, and using its figure in a Canadian line is flagged with why', async () => {
  const r = await fresh();
  // The example's F_SURVEY (81%) is tagged regions ['US'].
  assert.equal(det(r, '81% of owners say it helps.', 'US').find(f => f.rule === r.figure_rule.id), undefined);
  const ca = det(r, '81% of owners say it helps.', 'CA').find(f => f.rule === r.figure_rule.id);
  assert.equal(ca?.severity, 'compliance');
  assert.match(ca!.why!, /from F_SURVEY, which holds in US only, not Canada/);
  assert.equal(det(r, 'Join 1.5M owners.', 'CA').find(f => f.rule === r.figure_rule.id), undefined, 'an untagged fact holds in both');
  const caSys = S.writerSystem(S.makeBrief({ territory: 'OWN_CALM', region: 'CA' }), r);
  const usSys = S.writerSystem(S.makeBrief({ territory: 'OWN_CALM' }), r);
  assert.match(usSys, /81%/);
  assert.doesNotMatch(caSys, /81%/);
  assert.match(caSys, /MUST: never write "eh"/);
  // A Canadian cliché is dropped before anyone sees it; the same words in a US line aren't.
  assert.equal(S.screenWritten('Peace of mind, eh?', { field: 'meta_primary', structure: 'question' }, r, { persona: 'OWN', banned_words: [], region: 'CA' })?.rule, 'CA_CLICHE');
  assert.equal(S.screenWritten('Peace of mind for every vet visit, with Trupanion.', { field: 'meta_primary', structure: 'plain_promise' }, r, { persona: 'OWN', banned_words: [], region: 'CA' }), null);
});
