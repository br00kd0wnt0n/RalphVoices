import { Router, Response } from 'express';
import { query } from '../db/index.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import {
  seedAnchorsFromHistory,
  backfillPersonaEmbeddings,
} from '../services/embeddings.js';

// Anchor routes — calibration data is scoped per project (migration 005
// added reference_anchors.project_id). User-visible anchors are those in
// projects the user owns, plus globally-calibrated ones (is_global_-
// calibration = TRUE) which Ralph admins explicitly flip on.
//
// Before the security sweep these routes were global — any authed user
// could read or delete any other user's anchors. Now they scope through
// projects.created_by = req.user.id; DELETE /all only affects the
// caller's anchors and NEVER touches global-calibration rows.

const router = Router();

// Statistics across all anchors + persona embedding coverage.
// Universal visibility (2026-05-21) — every signed-in user sees
// every project's anchors. Global-calibration rows are NOT counted
// toward `total_anchors`; they're shared infrastructure, not the
// team's calibration set.
router.get('/stats', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM reference_anchors ra
        WHERE ra.is_global_calibration = FALSE`,
    );
    const sourceResult = await query<{ source: string; count: string }>(
      `SELECT source, COUNT(*)::text AS count FROM reference_anchors ra
        WHERE ra.is_global_calibration = FALSE
        GROUP BY source`,
    );
    const embeddedPersonas = await query<{ count: string }>(
      'SELECT COUNT(*) FROM personas WHERE embedding_values IS NOT NULL',
    );
    const totalPersonas = await query<{ count: string }>(
      'SELECT COUNT(*) FROM personas',
    );

    res.json({
      total_anchors: parseInt(countResult.rows[0].count),
      by_source: Object.fromEntries(
        sourceResult.rows.map((r) => [r.source, parseInt(r.count)])
      ),
      embedded_personas: parseInt(embeddedPersonas.rows[0].count),
      total_personas: parseInt(totalPersonas.rows[0].count),
    });
  } catch (error) {
    console.error('Anchor stats error:', error);
    res.status(500).json({ error: 'Failed to get anchor stats' });
  }
});

// Seed anchors from a historical test. Universal visibility: any
// signed-in user can seed from any test. test_id still validated as
// a UUID + must exist.
router.post('/seed', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { test_id } = req.body ?? {};

    if (test_id !== undefined && test_id !== null) {
      if (typeof test_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(test_id)) {
        return res.status(400).json({ error: 'test_id must be a UUID' });
      }
      const exists = await query<{ id: string }>(
        `SELECT id FROM tests WHERE id = $1 LIMIT 1`,
        [test_id],
      );
      if (exists.rows.length === 0) {
        return res.status(404).json({ error: 'Test not found' });
      }
    }

    const embeddedCount = await backfillPersonaEmbeddings();
    if (embeddedCount > 0) {
      console.log(`Backfilled embeddings for ${embeddedCount} personas`);
    }

    const seeded = await seedAnchorsFromHistory(test_id);

    res.json({
      anchors_seeded: seeded,
      personas_embedded: embeddedCount,
    });
  } catch (error) {
    console.error('Seed anchors error:', error);
    res.status(500).json({ error: 'Failed to seed anchors' });
  }
});

// Per-persona embedding status — universal visibility.
router.get('/personas', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, age_base, location,
        embedding_values IS NOT NULL as has_values,
        embedding_platform IS NOT NULL as has_platform,
        embedding_cultural IS NOT NULL as has_cultural,
        embedding_demographic IS NOT NULL as has_demographic,
        embeddings_updated_at
      FROM personas
      ORDER BY name`,
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Persona embeddings error:', error);
    res.status(500).json({ error: 'Failed to get persona embedding status' });
  }
});

// Recent anchors across all projects (universal visibility) +
// global-calibration set.
router.get('/recent', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT ra.id, ra.source, ra.confidence,
        ra.sentiment_score, ra.engagement_likelihood, ra.share_likelihood, ra.comprehension_score,
        ra.reaction_tags, ra.primary_platform, ra.attitude_score,
        p.name as persona_name, t.name as test_name, ra.created_at,
        ra.is_global_calibration
      FROM reference_anchors ra
      LEFT JOIN personas p ON ra.persona_id = p.id
      LEFT JOIN tests t ON ra.test_id = t.id
      ORDER BY ra.created_at DESC
      LIMIT 50`,
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Recent anchors error:', error);
    res.status(500).json({ error: 'Failed to get recent anchors' });
  }
});

// Clear team anchors. Universal visibility means any signed-in user
// can wipe — accept that posture for now (mirrors Narrativ's
// universal-access; tighten when access policy becomes a need).
// is_global_calibration = TRUE rows still NEVER touched on this
// path; those are admin-managed reference points.
router.delete('/all', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM reference_anchors
        WHERE is_global_calibration = FALSE
        RETURNING id`,
    );
    res.json({ deleted: result.rowCount });
  } catch (error) {
    console.error('Clear anchors error:', error);
    res.status(500).json({ error: 'Failed to clear anchors' });
  }
});

export default router;
