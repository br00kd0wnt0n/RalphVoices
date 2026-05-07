import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/index.js';
import { generateToken, authMiddleware, AuthRequest } from '../middleware/auth.js';
import { verifyNarrativSso } from '../services/narrativSso.js';
import { z } from 'zod';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// Register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const data = registerSchema.parse(req.body);

    // Check if user exists
    const existing = await query('SELECT id FROM users WHERE email = $1', [data.email]);
    if (existing.rows.length > 0) {
      res.status(400).json({ error: 'Email already registered' });
      return;
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(data.password, 10);
    const result = await query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [data.email, passwordHash, data.name || null]
    );

    const user = result.rows[0];
    const token = generateToken(user.id);

    res.status(201).json({ user, token });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const data = loginSchema.parse(req.body);

    const result = await query(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [data.email]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(data.password, user.password_hash);

    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = generateToken(user.id);

    res.json({
      user: { id: user.id, email: user.email, name: user.name },
      token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

// Narrativ SSO exchange. The Narrativ shell appends `?narrativ_sso=<jwt>`
// to the iframe src; the frontend reads that param on first load and POSTs
// it here. We verify the signature with NARRATIV_SSO_SECRET, find-or-create
// a Voices user keyed by the email claim, and return a Voices JWT so the
// rest of the auth path (localStorage 'token' + authMiddleware) works
// unchanged. SSO-minted users get a non-bcrypt sentinel password so the
// password-login path can't authenticate them.
const ssoExchangeSchema = z.object({ token: z.string().min(1) });

router.post('/sso/exchange', async (req: Request, res: Response) => {
  let body: { token: string };
  try {
    body = ssoExchangeSchema.parse(req.body);
  } catch {
    res.status(400).json({ error: 'missing_token' });
    return;
  }

  const verified = verifyNarrativSso(body.token);
  if (!verified.ok || !verified.claims) {
    // 401 with a structured reason so the frontend can decide whether to
    // surface a useful message or silently fall back to the login page.
    res.status(401).json({ error: 'sso_rejected', reason: verified.reason || 'invalid' });
    return;
  }

  const { email, name } = verified.claims;

  try {
    const existing = await query(
      'SELECT id, email, name FROM users WHERE email = $1',
      [email],
    );

    let user: { id: string; email: string; name: string | null };
    if (existing.rows.length > 0) {
      user = existing.rows[0];
      // Backfill name on first SSO sign-in if Voices side doesn't have one.
      if (!user.name && name) {
        await query('UPDATE users SET name = $1 WHERE id = $2', [name, user.id]);
        user = { ...user, name };
      }
    } else {
      const result = await query(
        "INSERT INTO users (email, password_hash, name) VALUES ($1, 'sso-narrativ', $2) RETURNING id, email, name",
        [email, name],
      );
      user = result.rows[0];
    }

    const voicesToken = generateToken(user.id);
    res.json({ user, token: voicesToken });
  } catch (err) {
    console.error('[narrativ-sso] exchange persistence failed:', err);
    res.status(500).json({ error: 'exchange_failed' });
  }
});

export default router;
