// The Voices sign-in token. Kept in localStorage, and also in memory, because inside the Narrativ
// shell's iframe the browser can refuse storage (third-party storage blocked): reading or writing
// localStorage then throws, which used to stop sign-in half way and leave /studio blank (Brook's
// production test, 1 Oct). With the memory copy the page stays signed in until it's reloaded.
// No app imports, so backend/tests/studioGate.test.ts can check it.

const KEY = 'token';
let memory: string | null = null;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storage = (): StorageLike | null => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

export function getToken(): string | null {
  try { const t = storage()?.getItem(KEY); if (t) return t; } catch { /* storage refused: use the memory copy */ }
  return memory;
}
export function setToken(token: string): void {
  memory = token;
  try { storage()?.setItem(KEY, token); } catch { /* storage refused: the memory copy lasts for this page */ }
}
export function clearToken(): void {
  memory = null;
  try { storage()?.removeItem(KEY); } catch { /* nothing stored */ }
}
