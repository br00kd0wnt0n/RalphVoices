// withRetry: the single retry layer for concept-response calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, isTransient, retryDelayMs } from '../src/utils/retry.js';

const httpError = (status: number, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { status, headers });

test('transient: 408, 409, 429, 5xx and status-less errors; not other 4xx', () => {
  for (const s of [408, 409, 429, 500, 503]) assert.ok(isTransient(httpError(s)), String(s));
  assert.ok(isTransient(new Error('network down')));
  for (const s of [400, 401, 403, 404, 422]) assert.ok(!isTransient(httpError(s)), String(s));
});

test('3 attempts in total for a persistent transient failure', async () => {
  let calls = 0;
  const delays: number[] = [];
  await assert.rejects(
    withRetry(async () => { calls++; throw httpError(500); }, 't', 2, async (ms) => { delays.push(ms); })
  );
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test('non-transient errors are not retried', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw httpError(400); }, 't', 2, async () => {}));
  assert.equal(calls, 1);
});

test('succeeds on a later attempt', async () => {
  let calls = 0;
  const result = await withRetry(async () => { if (++calls < 3) throw httpError(429); return 'ok'; }, 't', 2, async () => {});
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('Retry-After stretches the delay; ignored when shorter than backoff or over 60s', () => {
  assert.equal(retryDelayMs(httpError(429, { 'retry-after': '7' }), 0), 7000);
  assert.equal(retryDelayMs(httpError(429, { 'retry-after-ms': '9500' }), 0), 9500);
  assert.equal(retryDelayMs(httpError(429, { 'retry-after': '1' }), 1), 4000);
  assert.equal(retryDelayMs(httpError(429, { 'retry-after': '120' }), 0), 2000);
  assert.equal(retryDelayMs(new Error('no headers'), 1), 4000);
});
