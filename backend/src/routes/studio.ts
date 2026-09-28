// Copy Studio, hosted (VOICES v2 build 1). Mounted at /api/studio only when
// ENABLE_STUDIO=true. Everyone signs in the usual way (Narrativ SSO via
// tools.ralph.world, authMiddleware); on top of that, only emails in
// STUDIO_EMAILS (or ADMIN_EMAILS) may use it. Rules uploads and activation are
// admin-only. Work is saved in the studio_* tables (migration 015).
//
// Env: STUDIO_EMAILS (comma-separated; fails closed when unset),
// STUDIO_MONTHLY_CAP_USD (default 50), STUDIO_ASK_OVER_USD (default 2),
// OPENAI_API_KEY, ANTHROPIC_API_KEY (Claude writers in blind compare).

import express, { type NextFunction, type Response } from 'express';
import { pool } from '../db/index.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import * as S from '../services/studio/engine.js';
import { PgStore } from '../services/studio/pgStore.js';
import { createStudioRouter } from '../services/studio/router.js';
import { studioAccess } from '../utils/studioAccess.js';

const store = new PgStore(pool);
S.setStore(store);

// One pacer for the whole server, so concurrent jobs share the OpenAI rate limit.
const pacer = new S.Pacer({}, 8);
const cap = Number(process.env.STUDIO_MONTHLY_CAP_USD || 50);
const askOver = Number(process.env.STUDIO_ASK_OVER_USD || 2);

const displayName = (req: AuthRequest) => req.user?.email?.toLowerCase();

function requireStudioAccess(req: AuthRequest, res: Response, next: NextFunction) {
  if (studioAccess(req.user?.email).allowed) return next();
  res.status(403).json({ error: 'studio_not_enabled', message: "Voices Studio isn't switched on for your account. Ask Brook to add you." });
}

const router = express.Router();
// Cheap check for the nav: may this person use the Studio? (404 when ENABLE_STUDIO is off, because nothing is mounted.)
router.get('/access', authMiddleware as any, (req: AuthRequest, res: Response) => res.json(studioAccess(req.user?.email)));
router.use(authMiddleware, requireStudioAccess as any);
router.use(createStudioRouter({
  who: req => displayName(req as AuthRequest),
  api: req => new S.Api({ cap, capWindow: 'month', pacer, user: displayName(req as AuthRequest) }),
  mock: false,
  cap,
  capWindow: 'month',
  askOver,
  rules: { store, isAdmin: req => studioAccess((req as AuthRequest).user?.email).admin },
  metaExtra: req => {
    const u = (req as AuthRequest).user;
    return { user: u ? { email: u.email, name: u.name, admin: studioAccess(u.email).admin } : null };
  },
}));

export default router;
