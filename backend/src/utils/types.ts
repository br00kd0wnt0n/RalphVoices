export interface User {
  id: string;
  email: string;
  name: string | null;
  created_at: Date;
}

export interface Project {
  id: string;
  name: string;
  client_name: string | null;
  created_by: string;
  created_at: Date;
}

export interface Psychographics {
  values: string[];
  motivations: string[];
  aspirations: string[];
  pain_points: string[];
  decision_style: string;
}

export interface MediaHabits {
  primary_platforms: { name: string; hours_per_day: number }[];
  content_preferences: string[];
  influencer_affinities: string[];
  news_sources: string[];
}

export interface BrandContext {
  category_engagement: string;
  brand_awareness: string;
  purchase_drivers: string[];
  competitor_preferences: string[];
}

export interface CulturalContext {
  subcultures: string[];
  trending_interests: string[];
  humor_style: string;
  language_markers: string[];
}

export interface Persona {
  id: string;
  project_id: string;
  name: string;
  age_base: number | null;
  location: string | null;
  occupation: string | null;
  household: string | null;
  psychographics: Psychographics | null;
  media_habits: MediaHabits | null;
  brand_context: BrandContext | null;
  cultural_context: CulturalContext | null;
  voice_sample: string | null;
  source_type: 'builder' | 'brief' | 'data_import';
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface PersonaVariant {
  id: string;
  persona_id: string;
  variant_index: number;
  age_actual: number | null;
  location_variant: string | null;
  attitude_score: number | null;
  primary_platform: string | null;
  engagement_level: 'heavy' | 'moderate' | 'light' | 'lapsed' | null;
  full_profile: any;
  variant_name: string | null;
  created_at: Date;
}

export interface VariantConfig {
  age_spread: number;
  attitude_distribution: 'normal' | 'skew_positive' | 'skew_negative';
  platforms_to_include: string[];
}

export interface Test {
  id: string;
  project_id: string;
  name: string;
  test_type: 'concept' | 'asset' | 'strategic' | 'ab';
  concept_text: string | null;
  asset_url: string | null;
  options: any | null;
  persona_ids: string[];
  variants_per_persona: number;
  variant_config: VariantConfig | null;
  status: 'draft' | 'running' | 'complete' | 'failed';
  responses_completed: number;
  responses_total: number;
  created_by: string;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface TestResponse {
  id: string;
  test_id: string;
  variant_id: string;
  response_text: string;
  sentiment_score: number | null;
  engagement_likelihood: number | null;
  share_likelihood: number | null;
  comprehension_score: number | null;
  reaction_tags: string[] | null;
  preferred_option: string | null;
  processing_time_ms: number | null;
  model_used: string | null;
  created_at: Date;
}

export interface TestResultsSummary {
  total_responses: number;
  sentiment: { positive: number; neutral: number; negative: number };
  avg_engagement: number;
  avg_share_likelihood: number;
  avg_comprehension: number;
}

export interface TestResultsSegments {
  by_age: Record<string, any>;
  by_platform: Record<string, any>;
  by_attitude: Record<string, any>;
}

export interface TestResultsThemes {
  positive_themes: { theme: string; frequency: number }[];
  concerns: { theme: string; frequency: number }[];
  unexpected: { theme: string; frequency: number }[];
}

export interface TestResults {
  id: string;
  test_id: string;
  summary: TestResultsSummary;
  segments: TestResultsSegments;
  themes: TestResultsThemes;
  created_at: Date;
}

export type ReactionTag =
  | 'excited'
  | 'intrigued'
  | 'confused'
  | 'skeptical'
  | 'amused'
  | 'bored'
  | 'annoyed'
  | 'inspired'
  | 'would_share'
  | 'would_ignore'
  | 'needs_more_info'
  | 'feels_authentic'
  | 'feels_forced'
  | 'seen_before'
  | 'fresh_take';
