import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planVariantChunks, mergeVariantBatch, PanelShortError } from '../src/utils/variantChunks.js';
import { attitudeBehaviour, buildRealismContext, livedVoicePrompt, REALISM_SYSTEM_BLOCK } from '../src/utils/realism.js';
import { probabilityYes, averageProbes } from '../src/utils/probes.js';

// ---- panel chunking ----
test('planVariantChunks splits into chunks of 10', () => {
  assert.deepEqual(planVariantChunks(25), [10, 10, 5]);
  assert.deepEqual(planVariantChunks(20), [10, 10]);
  assert.deepEqual(planVariantChunks(7), [7]);
  assert.deepEqual(planVariantChunks(0), []);
});

test('mergeVariantBatch drops duplicate names, junk and overflow', () => {
  const panel = [{ variant_name: 'Alex' }];
  const merged = mergeVariantBatch(panel, [{ variant_name: 'alex ' }, null, { variant_name: '' }, { variant_name: 'Sam' }, { variant_name: 'Jo' }, { variant_name: 'Kim' }], 3);
  assert.deepEqual(merged.map(v => v.variant_name), ['Alex', 'Sam', 'Jo']);
  assert.equal(panel.length, 1, 'input panel is not mutated');
  assert.deepEqual(mergeVariantBatch(panel, 'not an array', 5), panel);
});

test('PanelShortError carries requested and generated counts', () => {
  const e = new PanelShortError(30, 11);
  assert.equal(e.requested, 30);
  assert.equal(e.generated, 11);
  assert.match(e.message, /11 of 30/);
});

// ---- realism ----
test('attitudeBehaviour maps the score to behaviour bands', () => {
  assert.match(attitudeBehaviour(2), /skeptic/);
  assert.match(attitudeBehaviour(5), /neutral/);
  assert.match(attitudeBehaviour(9), /open/);
  assert.equal(attitudeBehaviour(undefined), '');
});

test('buildRealismContext includes brand baseline and attitude', () => {
  const block = buildRealismContext({ brand_context: { category_engagement: 'Low: mostly uninsured', brand_awareness: '', purchase_drivers: ['Transparent cost'], competitor_preferences: [] } }, 3);
  assert.match(block, /mostly uninsured/);
  assert.match(block, /Transparent cost/);
  assert.match(block, /skeptic/);
  assert.doesNotMatch(block, /Brands you know/, 'empty fields are skipped');
  assert.equal(buildRealismContext({}, null), '');
});

test('realism system block anchors 5 as a typical scroll-past ad', () => {
  assert.match(REALISM_SYSTEM_BLOCK, /5 = a typical ad you would scroll past/);
});

test('lived voice prompt forbids the product category and leaves out motivations', () => {
  const p = livedVoicePrompt({ name: 'X', psychographics: { values: ['v'], motivations: ['Trigger 1: never choose money over care'], aspirations: [], pain_points: ['pp'], decision_style: '' } });
  assert.match(p, /Do not mention insurance/);
  assert.doesNotMatch(p, /Trigger 1/);
  assert.doesNotMatch(p, /pp/);
});

// ---- probes ----
test('probabilityYes normalises over yes/no mass and tolerates token shapes', () => {
  const p = probabilityYes([
    { token: 'Yes', logprob: Math.log(0.6) },
    { token: ' no', logprob: Math.log(0.2) },
    { token: 'YES.', logprob: Math.log(0.1) },
    { token: 'Maybe', logprob: Math.log(0.1) },
  ]);
  assert.equal(p, 0.778); // 0.7 / 0.9
  assert.equal(probabilityYes([{ token: 'Maybe', logprob: -0.1 }]), null);
  assert.equal(probabilityYes(null), null);
});

test('averageProbes skips missing values per key', () => {
  const avg = averageProbes([
    { p_stop: 0.2, p_tap: 0.1, p_quote: null },
    { p_stop: 0.4, p_tap: null, p_quote: 0.05 },
    null,
  ]);
  assert.deepEqual(avg, { p_stop: 0.3, p_tap: 0.1, p_quote: 0.05, n: 2 });
  assert.equal(averageProbes([null, undefined]), null);
});
