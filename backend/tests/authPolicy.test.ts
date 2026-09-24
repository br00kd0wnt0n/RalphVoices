// Sign-in policy: password auth is closed unless PASSWORD_AUTH=open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrationAllowed, passwordLoginAllowed, tokenAllowed } from '../src/utils/authPolicy.js';

const closed = {} as NodeJS.ProcessEnv;
const closedWithService = { PASSWORD_LOGIN_EMAILS: ' Runner@Ralph.World , other@ralph.world' } as NodeJS.ProcessEnv;
const open = { PASSWORD_AUTH: 'open' } as NodeJS.ProcessEnv;

test('closed by default: no registration, no password login', () => {
  assert.equal(registrationAllowed('demo@ralph.world', closed), false);
  assert.equal(passwordLoginAllowed('demo@ralph.world', closed), false);
});

test('closed: allowlisted emails may still use password login (case-insensitive)', () => {
  assert.equal(passwordLoginAllowed('runner@ralph.world', closedWithService), true);
  assert.equal(passwordLoginAllowed('stranger@example.com', closedWithService), false);
  assert.equal(registrationAllowed('stranger@example.com', closedWithService), false);
  assert.equal(registrationAllowed('runner@ralph.world', closedWithService), true);
});

test('closed: SSO tokens accepted, pre-lock and non-allowlisted password tokens rejected', () => {
  assert.equal(tokenAllowed('sso', 'anyone@ralph.world', closedWithService), true);
  assert.equal(tokenAllowed(undefined, 'anyone@ralph.world', closedWithService), false);
  assert.equal(tokenAllowed('password', 'stranger@example.com', closedWithService), false);
  assert.equal(tokenAllowed('password', 'RUNNER@ralph.world', closedWithService), true);
});

test('open (local dev): everything allowed', () => {
  assert.equal(registrationAllowed('x@y.z', open), true);
  assert.equal(passwordLoginAllowed('x@y.z', open), true);
  assert.equal(tokenAllowed(undefined, 'x@y.z', open), true);
});
