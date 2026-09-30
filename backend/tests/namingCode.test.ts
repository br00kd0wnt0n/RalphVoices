// Naming codes (utils/namingCode.ts): the current form with visual, line and
// region, the earlier v# form (still read), round trips, and Studio's code
// allocation (services/studio/codes.ts). The audit library reads both forms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_ORDER, CURRENT_PATTERN, formatCode, parseCode, regionOf, visualKey } from '../src/utils/namingCode.js';
import { CodeBook, visualLetter } from '../src/services/studio/codes.js';
import { parseStub } from '../src/services/audit/rules.js';

test('the current form reads: visual, copy line, region, platform and the trafficking date', () => {
  const p = parseCode('FAM_SUMMER_ST_A2_US_META_261013');
  assert.ok(!('error' in p));
  assert.deepEqual(p, { form: 'current', code: 'FAM_SUMMER_ST_A2_US_META', persona: 'FAM', territory: 'SUMMER', format: 'ST', platform: 'META', visual: 'A', line: 2, region: 'US', date: '2026-10-13', suffix: [] });
  // Canada, lower case, long names, TikTok, a multi-word territory, a suffix after the date.
  const ca = parseCode('cur_day_one_carousel_b3_ca_tiktok_261020_copy') as any;
  assert.equal(ca.code, 'CUR_DAY_ONE_CAR_B3_CA_TT');
  assert.equal(ca.territory, 'DAY_ONE');
  assert.equal(ca.region, 'CA');
  assert.equal(ca.date, '2026-10-20');
  assert.deepEqual(ca.suffix, ['COPY']);
  // A repeated persona prefix in the territory is dropped, as B3 does.
  assert.equal((parseCode('FAM_FAM_SUMMER_ST_A1_US_META') as any).code, 'FAM_SUMMER_ST_A1_US_META');
});

test('the earlier v# form still reads, as it always did', () => {
  const p = parseCode('fam_summer_static_v2_meta.png') as any;
  assert.equal(p.form, 'v#');
  assert.equal(p.code, 'FAM_SUMMER_ST_v2_META');
  assert.equal(p.version, 2);
  assert.equal(p.region, undefined);
  assert.equal(regionOf('FAM_SUMMER_ST_v2_META'), 'US', 'v# codes were all US');
  assert.equal((parseCode('DINK_NEVER_UGC_v1_TIKTOK_261013') as any).date, '2026-10-13');
});

test('round trip: build, read back, build again (US and CA)', () => {
  for (const region of ['US', 'CA'] as const) {
    for (const [persona, territory, format, platform] of [['FAM', 'FAM_SUMMER', 'STATIC', 'META'], ['DINK', 'DINK_NEVER', 'UGC', 'TIKTOK'], ['CUR', 'CUR_VET', 'CAROUSEL', 'META']]) {
      const code = formatCode({ persona, territory, format, platform, region, visual: 'B', line: 3 });
      const p = parseCode(code) as any;
      assert.equal(p.form, 'current', code);
      assert.equal(p.code, code);
      assert.equal(p.region, region);
      assert.equal(formatCode(p), code);
      assert.equal((parseCode(`${code}_261013`) as any).code, code, 'a date added at trafficking reads back to the same code');
    }
  }
  assert.equal(formatCode({ persona: 'FAM', territory: 'FAM_SUMMER', format: 'STATIC', platform: 'META', region: 'US', visual: 'A', line: 2 }), 'FAM_SUMMER_ST_A2_US_META');
  assert.equal(formatCode({ persona: 'FAM', territory: 'FAM_SUMMER', format: 'STATIC', platform: 'META', region: 'CA', visual: 'A', line: 2 }), 'FAM_SUMMER_ST_A2_CA_META');
  assert.equal(CURRENT_PATTERN, 'PERSONA_TERRITORY_FORMAT_[visual][line]_REGION_PLATFORM');
  assert.equal(CODE_ORDER.length, 6);
});

test('bad codes say why', () => {
  assert.match((parseCode('XYZ_SUMMER_ST_A1_US_META') as any).error, /persona/);
  assert.match((parseCode('FAM_SUMMER_ST_A1_UK_META') as any).error, /region|version/);
  assert.match((parseCode('FAM_SUMMER_ST_US_META') as any).error, /\[visual\]\[line\]/);
  assert.throws(() => formatCode({ persona: 'FAM', territory: 'SUMMER', format: 'ST', platform: 'META', region: 'UK' as any, visual: 'A', line: 1 }), /Region/);
  assert.throws(() => formatCode({ persona: 'FAM', territory: 'SUMMER', format: 'ST', platform: 'META', region: 'US', visual: 'AA', line: 1 }), /one letter/);
  assert.throws(() => visualLetter('7'), /one letter/);
});

test('codes on one visual share a key; v# codes have none', () => {
  assert.equal(visualKey('FAM_SUMMER_ST_A1_US_META'), visualKey('FAM_SUMMER_ST_A3_US_META'));
  assert.notEqual(visualKey('FAM_SUMMER_ST_A1_US_META'), visualKey('FAM_SUMMER_ST_B1_US_META'));
  assert.notEqual(visualKey('FAM_SUMMER_ST_A1_US_META'), visualKey('FAM_SUMMER_ST_A1_CA_META'), 'US and Canada are separate visuals');
  assert.equal(visualKey('FAM_SUMMER_ST_v1_META'), null);
});

test('the audit library reads both forms', () => {
  assert.deepEqual(parseStub('FAM_SUMMER_ST_A2_CA_META_261013.png'), { stub: 'FAM_SUMMER_ST_A2_CA_META', persona: 'FAM', territory: 'SUMMER', format: 'ST', visual: 'A', line: 2, region: 'CA', platform: 'META' });
  assert.deepEqual(parseStub('fam_summer_static_v2_meta.png'), { stub: 'FAM_SUMMER_ST_v2_META', persona: 'FAM', territory: 'SUMMER', format: 'ST', version: 2, platform: 'META' });
});

test('Studio packs lines three to a visual, skips codes already signed off, and honours a chosen visual', () => {
  const line = (region: 'US' | 'CA' = 'US') => ({ persona: 'FAM', territory: 'FAM_SUMMER', format: 'STATIC', platform: 'META', region });
  const book = new CodeBook(['FAM_SUMMER_ST_A1_US_META', 'FAM_SUMMER_STATIC_v1_META']);
  assert.deepEqual([1, 2, 3, 4].map(() => book.assign(line())), ['FAM_SUMMER_ST_A2_US_META', 'FAM_SUMMER_ST_A3_US_META', 'FAM_SUMMER_ST_B1_US_META', 'FAM_SUMMER_ST_B2_US_META']);
  assert.equal(book.assign(line(), 'A'), 'FAM_SUMMER_ST_A4_US_META', 'a chosen visual takes its next free line, even past three');
  assert.equal(book.assign(line('CA')), 'FAM_SUMMER_ST_A1_CA_META', 'Canada numbers on its own');
  assert.equal(book.assign(line(), 'd'), 'FAM_SUMMER_ST_D1_US_META');
});
