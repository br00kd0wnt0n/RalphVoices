// "On behalf of" (utils/actor.ts): by and for, packed into one text column where there's no JSON to hold both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFor, decidedBy, packActor, unpackActor, whoWords } from '../src/utils/actor.js';

test('actor: pack and unpack round-trip; your own call has no "for"; older rows read as before', () => {
  assert.equal(packActor('brook@ralph.world', 'nick@ralph.world'), 'brook@ralph.world (for nick@ralph.world)');
  assert.deepEqual(unpackActor('brook@ralph.world (for nick@ralph.world)'), { by: 'brook@ralph.world', for: 'nick@ralph.world' });
  assert.equal(packActor('brook', ''), 'brook');
  assert.equal(packActor('brook', 'Brook'), 'brook', 'naming yourself is nobody');
  assert.deepEqual(unpackActor('nick'), { by: 'nick' }, 'a row from before "on behalf of"');
  assert.deepEqual(unpackActor(null), { by: '' });
  assert.equal(cleanFor('  nick ', 'brook'), 'nick');
  assert.equal(cleanFor('BROOK', 'brook'), undefined);
  assert.equal(decidedBy('brook', 'nick'), 'nick');
  assert.equal(decidedBy('brook'), 'brook');
  assert.equal(whoWords('brook', 'nick'), 'brook for nick');
  assert.equal(whoWords('brook'), 'brook');
});
