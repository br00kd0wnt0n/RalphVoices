// Reads a request repeats are loaded once inside withMemo, and never cached outside it (utils/requestMemo.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memo, withMemo } from '../src/utils/requestMemo.js';

test('request memo: once per key inside a request, fresh for the next request, nothing kept outside one', async () => {
  let loads = 0;
  const signoffs = () => memo('signoffs', async () => { loads++; return [loads]; });
  const inOne = await withMemo(async () => Promise.all([signoffs(), signoffs(), withMemo(signoffs)]));
  assert.deepEqual([inOne.map(x => x[0]), loads], [[1, 1, 1], 1], 'one load for the request, shared by nested calls and calls made together');
  await withMemo(signoffs);
  assert.equal(loads, 2, 'the next request loads again');
  await signoffs(); await signoffs();
  assert.equal(loads, 4, 'outside a request (writes, jobs) every read is fresh');
});

test('request memo: a failed load is not kept, so a retry in the same request loads again', async () => {
  let n = 0;
  const flaky = () => memo('x', async () => { n++; if (n === 1) throw new Error('database busy'); return n; });
  await withMemo(async () => {
    await assert.rejects(flaky(), /database busy/);
    assert.equal(await flaky(), 2);
  });
});
