// Retry for per-panel-member OpenAI calls. This is the ONLY retry layer on the
// concept-response call: generateConceptResponse passes maxRetries: 0 to the
// SDK, so a failing panel member gets 1 + retries attempts, not
// (1 + retries) × 3 as when both layers retried.
//
// Mirrors what the SDK retried on (408, 409, 429, 5xx, network errors) and
// honours Retry-After on rate limits, so disabling the SDK layer loses nothing.
// Errors without an HTTP status (network failures, ScoreParseError) are retried too.

export function isTransient(error: any): boolean {
  const status = error?.status;
  if (typeof status !== 'number') return true;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

// Exponential backoff (2s, 4s, ...), stretched to the server's Retry-After when
// it asks for longer. Ignores values over 60s, as the SDK does.
export function retryDelayMs(error: any, attempt: number): number {
  const backoff = 2000 * 2 ** attempt;
  const headers = error?.headers || {};
  let requested: number | undefined;
  const ms = parseFloat(headers['retry-after-ms']);
  if (!Number.isNaN(ms)) {
    requested = ms;
  } else if (headers['retry-after']) {
    const secs = parseFloat(headers['retry-after']);
    requested = Number.isNaN(secs) ? Date.parse(headers['retry-after']) - Date.now() : secs * 1000;
  }
  if (requested !== undefined && requested >= 0 && requested < 60_000) {
    return Math.max(backoff, requested);
  }
  return backoff;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = 2,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (!isTransient(error) || attempt >= retries) throw error;
      const delay = retryDelayMs(error, attempt);
      console.warn(`[withRetry] ${label} failed (${error?.status ?? error?.message}); retry ${attempt + 1}/${retries} in ${delay}ms`);
      await sleep(delay);
    }
  }
}
