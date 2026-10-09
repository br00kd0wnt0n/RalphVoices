// The Pre-flight flag report: pure rendering (services/studio/flagReport.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksToHtml, blocksToMarkdown, flagReportBlocks, flagReportRows, mergeAdFlags, needsDoing, quoteWords, type FlagReportInput, type ReportAd } from '../src/services/studio/flagReport.js';

const ad = (over: Partial<ReportAd> = {}): ReportAd => ({
  ad: 'DINK_CHECKOUT_ST_A_US_META', asset: 'Easy Checkout', persona: 'DINKs', region: 'US', kind: 'static',
  upload: { files: [{ filename: 'checkout_1x1.png', size: '1:1' }], uploaded_by: 'vivan@ralph.world', uploaded_at: '2026-10-09T10:00:00Z' },
  sizes: { expected: ['1:1', '4:5'], uploaded: ['1:1'], missing: ['4:5'] },
  audit: { status: 'done', finished_at: '2026-10-09T10:05:00Z', started_by: 'vivan@ralph.world', rules_version: 'v2.17', notes: ['No OCR cross-check; on-image text is vision only'] },
  flags: [
    { rule: 'DISCLAIMER_LAST_SCREEN', severity: 'red', label: 'The approved disclaimer appears on the final frame: the US disclaimer is expected on this US asset', source: 'Trupanion', size: '1:1' },
    { rule: 'COMP_DIRECT_PAY', severity: 'red', label: 'Direct pay needs “at participating hospitals”.', quote: 'Trupanion can pay your vet directly', why: 'No caveat', source: 'Compliance checklist', override: { reason: 'Trupanion accepted it', by: 'vivan@ralph.world', for: 'nick@ralph.world', at: '2026-10-09T11:00:00Z' } },
    { rule: 'COPY_MATCH', severity: 'amber', label: 'On-image text differs from the signed-off wording', quote: 'signed off: "Your kid" · on the asset: "You kid"', where: 'card 2', agreements: [{ by: 'brook@ralph.world', agree: true, note: 'typo', at: '2026-10-09T12:00:00Z' }] },
    { rule: 'CUR_T_BABY', severity: 'grey', label: 'How another persona might read it', cross_persona: true, persona: 'Curators' },
  ],
  ...over,
});
const input = (ads: ReportAd[]): FlagReportInput => ({ title: 'Pre-flight flag report', scope: 'Month 1 · US', at: '2026-10-09T13:00:00Z', by: 'brook@ralph.world', rules_version: 'v2.17', ads, notes: { DISCLAIMER_LAST_SCREEN: 'To be confirmed with the client: must a static carry it on the image?' } });

test('what needs doing: reds to fix apart from reds on an open question, overridden ones not counted', () => {
  const words = needsDoing(ad(), input([]).notes);
  assert.match(words, /1 red on an open question: The approved disclaimer appears on the final frame\./);
  assert.doesNotMatch(words, /Fix or override/);
  assert.match(words, /1 amber to look at\. 4:5 not uploaded\./);
  assert.equal(needsDoing(ad({ upload: null })), 'Artwork not uploaded yet.');
  assert.equal(needsDoing(ad({ audit: null })), 'Uploaded, not checked yet.');
  assert.match(needsDoing(ad({ flags: [ad().flags[1]] })), /No open red \(1 overridden\)/);
});

test('the report: internal, key, summary, open question once, flags by severity with place, override, marks and the footer', () => {
  const md = blocksToMarkdown(flagReportBlocks(input([ad(), ad({ ad: 'DINK_SOCK_ST_A_US_META', asset: 'Sock Eater', upload: null, audit: null, flags: [] })])));
  assert.match(md, /Internal: for the Ralph team, not for Add3 or Trupanion/);
  assert.match(md, /\| Easy Checkout \(DINKs, static\) \| 1:1 \| 2 \| 1 \|/);
  assert.match(md, /No artwork uploaded yet \(1\):\*\* Sock Eater \(DINKs\)/);
  assert.match(md, /## Open questions behind some flags\n\n- \*\*The approved disclaimer[^\n]*To be confirmed with the client/);
  assert.ok(md.indexOf('### Red (2)') < md.indexOf('### Amber (1)') && md.indexOf('### Amber (1)') < md.indexOf('### Note (1)'));
  assert.match(md, /\(1:1\)\. _Status: To be confirmed with the client/);
  assert.match(md, /On the asset: “Trupanion can pay your vet directly”/);
  assert.match(md, /Overridden by vivan@ralph\.world for nick@ralph\.world, 9 Oct 2026: “Trupanion accepted it”/);
  assert.match(md, /\(card 2\)\. Signed off: "Your kid" · on the asset: "You kid"\. brook@ralph\.world agrees: “typo”/);
  assert.match(md, /How Curators would read it; this ad is not aimed at them/);
  assert.match(md, /checkout_1x1\.png \(1:1\)\. Uploaded by vivan@ralph\.world, 9 Oct 2026\. Checked 9 Oct 2026 \(started by vivan@ralph\.world\), rules v2\.17\. No OCR cross-check/);
  assert.doesNotMatch(md, /compliance (cleared|pending)|changes requested/i);
});

test('the page for a doc: headings, a table and bold, with the text escaped', () => {
  const html = blocksToHtml(flagReportBlocks(input([ad({ asset: 'Fish & <Chips>' })])), 'Flags');
  assert.match(html, /<h2>Fish &amp; &lt;Chips&gt; \(DINKs\)<\/h2>/);
  assert.match(html, /<table[^>]*>\n<thead><tr><th align="left">Ad<\/th>/);
  assert.match(html, /<strong>Red<\/strong> breaks a client rule/);
  assert.match(html, /<em>Status: To be confirmed with the client: must a static carry it on the image\?<\/em>/);
});

test('the sheet: marked internal, one row per flag, an ad without artwork still listed', () => {
  const rows = flagReportRows(input([ad(), ad({ asset: 'Sock Eater', upload: null, audit: null, flags: [] })]));
  assert.match(rows[0][0], /Internal/);
  assert.equal(rows.length, 2 + 4 + 1);
  assert.equal(rows[2][4], 'Red');
  assert.equal(rows[2][9], input([]).notes!.DISCLAIMER_LAST_SCREEN);
  assert.equal(rows[6][6], 'Artwork not uploaded yet.');
});

test('an ad’s flags from its codes: one entry each, naming the copy options when not all', () => {
  const shared = { rule: 'BR_CASE', severity: 'amber' as const, label: 'All caps' };
  const own = { rule: 'COPY_MATCH', severity: 'red' as const, label: 'Differs', quote: 'x' };
  const merged = mergeAdFlags([{ code: 'DINK_SOCK_ST_A1_US_META', flags: [shared] }, { code: 'DINK_SOCK_ST_A2_US_META', flags: [shared, own] }]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].options, [2]);
  assert.equal(merged[1].options, undefined);
  assert.equal(quoteWords('approved: "Text"'), 'Approved: "Text"');
  assert.equal(quoteWords('signed off for card 1: "Text"'), 'Signed off for card 1: "Text"');
  const sized = mergeAdFlags([{ code: 'X_A1_US_META', flags: [{ rule: 'CL_PRODUCT', severity: 'amber', label: '1:1: Product unclear', size: '1:1' }, { rule: 'CL_PRODUCT', severity: 'amber', label: '4:5: Product unclear', size: '4:5' }] }]);
  assert.deepEqual(sized.map(f => [f.label, f.size]), [['Product unclear', '1:1, 4:5']]);
});
