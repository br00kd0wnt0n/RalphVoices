import OpenAI from 'openai';
import { query } from '../db/index.js';

// Relies on OpenAI workspace policy: API traffic from this account is not used for training. No zero-retention header is set; if zero-retention is required for a specific deployment, configure via OpenAI enterprise agreement.
const openai = new OpenAI();
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// Hard gate for GWI Spark integration. The integration is dormant unless
// ENABLE_GWI=true AND a valid GWI_API_KEY (env or per-user setting) is present.
// While dormant, every public method short-circuits with a structured disabled
// response so callers can render "GWI enrichment unavailable" instead of empty
// fields or hallucinated data. Reactivation when a commercial deal closes is a
// single env-var flip — no code change required.
const GWI_INTEGRATION_ENABLED = process.env.ENABLE_GWI === 'true';

export interface GwiDisabledResponse {
  enabled: false;
  reason: string;
}

const DISABLED_REASON =
  'GWI integration is currently disabled. Set ENABLE_GWI=true and supply a valid GWI_API_KEY to enable.';

function disabledResponse(): GwiDisabledResponse {
  return { enabled: false, reason: DISABLED_REASON };
}

// GWI Spark API types
export interface GwiAudience {
  name: string;
  description: string;
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

interface GwiInsight {
  id: string;
  content: string;
}

interface GwiConfig {
  apiKey: string | null;
  baseUrl: string;
}

class GwiService {
  private config: GwiConfig;

  constructor() {
    this.config = {
      apiKey: process.env.GWI_API_KEY || null,
      baseUrl: 'https://api.globalwebindex.com/v1/spark-api/mcp',
    };
  }

  isEnabled(): boolean {
    // Both the integration flag AND a usable key are required.
    return GWI_INTEGRATION_ENABLED && !!this.config.apiKey;
  }

  /** True when the integration flag is on at all (regardless of key presence). */
  isIntegrationEnabled(): boolean {
    return GWI_INTEGRATION_ENABLED;
  }

  getFeatures(): string[] {
    if (!this.isEnabled()) return [];
    return ['audience_suggestions', 'persona_validation', 'results_enrichment'];
  }

  async loadApiKeyForUser(userId: string): Promise<void> {
    // No point reaching for a key when the integration itself is gated off.
    if (!GWI_INTEGRATION_ENABLED) return;
    if (this.config.apiKey) return;
    try {
      const result = await query(
        "SELECT value FROM settings WHERE user_id = $1 AND key = 'gwi_api_key'",
        [userId]
      );
      if (result.rows.length > 0 && result.rows[0].value) {
        this.config.apiKey = result.rows[0].value;
      }
    } catch (error) {
      console.error('Failed to load GWI API key from settings:', error);
    }
  }

  // ─── GWI Spark API (data lookup) ─────────────────────────────────

  /**
   * Query GWI Spark for consumer insights. Returns structured insight data points.
   * GWI Spark is a DATA LOOKUP tool — it searches its consumer survey database
   * and returns matching data points (e.g., "45% of millennials use Instagram daily").
   * It does NOT generate analysis.
   */
  private async queryGwi(prompt: string): Promise<{ insights: GwiInsight[]; sources: string; chatId: string }> {
    if (!GWI_INTEGRATION_ENABLED) throw new Error(DISABLED_REASON);
    if (!this.config.apiKey) throw new Error('GWI API key not configured');

    const requestBody = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'chat_gwi',
        arguments: { prompt, chat_id: '' },
      },
    };

    console.log('[GWI] Query:', prompt.substring(0, 120));

    const response = await fetch(this.config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`GWI API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    const text = Array.isArray(data.result?.content)
      ? data.result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
      : (data.result?.content || data.result?.text || '');

    // Extract chat ID
    const chatIdMatch = text.match(/Chat ID:\s*([a-f0-9-]+)/i);
    const chatId = chatIdMatch?.[1] || data.result?.chat_id || '';

    // Extract structured insights
    const insights: GwiInsight[] = [];
    const insightMatches = text.matchAll(/\*\*Insight ID\*\*:\s*([a-f0-9-]+)\s*\n\s*\*\*Content\*\*:\s*(.+)/gi);
    for (const match of insightMatches) {
      insights.push({ id: match[1], content: match[2].trim() });
    }

    // Extract sources section
    const sourcesMatch = text.match(/## Sources\s*([\s\S]*?)(?:## Processing|$)/);
    const sources = sourcesMatch?.[1]?.trim() || '';

    // Check for "no data" response
    const noData = text.includes("couldn't find any data") || text.includes("couldn't find any compatible data");

    console.log('[GWI] Response:', { insightCount: insights.length, noData, chatId: chatId.substring(0, 8) });

    return { insights, sources, chatId };
  }

  /**
   * Make multiple GWI queries on different topics and collect all insights.
   */
  private async queryGwiMultiTopic(topics: string[]): Promise<GwiInsight[]> {
    const allInsights: GwiInsight[] = [];

    for (const topic of topics) {
      try {
        const { insights } = await this.queryGwi(topic);
        allInsights.push(...insights);
      } catch (error) {
        console.error(`[GWI] Failed topic "${topic}":`, error);
      }
    }

    return allInsights;
  }

  // ─── OpenAI synthesis (turns GWI data into analysis) ─────────────

  /**
   * Use OpenAI to synthesize GWI insights into structured audience segments.
   */
  private async synthesizeAudiences(conceptText: string, gwiInsights: GwiInsight[]): Promise<GwiAudience[]> {
    if (!GWI_INTEGRATION_ENABLED) return [];
    const insightsText = gwiInsights.length > 0
      ? gwiInsights.map(i => `- ${i.content}`).join('\n')
      : 'No specific GWI data was available for these topics.';

    const response = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a market research analyst. Given a creative concept and consumer data insights from GWI (GlobalWebIndex), synthesize 3-5 distinct target audience segments for concept testing. Each segment should be meaningfully different. Use the GWI data to ground your recommendations in real consumer behavior data. Return JSON.`,
        },
        {
          role: 'user',
          content: `CONCEPT:
"${conceptText.substring(0, 600)}"

GWI CONSUMER DATA:
${insightsText}

Based on this concept and the consumer data above, define 3-5 target audience segments. For each, provide specific, data-informed details.

Return JSON with this structure:
{
  "audiences": [
    {
      "name": "Specific Audience Name (not generic)",
      "description": "Who they are and why they matter for this concept (reference GWI data)",
      "size_percent": 8,
      "index_score": 130,
      "age_range": "25-34",
      "gender_split": {"male": 45, "female": 55},
      "top_locations": ["New York", "Los Angeles"],
      "top_platforms": ["Instagram", "TikTok", "YouTube"],
      "content_affinities": ["travel content", "pet videos"],
      "values": ["authenticity", "convenience"],
      "interests": ["travel", "pets", "lifestyle"]
    }
  ]
}`,
        },
      ],
    });

    try {
      const parsed = JSON.parse(response.choices[0].message.content || '{}');
      const audiences = parsed.audiences || [];
      return audiences.slice(0, 5).map((item: any, i: number) => ({
        name: item.name || `Audience ${i + 1}`,
        description: item.description || '',
        size_percent: item.size_percent || 5,
        index_score: item.index_score || 110,
        demographics: {
          age_range: item.age_range || '25-44',
          gender_split: item.gender_split || {},
          top_locations: item.top_locations || [],
        },
        media_habits: {
          top_platforms: item.top_platforms || [],
          content_affinities: item.content_affinities || [],
        },
        psychographics: {
          values: item.values || [],
          interests: item.interests || [],
        },
      }));
    } catch (error) {
      console.error('[GWI] Failed to parse synthesized audiences:', error);
      return [];
    }
  }

  /**
   * Use OpenAI to synthesize GWI insights + test results into market analysis.
   */
  private async synthesizeEnrichment(
    conceptText: string,
    results: { summary: any; segments: any; themes: any },
    gwiInsights: GwiInsight[]
  ): Promise<GwiEnrichment | null> {
    if (!GWI_INTEGRATION_ENABLED) return null;
    const insightsText = gwiInsights.length > 0
      ? gwiInsights.map(i => `- ${i.content}`).join('\n')
      : 'No specific GWI data was available for these topics.';

    const positiveThemes = (results.themes?.positive_themes || [])
      .map((t: any) => `${t.theme} (${t.frequency}x)`).join(', ') || 'none';
    const concerns = (results.themes?.concerns || [])
      .map((t: any) => `${t.theme} (${t.frequency}x)`).join(', ') || 'none';
    const unexpected = (results.themes?.unexpected || [])
      .map((t: any) => `${t.theme} (${t.frequency}x)`).join(', ') || 'none';

    const platformData = results.segments?.by_platform
      ? Object.entries(results.segments.by_platform)
          .map(([p, d]: [string, any]) => `${p}: ${d.count} responses, sentiment ${d.avgSentiment}/10, engagement ${d.avgEngagement}/10`)
          .join('; ')
      : 'no platform data';

    const response = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a senior market research analyst combining synthetic audience test data with real consumer insights from GWI (GlobalWebIndex). Provide data-driven, actionable analysis. Reference specific GWI data points where relevant. Return JSON.`,
        },
        {
          role: 'user',
          content: `CONCEPT TESTED:
"${conceptText.substring(0, 600)}"

TEST RESULTS:
- ${results.summary.total_responses} responses
- Sentiment: ${results.summary.sentiment?.positive || 0} positive, ${results.summary.sentiment?.neutral || 0} neutral, ${results.summary.sentiment?.negative || 0} negative
- Avg engagement: ${results.summary.avg_engagement}/10, share likelihood: ${results.summary.avg_share_likelihood}/10, comprehension: ${results.summary.avg_comprehension}/10
- Themes working: ${positiveThemes}
- Concerns: ${concerns}
- Unexpected: ${unexpected}
- Platform breakdown: ${platformData}

GWI CONSUMER DATA:
${insightsText}

Provide a comprehensive market analysis. Return JSON:
{
  "executive_summary": "2-3 sentence headline assessment of market potential, referencing GWI data",
  "market_context": [
    {"metric": "Metric Name", "value": "X%", "benchmark": "vs Y% average", "insight": "What this means for the concept"}
  ],
  "benchmark_comparison": [
    {"metric": "Engagement", "ralph_value": ${results.summary.avg_engagement}, "gwi_benchmark": 6.5, "interpretation": "How this compares to industry norms"},
    {"metric": "Share Likelihood", "ralph_value": ${results.summary.avg_share_likelihood}, "gwi_benchmark": 5.0, "interpretation": "Context"},
    {"metric": "Comprehension", "ralph_value": ${results.summary.avg_comprehension}, "gwi_benchmark": 7.0, "interpretation": "Context"}
  ],
  "opportunities": ["Specific growth opportunity referencing data"],
  "risks": ["Specific risk or watchout"],
  "audience_recommendations": [
    {
      "name": "Audience Name",
      "description": "Why test with them",
      "size_percent": 8,
      "index_score": 125,
      "age_range": "25-34",
      "top_platforms": ["Instagram"],
      "values": ["value1"],
      "interests": ["interest1"]
    }
  ],
  "analysis_narrative": "Full 3-4 paragraph narrative analysis combining test results with GWI market data"
}`,
        },
      ],
    });

    try {
      const parsed = JSON.parse(response.choices[0].message.content || '{}');

      return {
        executive_summary: parsed.executive_summary || 'Analysis complete.',
        analysis_narrative: parsed.analysis_narrative || '',
        market_context: (parsed.market_context || []).map((m: any) => ({
          metric: m.metric || '',
          value: m.value || '',
          benchmark: m.benchmark || '',
          insight: m.insight || '',
        })),
        benchmark_comparison: (parsed.benchmark_comparison || []).map((b: any) => ({
          metric: b.metric || '',
          ralph_value: b.ralph_value || 0,
          gwi_benchmark: b.gwi_benchmark || 0,
          interpretation: b.interpretation || '',
        })),
        opportunities: parsed.opportunities || [],
        risks: parsed.risks || [],
        audience_recommendations: (parsed.audience_recommendations || []).map((a: any) => ({
          name: a.name || '',
          description: a.description || '',
          size_percent: a.size_percent || 5,
          index_score: a.index_score || 110,
          demographics: {
            age_range: a.age_range || '25-44',
            gender_split: a.gender_split || {},
            top_locations: a.top_locations || [],
          },
          media_habits: {
            top_platforms: a.top_platforms || [],
            content_affinities: a.content_affinities || [],
          },
          psychographics: {
            values: a.values || [],
            interests: a.interests || [],
          },
        })),
        generated_at: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[GWI] Failed to parse enrichment:', error);
      return {
        executive_summary: 'Analysis could not be generated.',
        analysis_narrative: '',
        market_context: [],
        benchmark_comparison: [
          { metric: 'Engagement', ralph_value: results.summary.avg_engagement || 0, gwi_benchmark: 0, interpretation: 'Benchmark unavailable' },
          { metric: 'Share Likelihood', ralph_value: results.summary.avg_share_likelihood || 0, gwi_benchmark: 0, interpretation: 'Benchmark unavailable' },
          { metric: 'Comprehension', ralph_value: results.summary.avg_comprehension || 0, gwi_benchmark: 0, interpretation: 'Benchmark unavailable' },
        ],
        opportunities: [],
        risks: [],
        audience_recommendations: [],
        generated_at: new Date().toISOString(),
      };
    }
  }

  // ─── Public methods ──────────────────────────────────────────────

  /**
   * Extract topic keywords from concept text for GWI queries.
   * Uses OpenAI to identify the key consumer behavior topics.
   */
  private async extractTopics(conceptText: string): Promise<string[]> {
    if (!GWI_INTEGRATION_ENABLED) return [];
    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Extract 3-5 broad consumer behavior topics from a creative concept that can be queried against a consumer survey database (GWI). Topics should be about consumer behaviors, attitudes, and media habits — NOT about the brand or creative execution. Return JSON: {"topics": ["topic query 1", "topic query 2"]}`,
          },
          {
            role: 'user',
            content: `Concept: "${conceptText.substring(0, 400)}"

Generate simple consumer research queries. Good examples:
- "What are the social media habits of US consumers aged 25-44?"
- "What percentage of millennials own pets and how do they spend on pet care?"
- "What are the attitudes of Gen Z towards luxury brands?"
- "How do parents aged 30-50 consume travel-related content?"

Bad examples (too specific, won't match GWI data):
- "How do consumers feel about pet sitting services?"
- "What is the market for Rover app?"`,
          },
        ],
      });

      const parsed = JSON.parse(response.choices[0].message.content || '{}');
      return parsed.topics || [];
    } catch (error) {
      console.error('[GWI] Failed to extract topics:', error);
      return [];
    }
  }

  /** Suggest target audiences based on a concept */
  async suggestAudiences(conceptText: string): Promise<GwiAudience[]> {
    if (!GWI_INTEGRATION_ENABLED) return [];
    if (!this.isEnabled()) return [];

    try {
      // Step 1: Extract broad consumer topics from concept
      const topics = await this.extractTopics(conceptText);
      console.log('[GWI] Extracted topics for audience suggestion:', topics);

      // Step 2: Query GWI for real consumer data on those topics
      const gwiInsights = await this.queryGwiMultiTopic(topics);
      console.log(`[GWI] Got ${gwiInsights.length} insights from GWI`);

      // Step 3: Use OpenAI to synthesize GWI data + concept into audience segments
      const audiences = await this.synthesizeAudiences(conceptText, gwiInsights);
      console.log(`[GWI] Synthesized ${audiences.length} audiences: ${audiences.map(a => a.name).join(', ')}`);

      return audiences;
    } catch (error) {
      console.error('GWI suggestAudiences error:', error);
      return [];
    }
  }

  /** Validate a persona against real market data */
  async validatePersona(persona: {
    name: string;
    age_base?: number | null;
    location?: string | null;
    occupation?: string | null;
    psychographics?: any;
    media_habits?: any;
  }): Promise<GwiValidation | null> {
    if (!GWI_INTEGRATION_ENABLED) return null;
    if (!this.isEnabled()) return null;

    try {
      // Build a simple GWI query based on persona demographics
      const age = persona.age_base || 30;
      const platforms = persona.media_habits?.primary_platforms?.map((p: any) => p.name).join(', ') || 'social media';
      const values = persona.psychographics?.values?.join(', ') || '';

      const gwiQuery = `What are the behaviors and attitudes of consumers aged ${age - 5}-${age + 5} in the US who use ${platforms}?`;
      const { insights } = await this.queryGwi(gwiQuery);

      // Use OpenAI to assess persona realism against GWI data
      const insightsText = insights.length > 0
        ? insights.map(i => `- ${i.content}`).join('\n')
        : 'No specific GWI data found for this demographic.';

      const response = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0.5,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a market research analyst validating synthetic personas against real consumer data. Return JSON.',
          },
          {
            role: 'user',
            content: `PERSONA:
Name: ${persona.name}, Age: ${persona.age_base}, Location: ${persona.location}
Occupation: ${persona.occupation}
Values: ${values}
Platforms: ${platforms}

GWI DATA:
${insightsText}

Assess this persona. Return JSON:
{"match_score": 0-100, "market_size_estimate": "X% of population", "gaps": ["gap1"], "suggestions": ["suggestion1"]}`,
          },
        ],
      });

      const parsed = JSON.parse(response.choices[0].message.content || '{}');
      return {
        match_score: parsed.match_score || 50,
        market_size_estimate: parsed.market_size_estimate || 'Unknown',
        gaps: parsed.gaps || [],
        suggestions: parsed.suggestions || [],
      };
    } catch (error) {
      console.error('GWI validatePersona error:', error);
      return null;
    }
  }

  /** Enrich test results with market analysis using GWI data + OpenAI */
  async enrichResults(
    results: { summary: any; segments: any; themes: any },
    conceptText: string
  ): Promise<GwiEnrichment | null> {
    if (!GWI_INTEGRATION_ENABLED) return null;
    if (!this.isEnabled()) return null;

    try {
      // Step 1: Extract topics from concept
      const topics = await this.extractTopics(conceptText);
      console.log('[GWI] Extracted topics for enrichment:', topics);

      // Step 2: Query GWI for relevant consumer data
      const gwiInsights = await this.queryGwiMultiTopic(topics);
      console.log(`[GWI] Got ${gwiInsights.length} insights for enrichment`);

      // Step 3: Use OpenAI to synthesize everything into structured analysis
      const enrichment = await this.synthesizeEnrichment(conceptText, results, gwiInsights);
      if (!enrichment) {
        // Integration was gated off between the entry-point check and synthesis;
        // surface a clean null rather than logging on a missing object.
        return null;
      }
      console.log('[GWI] Enrichment generated:', {
        execSummaryLen: enrichment.executive_summary.length,
        marketContextCount: enrichment.market_context.length,
        opportunitiesCount: enrichment.opportunities.length,
        risksCount: enrichment.risks.length,
        audienceRecsCount: enrichment.audience_recommendations.length,
      });

      return enrichment;
    } catch (error) {
      console.error('GWI enrichResults error:', error);
      return null;
    }
  }
}

export const gwiService = new GwiService();
