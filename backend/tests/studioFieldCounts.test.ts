// Write's per-field counts (4-step Studio): the brief carries field_counts, n is their sum, the grid deals fields in
// proportion, and a run keeps exactly each field's count while the angle × structure spread holds within each field.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/services/studio/engine.js';

S.setStudioDir(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-counts-')));
S.setRulesPath(path.join(__dirname, '../scripts/studio/rules.example.json'));
before(async () => { await S.refreshRules(); });

test('field_counts: sanitised to the brief’s fields, and n is their sum', () => {
  const b = S.makeBrief({ territory: 'OWN_CALM', fields: ['meta_primary', 'meta_headline'], field_counts: { meta_primary: 7, meta_headline: 3.9, tiktok_hook: 5 } as any, n: 99, name: 'counts' });
  assert.deepEqual(b.field_counts, { meta_primary: 7, meta_headline: 3 });
  assert.equal(b.n, 10);
  // No counts (or all zero): the old even split with n as given.
  const even = S.makeBrief({ territory: 'OWN_CALM', n: 8, name: 'even', field_counts: { meta_primary: 0 } });
  assert.equal(even.field_counts, undefined);
  assert.equal(even.n, 8);
  assert.throws(() => S.makeBrief({ territory: 'OWN_CALM', fields: ['meta_primary', 'meta_headline'], field_counts: { meta_primary: 40, meta_headline: 30 }, name: 'big' }), /At most 60/);
});

test('the grid deals fields in proportion to the counts, each with its spread of structures', () => {
  const b = S.makeBrief({ territory: 'OWN_CALM', fields: ['meta_primary', 'meta_headline'], field_counts: { meta_primary: 12, meta_headline: 4 }, name: 'deal' });
  const cells = S.planCells(b, 40);
  const by = (f: string) => cells.filter(c => c.field === f);
  const ratio = by('meta_primary').length / cells.length;
  assert.ok(ratio > 0.6 && ratio < 0.9, `primary share ${ratio}`);
  assert.ok(new Set(by('meta_primary').map(c => c.structure)).size >= 5, 'primary sees the structures');
  assert.ok(new Set(by('meta_primary').map(c => c.angle)).size >= 2, 'primary sees the angles');
  // A field with a zero count gets no cells.
  const z = S.makeBrief({ territory: 'OWN_CALM', fields: ['meta_primary', 'meta_headline'], field_counts: { meta_primary: 6, meta_headline: 0 }, name: 'zero' });
  assert.ok(S.planCells(z, 20).every(c => c.field === 'meta_primary'));
});

test('a mock run keeps exactly each field’s count', async () => {
  const api = new S.Api({ mock: true });
  const b = S.makeBrief({ territory: 'OWN_CALM', fields: ['meta_primary', 'meta_headline'], field_counts: { meta_primary: 5, meta_headline: 3 }, name: 'run-counts' });
  const batch = await S.generate(b, api);
  const n = (f: string) => batch.lines.filter(l => l.field === f && l.model !== 'human').length;
  assert.equal(n('meta_primary'), 5);
  assert.equal(n('meta_headline'), 3);
  assert.deepEqual(batch.brief.field_counts, { meta_primary: 5, meta_headline: 3 });
});
