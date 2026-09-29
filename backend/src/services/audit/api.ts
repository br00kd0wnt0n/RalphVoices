// B2: the OpenAI plumbing, after the spike's M3 runner: temperature-0 yes/no
// reads with P(Yes) from the first token's logprobs, a sliding-window
// tokens-per-minute pace per model (the account's TPM is shared with Studio),
// a cumulative spend log with a hard cap, and a stop when credits run out.
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { withRetry } from '../../utils/retry.js';

export interface TopLogprob { token: string; logprob: number }

/** P(Yes) normalised over the Yes/No mass in the first token's top logprobs. */
export function probabilityYes(top: TopLogprob[] | null | undefined): number | null {
  if (!Array.isArray(top) || !top.length) return null;
  let yes = 0, no = 0;
  for (const t of top) {
    const tok = String(t?.token ?? '').trim().replace(/[^a-z]/gi, '').toLowerCase();
    const p = Math.exp(Number(t?.logprob));
    if (!Number.isFinite(p)) continue;
    if (tok === 'yes') yes += p; else if (tok === 'no') no += p;
  }
  return yes + no === 0 ? null : yes / (yes + no);
}

// USD per 1M tokens, list prices Sep 2026. Unknown models are priced high on purpose.
const PRICES: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  '*': { input: 5, output: 15 },
};
export function priceOf(model: string) { return PRICES[model] || PRICES['*']; }
export function costOf(model: string, u: any): number {
  const pr = priceOf(model);
  const cached = u?.prompt_tokens_details?.cached_tokens || 0;
  return ((u?.prompt_tokens || 0) - cached) * pr.input / 1e6 + cached * pr.input / 2 / 1e6 + (u?.completion_tokens || 0) * pr.output / 1e6;
}

const FATAL_CODES = new Set(['credit_balance_exhausted', 'insufficient_quota', 'billing_hard_limit_reached', 'invalid_api_key']);

export class FatalError extends Error {}

/** Consecutive calls failing after their retries before the audit stops. */
export const MAX_FAIL_STREAK = 3;

/** Image tokens as OpenAI counts them: 85 at detail low; tiles of 512 at high. */
export function imageTokens(w: number, h: number, detail: 'low' | 'high'): number {
  if (detail === 'low') return 85;
  let s = Math.min(1, 2048 / Math.max(w, h));
  w *= s; h *= s;
  s = Math.min(1, 768 / Math.min(w, h));
  w *= s; h *= s;
  return 85 + 170 * Math.ceil(w / 512) * Math.ceil(h / 512);
}

/**
 * Width and height from the file's header (PNG, JPEG, WebP, GIF): no process,
 * so token counting never blocks the server. `_ffprobe` is kept for callers.
 */
export function imageSize(file: string, _ffprobe?: string | null): { w: number; h: number } {
  try {
    const b = fs.readFileSync(file);
    if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b.length > 10 && b.toString('ascii', 0, 3) === 'GIF') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
    if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = b.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) }; }
    }
    for (let i = 2; b[0] === 0xff && b[1] === 0xd8 && i < b.length - 9;) {
      if (b[i] !== 0xff) break;
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  } catch { /* default */ }
  return { w: 1080, h: 1080 };
}

export interface ImagePart { path: string; detail: 'low' | 'high' }
export type Content = Array<{ type: 'text'; text: string } | { type: 'image'; image: ImagePart }>;

export interface ChatReq {
  stage: string;
  model: string;
  system: string;
  content: Content;
  max_tokens: number;
  temperature?: number;
  json?: boolean;
  logprobs?: boolean;
}
export interface ChatRes { text: string; top: TopLogprob[]; usd: number; usage: any }

export type Responder = (req: ChatReq) => ChatRes | Promise<ChatRes>;

/** The parts of the OpenAI SDK client the audit calls (so the Studio can pass its own, and tests a fake). */
export interface OpenAILike {
  chat: { completions: { create: (body: any, opts?: any) => Promise<any> } };
  audio: { transcriptions: { create: (body: any, opts?: any) => Promise<any> } };
}

export interface ApiOptions {
  client?: OpenAILike;            // an OpenAI client (the CLI makes one from its key file)
  apiKey?: string;                // or a key; otherwise OPENAI_API_KEY from the environment
  mock?: Responder;
  mockTranscribe?: (file: string) => string;
  transcribeUsdPerMinute?: number;
  tpm?: Record<string, number>;   // per-model token pace; 0 = off
  capUsd?: number;                // hard cap for this API's own spend plus spendPath's total; default none
  spendPath?: string;             // cumulative ledger (CLI only); the library writes none
  ffprobe?: string | null;
  logPath?: string;              // calls.jsonl for this run
  concurrency?: number;
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

export class AuditApi {
  private client: OpenAILike | null = null;
  private windows = new Map<string, Array<{ t: number; tokens: number }>>();
  private dataUrls = new Map<string, string>();
  private sizes = new Map<string, { w: number; h: number }>();
  usd = 0;
  calls = 0;
  stopped: string | null = null;
  private failStreak = 0;

  /**
   * After retries: out of credits stops the audit at once, and so do
   * MAX_FAIL_STREAK calls in a row failing (a network or OpenAI outage), rather
   * than every remaining call backing off for minutes each.
   */
  private failed(err: any): never {
    if (err?.fatal) { this.stopped = `${err.code}: ${String(err.message).slice(0, 120)}`; throw new FatalError(this.stopped); }
    if (++this.failStreak >= MAX_FAIL_STREAK) {
      this.stopped = `OpenAI unreachable: ${this.failStreak} calls in a row failed after retries (last: ${err?.status ?? ''} ${String(err?.message || err).slice(0, 80)})`;
      throw new FatalError(this.stopped);
    }
    throw err;
  }

  constructor(private o: ApiOptions) {
    if (o.client) this.client = o.client;
    else if (!o.mock) {
      // The library never reads key files: its caller passes a client or a key, or the environment has one.
      const apiKey = o.apiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('No OpenAI key: pass a client or apiKey, or set OPENAI_API_KEY');
      this.client = new OpenAI({ apiKey, maxRetries: 0 }) as unknown as OpenAILike;
    }
  }

  get mock(): boolean { return !!this.o.mock; }

  spent(): number { return this.o.spendPath ? readSpend(this.o.spendPath).total_usd : 0; }
  private get cap(): number { return this.o.capUsd ?? Infinity; }

  estTokens(req: Pick<ChatReq, 'system' | 'content'>): number {
    let t = Math.ceil(req.system.length / 4) + 12;
    for (const c of req.content) {
      if (c.type === 'text') t += Math.ceil(c.text.length / 4);
      else t += imageTokens(...Object.values(this.size(c.image.path)) as [number, number], c.image.detail);
    }
    return t;
  }

  private size(p: string) {
    if (!this.sizes.has(p)) this.sizes.set(p, imageSize(p, this.o.ffprobe === undefined ? 'ffprobe' : this.o.ffprobe));
    return this.sizes.get(p)!;
  }

  private dataUrl(p: string): string {
    if (!this.dataUrls.has(p)) this.dataUrls.set(p, `data:${MIME[path.extname(p).toLowerCase()] || 'image/jpeg'};base64,${fs.readFileSync(p).toString('base64')}`);
    return this.dataUrls.get(p)!;
  }

  private async pace(model: string, tokens: number) {
    const cap = this.o.tpm?.[model] ?? this.o.tpm?.['*'] ?? 0;
    if (!cap || this.mock) return;
    const w = this.windows.get(model) || [];
    this.windows.set(model, w);
    for (;;) {
      const now = Date.now();
      while (w.length && now - w[0].t > 60_000) w.shift();
      const used = w.reduce((s, x) => s + x.tokens, 0);
      if (used + tokens <= cap || !w.length) { w.push({ t: now, tokens }); return; }
      await new Promise(r => setTimeout(r, 250));
    }
  }

  async chat(req: ChatReq): Promise<ChatRes> {
    if (this.stopped) throw new FatalError(this.stopped);
    if (!this.mock && this.spent() + this.usd > this.cap - 0.02) {
      this.stopped = `spend cap of $${this.cap} reached`;
      throw new FatalError(this.stopped);
    }
    await this.pace(req.model, this.estTokens(req) + req.max_tokens);
    let res: ChatRes;
    if (this.o.mock) {
      res = await this.o.mock(req);
    } else {
      const content = req.content.map(c => c.type === 'text'
        ? { type: 'text' as const, text: c.text }
        : { type: 'image_url' as const, image_url: { url: this.dataUrl(c.image.path), detail: c.image.detail } });
      const onlyText = content.every(c => c.type === 'text');
      const r = await withRetry(() => this.client!.chat.completions.create({
        model: req.model, temperature: req.temperature ?? 0, max_tokens: req.max_tokens,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: onlyText ? content.map(c => (c as any).text).join('\n') : content },
        ],
        ...(req.logprobs ? { logprobs: true, top_logprobs: 10 } : {}),
        ...(req.json ? { response_format: { type: 'json_object' as const } } : {}),
      }, { maxRetries: 0 }).catch((err: any) => {  // withRetry is the only retry layer, whoever's client it is
        // Out of credits or quota also comes back as a 429, but waiting won't fix it.
        if (FATAL_CODES.has(err?.code)) { err.status = 402; err.fatal = true; }
        throw err;
      }), `${req.stage}`, 6).catch((err: any) => this.failed(err));
      this.failStreak = 0;
      res = {
        text: r.choices[0]?.message?.content || '',
        top: (r.choices[0]?.logprobs?.content?.[0]?.top_logprobs || []) as TopLogprob[],
        usage: r.usage, usd: costOf(req.model, r.usage),
      };
    }
    this.usd += res.usd;
    this.calls++;
    if (this.o.logPath) {
      fs.appendFileSync(this.o.logPath, JSON.stringify({
        at: new Date().toISOString(), stage: req.stage, model: req.model,
        p: req.logprobs ? probabilityYes(res.top) : undefined,
        top: req.logprobs ? res.top.slice(0, 4).map(t => [t.token, Math.round(t.logprob * 1000) / 1000]) : undefined,
        usage: res.usage, usd: Math.round(res.usd * 1e6) / 1e6,
      }) + '\n');
    }
    return res;
  }

  /** Speech to text for a video's soundtrack. Priced per minute of audio. */
  async transcribe(stage: string, model: string, file: string, seconds: number): Promise<string> {
    if (this.stopped) throw new FatalError(this.stopped);
    const usd = (seconds / 60) * (this.o.transcribeUsdPerMinute ?? 0.006);
    if (!this.mock && this.spent() + this.usd + usd > this.cap - 0.02) {
      this.stopped = `spend cap of $${this.cap} reached`;
      throw new FatalError(this.stopped);
    }
    let text = '';
    if (this.mock) text = this.o.mockTranscribe ? this.o.mockTranscribe(file) : '';
    else {
      const r: any = await withRetry(() => this.client!.audio.transcriptions.create({ file: fs.createReadStream(file), model, prompt: 'A social ad for Trupanion, medical insurance for cats and dogs.' }, { maxRetries: 0 })
        .catch((err: any) => { if (FATAL_CODES.has(err?.code)) { err.status = 402; err.fatal = true; } throw err; }), stage, 4)
        .catch((err: any) => this.failed(err));
      this.failStreak = 0;
      text = String(r?.text || '').trim();
      this.usd += usd;
    }
    this.calls++;
    if (this.o.logPath) fs.appendFileSync(this.o.logPath, JSON.stringify({ at: new Date().toISOString(), stage, model, seconds, usd: this.mock ? 0 : Math.round(usd * 1e6) / 1e6, chars: text.length }) + '\n');
    return text;
  }

  /** One wording, P(Yes) from logprobs at temperature 0. */
  async yesNo(stage: string, model: string, system: string, content: Content): Promise<number | null> {
    const r = await this.chat({ stage, model, system, content, max_tokens: 1, temperature: 0, logprobs: true });
    return probabilityYes(r.top);
  }

  record(entry: Record<string, unknown>) {
    if (this.mock || !this.o.spendPath) return;
    writeSpend(this.o.spendPath, { ...entry, usd: Math.round(this.usd * 1e4) / 1e4, calls: this.calls, at: new Date().toISOString() });
  }
}

export function readSpend(p: string): { total_usd: number; runs: any[] } {
  if (!fs.existsSync(p)) return { total_usd: 0, runs: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeSpend(p: string, entry: any) {
  const s = readSpend(p);
  s.runs.push(entry);
  s.total_usd = Math.round(s.runs.reduce((t, r) => t + (r.usd || 0), 0) * 1e4) / 1e4;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
}

