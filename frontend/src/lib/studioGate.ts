// What hosted /studio shows before it can show Studio: never a blank page (Brook's production test, 1 Oct:
// a first load inside the Narrativ shell stayed blank). Signing in shows that it is; no sign-in, an expired
// sign-in (401) and no Studio access (403) each say so in words. No app imports, so
// backend/tests/studioGate.test.ts can check it.

export interface GateError { status?: number; body?: { error?: string; message?: string } | null; message?: string }
export interface GateInput {
  /** The sign-in check (Narrativ SSO exchange, or the stored token) hasn't finished. */
  loading: boolean;
  signedIn: boolean;
  /** Studio's first call (meta) failed with this. */
  error?: GateError | null;
  /** Inside the Narrativ shell's iframe: reloading the frame can't sign in again (the shell's token is spent), the browser tab can. */
  inFrame: boolean;
}
export interface GateMessage {
  kind: 'signing_in' | 'signed_out' | 'expired' | 'no_access' | 'not_on' | 'crashed';
  title: string;
  body: string;
  /** Offer a Reload button (top level only; in the frame the person reloads the browser tab). */
  reload: boolean;
}

const RELOAD_TAB = 'Reload this browser tab (⌘R, or Ctrl+R) to sign in again through Ralph Tools.';

/**
 * null: show Studio (any other error is shown inside it). 'login': top level with no sign-in, the usual
 * redirect to /login. Otherwise the message to show in place of Studio.
 */
export function studioGate(i: GateInput): GateMessage | 'login' | null {
  if (i.loading) return { kind: 'signing_in', title: 'Signing you in…', body: '', reload: false };
  if (!i.signedIn) {
    if (!i.inFrame) return 'login';
    return { kind: 'signed_out', title: 'Sign-in didn’t finish', body: RELOAD_TAB, reload: false };
  }
  const e = i.error;
  if (!e) return null;
  if (e.status === 401) {
    return { kind: 'expired', title: 'Your sign-in has expired', body: i.inFrame ? RELOAD_TAB : 'Reload the page to sign in again.', reload: !i.inFrame };
  }
  if (e.status === 403 && e.body?.error === 'studio_not_enabled') {
    return { kind: 'no_access', title: 'You don’t have Studio access', body: e.body.message || e.message || 'Ask Brook to add you.', reload: false };
  }
  if (e.status === 404) return { kind: 'not_on', title: 'Voices Studio isn’t switched on here yet', body: '', reload: false };
  return null;
}

/** Inside a frame (the Narrativ shell)? A cross-origin parent throws on access, which also means framed. */
export function inFrame(): boolean {
  try { return typeof window !== 'undefined' && window.self !== window.top; } catch { return true; }
}
