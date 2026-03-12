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
  analysis_narrative: string;
  executive_summary: string;
  market_context: { metric: string; value: string; benchmark: string; insight: string }[];
  benchmark_comparison: { metric: string; ralph_value: number; gwi_benchmark: number; interpretation: string }[];
  audience_recommendations: GwiAudience[];
  opportunities: string[];
  risks: string[];
  generated_at: string;
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

  /** Enrich test results with deep market analysis */
  async enrichResults(
    results: { summary: any; segments: any; themes: any },
    conceptText: string
  ): Promise<GwiEnrichment | null> {
    if (!this.isEnabled()) return null;

    try {
      // Build detailed theme strings
      const positiveThemes = (results.themes?.positive_themes || [])
        .map((t: any) => `${t.theme} (${t.frequency} mentions)`).join(', ') || 'none identified';
      const concerns = (results.themes?.concerns || [])
        .map((t: any) => `${t.theme} (${t.frequency} mentions)`).join(', ') || 'none identified';
      const unexpected = (results.themes?.unexpected || [])
        .map((t: any) => `${t.theme} (${t.frequency} mentions)`).join(', ') || 'none identified';

      // Build platform breakdown
      const platformData = results.segments?.by_platform
        ? Object.entries(results.segments.by_platform)
            .map(([platform, data]: [string, any]) =>
              `${platform}: ${data.count} responses, avg sentiment ${data.avgSentiment}/10, avg engagement ${data.avgEngagement}/10`)
            .join('\n  ')
        : 'no platform data';

      // Build attitude breakdown
      const attitudeData = results.segments?.by_attitude
        ? Object.entries(results.segments.by_attitude)
            .map(([group, data]: [string, any]) =>
              `${group}: ${data.count} responses, avg sentiment ${data.avgSentiment}/10`)
            .join('\n  ')
        : 'no attitude data';

      const prompt = `I ran a concept test using synthetic audience personas and need your deep market analysis. Please provide a comprehensive assessment.

CONCEPT TESTED:
"${conceptText.substring(0, 800)}"

TEST RESULTS:
- Total responses: ${results.summary.total_responses}
- Sentiment: ${results.summary.sentiment?.positive || 0} positive, ${results.summary.sentiment?.neutral || 0} neutral, ${results.summary.sentiment?.negative || 0} negative
- Avg engagement score: ${results.summary.avg_engagement}/10
- Avg share likelihood: ${results.summary.avg_share_likelihood}/10
- Avg comprehension: ${results.summary.avg_comprehension}/10

THEMES IDENTIFIED:
- What's working: ${positiveThemes}
- Concerns: ${concerns}
- Unexpected reactions: ${unexpected}

PLATFORM BREAKDOWN:
  ${platformData}

ATTITUDE SEGMENTS:
  ${attitudeData}

Please provide your analysis in these sections:

1. EXECUTIVE SUMMARY: A 2-3 sentence headline assessment of this concept's market potential.

2. MARKET ALIGNMENT: How does this concept align with current consumer trends and market data? Provide 3-5 specific market metrics or trends with context. For each, state the metric, the current market value/trend, and what it means for this concept.

3. BENCHMARK COMPARISON: Compare the test scores against typical industry benchmarks. For engagement (${results.summary.avg_engagement}/10), share likelihood (${results.summary.avg_share_likelihood}/10), and comprehension (${results.summary.avg_comprehension}/10) — what are typical benchmarks and how does this concept compare? Explain what the gaps mean.

4. OPPORTUNITIES: What 3-5 specific growth opportunities does the data suggest? Be specific about audience segments, channels, or messaging angles.

5. RISKS & WATCHOUTS: What 2-4 market risks or watchouts should be considered based on the concerns and sentiment data?

6. AUDIENCE RECOMMENDATIONS: Suggest 2-3 additional audience segments that should be tested, based on market data. For each provide: name, approximate size %, age range, key platforms, and why they'd be relevant.

Be specific, data-driven, and reference actual market trends where possible.`;

      const { text, chatId } = await this.chat(prompt);
      this.chatSessions.set('enrich', chatId);

      return this.parseDeepEnrichment(text, results.summary);
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

  private parseDeepEnrichment(text: string, summary: any): GwiEnrichment {
    // Extract sections from the narrative
    const execSummary = this.extractSection(text, /executive summary/i, /(?:market alignment|benchmark|2\.)/i);
    const marketSection = this.extractSection(text, /market alignment/i, /(?:benchmark comparison|3\.)/i);
    const benchmarkSection = this.extractSection(text, /benchmark comparison/i, /(?:opportunities|4\.)/i);
    const opportunitiesSection = this.extractSection(text, /opportunities/i, /(?:risks|watchouts|5\.)/i);
    const risksSection = this.extractSection(text, /risks|watchouts/i, /(?:audience recommendations|6\.)/i);
    const audienceSection = this.extractSection(text, /audience recommendations/i, /$/i);

    return {
      analysis_narrative: text,
      executive_summary: execSummary.replace(/^[\s\d\.\:]+/, '').trim() || 'Analysis completed — see full narrative below.',
      market_context: this.parseMarketContext(marketSection),
      benchmark_comparison: this.parseBenchmarkComparison(benchmarkSection, summary),
      audience_recommendations: this.parseAudiencesFromText(audienceSection),
      opportunities: this.extractBulletItems(opportunitiesSection),
      risks: this.extractBulletItems(risksSection),
      generated_at: new Date().toISOString(),
    };
  }

  private extractSection(text: string, startPattern: RegExp, endPattern: RegExp): string {
    const startMatch = text.search(startPattern);
    if (startMatch === -1) return '';

    const afterStart = text.substring(startMatch);
    // Skip the header line
    const contentStart = afterStart.indexOf('\n');
    if (contentStart === -1) return afterStart;

    const content = afterStart.substring(contentStart);
    const endMatch = content.search(endPattern);
    return endMatch > 0 ? content.substring(0, endMatch).trim() : content.trim();
  }

  private parseMarketContext(text: string): { metric: string; value: string; benchmark: string; insight: string }[] {
    const items: { metric: string; value: string; benchmark: string; insight: string }[] = [];
    // Split into items by bullet points, numbered items, or double newlines
    const chunks = text.split(/\n(?=[\-\*\d]|\n)/).filter(c => c.trim().length > 15);

    for (const chunk of chunks.slice(0, 5)) {
      const cleaned = chunk.replace(/^[\s\-\*\d\.]+/, '').trim();
      if (cleaned.length < 10) continue;

      // Try to extract metric name from bold or colon-separated text
      const colonMatch = cleaned.match(/^([^:]+):([\s\S]*)/);
      if (colonMatch) {
        const metric = colonMatch[1].replace(/\*+/g, '').trim();
        const rest = colonMatch[2].trim();
        // Try to find a number as the value
        const numMatch = rest.match(/(\d+[\.\d]*%?)/);
        items.push({
          metric,
          value: numMatch ? numMatch[1] : '',
          benchmark: '',
          insight: rest,
        });
      } else {
        items.push({ metric: cleaned.substring(0, 50), value: '', benchmark: '', insight: cleaned });
      }
    }

    return items;
  }

  private parseBenchmarkComparison(text: string, summary: any): { metric: string; ralph_value: number; gwi_benchmark: number; interpretation: string }[] {
    const benchmarks: { metric: string; ralph_value: number; gwi_benchmark: number; interpretation: string }[] = [];

    // Map Ralph scores
    const ralphScores: Record<string, number> = {
      'Engagement': summary.avg_engagement || 0,
      'Share Likelihood': summary.avg_share_likelihood || 0,
      'Comprehension': summary.avg_comprehension || 0,
    };

    // Parse GWI benchmarks from text — look for numbers near our metric names
    const chunks = text.split(/\n(?=[\-\*\d]|\n)/).filter(c => c.trim().length > 10);

    for (const chunk of chunks) {
      const cleaned = chunk.replace(/^[\s\-\*\d\.]+/, '').trim();
      // Try to match metric name and extract numbers
      for (const [metric, ralphValue] of Object.entries(ralphScores)) {
        if (cleaned.toLowerCase().includes(metric.toLowerCase())) {
          // Find benchmark numbers in text
          const numbers = cleaned.match(/(\d+\.?\d*)/g);
          const gwiBenchmark = numbers ? parseFloat(numbers[numbers.length > 1 ? 1 : 0]) : 0;
          benchmarks.push({
            metric,
            ralph_value: ralphValue,
            gwi_benchmark: gwiBenchmark > 10 ? gwiBenchmark / 10 : gwiBenchmark, // Normalize to 0-10 scale
            interpretation: cleaned,
          });
          delete ralphScores[metric]; // Don't duplicate
          break;
        }
      }
    }

    // Add any remaining metrics that weren't found in text
    for (const [metric, ralphValue] of Object.entries(ralphScores)) {
      benchmarks.push({
        metric,
        ralph_value: ralphValue,
        gwi_benchmark: 0,
        interpretation: 'No benchmark data available from GWI for this metric.',
      });
    }

    return benchmarks;
  }

  private extractBulletItems(text: string): string[] {
    return text
      .split('\n')
      .map(line => line.replace(/^[\s\-\*\d\.]+/, '').trim())
      .filter(line => line.length > 10)
      .slice(0, 6);
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

}

export const gwiService = new GwiService();
