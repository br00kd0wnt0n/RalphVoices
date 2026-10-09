// Studio's addresses: a path per step, old ?tab= links still landing (frontend/src/lib/studioRoute.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathFor, tabFrom, tabKey, urlFor, withState } from '../../frontend/src/lib/studioRoute.js';

test('studio route: each step has a path, and the board is /studio', () => {
  assert.equal(tabFrom('/studio', ''), 'home');
  assert.equal(tabFrom('/studio/', ''), 'home');
  for (const t of ['write', 'review', 'build', 'assets', 'live', 'territories', 'rules', 'worksheet', 'check', 'compare', 'howto'] as const) {
    assert.equal(tabFrom(`/studio/${t}`, ''), t);
    assert.equal(pathFor(t), `/studio/${t}`);
  }
  assert.equal(pathFor('home'), '/studio');
  assert.equal(tabFrom('/studio/Assets/', '?stub=X'), 'assets');
  assert.equal(tabFrom('/studio/nonsense', ''), 'home');
});

test('studio route: old links land on the new paths (?tab=, and the older keys, in the query or the path)', () => {
  assert.equal(tabFrom('/studio', '?tab=assets&stub=DINK_SOCK_ST_A1_US_META'), 'assets');
  assert.equal(tabFrom('/studio', '?tab=shortlist'), 'review');
  assert.equal(tabKey('/studio', '?tab=shortlist'), 'shortlist');
  assert.equal(tabFrom('/studio', '?tab=ready&persona=FAM&territory=FAM_SUMMER'), 'build');
  assert.equal(tabFrom('/studio/preflight', ''), 'assets');
  assert.equal(tabFrom('/studio', '?tab=compliance'), 'assets');
  // The path wins over a stale ?tab=.
  assert.equal(tabFrom('/studio/build', '?tab=assets'), 'build');
});

test('studio route: the address keeps the query, without ?tab= and without another screen’s own keys', () => {
  assert.equal(urlFor('assets', '?tab=assets&stub=X_A1_US_META&region=US'), '/studio/assets?stub=X_A1_US_META&region=US');
  assert.equal(urlFor('build', '?stub=X&persona=FAM&territory=FAM_SUMMER&region=CA'), '/studio/build?persona=FAM&territory=FAM_SUMMER&region=CA');
  assert.equal(urlFor('home', '?tab=review&batch=b1&open=L07'), '/studio');
  assert.equal(urlFor('review', '?tab=review&batch=b1&open=L07'), '/studio/review?batch=b1&open=L07');
  // Anything else in the query survives (the sign-in token is stripped by the sign-in code, not here).
  assert.equal(urlFor('assets', '?tab=preflight&narrativ_sso=abc'), '/studio/assets?narrativ_sso=abc');
});

test('studio route: the query follows what is on screen', () => {
  const s = { persona: 'DINK', territory: 'DINK_SOCK', region: 'CA' };
  assert.equal(withState('build', '?persona=FAM&territory=FAM_SUMMER&region=US', s), '?persona=DINK&territory=DINK_SOCK&region=CA');
  assert.equal(withState('assets', '?persona=FAM&territory=FAM_SUMMER', { ...s, stub: 'DINK_SOCK_ST_A1_CA_META' }), '?region=CA&stub=DINK_SOCK_ST_A1_CA_META');
  assert.equal(withState('assets', '?stub=OLD&asset=up_1', { ...s, stub: null }), '?region=CA');
  assert.equal(withState('home', '?persona=FAM&territory=FAM_SUMMER', { region: 'US' }), '?region=US');
  assert.equal(withState('review', '?batch=b1', s), '?batch=b1&persona=DINK&territory=DINK_SOCK&region=CA');
});
