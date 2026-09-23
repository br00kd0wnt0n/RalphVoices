// Parses a generateConceptResponse completion: in-character text, then
// `---SCORES---`, then a JSON object with the four scores and reaction tags.
//
// Throws ScoreParseError when the four scores can't be read. It used to fall
// back to 5/5/5/5, which silently dragged means toward the middle and hid the
// failure. Throwing lets withRetry re-ask the model, and a panel member that
// still fails is recorded in tests.options.dropouts like any other failure.
//
// Tolerant of the formatting slips the model actually makes: a ```json fence
// around the object, prose after it, numeric strings ("7"), and a missing
// separator line when the object is still there at the end.

export const SCORES_SEPARATOR = '---SCORES---';

const SCORE_FIELDS = ['sentiment_score', 'engagement_likelihood', 'share_likelihood', 'comprehension_score'] as const;

export class ScoreParseError extends Error {
  constructor(reason: string, content: string) {
    const tail = content.slice(-200).replace(/\s+/g, ' ');
    super(`Could not parse scores (${reason}). Tail of response: "${tail}"`);
    this.name = 'ScoreParseError';
  }
}

export interface ParsedConceptResponse {
  response_text: string;
  sentiment_score: number;
  engagement_likelihood: number;
  share_likelihood: number;
  comprehension_score: number;
  reaction_tags: string[];
}

// Last {...} span in the text that parses as JSON and has a sentiment_score.
function findTrailingScoresObject(text: string): { json: any; start: number } | null {
  for (let end = text.lastIndexOf('}'); end >= 0; end = text.lastIndexOf('}', end - 1)) {
    for (let start = text.lastIndexOf('{', end); start >= 0; start = text.lastIndexOf('{', start - 1)) {
      try {
        const json = JSON.parse(text.slice(start, end + 1));
        if (json && typeof json === 'object' && 'sentiment_score' in json) return { json, start };
      } catch {
        // keep widening
      }
    }
  }
  return null;
}

export function parseConceptResponse(content: string): ParsedConceptResponse {
  const sepIndex = content.lastIndexOf(SCORES_SEPARATOR);
  let responseText: string;
  let parsed: any;

  if (sepIndex >= 0) {
    responseText = content.slice(0, sepIndex).trim();
    const found = findTrailingScoresObject(content.slice(sepIndex + SCORES_SEPARATOR.length));
    if (!found) throw new ScoreParseError('no scores JSON after separator', content);
    parsed = found.json;
  } else {
    const found = findTrailingScoresObject(content);
    if (!found) throw new ScoreParseError('no separator and no scores JSON', content);
    parsed = found.json;
    responseText = content.slice(0, found.start).replace(/```(json)?\s*$/i, '').trim();
  }

  const scores = {} as Record<(typeof SCORE_FIELDS)[number], number>;
  for (const field of SCORE_FIELDS) {
    const raw = parsed[field];
    const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new ScoreParseError(`${field} missing or not a number`, content);
    }
    scores[field] = Math.min(10, Math.max(1, n));
  }

  const tags = Array.isArray(parsed.reaction_tags)
    ? parsed.reaction_tags.filter((t: unknown): t is string => typeof t === 'string')
    : [];

  return {
    response_text: responseText,
    ...scores,
    reaction_tags: tags.length > 0 ? tags : ['needs_more_info'],
  };
}
