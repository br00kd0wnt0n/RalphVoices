import OpenAI from 'openai';
import { query } from '../db/index.js';
import type {
  Persona,
  PersonaEmbeddings,
  ConceptEmbeddings,
  DispositionScores,
  ScoreConstraints,
} from '../utils/types.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'missing-key',
});

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 1536;

// Disposition tuning constants
const ANCHOR_K = 10; // Max nearest anchors to consider
const ANCHOR_MIN_SIMILARITY = 0.5; // Minimum combined similarity to include
const SCORE_RANGE_HALFWIDTH = 1.5; // ± from weighted mean

// ---------------------------------------------------------------------------
// Core embedding function
// ---------------------------------------------------------------------------

export async function embedText(text: string): Promise<number[]> {
  // text-embedding-3-small has ~8K token limit; truncate long inputs
  const truncated = text.slice(0, 30000);

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: truncated,
    dimensions: EMBEDDING_DIMS,
  });

  return response.data[0].embedding;
}

// ---------------------------------------------------------------------------
// Persona embedding (multi-facet)
// ---------------------------------------------------------------------------

export async function embedPersona(persona: Partial<Persona>): Promise<PersonaEmbeddings> {
  const valuesText = [
    `Values: ${persona.psychographics?.values?.join(', ') || 'general'}`,
    `Motivations: ${persona.psychographics?.motivations?.join(', ') || 'general'}`,
    `Pain points: ${persona.psychographics?.pain_points?.join(', ') || 'none specified'}`,
    `Decision style: ${persona.psychographics?.decision_style || 'balanced'}`,
    `Aspirations: ${persona.psychographics?.aspirations?.join(', ') || 'general'}`,
  ].join('. ');

  const platformText = [
    `Platforms: ${persona.media_habits?.primary_platforms?.map((p) => `${p.name} (${p.hours_per_day}h/day)`).join(', ') || 'general'}`,
    `Content preferences: ${persona.media_habits?.content_preferences?.join(', ') || 'general'}`,
    `Influencer affinities: ${persona.media_habits?.influencer_affinities?.join(', ') || 'none'}`,
  ].join('. ');

  const culturalText = [
    `Subcultures: ${persona.cultural_context?.subcultures?.join(', ') || 'mainstream'}`,
    `Humor style: ${persona.cultural_context?.humor_style || 'general'}`,
    `Language markers: ${persona.cultural_context?.language_markers?.join(', ') || 'standard'}`,
    `Trending interests: ${persona.cultural_context?.trending_interests?.join(', ') || 'general'}`,
  ].join('. ');

  const demographicText = [
    `Age: ${persona.age_base || 'unspecified'}`,
    `Location: ${persona.location || 'unspecified'}`,
    `Occupation: ${persona.occupation || 'unspecified'}`,
    `Household: ${persona.household || 'unspecified'}`,
    `Brand engagement: ${persona.brand_context?.category_engagement || 'moderate'}`,
    `Purchase drivers: ${persona.brand_context?.purchase_drivers?.join(', ') || 'general'}`,
  ].join('. ');

  // Parallel embedding calls for all four facets
  const [values, platform, cultural, demographic] = await Promise.all([
    embedText(valuesText),
    embedText(platformText),
    embedText(culturalText),
    embedText(demographicText),
  ]);

  return { values, platform, cultural, demographic };
}

// ---------------------------------------------------------------------------
// Save/load persona embeddings
// ---------------------------------------------------------------------------

export async function savePersonaEmbeddings(
  personaId: string,
  embeddings: PersonaEmbeddings
): Promise<void> {
  await query(
    `UPDATE personas SET
       embedding_values = $1::vector,
       embedding_platform = $2::vector,
       embedding_cultural = $3::vector,
       embedding_demographic = $4::vector,
       embeddings_updated_at = NOW()
     WHERE id = $5`,
    [
      `[${embeddings.values.join(',')}]`,
      `[${embeddings.platform.join(',')}]`,
      `[${embeddings.cultural.join(',')}]`,
      `[${embeddings.demographic.join(',')}]`,
      personaId,
    ]
  );
}

// ---------------------------------------------------------------------------
// Concept embedding
// ---------------------------------------------------------------------------

export async function embedConcept(
  conceptText: string,
  strategicContext?: { creative_ambition?: string; strategic_truth?: string; key_insight?: string }
): Promise<ConceptEmbeddings> {
  let fullText = conceptText;

  if (strategicContext) {
    const parts: string[] = [];
    if (strategicContext.creative_ambition) parts.push(`Ambition: ${strategicContext.creative_ambition}`);
    if (strategicContext.strategic_truth) parts.push(`Truth: ${strategicContext.strategic_truth}`);
    if (strategicContext.key_insight) parts.push(`Insight: ${strategicContext.key_insight}`);
    if (parts.length > 0) {
      fullText += '\n\nStrategic Context: ' + parts.join('. ');
    }
  }

  const combined = await embedText(fullText);
  return { combined };
}

export async function saveConceptEmbedding(
  testId: string,
  embedding: number[]
): Promise<void> {
  await query(
    `UPDATE tests SET
       concept_embedding = $1::vector,
       concept_embedding_updated_at = NOW()
     WHERE id = $2`,
    [`[${embedding.join(',')}]`, testId]
  );
}

// ---------------------------------------------------------------------------
// Disposition scoring — the core algorithmic scoring function
// ---------------------------------------------------------------------------

function makeUnconstrainedResult(): DispositionScores {
  return {
    sentiment_range: [1, 10],
    engagement_range: [1, 10],
    share_range: [1, 10],
    comprehension_range: [1, 10],
    anchor_count: 0,
    avg_similarity: 0,
    constrained: false,
  };
}

export async function computeDisposition(
  personaId: string,
  conceptEmbedding: number[]
): Promise<DispositionScores> {
  // Check persona has embeddings
  const personaResult = await query<{ embedding_values: string }>(
    `SELECT embedding_values FROM personas WHERE id = $1 AND embedding_values IS NOT NULL`,
    [personaId]
  );

  if (personaResult.rows.length === 0 || !personaResult.rows[0].embedding_values) {
    return makeUnconstrainedResult();
  }

  const conceptVec = `[${conceptEmbedding.join(',')}]`;

  // Find nearest anchors by combined persona + concept similarity
  // Persona similarity weighted 0.6, concept similarity weighted 0.4
  const anchorsResult = await query<{
    sentiment_score: number;
    engagement_likelihood: number;
    share_likelihood: number;
    comprehension_score: number;
    reaction_tags: string[] | null;
    confidence: number;
    combined_similarity: number;
  }>(
    `SELECT
       sentiment_score,
       engagement_likelihood,
       share_likelihood,
       comprehension_score,
       reaction_tags,
       confidence,
       (1 - (persona_embedding <=> (SELECT embedding_values FROM personas WHERE id = $1))) * 0.6 +
       (1 - (concept_embedding <=> $2::vector)) * 0.4 AS combined_similarity
     FROM reference_anchors
     WHERE
       (1 - (persona_embedding <=> (SELECT embedding_values FROM personas WHERE id = $1))) * 0.6 +
       (1 - (concept_embedding <=> $2::vector)) * 0.4 > $3
     ORDER BY combined_similarity DESC
     LIMIT $4`,
    [personaId, conceptVec, ANCHOR_MIN_SIMILARITY, ANCHOR_K]
  );

  const anchors = anchorsResult.rows;

  if (anchors.length < 3) {
    return makeUnconstrainedResult();
  }

  // Compute weighted mean and range for each score dimension
  const totalWeight = anchors.reduce(
    (sum, a) => sum + a.combined_similarity * a.confidence,
    0
  );

  function weightedScore(getValue: (a: typeof anchors[0]) => number | null): [number, number] {
    const weightedMean =
      anchors.reduce(
        (sum, a) => sum + (getValue(a) || 5) * a.combined_similarity * a.confidence,
        0
      ) / totalWeight;

    const low = Math.max(1, Math.round((weightedMean - SCORE_RANGE_HALFWIDTH) * 10) / 10);
    const high = Math.min(10, Math.round((weightedMean + SCORE_RANGE_HALFWIDTH) * 10) / 10);
    return [low, high];
  }

  const avgSim =
    anchors.reduce((sum, a) => sum + a.combined_similarity, 0) / anchors.length;

  return {
    sentiment_range: weightedScore((a) => a.sentiment_score),
    engagement_range: weightedScore((a) => a.engagement_likelihood),
    share_range: weightedScore((a) => a.share_likelihood),
    comprehension_range: weightedScore((a) => a.comprehension_score),
    anchor_count: anchors.length,
    avg_similarity: Math.round(avgSim * 1000) / 1000,
    constrained: true,
  };
}

// ---------------------------------------------------------------------------
// Seed reference anchors from historical test data
// ---------------------------------------------------------------------------

export async function seedAnchorsFromHistory(testId?: string): Promise<number> {
  // Find completed tests with responses
  let testsQuery = `
    SELECT t.id, t.concept_embedding, t.concept_text, t.options
    FROM tests t
    WHERE t.status = 'complete'
      AND t.concept_text IS NOT NULL
  `;
  const params: any[] = [];

  if (testId) {
    testsQuery += ' AND t.id = $1';
    params.push(testId);
  }

  const testsResult = await query<{
    id: string;
    concept_embedding: string | null;
    concept_text: string;
    options: any;
  }>(testsQuery, params);

  let totalSeeded = 0;

  for (const test of testsResult.rows) {
    // Generate concept embedding if not already present
    let conceptVec = test.concept_embedding;
    if (!conceptVec) {
      const options =
        typeof test.options === 'string' ? JSON.parse(test.options) : test.options || {};
      const embResult = await embedConcept(test.concept_text, options.strategic_context);
      await saveConceptEmbedding(test.id, embResult.combined);
      conceptVec = `[${embResult.combined.join(',')}]`;
    }

    // Get responses that have persona embeddings and aren't already anchored
    const responsesResult = await query<{
      variant_id: string;
      sentiment_score: number;
      engagement_likelihood: number;
      share_likelihood: number;
      comprehension_score: number;
      reaction_tags: string[] | null;
      persona_id: string;
      attitude_score: number | null;
      primary_platform: string | null;
      embedding_values: string;
    }>(
      `SELECT
         tr.variant_id, tr.sentiment_score, tr.engagement_likelihood,
         tr.share_likelihood, tr.comprehension_score, tr.reaction_tags,
         pv.persona_id, pv.attitude_score, pv.primary_platform,
         p.embedding_values
       FROM test_responses tr
       JOIN persona_variants pv ON tr.variant_id = pv.id
       JOIN personas p ON pv.persona_id = p.id
       WHERE tr.test_id = $1
         AND p.embedding_values IS NOT NULL
         AND tr.sentiment_score IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM reference_anchors ra
           WHERE ra.variant_id = tr.variant_id AND ra.test_id = $1
         )`,
      [test.id]
    );

    for (const resp of responsesResult.rows) {
      await query(
        `INSERT INTO reference_anchors (
           persona_id, test_id, variant_id,
           persona_embedding, concept_embedding,
           sentiment_score, engagement_likelihood, share_likelihood, comprehension_score,
           reaction_tags, attitude_score, primary_platform, source
         ) VALUES ($1, $2, $3, $4, $5::vector, $6, $7, $8, $9, $10, $11, $12, 'historical')`,
        [
          resp.persona_id,
          test.id,
          resp.variant_id,
          resp.embedding_values, // already vector type from persona
          conceptVec,
          resp.sentiment_score,
          resp.engagement_likelihood,
          resp.share_likelihood,
          resp.comprehension_score,
          resp.reaction_tags,
          resp.attitude_score,
          resp.primary_platform,
        ]
      );
      totalSeeded++;
    }
  }

  return totalSeeded;
}

// ---------------------------------------------------------------------------
// Backfill utility — embed all personas that lack embeddings
// ---------------------------------------------------------------------------

export async function backfillPersonaEmbeddings(): Promise<number> {
  const result = await query<Persona>(
    `SELECT * FROM personas WHERE embedding_values IS NULL`
  );

  let count = 0;
  for (const persona of result.rows) {
    try {
      const embeddings = await embedPersona(persona);
      await savePersonaEmbeddings(persona.id, embeddings);
      count++;
    } catch (err) {
      console.error(`Failed to embed persona ${persona.id}:`, err);
    }
  }

  return count;
}
