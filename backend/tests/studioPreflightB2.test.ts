// Pre-flight through B2's real audit engine (services/audit), with a stand-in
// for the OpenAI client (as B2's own tests do): the adapter maps B2's report to
// Pre-flight flags, with copy match first and flags pointing at the uploaded card.
// B2's made-up rules and rubric; no key or network. Needs ffmpeg for the image fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadRules, loadRubric } from '../src/services/audit/rules.js';
import { b2Engine, signedOffCopy } from '../src/services/studio/preflightB2.js';

const FX = path.join(__dirname, 'fixtures/audit');
const hasFfmpeg = (() => { try { execFileSync('which', ['ffmpeg'], { stdio: 'ignore' }); return true; } catch { return false; } })();

function fakeOpenAI(read: string) {
  const usage = { prompt_tokens: 100, completion_tokens: 5 };
  return {
    chat: { completions: { create: async (body: any) => {
      const sys = String(body.messages[0].content);
      if (body.logprobs) return { choices: [{ message: { content: 'No' }, logprobs: { content: [{ top_logprobs: [{ token: 'Yes', logprob: Math.log(0.03) }, { token: 'No', logprob: Math.log(0.97) }] }] } }], usage };
      if (sys.startsWith('You transcribe')) return { choices: [{ message: { content: JSON.stringify({ text: read, description: 'A dog on a sofa.' }) } }], usage };
      if (sys.includes('fixed rules')) return { choices: [{ message: { content: '{"hits":[]}' } }], usage };
      return { choices: [{ message: { content: 'Sounds nice, but what does it cost?' } }], usage };
    } } },
    audio: { transcriptions: { create: async () => ({ text: '' }) } },
  };
}

test('Studio fields map to B2 signed-off copy fields', () => {
  const c = signedOffCopy([
    { line_id: 'a', field: 'tiktok_hook', label: 'hook', text: 'Your vet gets paid, at participating hospitals.', version: 1 },
    { line_id: 'b', field: 'meta_primary', label: 'primary', text: 'Primary.', version: 1 },
  ]);
  assert.deepEqual(c, { hook: 'Your vet gets paid, at participating hospitals.', primary_text: 'Primary.' });
});

test('a hook with its caveat dropped from the asset: copy match is the first flag, on card 1', { skip: !hasFfmpeg && 'needs ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-b2-'));
  const img = path.join(dir, 'card.png');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x320', '-frames:v', '1', img]);
  const rules = loadRules(path.join(FX, 'rules.example.json'));
  const rubric = loadRubric(path.join(FX, 'rubric.example.json'));
  const persona = Object.keys(rules.personas)[0];
  const stub = `${persona}_TEST_STATIC_v1_META`;
  const engine = b2Engine({ openai: () => fakeOpenAI('Your vet can be paid directly.'), tesseractPath: false });
  const copy = [{ line_id: 'L1', field: 'tiktok_hook', label: 'TikTok hook', text: 'Your vet can be paid directly, at participating hospitals.', version: 1 }];
  const input = { stub, persona, territory: `${persona}_TEST`, kind: 'static' as const, files: [{ path: img, filename: 'card.png', contentType: 'image/png', data: fs.readFileSync(img) }], copy, rules, rubric };
  const est = engine.estimate(input);
  assert.ok(est.seconds > 0 && est.usd >= 0);
  const msgs: string[] = [];
  const r = await engine.run(input, m => msgs.push(m));
  assert.ok(msgs.length, 'progress reported');
  assert.equal(r.flags[0].check, 'copy_match', JSON.stringify(r.flags.map(f => f.rule)));
  assert.equal(r.flags[0].severity, 'red');
  assert.match(r.flags[0].quote || r.flags[0].why || '', /participating hospital/);
  assert.equal(r.flags[0].frame?.asset_position ?? 0, 0);
  assert.match(r.text_found, /Your vet can be paid directly/);
  assert.equal(r.objection, 'Sounds nice, but what does it cost?');
  assert.ok(r.report && r.report.report_version === 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
