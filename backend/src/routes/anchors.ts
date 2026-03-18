import { Router, Response } from 'express';
import { query } from '../db/index.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import {
  seedAnchorsFromHistory,
  backfillPersonaEmbeddings,
} from '../services/embeddings.js';

const router = Router();

// Get anchor statistics
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const countResult = await query<{ count: string }>(
      'SELECT COUNT(*) FROM reference_anchors'
    );
    const sourceResult = await query<{ source: string; count: string }>(
      'SELECT source, COUNT(*) as count FROM reference_anchors GROUP BY source'
    );
    const embeddedPersonas = await query<{ count: string }>(
      'SELECT COUNT(*) FROM personas WHERE embedding_values IS NOT NULL AND created_by = $1',
      [req.user!.id]
    );
    const totalPersonas = await query<{ count: string }>(
      'SELECT COUNT(*) FROM personas WHERE created_by = $1',
      [req.user!.id]
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

// Seed anchors from historical test data
router.post('/seed', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { test_id } = req.body;

    // First backfill any missing persona embeddings
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

// Per-persona embedding status
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

// Recent anchors with context
router.get('/recent', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT ra.id, ra.source, ra.confidence,
        ra.sentiment_score, ra.engagement_likelihood, ra.share_likelihood, ra.comprehension_score,
        ra.reaction_tags, ra.primary_platform, ra.attitude_score,
        p.name as persona_name, t.name as test_name, ra.created_at
      FROM reference_anchors ra
      LEFT JOIN personas p ON ra.persona_id = p.id
      LEFT JOIN tests t ON ra.test_id = t.id
      ORDER BY ra.created_at DESC
      LIMIT 50`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Recent anchors error:', error);
    res.status(500).json({ error: 'Failed to get recent anchors' });
  }
});

// Clear all anchors (for recalibration)
router.delete('/all', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('DELETE FROM reference_anchors RETURNING id');
    res.json({ deleted: result.rowCount });
  } catch (error) {
    console.error('Clear anchors error:', error);
    res.status(500).json({ error: 'Failed to clear anchors' });
  }
});

export default router;
