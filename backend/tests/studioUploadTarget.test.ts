// Finding 25 (production test, 1 Oct): files chosen for FAM_SUMMER_ST_B1 were uploaded to DINK_UNEXPECTED_CAR_A1, the
// first code in the list, after a background refresh moved the selection. frontend/src/lib/uploadTarget.ts decides the
// target (the code whose button was pressed, with its own files) and keeps the selection on a code with files waiting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepSelection, uploadFor, uploadLabel } from '../../frontend/src/lib/uploadTarget.js';

const A1 = 'DINK_UNEXPECTED_CAR_A1_CA_META_TEST', B1 = 'FAM_SUMMER_ST_B1_US_META_TEST', B2 = 'FAM_SUMMER_ST_B2_US_META_TEST';

test('the production sequence: B1 chosen, a file picked for B1, a refresh would move to the first code; the upload still goes to B1', () => {
  const picked = { [B1]: { files: ['B_1x1.png'], sizes: ['1:1'] } };
  // B1's audit state changed, so a "Needs upload or review" filter no longer shows it; A1 is first in the list.
  const shown = [A1, B2], listed = [A1, B1, B2];
  assert.equal(keepSelection(B1, shown, listed, Object.keys(picked)), B1, 'the selection stays on the code with files waiting');
  // Even if something did render another code, its button uploads only that code's own files (none here): nothing goes to A1.
  assert.equal(uploadFor(A1, picked), null);
  assert.deepEqual(uploadFor(B1, picked), { stub: B1, files: ['B_1x1.png'], sizes: ['1:1'] });
  assert.equal(uploadLabel(B1, 1, false), `Upload (1 file) to ${B1}`);
  assert.equal(uploadLabel(B1, 3, true), `Upload a new version (3 files) to ${B1}`);
});

test('selection: kept while shown, or while uploading/checking; otherwise the first shown, or none', () => {
  assert.equal(keepSelection(B1, [A1, B1], [A1, B1], []), B1);
  assert.equal(keepSelection(B1, [A1], [A1, B1], [B1]), B1, 'an upload or check running on B1');
  assert.equal(keepSelection(B1, [A1], [A1, B1], []), A1, 'nothing waiting: move to what the filter shows');
  assert.equal(keepSelection(B1, [], [A1, B1], []), B1, 'nothing shown: stay');
  assert.equal(keepSelection(B1, [A1], [A1], [B1]), A1, 'a code no longer listed at all (another month) is let go');
  assert.equal(keepSelection(null, [A1, B1], [A1, B1], []), A1);
  assert.equal(keepSelection(null, [], [], []), null);
});

test('arriving at Assets for one asset opens that asset\'s ad, not the first in the list (production, 8 Oct)', () => {
  const ask = ['CUR_ASK_YOUR_VET_CAR_A1_US_META', 'CUR_ASK_YOUR_VET_CAR_A2_US_META'], know = ['CUR_KNOW_MORE_CAT_ST_A1_US_META', 'CUR_KNOW_MORE_CAT_ST_A2_US_META'];
  const all = [...ask, ...know];
  // Nothing selected yet: the asset arrived for, not the alphabetically first.
  assert.equal(keepSelection(null, all, all, [], know), know[0]);
  // The default had already picked the first ad: the arrival still wins.
  assert.equal(keepSelection(ask[0], all, all, [], know), know[0]);
  // Already on one of its copy options: stay there. Hidden by the status filter (not shown) but listed: still opened.
  assert.equal(keepSelection(know[1], all, all, [], know), know[1]);
  assert.equal(keepSelection(null, ask, all, [], know), know[0]);
  // A code with files waiting or a check running is never left; an asset with no signed-off codes changes nothing.
  assert.equal(keepSelection(ask[1], all, all, [ask[1]], know), ask[1]);
  assert.equal(keepSelection(null, all, all, [], ['FAM_NOT_SIGNED_ST_A1_US_META']), ask[0]);
  assert.equal(keepSelection(ask[1], all, all, []), ask[1], 'without an arrival it is as before');
});
