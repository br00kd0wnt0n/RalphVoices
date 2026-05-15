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

// Statistics for the caller's own anchors + their persona embedding
// coverage. Global-calibration rows are NOT counted toward `total_anchors`
// here — they're shared infrastructure, not the user's calibration set.
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM reference_anchors ra
        WHERE ra.project_id IN (SELECT id FROM projects WHERE created_by = $1)`,
      [userId],
    );
    const sourceResult = await query<{ source: string; count: string }>(
      `SELECT source, COUNT(*)::text AS count FROM reference_anchors ra
        WHERE ra.project_id IN (SELECT id FROM projects WHERE created_by = $1)
        GROUP BY source`,
      [userId],
    );
    const embeddedPersonas = await query<{ count: string }>(
      'SELECT COUNT(*) FROM personas WHERE embedding_values IS NOT NULL AND created_by = $1',
      [userId]
    );
    const totalPersonas = await query<{ count: string }>(
      'SELECT COUNT(*) FROM personas WHERE created_by = $1',
      [userId]
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

// Seed anchors from one of the caller's own historical tests. test_id
// is now validated as a UUID owned by the caller before the seed
// function runs; previously any authed user could pass any test_id.
router.post('/seed', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { test_id } = req.body ?? {};

    // test_id is optional in the seed signature ("seed all my eligible
    // tests" when omitted) but if supplied it MUST be a UUID belonging
    // to the caller. Don't trust the body alone.
    if (test_id !== undefined && test_id !== null) {
      if (typeof test_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(test_id)) {
        return res.status(400).json({ error: 'test_id must be a UUID' });
      }
      const ownership = await query<{ id: string }>(
        `SELECT t.id FROM tests t
           JOIN projects p ON p.id = t.project_id
          WHERE t.id = $1 AND p.created_by = $2
          LIMIT 1`,
        [test_id, userId],
      );
      if (ownership.rows.length === 0) {
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

// Per-persona embedding status — already user-scoped pre-sweep.
router.get('/personas', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, age_base, location,
        embedding_values IS NOT NULL as has_values,
        embedding_platform IS NOT NULL as has_platform,
        embedding_cultural IS NOT NULL as has_cultural,
        embedding_demographic IS NOT NULL as has_demographic,
        embeddings_updated_at
      FROM personas
      WHERE created_by = $1
      ORDER BY name`,
      [req.user!.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Persona embeddings error:', error);
    res.status(500).json({ error: 'Failed to get persona embedding status' });
  }
});

// Recent anchors visible to the caller. Includes their own + global-
// calibration set (so they see the shared reference points). Was
// previously cross-tenant.
router.get('/recent', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const result = await query(
      `SELECT ra.id, ra.source, ra.confidence,
        ra.sentiment_score, ra.engagement_likelihood, ra.share_likelihood, ra.comprehension_score,
        ra.reaction_tags, ra.primary_platform, ra.attitude_score,
        p.name as persona_name, t.name as test_name, ra.created_at,
        ra.is_global_calibration
      FROM reference_anchors ra
      LEFT JOIN personas p ON ra.persona_id = p.id
      LEFT JOIN tests t ON ra.test_id = t.id
      WHERE ra.is_global_calibration = TRUE
         OR ra.project_id IN (SELECT id FROM projects WHERE created_by = $1)
      ORDER BY ra.created_at DESC
      LIMIT 50`,
      [userId],
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Recent anchors error:', error);
    res.status(500).json({ error: 'Failed to get recent anchors' });
  }
});

// Clear the caller's own anchors. Was globally destructive pre-sweep —
// any authed user could wipe every team-member's calibration data. Now:
// - Only anchors in projects the caller owns are deleted.
// - is_global_calibration = TRUE rows are NEVER touched on this path;
//   those are admin-managed reference points and a regular user
//   shouldn't be able to nuke them.
router.delete('/all', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const result = await query(
      `DELETE FROM reference_anchors
        WHERE is_global_calibration = FALSE
          AND project_id IN (SELECT id FROM projects WHERE created_by = $1)
        RETURNING id`,
      [userId],
    );
    res.json({ deleted: result.rowCount });
  } catch (error) {
    console.error('Clear anchors error:', error);
    res.status(500).json({ error: 'Failed to clear anchors' });
  }
});

export default router;
