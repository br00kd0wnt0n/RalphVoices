// Back-test analysis (pre-registered in docs/build-log/backtest-preregistration.md), on
// made-up data with a planted copy feature: it must come back supported, and features
// with no effect must not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest, splitCopies, normalizeCopy, type BtAd } from '../src/services/weekly/backtest.js';
import { rng, normal, binomial } from '../src/services/weekly/stats.js';

function world(seed: number, lift: number) {
  const r = rng(seed);
  const copies = Array.from({ length: 21 }, (_, i) => ({ id: `C${String(i + 1).padStart(2, '0')}`, normalized: `made-up copy number ${i + 1}` }));
  const features: Record<string, string[]> = {};
  for (const [i, c] of copies.entries()) features[c.id] = ['alpha', 'beta', 'gamma'].filter((_, k) => ((i >> k) & 1) === 1);
  const ads: BtAd[] = [];
  for (const c of copies) {
    const ce = Math.exp(0.1 * normal(r)) * (features[c.id].includes('alpha') ? lift : 1);
    for (let j = 0; j < 12; j++) {
      const region = j % 2 ? 'US' : 'CA', format = j % 3 === 0 ? 'UGC' : 'ST';
      const rate = 0.004 * ce * (format === 'UGC' ? 1.4 : 1) * (region === 'US' ? 0.9 : 1) * Math.exp(0.15 * normal(r));
      const n = Math.round(200000 * Math.exp(0.5 * normal(r)));
      ads.push({ key: `${c.id}-${j}`, copy: c.id, region, format, wave: j % 4 < 2 ? 'Q1' : 'Q2', placement_share: r() * 0.6, impressions: n, events: binomial(r, n, rate) });
    }
  }
  return { copies, features, ads };
}

test('the split is fixed by the copy text alone', () => {
  const cs = Array.from({ length: 20 }, (_, i) => ({ id: `C${i}`, normalized: `copy ${i}` }));
  const a = splitCopies(cs), b = splitCopies([...cs].reverse());
  assert.equal(a.fit.size, 14);
  assert.deepEqual([...a.fit].sort(), [...b.fit].sort());
  assert.equal(normalizeCopy('  “Pet insurance, for real life!”  '), 'pet insurance, for real life');
});

test('a large planted copy feature comes back supported; null features do not', () => {
  let supported = 0, falseSupported = 0;
  for (let s = 1; s <= 6; s++) {
    const w = world(s, 1.6);
    const res = runBacktest('link_ctr', w.ads, w.features, ['alpha', 'beta', 'gamma'], splitCopies(w.copies));
    const a = res.effects.find(e => e.term === 'alpha')!;
    if (a.verdict === 'supported') supported++;
    if (a.ratio !== null) assert.ok(a.lo! < 1.6 * 1.25 && a.hi! > 1.6 / 1.25, `alpha range [${a.lo}, ${a.hi}]`);
    falseSupported += res.effects.filter(e => e.term !== 'alpha' && e.verdict === 'supported').length;
    const ugc = res.controls.find(c => c.term.startsWith('format UGC'))!;
    assert.ok(ugc.lo < 1.4 && ugc.hi > 1.4, `format control ${ugc.lo}–${ugc.hi}`);
  }
  assert.ok(supported >= 4, `alpha supported in ${supported} of 6 worlds`);
  assert.ok(falseSupported <= 1, `${falseSupported} null features supported`);
});

test('with no copy effects, nothing is supported', () => {
  let n = 0;
  for (let s = 10; s <= 15; s++) {
    const w = world(s, 1);
    n += runBacktest('link_ctr', w.ads, w.features, ['alpha', 'beta', 'gamma'], splitCopies(w.copies)).effects.filter(e => e.verdict === 'supported').length;
  }
  assert.ok(n <= 1, `${n} supported`);
});

test('too few copies with a feature is "not enough data"; ads without the outcome are left out', () => {
  const w = world(3, 1.6);
  w.features.C01 = [...w.features.C01, 'rare'];
  w.ads.slice(0, 5).forEach(a => { a.events = null; });
  const res = runBacktest('link_ctr', w.ads, w.features, ['alpha', 'rare'], splitCopies(w.copies));
  assert.equal(res.effects.find(e => e.term === 'rare')!.verdict, 'not enough data');
  assert.equal(res.ads, w.ads.length - 5);
});
