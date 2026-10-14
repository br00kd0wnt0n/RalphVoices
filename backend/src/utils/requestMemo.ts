// Reads that a single request repeats (Brook, 9 Oct: the Pre-flight report took over 20 s while three audits ran).
// Building the Assets list or one ad's report asked the database for every sign-off, and loaded the same runs, once
// per code and again per check: hundreds of queries and megabytes of JSON for one screen. Inside `withMemo` each of
// those is loaded once for the request; outside it nothing is cached, so writes and jobs always read fresh data.
// Only read-only routes run inside it (router.ts), and what they read is never changed in place.
import { AsyncLocalStorage } from 'node:async_hooks';

const scope = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/** Run `fn` with a fresh memo (or inside the one already running). */
export function withMemo<T>(fn: () => Promise<T>): Promise<T> {
  return scope.getStore() ? fn() : scope.run(new Map(), fn);
}

/** `load()` once per key within the current memo; a failed load isn't kept. Outside a memo, just `load()`. */
export function memo<T>(key: string, load: () => Promise<T>): Promise<T> {
  const m = scope.getStore();
  if (!m) return load();
  if (!m.has(key)) m.set(key, load().catch(e => { m.delete(key); throw e; }));
  return m.get(key) as Promise<T>;
}
