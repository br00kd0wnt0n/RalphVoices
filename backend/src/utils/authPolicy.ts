// Who may sign in, and which tokens are honoured.
//
// Voices is reached through tools.ralph.world (Google sign-in on the Narrativ
// side, then POST /auth/sso/exchange). The Railway frontend URL serves the same
// app and data, so its own /register and password login are a side door around
// that Google check. They are closed unless explicitly opened:
//
//   PASSWORD_AUTH=open           legacy behaviour: anyone can register and log in
//                                with a password (use for local dev only)
//   PASSWORD_LOGIN_EMAILS=a,b    when closed, these emails may still register and
//                                log in with a password (e.g. a service account for
//                                scripted runs); nobody else can
//
// Tokens record how they were issued (`via`). When password auth is closed,
// only SSO tokens and password tokens for allowlisted emails are accepted, so
// tokens issued before the lock (no `via`) and tokens held by self-registered
// accounts stop working immediately rather than at their 7-day expiry.

export type TokenVia = 'sso' | 'password';

export function passwordAuthOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PASSWORD_AUTH === 'open';
}

export function passwordLoginEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.PASSWORD_LOGIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function registrationAllowed(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return passwordLoginAllowed(email, env);
}

export function passwordLoginAllowed(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return passwordAuthOpen(env) || passwordLoginEmails(env).includes(email.trim().toLowerCase());
}

export function tokenAllowed(via: TokenVia | undefined, email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (passwordAuthOpen(env)) return true;
  if (via === 'sso') return true;
  if (via === 'password') return passwordLoginEmails(env).includes(email.trim().toLowerCase());
  return false;
}
