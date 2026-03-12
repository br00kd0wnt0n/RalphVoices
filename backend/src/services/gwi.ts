import { query } from '../db/index.js';

// GWI Spark API types
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

interface GwiConfig {
  apiKey: string | null;
  baseUrl: string;
}

class GwiService {
  private config: GwiConfig;
  private chatSessions: Map<string, string>; // context_id -> chat_id

  constructor() {
    this.config = {
      apiKey: process.env.GWI_API_KEY || null,
      baseUrl: 'https://api.globalwebindex.com/v1/spark-api/mcp',
    };
    this.chatSessions = new Map();
  }

  /** Check if GWI is available (has API key) */
  isEnabled(): boolean {
    return !!this.config.apiKey;
  }

  /** Get enabled features based on configuration */
  getFeatures(): string[] {
    if (!this.isEnabled()) return [];
    return ['audience_suggestions', 'persona_validation', 'results_enrichment'];
  }

  /** Try loading API key from DB settings for a specific user */
  async loadApiKeyForUser(userId: string): Promise<void> {
    if (this.config.apiKey) return; // env var takes precedence

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

  /** Core JSON-RPC call to GWI Spark API */
  private async chat(prompt: string, chatId?: string): Promise<{ text: string; chatId: string }> {
    if (!this.config.apiKey) {
      throw new Error('GWI API key not configured');
    }

    const requestBody = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'chat_gwi',
        arguments: {
          prompt,
          chat_id: chatId || '',
        },
      },
    };

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

    // Extract text from JSON-RPC response
    const resultContent = data.result?.content;
    let text = '';
    let newChatId = chatId || '';

    if (Array.isArray(resultContent)) {
      text = resultContent
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    } else if (typeof resultContent === 'string') {
      text = resultContent;
    } else if (data.result?.text) {
      text = data.result.text;
    }

    // Try to extract chat_id for maintaining conversation context
    if (data.result?.chat_id) {
      newChatId = data.result.chat_id;
    }

    return { text, chatId: newChatId };
  }

  /** Suggest target audiences based on a concept */
  async suggestAudiences(conceptText: string): Promise<GwiAudience[]> {
    if (!this.isEnabled()) return [];

    try {
      const prompt = `Based on this creative concept, suggest 3-5 target audience segments that would be most receptive to it. For each audience, provide:
- A descriptive name
- Approximate audience size as a percentage
- An index score (100 = average, higher = more likely to engage)
- Age range
- Top social media platforms they use
- Key values and interests

Concept: "${conceptText.substring(0, 500)}"

Please structure your response clearly with each audience segment separated.`;

      const { text, chatId } = await this.chat(prompt);
      this.chatSessions.set('suggest', chatId);

      return this.parseAudiencesFromText(text);
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
    if (!this.isEnabled()) return null;

    try {
      const prompt = `I'm building a synthetic persona for audience testing. Please validate this persona against real market data and tell me how realistic it is:

Name: ${persona.name}
Age: ${persona.age_base || 'not specified'}
Location: ${persona.location || 'not specified'}
Occupation: ${persona.occupation || 'not specified'}
Values: ${persona.psychographics?.values?.join(', ') || 'not specified'}
Platforms: ${persona.media_habits?.primary_platforms?.map((p: any) => p.name).join(', ') || 'not specified'}

Please assess:
1. How well does this match a real audience segment? (score 0-100)
2. What is the approximate market size for this type of person?
3. Are there any gaps or inconsistencies in the profile?
4. What suggestions would you make to improve it?`;

      const { text } = await this.chat(prompt);
      return this.parseValidationFromText(text);
    } catch (error) {
      console.error('GWI validatePersona error:', error);
      return null;
    }
  }

  /** Enrich test results with market context */
  async enrichResults(
    results: { summary: any; segments: any; themes: any },
    conceptText: string
  ): Promise<GwiEnrichment | null> {
    if (!this.isEnabled()) return null;

    try {
      const prompt = `I ran a concept test with synthetic personas and got these results. Please provide market context and recommendations:

Concept: "${conceptText.substring(0, 300)}"

Results Summary:
- Total responses: ${results.summary.total_responses}
- Positive sentiment: ${results.summary.sentiment?.positive || 0}
- Neutral: ${results.summary.sentiment?.neutral || 0}
- Negative: ${results.summary.sentiment?.negative || 0}
- Avg engagement: ${results.summary.avg_engagement}/10
- Avg share likelihood: ${results.summary.avg_share_likelihood}/10

Please provide:
1. Market context - how does this concept relate to current market trends?
2. Audience recommendations - what other audience segments should be tested?
3. Benchmark comparison - how do these metrics compare to typical industry benchmarks?`;

      const { text } = await this.chat(prompt);
      return this.parseEnrichmentFromText(text);
    } catch (error) {
      console.error('GWI enrichResults error:', error);
      return null;
    }
  }

  // --- Parsing helpers ---

  private parseAudiencesFromText(text: string): GwiAudience[] {
    const audiences: GwiAudience[] = [];

    // Split by numbered sections or double newlines
    const sections = text.split(/(?:\n\n|\n(?=\d+[\.\)]))/);

    for (const section of sections) {
      if (section.trim().length < 20) continue;

      try {
        const audience: GwiAudience = {
          name: this.extractField(section, /(?:name|segment|audience)[:\s]*([^\n]+)/i) || `Audience ${audiences.length + 1}`,
          size_percent: this.extractNumber(section, /(?:size|percentage|%)[:\s]*(\d+\.?\d*)/i) || 5,
          index_score: this.extractNumber(section, /(?:index)[:\s]*(\d+)/i) || 110,
          demographics: {
            age_range: this.extractField(section, /(?:age|age range)[:\s]*([^\n,]+)/i) || '25-44',
            gender_split: {},
            top_locations: this.extractList(section, /(?:location|region|market)[:\s]*([^\n]+)/i),
          },
          media_habits: {
            top_platforms: this.extractList(section, /(?:platform|social media|social)[:\s]*([^\n]+)/i),
            content_affinities: this.extractList(section, /(?:content|interests|affini)[:\s]*([^\n]+)/i),
          },
          psychographics: {
            values: this.extractList(section, /(?:values|value)[:\s]*([^\n]+)/i),
            interests: this.extractList(section, /(?:interests|interest|hobbies)[:\s]*([^\n]+)/i),
          },
        };

        // Only add if we got at least a meaningful name
        if (audience.name.length > 3) {
          audiences.push(audience);
        }
      } catch {
        // Skip unparseable sections
      }
    }

    // If parsing failed, create a single generic audience from the full text
    if (audiences.length === 0 && text.length > 50) {
      audiences.push({
        name: 'Primary Target Audience',
        size_percent: 10,
        index_score: 120,
        demographics: { age_range: '18-44', gender_split: {}, top_locations: [] },
        media_habits: { top_platforms: ['Instagram', 'TikTok'], content_affinities: [] },
        psychographics: { values: [], interests: [] },
      });
    }

    return audiences.slice(0, 5); // Max 5 audiences
  }

  private parseValidationFromText(text: string): GwiValidation {
    return {
      match_score: this.extractNumber(text, /(?:score|match|rating)[:\s]*(\d+)/i) || 50,
      market_size_estimate: this.extractField(text, /(?:market size|size|population)[:\s]*([^\n]+)/i) || 'Data unavailable',
      gaps: this.extractBulletPoints(text, /(?:gap|inconsisten|missing)[:\s]*/i),
      suggestions: this.extractBulletPoints(text, /(?:suggest|recommend|improv)[:\s]*/i),
    };
  }

  private parseEnrichmentFromText(text: string): GwiEnrichment {
    return {
      market_context: this.extractKeyValuePairs(text, /(?:market|trend|context)/i),
      audience_recommendations: [], // Would need a follow-up query for full audience details
      benchmark_comparison: this.extractBenchmarks(text),
    };
  }

  private extractField(text: string, pattern: RegExp): string {
    const match = text.match(pattern);
    return match?.[1]?.trim() || '';
  }

  private extractNumber(text: string, pattern: RegExp): number {
    const match = text.match(pattern);
    return match ? parseFloat(match[1]) : 0;
  }

  private extractList(text: string, pattern: RegExp): string[] {
    const match = text.match(pattern);
    if (!match?.[1]) return [];
    return match[1].split(/[,;]/).map(s => s.trim()).filter(s => s.length > 1);
  }

  private extractBulletPoints(text: string, sectionPattern: RegExp): string[] {
    const sectionMatch = text.match(new RegExp(sectionPattern.source + '([\\s\\S]*?)(?=\\n\\n|$)', 'i'));
    if (!sectionMatch?.[1]) return [];

    return sectionMatch[1]
      .split('\n')
      .map(line => line.replace(/^[\s\-\*\d\.]+/, '').trim())
      .filter(line => line.length > 5)
      .slice(0, 5);
  }

  private extractKeyValuePairs(text: string, sectionPattern: RegExp): { metric: string; value: string; benchmark: string }[] {
    const pairs: { metric: string; value: string; benchmark: string }[] = [];
    const lines = text.split('\n').filter(l => l.includes(':') || l.includes('-'));

    for (const line of lines.slice(0, 5)) {
      const parts = line.split(/[:\-]/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        pairs.push({ metric: parts[0], value: parts[1], benchmark: parts[2] || '' });
      }
    }

    return pairs;
  }

  private extractBenchmarks(text: string): { metric: string; ralph_value: number; gwi_benchmark: number }[] {
    const benchmarks: { metric: string; ralph_value: number; gwi_benchmark: number }[] = [];
    const numbers = text.match(/\d+\.?\d*/g);

    // Simple extraction — real implementation would use structured GWI response
    if (numbers && numbers.length >= 2) {
      benchmarks.push(
        { metric: 'Engagement Rate', ralph_value: 0, gwi_benchmark: parseFloat(numbers[0]) },
        { metric: 'Share Rate', ralph_value: 0, gwi_benchmark: parseFloat(numbers[1]) },
      );
    }

    return benchmarks;
  }
}

export const gwiService = new GwiService();
