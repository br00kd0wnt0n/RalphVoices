// Copy Studio, hosted (VOICES v2 build 1). Mounted at /api/studio only when
// ENABLE_STUDIO=true. Everyone signs in the usual way (Narrativ SSO via
// tools.ralph.world, authMiddleware); on top of that, only emails in
// STUDIO_EMAILS (or ADMIN_EMAILS) may use it. Rules uploads and activation are
// admin-only. Work is saved in the studio_* tables (migration 015).
//
// Env: STUDIO_EMAILS (comma-separated; fails closed when unset),
// STUDIO_MONTHLY_CAP_USD (default 50), STUDIO_ASK_OVER_USD (default 2),
// OPENAI_API_KEY, ANTHROPIC_API_KEY (Claude writers in blind compare).
// STUDIO_MOCK=true (local development only) uses the mock client.
// STUDIO_READY_EMAILS: who (besides admins) may mark Pre-flight assets Ready to traffic.
// STUDIO_COMPLIANCE_EMAILS: who (besides admins) may set compliance status on copy (the producer).
// STUDIO_R2_BUCKET (optional): a private bucket for Pre-flight files; otherwise R2_BUCKET_NAME.

import express, { type NextFunction, type Response } from 'express';
import { pool } from '../db/index.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import * as S from '../services/studio/engine.js';
import { PgStore } from '../services/studio/pgStore.js';
import { createStudioRouter } from '../services/studio/router.js';
import { canSetCompliance, canSetReady, studioAccess } from '../utils/studioAccess.js';
import { Preflight } from '../services/studio/preflight.js';
import { mockEngine, type AuditEngine } from '../services/studio/preflightEngine.js';
import { b2Engine } from '../services/studio/preflightB2.js';
import { monthStart } from '../services/studio/router.js';

const store = new PgStore(pool);
S.setStore(store);

// One pacer for the whole server, so concurrent jobs share the OpenAI rate limit.
const pacer = new S.Pacer({}, 8);
const cap = Number(process.env.STUDIO_MONTHLY_CAP_USD || 50);
const askOver = Number(process.env.STUDIO_ASK_OVER_USD || 2);
// Local development only: STUDIO_MOCK=true runs the hosted routes on the mock client (no key, no cost). Ignored in production.
const mock = process.env.STUDIO_MOCK === 'true' && process.env.NODE_ENV !== 'production';

const displayName = (req: AuthRequest) => req.user?.email?.toLowerCase();

function requireStudioAccess(req: AuthRequest, res: Response, next: NextFunction) {
  if (studioAccess(req.user?.email).allowed) return next();
  res.status(403).json({ error: 'studio_not_enabled', message: "Voices Studio isn't switched on for your account. Ask Brook to add you." });
}

// Pre-flight's audit engine: B2's (services/audit); the mock only in local development.
// Each audit stops if it would take spend past what's left of this month's budget. FFMPEG_PATH is optional (else PATH).
const auditEngine: AuditEngine = mock ? mockEngine : b2Engine({
  ffmpegPath: process.env.FFMPEG_PATH || undefined,
  capUsd: async () => Math.max(0, cap - (await store.spendTotal(monthStart()))),
});
const preflight = new Preflight(pool, auditEngine);

const router = express.Router();
// Cheap check for the nav: may this person use the Studio? (404 when ENABLE_STUDIO is off, because nothing is mounted.)
router.get('/access', authMiddleware as any, (req: AuthRequest, res: Response) => res.json(studioAccess(req.user?.email)));
router.use(authMiddleware, requireStudioAccess as any);
router.use(createStudioRouter({
  who: req => displayName(req as AuthRequest),
  api: req => new S.Api({ mock, cap, capWindow: 'month', pacer, user: displayName(req as AuthRequest) }),
  mock,
  cap,
  capWindow: 'month',
  askOver,
  rules: { store, isAdmin: req => studioAccess((req as AuthRequest).user?.email).admin },
  preflight: { service: preflight, canSetReady: req => canSetReady((req as AuthRequest).user?.email) },
  canSetCompliance: req => canSetCompliance((req as AuthRequest).user?.email),
  metaExtra: req => {
    const u = (req as AuthRequest).user;
    return { user: u ? { email: u.email, name: u.name, admin: studioAccess(u.email).admin } : null };
  },
}));

export default router;
