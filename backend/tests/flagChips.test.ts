// The plain names for flags are written twice (the page's chips, the server's worksheet): they must be the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as back from '../src/utils/flagChips.js';
import * as front from '../../frontend/src/lib/studioChips.js';

test('flag chip names: the backend copy matches the page', () => {
  assert.deepEqual(back.CHIP, front.CHIP);
  for (const rule of ['COMP_DIRECT_PAY', 'BRIEF_BANNED:cheap', 'FAM_T_SHAME', 'SOME_NEW_RULE']) assert.equal(back.chipName(rule), front.chipName(rule));
});
