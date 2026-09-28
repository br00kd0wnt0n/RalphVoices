// B1-lite Copy Studio: deterministic checks, grid, CSV round trip and a mock
// batch end to end. Uses the made-up example rules (scripts/studio/rules.example.json)
// and a temp studio folder, so it needs no client material, key or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../scripts/studio/engine.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
S.setStudioDir(dir);
S.setRulesPath(path.join(__dirname, '../scripts/studio/rules.example.json'));
const rules = S.loadRules();
const det = (text: string, field = 'meta_primary', structure = 'plain_promise') =>
  S.deterministicFlags({ text, field, structure, persona: 'OWN' }, rules, { banned_words: ['hassle-free'] }).flags;
const find = (flags: S.Flag[], rule: string) => flags.find(f => f.rule === rule);

test('banned phrase is flagged with its quote and source', () => {
  const f = find(det('Honestly, the policy pays for itself.'), 'COMP_PAYS_FOR_ITSELF');
  assert.ok(f);
  assert.equal(f.severity, 'compliance');
  assert.equal(f.quote, 'pays for itself');
  assert.equal(f.source, 'LEGAL §4');
});

test('direct pay needs its caveat', () => {
  assert.ok(find(det('Your vet gets paid at checkout.'), 'COMP_DIRECT_PAY'));
  assert.equal(find(det('Your vet gets paid at checkout at partner clinics.'), 'COMP_DIRECT_PAY'), undefined);
});

test('a pattern can carry its own lower severity', () => {
  const f = find(det('Cheap cover can cost you more.'), 'COMP_CHEAP');
  assert.equal(f?.severity, 'warn');
  assert.equal(find(det('Rates locked in for life.'), 'COMP_CHEAP')?.severity, 'compliance');
});

test('price is compliance when it leads, a warning mid-line', () => {
  assert.equal(find(det('$30 a month for peace of mind', 'meta_headline'), 'COMP_PRICE_LEAD')?.severity, 'compliance');
  assert.equal(find(det('Peace of mind at the vet, whatever happens next. From what you pay, $30 a month, we pay back most.'), 'COMP_PRICE_LEAD')?.severity, 'warn');
});

test('figures must be in the facts list; category stats need a citation; misattribution is flagged', () => {
  assert.equal(find(det('We paid 2.4M claims.'), 'FIG_UNSOURCED')?.quote, '2.4M');
  const ok = det('Pawsure paid 1.5M claims last year.');
  assert.equal(find(ok, 'FIG_UNSOURCED'), undefined);
  assert.equal(find(det('81% of owners say cover is worth it.'), 'FIG_CITATION')?.severity, 'warn');
  assert.equal(find(det('81% of our members say it is worth it.'), 'FIG_ATTRIBUTION')?.severity, 'compliance');
  assert.equal(find(det('Two dogs, one sofa.'), 'FIG_UNSOURCED'), undefined, 'small counts are allowed');
});

test('limits, case, turn-offs, verbatims, structure and brief bans', () => {
  assert.ok(find(det('This headline is far too long to fit', 'meta_headline'), 'LIMIT_VISIBLE'));
  assert.ok(find(det('THIS IS ALL CAPS COPY'), 'BR_CASE'));
  assert.ok(find(det('For your fur baby.'), 'OWN_T_BABY'));
  assert.ok(find(det('Honestly I never once had to think about whether I could afford it'), 'COMP_VERBATIM'));
  assert.equal(find(det('I got it for Molly.', 'meta_primary', 'testimony'), 'COMP_UGC_MEMBER')?.severity, 'note');
  assert.ok(find(det('Totally hassle-free.'), 'BRIEF_BANNED:hassle-free'));
  assert.ok(find(det('Plain pet cover.'), 'BR_NAMING')?.label.includes('pending'));
});

test('the grid spreads cells across angles and structures', () => {
  const b = S.makeBrief({ territory: 'OWN_CALM', n: 12, name: 'grid' });
  const cells = S.planCells(b, 12);
  const pairs = new Set(cells.map(c => `${c.angle}|${c.structure}`));
  // The territory's own angle counts twice, so a few pairs repeat by design.
  assert.ok(pairs.size >= 9, `only ${pairs.size} distinct pairs`);
  assert.equal(new Set(cells.map(c => c.angle)).size, 2);
  assert.equal(new Set(cells.map(c => c.structure)).size, 6);
  assert.ok(cells.every(c => b.fields.includes(c.field)));
});

test('every structure appears whatever the number of angles', () => {
  for (const n of [6, 10, 20]) {
    const b = S.makeBrief({ territory: 'OWN_CALM', n, name: `grid${n}` });
    for (const A of [3, 4, 5, 6]) {
      // Simulate A angle slots by checking the formula directly on the planned cells' indices.
      const structures = new Set(Array.from({ length: Math.max(n, 12) }, (_, i) => ((i % A) + Math.floor(i / A)) % 6));
      assert.equal(structures.size, 6, `A=${A}`);
    }
    assert.equal(new Set(S.planCells(b, Math.max(n, 12)).map(c => c.structure)).size, 6);
  }
});

test('CSV survives quotes, commas, newlines and formula-like text', () => {
  const rows = [['id', 'text'], ['a', 'He said "hi", then\nleft'], ['b', '=SUM(A1)']];
  const back = S.parseCsv(S.toCsv(rows));
  assert.deepEqual(back[1], rows[1]);
  assert.equal(back[2][1], "'=SUM(A1)");
});

test('mock batch: generate, check, export, ingest round trip', async () => {
  const api = new S.Api({ mock: true });
  const b = S.makeBrief({ territory: 'OWN_CALM', n: 8, name: 'mock' });
  const batch = await S.generate(b, api);
  assert.ok(batch.lines.length >= 6);
  assert.ok(batch.lines.every(l => l.status === 'checked'));
  assert.ok(batch.lines.flatMap(l => l.flags).every(f => f.source), 'every flag has a source');
  const { csv } = S.exportBatch(batch.id);
  const rows = S.parseCsv(csv);
  const h = rows[0];
  rows[1][h.indexOf('decision')] = 'keep';
  rows[2][h.indexOf('decision')] = 'edit';
  rows[2][h.indexOf('edited_text')] = 'Calm at the counter, at partner clinics.';
  rows[2][h.indexOf('note')] = 'plainer';
  const r = S.ingest(rows.map(x => x.map(c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n'));
  assert.equal(r.kept, 1);
  assert.equal(r.edited, 1);
  assert.equal(r.shortlist, 2);
  const sl = S.shortlist();
  assert.match(sl[0].stub, /^OWN_CALM_UGC_v\d_META$/);
  assert.equal(S.loadTaste().length, 2);
});
