// Asset sizes (Brook, 30 Sep; the client's WBS): reading a file's size, snapping
// to 1:1 / 4:5 / 9:16, and the sizes each format is expected in. The per-size
// audit is in studioPg.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSize, expectedSizes, imageDims, parseSize, roleOf, sizeFromName, sizeOfRole, snapSize } from '../src/services/studio/sizes.js';

/** A PNG header of the given size (all a size check reads). */
const png = (w: number, h: number) => { const b = Buffer.alloc(33); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
/** A JPEG with one SOF0 segment. */
const jpeg = (w: number, h: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

test('sizes: snapped from the pixels (PNG, JPEG) within 5%, else from the file name; stored on the file role', () => {
  assert.deepEqual(imageDims(png(1080, 1350)), { w: 1080, h: 1350 });
  assert.deepEqual(imageDims(jpeg(1080, 1920)), { w: 1080, h: 1920 });
  assert.equal(snapSize(1080, 1080), '1:1');
  assert.equal(snapSize(1080, 1340), '4:5', 'within the tolerance');
  assert.equal(snapSize(1080, 1920), '9:16');
  assert.equal(snapSize(1920, 1080), null, 'landscape is none of them');
  assert.equal(detectSize({ filename: 'x.png', buffer: png(1200, 1500) }), '4:5');
  assert.equal(detectSize({ filename: 'hero_9x16.mp4', buffer: Buffer.from('not an image') }), '9:16');
  assert.equal(sizeFromName('static-1080x1350.jpg'), '4:5');
  assert.equal(sizeFromName('card1.png'), null);
  assert.equal(parseSize('4x5'), '4:5');
  assert.equal(parseSize('3:2'), null);
  assert.equal(sizeOfRole(roleOf('9:16')), '9:16');
  assert.equal(sizeOfRole('asset'), null, 'an upload from before sizes');
});

test('expected sizes by format (the WBS): statics and videos 1:1, 4:5, 9:16; carousels 1:1, 4:5; TikTok 9:16; the rules can change them', () => {
  assert.deepEqual(expectedSizes('FAM_SUMMER_ST_A1_US_META'), ['1:1', '4:5', '9:16']);
  assert.deepEqual(expectedSizes('FAM_SUMMER_VID_A1_US_META'), ['1:1', '4:5', '9:16']);
  assert.deepEqual(expectedSizes('FAM_SUMMER_CAR_A1_US_META'), ['1:1', '4:5']);
  assert.deepEqual(expectedSizes('FAM_SUMMER_UGC_A1_US_TT'), ['9:16']);
  assert.deepEqual(expectedSizes('FAM_SUMMER_ST_A1_US_META', { preflight: { sizes: { ST: ['1:1', '4:5'] } } }), ['1:1', '4:5']);
});
