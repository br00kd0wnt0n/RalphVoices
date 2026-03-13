import { query } from '../db/index.js';

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

    console.log('[GWI] Sending request:', { prompt: prompt.substring(0, 100) + '...', chatId: chatId || '(new)' });

    const response = await fetch(this.config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`GWI API error: ${response.status} ${response.statusText} — ${errorText}`);
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

    // Try to extract chat_id from the JSON-RPC result metadata
    if (data.result?.chat_id) {
      newChatId = data.result.chat_id;
    }

    // Also try to extract chat_id from the response text body (GWI embeds it)
    if (!newChatId || newChatId === chatId) {
      const chatIdMatch = text.match(/Chat ID:\s*([a-f0-9-]+)/i);
      if (chatIdMatch) {
        newChatId = chatIdMatch[1];
      }
    }

    console.log('[GWI] Response received:', {
      textLength: text.length,
      chatId: newChatId,
      isTemplate: this.isTemplateResponse(text),
      preview: text.substring(0, 200).replace(/\n/g, ' '),
    });

    return { text, chatId: newChatId };
  }

  /**
   * Detect if GWI returned a template/boilerplate response with no actual data.
   * The GWI Spark MCP API often returns a wrapper with Chat ID and "Processing Instructions"
   * but no real analysis on the first call — requiring follow-up calls.
   */
  private isTemplateResponse(text: string): boolean {
    const hasProcessingInstructions = text.includes('Processing Instructions');
    const hasChatId = /Chat ID:/i.test(text);
    const hasExploreInsight = text.includes('explore_insight_gwi');
    const hasMainResponse = text.includes('## Main Response');

    // Check if there's meaningful content between "Main Response" and "Sources"
    const mainResponseMatch = text.match(/## Main Response\s*([\s\S]*?)(?:## Sources|## Processing|$)/);
    const mainContent = mainResponseMatch?.[1]?.replace(/Chat ID:\s*[a-f0-9-]+/gi, '').trim() || '';

    // Template response: has wrapper structure but the actual content is empty/minimal
    if ((hasProcessingInstructions || hasExploreInsight) && mainContent.length < 50) {
      return true;
    }
    if (hasMainResponse && hasChatId && mainContent.length < 50) {
      return true;
    }

    return false;
  }

  /**
   * Extract the actual content from a GWI response, stripping boilerplate.
   * GWI responses may include: headers, Chat IDs, Sources sections, Processing Instructions.
   * We want just the analytical content.
   */
  private extractGwiContent(text: string): string {
    // Try to extract content from "Main Response" section
    const mainMatch = text.match(/## Main Response\s*([\s\S]*?)(?:## Sources|## Processing Instructions|$)/);
    if (mainMatch) {
      const content = mainMatch[1]
        .replace(/Chat ID:\s*[a-f0-9-]+/gi, '')
        .replace(/# Data Analysis Result[\s\S]*?(?=\n[^#\-\n])/i, '')
        .trim();
      if (content.length > 50) return content;
    }

    // Strip known boilerplate sections
    let cleaned = text
      .replace(/# Data Analysis Result[\s\S]*?(?=\n\n)/i, '')
      .replace(/## Sources[\s\S]*?(?=##|$)/i, '')
      .replace(/## Processing Instructions[\s\S]*$/i, '')
      .replace(/Chat ID:\s*[a-f0-9-]+/gi, '')
      .replace(/The following data contains structured information[\s\S]*?(?=\n\n)/i, '')
      .replace(/- The main response provides[\s\S]*?(?=\n\n)/i, '')
      .trim();

    return cleaned || text;
  }

  /**
   * Make a GWI call with automatic follow-up if the first response is a template.
   * The GWI Spark API often needs a second turn to provide actual data.
   */
  private async chatWithFollowUp(
    initialPrompt: string,
    followUpPrompt: string,
    contextKey: string
  ): Promise<{ text: string; chatId: string }> {
    // First call
    const first = await this.chat(initialPrompt);

    // If we got meaningful content, return it
    if (!this.isTemplateResponse(first.text)) {
      const content = this.extractGwiContent(first.text);
      if (content.length > 100) {
        return { text: content, chatId: first.chatId };
      }
    }

    console.log(`[GWI] First response was template/empty for "${contextKey}", making follow-up call with chat_id: ${first.chatId}`);

    // Follow-up call using the chat_id from the first response
    if (first.chatId) {
      const second = await this.chat(followUpPrompt, first.chatId);
      const content = this.extractGwiContent(second.text);

      // If second response is also template, try one more specific ask
      if (this.isTemplateResponse(second.text) || content.length < 100) {
        console.log(`[GWI] Second response also template for "${contextKey}", trying direct ask`);
        const third = await this.chat(
          'Please provide your analysis now. Give me the specific data, insights, and recommendations based on what I shared. Do not return metadata or processing instructions — I need the actual analysis content.',
          second.chatId || first.chatId
        );
        return { text: this.extractGwiContent(third.text), chatId: third.chatId };
      }

      return { text: content, chatId: second.chatId };
    }

    // No chat_id available, return what we have
    return { text: this.extractGwiContent(first.text), chatId: first.chatId };
  }

  /** Suggest target audiences based on a concept */
  async suggestAudiences(conceptText: string): Promise<GwiAudience[]> {
    if (!this.isEnabled()) return [];

    try {
      const initialPrompt = `I need to identify target audience segments for concept testing. Here is the creative concept:

"${conceptText.substring(0, 500)}"

What are the key audience segments that would be most relevant to test this concept against? I need demographic, psychographic, and media consumption data for each segment.`;

      const followUpPrompt = `Based on the concept I just shared, please give me 3-5 distinctly different target audience segments. For each one, provide:
- A specific name (not generic — e.g., "Urban Pet-Owning Millennials" not "Young Adults")
- A description of who they are and why they'd be relevant
- Size as % of population
- An engagement index score (100 = average)
- Age range (e.g., "25-34")
- Top locations/regions
- Top social media platforms they use
- Content types they consume
- Core values
- Key interests

Please format as a JSON array with this structure:
[{"name":"...", "description":"...", "size_percent":8, "index_score":130, "age_range":"25-34", "top_locations":["..."], "top_platforms":["..."], "content_affinities":["..."], "values":["..."], "interests":["..."]}]

Return ONLY the JSON array.`;

      const { text, chatId } = await this.chatWithFollowUp(initialPrompt, followUpPrompt, 'suggest-audiences');
      this.chatSessions.set('suggest', chatId);

      const audiences = this.parseAudiencesResponse(text);
      console.log(`[GWI] Parsed ${audiences.length} audiences, names: ${audiences.map(a => a.name).join(', ')}`);
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
    if (!this.isEnabled()) return null;

    try {
      const initialPrompt = `I'm validating a synthetic persona against real market data. The persona is:

Name: ${persona.name}
Age: ${persona.age_base || 'not specified'}
Location: ${persona.location || 'not specified'}
Occupation: ${persona.occupation || 'not specified'}
Values: ${persona.psychographics?.values?.join(', ') || 'not specified'}
Platforms: ${persona.media_habits?.primary_platforms?.map((p: any) => p.name).join(', ') || 'not specified'}

How realistic is this persona compared to actual audience data?`;

      const followUpPrompt = `For the persona I just described, please assess:
1. Realism score (0-100) — how well does this match real audience segments?
2. Approximate market size for this type of person
3. Any gaps or inconsistencies in the profile
4. Specific suggestions to make it more realistic

Please be specific and reference actual data where possible.`;

      const { text } = await this.chatWithFollowUp(initialPrompt, followUpPrompt, 'validate-persona');
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

      // Step 1: Share the data with GWI
      const dataPrompt = `I ran a creative concept test and need market analysis. Here are my results:

CONCEPT: "${conceptText.substring(0, 600)}"

RESULTS:
- ${results.summary.total_responses} total responses
- Sentiment: ${results.summary.sentiment?.positive || 0} positive, ${results.summary.sentiment?.neutral || 0} neutral, ${results.summary.sentiment?.negative || 0} negative
- Avg engagement: ${results.summary.avg_engagement}/10
- Avg share likelihood: ${results.summary.avg_share_likelihood}/10
- Avg comprehension: ${results.summary.avg_comprehension}/10

THEMES: Working: ${positiveThemes}. Concerns: ${concerns}. Unexpected: ${unexpected}.

PLATFORMS: ${platformData}

ATTITUDES: ${attitudeData}

What does this data tell us about market potential?`;

      // Step 2: Ask for structured analysis
      const analysisPrompt = `Based on the concept test data I just shared, please provide a structured market analysis:

1. EXECUTIVE SUMMARY: 2-3 sentence headline assessment of market potential.

2. MARKET ALIGNMENT: 3-5 specific market metrics or consumer trends that are relevant. For each: the metric name, its current value/trend, and what it means for this concept.

3. BENCHMARK COMPARISON: How do these scores compare to industry benchmarks?
   - Engagement: ${results.summary.avg_engagement}/10
   - Share Likelihood: ${results.summary.avg_share_likelihood}/10
   - Comprehension: ${results.summary.avg_comprehension}/10
   What are typical benchmarks and how does this compare?

4. OPPORTUNITIES: 3-5 specific growth opportunities (audience segments, channels, messaging angles).

5. RISKS: 2-4 market risks or watchouts based on the concern themes.

6. AUDIENCE RECOMMENDATIONS: 2-3 additional audience segments to test. For each: name, size %, age range, platforms, and why relevant.

Please provide detailed, data-driven analysis. Do not return metadata or processing instructions.`;

      const { text, chatId } = await this.chatWithFollowUp(dataPrompt, analysisPrompt, 'enrich-results');
      this.chatSessions.set('enrich', chatId);

      const enrichment = this.parseDeepEnrichment(text, results.summary);
      console.log('[GWI] Enrichment parsed:', {
        execSummaryLength: enrichment.executive_summary.length,
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

  // --- Parsing helpers ---

  /** Parse audiences from JSON response (preferred) with fallback to text parsing */
  private parseAudiencesResponse(text: string): GwiAudience[] {
    // Try JSON parsing first
    try {
      // Extract JSON array from response (may have surrounding text)
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.slice(0, 5).map((item: any, i: number) => ({
            name: item.name || `Audience ${i + 1}`,
            description: item.description || '',
            size_percent: item.size_percent || 5,
            index_score: item.index_score || 110,
            demographics: {
              age_range: item.age_range || item.demographics?.age_range || '25-44',
              gender_split: item.gender_split || item.demographics?.gender_split || {},
              top_locations: item.top_locations || item.demographics?.top_locations || [],
            },
            media_habits: {
              top_platforms: item.top_platforms || item.media_habits?.top_platforms || [],
              content_affinities: item.content_affinities || item.media_habits?.content_affinities || [],
            },
            psychographics: {
              values: item.values || item.psychographics?.values || [],
              interests: item.interests || item.psychographics?.interests || [],
            },
          }));
        }
      }
    } catch {
      // JSON parsing failed, fall through to text parsing
      console.log('[GWI] JSON parsing failed for audiences, falling back to text parsing');
    }

    return this.parseAudiencesFromText(text);
  }

  private parseAudiencesFromText(text: string): GwiAudience[] {
    const audiences: GwiAudience[] = [];

    // Try splitting by numbered items (1. 2. 3.) or by ### headers or **bold names**
    const sections = text.split(/(?:\n(?=\d+[\.\)])|(?:\n(?=###))|(?:\n(?=\*\*[A-Z])))/);

    for (const section of sections) {
      if (section.trim().length < 30) continue;

      try {
        // Try extracting name from bold text, headers, or numbered format
        const namePatterns = [
          /(?:###?\s*)(.+?)(?:\n|$)/,
          /\*\*(.+?)\*\*/,
          /(?:name|segment|audience)[:\s]*(.+?)(?:\n|$)/i,
          /^\d+[\.\)]\s*(.+?)(?:\n|:)/,
        ];

        let name = '';
        for (const pattern of namePatterns) {
          const match = section.match(pattern);
          if (match?.[1] && match[1].trim().length > 3 && match[1].trim().length < 80) {
            name = match[1].replace(/\*+/g, '').trim();
            break;
          }
        }

        if (!name || name.length < 4) continue;

        const audience: GwiAudience = {
          name,
          description: this.extractField(section, /(?:description|about|who|why|rationale)[:\s]*(.+?)(?:\n|$)/i)
            || this.extractFirstSentenceAfterName(section, name),
          size_percent: this.extractNumber(section, /(?:size|percentage|population)[:\s]*~?(\d+\.?\d*)%?/i) || 5,
          index_score: this.extractNumber(section, /(?:index|engagement)[:\s]*(\d+)/i) || 110,
          demographics: {
            age_range: this.extractField(section, /(?:age(?:\s*range)?)[:\s]*([^\n,;]+)/i) || '25-44',
            gender_split: this.extractGenderSplit(section),
            top_locations: this.extractListFromSection(section, /(?:location|region|market|geograph)[:\s]*(.+)/i),
          },
          media_habits: {
            top_platforms: this.extractListFromSection(section, /(?:platform|social media|social|channels)[:\s]*(.+)/i),
            content_affinities: this.extractListFromSection(section, /(?:content|affini|consume|media type)[:\s]*(.+)/i),
          },
          psychographics: {
            values: this.extractListFromSection(section, /(?:values?)[:\s]*(.+)/i),
            interests: this.extractListFromSection(section, /(?:interests?|hobbies)[:\s]*(.+)/i),
          },
        };

        // Only add if name is unique and meaningful
        if (!audiences.some(a => a.name === audience.name)) {
          audiences.push(audience);
        }
      } catch {
        // Skip unparseable sections
      }
    }

    // If text parsing yielded nothing, try a simpler paragraph-based approach
    if (audiences.length === 0) {
      const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 50);
      for (let i = 0; i < Math.min(paragraphs.length, 5); i++) {
        const p = paragraphs[i];
        const boldMatch = p.match(/\*\*(.+?)\*\*/);
        const name = boldMatch?.[1] || `Audience ${i + 1}`;
        if (name.length > 3 && !audiences.some(a => a.name === name)) {
          audiences.push({
            name,
            description: p.replace(/\*\*.*?\*\*/, '').substring(0, 200).trim(),
            size_percent: this.extractNumber(p, /(\d+)%/i) || 5,
            index_score: this.extractNumber(p, /index[:\s]*(\d+)/i) || 110,
            demographics: {
              age_range: this.extractField(p, /(\d{2}\s*-\s*\d{2})/) || '25-44',
              gender_split: {},
              top_locations: this.extractListFromSection(p, /(?:location|region)[:\s]*(.+)/i),
            },
            media_habits: {
              top_platforms: this.extractListFromSection(p, /(?:platform|social|channel)[:\s]*(.+)/i),
              content_affinities: [],
            },
            psychographics: {
              values: [],
              interests: this.extractListFromSection(p, /(?:interest|hobbies)[:\s]*(.+)/i),
            },
          });
        }
      }
    }

    // Last resort: create a single generic audience
    if (audiences.length === 0 && text.length > 50) {
      console.log('[GWI] All audience parsing failed, creating generic fallback');
      audiences.push({
        name: 'Primary Target Audience',
        description: 'A broad audience segment most likely to engage with this concept.',
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
      match_score: this.extractNumber(text, /(?:score|match|rating|realism)[:\s]*(\d+)/i) || 50,
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

    // Clean up the executive summary — strip markdown/numbering
    let cleanExecSummary = execSummary
      .replace(/^[\s\d\.\:\#\*]+/, '')
      .replace(/\*\*/g, '')
      .trim();

    // If parsing didn't find structured sections, try to extract from the full text
    if (!cleanExecSummary && text.length > 100) {
      // Take the first meaningful paragraph as executive summary
      const paragraphs = text.split(/\n\n+/).filter(p => {
        const cleaned = p.replace(/[#*\-\d\.]/g, '').trim();
        return cleaned.length > 30 && !cleaned.includes('Processing Instructions') && !cleaned.includes('Chat ID');
      });
      cleanExecSummary = paragraphs[0]?.replace(/^[\s\d\.\:\#\*]+/, '').replace(/\*\*/g, '').trim() || '';
    }

    return {
      analysis_narrative: text,
      executive_summary: cleanExecSummary || 'GWI analysis data was not available for this concept. Try running the analysis again.',
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
    if (!text || text.length < 20) return items;

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
          insight: rest.replace(/\*+/g, ''),
        });
      } else if (cleaned.length > 20) {
        items.push({ metric: cleaned.substring(0, 50).replace(/\*+/g, ''), value: '', benchmark: '', insight: cleaned.replace(/\*+/g, '') });
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

    if (!text || text.length < 20) {
      // No benchmark section found — return defaults
      for (const [metric, ralphValue] of Object.entries(ralphScores)) {
        benchmarks.push({
          metric,
          ralph_value: ralphValue,
          gwi_benchmark: 0,
          interpretation: 'Benchmark data not available from GWI.',
        });
      }
      return benchmarks;
    }

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
            interpretation: cleaned.replace(/\*+/g, ''),
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
        interpretation: 'Benchmark data not available from GWI.',
      });
    }

    return benchmarks;
  }

  private extractBulletItems(text: string): string[] {
    if (!text || text.length < 10) return [];
    return text
      .split('\n')
      .map(line => line.replace(/^[\s\-\*\d\.]+/, '').replace(/\*+/g, '').trim())
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

  /** Extract a comma-separated list from a section of text */
  private extractListFromSection(text: string, pattern: RegExp): string[] {
    const match = text.match(pattern);
    if (!match?.[1]) return [];
    return match[1]
      .split(/[,;]/)
      .map(s => s.replace(/\*+/g, '').replace(/^[\s\-]+/, '').trim())
      .filter(s => s.length > 1 && s.length < 60);
  }

  /** Extract gender split percentages from text */
  private extractGenderSplit(text: string): Record<string, number> {
    const split: Record<string, number> = {};
    const maleMatch = text.match(/(?:male|men)[:\s]*(\d+)%?/i);
    const femaleMatch = text.match(/(?:female|women)[:\s]*(\d+)%?/i);
    if (maleMatch) split.male = parseInt(maleMatch[1]);
    if (femaleMatch) split.female = parseInt(femaleMatch[1]);
    return split;
  }

  /** Extract first descriptive sentence after a name in text */
  private extractFirstSentenceAfterName(text: string, name: string): string {
    const idx = text.indexOf(name);
    if (idx === -1) return '';
    const after = text.substring(idx + name.length).replace(/^[\s\*\-:]+/, '');
    const sentence = after.match(/^([^.!?]+[.!?])/);
    return sentence?.[1]?.trim() || after.substring(0, 150).trim();
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
