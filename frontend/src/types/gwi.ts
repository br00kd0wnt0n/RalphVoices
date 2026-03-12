export interface GwiAudience {
  name: string;
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
  market_context: { metric: string; value: string; benchmark: string }[];
  audience_recommendations: GwiAudience[];
  benchmark_comparison: { metric: string; ralph_value: number; gwi_benchmark: number }[];
}
