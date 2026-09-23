// One-off backfill: compute and store summary.ralph_score (+ ralph_score_version)
// for completed tests whose test_results predate server-side RalphScore.
// Uses the same util processTestResponses uses, so numbers match what the
// results page showed when it computed the score client-side.
//
// Idempotent: rows that already have summary.ralph_score are skipped unless
// --recompute is passed (use that only on purpose, after bumping
// RALPH_SCORE_VERSION — it changes numbers clients may already have seen).
//
// Usage (local):
//   DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_dev \
//     npx tsx scripts/backfill-ralph-score.ts --dry-run
//
// Flags:
//   --dry-run        Print what would change; write nothing.
//   --recompute      Also overwrite rows that already have a stored score.
//   --allow-remote   Required when DATABASE_URL is not localhost (i.e. Railway).
//                    Guard against running this against production by accident.

import dotenv from 'dotenv';
import { pool, query } from '../src/db/index.js';
import { calculateRalphScore, RALPH_SCORE_VERSION } from '../src/utils/ralphScore.js';

dotenv.config();

const dryRun = process.argv.includes('--dry-run');
const recompute = process.argv.includes('--recompute');
const allowRemote = process.argv.includes('--allow-remote');

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL || '').hostname;
  } catch {
    return '';
  }
}

function isUsableSummary(s: any): boolean {
  return !!s && !!s.sentiment
    && ['positive', 'neutral', 'negative'].every((k) => typeof s.sentiment[k] === 'number')
    && ['avg_engagement', 'avg_share_likelihood', 'avg_comprehension'].every((k) => typeof s[k] === 'number');
}

async function backfill(): Promise<void> {
  const host = dbHost();
  if (!host) {
    console.error('DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  console.log(`Target database host: ${host}${dryRun ? ' (dry run)' : ''}`);
  if (!local && !allowRemote) {
    console.error('Refusing to touch a non-local database without --allow-remote.');
    process.exit(1);
  }

  const rows = await query<{ test_id: string; name: string; summary: any }>(
    `SELECT tr.test_id, t.name, tr.summary
       FROM test_results tr
       JOIN tests t ON t.id = tr.test_id
      WHERE t.status = 'complete'
      ORDER BY t.completed_at NULLS LAST, t.created_at`
  );

  let updated = 0;
  let alreadyStored = 0;
  let unusable = 0;

  for (const row of rows.rows) {
    const summary = typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary;
    if (!isUsableSummary(summary)) {
      unusable++;
      console.warn(`  skip ${row.test_id} "${row.name}": summary missing sentiment/means`);
      continue;
    }
    if (typeof summary.ralph_score === 'number' && !recompute) {
      alreadyStored++;
      continue;
    }

    const score = calculateRalphScore(summary);
    const previous = typeof summary.ralph_score === 'number' ? ` (was ${summary.ralph_score} v${summary.ralph_score_version})` : '';
    console.log(`  ${dryRun ? 'would set' : 'set'} ${row.test_id} "${row.name}": ralph_score=${score} v${RALPH_SCORE_VERSION}${previous}`);

    if (!dryRun) {
      await query(
        `UPDATE test_results
            SET summary = summary || jsonb_build_object('ralph_score', $1::int, 'ralph_score_version', $2::int)
          WHERE test_id = $3`,
        [score, RALPH_SCORE_VERSION, row.test_id]
      );
    }
    updated++;
  }

  console.log(
    `\n${rows.rows.length} complete test(s): ${updated} ${dryRun ? 'to update' : 'updated'}, ` +
    `${alreadyStored} already stored, ${unusable} unusable.`
  );
}

backfill()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
