import OpenAI from 'openai';
import type { Persona, PersonaVariant, VariantConfig } from '../utils/types.js';

const apiKey = process.env.OPENAI_API_KEY;
console.log(`OpenAI API Key configured: ${apiKey ? 'Yes (' + apiKey.substring(0, 10) + '...)' : 'NO - AI FEATURES DISABLED'}`);

if (!apiKey) {
  console.error('ERROR: OPENAI_API_KEY is not set. AI features will not work.');
}

const openai = new OpenAI({
  apiKey: apiKey || 'missing-key',
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

export async function generateVoiceSample(persona: Partial<Persona>): Promise<string> {
  const systemPrompt = `You are generating a voice sample for a synthetic persona. Write 2-3 paragraphs
showing how this person would naturally communicate - their vocabulary, sentence
structure, tone, and cultural references. This will be used to calibrate AI
responses when this persona reacts to creative concepts.`;

  const userPrompt = `Generate a voice sample for this persona:

Name: ${persona.name}
Age: ${persona.age_base}
Location: ${persona.location}
Occupation: ${persona.occupation}

Values: ${persona.psychographics?.values?.join(', ') || 'Not specified'}
Motivations: ${persona.psychographics?.motivations?.join(', ') || 'Not specified'}
Pain Points: ${persona.psychographics?.pain_points?.join(', ') || 'Not specified'}

Primary Platforms: ${persona.media_habits?.primary_platforms?.map(p => p.name).join(', ') || 'Not specified'}
Content Preferences: ${persona.media_habits?.content_preferences?.join(', ') || 'Not specified'}
Humor Style: ${persona.cultural_context?.humor_style || 'Not specified'}
Language Markers: ${persona.cultural_context?.language_markers?.join(', ') || 'Not specified'}

Write as if this person is casually explaining their opinion about something
they care about. Show their authentic voice.`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.8,
    max_tokens: 500,
  });

  return response.choices[0]?.message?.content || '';
}

export interface GeneratedVariant {
  variant_name: string;
  age_actual: number;
  location_variant: string;
  attitude_score: number;
  primary_platform: string;
  engagement_level: 'heavy' | 'moderate' | 'light' | 'lapsed';
  distinguishing_trait: string;
  voice_modifier: string;
}

export async function generateVariants(
  persona: Persona,
  count: number,
  config: VariantConfig
): Promise<GeneratedVariant[]> {
  const systemPrompt = `You are generating variant personas for audience testing. Given a base persona,
create ${count} variants with controlled diversity. Each variant should feel like a
real individual who shares core traits with the base but differs in specific ways.

Return a JSON array with this structure for each variant:
{
  "variant_name": "First name that fits demographic",
  "age_actual": number (within ±${config.age_spread} of base),
  "location_variant": "Specific city/area appropriate to persona",
  "attitude_score": number 1-10 (1=skeptic, 10=enthusiast),
  "primary_platform": "Their main social platform",
  "engagement_level": "heavy|moderate|light|lapsed",
  "distinguishing_trait": "One specific thing that makes them unique",
  "voice_modifier": "How their voice differs from base (e.g., 'more sarcastic', 'uses more emoji')"
}

IMPORTANT: Return ONLY the JSON array, no markdown formatting or additional text.`;

  const personaJson = {
    name: persona.name,
    age_base: persona.age_base,
    location: persona.location,
    occupation: persona.occupation,
    household: persona.household,
    psychographics: persona.psychographics,
    media_habits: persona.media_habits,
    brand_context: persona.brand_context,
    cultural_context: persona.cultural_context,
  };

  const userPrompt = `Base Persona: ${JSON.stringify(personaJson, null, 2)}

Generate ${count} variants with this distribution:
- Attitude: ${config.attitude_distribution} (normal/skew_positive/skew_negative)
- Age spread: ±${config.age_spread} years
- Platforms to include: ${config.platforms_to_include.join(', ')}

Ensure diversity across all dimensions. Make each variant feel like a real person.`;

  console.log(`Generating ${count} variants for persona ${persona.name}...`);

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.9,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '{"variants":[]}';
    console.log(`OpenAI response received, length: ${content.length}`);
    console.log(`OpenAI raw response (first 500 chars): ${content.substring(0, 500)}`);

    const parsed = JSON.parse(content);
    console.log(`Parsed response keys: ${Object.keys(parsed).join(', ')}`);

    // Handle both direct array and wrapped object - check multiple possible keys
    let variants: GeneratedVariant[];
    if (Array.isArray(parsed)) {
      variants = parsed;
    } else if (Array.isArray(parsed.variants)) {
      variants = parsed.variants;
    } else if (Array.isArray(parsed.data)) {
      variants = parsed.data;
    } else {
      // Find first array property
      const arrayKey = Object.keys(parsed).find(key => Array.isArray(parsed[key]));
      if (arrayKey) {
        console.log(`Found variants in key: ${arrayKey}`);
        variants = parsed[arrayKey];
      } else {
        console.log(`No array found in response. Full response: ${JSON.stringify(parsed).substring(0, 1000)}`);
        variants = [];
      }
    }

    console.log(`Parsed ${variants.length} variants`);
    return variants as GeneratedVariant[];
  } catch (error: any) {
    console.error('OpenAI API error:', error.message || error);
    throw new Error(`Failed to generate variants: ${error.message || 'Unknown error'}`);
  }
}

export interface ConceptTestResponse {
  response_text: string;
  sentiment_score: number;
  engagement_likelihood: number;
  share_likelihood: number;
  comprehension_score: number;
  reaction_tags: string[];
}

export async function generateConceptResponse(
  variant: PersonaVariant,
  basePersona: Persona,
  conceptText: string
): Promise<ConceptTestResponse> {
  const systemPrompt = `You are embodying a specific persona to provide authentic feedback on a creative
concept. Respond as this person would - with their vocabulary, concerns,
enthusiasm level, and cultural frame of reference.

Your response should:
1. Give an immediate gut reaction (1-2 sentences)
2. Explain what you understood the concept to be
3. Share what resonates or doesn't resonate with you
4. Indicate whether you'd engage with or share this

Stay in character throughout. Be specific and authentic to this persona's worldview.

After your response, provide JSON with these fields:
- sentiment_score: 1-10 (how positive/negative is your overall reaction)
- engagement_likelihood: 1-10 (how likely would you engage with this)
- share_likelihood: 1-10 (would you share this with friends)
- comprehension_score: 1-10 (how well did you understand what this is about)
- reaction_tags: array of 2-4 tags from [excited, intrigued, confused, skeptical, amused, bored, annoyed, inspired, would_share, would_ignore, needs_more_info, feels_authentic, feels_forced, seen_before, fresh_take]

Format your final response as:
[Your in-character response here]

---SCORES---
{"sentiment_score": X, "engagement_likelihood": X, "share_likelihood": X, "comprehension_score": X, "reaction_tags": ["tag1", "tag2"]}`;

  const voiceModifier = variant.full_profile?.voice_modifier || '';
  const distinguishingTrait = variant.full_profile?.distinguishing_trait || '';

  const userPrompt = `PERSONA:
Name: ${variant.variant_name}
Age: ${variant.age_actual}
Location: ${variant.location_variant}
Primary Platform: ${variant.primary_platform}
Engagement Level: ${variant.engagement_level}
Attitude Score: ${variant.attitude_score}/10 (1=skeptic, 10=enthusiast)
Distinguishing Trait: ${distinguishingTrait}

Base Profile:
- Occupation: ${basePersona.occupation}
- Values: ${basePersona.psychographics?.values?.join(', ')}
- Motivations: ${basePersona.psychographics?.motivations?.join(', ')}
- Pain Points: ${basePersona.psychographics?.pain_points?.join(', ')}
- Decision Style: ${basePersona.psychographics?.decision_style}
- Humor Style: ${basePersona.cultural_context?.humor_style}
- Language Markers: ${basePersona.cultural_context?.language_markers?.join(', ')}

VOICE STYLE:
${basePersona.voice_sample}
${voiceModifier ? `\nVoice Modifier: ${voiceModifier}` : ''}

CONCEPT TO EVALUATE:
${conceptText}

Respond in character, then provide your scores and tags.`;

  const startTime = Date.now();

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.85,
    max_tokens: 800,
  });

  const content = response.choices[0]?.message?.content || '';

  // Parse the response
  const scoresSeparator = '---SCORES---';
  const parts = content.split(scoresSeparator);

  const responseText = parts[0]?.trim() || '';
  let scores: Partial<ConceptTestResponse> = {
    sentiment_score: 5,
    engagement_likelihood: 5,
    share_likelihood: 5,
    comprehension_score: 5,
    reaction_tags: ['needs_more_info'],
  };

  if (parts[1]) {
    try {
      const scoresJson = parts[1].trim();
      const parsed = JSON.parse(scoresJson);
      scores = {
        sentiment_score: Math.min(10, Math.max(1, parsed.sentiment_score || 5)),
        engagement_likelihood: Math.min(10, Math.max(1, parsed.engagement_likelihood || 5)),
        share_likelihood: Math.min(10, Math.max(1, parsed.share_likelihood || 5)),
        comprehension_score: Math.min(10, Math.max(1, parsed.comprehension_score || 5)),
        reaction_tags: Array.isArray(parsed.reaction_tags) ? parsed.reaction_tags : ['needs_more_info'],
      };
    } catch (e) {
      console.error('Failed to parse scores from response');
    }
  }

  return {
    response_text: responseText,
    sentiment_score: scores.sentiment_score!,
    engagement_likelihood: scores.engagement_likelihood!,
    share_likelihood: scores.share_likelihood!,
    comprehension_score: scores.comprehension_score!,
    reaction_tags: scores.reaction_tags!,
  };
}

export interface ThemeAnalysis {
  summary: {
    total_responses: number;
    sentiment: { positive: number; neutral: number; negative: number };
    avg_engagement: number;
    avg_share_likelihood: number;
    avg_comprehension: number;
  };
  themes: {
    positive_themes: { theme: string; frequency: number }[];
    concerns: { theme: string; frequency: number }[];
    unexpected: { theme: string; frequency: number }[];
  };
  key_quotes: string[];
}

export async function analyzeTestResults(
  conceptText: string,
  responses: Array<{
    variant: PersonaVariant;
    response_text: string;
    sentiment_score: number;
    engagement_likelihood: number;
    share_likelihood: number;
    comprehension_score: number;
    reaction_tags: string[];
  }>
): Promise<ThemeAnalysis> {
  // Calculate basic statistics
  const totalResponses = responses.length;
  const avgEngagement = responses.reduce((sum, r) => sum + r.engagement_likelihood, 0) / totalResponses;
  const avgShare = responses.reduce((sum, r) => sum + r.share_likelihood, 0) / totalResponses;
  const avgComprehension = responses.reduce((sum, r) => sum + r.comprehension_score, 0) / totalResponses;

  const sentimentCounts = {
    positive: responses.filter(r => r.sentiment_score >= 7).length,
    neutral: responses.filter(r => r.sentiment_score >= 4 && r.sentiment_score < 7).length,
    negative: responses.filter(r => r.sentiment_score < 4).length,
  };

  // Use AI to extract themes
  const systemPrompt = `You are analyzing audience feedback to extract patterns and themes. Given a set
of persona responses to a creative concept, identify:

1. Key positive themes (what's working)
2. Key concerns (what's not working)
3. Unexpected reactions (surprises worth noting)
4. 3-5 representative quotes that capture the range of reactions

Return as JSON:
{
  "positive_themes": [{"theme": "string", "frequency": number}],
  "concerns": [{"theme": "string", "frequency": number}],
  "unexpected": [{"theme": "string", "frequency": number}],
  "key_quotes": ["quote1", "quote2", ...]
}

IMPORTANT: Return ONLY the JSON, no markdown formatting.`;

  const responsesForAnalysis = responses.map(r => ({
    variant_name: r.variant.variant_name,
    age: r.variant.age_actual,
    platform: r.variant.primary_platform,
    attitude: r.variant.attitude_score,
    response: r.response_text,
    sentiment: r.sentiment_score,
    tags: r.reaction_tags,
  }));

  const userPrompt = `CONCEPT TESTED:
${conceptText}

RESPONSES (${totalResponses} total):
${JSON.stringify(responsesForAnalysis, null, 2)}

Analyze these responses and extract actionable insights.`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.5,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content || '{}';

  let themes = {
    positive_themes: [] as { theme: string; frequency: number }[],
    concerns: [] as { theme: string; frequency: number }[],
    unexpected: [] as { theme: string; frequency: number }[],
  };
  let keyQuotes: string[] = [];

  try {
    const parsed = JSON.parse(content);
    themes = {
      positive_themes: parsed.positive_themes || [],
      concerns: parsed.concerns || [],
      unexpected: parsed.unexpected || [],
    };
    keyQuotes = parsed.key_quotes || [];
  } catch (e) {
    console.error('Failed to parse theme analysis');
  }

  return {
    summary: {
      total_responses: totalResponses,
      sentiment: sentimentCounts,
      avg_engagement: Math.round(avgEngagement * 10) / 10,
      avg_share_likelihood: Math.round(avgShare * 10) / 10,
      avg_comprehension: Math.round(avgComprehension * 10) / 10,
    },
    themes,
    key_quotes: keyQuotes,
  };
}
