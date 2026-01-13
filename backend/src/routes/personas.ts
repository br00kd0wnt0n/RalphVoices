import { Router, Response } from 'express';
import { query } from '../db/index.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { generateVoiceSample, generateVariants, GeneratedVariant } from '../services/ai.js';
import { z } from 'zod';
import type { Persona, VariantConfig } from '../utils/types.js';

const router = Router();

const psychographicsSchema = z.object({
  values: z.array(z.string()).optional(),
  motivations: z.array(z.string()).optional(),
  aspirations: z.array(z.string()).optional(),
  pain_points: z.array(z.string()).optional(),
  decision_style: z.string().optional(),
}).optional();

const mediaHabitsSchema = z.object({
  primary_platforms: z.array(z.object({
    name: z.string(),
    hours_per_day: z.number(),
  })).optional(),
  content_preferences: z.array(z.string()).optional(),
  influencer_affinities: z.array(z.string()).optional(),
  news_sources: z.array(z.string()).optional(),
}).optional();

const brandContextSchema = z.object({
  category_engagement: z.string().optional(),
  brand_awareness: z.string().optional(),
  purchase_drivers: z.array(z.string()).optional(),
  competitor_preferences: z.array(z.string()).optional(),
}).optional();

const culturalContextSchema = z.object({
  subcultures: z.array(z.string()).optional(),
  trending_interests: z.array(z.string()).optional(),
  humor_style: z.string().optional(),
  language_markers: z.array(z.string()).optional(),
}).optional();

const createPersonaSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  age_base: z.number().int().min(13).max(100).optional(),
  location: z.string().max(255).optional(),
  occupation: z.string().max(255).optional(),
  household: z.string().max(255).optional(),
  psychographics: psychographicsSchema,
  media_habits: mediaHabitsSchema,
  brand_context: brandContextSchema,
  cultural_context: culturalContextSchema,
  generate_voice: z.boolean().optional().default(true),
});

const variantConfigSchema = z.object({
  count: z.number().int().min(1).max(100).default(20),
  age_spread: z.number().int().min(0).max(20).default(5),
  attitude_distribution: z.enum(['normal', 'skew_positive', 'skew_negative']).default('normal'),
  platforms_to_include: z.array(z.string()).default(['TikTok', 'Instagram', 'YouTube', 'Twitter/X']),
});

// Create persona
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = createPersonaSchema.parse(req.body);

    // Verify project ownership
    const projectCheck = await query(
      'SELECT id FROM projects WHERE id = $1 AND created_by = $2',
      [data.project_id, req.user!.id]
    );

    if (projectCheck.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Generate voice sample if requested
    let voiceSample: string | null = null;
    if (data.generate_voice) {
      try {
        voiceSample = await generateVoiceSample(data as Partial<Persona>);
      } catch (error) {
        console.error('Failed to generate voice sample:', error);
        // Continue without voice sample
      }
    }

    const result = await query(
      `INSERT INTO personas (
        project_id, name, age_base, location, occupation, household,
        psychographics, media_habits, brand_context, cultural_context,
        voice_sample, source_type, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        data.project_id,
        data.name,
        data.age_base || null,
        data.location || null,
        data.occupation || null,
        data.household || null,
        data.psychographics ? JSON.stringify(data.psychographics) : null,
        data.media_habits ? JSON.stringify(data.media_habits) : null,
        data.brand_context ? JSON.stringify(data.brand_context) : null,
        data.cultural_context ? JSON.stringify(data.cultural_context) : null,
        voiceSample,
        'builder',
        req.user!.id,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    console.error('Create persona error:', error);
    res.status(500).json({ error: 'Failed to create persona' });
  }
});

// List personas
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { project_id } = req.query;

    let queryText = `
      SELECT p.*,
        (SELECT COUNT(*) FROM persona_variants WHERE persona_id = p.id) as variant_count
      FROM personas p
      JOIN projects pr ON p.project_id = pr.id
      WHERE pr.created_by = $1
    `;
    const params: any[] = [req.user!.id];

    if (project_id) {
      queryText += ' AND p.project_id = $2';
      params.push(project_id);
    }

    queryText += ' ORDER BY p.created_at DESC';

    const result = await query(queryText, params);
    res.json(result.rows);
  } catch (error) {
    console.error('List personas error:', error);
    res.status(500).json({ error: 'Failed to list personas' });
  }
});

// Get persona with variants
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const personaResult = await query(
      `SELECT p.* FROM personas p
       JOIN projects pr ON p.project_id = pr.id
       WHERE p.id = $1 AND pr.created_by = $2`,
      [req.params.id, req.user!.id]
    );

    if (personaResult.rows.length === 0) {
      res.status(404).json({ error: 'Persona not found' });
      return;
    }

    const persona = personaResult.rows[0];

    const variantsResult = await query(
      `SELECT * FROM persona_variants WHERE persona_id = $1 ORDER BY variant_index`,
      [persona.id]
    );

    res.json({
      ...persona,
      variants: variantsResult.rows,
    });
  } catch (error) {
    console.error('Get persona error:', error);
    res.status(500).json({ error: 'Failed to get persona' });
  }
});

// Update persona
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const updateSchema = createPersonaSchema.omit({ project_id: true, generate_voice: true }).extend({
      regenerate_voice: z.boolean().optional(),
    });
    const data = updateSchema.parse(req.body);

    // Verify ownership
    const personaCheck = await query(
      `SELECT p.* FROM personas p
       JOIN projects pr ON p.project_id = pr.id
       WHERE p.id = $1 AND pr.created_by = $2`,
      [req.params.id, req.user!.id]
    );

    if (personaCheck.rows.length === 0) {
      res.status(404).json({ error: 'Persona not found' });
      return;
    }

    // Regenerate voice if requested
    let voiceSample = personaCheck.rows[0].voice_sample;
    if (data.regenerate_voice) {
      try {
        voiceSample = await generateVoiceSample({ ...personaCheck.rows[0], ...data } as Partial<Persona>);
      } catch (error) {
        console.error('Failed to regenerate voice sample:', error);
      }
    }

    const result = await query(
      `UPDATE personas SET
        name = $1, age_base = $2, location = $3, occupation = $4, household = $5,
        psychographics = $6, media_habits = $7, brand_context = $8, cultural_context = $9,
        voice_sample = $10, updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        data.name,
        data.age_base || null,
        data.location || null,
        data.occupation || null,
        data.household || null,
        data.psychographics ? JSON.stringify(data.psychographics) : null,
        data.media_habits ? JSON.stringify(data.media_habits) : null,
        data.brand_context ? JSON.stringify(data.brand_context) : null,
        data.cultural_context ? JSON.stringify(data.cultural_context) : null,
        voiceSample,
        req.params.id,
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    console.error('Update persona error:', error);
    res.status(500).json({ error: 'Failed to update persona' });
  }
});

// Delete persona
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM personas p
       USING projects pr
       WHERE p.id = $1 AND p.project_id = pr.id AND pr.created_by = $2
       RETURNING p.id`,
      [req.params.id, req.user!.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Persona not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete persona error:', error);
    res.status(500).json({ error: 'Failed to delete persona' });
  }
});

// Generate variants for persona
router.post('/:id/variants', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const config = variantConfigSchema.parse(req.body);

    // Get persona
    const personaResult = await query(
      `SELECT p.* FROM personas p
       JOIN projects pr ON p.project_id = pr.id
       WHERE p.id = $1 AND pr.created_by = $2`,
      [req.params.id, req.user!.id]
    );

    if (personaResult.rows.length === 0) {
      res.status(404).json({ error: 'Persona not found' });
      return;
    }

    const persona = personaResult.rows[0] as Persona;

    // Delete existing variants
    await query('DELETE FROM persona_variants WHERE persona_id = $1', [persona.id]);

    // Generate variants using AI
    const variantConfig: VariantConfig = {
      age_spread: config.age_spread,
      attitude_distribution: config.attitude_distribution,
      platforms_to_include: config.platforms_to_include,
    };

    console.log(`Calling generateVariants for persona ${persona.name} with count ${config.count}`);

    let generatedVariants;
    let generationError = null;

    try {
      generatedVariants = await generateVariants(persona, config.count, variantConfig);
      console.log(`generateVariants returned ${generatedVariants.length} variants`);
    } catch (err: any) {
      console.error(`generateVariants threw error:`, err);
      generationError = err.message || 'Unknown error during generation';
      generatedVariants = [];
    }

    if (generatedVariants.length === 0) {
      console.log(`No variants generated. Persona data: name=${persona.name}, age=${persona.age_base}, location=${persona.location}`);
      // Return error response with details
      res.status(200).json({
        persona_id: persona.id,
        variants_generated: 0,
        variants: [],
        error: generationError || 'OpenAI returned empty response - check API key and model settings',
        debug: {
          persona_name: persona.name,
          persona_age: persona.age_base,
          persona_location: persona.location,
          requested_count: config.count,
          openai_model: process.env.OPENAI_MODEL || 'gpt-4o',
          api_key_set: !!process.env.OPENAI_API_KEY,
        }
      });
      return;
    }

    // Insert variants
    const insertedVariants = [];
    for (let i = 0; i < generatedVariants.length; i++) {
      const v = generatedVariants[i];
      const result = await query(
        `INSERT INTO persona_variants (
          persona_id, variant_index, age_actual, location_variant,
          attitude_score, primary_platform, engagement_level,
          full_profile, variant_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          persona.id,
          i + 1,
          v.age_actual,
          v.location_variant,
          v.attitude_score,
          v.primary_platform,
          v.engagement_level,
          JSON.stringify({
            distinguishing_trait: v.distinguishing_trait,
            voice_modifier: v.voice_modifier,
          }),
          v.variant_name,
        ]
      );
      insertedVariants.push(result.rows[0]);
    }

    res.status(201).json({
      persona_id: persona.id,
      variants_generated: insertedVariants.length,
      variants: insertedVariants,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    console.error('Generate variants error:', error);
    res.status(500).json({ error: 'Failed to generate variants' });
  }
});

// List variants for persona
router.get('/:id/variants', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // Verify persona ownership
    const personaCheck = await query(
      `SELECT p.id FROM personas p
       JOIN projects pr ON p.project_id = pr.id
       WHERE p.id = $1 AND pr.created_by = $2`,
      [req.params.id, req.user!.id]
    );

    if (personaCheck.rows.length === 0) {
      res.status(404).json({ error: 'Persona not found' });
      return;
    }

    const result = await query(
      `SELECT * FROM persona_variants WHERE persona_id = $1 ORDER BY variant_index`,
      [req.params.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('List variants error:', error);
    res.status(500).json({ error: 'Failed to list variants' });
  }
});

// Regenerate voice sample
router.post('/:id/voice', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const personaResult = await query(
      `SELECT p.* FROM personas p
       JOIN projects pr ON p.project_id = pr.id
       WHERE p.id = $1 AND pr.created_by = $2`,
      [req.params.id, req.user!.id]
    );

    if (personaResult.rows.length === 0) {
      res.status(404).json({ error: 'Persona not found' });
      return;
    }

    const persona = personaResult.rows[0];
    const voiceSample = await generateVoiceSample(persona);

    await query(
      'UPDATE personas SET voice_sample = $1, updated_at = NOW() WHERE id = $2',
      [voiceSample, persona.id]
    );

    res.json({ voice_sample: voiceSample });
  } catch (error) {
    console.error('Regenerate voice error:', error);
    res.status(500).json({ error: 'Failed to regenerate voice sample' });
  }
});

export default router;
