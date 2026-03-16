-- pgvector extension and vector scoring infrastructure

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Multi-facet persona embeddings (text-embedding-3-small = 1536 dims)
ALTER TABLE personas ADD COLUMN IF NOT EXISTS embedding_values vector(1536);
ALTER TABLE personas ADD COLUMN IF NOT EXISTS embedding_platform vector(1536);
ALTER TABLE personas ADD COLUMN IF NOT EXISTS embedding_cultural vector(1536);
ALTER TABLE personas ADD COLUMN IF NOT EXISTS embedding_demographic vector(1536);
ALTER TABLE personas ADD COLUMN IF NOT EXISTS embeddings_updated_at TIMESTAMPTZ;

-- Concept embedding on tests
ALTER TABLE tests ADD COLUMN IF NOT EXISTS concept_embedding vector(1536);
ALTER TABLE tests ADD COLUMN IF NOT EXISTS concept_embedding_updated_at TIMESTAMPTZ;

-- Vector-computed score data stored alongside GPT scores
ALTER TABLE test_responses ADD COLUMN IF NOT EXISTS vector_scores JSONB;

-- Reference anchors: scored persona-concept pairs that calibrate the vector space
CREATE TABLE IF NOT EXISTS reference_anchors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source identifiers (SET NULL on delete — anchors retain value via frozen embeddings)
  persona_id UUID REFERENCES personas(id) ON DELETE SET NULL,
  test_id UUID REFERENCES tests(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES persona_variants(id) ON DELETE SET NULL,

  -- Frozen embedding copies at time of anchoring
  persona_embedding vector(1536) NOT NULL,
  concept_embedding vector(1536) NOT NULL,

  -- Calibrated scores from this pair
  sentiment_score INTEGER CHECK (sentiment_score BETWEEN 1 AND 10),
  engagement_likelihood INTEGER CHECK (engagement_likelihood BETWEEN 1 AND 10),
  share_likelihood INTEGER CHECK (share_likelihood BETWEEN 1 AND 10),
  comprehension_score INTEGER CHECK (comprehension_score BETWEEN 1 AND 10),
  reaction_tags VARCHAR(50)[],

  -- Metadata for weighting
  attitude_score INTEGER,
  primary_platform VARCHAR(100),
  source VARCHAR(50) DEFAULT 'historical',
  confidence REAL DEFAULT 1.0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vector similarity indexes (IVFFlat, lists=10 suitable for <10K rows)
CREATE INDEX IF NOT EXISTS idx_anchors_persona_embedding
  ON reference_anchors USING ivfflat (persona_embedding vector_cosine_ops) WITH (lists = 10);
CREATE INDEX IF NOT EXISTS idx_anchors_concept_embedding
  ON reference_anchors USING ivfflat (concept_embedding vector_cosine_ops) WITH (lists = 10);

-- Standard indexes
CREATE INDEX IF NOT EXISTS idx_anchors_persona_id ON reference_anchors(persona_id);
CREATE INDEX IF NOT EXISTS idx_anchors_test_id ON reference_anchors(test_id);
CREATE INDEX IF NOT EXISTS idx_anchors_source ON reference_anchors(source);
