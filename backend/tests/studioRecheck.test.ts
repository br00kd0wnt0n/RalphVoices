// Stale flags after an edit (production test, 1 Oct): "product unclear", found on the original wording, stayed on a
// line edited to name Trupanion. Model flags carried over an edit are marked `original`, the screens re-check the new
// wording straight away (POST …/recheck, priced by recheckEstimate), and the re-check replaces them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';
import * as R from '../src/services/studio/ready.js';
import { FileStore } from '../src/services/studio/store.js';

const ORIGINAL = 'Protect your furry one like family.';
const EDIT = 'Protect your furry one like family: Trupanion is medical insurance for pets.';

test('an edit marks the old model flags "original"; the re-check clears what no longer applies', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-recheck-'));
  S.setStudioDir(dir);
  S.setStore(new FileStore(dir, { rulesPath: path.join(__dirname, '../scripts/studio/rules.example.json') }));
  await S.refreshRules();
  const api = new S.Api({ mock: true });
  const run = await S.generate(S.makeBrief({ territory: 'OWN_CALM', name: 'rc', own_lines: [{ text: ORIGINAL, field: 'meta_primary' }] }), api, () => {}, { ownOnly: true, user: 'brook' });
  const line = run.lines[0];
  assert.ok(line.flags.some(f => f.rule === 'CL_PRODUCT'), 'the mock finds the product unclear on the original');

  const edited = await S.setDecision(run.id, line.id, { decision: 'edit', edited_text: EDIT }, 'brook');
  const stale = edited.flags.find(f => f.rule === 'CL_PRODUCT')!;
  assert.equal(stale.original, true, 'carried over, and marked as found on the original wording');
  assert.ok(edited.flags.filter(f => f.by.includes('rule')).every(f => !f.original), 'rule flags are re-run on the edit at once, never "original"');

  assert.ok((await S.recheckEstimate(run.id, line.id)) > 0, 'the re-check is priced');
  const checked = await R.recheckLine(run.id, line.id, api, 'brook');
  assert.equal(checked.flags.find(f => f.rule === 'CL_PRODUCT'), undefined, 'the new wording names the product');
  assert.ok(checked.flags.every(f => !f.original));
  assert.ok(checked.rechecked_at);

  // Revert to original: the flags are about the words that count again, so none is "original".
  const reverted = await S.setDecision(run.id, line.id, { decision: 'keep', edited_text: '' }, 'brook');
  assert.ok(reverted.flags.every(f => !f.original));
});
