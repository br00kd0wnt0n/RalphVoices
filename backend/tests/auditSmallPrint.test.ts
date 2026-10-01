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
