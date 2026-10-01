// Legal small print on an asset isn't checked as ad copy (production test, 1 Oct, finding 30: a red FIG_UNSOURCED
// for "6100", from Trupanion's address in the small print). services/audit/smallPrint.ts, used by copyFlags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isSmallPrint, withoutSmallPrint } from '../src/services/audit/smallPrint.js';
import { copyFlags } from '../src/services/audit/copyChecks.js';
import { loadRules } from '../src/services/audit/rules.js';

const SMALL = 'Trupanion is a registered trademark owned by Trupanion, Inc. Underwritten in the US by American Pet Insurance Company, 6100 4th Ave S, Seattle, WA 98108. Call (855) 210-0047.';

test('small print: trademark, underwriter, address and phone lines are small print; ad copy is not', () => {
  for (const s of ['Trupanion is a registered trademark owned by Trupanion, Inc.', 'Underwritten in the US by American Pet Insurance Company', '6100 4th Ave S, Seattle, WA 98108', 'Call (855) 210-0047', 'License No. 0E67023']) assert.ok(isSmallPrint(s), s);
  for (const s of ['Healthy today. $6,000 emergency surgery tomorrow.', 'Join 1.5M owners.', 'Build your plan in 60 seconds!', 'Over 7,000 owners switched their way.', '2 dogs, 1 street, zero vet stress.'])
    assert.equal(isSmallPrint(s), false, s);
  // The approved disclaimer text, when the rules have one.
  assert.ok(isSmallPrint('Policy terms, conditions and waiting periods vary by state', 'Policy terms, conditions and waiting periods vary by state.'));
  // A line with copy and small print keeps the copy.
  assert.equal(withoutSmallPrint(`Join 1.5M owners.\n${SMALL}`), 'Join 1.5M owners.');
});

test('the figure check skips the small print on an asset, and still catches a figure in the copy', () => {
  const rules = loadRules(path.join(__dirname, 'fixtures/audit/rules.example.json'));
  const fig = (text: string) => copyFlags([{ where: 'image', text, onImage: true }], rules, 'OWN').filter(f => f.rule === rules.figure_rule.id);
  assert.deepEqual(fig(`Calm at the counter.\n${SMALL}`), [], 'no figure flag from the address or phone number');
  const caught = fig(`Over 7,000 owners switched.\n${SMALL}`);
  assert.equal(caught.length, 1);
  assert.equal(caught[0].quote, '7,000');
});

// 30b (production, 1 Oct): the end card's small print as the audit read it, one long line per size.
const END_1x1 = '© 2023 Trupanion. 6100-4th Ave S, Seattle, WA 98108. Underwritten in Canada by Omega General Insurance Company and in the United States by American Pet Insurance Company, 6100-4th Ave S, Seattle, WA 98108. Please visit AmericanPetInsurance.com to review all available pet health insurance products. Terms and conditions apply. Trupanion is a registered trademark owned by Trupanion, Inc.';
const END_4x5 = 'Underwritten by Omega General Insurance Company. Trupanion is a registered trademark owned by Trupanion, Inc. Underwritten in Canada by Omega General Insurance Company and distributed by its affiliate, Canada Pet Health Insurance Services, Inc. dba Trupanion. 6100-6th Avenue South, Seattle, WA 98108. Terms and conditions apply. See policy for details. Visit Trupanion.com for more information.';
const END_9x16 = 'Terms and conditions apply. See policy for details. Trupanion is a registered trademark owned by Trupanion, Inc. Underwritten in Canada by Omega General Insurance Company and in the United States by American Pet Insurance Company, 6100-4th Ave S, Seattle, WA 98108. Please visit AmericanPetInsurance.com';

test('30b: a card\'s small print as one long paragraph is all small print, on every size; copy before it on the line is kept', () => {
  for (const t of [END_1x1, END_4x5, END_9x16]) assert.equal(withoutSmallPrint(t), '', t.slice(0, 40));
  assert.equal(withoutSmallPrint(`Build your plan in 60 seconds! ${END_1x1}`), 'Build your plan in 60 seconds!');
  assert.equal(withoutSmallPrint(`Protect them for life\n${END_4x5}`), 'Protect them for life');
  // An address on its own, hyphenated as the OCR gave it, with the ZIP after the state.
  assert.ok(isSmallPrint('6100-4th Ave S, Seattle, WA 98108.'));
  assert.ok(isSmallPrint('6100-6th Avenue South, Seattle, WA 98108.'));
  const rules = loadRules(path.join(__dirname, 'fixtures/audit/rules.example.json'));
  const fig = (text: string) => copyFlags([{ where: 'card 4', text, onImage: true }], rules, 'OWN').filter(f => f.rule === rules.figure_rule.id);
  for (const t of [END_1x1, END_4x5, END_9x16]) assert.deepEqual(fig(`Protect them for life. ${t}`), [], 'no "6100" or "98108" figure flag');
  assert.equal(fig(`Over 7,000 owners switched. ${END_1x1}`)[0]?.quote, '7,000', 'a figure in the copy is still caught');
});
