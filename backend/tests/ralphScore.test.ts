// Proves the server-side RalphScore (backend/src/utils/ralphScore.ts) and the
// frontend fallback (frontend/src/lib/ralphScore.ts) give identical scores, and
// that both still match the pre-move client formula (expected values in the
// fixture were generated from calculateRalphScore in TestResults.tsx at fda3131,
// before it was moved). Run: cd backend && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateRalphScore as backendScore, RALPH_SCORE_VERSION as backendVersion } from '../src/utils/ralphScore.js';
import { calculateRalphScore as frontendScore, RALPH_SCORE_VERSION as frontendVersion } from '../../frontend/src/lib/ralphScore.js';

const fixtures: Array<{ name: string; summary: any; expected_ralph_score: number }> = JSON.parse(
  readFileSync(new URL('./fixtures/ralph-score-summaries.json', import.meta.url), 'utf-8')
);

test('fixture set has at least 5 summaries', () => {
  assert.ok(fixtures.length >= 5);
});

for (const f of fixtures) {
  test(`fixture: ${f.name}`, () => {
    const b = backendScore(f.summary);
    const fr = frontendScore(f.summary);
    assert.equal(b, fr, 'backend and frontend disagree');
    assert.equal(b, f.expected_ralph_score, 'score drifted from the pre-move client formula');
  });
}

test('versions match', () => {
  assert.equal(backendVersion, 1);
  assert.equal(frontendVersion, backendVersion);
});

// Summaries shaped like processTestResponses output: integer sentiment counts,
// means rounded to one decimal. Deterministic LCG so failures reproduce.
test('backend and frontend agree on 5,000 generated summaries', () => {
  let seed = 42;
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
  const mean = () => Math.round((1 + rand() * 9) * 10) / 10;
  for (let i = 0; i < 5000; i++) {
    const total = 1 + Math.floor(rand() * 150);
    const positive = Math.floor(rand() * (total + 1));
    const negative = Math.floor(rand() * (total - positive + 1));
    const summary = {
      total_responses: total,
      sentiment: { positive, neutral: total - positive - negative, negative },
      avg_engagement: mean(),
      avg_share_likelihood: mean(),
      avg_comprehension: mean(),
    };
    assert.equal(backendScore(summary), frontendScore(summary), JSON.stringify(summary));
  }
});
