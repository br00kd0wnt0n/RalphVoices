import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-change-me';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string | null;
  };
}

export function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string };
  } catch {
    return null;
  }
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  // If no auth header, use demo user (public mode)
  if (!authHeader?.startsWith('Bearer ')) {
    try {
      // Get or create demo user
      let result = await query(
        "SELECT id, email, name FROM users WHERE email = 'demo@ralphvoices.com'"
      );

      if (result.rows.length === 0) {
        // Create demo user if doesn't exist
        result = await query(
          "INSERT INTO users (email, password_hash, name) VALUES ('demo@ralphvoices.com', 'public-demo', 'Demo User') RETURNING id, email, name"
        );
      }

      req.user = result.rows[0];
      next();
      return;
    } catch (error) {
      console.error('Demo user error:', error);
      res.status(500).json({ error: 'Failed to initialize demo mode' });
      return;
    }
  }

  const token = authHeader.slice(7);
  const decoded = verifyToken(token);

  if (!decoded) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  try {
    const result = await query(
      'SELECT id, email, name FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authentication failed' });
  }
}

export async function optionalAuthMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7);
  const decoded = verifyToken(token);

  if (decoded) {
    try {
      const result = await query(
        'SELECT id, email, name FROM users WHERE id = $1',
        [decoded.userId]
      );
      if (result.rows.length > 0) {
        req.user = result.rows[0];
      }
    } catch (error) {
      // Continue without user
    }
  }

  next();
}
