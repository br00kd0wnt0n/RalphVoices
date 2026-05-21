// Brook 2026-05-20: Voices appears empty (no projects / personas /
// tests visible in the UI). All Voices data is single-user-scoped
// via created_by → users(id), so the visible-empty state is almost
// always one of:
//
//   A. DB genuinely has no projects/personas/tests
//   B. Data exists but is owned by a user_id other than the SSO-
//      minted one Brook authenticates as via Narrativ
//   C. Orphaned rows (created_by points at a deleted users row)
//
// This script dumps the three numbers needed to tell which it is.
// Designed to run from the Voices Railway service's Shell tab —
// just `npm run diagnose:data` and read the output.
//
// Reads only. No mutations. Safe to run multiple times.

import 'dotenv/config';
import { query, pool } from '../src/db/index.js';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  created_at: Date;
}

interface CountByOwnerRow {
  created_by: string | null;
  n: string;
}

async function main(): Promise<void> {
  console.log('\n========== VOICES DATA DIAGNOSTIC ==========\n');

  // 1. Every user row.
  const users = await query<UserRow>(
    `SELECT id, email, name, created_at
       FROM users
      ORDER BY created_at ASC`,
  );
  console.log(`USERS (${users.rows.length} total):`);
  for (const u of users.rows) {
    console.log(`  - ${u.id}  email=${u.email}  name=${u.name ?? '-'}  created=${u.created_at.toISOString()}`);
  }
  if (users.rows.length === 0) {
    console.log('  (no users — SSO has never minted a Voices user)');
  }

  // 2. Counts of every owned row grouped by created_by. Renders
  //    the email next to each id so the output reads at a glance.
  const userById = new Map(users.rows.map(u => [u.id, u]));
  const formatOwner = (id: string | null): string => {
    if (!id) return '(null created_by)';
    const u = userById.get(id);
    return u ? `${u.email} <${id}>` : `<ORPHAN ${id}>`;
  };

  for (const table of ['projects', 'personas', 'tests'] as const) {
    const result = await query<CountByOwnerRow>(
      `SELECT created_by::text, COUNT(*)::text AS n
         FROM ${table}
        GROUP BY created_by
        ORDER BY n DESC`,
    );
    console.log(`\n${table.toUpperCase()} (${result.rows.length} distinct owner${result.rows.length === 1 ? '' : 's'}):`);
    if (result.rows.length === 0) {
      console.log('  (empty table)');
    } else {
      for (const row of result.rows) {
        console.log(`  - ${row.n} owned by ${formatOwner(row.created_by)}`);
      }
    }
  }

  // 3. Orphan check — rows whose created_by points at a deleted user.
  console.log('\nORPHAN CHECK:');
  for (const table of ['projects', 'personas', 'tests'] as const) {
    const orphans = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
         FROM ${table}
        WHERE created_by IS NOT NULL
          AND created_by NOT IN (SELECT id FROM users)`,
    );
    console.log(`  ${table}: ${orphans.rows[0]?.n ?? '0'} orphaned`);
  }

  console.log('\n=== HOW TO READ THIS ===');
  console.log(
    'A. Tables all empty → no data was ever created. Use the UI to add some.\n' +
    'B. Data exists under a user_id != your SSO user_id → wrong-owner scenario.\n' +
    '   Send the output back to Claude and a migration SQL will be written for you.\n' +
    'C. Orphan count > 0 → rows tied to a deleted user. Same migration path.\n',
  );

  await pool.end();
}

main().catch(err => {
  console.error('diagnose-data failed:', err);
  process.exit(1);
});
