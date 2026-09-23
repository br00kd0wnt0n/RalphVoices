// Local stand-in for the OpenAI API, for exercising test runs against the local
// dev database without an API key or spend. Not used in production.
//
// Handles: chat completions for voice samples, panel generation and concept
// responses (deterministic scores per panel member name), and embeddings
// (deterministic 1536-d vectors). Panel members whose name starts with "Drop"
// always get a 500, and "Garble" always gets truncated scores JSON; both
// exercise withRetry and options.dropouts.
//
// Usage:
//   MOCK_PORT=4011 MOCK_LOG=/tmp/mock.log node backend/scripts/mock-openai.mjs
//   OPENAI_API_KEY=sk-mock OPENAI_BASE_URL=http://127.0.0.1:4011/v1 \
//     DATABASE_URL=postgresql://postgres@127.0.0.1:54329/voices_dev \
//     JWT_SECRET=local-dev-secret npm run dev:backend
//
// MOCK_LOG (optional) gets one JSON line per concept-response call:
// {name, model, image_details}, so image_detail pass-through can be checked.
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.MOCK_PORT) || 4011;
const LOG = process.env.MOCK_LOG;
const NAMES = ['Ava', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kai', 'Lia', 'Max',
  'Nia', 'Oli', 'Pia', 'Quin', 'Rae', 'Sol', 'Tia', 'Uma', 'Vic', 'Wes', 'Xan', 'Yas', 'Zed'];

function hash(s) {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = body ? JSON.parse(body) : {};
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const reply = (content) => send(200, {
      id: 'mock', object: 'chat.completion', created: 0, model: j.model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    if (req.url.endsWith('/embeddings')) {
      const inputs = Array.isArray(j.input) ? j.input : [j.input];
      return send(200, {
        object: 'list', model: j.model, usage: { prompt_tokens: 1, total_tokens: 1 },
        data: inputs.map((t, i) => {
          let h = hash(String(t));
          const embedding = Array.from({ length: 1536 }, () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; return h / 2 ** 32 - 0.5; });
          return { object: 'embedding', index: i, embedding };
        }),
      });
    }

    const sys = j.messages?.[0]?.content || '';
    const user = j.messages?.[1]?.content;
    const userText = typeof user === 'string' ? user : (user || []).map((p) => p.text || '').join('\n');

    if (sys.includes('generating variant personas')) {
      const n = Number((/create (\d+) unique/.exec(sys) || [])[1]) || 5;
      const platforms = ((/Platforms to include: (.*)/.exec(userText) || [])[1] || 'TikTok').split(', ');
      const variants = Array.from({ length: n }, (_, i) => ({
        variant_name: NAMES[i % NAMES.length] + (i >= NAMES.length ? i : ''),
        age_actual: 30 + (i % 9) - 4, location_variant: 'Denver, CO', attitude_score: 1 + ((i * 3) % 10),
        primary_platform: platforms[i % platforms.length], engagement_level: 'moderate',
        distinguishing_trait: 'mock trait', voice_modifier: 'mock voice',
      }));
      return reply(JSON.stringify({ variants }));
    }

    if (sys.includes('embodying a specific persona')) {
      const name = (/Name: (.*)/.exec(userText) || [])[1] || '?';
      const imageDetails = Array.isArray(user) ? user.filter((p) => p.type === 'image_url').map((p) => p.image_url.detail) : [];
      if (LOG) fs.appendFileSync(LOG, JSON.stringify({ name, model: j.model, image_details: imageDetails }) + '\n');
      if (name.startsWith('Drop')) return send(500, { error: { message: 'mock server error', type: 'server_error' } });
      if (name.startsWith('Garble')) return reply(`As ${name}: I forgot the format.\n---SCORES---\n{"sentiment_score": 7, "engagement_like`);
      const h = hash(name + userText.slice(0, 200));
      const score = (shift) => 1 + ((h >>> shift) % 10);
      return reply(`As ${name}: a mock reaction.\n---SCORES---\n${JSON.stringify({
        sentiment_score: score(0), engagement_likelihood: score(4), share_likelihood: score(8),
        comprehension_score: score(12), reaction_tags: ['intrigued', 'fresh_take'],
      })}`);
    }

    return reply('A short mock voice sample.');
  });
}).listen(PORT, () => console.log(`mock OpenAI listening on :${PORT}`));
