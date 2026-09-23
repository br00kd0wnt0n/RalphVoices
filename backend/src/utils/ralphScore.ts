// RalphScore™ — 0-100 benchmark computed from a test_results summary.
//
// This is the canonical copy. frontend/src/lib/ralphScore.ts is a byte-for-byte
// mirror of calculateRalphScore (used as a fallback for tests completed before
// the score was stored). backend/tests/ralphScore.test.ts proves the two agree.
//
// Any change to the maths MUST bump RALPH_SCORE_VERSION so scores already
// delivered to clients stay fixed; recompute old tests on purpose with
// backend/scripts/backfill-ralph-score.ts.

export const RALPH_SCORE_VERSION = 1;

export interface RalphScoreSummary {
  sentiment: { positive: number; neutral: number; negative: number };
  avg_engagement: number;
  avg_share_likelihood: number;
  avg_comprehension: number;
  total_responses: number;
}

export function calculateRalphScore(summary: RalphScoreSummary): number {
  const total = summary.sentiment.positive + summary.sentiment.neutral + summary.sentiment.negative;
  if (total === 0) return 0;

  // Calculate sentiment score (weighted average: positive=10, neutral=5, negative=1)
  const sentimentScore = (
    (summary.sentiment.positive * 10) +
    (summary.sentiment.neutral * 5) +
    (summary.sentiment.negative * 1)
  ) / total;

  // Base score from metrics (all out of 10, weighted)
  const baseScore = (
    (sentimentScore * 0.30) +           // 30% sentiment
    (summary.avg_engagement * 0.30) +    // 30% engagement
    (summary.avg_share_likelihood * 0.25) + // 25% share likelihood
    (summary.avg_comprehension * 0.15)   // 15% comprehension
  );

  // Sentiment distribution modifier
  const positiveRatio = summary.sentiment.positive / total;
  const negativeRatio = summary.sentiment.negative / total;
  const distributionModifier = 1 + (positiveRatio * 0.1) - (negativeRatio * 0.15);

  // Calculate final score (0-100)
  const ralphScore = Math.round(baseScore * 10 * distributionModifier);

  // Clamp between 0-100
  return Math.max(0, Math.min(100, ralphScore));
}
