// Figures match the facts list however they're written (production test, 1 Oct: "Can you afford a $6k vet
// bill?" got FIG_UNSOURCED although the facts have $6,000). utils/figures.ts, used by Studio's line checks
// and the B2 audit.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { figureKey } from '../src/utils/figures.js';
import * as S from '../src/services/studio/engine.js';
import { figuresIn as auditFiguresIn } from '../src/services/audit/copyChecks.js';

test('figure key: k/K, M, million and commas are the same number', () => {
  for (const f of ['$6k', '$6K', '6k', '$6,000', '6000', '$6 k']) assert.equal(figureKey(f), '6000', f);
  assert.equal(figureKey('10k'), '10000');
  assert.equal(figureKey('$1.5k'), '1500');
  assert.equal(figureKey('$1,500'), '1500');
  assert.equal(figureKey('2.1M'), '2100000');
  assert.equal(figureKey('2.1 million'), '2100000');
  assert.equal(figureKey('2,100,000'), '2100000');
  assert.equal(figureKey('1.15k'), '1150'); // no floating-point tail
  assert.equal(figureKey('$2bn'), '2000000000');
  assert.equal(figureKey('81%'), '81%');
  assert.equal(figureKey('2x'), '2x');
  assert.notEqual(figureKey('$6k'), figureKey('$600'));
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fig-'));
S.setStudioDir(dir);
S.setRulesPath(path.join(__dirname, '../scripts/studio/rules.example.json'));
let rules: S.Rules;
before(async () => {
  const base = await S.refreshRules();
  rules = { ...base, facts: [...base.facts, { id: 'F_SURGERY', claim: 'Emergency surgery can cost $6,000', numbers: ['$6,000'], source: 'example' } as any] };
});
const unsourced = (text: string) => S.deterministicFlags({ text, field: 'meta_headline', structure: 'question', persona: 'OWN' }, rules).flags.find(f => f.rule === rules.figure_rule.id);

test('studio checks: $6k matches a $6,000 fact; an unlisted figure is still flagged', () => {
  assert.equal(unsourced('Can you afford a $6k vet bill?'), undefined);
  assert.equal(unsourced('Can you afford a $6,000 vet bill?'), undefined);
  assert.equal(unsourced('Join 1.5 million owners.'), undefined); // the example's fact is "1.5M"
  assert.equal(unsourced('Join 1,500,000 owners.'), undefined);
  const f = unsourced('Can you afford a $7k vet bill?');
  assert.ok(f);
  assert.equal(f.quote, '$7k');
});

test('audit reads the same figures', () => {
  assert.deepEqual(auditFiguresIn('A $6k bill, $1.5k deductible, 2.1M pets').map(figureKey), ['6000', '1500', '2100000']);
});
