// Prompt blocks for the opt-in "feed realism" mode (tests.variant_config.realism).
//
// Why: in the Trupanion round-one pass (24 Sept 2026) twins scored every concept
// 7-9 out of 10 regardless of attitude. Busy Families put all nine concepts
// between 88 and 97 RalphScore, so nothing could be ranked. Three causes are
// addressed here:
//   1. No anchor for the scale: the model treats 5 as "bad", not "typical".
//   2. Category base rate missing: the response prompt never saw brand_context,
//      so the twin didn't know it is mostly uninsured and scrolls past.
//   3. attitude_score was a label the model ignored; here it becomes behaviour.
// Default off, so tests created without the flag behave exactly as before.

import type { Persona, BrandContext } from './types.js';

export const REALISM_SYSTEM_BLOCK = `

FEED REALISM:
You are scrolling your social feed and this ad appears between posts from friends and creators. Most ads you see, you scroll past without a second thought.
Score against that reality:
- 5 = a typical ad you would scroll past without really noticing.
- 7 = it genuinely stopped you and you took it in.
- 9-10 = rare; an ad you would act on or send to someone.
- Below 5 = it actively put you off.
Use the whole scale. Do not reward an ad just because it names a problem you have; ads that name your problem are common. Judge whether this one would actually make you stop, believe it and act.`;

export function attitudeBehaviour(attitude: number | null | undefined): string {
  if (attitude === null || attitude === undefined) return '';
  const a = Number(attitude);
  if (!Number.isFinite(a)) return '';
  if (a <= 3) return 'You are a skeptic about this category. You stop for fewer than 1 in 20 of these ads and assume there is a catch.';
  if (a <= 6) return 'You are neutral about this category. You stop for about 1 in 10 of these ads and need a concrete reason to believe one.';
  return 'You are open to this category, but you still ignore most ads in it. An ad has to be specific and credible to move you.';
}

/** User-prompt block: category baseline from brand_context plus attitude as behaviour. */
export function buildRealismContext(persona: Partial<Persona>, attitude: number | null | undefined): string {
  const bc: Partial<BrandContext> = persona.brand_context || {};
  const lines: string[] = [];
  if (bc.category_engagement) lines.push(`- Where you are with this category: ${bc.category_engagement}`);
  if (bc.brand_awareness) lines.push(`- Brands you know: ${bc.brand_awareness}`);
  if (bc.purchase_drivers?.length) lines.push(`- What would actually move you: ${bc.purchase_drivers.join('; ')}`);
  const behaviour = attitudeBehaviour(attitude);
  if (behaviour) lines.push(`- ${behaviour}`);
  return lines.length ? `\nYOUR BASELINE (how you normally treat ads like this):\n${lines.join('\n')}\n` : '';
}

// Voice-sample prompt that doesn't pitch the product. The default prompt asks
// for "their opinion about something they care about"; with insurance-shaped
// motivations it wrote a pro-insurance monologue that then sat in every
// response prompt ("I understand the importance of protecting our furry
// companions"). This one keeps the voice and drops the pitch.
export function livedVoicePrompt(persona: Partial<Persona>): string {
  return `Generate a voice sample for this persona:

Name: ${persona.name}
Age: ${persona.age_base}
Location: ${persona.location}
Occupation: ${persona.occupation}
Household: ${persona.household || 'Not specified'}

Values: ${persona.psychographics?.values?.join(', ') || 'Not specified'}
Humor Style: ${persona.cultural_context?.humor_style || 'Not specified'}
Language Markers: ${persona.cultural_context?.language_markers?.join(', ') || 'Not specified'}

Write 2 short paragraphs in which this person talks, in the first person, about their pets, their household and a recent everyday money decision.
Rules:
- Do not mention insurance, pet insurance, or any product, brand or service category.
- Do not argue for or against anything; just talk.
- No greetings or openers ("Oh, hey there", "Let me tell you", "So,").
- Plain, specific details over adjectives. Their vocabulary and rhythm, not a caricature of it.`;
}
