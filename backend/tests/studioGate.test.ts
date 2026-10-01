// Hosted /studio never shows a blank page (Brook's production test, 1 Oct: a first load inside the Narrativ
// shell stayed blank). frontend/src/lib/studioGate.ts decides what shows in place of Studio;
// frontend/src/lib/tokenStore.ts keeps the sign-in token when the frame's storage is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studioGate } from '../../frontend/src/lib/studioGate.js';
import { clearToken, getToken, setToken } from '../../frontend/src/lib/tokenStore.js';

const signedIn = { loading: false, signedIn: true, inFrame: true };

test('studio gate: signing in shows that it is, and Studio waits for it', () => {
  const g = studioGate({ loading: true, signedIn: false, inFrame: true });
  assert.ok(g && g !== 'login');
  assert.equal(g.kind, 'signing_in');
  assert.match(g.title, /Signing you in/);
  // Even with a stale user from before, nothing of Studio shows (so no Studio call) until sign-in has finished.
  assert.equal((studioGate({ loading: true, signedIn: true, inFrame: false }) as any).kind, 'signing_in');
});

test('studio gate: no sign-in goes to /login at top level, and says to reload the tab in the shell', () => {
  assert.equal(studioGate({ loading: false, signedIn: false, inFrame: false }), 'login');
  const g = studioGate({ loading: false, signedIn: false, inFrame: true });
  assert.ok(g && g !== 'login');
  assert.equal(g.kind, 'signed_out');
  assert.match(g.body, /Reload this browser tab/);
  assert.equal(g.reload, false); // reloading the frame alone can't sign in again
});

test('studio gate: signed in with no error shows Studio', () => {
  assert.equal(studioGate(signedIn), null);
  assert.equal(studioGate({ ...signedIn, error: null }), null);
});

test('studio gate: 401 is an expired sign-in, 403 is no Studio access, 404 is switched off', () => {
  const expired = studioGate({ ...signedIn, error: { status: 401, body: { error: 'Invalid token' } } }) as any;
  assert.equal(expired.kind, 'expired');
  assert.match(expired.title, /sign-in has expired/);
  assert.equal(expired.reload, false);
  assert.equal((studioGate({ ...signedIn, inFrame: false, error: { status: 401 } }) as any).reload, true);

  const denied = studioGate({ ...signedIn, error: { status: 403, body: { error: 'studio_not_enabled', message: "Voices Studio isn't switched on for your account. Ask Brook to add you." } } }) as any;
  assert.equal(denied.kind, 'no_access');
  assert.match(denied.title, /don’t have Studio access/);
  assert.match(denied.body, /Ask Brook/);

  assert.equal((studioGate({ ...signedIn, error: { status: 404 } }) as any).kind, 'not_on');
});

test('studio gate: other errors (e.g. no rules yet, a 500) are shown inside Studio', () => {
  assert.equal(studioGate({ ...signedIn, error: { status: 400, body: { error: 'no_rules' } } }), null);
  assert.equal(studioGate({ ...signedIn, error: { status: 500 } }), null);
  // A 403 that isn't the access gate (e.g. an admin-only action) isn't "no access".
  assert.equal(studioGate({ ...signedIn, error: { status: 403, body: { error: 'Admin only' } } }), null);
});

test('token store: keeps the token in memory when storage is refused', () => {
  const g = globalThis as any;
  const had = Object.getOwnPropertyDescriptor(g, 'localStorage');
  // The browser refusing third-party storage: every access throws.
  Object.defineProperty(g, 'localStorage', { configurable: true, get() { throw new Error('SecurityError: access denied'); } });
  try {
    clearToken();
    assert.equal(getToken(), null);
    setToken('voices-jwt');
    assert.equal(getToken(), 'voices-jwt');
    clearToken();
    assert.equal(getToken(), null);
  } finally {
    if (had) Object.defineProperty(g, 'localStorage', had); else delete g.localStorage;
  }
});

test('token store: uses localStorage when it works', () => {
  const g = globalThis as any;
  const had = Object.getOwnPropertyDescriptor(g, 'localStorage');
  const m = new Map<string, string>();
  Object.defineProperty(g, 'localStorage', { configurable: true, value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) } });
  try {
    setToken('t1');
    assert.equal(m.get('token'), 't1');
    m.set('token', 't2'); // signed in again in another tab
    assert.equal(getToken(), 't2');
    clearToken();
    assert.equal(m.has('token'), false);
    assert.equal(getToken(), null);
  } finally {
    if (had) Object.defineProperty(g, 'localStorage', had); else delete g.localStorage;
  }
});
