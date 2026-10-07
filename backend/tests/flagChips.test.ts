// The plain names for flags are written twice (the page's chips, the server's worksheet): they must be the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as back from '../src/utils/flagChips.js';
import * as front from '../../frontend/src/lib/studioChips.js';

test('flag chip names: the backend copy matches the page', () => {
  assert.deepEqual(back.CHIP, front.CHIP);
  for (const rule of ['COMP_DIRECT_PAY', 'BRIEF_BANNED:cheap', 'FAM_T_SHAME', 'SOME_NEW_RULE']) assert.equal(back.chipName(rule), front.chipName(rule));
});

test('persona order: the backend copy matches the page (DINKs, Curators, Families)', async () => {
  const { PERSONA_ORDER, personaRank } = await import('../src/utils/personaOrder.js');
  const src = (await import('node:fs')).readFileSync((await import('node:path')).join(__dirname, '../../frontend/src/components/studio/ui.tsx'), 'utf8');
  assert.deepEqual(JSON.parse(/export const PERSONA_ORDER = (\[[^\]]+\]);/.exec(src)![1].replace(/'/g, '"')), PERSONA_ORDER);
  assert.deepEqual(['FAM', 'OWN', 'CUR', 'DINK', 'ALL'].sort((a, b) => personaRank(a, ['OWN', 'ALL']) - personaRank(b, ['OWN', 'ALL'])), ['DINK', 'CUR', 'FAM', 'OWN', 'ALL']);
});
