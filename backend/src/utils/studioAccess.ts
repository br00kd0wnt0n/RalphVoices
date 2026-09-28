// Who may use the hosted Copy Studio. Sign-in is the normal Voices auth
// (Narrativ SSO); this is the extra allowlist on top. Fails closed: with
// STUDIO_EMAILS and ADMIN_EMAILS unset, nobody gets in.

const emails = (v: string | undefined) => (v || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

export function studioAccess(email: string | undefined, env: NodeJS.ProcessEnv = process.env): { allowed: boolean; admin: boolean } {
  const e = (email || '').trim().toLowerCase();
  if (!e) return { allowed: false, admin: false };
  const admin = emails(env.ADMIN_EMAILS).includes(e);
  return { allowed: admin || emails(env.STUDIO_EMAILS).includes(e), admin };
}
