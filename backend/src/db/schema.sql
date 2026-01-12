-- Ralph Voices Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users (simple for prototype)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Clients/Projects for organization
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  client_name VARCHAR(255),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Core persona templates
CREATE TABLE IF NOT EXISTS personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,

  -- Identity
  age_base INTEGER,
  location VARCHAR(255),
  occupation VARCHAR(255),
  household VARCHAR(255),

  -- Psychographics (stored as JSONB for flexibility)
  psychographics JSONB,

  -- Media & Platform
  media_habits JSONB,

  -- Brand Relationship
  brand_context JSONB,

  -- Cultural Context
  cultural_context JSONB,

  -- Voice Sample (AI-generated example of how they communicate)
  voice_sample TEXT,

  -- Metadata
  source_type VARCHAR(50) DEFAULT 'builder',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Generated variants from core personas
CREATE TABLE IF NOT EXISTS persona_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
  variant_index INTEGER NOT NULL,

  -- Deviation from base persona
  age_actual INTEGER,
  location_variant VARCHAR(255),

  -- Attitude spectrum (1-10, where 1=skeptic, 10=enthusiast)
  attitude_score INTEGER CHECK (attitude_score BETWEEN 1 AND 10),

  -- Platform weighting (which platform they're "native" to)
  primary_platform VARCHAR(100),

  -- Engagement level
  engagement_level VARCHAR(50),

  -- Full variant profile (computed from base + deviations)
  full_profile JSONB,

  -- Generated name for this variant
  variant_name VARCHAR(255),

  created_at TIMESTAMP DEFAULT NOW()
);

-- Test sessions
CREATE TABLE IF NOT EXISTS tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,

  -- Test configuration
  test_type VARCHAR(50) NOT NULL,

  -- Input content
  concept_text TEXT,
  asset_url VARCHAR(500),
  options JSONB,

  -- Panel configuration
  persona_ids UUID[],
  variants_per_persona INTEGER DEFAULT 20,

  -- Variant generation settings
  variant_config JSONB,

  -- Status
  status VARCHAR(50) DEFAULT 'draft',

  -- Progress tracking
  responses_completed INTEGER DEFAULT 0,
  responses_total INTEGER DEFAULT 0,

  -- Metadata
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Individual variant responses
CREATE TABLE IF NOT EXISTS test_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID REFERENCES tests(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES persona_variants(id) ON DELETE CASCADE,

  -- Response content
  response_text TEXT NOT NULL,

  -- Structured scores (1-10 scale)
  sentiment_score INTEGER CHECK (sentiment_score BETWEEN 1 AND 10),
  engagement_likelihood INTEGER CHECK (engagement_likelihood BETWEEN 1 AND 10),
  share_likelihood INTEGER CHECK (share_likelihood BETWEEN 1 AND 10),
  comprehension_score INTEGER CHECK (comprehension_score BETWEEN 1 AND 10),

  -- Quick reaction tags (AI-extracted)
  reaction_tags VARCHAR(50)[],

  -- For A/B tests
  preferred_option VARCHAR(50),

  -- Processing metadata
  processing_time_ms INTEGER,
  model_used VARCHAR(100),

  created_at TIMESTAMP DEFAULT NOW()
);

-- Aggregated test results (computed after all responses)
CREATE TABLE IF NOT EXISTS test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID REFERENCES tests(id) ON DELETE CASCADE,

  -- Aggregated metrics
  summary JSONB,

  -- Segment breakdowns
  segments JSONB,

  -- Extracted themes
  themes JSONB,

  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_personas_project ON personas(project_id);
CREATE INDEX IF NOT EXISTS idx_variants_persona ON persona_variants(persona_id);
CREATE INDEX IF NOT EXISTS idx_tests_project ON tests(project_id);
CREATE INDEX IF NOT EXISTS idx_responses_test ON test_responses(test_id);
CREATE INDEX IF NOT EXISTS idx_responses_variant ON test_responses(variant_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_tests_status ON tests(status);
