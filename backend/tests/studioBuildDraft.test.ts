// Build & sign off (redesign): the pure rules for building ads from kept lines,
// frontend/src/lib/buildDraft.ts (tested here, as ralphScore.test.ts tests the
// frontend's RalphScore mirror). The server's planning and checks are in
// studioReady/studioVersionChecks/studioCarousel tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAd, adName, flagsAt, moveAd, nextVisual, placeLine, removeAd, setCard, setOnImage, useInAllAds, usesOf } from '../../frontend/src/lib/buildDraft.js';

const platformOf = (v: { platform?: string }) => v.platform || 'META';
const base = () => ({
  versions: [
    { visual: 'A', platform: 'META', fields: { meta_primary: 'p1', meta_headline: 'h1' } },
    { visual: 'A', platform: 'META', fields: { meta_primary: 'p2', meta_headline: 'h1' } },
    { visual: 'B', platform: 'META', fields: { meta_primary: 'p3', meta_headline: 'h2' } },
  ],
  on_image: { A: 'o1' } as Record<string, string | string[]>,
});

test('placing a line in a slot changes that ad only; clearing an optional slot removes the field', () => {
  let d = placeLine(base(), 1, 'meta_primary', 'p9');
  assert.deepEqual(d.versions.map(v => v.fields.meta_primary), ['p1', 'p9', 'p3']);
  d = placeLine(d, 0, 'meta_description', 'd1');
  assert.equal(d.versions[0].fields.meta_description, 'd1');
  d = placeLine(d, 0, 'meta_description', '');
  assert.equal('meta_description' in d.versions[0].fields, false);
});

test('"use in all ads" puts a headline in every ad on that visual (and platform) only', () => {
  const d = useInAllAds(base(), 'A', 'META', 'meta_headline', 'h9');
  assert.deepEqual(d.versions.map(v => v.fields.meta_headline), ['h9', 'h9', 'h2']);
  const tt = useInAllAds({ ...base(), versions: [...base().versions, { visual: 'A', platform: 'TT', fields: { tiktok_caption: 'c1' } }] }, 'A', 'META', 'meta_headline', 'h9');
  assert.equal(tt.versions[3].fields.meta_headline, undefined, 'a TikTok ad on the same letter is left alone');
});

test('on-image text and carousel cards: set, grow to a card, clear', () => {
  let d = setOnImage(base(), 'B', 'o2');
  assert.equal(d.on_image.B, 'o2');
  d = setCard(d, 'C', 2, 'k2');
  assert.deepEqual(d.on_image.C, ['', 'k2', '', ''], 'four cards by default, card 2 set');
  d = setCard(d, 'C', 6, 'k6');
  assert.deepEqual(d.on_image.C, ['', 'k2', '', '', '', 'k6']);
  d = setOnImage(d, 'C', ['', '']);
  assert.equal('C' in d.on_image, false, 'no text on any card: nothing on the image');
});

test('ads: add from the visual\'s last ad (a shared headline carries over), move to another or a new visual, remove; names and uses', () => {
  let d = addAd(base(), 'A', 'META', ['meta_primary', 'meta_headline'], f => (f === 'meta_primary' ? 'pX' : 'hX'));
  assert.deepEqual(d.versions[3].fields, { meta_primary: 'p2', meta_headline: 'h1' });
  d = addAd(d, 'C', 'META', ['meta_primary', 'meta_headline'], f => (f === 'meta_primary' ? 'pX' : 'hX'));
  assert.deepEqual(d.versions[4].fields, { meta_primary: 'pX', meta_headline: 'hX' }, 'a new visual starts from the first kept lines');
  assert.deepEqual(d.versions.map((_, i) => adName(d, i, platformOf)), ['Visual A · Ad 1', 'Visual A · Ad 2', 'Visual B · Ad 1', 'Visual A · Ad 3', 'Visual C · Ad 1']);
  assert.deepEqual(usesOf(d, 'h1', platformOf), ['Visual A · Ad 1', 'Visual A · Ad 2', 'Visual A · Ad 3']);
  assert.deepEqual(usesOf(d, 'o1', platformOf), ['Visual A · on the image']);
  assert.equal(nextVisual(d), 'D');
  d = moveAd(d, 1, 'B');
  assert.equal(adName(d, 1, platformOf), 'Visual B · Ad 1');
  d = removeAd(d, 4);
  assert.equal(d.versions.some(v => v.visual === 'C'), false);
  const onlyA = removeAd(removeAd(removeAd(base(), 1), 0), 0);
  assert.equal('A' in onlyA.on_image, false, 'a visual with no ads left keeps no on-image text');
  assert.deepEqual(usesOf({ versions: [], on_image: { A: ['k1', 'k2'] } }, 'k2', platformOf), ['Visual A · card 2']);
});

test('flags at a slot: once per rule, even when two ads on the visual word it differently (production test, 1 Oct)', () => {
  const clash = (why: string, severity: 'red' | 'amber' = 'amber') => ({ rule: 'VERSION_CONFLICT', severity, label: 'The fields clash in tone', fields: ['meta_primary', 'meta_on_image'], why });
  const shown = flagsAt([clash('Playful image text, sombre primary'), clash('Tone of the image text jars with the primary')], 'meta_on_image');
  assert.equal(shown.length, 1);
  // Red in one ad wins over amber in another.
  assert.equal(flagsAt([clash('a'), clash('b', 'red')], 'meta_on_image')[0].severity, 'red');
  // Different targets stay separate; flags ending on another field aren't shown here.
  const rep = (other: string) => ({ rule: 'VERSION_REPEAT', severity: 'amber' as const, fields: ['meta_on_image'], other });
  assert.equal(flagsAt([rep('A1'), rep('A2'), rep('A1')], 'meta_on_image').length, 2);
  assert.equal(flagsAt([clash('x')], 'meta_primary').length, 0);
});
