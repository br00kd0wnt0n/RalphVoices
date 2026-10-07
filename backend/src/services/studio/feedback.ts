// Feedback rounds (Brook, 7 Oct): the client's feedback on a month's ads arrives through Add3 as one consolidated set
// of notes per round (R1 on copy, R2 on the complete package). This is where it is kept: per round, when it was sent
// and received and the notes as they came; per ad, a note for that round and a simple state (no change / change
// wanted / done), who entered it and for whom.
//
// It is separate from Trupanion's compliance decision in Assets, and it only informs: a "change wanted" never holds an
// ad back from Ready to traffic (blocking stays with the compliance decision). Stored per month in studio_inputs
// (`feedback:<round id>`); ads are keyed by the ad's name (namingCode.adName), so it follows the one definition.
import { getStore } from './engine.js';
import { adHandoffRows } from './ready.js';
import { cleanFor } from '../../utils/actor.js';
import type { Region } from '../../utils/namingCode.js';

export type FeedbackState = 'none' | 'change' | 'done';
export const FEEDBACK_WORDS: Record<FeedbackState, string> = { none: 'No change', change: 'Change wanted', done: 'Done' };
export interface FeedbackReview { id: string; label: string; sent?: string; received?: string; notes?: string; by?: string; at?: string }
export interface FeedbackItem { state: FeedbackState; note?: string; by?: string; for?: string; at: string }
export interface FeedbackStore { reviews: FeedbackReview[]; items: Record<string, Record<string, FeedbackItem>> }

const key = (round: string) => `feedback:${round}` as const;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
export async function loadFeedback(round: string): Promise<FeedbackStore> {
  const v = await getStore().getInput(key(round));
  return { reviews: Array.isArray(v?.reviews) ? v.reviews : [], items: v?.items && typeof v.items === 'object' ? v.items : {} };
}

/** A feedback round: its name, when it was sent and received, and the notes as they came. Created or updated by id. */
export async function saveReview(round: string, input: Partial<FeedbackReview>, user?: string): Promise<FeedbackStore> {
  const id = String(input.id || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12);
  if (!id) throw new Error('A feedback round needs a short id, e.g. R1');
  for (const k of ['sent', 'received'] as const) if (input[k] && !isDate(String(input[k]))) throw new Error(`"${k}" is a date (YYYY-MM-DD)`);
  return getStore().withLock([key(round)], async () => {
    const fb = await loadFeedback(round);
    const cur = fb.reviews.find(r => r.id === id);
    const next: FeedbackReview = { ...(cur || {}), id, label: String(input.label ?? cur?.label ?? '').trim().slice(0, 60) || `${id} feedback`, by: user || cur?.by, at: new Date().toISOString() };
    for (const k of ['sent', 'received'] as const) if (input[k] !== undefined) { if (input[k]) next[k] = String(input[k]); else delete next[k]; }
    if (input.notes !== undefined) { const n = String(input.notes || '').slice(0, 20000); if (n.trim()) next.notes = n; else delete next.notes; }
    fb.reviews = [...fb.reviews.filter(r => r.id !== id), next].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    await getStore().putInput(key(round), fb);
    return fb;
  });
}

/** One ad's feedback in one round: its state and note. `forWho`: whose call it is when entered for someone else. */
export async function setAdFeedback(round: string, ad: string, review: string, input: { state?: string; note?: string }, user?: string, forWho?: string): Promise<FeedbackItem> {
  const state = String(input.state || '') as FeedbackState;
  if (!FEEDBACK_WORDS[state]) throw new Error('Feedback is "none" (no change), "change" (change wanted) or "done"');
  const name = String(ad || '').trim().toUpperCase();
  if (!name) throw new Error('Which ad?');
  return getStore().withLock([key(round)], async () => {
    const fb = await loadFeedback(round);
    if (!fb.reviews.some(r => r.id === review)) throw new Error(`No feedback round ${review}: add it first`);
    const f = cleanFor(forWho, user);
    const cur = fb.items[name]?.[review];
    const note = input.note === undefined ? cur?.note : String(input.note || '').trim().slice(0, 4000);
    const item: FeedbackItem = { state, ...(note ? { note } : {}), ...(user ? { by: user } : {}), ...(f ? { for: f } : {}), at: new Date().toISOString() };
    fb.items[name] = { ...(fb.items[name] || {}), [review]: item };
    await getStore().putInput(key(round), fb);
    return item;
  });
}

export interface FeedbackAd { ad: string; persona: string; territory: string; region: Region; format: string; codes: string[]; items: Record<string, FeedbackItem> }
export interface FeedbackView {
  round: string; region: Region; reviews: Array<FeedbackReview & { counts: { change: number; done: number; none: number; unmarked: number } }>;
  ads: FeedbackAd[];
  /** The latest round with anything still wanted, in words, for the board: "R1: 3 ads with changes". */
  summary: string;
}

/** A month's feedback for a region: the rounds with their counts, and every signed-off ad with its state in each. */
export async function feedbackView(round: string, region: Region, user?: string): Promise<FeedbackView> {
  const fb = await loadFeedback(round);
  const ads: FeedbackAd[] = (await adHandoffRows({ region, round, user })).map(a => ({ ad: a.ad, persona: a.persona, territory: a.territory, region: a.region, format: a.format, codes: a.codes, items: fb.items[a.ad] || {} }));
  const reviews = fb.reviews.map(r => {
    const counts = { change: 0, done: 0, none: 0, unmarked: 0 };
    for (const a of ads) counts[a.items[r.id]?.state || 'unmarked']++;
    return { ...r, counts };
  });
  const open = [...reviews].reverse().find(r => r.counts.change);
  const last = reviews[reviews.length - 1];
  const summary = open ? `${open.id}: ${open.counts.change} ad${open.counts.change === 1 ? '' : 's'} with changes wanted`
    : last ? (last.received ? `${last.id}: ${last.counts.unmarked ? `${last.counts.unmarked} ad${last.counts.unmarked === 1 ? '' : 's'} not marked yet` : 'nothing outstanding'}` : `${last.id}: ${last.sent ? 'sent, feedback not in yet' : 'not sent yet'}`)
    : '';
  return { round, region, reviews, ads, summary };
}
