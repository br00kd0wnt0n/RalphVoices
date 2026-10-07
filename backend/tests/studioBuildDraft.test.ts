// Build & sign off (redesign): the pure rules for building ads from kept lines,
// frontend/src/lib/buildDraft.ts (tested here, as ralphScore.test.ts tests the
// frontend's RalphScore mirror). The server's planning and checks are in
// studioReady/studioVersionChecks/studioCarousel tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAd, adName, flagsAt, moveAd, redPlaces, setCardSub, setOnImageSub, nextVisual, placeLine, removeAd, setCard, setOnImage, useInAllAds, usesOf } from '../../frontend/src/lib/buildDraft.js';

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
  assert.deepEqual(d.versions.map((_, i) => adName(d, i, platformOf)), ['Ad A · option 1', 'Ad A · option 2', 'Ad B · option 1', 'Ad A · option 3', 'Ad C · option 1']);
  assert.deepEqual(usesOf(d, 'h1', platformOf), ['Ad A · option 1', 'Ad A · option 2', 'Ad A · option 3']);
  assert.deepEqual(usesOf(d, 'o1', platformOf), ['Ad A · on the image']);
  assert.equal(nextVisual(d), 'D');
  d = moveAd(d, 1, 'B');
  assert.equal(adName(d, 1, platformOf), 'Ad B · option 1');
  d = removeAd(d, 4);
  assert.equal(d.versions.some(v => v.visual === 'C'), false);
  const onlyA = removeAd(removeAd(removeAd(base(), 1), 0), 0);
  assert.equal('A' in onlyA.on_image, false, 'a visual with no ads left keeps no on-image text');
  assert.deepEqual(usesOf({ versions: [], on_image: { A: ['k1', 'k2'] } }, 'k2', platformOf), ['Ad A · card 2']);
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

test('red places: the blocker names the flag and where it is, a carousel card included (production test, 1 Oct)', () => {
  const d = { versions: [{ visual: 'A', platform: 'META', fields: { meta_primary: 'p1', meta_headline: 'h1' } }], on_image: { A: ['c1', 'c2', 'c3', 'c4'] } };
  const pf = (v: { platform?: string }) => v.platform || 'META';
  assert.deepEqual(redPlaces(d, { c2: ['unsourced figure', 'price lead'] }, pf), ['Ad A · card 2: unsourced figure, price lead']);
  assert.deepEqual(redPlaces(d, { p1: ['direct pay'], c4: ['claim speed'] }, pf), ['Ad A · option 1: direct pay', 'Ad A · card 4: claim speed']);
  assert.deepEqual(redPlaces({ ...d, on_image: { A: 'oi' } }, { oi: ['pays for itself'] }, pf), ['Ad A · on the image: pays for itself']);
  assert.deepEqual(redPlaces(d, { zz: ['x'], c1: [] }, pf), [], 'a line not in the draft, or with no reds, is not named');
});

test('subheads (rules v2.14): per visual or per card, optional, named in uses, gone with their visual', () => {
  const d0 = { versions: [{ visual: 'A', platform: 'META', fields: { meta_primary: 'p1', meta_headline: 'h1' } }], on_image: { A: ['c1', 'c2', 'c3'] } };
  const pf = (v: { platform?: string }) => v.platform || 'META';
  const d1 = setCardSub(d0, 'A', 2, 's2');
  assert.deepEqual(d1.on_image_sub, { A: ['', 's2'] });
  assert.deepEqual(usesOf(d1, 's2', pf), ['Ad A · card 2 subhead']);
  assert.deepEqual(setCardSub(d1, 'A', 2, '').on_image_sub, {}, 'clearing the last subhead leaves none');
  const d2 = setOnImageSub({ ...d0, on_image: { A: 'oi' } }, 'A', 'sub');
  assert.deepEqual(usesOf(d2, 'sub', pf), ['Ad A · subhead']);
  assert.deepEqual(removeAd(d2, 0).on_image_sub, {}, 'no ads left on the visual: no subhead either');
  assert.deepEqual(redPlaces(d2, { sub: ['figure'] }, pf), ['Ad A · subhead: figure']);
});

test('removing an ad or a visual: the open slot follows its ad or closes, names never read an ad that is gone, and the letter is free again', async () => {
  const { removeVisual, slotAfter, adNumber } = await import('../../frontend/src/lib/buildDraft.js');
  const platformOf = (v: { platform?: string }) => v.platform || 'META';
  const ad = (visual: string, id: string) => ({ visual, platform: 'META', fields: { meta_primary: id } });
  const d = { versions: [ad('A', 'p1'), ad('A', 'p2'), ad('B', 'p3')], on_image: { A: 'o1', B: ['c1', 'c2'] }, on_image_sub: { B: ['', 's2'] } };
  // The crash (production, 5 Oct): the screen named an ad by its place in a plan worked out before the removal.
  const one = removeAd(d, 2);
  assert.equal(adName(one, 2, platformOf), '', 'no ad at that place: no name, no crash');
  assert.equal(adNumber(one, 2, platformOf), 0);
  // A tray open on the removed ad closes; one open on a later ad follows it down; an earlier one stays.
  const mid = removeAd(d, 1);
  assert.equal(slotAfter({ kind: 'ad', index: 1, field: 'meta_primary' }, d, mid), null);
  assert.deepEqual(slotAfter({ kind: 'ad', index: 2, field: 'meta_primary' }, d, mid), { kind: 'ad', index: 1, field: 'meta_primary' });
  assert.deepEqual(slotAfter({ kind: 'ad', index: 0, field: 'meta_primary' }, d, mid), { kind: 'ad', index: 0, field: 'meta_primary' });
  // Placing a line or moving an ad keeps the tray on the same ad.
  assert.deepEqual(slotAfter({ kind: 'ad', index: 1, field: 'meta_headline' }, d, placeLine(d, 1, 'meta_headline', 'h1')), { kind: 'ad', index: 1, field: 'meta_headline' });
  assert.deepEqual(slotAfter({ kind: 'ad', index: 1, field: 'meta_primary' }, d, moveAd(d, 1, 'B')), { kind: 'ad', index: 1, field: 'meta_primary' });
  // An on-image slot closes when its visual has no ads left (the only ad on B removed).
  assert.equal(slotAfter({ kind: 'image', visual: 'B', field: 'meta_on_image', card: 2 }, d, one), null);
  assert.deepEqual(slotAfter({ kind: 'image', visual: 'A', field: 'meta_on_image' }, d, one), { kind: 'image', visual: 'A', field: 'meta_on_image' });
  // Removing a visual's last ad removes the visual: its cards and subheads go, and the letter is the next free one.
  assert.deepEqual([one.on_image, one.on_image_sub, nextVisual(one)], [{ A: 'o1' }, {}, 'B']);
  // "Remove this visual": every ad on it and its on-image text, in one go.
  const noA = removeVisual(d, 'A', 'META', platformOf);
  assert.deepEqual([noA.versions.map(v => v.visual), noA.on_image, nextVisual(noA)], [['B'], { B: ['c1', 'c2'] }, 'A']);
  // A letter shared by a Meta and a TikTok visual keeps its on-image text while the other platform's ads are still on it.
  const both = { ...d, versions: [...d.versions, { visual: 'A', platform: 'TT', fields: { tiktok_caption: 't1' } }] };
  assert.deepEqual(removeVisual(both, 'A', 'META', platformOf).on_image.A, 'o1');
});

test('a flag at a slot the whole ad shares says which copy option(s) it was found with', async () => {
  const { flagsAtShared } = await import('../../frontend/src/lib/buildDraft.js');
  const clash = { rule: 'VERSION_CONFLICT', severity: 'amber', fields: ['meta_primary', 'meta_on_image'], label: 'Fields clash in tone' };
  const repeat = { rule: 'VERSION_REPEAT', severity: 'amber', fields: ['meta_headline', 'meta_on_image'], label: 'repeat' };
  const none: any[] = [];
  // Only option 2's caption clashes with the on-image text.
  assert.deepEqual(flagsAtShared([{ n: 1, flags: none }, { n: 2, flags: [clash] }, { n: 3, flags: none }], 'meta_on_image').map(f => [f.rule, f.from]), [['VERSION_CONFLICT', 'Copy option 2']]);
  // Two of three; all three; and a red in one option wins over the same amber in another.
  assert.equal(flagsAtShared([{ n: 1, flags: [clash] }, { n: 2, flags: none }, { n: 3, flags: [clash] }], 'meta_on_image')[0].from, 'Copy options 1 and 3');
  assert.equal(flagsAtShared([{ n: 1, flags: [repeat] }, { n: 2, flags: [repeat] }, { n: 3, flags: [repeat] }], 'meta_on_image')[0].from, 'Every copy option');
  const red = flagsAtShared([{ n: 1, flags: [clash] }, { n: 2, flags: [{ ...clash, severity: 'red' }] }], 'meta_on_image');
  assert.deepEqual([red.length, red[0].severity, red[0].from], [1, 'red', 'Every copy option']);
  // A flag about another slot isn't shown here; one option on its own is named as itself.
  assert.deepEqual(flagsAtShared([{ n: 1, flags: [clash] }], 'meta_on_image_sub'), []);
  assert.equal(flagsAtShared([{ n: 1, flags: [clash] }], 'meta_on_image')[0].from, 'Copy option 1');
});
