// A rule's not_examples reach the model check and the yes/no wordings (production test, 1 Oct: "Healthy today.
// $5,000 emergency surgery tomorrow." was flagged red as "pays for itself"). The mock makes that false positive
// unless the rule lists the line as not a breach, so this checks the examples get to both prompts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-notex-'));
S.setStudioDir(dir);
const example = path.join(__dirname, '../scripts/studio/rules.example.json');
const LINE = 'Healthy today. $5,000 emergency surgery tomorrow.';

async function check(rulesPath: string) {
  S.setRulesPath(rulesPath);
  await S.refreshRules();
  const [l] = await S.checkTexts('OWN', 'OWN_CALM', [{ text: LINE, field: 'meta_primary' }], new S.Api({ mock: true }));
  return l.flags.find(f => f.rule === 'COMP_PAYS_FOR_ITSELF');
}

test('not_examples: without them the cost line is a red "pays for itself" (the live false positive)', async () => {
  const r = JSON.parse(fs.readFileSync(example, 'utf8'));
  for (const c of r.compliance) delete c.not_examples;
  const p = path.join(dir, 'rules-without.json');
  fs.writeFileSync(p, JSON.stringify(r));
  const f = await check(p);
  assert.ok(f, 'the mock reproduces the false positive');
  assert.equal(f.severity, 'compliance');
});

test('not_examples: listed as not a breach, the line is clear in both the model check and the yes/no wordings', async () => {
  const r = JSON.parse(fs.readFileSync(example, 'utf8'));
  assert.deepEqual(r.compliance.find((c: any) => c.id === 'COMP_PAYS_FOR_ITSELF').not_examples, [LINE]);
  assert.equal(await check(example), undefined);
});

test('not_examples: a real "pays for itself" line is still red', async () => {
  S.setRulesPath(example);
  await S.refreshRules();
  const [l] = await S.checkTexts('OWN', 'OWN_CALM', [{ text: 'Honestly, it pays for itself.', field: 'meta_primary' }], new S.Api({ mock: true }));
  assert.equal(l.flags.find(f => f.rule === 'COMP_PAYS_FOR_ITSELF')?.severity, 'compliance');
});
