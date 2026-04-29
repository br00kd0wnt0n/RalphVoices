// One-time migration: walk every test's options.assets array, upload any
// inline-base64 image/PDF payload to R2, and rewrite the JSONB so it stores a
// URL instead. Idempotent — assets that already have a `url` are skipped.
//
// Usage:
//   ENABLE_R2_STORAGE=true \
//   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//   R2_BUCKET_NAME=... R2_PUBLIC_URL=... \
//   npx tsx backend/scripts/migrate-assets-to-r2.ts
//
// Run with --dry-run to preview without writing.

import dotenv from 'dotenv';
import { pool, query } from '../src/db/index.js';
import { isR2Enabled, uploadBuffer } from '../src/services/r2.js';

dotenv.config();

interface Asset {
  name?: string;
  mimeType?: string;
  base64?: string;
  url?: string;
  isImage?: boolean;
  isPDF?: boolean;
  extractedText?: string;
  [key: string]: unknown;
}

const dryRun = process.argv.includes('--dry-run');

function parseDataUrl(input: string): { mimeType: string; buffer: Buffer } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(input);
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

async function migrate(): Promise<void> {
  if (!isR2Enabled()) {
    console.error('R2 storage is not enabled or not fully configured. Aborting.');
    process.exit(1);
  }

  const tests = await query<{ id: string; options: any }>(
    "SELECT id, options FROM tests WHERE options IS NOT NULL"
  );

  console.log(`Scanning ${tests.rows.length} test(s)…`);

  let migrated = 0;
  let skipped = 0;
  let touched = 0;

  for (const test of tests.rows) {
    const options = typeof test.options === 'string' ? JSON.parse(test.options) : test.options;
    const assets: Asset[] | undefined = options?.assets;
    if (!Array.isArray(assets) || assets.length === 0) continue;

    let changed = false;

    for (const asset of assets) {
      if (asset.url) {
        skipped++;
        continue;
      }
      if (typeof asset.base64 !== 'string' || !asset.base64.startsWith('data:')) {
        skipped++;
        continue;
      }

      const parsed = parseDataUrl(asset.base64);
      if (!parsed) {
        console.warn(`  [test ${test.id}] asset ${asset.name ?? '?'}: malformed data URL, skipping.`);
        skipped++;
        continue;
      }

      try {
        if (dryRun) {
          console.log(`  [dry-run] would upload ${asset.name ?? '?'} (${parsed.buffer.length} bytes)`);
        } else {
          const uploaded = await uploadBuffer(parsed.buffer, parsed.mimeType, asset.name ?? 'asset');
          asset.url = uploaded.url;
          if (asset.isImage) {
            // Image content moved to R2; drop the inline base64 to free Postgres.
            asset.base64 = '';
          }
          // PDFs keep extractedText (they always did) — keep base64 too for now
          // since downstream code may still reference it; that's safe to drop in
          // a follow-up once everything reads from `url`.
          changed = true;
        }
        migrated++;
      } catch (err) {
        console.error(`  [test ${test.id}] asset ${asset.name ?? '?'} upload failed:`, err);
      }
    }

    if (changed && !dryRun) {
      await query('UPDATE tests SET options = $1 WHERE id = $2', [JSON.stringify(options), test.id]);
      touched++;
    }
  }

  console.log(
    dryRun
      ? `\nDry run complete. Would migrate ${migrated} asset(s); skipped ${skipped}.`
      : `\nMigrated ${migrated} asset(s) across ${touched} test row(s); skipped ${skipped}.`
  );

  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  pool.end();
  process.exit(1);
});
