// Remove a territory's sign-offs: the asset goes back to "not signed off" and its codes start again at A1.
// For sign-offs that were never a decision (Brook, 5 Oct: three made on Sock Eater while trying Build).
// What it touches and why is at the top of src/services/studio/unsign.ts.
//
// It never reads backend/.env and never uses DATABASE_URL: the database is named on the command line.
// It refuses when a code has an upload, an audit, an asset status or a compliance record.
//
// Dry run (the default; writes nothing, prints every row it would delete or change):
//   npx tsx scripts/studio-unsign.ts --territory DINK_SOCK_EATER_DOG --region US --database-url postgresql://…
// Apply (take a backup first). The sign-off ids are the ones the dry run printed; a different list in the
// database stops it:
//   npx tsx scripts/studio-unsign.ts --territory DINK_SOCK_EATER_DOG --region US --database-url postgresql://… \
//     --apply --signoffs ID1,ID2,ID3 --by brook@ralph.world [--reason "Test sign-offs"] [--allow-remote]
//
//   --allow-remote   required when the database is not on this machine (production: with Brook, after a backup)
import pg from 'pg';
import { applyUnsign, describePlan, planUnsign } from '../src/services/studio/unsign.js';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : ''; };

async function main() {
  const territory = opt('territory'), region = (opt('region') || 'US').toUpperCase();
  const url = opt('database-url').trim().replace(/^['"]|['"]$/g, '');
  if (!territory || !url) throw new Error('Usage: studio-unsign.ts --territory CODE [--region US] --database-url URL [--apply --signoffs A,B --by you@… [--allow-remote]]');
  let host = '';
  try { host = new URL(url).hostname; } catch { throw new Error('--database-url is not a URL'); }
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const apply = flag('apply');
  if (!local && apply && !flag('allow-remote')) throw new Error(`Refusing to write to ${host} without --allow-remote (and take a backup first)`);
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    console.log(`${apply ? 'APPLY' : 'DRY RUN (nothing is written)'} · ${host} · ${territory} · ${region}\n`);
    if (!apply) {
      const plan = await planUnsign(pool, territory, region);
      console.log(describePlan(plan));
      if (plan.signoffs.length && !plan.blockers.length) console.log(`\nTo apply: add  --apply --signoffs ${plan.signoffs.map(s => s.id).join(',')} --by <your email>${local ? '' : ' --allow-remote'}`);
      return;
    }
    const expect = opt('signoffs').split(',').map(x => x.trim()).filter(Boolean);
    const by = opt('by');
    if (!expect.length || !by) throw new Error('--apply needs --signoffs (the ids the dry run printed) and --by (who is running it)');
    const res = await applyUnsign(pool, territory, region, { expect, by, reason: opt('reason') || undefined });
    console.log(describePlan(res.plan));
    console.log(`\nDone, in one transaction: ${res.deleted.signoffs} sign-offs, ${res.deleted.expectations} expectations and ${res.deleted.line_versions} line versions deleted${res.kept_versions ? ` (${res.kept_versions} line versions kept for another sign-off)` : ''}; ${res.lines_changed} lines changed; ${res.edits_added} history entries added.`);
    console.log(`Kept lines per run, after: ${Object.entries(res.kept_after).map(([b, n]) => `${b}: ${n}`).join('; ')} (unchanged).`);
    console.log(`No sign-off holds ${res.plan.codes.join(', ')} any more: Build will plan this territory's codes from A1 again.`);
  } finally { await pool.end(); }
}
main().catch(e => { console.error(`\n${e.message}`); process.exit(1); });
