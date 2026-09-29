// B2 --mock: an in-process stand-in for OpenAI, for tests and free rehearsals.
// Vision "reads" an image with tesseract (or a supplied reader); yes/no reads
// come from a few keyword heuristics. Nothing it returns is a real judgment.
import type { ChatReq, ChatRes } from './api.js';
import { ocr } from './assets.js';

const yes = (p: number): ChatRes => ({ text: p >= 0.5 ? 'Yes' : 'No', top: [{ token: 'Yes', logprob: Math.log(Math.max(p, 1e-6)) }, { token: 'No', logprob: Math.log(Math.max(1 - p, 1e-6)) }], usd: 0, usage: {} });

const RULES: Array<[RegExp, (ad: string) => boolean]> = [
  [/pays for itself|save the owner more money/i, ad => /pays? for (it|them)sel/i.test(ad)],
  [/vet gets paid directly|paying the vet directly/i, ad => /direct/i.test(ad) && !/participating/i.test(ad)],
  [/dollar amount|cost figure/i, ad => /\$\s?\d/.test(ad)],
  [/joke|laugh/i, ad => /idiot|joke|ha(ha)+|lol/i.test(ad)],
  [/children|kids/i, ad => /\b(kids?|children|child)\b/i.test(ad)],
  [/vet can be paid directly|insurer pays the vet/i, ad => /paid directly|direct pay/i.test(ad)],
  [/know this is an ad|selling medical insurance|clear from its headline|get the main point|brand or product|Trupanion or for medical/i, ad => /insurance|trupanion/i.test(ad)],
  [/sick, scared or sad|unwell, frightened/i, ad => /sad|sick|scared/i.test(ad)],
];

export function mockResponder(read: (imagePath: string) => string | Promise<string> = ocr) {
  return async (req: ChatReq): Promise<ChatRes> => {
    const text = req.content.map(c => (c.type === 'text' ? c.text : '')).join('\n');
    if (req.stage.startsWith('read ')) {
      const im = req.content.find(c => c.type === 'image');
      const words = im && im.type === 'image' ? await read(im.image.path) : '';
      return { text: JSON.stringify({ text: words, description: 'Mock: no description.' }), top: [], usd: 0, usage: {} };
    }
    if (req.stage.startsWith('review ')) return { text: '{"hits":[]}', top: [], usd: 0, usage: {} };
    if (req.stage.startsWith('objection ')) return { text: 'Mock objection: prove it.', top: [], usd: 0, usage: {} };
    if (req.logprobs) {
      const m = /([^\n]*?) Answer with exactly one word/.exec(text);
      const q = m?.[1] || '';
      const ad = text.slice(0, m?.index ?? text.length);
      for (const [re, test] of RULES) if (re.test(q)) return yes(test(ad) ? 0.9 : 0.05);
      return yes(0.05);
    }
    return { text: '{}', top: [], usd: 0, usage: {} };
  };
}
