// Shared constants - single source of truth for thresholds and presets

export const SENTIMENT_THRESHOLDS = {
  POSITIVE_MIN: 7,  // >= 7 is positive
  NEUTRAL_MIN: 4,   // >= 4 and < 7 is neutral
  // < 4 is negative
} as const;

export const ATTITUDE_THRESHOLDS = {
  ENTHUSIAST_MIN: 7,  // >= 7 is enthusiast
  SKEPTIC_MAX: 3,     // <= 3 is skeptic
} as const;

export const TEST_FOCUS_PRESETS = {
  baseline: {
    name: 'Baseline',
    description: 'General audience feedback covering all aspects',
    focusAreas: [] as string[],
    promptModifier: '',
  },
  brandPerception: {
    name: 'Brand Perception',
    description: 'Focus on brand association, trust, and recognition',
    focusAreas: ['brand trust', 'brand recall', 'brand fit', 'competitor comparison'],
    promptModifier: `
FOCUS AREAS FOR THIS TEST:
Pay special attention to:
- How does this concept affect your perception of the brand?
- Does this feel authentic to what you know about this brand?
- Would this make you trust the brand more or less?
- How does this compare to similar brands you know?`,
  },
  purchaseIntent: {
    name: 'Purchase Intent',
    description: 'Focus on buying likelihood and barriers',
    focusAreas: ['purchase likelihood', 'price sensitivity', 'barriers to purchase', 'urgency'],
    promptModifier: `
FOCUS AREAS FOR THIS TEST:
Pay special attention to:
- Would this make you want to buy/try this product or service?
- What would stop you from purchasing?
- Does the value proposition feel compelling?
- How urgently would you want to act on this?`,
  },
  creativeImpact: {
    name: 'Creative Impact',
    description: 'Focus on emotional resonance and memorability',
    focusAreas: ['emotional response', 'memorability', 'distinctiveness', 'attention-grabbing'],
    promptModifier: `
FOCUS AREAS FOR THIS TEST:
Pay special attention to:
- What emotions does this concept trigger in you?
- Would you remember this tomorrow? Next week?
- What makes this stand out from similar content you've seen?
- Did this capture and hold your attention?`,
  },
  messageClarity: {
    name: 'Message Clarity',
    description: 'Focus on comprehension and takeaways',
    focusAreas: ['key message', 'comprehension', 'confusion points', 'call to action'],
    promptModifier: `
FOCUS AREAS FOR THIS TEST:
Pay special attention to:
- What is the main message you're taking away?
- Was anything confusing or unclear?
- What action (if any) are you being asked to take?
- Can you explain this concept to someone else?`,
  },
  socialShareability: {
    name: 'Social Shareability',
    description: 'Focus on viral potential and conversation',
    focusAreas: ['share likelihood', 'conversation starter', 'social currency', 'platform fit'],
    promptModifier: `
FOCUS AREAS FOR THIS TEST:
Pay special attention to:
- Would you share this on your social platforms? Which ones?
- Would this start a conversation with your friends?
- Does sharing this make you look good/smart/funny?
- What platform would this work best on?`,
  },
} as const;

export type FocusPresetKey = keyof typeof TEST_FOCUS_PRESETS;
