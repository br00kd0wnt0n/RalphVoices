// parseConceptResponse: well-formed output parses exactly as before; common
// formatting slips still parse; unreadable scores throw instead of becoming 5s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConceptResponse, ScoreParseError } from '../src/utils/parseConceptResponse.js';

const SCORES = '{"sentiment_score": 7, "engagement_likelihood": 6, "share_likelihood": 4, "comprehension_score": 9, "reaction_tags": ["intrigued", "fresh_take"]}';
const expected = { sentiment_score: 7, engagement_likelihood: 6, share_likelihood: 4, comprehension_score: 9, reaction_tags: ['intrigued', 'fresh_take'] };

test('well-formed output', () => {
  const r = parseConceptResponse(`Honestly? I'd stop scrolling.\n\n---SCORES---\n${SCORES}`);
  assert.deepEqual(r, { response_text: "Honestly? I'd stop scrolling.", ...expected });
});

test('```json fence around the object', () => {
  const r = parseConceptResponse(`Love it.\n---SCORES---\n\`\`\`json\n${SCORES}\n\`\`\``);
  assert.deepEqual(r, { response_text: 'Love it.', ...expected });
});

test('prose after the object', () => {
  const r = parseConceptResponse(`Meh.\n---SCORES---\n${SCORES}\n\nHope that helps!`);
  assert.deepEqual(r, { response_text: 'Meh.', ...expected });
});

test('missing separator but object at the end', () => {
  const r = parseConceptResponse(`Not for me, the price feels vague.\n\n${SCORES}`);
  assert.deepEqual(r, { response_text: 'Not for me, the price feels vague.', ...expected });
});

test('braces inside the in-character text do not confuse it', () => {
  const r = parseConceptResponse(`My cat {Biscuit} would approve.\n---SCORES---\n${SCORES}`);
  assert.equal(r.response_text, 'My cat {Biscuit} would approve.');
  assert.equal(r.sentiment_score, 7);
});

test('numeric strings and out-of-range values are coerced and clamped', () => {
  const r = parseConceptResponse('ok\n---SCORES---\n{"sentiment_score": "8", "engagement_likelihood": 12, "share_likelihood": 0, "comprehension_score": 7.5, "reaction_tags": ["bored"]}');
  assert.deepEqual(
    [r.sentiment_score, r.engagement_likelihood, r.share_likelihood, r.comprehension_score],
    [8, 10, 1, 7.5]
  );
});

test('missing or non-string tags fall back to needs_more_info', () => {
  const r = parseConceptResponse('ok\n---SCORES---\n{"sentiment_score": 5, "engagement_likelihood": 5, "share_likelihood": 5, "comprehension_score": 5}');
  assert.deepEqual(r.reaction_tags, ['needs_more_info']);
});

for (const [name, content] of [
  ['no scores at all', 'Just an in-character reply with no JSON.'],
  ['truncated JSON after separator', 'ok\n---SCORES---\n{"sentiment_score": 7, "engagement_like'],
  ['a score field missing', 'ok\n---SCORES---\n{"sentiment_score": 7, "engagement_likelihood": 6, "share_likelihood": 4, "reaction_tags": []}'],
  ['a score that is not a number', 'ok\n---SCORES---\n{"sentiment_score": "high", "engagement_likelihood": 6, "share_likelihood": 4, "comprehension_score": 9}'],
  ['empty completion', ''],
] as const) {
  test(`throws ScoreParseError: ${name}`, () => {
    assert.throws(() => parseConceptResponse(content), ScoreParseError);
  });
}
