#!/usr/bin/env node
// Seed the local Studio preview (4-step flow) through the API: never SQL, never a remote database.
// Needs the preview backend running (.claude/launch.json "studio-preview-backend": port 3041, STUDIO_MOCK=true,
// DATABASE_URL=…/voices_preview). Re-runnable: every step checks what's already there and skips it.
//
//   node scripts/preview-seed.mjs [--api http://localhost:3041/api] [--rules "<path to studio-rules-v2.11.json>"]
//
// Accounts (local test accounts only; password preview-pass):
//   nick@ralph.test  (STUDIO_READY_EMAILS: signs off, marks Pre-flight passed, overrides)
//   brook@ralph.test (ADMIN_EMAILS: uploads and activates the rules)
//   vivan@ralph.test (STUDIO_COMPLIANCE_EMAILS: records Trupanion's decisions)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--api', 'http://localhost:3041/api');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(API)) throw new Error(`Local API only (got ${API})`);
const here = path.dirname(fileURLToPath(import.meta.url));
const RULES = arg('--rules', [
  path.resolve(here, '../Claude outputs/voices-r1/studio/studio-rules-v2.11.json'),
  path.resolve(here, '../../../../Claude outputs/voices-r1/studio/studio-rules-v2.11.json'),  // from a worktree under .claude/worktrees
].find(p => fs.existsSync(p)));
const PASSWORD = 'preview-pass';
const log = (...a) => console.log('·', ...a);

// ---------- http ----------

async function call(token, method, p, body, raw = false) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${API}${p}`, { method, headers, body: payload });
  if (raw) return res;
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return { text }; } })() : {};
  if (!res.ok) throw Object.assign(new Error(`${method} ${p} → ${res.status}: ${json.error || json.message || text}`), { status: res.status, body: json });
  return json;
}
const S = (token) => ({
  get: p => call(token, 'GET', `/studio${p}`),
  post: (p, b) => call(token, 'POST', `/studio${p}`, b ?? {}),
  patch: (p, b) => call(token, 'PATCH', `/studio${p}`, b),
});

async function account(email, name) {
  try { return (await call(null, 'POST', '/auth/register', { email, password: PASSWORD, name })).token; }
  catch (e) { if (e.status !== 400) throw e; }
  return (await call(null, 'POST', '/auth/login', { email, password: PASSWORD })).token;
}

/** Follow a job's server-sent events until it's done. */
async function waitJob(token, job) {
  const res = await call(token, 'GET', `/studio/jobs/${encodeURIComponent(job)}/events`, undefined, true);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', last = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const data = buf.slice(0, i).split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n');
      buf = buf.slice(i + 2);
      if (!data) continue;
      const e = JSON.parse(data);
      if (e.type === 'error') throw new Error(`job ${job}: ${e.message}`);
      if (e.type === 'status') last = e.message;
    }
  }
  return last;
}

// ---------- a test image (PNG) carrying its on-image words for the mock audit engine ----------

function png(w, h, text) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      // A warm summer scene, roughly: sky, sun, a lawn, and a pink band where the on-image line sits.
      const sun = (x - w * 0.75) ** 2 + (y - h * 0.25) ** 2 < (w * 0.09) ** 2;
      const band = y > h * 0.1 && y < h * 0.2 && x > w * 0.08 && x < w * 0.6;
      const [r, g, b] = band ? [217, 77, 143] : sun ? [255, 214, 90] : y < h * 0.62 ? [120 + (y * 80) / h, 190, 235] : [70, 150 + (x * 40) / w, 80];
      row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  const img = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
  return Buffer.concat([img, Buffer.from(`VOICES_TEXT: ${text}`, 'utf8')]);
}

// ---------- the seed ----------

const nick = await account('nick@ralph.test', 'Nick (preview)');
const brook = await account('brook@ralph.test', 'Brook (preview)');
const vivan = await account('vivan@ralph.test', 'Vivan (preview)');
const N = S(nick), B = S(brook), V = S(vivan);
log('accounts ready: nick, brook, vivan');

// 1. Rules v2.11, uploaded and activated by Brook (admin).
const versions = await B.get('/rules');
const live = versions.find(v => v.status === 'active');
if (live?.version === 'v2.11') log('rules v2.11 already live');
else if (versions.some(v => v.version === 'v2.11')) { await B.post('/rules/v2.11/activate'); log('rules v2.11 activated'); }
else {
  if (!RULES) throw new Error('Pass --rules <path to studio-rules-v2.11.json>');
  await B.post('/rules', { version: 'v2.11', rules: JSON.parse(fs.readFileSync(RULES, 'utf8')), notes: 'Preview seed', activate: true });
  log('rules v2.11 uploaded and activated');
}
const meta = await N.get('/meta');
const counts = fields => Object.fromEntries(fields.map(f => [f, meta.fields[f]?.default_count ?? 4]));

// 2. Two runs as Nick, with his own lines first, then Studio's around them (per-field counts from the rules).
async function run(territory, fields, own) {
  const existing = (await N.get('/batches')).find(b => b.territory === territory);
  if (existing) { log(`run ${territory} already there (${existing.id})`); return N.get(`/batches/${encodeURIComponent(existing.id)}`); }
  const persona = meta.territories[territory].persona;
  const brief = { persona, territory, region: 'US', fields, field_counts: counts(fields), tone: { dry_warm: 3, playful_plain: 3, short_long: 1 }, banned_words: [], banned_ideas: [], reference_lines: [], own_lines: own, n: 20, model: 'gpt-4o' };
  const r = await N.post('/generate', { brief, confirm: true });
  await waitJob(nick, r.job);
  const b = await N.get(`/batches/${encodeURIComponent(r.batch)}`);
  log(`run ${territory}: ${b.lines.length} lines (${r.batch})`);
  return b;
}
const fam = await run('FAM_SUMMER', ['meta_primary', 'meta_headline', 'meta_on_image', 'meta_description'], [
  { text: 'Summer’s booked. One vet bill shouldn’t unbook it. Trupanion can pay your vet directly at participating hospitals.', field: 'meta_primary' },
  { text: 'Keep the summer plans', field: 'meta_headline' },
  { text: 'One bill shouldn’t break the summer', field: 'meta_on_image' },
]);
const dink = await run('DINK_IDIOT', ['tiktok_caption', 'tiktok_hook', 'meta_primary', 'meta_headline'], [
  { text: 'Two incomes, one little monster. Medical insurance for pets, from Trupanion.', field: 'tiktok_caption' },
  { text: 'He ate a sock. Again.', field: 'tiktok_hook' },
]);

// 3. Keep lines across fields (no red flags), cut a few, edit one: kept lines are what Build & sign off works from.
async function curate(b, plan, edit) {
  if (b.lines.some(l => l.decision)) { log(`run ${b.id} already curated`); return; }
  const clean = l => !l.flags.some(f => f.severity === 'compliance');
  for (const [field, keep] of Object.entries(plan)) {
    const ls = b.lines.filter(l => l.field === field);
    const ok = [...ls.filter(l => l.model === 'human'), ...ls.filter(l => l.model !== 'human')].filter(clean);
    const kept = ok.slice(0, keep);
    for (const l of kept) await N.patch(`/batches/${encodeURIComponent(b.id)}/lines/${encodeURIComponent(l.id)}`, { decision: 'keep' });
    for (const l of ls.filter(l => !kept.includes(l)).slice(0, 2)) await N.patch(`/batches/${encodeURIComponent(b.id)}/lines/${encodeURIComponent(l.id)}`, { decision: 'cut', note: 'Too close to another line' });
  }
  if (edit) {
    const l = b.lines.find(x => x.field === edit.field && x.model !== 'human' && clean(x));
    if (l) await N.patch(`/batches/${encodeURIComponent(b.id)}/lines/${encodeURIComponent(l.id)}`, { decision: 'edit', edited_text: edit.text, note: 'Plainer' });
  }
  log(`curated ${b.id}`);
}
await curate(fam, { meta_primary: 4, meta_headline: 3, meta_on_image: 2 }, { field: 'meta_primary', text: 'Summer plans stay booked. Trupanion is medical insurance for cats and dogs.' });
await curate(dink, { tiktok_caption: 3, tiktok_hook: 2, meta_primary: 2, meta_headline: 2 });

// 4. Build & sign off (Nick): Meta visual A with A1-A3 and its on-image line.
const q = '?persona=FAM&territory=FAM_SUMMER&region=US';
let view = await N.get(`/ready${q}`);
if (view.latest) log(`FAM_SUMMER already signed off (set v${view.latest.version})`);
else {
  const of = f => view.lines.filter(x => x.line.field === f && !x.red.length).map(x => x.line.id);
  const [p1, p2, p3] = of('meta_primary'), [h1, h2] = of('meta_headline'), [oi] = of('meta_on_image');
  if (!p3 || !h2 || !oi) throw new Error('Not enough clean kept lines on FAM_SUMMER to build A1-A3');
  const draft = {
    versions: [
      { visual: 'A', platform: 'META', fields: { meta_primary: p1, meta_headline: h1 } },
      { visual: 'A', platform: 'META', fields: { meta_primary: p2, meta_headline: h1 } },
      { visual: 'A', platform: 'META', fields: { meta_primary: p3, meta_headline: h2 } },
    ],
    on_image: { A: oi },
  };
  const pv = await N.post('/ready/preview', { persona: 'FAM', territory: 'FAM_SUMMER', region: 'US', ...draft });
  if (pv.plan.issues.length) throw new Error(`Versions not complete: ${pv.plan.issues.join('; ')}`);
  const codes = pv.plan.versions.map(v => v.code);
  const r = await N.post('/ready', { persona: 'FAM', territory: 'FAM_SUMMER', region: 'US', ...draft, expectation: { codes: [codes[0]], reason: 'A1 opens on the summer being booked, the tension these families feel, before the product.' }, expect_latest: null });
  log(`signed off ${codes.join(', ')} (set v${r.signoff.version})`);
  view = await N.get(`/ready${q}`);
}
const onImage = (() => { const o = view.latest.on_image?.find(x => x.visual === 'A'); return o?.text || ''; })();

// 5. Assets (Pre-flight): one static for visual A, used by A1-A3; audited; A1-A3 marked Pre-flight passed.
let stubs = (await N.get('/preflight/stubs')).filter(s => s.territory === 'FAM_SUMMER' && s.region === 'US').sort((a, b) => a.stub.localeCompare(b.stub));
const [a1, ...rest] = stubs;
if (!a1.upload) {
  const form = new FormData();
  form.append('files', new Blob([png(540, 540, onImage)], { type: 'image/png' }), 'fam-summer-A.png');
  form.append('also', rest.map(s => s.stub).join(','));
  const up = await call(nick, 'POST', `/studio/preflight/stubs/${encodeURIComponent(a1.stub)}/uploads`, form);
  log(`uploaded fam-summer-A.png for ${up.stubs.join(', ')}`);
  const au = await N.post(`/preflight/uploads/${encodeURIComponent(up.upload_id)}/audit`, { confirm: true });
  await waitJob(nick, au.job);
  log('audited (mock engine)');
  stubs = (await N.get('/preflight/stubs')).filter(s => s.territory === 'FAM_SUMMER' && s.region === 'US').sort((a, b) => a.stub.localeCompare(b.stub));
} else log('asset already uploaded');
for (const s of stubs) {
  const rep = await N.get(`/preflight/stubs/${encodeURIComponent(s.stub)}/report`);
  for (const f of rep.flags.filter(f => f.mine === null).slice(0, 2)) await N.post(`/preflight/flags/${f.id}/agree`, { agree: f.severity !== 'grey' || f.cross_persona });
  for (const f of rep.flags.filter(f => f.severity === 'red' && !f.override)) await N.post(`/preflight/flags/${f.id}/override`, { reason: 'Preview seed: accepted for the walkthrough' });
  if (rep.status.status !== 'ready') { await N.post(`/preflight/stubs/${encodeURIComponent(s.stub)}/ready`, { ready: true }); log(`${s.stub}: Pre-flight passed`); }
}

// 6. Vivan records Trupanion's decision: A1 and A2 cleared, A3 changes requested (the copy goes back).
const comp = await V.get('/compliance');
const asset = comp.assets.find(a => a.codes.some(c => c.stub === stubs[0].stub));
const pending = c => asset.codes.find(x => x.stub === c)?.compliance.status === 'pending';
const [A1, A2, A3] = stubs.map(s => s.stub);
if (pending(A1) || pending(A2)) {
  await V.post(`/compliance/assets/${asset.upload_id}`, { status: 'cleared', codes: [A1, A2].filter(pending), client_by: 'Dana Ruiz, Trupanion legal' });
  log(`${A1}, ${A2}: cleared by Trupanion`);
}
if (pending(A3)) {
  await V.post(`/compliance/assets/${asset.upload_id}`, { status: 'changes_requested', codes: [A3], note: 'Headline reads as a promise about summer costs; soften it.', send_back: 'copy', client_by: 'Dana Ruiz, Trupanion legal' });
  log(`${A3}: changes requested (copy)`);
}
log('done. Open http://localhost:5183/studio and sign in as nick@ / brook@ / vivan@ralph.test with password preview-pass');
