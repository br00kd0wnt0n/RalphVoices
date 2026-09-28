// Claude as a Copy Studio writer (blind compare, or the brief's writing model).
// Writing only: the checks stay on OpenAI because the yes/no layer needs
// token logprobs. Key: ANTHROPIC_API_KEY, else ~/.config/voices/anthropic.key
// (or STUDIO_ANTHROPIC_KEY_FILE), written from the clipboard, never in chat.

import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

// The writer's reply shape: one line per grid cell.
const LINES_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { cell: { type: 'string' }, text: { type: 'string' } },
        required: ['cell', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
};

export const isClaude = (model: string) => model.startsWith('claude-');

let client: Anthropic | null = null;
export function claudeClient(): Anthropic {
  if (client) return client;
  let apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const keyFile = process.env.STUDIO_ANTHROPIC_KEY_FILE || path.join(process.env.HOME || '', '.config/voices/anthropic.key');
    if (fs.existsSync(keyFile)) apiKey = fs.readFileSync(keyFile, 'utf8').trim();
  }
  if (!apiKey) throw Object.assign(new Error('No Anthropic key: set ANTHROPIC_API_KEY or put the key in ~/.config/voices/anthropic.key'), { status: 401 });
  // withRetry in the engine is the only retry layer, as for the OpenAI calls.
  client = new Anthropic({ apiKey, maxRetries: 0 });
  return client;
}

/**
 * One writer call. Returns the JSON text ({"lines":[...]}) and usage in the
 * OpenAI field names the engine's cost accounting reads. A refusal that the
 * server-side fallback couldn't rescue comes back as an error.
 */
export async function claudeWrite(o: { model: string; system: string; user: string }): Promise<{ text: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; model: string }> {
  const response = await claudeClient().beta.messages.create({
    model: o.model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: o.system,
    messages: [{ role: 'user', content: o.user }],
    output_config: { format: { type: 'json_schema', schema: LINES_SCHEMA } },
  } as any);
  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error(`Claude declined the request (${(response as any).stop_details?.category ?? 'no category'})`), { status: 400 });
  }
  const text = response.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  const u = response.usage;
  const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  return { text, usage: { prompt_tokens: input, completion_tokens: u.output_tokens || 0, total_tokens: input + (u.output_tokens || 0) }, model: response.model };
}
