// B2 as a library (the engine behind Studio's Pre-flight step): runAudit with a
// fake OpenAI client through the real API layer, estimateAudit, featuresRow,
// copy match, temp-file cleanup and a missing ffmpeg. Made-up rules; no client
// material, key or network. Needs ffmpeg for the image/video fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runAudit, estimateAudit, featuresRow, REPORT_VERSION, type AuditInput } from '../src/services/audit/index.js';
import { copyMatch, normalise, bestMatch } from '../src/services/audit/copyMatch.js';
import { loadRules, loadRubric } from '../src/services/audit/rules.js';

const FX = path.join(__dirname, 'fixtures/audit');
const rules = loadRules(path.join(FX, 'rules.example.json'));
const rubric = loadRubric(path.join(FX, 'rubric.example.json'));
const hasFfmpeg = (() => { try { execFileSync('which', ['ffmpeg'], { stdio: 'ignore' }); return true; } catch { return false; } })();

/** A stand-in for the OpenAI SDK client: vision reads return `reads` in call order; yes/no reads say No unless told. */
function fakeOpenAI(o: { reads?: string[]; yes?: RegExp; transcript?: string } = {}) {
  const reads = [...(o.reads || [])];
  const calls: any[] = [];
  const usage = { prompt_tokens: 100, completion_tokens: 5 };
  return {
    calls,
    chat: { completions: { create: async (body: any) => {
      calls.push(body);
      const sys = String(body.messages[0].content);
      const user = body.messages[1].content;
      const text = typeof user === 'string' ? user : user.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      if (body.logprobs) {
        const p = o.yes && o.yes.test(text.split('\n').pop() || '') ? 0.95 : 0.03;
        return { choices: [{ message: { content: p > 0.5 ? 'Yes' : 'No' }, logprobs: { content: [{ top_logprobs: [{ token: 'Yes', logprob: Math.log(p) }, { token: 'No', logprob: Math.log(1 - p) }] }] } }], usage };
      }
      if (sys.startsWith('You transcribe')) return { choices: [{ message: { content: JSON.stringify({ text: reads.shift() ?? '', description: 'A dog on a sofa.' }) } }], usage };
      if (sys.includes('fixed rules')) return { choices: [{ message: { content: '{"hits":[]}' } }], usage };
      return { choices: [{ message: { content: 'Sounds nice, but what does it cost?' } }], usage };
    } } },
    audio: { transcriptions: { create: async () => ({ text: o.transcript ?? '' }) } },
  };
}

function png(dir: string, name: string, color = 'blue'): Buffer {
  const p = path.join(dir, name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=320x320`, '-frames:v', '1', p]);
  return fs.readFileSync(p);
}

test('copy match: normalised match, rewording (amber, both quoted), missing hook (red), headline is post copy (Brook, 30 Sep), missing caveat (red)', () => {
  assert.equal(normalise('Your vet, paid\nat CHECKOUT!'), 'your vet paid at checkout');
  const onAsset = [{ where: 'card 1', text: 'YOUR VET CAN BE PAID\ndirectly at checkout.' }, { where: 'card 2', text: 'Trupanion' }];
  const same = copyMatch({ on_image: 'Your vet can be paid directly at checkout' }, onAsset, rules);
  assert.equal(same.rows[0].status, 'match');
  assert.equal(same.flags.length, 0);

  const reworded = copyMatch({ on_image: 'Your vet can be paid directly at the counter' }, onAsset, rules);
  assert.equal(reworded.rows[0].status, 'reworded');
  assert.equal(reworded.flags[0].severity, 'amber');
  assert.match(reworded.flags[0].quote!, /signed off: "Your vet can be paid directly at the counter" · on the asset: "your vet can be paid directly at checkout/);
  assert.equal(reworded.flags[0].where, 'card 1');

  const missing = copyMatch({ hook: 'Summer, sorted', headline: 'Do the maths' }, onAsset, rules);
  assert.deepEqual(missing.flags.map(f => [f.rule, f.severity]), [['COPY_MATCH', 'red']], 'a must-be-on-the-asset field not found is red (1 Oct)');
  assert.equal(missing.rows.find(x => x.field === 'headline')!.status, 'not expected on asset', 'the headline runs below the image');
  // A caveat-carrying headline isn't looked for on the image either (the caveat is checked inside the ad at Ready).
  assert.deepEqual(copyMatch({ headline: 'Paid at checkout, at participating hospitals.' }, [{ where: 'card 1', text: 'Summer, sorted' }], rules).flags, []);

  const caveat = copyMatch({ on_image: 'Your vet can be paid directly at checkout at participating hospitals.' }, onAsset, rules);
  const red = caveat.flags.find(f => f.rule === 'COPY_CAVEAT');
  assert.equal(red?.severity, 'red');
  assert.match(red!.quote!, /participating hospital/);
  assert.equal(copyMatch({ primary_text: 'Paid directly at participating hospitals.' }, onAsset, rules).flags.length, 0, 'post text is not expected on the asset');
  assert.equal(bestMatch('a b c', '').similarity, 0);
});

test('runAudit: a carousel from buffers → versioned report, copy match, features row, progress, temp files removed', { skip: !hasFfmpeg && 'needs ffmpeg' }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-lib-'));
  const tmpDir = path.join(work, 'tmp');
  fs.mkdirSync(tmpDir);
  const input: AuditInput = {
    stub: 'DINK_JOKE_CAROUSEL_v2_META',
    files: [{ name: '2.png', mime: 'image/png', data: png(work, 'b.png', 'red') }, { name: '1.png', mime: 'image/png', data: png(work, 'a.png') }],
    copy: { on_image: 'Your vet can be paid directly at checkout at participating hospitals.', headline: 'Surgery can run $6,000', primary_text: 'It pays for itself.' },
  };
  const openai = fakeOpenAI({ reads: ['We pay your vet directly at checkout.', 'Trupanion'], yes: /dollar amount|cost figure/ });
  const events: string[] = [];
  const r = await runAudit(input, { rules, rubric, openai, tmpDir, onProgress: e => events.push(e.stage) });

  assert.equal(r.report_version, REPORT_VERSION);
  assert.equal(r.stub, 'DINK_JOKE_CAR_v2_META');
  assert.equal(r.kind, 'carousel');
  assert.equal(r.angle, 'DINK_A5');
  assert.deepEqual(r.frames.map(f => f.label), ['card 1', 'card 2']);
  assert.equal(r.frames[0].text, 'We pay your vet directly at checkout.', 'cards in name order');
  // Rule checks on the signed-off post text; copy match on the image.
  assert.ok(r.flags.find(f => f.rule === 'COMP_PAYS_FOR_ITSELF' && f.severity === 'red' && f.where === 'Meta primary text'));
  assert.ok(r.flags.find(f => f.rule === 'COPY_CAVEAT' && f.severity === 'red'));
  assert.ok(!r.flags.find(f => f.rule === 'COPY_MATCH' && /headline/i.test(f.label)), 'the headline is post copy: not looked for on the image');
  assert.equal(r.flags.find(f => f.rule === 'COMP_DIRECT_PAY')?.frame_index, 0);
  assert.equal(r.counts.red, r.flags.filter(f => f.severity === 'red').length);
  assert.ok(r.flags.every(f => f.source && f.rule_text));
  assert.equal(r.objection, 'Sounds nice, but what does it cost?');
  assert.deepEqual(r.tagged_features, ['dollar_figure']);
  assert.ok(r.cost.calls > 20 && r.cost.usd > 0);
  assert.ok(r.timings.total_s >= 0 && 'checks' in r.timings.stages);
  assert.equal(events.at(-1), 'done');
  assert.ok(events.includes('read') && events.includes('checks'));
  // Every OpenAI call went through with SDK retries off (withRetry is the only layer).
  assert.ok(openai.calls.every(c => c.model));

  const row = featuresRow(r, Object.keys(rules.features.items));
  assert.equal(row.stub, 'DINK_JOKE_CAR_v2_META');
  assert.equal(row.features, 'dollar_figure');
  assert.equal(row.angle, 'DINK_A5');
  assert.equal(row.p_dollar_figure, '0.950');

  assert.deepEqual(fs.readdirSync(tmpDir), [], 'temporary files are removed');
});

test('runAudit: video without ffmpeg returns a clear note, not a crash; transcript input is used', { skip: !hasFfmpeg && 'needs ffmpeg for the fixture' }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-lib-vid-'));
  const mp4 = path.join(work, 'v.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x320:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);
  const input: AuditInput = { stub: 'FAM_TALK_VID_v1_TT', files: [{ name: 'v.mp4', mime: 'video/mp4', data: fs.readFileSync(mp4) }], transcript: 'Honestly, they pay the whole vet bill.' };
  const r = await runAudit(input, { rules, rubric, openai: fakeOpenAI(), ffmpegPath: '/nonexistent/ffmpeg', tmpDir: work });
  assert.equal(r.frames.length, 0);
  assert.ok(r.notes.some(n => /video frames unavailable \(ffmpeg not installed\)/i.test(n)));
  assert.equal(r.transcript?.source, 'sidecar');
  assert.ok(r.flags.find(f => f.rule === 'COMP_PAID_SHARE' && f.severity === 'red' && f.where === 'voice-over'));
  assert.equal(r.clarity.brand_by_hook?.p ?? null, null);
});

test('estimateAudit: calls, cost and time before any call; video counts keyframes and audio minutes', { skip: !hasFfmpeg && 'needs ffmpeg' }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-lib-est-'));
  const still = await estimateAudit({ stub: 'CUR_X_ST_v1_META', files: [{ name: 'a.png', mime: 'image/png', data: png(work, 'a.png') }] }, { rules, rubric, tmpDir: work });
  assert.ok(still.calls > 10 && still.usd > 0 && still.seconds > 0);
  const mp4 = path.join(work, 'v.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x320:d=12', '-f', 'lavfi', '-i', 'sine=duration=12', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4]);
  const vid = await estimateAudit({ stub: 'CUR_X_VID_v1_META', files: [{ name: 'v.mp4', mime: 'video/mp4', data: fs.readFileSync(mp4) }] }, { rules, rubric, tmpDir: work });
  assert.ok(vid.calls > still.calls, 'keyframe reads and video items');
  assert.ok(vid.usd > still.usd);
  assert.equal(fs.readdirSync(work).filter(n => n.startsWith('voices-audit-est-')).length, 0);
});

test('an outage stops the audit after a few failed calls instead of backing off on every call', { skip: !hasFfmpeg && 'needs ffmpeg' }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-lib-down-'));
  let n = 0;
  const down = {
    chat: { completions: { create: async () => { n++; throw Object.assign(new Error('Bad gateway config'), { status: 400 }); } } },
    audio: { transcriptions: { create: async () => ({ text: '' }) } },
  };
  await assert.rejects(
    runAudit({ stub: 'CUR_X_ST_v1_META', files: [{ name: 'a.png', mime: 'image/png', data: png(work, 'a.png') }] }, { rules, rubric, openai: down, tmpDir: work }),
    /OpenAI unreachable: \d+ calls in a row failed/,
  );
  assert.ok(n <= 6, `stopped after ${n} calls`);
  assert.equal(fs.readdirSync(work).filter(x => x.startsWith('voices-audit-')).length, 0, 'temp files removed on failure too');
});

test('ffmpeg and ffprobe run without blocking the server: timers keep firing while a video is split into frames', { skip: !hasFfmpeg && 'needs ffmpeg' }, async () => {
  const { extractKeyframes } = await import('../src/services/audit/assets.js');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-async-'));
  const mp4 = path.join(work, 'v.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1080x1920:rate=25', '-t', '9', '-pix_fmt', 'yuv420p', mp4]);
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 5);
  const t0 = Date.now();
  const { frames } = await extractKeyframes(mp4, path.join(work, 'frames'));
  const ms = Date.now() - t0;
  clearInterval(timer);
  assert.ok(frames.length >= 4, `frames: ${frames.length}`);
  // A blocking call would starve the timer; with async calls it fires most of its slots.
  assert.ok(ticks >= Math.floor(ms / 5) * 0.5, `timer fired ${ticks} times in ${ms} ms`);
  fs.rmSync(work, { recursive: true, force: true });
});

test('a tool that hangs is killed at its time limit', async () => {
  const { runTool } = await import('../src/services/audit/assets.js');
  const t0 = Date.now();
  await assert.rejects(() => runTool('sleep', ['5'], 200));
  assert.ok(Date.now() - t0 < 2000);
});

test('temp files are removed when a video can’t be read', { skip: !hasFfmpeg && 'needs ffmpeg' }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-clean-'));
  const input: AuditInput = { stub: 'CUR_X_VID_v1_META', files: [{ name: 'bad.mp4', mime: 'video/mp4', data: Buffer.from('not a video at all') }] };
  await runAudit(input, { rules, rubric, openai: fakeOpenAI(), tmpDir: tmp, tesseractPath: false }).catch(() => null);
  await estimateAudit(input, { rules, rubric, tmpDir: tmp }).catch(() => null);
  assert.deepEqual(fs.readdirSync(tmp), [], 'nothing left behind, whether the audit finished or failed');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('files by path: nothing copied into memory, extensionless names work, cards stay in order, caller files untouched', { skip: !hasFfmpeg && 'needs ffmpeg' }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-lib-path-'));
  // Like multer's disk storage: random names with no extension, here also the same basename in two folders.
  fs.mkdirSync(path.join(work, 'a')); fs.mkdirSync(path.join(work, 'b'));
  const p1 = path.join(work, 'a', 'upload'), p2 = path.join(work, 'b', 'upload');
  fs.writeFileSync(p1, png(work, 'one.png', 'blue'));
  fs.writeFileSync(p2, png(work, 'two.png', 'red'));
  const tmpDir = path.join(work, 'tmp');
  fs.mkdirSync(tmpDir);
  const input: AuditInput = { stub: 'DINK_JOKE_CAR_v1_META', files: [{ name: '2', mime: 'image/png', path: p2 }, { name: '1', mime: 'image/png', path: p1 }] };
  const openai = fakeOpenAI({ reads: ['first card', 'second card'] });
  const r = await runAudit(input, { rules, rubric, openai, tmpDir });
  assert.deepEqual(r.frames.map(f => [f.label, f.text]), [['card 1', 'first card'], ['card 2', 'second card']]);
  // Both cards reached vision as PNGs (the MIME type came from `mime`, not a missing extension).
  const imgs = openai.calls.filter(c => String(c.messages[0].content).startsWith('You transcribe')).map(c => c.messages[1].content.find((x: any) => x.type === 'image_url').image_url.url.slice(0, 22));
  assert.deepEqual(imgs, ['data:image/png;base64,', 'data:image/png;base64,']);
  assert.ok(fs.existsSync(p1) && fs.existsSync(p2), "the caller's files are never deleted");
  assert.deepEqual(fs.readdirSync(tmpDir), []);

  const est = await estimateAudit(input, { rules, rubric, tmpDir });
  assert.ok(est.calls > 10 && est.usd > 0);
  assert.ok(fs.existsSync(p1));
  await assert.rejects(runAudit({ stub: 'DINK_JOKE_ST_v1_META', files: [{ name: 'x.png', mime: 'image/png' }] }, { rules, rubric, openai, tmpDir }), /give either data or path/);
  await assert.rejects(runAudit({ stub: 'DINK_JOKE_ST_v1_META', files: [{ name: 'x.png', mime: 'image/png', path: path.join(work, 'nope') }] }, { rules, rubric, openai, tmpDir }), /File not found/);
});
