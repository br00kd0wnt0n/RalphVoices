// Rounds (Brook, 30 Sep): round one is about to start, and round two mustn't be
// cluttered by round one. The active round is set by an admin and stamped on
// every new run (brief), line, sign-off, expectation and line version; uploads,
// audits and compliance follow their sign-off. Anything from before rounds reads
// as R1 (Nick's first runs are round one).
//
// A TEST round (R0, for Brook's production run-through) is hidden everywhere by
// default, never reaches Add3 (handoffs) or B3 (features), doesn't feed taste
// into real rounds, and doesn't use up codes: its codes carry a _TEST suffix and
// real rounds allocate as if it never happened (R1 starts at A). Its spend is
// real money, so it counts toward the cap, labelled with the round.
//
// Stored in studio_inputs ('rounds'); no migration.

import { getStore } from './engine.js';

/**
 * `label`: what people see ("Month 1", or "Test" for a test round). The client's schedule uses "R1/R2" for review
 * rounds, so Studio's rounds are shown as months; the stored ids (R0, R1, R2…) and the _TEST suffix don't change.
 */
export interface Round { id: string; name: string; label?: string; from?: string; test?: boolean; created_by?: string; created_at?: string; /** When the round's assets are due (YYYY-MM-DD), shown on the round board. */ assets_due?: string }
export interface RoundsState { active: string; rounds: Round[] }

/** Content with no round stamp is round one. */
export const DEFAULT_ROUND = 'R1';
const DEFAULT_STATE: RoundsState = { active: DEFAULT_ROUND, rounds: [{ id: DEFAULT_ROUND, name: 'Month 1', from: '2026-09-30' }] };
/** A round as people see it: its label, else "Test" for a test round, else "Month N" from its id (R1 → Month 1). */
export const monthLabel = (r: Pick<Round, 'id' | 'label' | 'test'> | undefined | null): string =>
  (r?.label?.trim() || (r?.test ? 'Test' : r ? `Month ${Number(r.id.replace(/^R/i, '')) || r.id}` : ''));
/** The label for a round id, from the rounds state (an id with no round: "Month N"). */
export const labelOf = (state: RoundsState, id: string) => monthLabel(state.rounds.find(r => r.id === id) || { id });
/** Test-round codes: never trafficked, never sharing a code with a real round. */
export const TEST_SUFFIX = '_TEST';

export async function getRounds(): Promise<RoundsState> {
  const s = (await getStore().getInput('rounds')) as RoundsState | null;
  if (!s?.rounds?.length) return structuredClone(DEFAULT_STATE);
  // R1 always exists (unstamped content is R1).
  return s.rounds.some(r => r.id === DEFAULT_ROUND) ? s : { ...s, rounds: [...DEFAULT_STATE.rounds, ...s.rounds] };
}
export async function activeRound(): Promise<Round> {
  const s = await getRounds();
  return s.rounds.find(r => r.id === s.active) || DEFAULT_STATE.rounds[0];
}
export const roundOf = (x: { round?: string } | null | undefined, fallback?: { round?: string } | null): string => x?.round || fallback?.round || DEFAULT_ROUND;

// ---------- each person's working round (Brook, 1 Oct) ----------
// Brook runs an end-to-end test in production (a test round, kept as a demo) while Nick writes real Month 1 copy. So
// the round a person works in is theirs, not global: it defaults to the active round, an admin may pick a test round,
// and every stamp (new runs, lines, sign-offs, taste, spend labels) and every view follows the requesting person.
// The global active round is what everyone else uses, and choosing a test round never changes it.
const workingKey = (user: string) => `working_round:${user.trim().toLowerCase()}` as const;
/** The rounds a person can work in: the active round, and (admins) the test rounds. */
export function workingChoices(state: RoundsState, isAdmin: boolean): Round[] {
  const active = state.rounds.find(r => r.id === state.active) || DEFAULT_STATE.rounds[0];
  return [active, ...(isAdmin ? state.rounds.filter(r => r.test && r.id !== active.id) : [])];
}
/** The round a person is working in: their choice if it's still the active round or a test round, else the active round. */
export async function workingRound(user?: string | null, state?: RoundsState): Promise<Round> {
  const s = state || await getRounds();
  const active = s.rounds.find(r => r.id === s.active) || DEFAULT_STATE.rounds[0];
  if (!user) return active;
  const id = (await getStore().getInput(workingKey(user)))?.id;
  const r = id ? s.rounds.find(x => x.id === id) : undefined;
  return r && (r.id === active.id || r.test) ? r : active;
}
/** Choose the round to work in. Only the active round, or a test round for an admin. */
export async function setWorkingRound(user: string, id: string, isAdmin: boolean): Promise<Round> {
  if (!user) throw new Error('Sign in to choose a round to work in');
  const s = await getRounds();
  const want = s.rounds.find(r => r.id === String(id || '').trim().toUpperCase());
  if (!want) throw new Error(`No round ${id}`);
  if (want.id !== s.active && !want.test) throw new Error(`${monthLabel(want)} isn't the active round: work in the active round, or (admins) a test round`);
  if (want.test && !isAdmin) throw Object.assign(new Error('Only an admin can work in a test round'), { status: 403 });
  // Following the active round is stored as no choice, so a later change of the active round carries everyone along.
  await getStore().putInput(workingKey(user), want.id === s.active ? null : { id: want.id, at: new Date().toISOString() });
  return want;
}

/**
 * Which rounds a view shows: 'all', or one round (by default the requesting person's working round). Test rounds are
 * hidden unless asked for by name, worked in, or 'all'. `isTest` answers for any round id; `active` is the round the
 * view defaults to (the person's working round).
 */
export interface RoundView { ids: Set<string> | null; isTest(id: string): boolean; active: Round; state: RoundsState }
export async function roundView(q?: string | null, user?: string | null): Promise<RoundView> {
  const state = await getRounds();
  const test = new Set(state.rounds.filter(r => r.test).map(r => r.id));
  const active = await workingRound(user, state);
  const want = String(q || '').trim();
  return { ids: want === 'all' ? null : new Set([want && state.rounds.some(r => r.id === want) ? want : active.id]), isTest: id => test.has(id), active, state };
}
/** A view of exactly one test round (a demo's exports include its codes, labelled TEST). */
export const testOnly = (v: RoundView) => !!v.ids && v.ids.size === 1 && v.isTest([...v.ids][0]);
export const inView = (v: RoundView, round: string) => (v.ids ? v.ids.has(round) : true);

/** Create or update a round (admin). An id is R followed by digits; a test round is marked so. */
export async function saveRound(input: Partial<Round> & { activate?: boolean }, user?: string): Promise<RoundsState> {
  const id = String(input.id || '').trim().toUpperCase();
  if (!/^R\d{1,3}$/.test(id)) throw new Error('A round id is R and a number, e.g. R0 for a test run-through or R2');
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Give the round a name, e.g. "Round two"');
  const state = await getRounds();
  const existing = state.rounds.find(r => r.id === id);
  if (id === DEFAULT_ROUND && input.test) throw new Error('R1 is the first real round; use R0 for a test run-through');
  // The asset deadline: a date, or '' to clear it; left out, it stays as it was.
  const due = input.assets_due === undefined ? existing?.assets_due : String(input.assets_due || '').trim();
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('The asset deadline is a date (YYYY-MM-DD)');
  const label = input.label === undefined ? existing?.label : String(input.label || '').trim().slice(0, 40);
  const round: Round = { ...(existing || {}), id, name, from: input.from ? String(input.from).slice(0, 10) : existing?.from || new Date().toISOString().slice(0, 10), test: !!input.test, created_by: existing?.created_by || user, created_at: existing?.created_at || new Date().toISOString() };
  if (due) round.assets_due = due; else delete round.assets_due;
  if (label) round.label = label; else delete round.label;
  if (input.activate && input.test) throw new Error(TEST_NOT_ACTIVE);
  const next: RoundsState = { active: input.activate ? id : state.active, rounds: [...state.rounds.filter(r => r.id !== id), round].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })) };
  await getStore().putInput('rounds', next);
  return next;
}
/** A test round is worked in by one person at a time; as the active round it would stamp everyone's work as test. */
const TEST_NOT_ACTIVE = 'A test round is never the active round (everyone would be working in it): pick it in the header to work in it yourself';
export async function setActiveRound(id: string): Promise<RoundsState> {
  const state = await getRounds();
  if (!state.rounds.some(r => r.id === id)) throw new Error(`No round ${id}`);
  if (state.rounds.find(r => r.id === id)!.test) throw new Error(TEST_NOT_ACTIVE);
  const next = { ...state, active: id };
  await getStore().putInput('rounds', next);
  return next;
}
