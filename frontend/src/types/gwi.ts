export interface GwiAudience {
  name: string;
  description?: string;
  size_percent: number;
  index_score: number;
  demographics: {
    age_range: string;
    gender_split: Record<string, number>;
    top_locations: string[];
  };
  media_habits: {
    top_platforms: string[];
    content_affinities: string[];
  };
  psychographics: {
    values: string[];
    interests: string[];
  };
}

export interface GwiValidation {
  match_score: number;
  market_size_estimate: string;
  gaps: string[];
  suggestions: string[];
}

export interface GwiEnrichment {
  analysis_narrative: string;
  executive_summary: string;
  market_context: { metric: string; value: string; benchmark: string; insight: string }[];
  benchmark_comparison: { metric: string; ralph_value: number; gwi_benchmark: number; interpretation: string }[];
  audience_recommendations: GwiAudience[];
  opportunities: string[];
  risks: string[];
  generated_at: string;
}
