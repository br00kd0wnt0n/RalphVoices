// B2 pre-flight audit: CLI (VOICES v2, Trupanion, 28 Sep 2026).
//
// Checks finished ad assets (statics, carousel cards, video keyframes) against
// the persona turn-offs, the compliance and brand rules and glance clarity in
// the Studio rules file, and tags each with the rubric's content features.
// Flags with sources; never a score. A script, not part of the app: no
// database, no routes, no deploy. Client material stays outside the repo:
//   in:  /Users/BD/ralph-voices/Claude outputs/voices-r1/assets/<round>/   (named by naming stub)
//   out: /Users/BD/ralph-voices/Claude outputs/voices-r1/audit/<round>/    (reports/, summary.md, features.csv, flag-sheet.csv, audit.json)
//
// Usage (from backend/):
//   npx tsx scripts/audit.ts estimate --round month1                 (cost and time, no calls)
//   npx tsx scripts/audit.ts run      --round month1 [--only STUB,STUB] [--yes]
//   npx tsx scripts/audit.ts concepts [--only CODE] [--compare-only] [--yes]                       (acceptance: nine concept cards, text only, against the spike's M3 table)
//   npx tsx scripts/audit.ts plant                                    (acceptance: make the planted test images in assets/planted/)
//   npx tsx scripts/audit.ts agree    --file flag-sheet.csv           (agreement from a sheet Brook has marked agree/disagree)
//   npx tsx scripts/audit.ts status                                   (spend so far)
// Common flags:
//   --mock              no network, no cost (tesseract stands in for vision; yes/no reads are heuristics)
//   --tpm 15000         gpt-4o tokens per minute. The account's 30k is shared with Studio; 15k leaves it half
//   --cap 10            session spend cap in USD (audit/spend.json is cumulative)
//   --concurrency 3
//   --dir PATH          a round folder somewhere else (default assets/<round>)
//   --yes               needed for any run estimated over $2

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AuditApi, readSpend } from '../src/services/audit/api.js';
import { discoverRound } from '../src/services/audit/assets.js';
import { MODELS } from '../src/services/audit/engine.js';
import { CONFIG } from '../src/services/audit/config.js';
import { mockResponder } from '../src/services/audit/mock.js';
import { agreement, parseCsvObjects } from '../src/services/audit/report.js';
import { ASSETS_DIR, AUDIT_DIR, CLIENT_DIR, loadRubric, loadRules, readJson } from '../src/services/audit/rules.js';
import { compareM3, conceptAssets, estimateRound, loadPersonas, runRound } from '../src/services/audit/round.js';
import { uncoveredTurnOffs, buildItems } from '../src/services/audit/checks.js';
import type { Asset } from '../src/services/audit/types.js';

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (n: string) => argv.includes(`--${n}`);
function opt(n: string, d = ''): string { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; }

const MOCK = flag('mock');
const CAP = Number(opt('cap', String(CONFIG.cap_usd)));
const ASK_OVER = CONFIG.ask_over_usd;
const SPEND = path.join(AUDIT_DIR, 'spend.json');

/** The CLI's key: ~/.config/voices/openai.key (or AUDIT_KEY_FILE), else OPENAI_API_KEY, else backend/.env's line (never dotenv). */
function loadKey(): string {
  const keyFile = process.env.AUDIT_KEY_FILE || path.join(process.env.HOME || '', '.config/voices/openai.key');
  if (fs.existsSync(keyFile)) { const k = fs.readFileSync(keyFile, 'utf8').trim(); if (k.length > 20) return k; }
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const env = path.resolve(path.dirname(process.argv[1] || '.'), '../.env');
  if (fs.existsSync(env)) {
    const m = /^OPENAI_API_KEY\s*=\s*(.*)$/m.exec(fs.readFileSync(env, 'utf8'));
    const k = m?.[1].trim().replace(/^['"]|['"]$/g, '') || '';
    if (k.length > 20 && !k.includes('...')) return k;
  }
  throw new Error('No OpenAI key: put it in ~/.config/voices/openai.key or export OPENAI_API_KEY');
}

function makeApi(logPath?: string) {
  const tpm = Number(opt('tpm', String(CONFIG.tpm_default)));
  return new AuditApi({
    mock: MOCK ? mockResponder() : undefined,
    apiKey: MOCK ? undefined : loadKey(),
    tpm: { [MODELS.yesno]: tpm, [MODELS.compliance]: 150000 },
    capUsd: CAP, spendPath: SPEND, logPath, transcribeUsdPerMinute: CONFIG.transcribe_usd_per_minute,
  });
}

function mins(tokens: number) {
  const tpm = Number(opt('tpm', String(CONFIG.tpm_default)));
  return tokens / tpm;
}

function printEstimate(est: ReturnType<typeof estimateRound>) {
  console.log('\nEstimate (before any call):');
  for (const x of est.per) console.log(`  ${(x.asset.stub?.stub || x.asset.name).padEnd(34)} ${x.asset.kind.padEnd(8)} ${String(x.asset.frames.length || 'text').padStart(4)} img  ${String(x.calls).padStart(4)} calls  ~$${x.usd.toFixed(3)}`);
  const spent = MOCK ? 0 : readSpend(SPEND).total_usd;
  console.log(`  Total ~$${est.usd.toFixed(2)} (${est.calls} calls, ~${Math.ceil(mins(est.tokens))} min at ${opt('tpm', String(CONFIG.tpm_default))} gpt-4o TPM). Spent so far $${spent.toFixed(2)} of the $${CAP} cap.`);
  return spent;
}

function gate(est: ReturnType<typeof estimateRound>): boolean {
  const spent = printEstimate(est);
  if (MOCK) return true;
  if (spent + est.usd > CAP) { console.log(`Refusing: the estimate would take spend past the $${CAP} cap.`); return false; }
  if (est.usd > ASK_OVER && !flag('yes')) { console.log(`This run is estimated over $${ASK_OVER}. Ask Brook, then re-run with --yes.`); return false; }
  return true;
}

function roundDirs(round: string) {
  const dir = path.resolve(opt('dir', path.join(ASSETS_DIR, round)));
  const out = path.join(AUDIT_DIR, MOCK ? `${round}-mock` : round);
  return { dir, out };
}

async function main() {
  const rules = loadRules();
  const rubric = loadRubric();
  switch (command) {
    case 'estimate':
    case 'run': {
      const round = opt('round');
      if (!round) throw new Error(`usage: ${command} --round NAME`);
      const { dir, out } = roundDirs(round);
      fs.mkdirSync(out, { recursive: true });
      let assets = await discoverRound(dir, out, Object.keys(rules.personas));
      const only = opt('only');
      if (only) { const want = only.toUpperCase().split(','); assets = assets.filter(a => want.includes((a.stub?.stub || a.name).toUpperCase()) || want.includes(a.name.toUpperCase())); }
      if (!assets.length) { console.log(`No assets in ${dir}.`); return; }
      for (const a of assets.filter(x => !x.stub)) console.log(`  ! ${a.name}: ${a.stub_error} (audited, but B3 can't join it)`);
      const api = makeApi(path.join(out, 'calls.jsonl'));
      const est = estimateRound(assets, { api, rules, rubric });
      if (command === 'estimate') { printEstimate(est); return; }
      if (!gate(est)) return;
      await go(assets, api, round, out);
      return;
    }
    case 'concepts': {
      const out = path.join(AUDIT_DIR, MOCK ? 'concepts-r1-mock' : 'concepts-r1');
      fs.mkdirSync(out, { recursive: true });
      const onlyC = opt('only') ? opt('only').toUpperCase().split(',') : null;
      const assets = conceptAssets().filter(x => !onlyC || onlyC.includes(x.name) || onlyC.includes(x.stub?.stub.toUpperCase() || ''));
      if (!flag('compare-only')) {
        const api = makeApi(path.join(out, 'calls.jsonl'));
        const est = estimateRound(assets, { api, rules, rubric });
        if (!gate(est)) return;
        await go(assets, api, 'concepts-r1', out);
      }
      // Every card audited so far (a --only re-run keeps the others), against the spike.
      const m3 = readJson(path.join(CLIENT_DIR, 'sm-spike', 'full', 'results.json')).m3_features as Record<string, Record<string, number>>;
      const rows = compareM3(Object.values(readJson(path.join(out, 'audit.json'))), m3);
      const L = ['# Concept cards against the spike\'s M3 table', '', `${new Date().toISOString().slice(0, 10)} · nine round-one cards run as text-only assets through the B2 audit (same rubric wordings, gpt-4o, temperature 0, P(Yes) from logprobs, both wordings averaged).`, '',
        '| Item | Cards | Same side of 0.5 | Mean abs. difference | Max abs. difference | Over 0.3 |', '|---|---|---|---|---|---|'];
      for (const r of rows) L.push(`| ${r.item} | ${r.n} | ${r.sameSide}/${r.n} | ${r.meanAbs.toFixed(3)} | ${r.maxAbs.toFixed(3)} | ${r.over.map(o => `${o.code} (B2 ${o.ours.toFixed(2)}, spike ${o.spike.toFixed(2)})`).join('; ')} |`);
      const cells = rows.reduce((s, r) => s + r.n, 0), same = rows.reduce((s, r) => s + r.sameSide, 0);
      const over = rows.flatMap(r => r.over.map(o => ({ item: r.item, ...o })));
      L.push('', `Overall: ${same}/${cells} cells on the same side of 0.5; ${over.length} cells differ by more than 0.3.`, '');
      fs.writeFileSync(path.join(out, 'm3-agreement.md'), L.join('\n'));
      console.log(`\n${L.slice(4).join('\n')}\nWrote ${path.join(out, 'm3-agreement.md')}`);
      return;
    }
    case 'plant': return plant();
    case 'agree': {
      const file = opt('file');
      if (!file) throw new Error('usage: agree --file flag-sheet.csv');
      const r = agreement(parseCsvObjects(fs.readFileSync(file, 'utf8')));
      console.log(`Marked ${r.marked} flags: ${r.agree} agree (${(r.rate * 100).toFixed(0)}%). Target: at least 90%.`);
      for (const [s, v] of Object.entries(r.bySeverity)) console.log(`  ${s}: ${v.agree}/${v.marked}`);
      if (r.misses.length) { console.log('Disagreed:'); for (const m of r.misses) console.log(`  ${m.stub} #${m.n} ${m.severity} ${m.rule}${m.persona ? ` (${m.persona})` : ''}: ${m.quote || m.why}${m.note ? `  [note: ${m.note}]` : ''}`); }
      return;
    }
    case 'status': {
      const s = readSpend(SPEND);
      console.log(`Audit spend: $${s.total_usd.toFixed(2)} of the $${CAP} cap over ${s.runs.length} runs.`);
      for (const r of s.runs.slice(-10)) console.log(`  ${r.at}  ${r.tag}  $${r.usd}  ${r.calls} calls`);
      const items = buildItems(rules, rubric, { video: true });
      console.log(`Rules ${rules.version}, rubric ${rubric.version}: ${items.length} yes/no items per video asset. Model turn-offs with no question: ${uncoveredTurnOffs(rules, items).join(', ') || 'none'}.`);
      return;
    }
    default:
      console.log('Commands: estimate, run, concepts, plant, agree, status. See the header of scripts/audit.ts.');
  }

  async function go(assets: Asset[], api: AuditApi, round: string, out: string) {
    const t0 = Date.now();
    let res;
    try {
      res = await runRound(assets, {
        api, rules, rubric, workDir: out, personas: loadPersonas(rules),
        concurrency: Number(opt('concurrency', '3')),
      }, { round, outDir: out, rubricVersion: rubric.version, cap: CAP });
    } finally {
      api.record({ tag: `audit ${round}${MOCK ? ' (mock)' : ''}`, assets: assets.length, seconds: Math.round((Date.now() - t0) / 1000) });
    }
    if (api.stopped) console.log(`Stopped: ${api.stopped}`);
    console.log(`\nDone: ${res.audits.length} assets, ${api.calls} calls, $${api.usd.toFixed(3)}, ${Math.round((Date.now() - t0) / 1000)} s.`);
    console.log(`  Summary:  ${res.summaryPath}\n  Reports:  ${path.join(out, 'reports')}/\n  Features: ${res.featuresPath}  (B3: npx tsx scripts/weekly.ts features --file "${res.featuresPath}")\n  Flags:    ${res.sheetPath}  (mark agree/disagree, then: npx tsx scripts/audit.ts agree --file ...)`);
    return res;
  }
}

// Planted test images: plain text on a coloured background (made here with
// Python's PIL; no stock photos). Two must be red, one must pass with no red.
function plant() {
  const dir = path.join(ASSETS_DIR, 'planted');
  fs.mkdirSync(dir, { recursive: true });
  const specs = [
    { file: 'DINK_PLANTPAYS_ST_v1_META.png', bg: '#1f6f8b', lines: ['Honestly?', 'It pays for itself.', '', 'Medical insurance for pets', 'from Trupanion'] },
    { file: 'FAM_PLANTDIRECT_ST_v1_META.png', bg: '#8b3a62', lines: ['One less job.', 'We pay your vet directly', 'at checkout.', '', 'Trupanion'] },
    { file: 'CUR_PLANTCLEAN_ST_v1_META.png', bg: '#2e6b3f', lines: ['Cover from the start.', 'Your vet can be paid directly', 'at checkout at participating hospitals.', '', 'Trupanion: medical insurance', 'for cats and dogs'] },
    { file: 'DINK_PLANTCAR_CAR_v1_META/1.png', bg: '#5b4a8b', lines: ['You budgeted for', 'the cat tree.'] },
    { file: 'DINK_PLANTCAR_CAR_v1_META/2.png', bg: '#5b4a8b', lines: ['And the fancy food.'] },
    { file: 'DINK_PLANTCAR_CAR_v1_META/3.png', bg: '#5b4a8b', lines: ['Not the emergency surgery', 'that can run $6,000.', '', 'Medical insurance for pets', 'from Trupanion'] },
    { file: '_vid/1.png', bg: '#c26a1b', lines: ['Summer plans?'] },
    { file: '_vid/2.png', bg: '#c26a1b', lines: ['One vet bill', 'can change them.'] },
    { file: '_vid/3.png', bg: '#c26a1b', lines: ['Trupanion', 'Medical insurance for pets'] },
  ];
  const py = `
import json, sys, os
from PIL import Image, ImageDraw, ImageFont
specs = json.loads(sys.argv[1]); root = sys.argv[2]
font = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
for s in specs:
    p = os.path.join(root, s["file"]); os.makedirs(os.path.dirname(p), exist_ok=True)
    im = Image.new("RGB", (1080, 1080), s["bg"]); d = ImageDraw.Draw(im)
    lines = s["lines"]; size = 64 if max(len(l) for l in lines) < 28 else 50
    f = ImageFont.truetype(font, size); lh = int(size * 1.35)
    y = (1080 - lh * len(lines)) // 2
    for l in lines:
        w = d.textlength(l, font=f); d.text(((1080 - w) / 2, y), l, font=f, fill="white"); y += lh
    im.save(p)
`;
  execFileSync('python3', ['-c', py, JSON.stringify(specs), dir]);
  // A 9-second video from three cards (3 s each), to exercise the keyframe path.
  const vid = path.join(dir, '_vid');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '1/3', '-i', path.join(vid, '%d.png'), '-c:v', 'libx264', '-r', '25', '-pix_fmt', 'yuv420p', path.join(dir, 'FAM_PLANTVID_VID_v1_META.mp4')]);
  // The same cards with a spoken claim (macOS `say`, made here): the voice-over must be transcribed and flagged red.
  const vo = path.join(vid, 'vo.aiff');
  execFileSync('say', ['-o', vo, 'Summer plans? Honestly, they pay the whole vet bill. Trupanion.']);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '1/3', '-i', path.join(vid, '%d.png'), '-i', vo, '-c:v', 'libx264', '-r', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '9', path.join(dir, 'FAM_PLANTVO_VID_v1_META.mp4')]);
  fs.writeFileSync(path.join(dir, 'FAM_PLANTVID_VID_v1_META.txt'), 'Primary text: The best pet insurance for busy families. Nothing to file, nothing to float on the card.\nHeadline: Summer, sorted, whatever the dog eats next\n');
  fs.writeFileSync(path.join(dir, 'DINK_PLANTPAYS_ST_v1_META.txt'), 'Primary text: Your fur baby deserves the good stuff.\nHeadline: Do the maths\n');
  console.log(`Planted assets in ${dir}:\n${fs.readdirSync(dir).filter(n => !n.startsWith('_')).map(n => `  ${n}`).join('\n')}\nExpected: PLANTPAYS red (COMP_PAYS_FOR_ITSELF), PLANTDIRECT red (COMP_DIRECT_PAY), PLANTCLEAN no red, PLANTVO red on the transcribed voice-over (COMP_PAID_SHARE).`);
}

main().catch(err => { console.error(err?.stack || err); process.exit(1); });
