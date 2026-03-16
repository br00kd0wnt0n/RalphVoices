import { Router, Response } from 'express';
import { query, getClient } from '../db/index.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { generateConceptResponse, streamChatResponse, generateRecommendations, TestAsset } from '../services/ai.js';
import { embedConcept, saveConceptEmbedding, computeDisposition, seedAnchorsFromHistory } from '../services/embeddings.js';
import { z } from 'zod';
import type { Persona, PersonaVariant, Test, ScoreConstraints, DispositionScores } from '../utils/types.js';
import { SENTIMENT_THRESHOLDS, ATTITUDE_THRESHOLDS } from '../utils/constants.js';
import { gwiService } from '../services/gwi.js';

const router = Router();

// Store for WebSocket progress updates
export const testProgress = new Map<string, { completed: number; total: number; status: string }>();

const assetSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  base64: z.string(),
  isImage: z.boolean(),
  isPDF: z.boolean(),
  extractedText: z.string().optional(),
});

const createTestSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  test_type: z.enum(['concept', 'asset', 'strategic', 'ab']).default('concept'),
  concept_text: z.string().optional(),
  asset_url: z.string().url().optional(),
  assets: z.array(assetSchema).optional(), // Image and PDF uploads
  options: z.array(z.any()).optional(),
  persona_ids: z.array(z.string().uuid()).min(1),
  variants_per_persona: z.number().int().min(1).max(100).default(20),
  focus_preset: z.string().optional(),
  focus_modifier: z.string().optional(),
  strategic_context: z.object({
    creative_ambition: z.string().optional(),
    strategic_truth: z.string().optional(),
    key_insight: z.string().optional(),
  }).optional(),
  variant_config: z.object({
    age_spread: z.number().int().min(0).max(20).default(5),
    attitude_distribution: z.enum(['normal', 'skew_positive', 'skew_negative']).default('normal'),
    platforms_to_include: z.array(z.string()).default(['TikTok', 'Instagram', 'YouTube', 'Twitter/X']),
  }).optional(),
});

// Create test
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = createTestSchema.parse(req.body);

    // Verify project ownership
    const projectCheck = await query(
      'SELECT id FROM projects WHERE id = $1 AND created_by = $2',
      [data.project_id, req.user!.id]
    );

    if (projectCheck.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Verify personas exist (they can be from any project or standalone)
    const personaCheck = await query(
      `SELECT id FROM personas WHERE id = ANY($1)`,
      [data.persona_ids]
    );

    if (personaCheck.rows.length !== data.persona_ids.length) {
      res.status(400).json({ error: 'One or more personas not found' });
      return;
    }

    // Include focus settings in variant_config
    const variantConfigWithFocus = {
      ...(data.variant_config || {}),
      focus_preset: data.focus_preset || 'baseline',
      focus_modifier: data.focus_modifier || '',
    };

    // Store assets and strategic context in options JSONB
    const optionsWithAssets = {
      ...(data.options ? { options: data.options } : {}),
      assets: data.assets || [],
      ...(data.strategic_context ? { strategic_context: data.strategic_context } : {}),
    };

    const result = await query(
      `INSERT INTO tests (
        project_id, name, test_type, concept_text, asset_url, options,
        persona_ids, variants_per_persona, variant_config, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        data.project_id,
        data.name,
        data.test_type,
        data.concept_text || null,
        data.asset_url || null,
        JSON.stringify(optionsWithAssets),
        data.persona_ids,
        data.variants_per_persona,
        JSON.stringify(variantConfigWithFocus),
        req.user!.id,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    console.error('Create test error:', error);
    res.status(500).json({ error: 'Failed to create test' });
  }
});

// List tests
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { project_id } = req.query;

    let queryText = `
      SELECT t.*,
        (SELECT COUNT(*) FROM test_responses WHERE test_id = t.id) as response_count
      FROM tests t
      JOIN projects p ON t.project_id = p.id
      WHERE p.created_by = $1
    `;
    const params: any[] = [req.user!.id];

    if (project_id) {
      queryText += ' AND t.project_id = $2';
      params.push(project_id);
    }

    queryText += ' ORDER BY t.created_at DESC';

    const result = await query(queryText, params);
    res.json(result.rows);
  } catch (error) {
    console.error('List tests error:', error);
    res.status(500).json({ error: 'Failed to list tests' });
  }
});

// Get test with responses and results
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const testResult = await query(
      `SELECT t.* FROM tests t
       JOIN projects p ON t.project_id = p.id
       WHERE t.id = $1 AND p.created_by = $2`,
      [req.params.id, req.user!.id]
    );

    if (testResult.rows.length === 0) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const test = testResult.rows[0];

    // Get personas used
    const personasResult = await query(
      `SELECT id, name, age_base, location, occupation FROM personas WHERE id = ANY($1)`,
      [test.persona_ids]
    );

    // Get results if test is complete
    let results = null;
    if (test.status === 'complete') {
      const resultsResult = await query(
        `SELECT * FROM test_results WHERE test_id = $1`,
        [test.id]
      );
      if (resultsResult.rows.length > 0) {
        results = resultsResult.rows[0];
      }
    }

    // Check for in-progress status
    const progress = testProgress.get(test.id);

    res.json({
      ...test,
      personas: personasResult.rows,
      results,
      progress: progress || null,
    });
  } catch (error) {
    console.error('Get test error:', error);
    res.status(500).json({ error: 'Failed to get test' });
  }
});

// Get test responses (paginated)
router.get('/:id/responses', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { limit = '50', offset = '0', sentiment, platform, attitude } = req.query;

    // Verify test ownership
    const testCheck = await query(
      `SELECT t.id FROM tests t
       JOIN projects p ON t.project_id = p.id
       WHERE t.id = $1 AND p.created_by = $2`,
      [req.params.id, req.user!.id]
    );

    if (testCheck.rows.length === 0) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    let queryText = `
      SELECT tr.*, pv.variant_name, pv.age_actual, pv.primary_platform,
             pv.attitude_score, pv.engagement_level, pv.location_variant
      FROM test_responses tr
      JOIN persona_variants pv ON tr.variant_id = pv.id
      WHERE tr.test_id = $1
    `;
    const params: any[] = [req.params.id];
    let paramIndex = 2;

    // Apply filters
    if (sentiment) {
      if (sentiment === 'positive') {
        queryText += ` AND tr.sentiment_score >= ${SENTIMENT_THRESHOLDS.POSITIVE_MIN}`;
      } else if (sentiment === 'neutral') {
        queryText += ` AND tr.sentiment_score BETWEEN ${SENTIMENT_THRESHOLDS.NEUTRAL_MIN} AND ${SENTIMENT_THRESHOLDS.POSITIVE_MIN - 1}`;
      } else if (sentiment === 'negative') {
        queryText += ` AND tr.sentiment_score < ${SENTIMENT_THRESHOLDS.NEUTRAL_MIN}`;
      }
    }

    if (platform) {
      queryText += ` AND pv.primary_platform = $${paramIndex}`;
      params.push(platform);
      paramIndex++;
    }

    if (attitude) {
      if (attitude === 'enthusiasts') {
        queryText += ` AND pv.attitude_score >= ${ATTITUDE_THRESHOLDS.ENTHUSIAST_MIN}`;
      } else if (attitude === 'skeptics') {
        queryText += ` AND pv.attitude_score <= ${ATTITUDE_THRESHOLDS.SKEPTIC_MAX}`;
      }
    }

    queryText += ` ORDER BY tr.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await query(queryText, params);

    // Get total count for pagination
    const countResult = await query(
      `SELECT COUNT(*) FROM test_responses WHERE test_id = $1`,
      [req.params.id]
    );

    res.json({
      responses: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (error) {
    console.error('Get responses error:', error);
    res.status(500).json({ error: 'Failed to get responses' });
  }
});

// Get test results
router.get('/:id/results', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const testCheck = await query(
      `SELECT t.id, t.status FROM tests t
       JOIN projects p ON t.project_id = p.id
       WHERE t.id = $1 AND p.created_by = $2`,
      [req.params.id, req.user!.id]
    );

    if (testCheck.rows.length === 0) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    if (testCheck.rows[0].status !== 'complete') {
      res.status(400).json({ error: 'Test is not complete' });
      return;
    }

    const result = await query(
      `SELECT * FROM test_results WHERE test_id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Results not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get results error:', error);
    res.status(500).json({ error: 'Failed to get results' });
  }
});

// Run test
router.post('/:id/run', authMiddleware, async (req: AuthRequest, res: Response) => {
  const testId = req.params.id;

  try {
    // Get test
    const testResult = await query(
      `SELECT t.* FROM tests t
       JOIN projects p ON t.project_id = p.id
       WHERE t.id = $1 AND p.created_by = $2`,
      [testId, req.user!.id]
    );

    if (testResult.rows.length === 0) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const test = testResult.rows[0] as Test;

    if (test.status === 'running') {
      res.status(400).json({ error: 'Test is already running' });
      return;
    }

    if (test.status === 'complete') {
      res.status(400).json({ error: 'Test has already completed' });
      return;
    }

    if (!test.concept_text && test.test_type === 'concept') {
      res.status(400).json({ error: 'Concept text is required' });
      return;
    }

    // If retrying a failed test, clear previous responses and results
    if (test.status === 'failed') {
      await query('DELETE FROM test_responses WHERE test_id = $1', [testId]);
      await query('DELETE FROM test_results WHERE test_id = $1', [testId]);
      await query('UPDATE tests SET responses_completed = 0 WHERE id = $1', [testId]);
    }

    // Get all variants for the selected personas
    // Use explicit column aliases to avoid conflicts between pv and p tables
    const variantsResult = await query(
      `SELECT
         pv.id as variant_id,
         pv.persona_id,
         pv.variant_index,
         pv.age_actual,
         pv.location_variant,
         pv.attitude_score,
         pv.primary_platform,
         pv.engagement_level,
         pv.full_profile,
         pv.variant_name,
         pv.created_at as variant_created_at,
         p.id as persona_id_check,
         p.project_id,
         p.name as persona_name,
         p.age_base,
         p.location as persona_location,
         p.occupation,
         p.household,
         p.psychographics,
         p.media_habits,
         p.brand_context,
         p.cultural_context,
         p.voice_sample,
         p.source_type,
         p.created_by
       FROM persona_variants pv
       JOIN personas p ON pv.persona_id = p.id
       WHERE pv.persona_id = ANY($1)
       ORDER BY pv.persona_id, pv.variant_index`,
      [test.persona_ids]
    );

    if (variantsResult.rows.length === 0) {
      res.status(400).json({ error: 'No variants found. Generate variants for personas first.' });
      return;
    }

    const variants = variantsResult.rows;
    const totalResponses = variants.length;

    // Update test status
    await query(
      `UPDATE tests SET status = 'running', started_at = NOW(), responses_total = $1 WHERE id = $2`,
      [totalResponses, testId]
    );

    // Initialize progress
    testProgress.set(testId, { completed: 0, total: totalResponses, status: 'running' });

    // Send immediate response
    res.json({
      message: 'Test started',
      test_id: testId,
      total_variants: totalResponses,
    });

    // Process variants in background (with rate limiting)
    processTestResponses(test, variants).catch(error => {
      console.error('[processTestResponses] Test processing error:', error);
      console.error('[processTestResponses] Error message:', error?.message);
      console.error('[processTestResponses] Error stack:', error?.stack);
      query(`UPDATE tests SET status = 'failed' WHERE id = $1`, [testId]);
      testProgress.set(testId, { completed: 0, total: totalResponses, status: 'failed' });
    });

  } catch (error) {
    console.error('Run test error:', error);
    res.status(500).json({ error: 'Failed to run test' });
  }
});

// Process test responses (background)
async function processTestResponses(test: Test, variants: any[]) {
  const conceptText = test.concept_text!;
  const variantConfig = typeof test.variant_config === 'string'
    ? JSON.parse(test.variant_config)
    : (test.variant_config || {});
  const focusModifier = variantConfig.focus_modifier || '';

  // Extract assets and strategic context from test options
  const testOptions = typeof test.options === 'string'
    ? JSON.parse(test.options)
    : (test.options || {});
  const assets = testOptions.assets || [];
  const strategicContext = testOptions.strategic_context || {};

  console.log(`Processing test with ${assets.length} assets (${assets.filter((a: any) => a.isImage).length} images, ${assets.filter((a: any) => a.isPDF).length} PDFs)`);

  // Generate concept embedding for vector-based disposition scoring
  let conceptEmbedding: number[] | null = null;
  try {
    const embResult = await embedConcept(conceptText, strategicContext);
    conceptEmbedding = embResult.combined;
    await saveConceptEmbedding(test.id, conceptEmbedding);
    console.log(`Concept embedding generated for test ${test.id}`);
  } catch (err) {
    console.error(`[processTestResponses] Concept embedding failed, proceeding without constraints:`, err);
  }

  const responses: any[] = [];
  const BATCH_SIZE = 3; // Process 3 at a time to respect rate limits
  const DELAY_MS = 1000; // 1 second delay between batches

  for (let i = 0; i < variants.length; i += BATCH_SIZE) {
    const batch = variants.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(async (variantRow) => {
      const variant: PersonaVariant = {
        id: variantRow.variant_id,
        persona_id: variantRow.persona_id,
        variant_index: variantRow.variant_index,
        age_actual: variantRow.age_actual,
        location_variant: variantRow.location_variant,
        attitude_score: variantRow.attitude_score,
        primary_platform: variantRow.primary_platform,
        engagement_level: variantRow.engagement_level,
        full_profile: variantRow.full_profile,
        variant_name: variantRow.variant_name,
        created_at: variantRow.variant_created_at,
      };

      const basePersona: Persona = {
        id: variantRow.persona_id,
        project_id: variantRow.project_id,
        name: variantRow.persona_name,
        age_base: variantRow.age_base,
        location: variantRow.persona_location,
        occupation: variantRow.occupation,
        household: variantRow.household,
        psychographics: variantRow.psychographics,
        media_habits: variantRow.media_habits,
        brand_context: variantRow.brand_context,
        cultural_context: variantRow.cultural_context,
        voice_sample: variantRow.voice_sample,
        source_type: variantRow.source_type,
        created_by: variantRow.created_by,
        created_at: variantRow.variant_created_at,
        updated_at: variantRow.variant_created_at,
      };

      try {
        // Compute vector-based disposition scores (deterministic constraints for GPT)
        let scoreConstraints: ScoreConstraints | undefined;
        let dispositionResult: DispositionScores | undefined;

        if (conceptEmbedding) {
          try {
            dispositionResult = await computeDisposition(variantRow.persona_id, conceptEmbedding);
            if (dispositionResult.constrained) {
              scoreConstraints = {
                sentiment_range: dispositionResult.sentiment_range,
                engagement_range: dispositionResult.engagement_range,
                share_range: dispositionResult.share_range,
                comprehension_range: dispositionResult.comprehension_range,
              };
            }
          } catch (err) {
            console.error(`[processTestResponses] Disposition computation failed for variant ${variant.variant_name}:`, err);
          }
        }

        const startTime = Date.now();
        const response = await generateConceptResponse(variant, basePersona, conceptText, focusModifier, assets, strategicContext, scoreConstraints);
        const processingTime = Date.now() - startTime;

        // Save response to database (including vector_scores)
        await query(
          `INSERT INTO test_responses (
            test_id, variant_id, response_text, sentiment_score,
            engagement_likelihood, share_likelihood, comprehension_score,
            reaction_tags, processing_time_ms, model_used, vector_scores
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            test.id,
            variant.id,
            response.response_text,
            response.sentiment_score,
            response.engagement_likelihood,
            response.share_likelihood,
            response.comprehension_score,
            response.reaction_tags,
            processingTime,
            process.env.OPENAI_MODEL || 'gpt-4o',
            dispositionResult ? JSON.stringify(dispositionResult) : null,
          ]
        );

        return { variant, response };
      } catch (error: any) {
        console.error(`[processTestResponses] Variant ${variant.variant_name} failed:`, error?.message);
        return null; // Skip failed variants instead of crashing entire test
      }
    });

    const batchResults = await Promise.all(batchPromises);
    responses.push(...batchResults.filter(Boolean));

    // Update progress
    const progress = testProgress.get(test.id);
    if (progress) {
      progress.completed = responses.length;
      testProgress.set(test.id, progress);
    }

    await query(
      `UPDATE tests SET responses_completed = $1 WHERE id = $2`,
      [responses.length, test.id]
    );

    // Delay before next batch (rate limiting)
    if (i + BATCH_SIZE < variants.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  // Check if we got any responses at all
  if (responses.length === 0) {
    console.error(`[processTestResponses] All variants failed for test ${test.id}`);
    await query(`UPDATE tests SET status = 'failed' WHERE id = $1`, [test.id]);
    testProgress.set(test.id, { completed: 0, total: variants.length, status: 'failed' });
    return;
  }

  // Generate aggregated results from saved DB data
  console.log(`Starting analysis for test ${test.id} with ${responses.length} responses (${variants.length - responses.length} failed)`);

  // Calculate segment breakdowns from in-memory data
  const segments = calculateSegments(responses);

  // Build summary from DB-stored structured data
  const summary = {
    total_responses: responses.length,
    sentiment: {
      positive: responses.filter(r => (r.response.sentiment_score || 5) >= SENTIMENT_THRESHOLDS.POSITIVE_MIN).length,
      neutral: responses.filter(r => (r.response.sentiment_score || 5) >= SENTIMENT_THRESHOLDS.NEUTRAL_MIN && (r.response.sentiment_score || 5) < SENTIMENT_THRESHOLDS.POSITIVE_MIN).length,
      negative: responses.filter(r => (r.response.sentiment_score || 5) < SENTIMENT_THRESHOLDS.NEUTRAL_MIN).length,
    },
    avg_engagement: Math.round((responses.reduce((sum, r) => sum + (r.response.engagement_likelihood || 0), 0) / responses.length) * 10) / 10,
    avg_share_likelihood: Math.round((responses.reduce((sum, r) => sum + (r.response.share_likelihood || 0), 0) / responses.length) * 10) / 10,
    avg_comprehension: Math.round((responses.reduce((sum, r) => sum + (r.response.comprehension_score || 0), 0) / responses.length) * 10) / 10,
  };

  // Aggregate reaction_tags from all responses (already extracted by AI per-response)
  const tagCounts: Record<string, number> = {};
  for (const r of responses) {
    const tags = r.response.reaction_tags || [];
    for (const tag of tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  // Sort tags by frequency and categorize
  const sortedTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ theme: tag, frequency: count }));

  // Categorize tags into positive/concerns/unexpected based on common patterns
  const positiveKeywords = ['excited', 'love', 'great', 'amazing', 'interested', 'intrigued', 'impressed', 'engaging', 'innovative', 'creative', 'appealing', 'fun', 'cool', 'authentic', 'relatable'];
  const concernKeywords = ['skeptical', 'confused', 'concerned', 'unclear', 'expensive', 'doubt', 'suspicious', 'boring', 'generic', 'annoying', 'intrusive', 'privacy', 'trust', 'overwhelmed'];

  const themes = {
    positive_themes: sortedTags.filter(t => positiveKeywords.some(kw => t.theme.toLowerCase().includes(kw))).slice(0, 8),
    concerns: sortedTags.filter(t => concernKeywords.some(kw => t.theme.toLowerCase().includes(kw))).slice(0, 8),
    unexpected: sortedTags.filter(t =>
      !positiveKeywords.some(kw => t.theme.toLowerCase().includes(kw)) &&
      !concernKeywords.some(kw => t.theme.toLowerCase().includes(kw))
    ).slice(0, 5),
  };

  // Get representative quotes (top positive, top negative, middle neutral)
  const sortedBysentiment = [...responses].sort((a, b) => (b.response.sentiment_score || 5) - (a.response.sentiment_score || 5));
  const keyQuotes = [
    sortedBysentiment[0]?.response.response_text?.substring(0, 300),
    sortedBysentiment[Math.floor(sortedBysentiment.length / 2)]?.response.response_text?.substring(0, 300),
    sortedBysentiment[sortedBysentiment.length - 1]?.response.response_text?.substring(0, 300),
  ].filter(Boolean);

  // Save results
  await query(
    `INSERT INTO test_results (test_id, summary, segments, themes)
     VALUES ($1, $2, $3, $4)`,
    [
      test.id,
      JSON.stringify(summary),
      JSON.stringify(segments),
      JSON.stringify({ ...themes, key_quotes: keyQuotes }),
    ]
  );

  console.log(`Analysis complete for test ${test.id}`);

  // Seed reference anchors from this test's results (self-improving vector scoring)
  try {
    if (conceptEmbedding) {
      const seeded = await seedAnchorsFromHistory(test.id);
      console.log(`Seeded ${seeded} reference anchors from test ${test.id}`);
    }
  } catch (err) {
    console.error(`Anchor seeding failed for test ${test.id}:`, err);
  }

  // GWI enrichment (non-blocking — failures don't affect test completion)
  try {
    if (gwiService.isEnabled()) {
      const enrichment = await gwiService.enrichResults(
        { summary, segments, themes },
        test.concept_text || ''
      );
      if (enrichment) {
        await query(
          'UPDATE test_results SET gwi_enrichment = $1 WHERE test_id = $2',
          [JSON.stringify(enrichment), test.id]
        );
        console.log(`GWI enrichment saved for test ${test.id}`);
      }
    }
  } catch (gwiError) {
    console.error(`GWI enrichment failed for test ${test.id}:`, gwiError);
  }

  // Update test status
  await query(
    `UPDATE tests SET status = 'complete', completed_at = NOW() WHERE id = $1`,
    [test.id]
  );

  testProgress.set(test.id, { completed: responses.length, total: responses.length, status: 'complete' });
}

function calculateSegments(responses: any[]) {
  const byAge: Record<string, { count: number; avgSentiment: number; avgEngagement: number }> = {};
  const byPlatform: Record<string, { count: number; avgSentiment: number; avgEngagement: number }> = {};
  const byAttitude: Record<string, { count: number; avgSentiment: number; avgEngagement: number }> = {};

  for (const { variant, response } of responses) {
    // Age segments
    const age = variant.age_actual;
    let ageGroup = '35+';
    if (age < 25) ageGroup = '18-24';
    else if (age < 35) ageGroup = '25-34';

    if (!byAge[ageGroup]) byAge[ageGroup] = { count: 0, avgSentiment: 0, avgEngagement: 0 };
    byAge[ageGroup].count++;
    byAge[ageGroup].avgSentiment += response.sentiment_score;
    byAge[ageGroup].avgEngagement += response.engagement_likelihood;

    // Platform segments
    const platform = variant.primary_platform || 'Other';
    if (!byPlatform[platform]) byPlatform[platform] = { count: 0, avgSentiment: 0, avgEngagement: 0 };
    byPlatform[platform].count++;
    byPlatform[platform].avgSentiment += response.sentiment_score;
    byPlatform[platform].avgEngagement += response.engagement_likelihood;

    // Attitude segments
    const attitudeScore = variant.attitude_score || 5;
    let attitudeGroup = 'neutral';
    if (attitudeScore >= ATTITUDE_THRESHOLDS.ENTHUSIAST_MIN) attitudeGroup = 'enthusiasts';
    else if (attitudeScore <= ATTITUDE_THRESHOLDS.SKEPTIC_MAX) attitudeGroup = 'skeptics';

    if (!byAttitude[attitudeGroup]) byAttitude[attitudeGroup] = { count: 0, avgSentiment: 0, avgEngagement: 0 };
    byAttitude[attitudeGroup].count++;
    byAttitude[attitudeGroup].avgSentiment += response.sentiment_score;
    byAttitude[attitudeGroup].avgEngagement += response.engagement_likelihood;
  }

  // Calculate averages
  for (const group of Object.values(byAge)) {
    group.avgSentiment = Math.round((group.avgSentiment / group.count) * 10) / 10;
    group.avgEngagement = Math.round((group.avgEngagement / group.count) * 10) / 10;
  }
  for (const group of Object.values(byPlatform)) {
    group.avgSentiment = Math.round((group.avgSentiment / group.count) * 10) / 10;
    group.avgEngagement = Math.round((group.avgEngagement / group.count) * 10) / 10;
  }
  for (const group of Object.values(byAttitude)) {
    group.avgSentiment = Math.round((group.avgSentiment / group.count) * 10) / 10;
    group.avgEngagement = Math.round((group.avgEngagement / group.count) * 10) / 10;
  }

  return { by_age: byAge, by_platform: byPlatform, by_attitude: byAttitude };
}

// Export full test report as JSON
router.get('/:id/export', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // Get test with ownership check
    const testResult = await query(
      `SELECT t.* FROM tests t
       JOIN projects p ON t.project_id = p.id
       WHERE t.id = $1 AND p.created_by = $2`,
      [req.params.id, req.user!.id]
    );

    if (testResult.rows.length === 0) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const test = testResult.rows[0];

    if (test.status !== 'complete') {
      res.status(400).json({ error: 'Test must be complete before exporting' });
      return;
    }

    // Get project info
    const projectResult = await query(
      'SELECT name, client_name FROM projects WHERE id = $1',
      [test.project_id]
    );

    // Get personas
    const personasResult = await query(
      `SELECT id, name, age_base, location, occupation, psychographics, media_habits, source_type
       FROM personas WHERE id = ANY($1)`,
      [test.persona_ids]
    );

    // Get aggregated results
    const resultsResult = await query(
      'SELECT * FROM test_results WHERE test_id = $1',
      [test.id]
    );

    // Get all responses with variant info
    const responsesResult = await query(
      `SELECT tr.response_text, tr.sentiment_score, tr.engagement_likelihood,
              tr.share_likelihood, tr.comprehension_score, tr.reaction_tags,
              tr.processing_time_ms, tr.model_used,
              pv.variant_name, pv.age_actual, pv.primary_platform,
              pv.attitude_score, pv.engagement_level
       FROM test_responses tr
       JOIN persona_variants pv ON tr.variant_id = pv.id
       WHERE tr.test_id = $1
       ORDER BY tr.created_at`,
      [test.id]
    );

    const results = resultsResult.rows[0] || {};
    const project = projectResult.rows[0] || {};
    const variantConfig = typeof test.variant_config === 'string'
      ? JSON.parse(test.variant_config)
      : (test.variant_config || {});

    const report = {
      report_version: '1.0',
      generated_at: new Date().toISOString(),
      test: {
        id: test.id,
        name: test.name,
        test_type: test.test_type,
        concept_text: test.concept_text,
        focus_preset: variantConfig.focus_preset || 'baseline',
        variants_per_persona: test.variants_per_persona,
        created_at: test.created_at,
        completed_at: test.completed_at,
      },
      project: {
        name: project.name,
        client_name: project.client_name,
      },
      personas: personasResult.rows.map((p: any) => ({
        name: p.name,
        age_base: p.age_base,
        location: p.location,
        occupation: p.occupation,
        source_type: p.source_type,
        psychographics: p.psychographics,
        media_habits: p.media_habits,
      })),
      ralph_results: {
        summary: results.summary,
        segments: results.segments,
        themes: results.themes,
      },
      gwi_analysis: results.gwi_enrichment || null,
      responses: responsesResult.rows.map((r: any) => ({
        variant_name: r.variant_name,
        age: r.age_actual,
        platform: r.primary_platform,
        attitude_score: r.attitude_score,
        response_text: r.response_text,
        sentiment_score: r.sentiment_score,
        engagement_likelihood: r.engagement_likelihood,
        share_likelihood: r.share_likelihood,
        comprehension_score: r.comprehension_score,
        reaction_tags: r.reaction_tags,
      })),
      metadata: {
        total_responses: responsesResult.rows.length,
        model_used: responsesResult.rows[0]?.model_used || 'gpt-4o',
        avg_processing_time_ms: responsesResult.rows.length > 0
          ? Math.round(responsesResult.rows.reduce((sum: number, r: any) => sum + (r.processing_time_ms || 0), 0) / responsesResult.rows.length)
          : 0,
      },
    };

    const filename = `ralph-report-${test.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${test.id.substring(0, 8)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(report);
  } catch (error) {
    console.error('Export test error:', error);
    res.status(500).json({ error: 'Failed to export test report' });
  }
});

// Chat with test results (SSE streaming)
router.post('/:id/chat', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    // Verify test ownership and get test data
    const testResult = await query(
      `SELECT t.* FROM tests t
       JOIN projects p ON t.project_id = p.id
       WHERE t.id = $1 AND p.created_by = $2`,
      [req.params.id, req.user!.id]
    );

    if (testResult.rows.length === 0) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const test = testResult.rows[0];

    if (test.status !== 'complete') {
      res.status(400).json({ error: 'Test must be complete to chat' });
      return;
    }

    // Get results
    const resultsResult = await query(
      'SELECT * FROM test_results WHERE test_id = $1',
      [test.id]
    );
    const results = resultsResult.rows[0];

    if (!results) {
      res.status(404).json({ error: 'Results not found' });
      return;
    }

    // Get sample responses (stratified: positive, neutral, negative)
    const responsesResult = await query(
      `SELECT tr.response_text, tr.sentiment_score, tr.engagement_likelihood,
              tr.share_likelihood, tr.comprehension_score, tr.reaction_tags,
              pv.variant_name, pv.age_actual, pv.primary_platform, pv.attitude_score
       FROM test_responses tr
       JOIN persona_variants pv ON tr.variant_id = pv.id
       WHERE tr.test_id = $1
       ORDER BY tr.sentiment_score DESC
       LIMIT 30`,
      [test.id]
    );

    const sampleResponses = responsesResult.rows;
    const summary = results.summary;
    const themes = results.themes;
    const segments = results.segments;

    // Build system prompt
    const systemPrompt = `You are an insights analyst helping a brand strategist understand concept test results. You have access to the following data:

CONCEPT TESTED:
"${test.concept_text || 'N/A'}"

RESULTS SUMMARY:
- ${summary.total_responses} total responses
- Sentiment: ${summary.sentiment.positive} positive, ${summary.sentiment.neutral} neutral, ${summary.sentiment.negative} negative
- Avg Engagement: ${summary.avg_engagement}/10
- Avg Share Likelihood: ${summary.avg_share_likelihood}/10
- Avg Comprehension: ${summary.avg_comprehension}/10

THEMES:
- Working: ${themes.positive_themes?.map((t: any) => `${t.theme} (${t.frequency})`).join(', ') || 'None'}
- Concerns: ${themes.concerns?.map((t: any) => `${t.theme} (${t.frequency})`).join(', ') || 'None'}
- Unexpected: ${themes.unexpected?.map((t: any) => `${t.theme} (${t.frequency})`).join(', ') || 'None'}

SEGMENTS:
By Platform: ${Object.entries(segments.by_platform || {}).map(([p, d]: [string, any]) => `${p}(n=${d.count}, sent=${d.avgSentiment}, eng=${d.avgEngagement})`).join(', ')}
By Attitude: ${Object.entries(segments.by_attitude || {}).map(([a, d]: [string, any]) => `${a}(n=${d.count}, sent=${d.avgSentiment}, eng=${d.avgEngagement})`).join(', ')}
By Age: ${Object.entries(segments.by_age || {}).map(([a, d]: [string, any]) => `${a}(n=${d.count}, sent=${d.avgSentiment}, eng=${d.avgEngagement})`).join(', ')}

SAMPLE RESPONSES:
${sampleResponses.map((r: any) => {
  const sentiment = r.sentiment_score >= 7 ? 'positive' : r.sentiment_score < 4 ? 'negative' : 'neutral';
  return `[${sentiment}] ${r.variant_name}, ${r.age_actual}yo, ${r.primary_platform} (attitude: ${r.attitude_score}/10): "${r.response_text?.substring(0, 200)}"`;
}).join('\n')}

${results.gwi_enrichment ? `GWI MARKET DATA:
${results.gwi_enrichment.executive_summary || ''}
Opportunities: ${results.gwi_enrichment.opportunities?.join('; ') || 'N/A'}
Risks: ${results.gwi_enrichment.risks?.join('; ') || 'N/A'}` : ''}

Answer questions about these findings. Be specific, reference data points, quote persona responses when relevant. Be concise and strategic. Use bullet points for clarity.`;

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const messages = [
      ...history.map((h: any) => ({ role: h.role, content: h.content })),
      { role: 'user' as const, content: message },
    ];

    await streamChatResponse(
      systemPrompt,
      messages,
      (token) => {
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      },
      () => {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      }
    );
  } catch (error) {
    console.error('Chat error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Chat failed' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
      res.end();
    }
  }
});

// Get AI-generated recommendations for improving the concept
router.get('/:id/recommendations', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // Verify test ownership
    const testResult = await query(
      `SELECT t.* FROM tests t
       JOIN projects p ON t.project_id = p.id
       WHERE t.id = $1 AND p.created_by = $2`,
      [req.params.id, req.user!.id]
    );

    if (testResult.rows.length === 0) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    const test = testResult.rows[0];

    if (test.status !== 'complete') {
      res.status(400).json({ error: 'Test must be complete' });
      return;
    }

    // Get results
    const resultsResult = await query(
      'SELECT * FROM test_results WHERE test_id = $1',
      [test.id]
    );
    const results = resultsResult.rows[0];

    if (!results) {
      res.status(404).json({ error: 'Results not found' });
      return;
    }

    // Check cache
    if (results.recommendations) {
      res.json({ recommendations: results.recommendations });
      return;
    }

    // Generate recommendations
    const recommendations = await generateRecommendations(
      test.concept_text || '',
      results.summary,
      results.themes,
      results.segments,
      results.gwi_enrichment
    );

    // Cache in DB (non-blocking)
    query(
      'UPDATE test_results SET recommendations = $1 WHERE test_id = $2',
      [JSON.stringify(recommendations), test.id]
    ).catch((err) => console.error('Failed to cache recommendations:', err));

    res.json({ recommendations });
  } catch (error) {
    console.error('Recommendations error:', error);
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
});

// Delete test
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM tests t
       USING projects p
       WHERE t.id = $1 AND t.project_id = p.id AND p.created_by = $2
       RETURNING t.id`,
      [req.params.id, req.user!.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    testProgress.delete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete test error:', error);
    res.status(500).json({ error: 'Failed to delete test' });
  }
});

export default router;
