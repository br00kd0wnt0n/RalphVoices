// The month's key dates (Brook, 7 Oct): pure helpers for the strip on the board and the date shown on Build and
// Assets. No app imports, so backend/tests can check it (as buildDraft.ts is checked). Dates are plain YYYY-MM-DD
// days: a date is "today" for the whole of that day, wherever the person is.

export interface MilestoneLike { id: string; label: string; date: string; track?: string; screen?: 'build' | 'assets' }

/** Today as YYYY-MM-DD, in the person's own time zone. */
export const todayIso = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
/** Whole days from `today` to `date` (negative: past). */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}
/** "today", "tomorrow", "in 3 days", "yesterday", "4 days ago". */
export function dayWords(n: number): string {
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`;
}
/** "Fri 9 Oct" (the year only when it isn't this one). */
export function dateWords(date: string, today?: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const s = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
  return today && date.slice(0, 4) !== today.slice(0, 4) ? `${s} ${date.slice(0, 4)}` : s;
}
const ordered = (ms: MilestoneLike[]) => [...ms].sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
/** The next date that hasn't passed (today counts), optionally for one screen; null when all are behind. */
export function nextMilestone<M extends MilestoneLike>(ms: M[] | undefined, today: string, screen?: 'build' | 'assets'): M | null {
  return (ordered(ms || []) as M[]).find(m => m.date >= today && (!screen || m.screen === screen)) || null;
}
/**
 * The date a screen shows: the next one marked for it, else the next one of all. "R1 feedback due Fri 9 Oct, in 2 days".
 * Null when there are no dates, or every date has passed.
 */
export function screenDate(ms: MilestoneLike[] | undefined, today: string, screen: 'build' | 'assets'): { m: MilestoneLike; words: string; days: number } | null {
  const m = nextMilestone(ms, today, screen) || nextMilestone(ms, today);
  if (!m) return null;
  const days = daysUntil(m.date, today);
  return { m, days, words: `${m.label} ${dateWords(m.date, today)}, ${dayWords(days)}` };
}
/** The strip: every date in order, each past / today / next / later, with the tracks present. */
export function strip<M extends MilestoneLike>(ms: M[] | undefined, today: string): { items: Array<M & { state: 'past' | 'today' | 'next' | 'later'; days: number }>; tracks: string[] } {
  const list = ordered(ms || []) as M[];
  const next = list.find(m => m.date > today);
  const items = list.map(m => ({ ...m, days: daysUntil(m.date, today), state: (m.date < today ? 'past' : m.date === today ? 'today' : m === next ? 'next' : 'later') as 'past' | 'today' | 'next' | 'later' }));
  return { items, tracks: [...new Set(list.map(m => m.track || '').filter(Boolean))] };
}
