// Overridden red flags shown once each in Assets' decision panel (production test, 1 Oct, finding 21):
// frontend/src/lib/overrideGroups.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupOverrides, overrideWhere } from '../../frontend/src/lib/overrideGroups.js';
import { sameTextAcrossSizes, textRule } from '../src/services/studio/preflight.js';

test('the same copy override on three codes, plus the asset check, is two entries naming where each applies', () => {
  const label = 'Every figure must come from the facts list', reason = 'The client approved $5,000';
  const g = groupOverrides([
    { kind: 'copy', label, reason, code: 'A1', by: 'nick' }, { kind: 'copy', label, reason, code: 'A2', by: 'nick' }, { kind: 'copy', label, reason, code: 'A3', by: 'nick' },
    { kind: 'asset', label, reason: 'Same as at sign-off' },
  ]);
  assert.equal(g.length, 2);
  assert.equal(overrideWhere(g[0]), 'on the copy at sign-off, A1, A2 and A3, by nick');
  assert.equal(overrideWhere(g[1]), 'in the asset check (every code on it)');
  // A different reason is a different override.
  assert.equal(groupOverrides([{ kind: 'copy', label, reason: 'a', code: 'A1' }, { kind: 'copy', label, reason: 'b', code: 'A2' }]).length, 2);
});

test('sizes: the same words on every size (case and punctuation aside) get one verdict per text rule; visual rules stay per size', () => {
  const t = (s: string) => ({ asset_text: [{ where: 'image', text: s }], text_found: s });
  assert.equal(sameTextAcrossSizes([t('7 in 10 owners WISH they had it.'), t('7 in 10 owners wish they had it')]), true);
  assert.equal(sameTextAcrossSizes([t('7 in 10 owners'), t('Build your plan')]), false);
  const rules = { compliance: [{ id: 'COMP_FACT_FRAMING' }, { id: 'COMP_VIS_ONLY', applies_to: 'visual' }], brand: [{ id: 'BR_LOGO', applies_to: 'visual' }, { id: 'BR_VOICE' }], clarity: [] };
  assert.equal(textRule(rules, 'COMP_FACT_FRAMING'), true);
  assert.equal(textRule(rules, 'FIG_UNSOURCED'), true);
  assert.equal(textRule(rules, 'COMP_VIS_ONLY'), false);
  assert.equal(textRule(rules, 'BR_LOGO'), false);
  assert.equal(textRule(rules, 'BR_VOICE'), true);
  assert.equal(textRule(rules, 'TEXT_LOAD'), false, 'a rubric or layout check is per size');
});
