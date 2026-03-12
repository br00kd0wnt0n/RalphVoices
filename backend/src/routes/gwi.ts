import { Router, Response } from 'express';
import { query } from '../db/index.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { gwiService } from '../services/gwi.js';
import { z } from 'zod';

const router = Router();

// Check GWI status
router.post('/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // Try loading user-specific API key from settings
    await gwiService.loadApiKeyForUser(req.user!.id);

    res.json({
      enabled: gwiService.isEnabled(),
      features: gwiService.getFeatures(),
    });
  } catch (error) {
    console.error('GWI status error:', error);
    res.json({ enabled: false, features: [] });
  }
});

// Suggest audiences for a concept
router.post('/suggest-audiences', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await gwiService.loadApiKeyForUser(req.user!.id);

    if (!gwiService.isEnabled()) {
      res.json({ enabled: false, audiences: [] });
      return;
    }

    const schema = z.object({
      concept_text: z.string().min(10),
    });

    const { concept_text } = schema.parse(req.body);
    const audiences = await gwiService.suggestAudiences(concept_text);

    res.json({ enabled: true, audiences });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    console.error('GWI suggest-audiences error:', error);
    res.status(500).json({ error: 'Failed to get audience suggestions' });
  }
});

// Validate a persona against market data
router.post('/validate-persona', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await gwiService.loadApiKeyForUser(req.user!.id);

    if (!gwiService.isEnabled()) {
      res.json({ enabled: false, validation: null });
      return;
    }

    const schema = z.object({
      persona: z.object({
        name: z.string(),
        age_base: z.number().nullable().optional(),
        location: z.string().nullable().optional(),
        occupation: z.string().nullable().optional(),
        psychographics: z.any().optional(),
        media_habits: z.any().optional(),
      }),
    });

    const { persona } = schema.parse(req.body);
    const validation = await gwiService.validatePersona(persona);

    res.json({ enabled: true, validation });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    console.error('GWI validate-persona error:', error);
    res.status(500).json({ error: 'Failed to validate persona' });
  }
});

// Enrich test results with market data
router.post('/enrich-results', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await gwiService.loadApiKeyForUser(req.user!.id);

    if (!gwiService.isEnabled()) {
      res.json({ enabled: false, enrichment: null });
      return;
    }

    const schema = z.object({
      test_id: z.string().uuid(),
    });

    const { test_id } = schema.parse(req.body);

    // Fetch test and results
    const testResult = await query(
      `SELECT t.concept_text, tr.summary, tr.segments, tr.themes
       FROM tests t
       JOIN test_results tr ON tr.test_id = t.id
       JOIN projects p ON t.project_id = p.id
       WHERE t.id = $1 AND p.created_by = $2`,
      [test_id, req.user!.id]
    );

    if (testResult.rows.length === 0) {
      res.status(404).json({ error: 'Test results not found' });
      return;
    }

    const { concept_text, summary, segments, themes } = testResult.rows[0];
    const enrichment = await gwiService.enrichResults(
      { summary, segments, themes },
      concept_text
    );

    // Save enrichment to DB
    if (enrichment) {
      await query(
        'UPDATE test_results SET gwi_enrichment = $1 WHERE test_id = $2',
        [JSON.stringify(enrichment), test_id]
      );
    }

    res.json({ enabled: true, enrichment });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    console.error('GWI enrich-results error:', error);
    res.status(500).json({ error: 'Failed to enrich results' });
  }
});

// Save GWI API key
router.post('/settings', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      api_key: z.string().min(1),
    });

    const { api_key } = schema.parse(req.body);

    await query(
      `INSERT INTO settings (user_id, key, value, updated_at)
       VALUES ($1, 'gwi_api_key', $2, NOW())
       ON CONFLICT (user_id, key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [req.user!.id, api_key]
    );

    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    console.error('GWI settings error:', error);
    res.status(500).json({ error: 'Failed to save GWI settings' });
  }
});

export default router;
