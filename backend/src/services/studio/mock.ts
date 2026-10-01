// In-process stand-in for the OpenAI client, for `--mock` runs: no network,
// no key, no cost. Answers are shaped like the real ones (writer JSON, checker
// JSON, Yes/No logprobs, embeddings) so the whole pipeline can be exercised.

const OPENERS = ['Honestly,', 'Real talk:', 'So', 'Picture this:', 'Here is the thing:', 'Quick one:', 'Truth is,', 'Okay,'];
const MIDDLES = [
  'the vet bill should never be the thing that decides',
  'you budgeted for the fancy bed and the birthday photos',
  'this time you are starting from day one',
  'one less job on a Tuesday morning',
  'your vet can be paid at checkout at participating hospitals',
  'the maths is on the table, not in the fine print',
  'he gets you out walking every day',
  'the summer trip stays booked',
];
const ENDINGS = ['Get a quote.', 'Medical insurance for pets.', 'That is what Trupanion is for.', 'See how it works.', ''];

function h(s: string): number {
  let x = 2166136261;
  for (const c of s) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); }
  return x >>> 0;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const usage = (inTok: number, outTok: number) => ({ prompt_tokens: inTok, completion_tokens: outTok, total_tokens: inTok + outTok });

function writer(sys: string, user: string) {
  // Headlines and hooks keep to the visible length the prompt gives (longer ones are dropped before anyone sees them).
  const visible = Object.fromEntries([...sys.matchAll(/^- (\w+): .*?\((\d+) visible\)/gm)].map(m => [m[1], Number(m[2])]));
  const fit = (t: string, n = 38) => (t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, ''));
  const cells = [...user.matchAll(/^- (\w+): .*?structure (\w+).*?field (\w+)/gm)];
  const lines = cells.map(([, cell, structure, field], i) => {
    const k = h(cell + structure + user.length);
    // Every seventh cell repeats an earlier line almost word for word, to exercise dedupe.
    const base = `${OPENERS[k % OPENERS.length]} ${MIDDLES[(k >>> 3) % MIDDLES.length]}. ${ENDINGS[(k >>> 7) % ENDINGS.length]}`.trim();
    const text = i > 0 && i % 7 === 0 ? `${OPENERS[0]} ${MIDDLES[0]}.` : structure === 'question' ? `${MIDDLES[k % MIDDLES.length].replace(/^./, c => c.toUpperCase())}?` : base;
    return { cell, text: field.includes('headline') || field.includes('hook') ? fit(text.split(/[.?]/)[0], visible[field]) : text };
  });
  return JSON.stringify({ lines });
}

// Carousel card sequences (item E): hook → build → payoff, distinct words on each card.
const CARDS = [['Vet bill at 2am?', 'You pay the vet as normal', 'We sort the rest', 'Calm, covered.'], ['Summer trip booked', 'Then the limp', 'The vet sees him same day', 'The trip stays booked.'], ['First week home', 'First vet visit', 'Covered from day one', 'Start early.']];
function sequences(user: string) {
  const s = Number(/write (\d+) carousel card sequence/.exec(user)?.[1] || 1), k = Number(/of (\d+) cards each/.exec(user)?.[1] || 4);
  const angles = [...user.matchAll(/([A-Z]+_A\d+) "/g)].map(m => m[1]);
  return JSON.stringify({ sequences: Array.from({ length: s }, (_, i) => ({ angle: angles[i % Math.max(1, angles.length)], cards: Array.from({ length: k }, (_, j) => CARDS[i % CARDS.length][j] ?? `Card ${j + 1} of sequence ${i + 1}`) })) });
}

function tagger(sys: string, user: string) {
  const angles = [...sys.matchAll(/^([A-Z]+_A\d+):/gm)].map(m => m[1]);
  const structures = ['question', 'stat', 'testimony', 'scenario', 'joke', 'plain_promise'];
  const n = user.split('\n').filter(Boolean).length;
  return JSON.stringify({ tags: Array.from({ length: n }, (_, i) => ({ i: i + 1, angle: angles[i % Math.max(1, angles.length)], structure: structures[i % 6] })) });
}

// The live false positive (production test, 1 Oct): a line about what surgery costs read as "pays for itself".
// The mock makes it too, unless the rule lists the line as one that isn't a breach (not_examples).
const costLine = (line: string) => /\$[\d,.]+k?\b[^.!?]*\b(surgery|bill)/i.test(line);
const listedAsNo = (text: string, line: string) => text.includes(`"${line}"`);

function checker(sys: string, user: string) {
  const line = /LINE: (.*)$/m.exec(user)?.[1] || '';
  const hits: any[] = [];
  if (/pays? for itself/i.test(line)) hits.push({ rule: 'COMP_PAYS_FOR_ITSELF', quote: /pays? for itself/i.exec(line)![0], why: 'Claims the policy pays for itself' });
  else if (costLine(line) && !listedAsNo(sys, line)) hits.push({ rule: 'COMP_PAYS_FOR_ITSELF', quote: /\$[\d,.]+k?/.exec(line)![0], why: 'Implies it saves more than it costs' });
  // The other live false positive: a speed that isn't about claims ("Build your plan in 60 seconds!") read as claim speed.
  if (/\d+ seconds/i.test(line) && !/claim/i.test(line) && !listedAsNo(sys, line)) hits.push({ rule: 'COMP_CLAIM_SPEED', quote: /\d+ seconds/i.exec(line)![0], why: 'Overclaims speed' });
  if (/whole bill/i.test(line)) hits.push({ rule: 'COMP_PAID_SHARE', quote: 'whole bill', why: 'Implies the whole bill is paid' });
  if (/fancy bed/i.test(line)) hits.push({ rule: 'DINK_T_INDULGE', quote: 'fancy bed', why: 'Frames spend as indulgence' });
  const k = h(line);
  return JSON.stringify({
    hits,
    glance: { ok: k % 4 !== 0, why: 'Takes two reads to land' },
    product_clear: { ok: /trupanion|insurance|vet/i.test(line), why: 'No product in the line' },
    features: ['money_never_decides', 'direct_vet_pay', 'less_hassle', 'start_early', 'humour'].filter((_, i) => (k >>> i) % 3 === 0),
  });
}

// The version check (versionChecks.ts): a contradiction when one field says the vet is paid directly and another says
// you're reimbursed, so the flow can be tested.
function versionConflicts(user: string) {
  const f = user.split('\n').map(l => /^([\w#]+) \(.*?\): (.*)$/.exec(l)).filter(Boolean) as RegExpExecArray[];
  const direct = f.find(m => /directly|at checkout/i.test(m[2])), back = f.find(m => /reimburse|pay you back/i.test(m[2]));
  const hits = direct && back && direct !== back ? [{ kind: 'contradiction', fields: [direct[1], back[1]], quote: /reimburse\w*|pay you back/i.exec(back[2])![0], why: 'Direct pay in one field, reimbursement in the other' }] : [];
  return JSON.stringify({ hits });
}

function probe(user: string) {
  const line = /LINE \(.*?\): "(.*)"/.exec(user)?.[1] || '';
  const q = user.split('\n').pop() || '';
  let p = 0.05 + (h(user) % 10) / 100;
  if (/pays for itself/i.test(q) && /pays? for itself/i.test(line)) p = 0.97;
  if (/within seconds/i.test(q) && /\d+ seconds/i.test(line) && !listedAsNo(user.split('\n').find(l => l.startsWith('Lines like these are a No')) || '', line)) p = 0.85;
  if (/more (money )?than it costs/i.test(q) && costLine(line) && !listedAsNo(user.split('\n').find(l => l.startsWith('Lines like these are a No')) || '', line)) p = 0.8;
  if (/participating hospitals/i.test(q) && /directly|checkout/i.test(line) && !/participating/i.test(line)) p = 0.9;
  if (/whole vet bill|pay nothing/i.test(q) && /whole bill/i.test(line)) p = 0.93;
  if (/pre-existing|already has/i.test(q) && /pre-?existing/i.test(line)) p = 0.9;
  if (/checkups/i.test(q) && /check-?ups?/i.test(line)) p = 0.88;
  if (/seconds/i.test(q) && /every claim/i.test(line)) p = 0.9;
  const yes = Math.log(p), no = Math.log(1 - p);
  return { top: [{ token: p > 0.5 ? 'Yes' : 'No', logprob: p > 0.5 ? yes : no }, { token: p > 0.5 ? 'No' : 'Yes', logprob: p > 0.5 ? no : yes }] };
}

function embed(text: string): number[] {
  const v = new Array(256).fill(0);
  const w = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i < w.length; i++) {
    v[h(w[i]) % 256] += 1;
    if (i + 1 < w.length) v[h(w[i] + ' ' + w[i + 1]) % 256] += 0.5;
  }
  return v;
}

export function mockClient() {
  const create = (params: any) => {
    const run = async () => {
      await sleep(40 + (h(JSON.stringify(params.messages).slice(-200)) % 120));
      const sys: string = params.messages[0].content;
      const user: string = params.messages[1].content;
      let content = '', logprobs: any = null;
      if (params.logprobs) { const p = probe(user); content = p.top[0].token; logprobs = { content: [{ token: content, logprob: p.top[0].logprob, top_logprobs: p.top }] }; }
      else if (params.response_format && /You classify lines of ad copy/.test(sys)) content = tagger(sys, user);
      else if (params.response_format && /^CAROUSEL SEQUENCES/.test(user)) content = sequences(user);
      else if (params.response_format && /Write exactly one line per cell/.test(sys)) content = writer(sys, user);
      else if (params.response_format && /You check one ad made of several copy fields/.test(sys)) content = versionConflicts(user);
      else if (params.response_format) content = checker(sys, user);
      else content = 'Sounds nice, but what does it actually cost me when the premium goes up next year?';
      const inTok = Math.ceil((sys.length + user.length) / 4);
      return { model: params.model, choices: [{ message: { content }, logprobs }], usage: usage(inTok, Math.ceil(content.length / 4)) };
    };
    // The engine always calls .withResponse(), so only that is provided.
    return { withResponse: async () => ({ data: await run(), response: { headers: new Map() } }) };
  };
  return {
    chat: { completions: { create } },
    embeddings: {
      create: async (params: any) => {
        await sleep(30);
        const input: string[] = Array.isArray(params.input) ? params.input : [params.input];
        return { data: input.map(t => ({ embedding: embed(t) })), usage: { prompt_tokens: input.join(' ').length / 4 } };
      },
    },
  };
}
