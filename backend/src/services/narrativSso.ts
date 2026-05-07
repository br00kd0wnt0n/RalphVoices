import jwt from 'jsonwebtoken';

// Verifies Narrativ-shell-minted SSO tokens. The Narrativ shell signs a
// 5-minute HS256 JWT with a tool-specific secret and appends it to the iframe
// src. This module verifies the signature with our matching secret and
// enforces one-time-use via the JWT's jti claim — replay (or accidental
// double-mount) of a previously-consumed token is rejected.
//
// Domain allowlist enforcement is single-source-of-truth at sign-in time on
// Narrativ (`GOOGLE_ALLOWED_DOMAINS`). We trust the email claim once the
// signature checks out.

const ISSUER = 'narrativ';
const TOOL_AUDIENCE = 'voices';

export interface NarrativSsoClaims {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  name: string | null;
  iat: number;
  exp: number;
  jti: string;
}

export type VerifyFailureReason =
  | 'missing_secret'
  | 'invalid_signature'
  | 'expired'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'replayed'
  | 'malformed';

export interface VerifyResult {
  ok: boolean;
  reason?: VerifyFailureReason;
  claims?: NarrativSsoClaims;
}

// jti -> expiresAt (ms epoch). In-memory is acceptable: tokens are 5 min,
// so a process restart can at worst re-allow a fresh-but-uncached token,
// which the Narrativ side could already mint a duplicate of by re-calling
// /api/sso/token. Bouncing a tool process is not a privilege escalation.
const consumedJtis = new Map<string, number>();

function pruneConsumedJtis(now = Date.now()): void {
  for (const [jti, expiresAt] of consumedJtis) {
    if (expiresAt < now) consumedJtis.delete(jti);
  }
}

export function verifyNarrativSso(token: string): VerifyResult {
  const secret = process.env.NARRATIV_SSO_SECRET;
  if (!secret) return { ok: false, reason: 'missing_secret' };

  let payload: jwt.JwtPayload | string;
  try {
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid_signature' };
  }

  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, reason: 'malformed' };
  }

  const claims = payload as Partial<NarrativSsoClaims>;
  if (
    typeof claims.sub !== 'string' ||
    typeof claims.email !== 'string' ||
    typeof claims.iat !== 'number' ||
    typeof claims.exp !== 'number' ||
    typeof claims.jti !== 'string'
  ) {
    return { ok: false, reason: 'malformed' };
  }

  if (claims.iss !== ISSUER) return { ok: false, reason: 'wrong_issuer' };
  if (claims.aud !== TOOL_AUDIENCE) return { ok: false, reason: 'wrong_audience' };

  pruneConsumedJtis();
  if (consumedJtis.has(claims.jti)) {
    return { ok: false, reason: 'replayed' };
  }
  consumedJtis.set(claims.jti, claims.exp * 1000);

  const verified: NarrativSsoClaims = {
    iss: claims.iss,
    aud: claims.aud,
    sub: claims.sub,
    email: claims.email,
    name: typeof claims.name === 'string' ? claims.name : null,
    iat: claims.iat,
    exp: claims.exp,
    jti: claims.jti,
  };

  return { ok: true, claims: verified };
}
