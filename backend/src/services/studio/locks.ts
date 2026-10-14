// The worksheet lock (Round 2 brief, "the Friday lock, made explicit"): a step of the month's copy (1 on-image copy,
// 2 primary text, 3 headlines) is locked per round and region, with who locked it and when. While a step is locked
// its lines can't be kept, cut, edited or added to anywhere in Studio (the worksheet, its sheet, Review, Build, Check
// copy, generate); unlocking it is one click on the worksheet. It informs Build (a note), never blocks a sign-off.
// Stored in studio_inputs `worksheet_locks:<round>:<region>`; no migration.
import * as S from './engine.js';
import type { Line } from './engine.js';
import { roundOf } from './rounds.js';
import { cleanFor, whoWords } from '../../utils/actor.js';
import type { Region } from '../../utils/namingCode.js';

export type LockStep = 'on_image' | 'primary' | 'headline';
export const LOCK_STEPS: Array<{ key: LockStep; n: number; name: string }> = [
  { key: 'on_image', n: 1, name: 'On-image copy' }, { key: 'primary', n: 2, name: 'Captions' }, { key: 'headline', n: 3, name: 'Headlines' },
];
export interface StepLock { by: string; for?: string; at: string }
export type Locks = Partial<Record<LockStep, StepLock>>

const key = (round: string, region: Region) => `worksheet_locks:${round}:${region}` as const;
const regionOfAny = (x?: string): Region => (String(x || '').toUpperCase() === 'CA' ? 'CA' : 'US');

export async function getLocks(round: string, region: Region): Promise<Locks> {
  return ((await S.getStore().getInput(key(round, region))) || {}) as Locks;
}

/** Lock or unlock one step; returns the step's locks after. */
export async function setLock(round: string, region: Region, step: LockStep, on: boolean, user?: string, forWho?: string): Promise<Locks> {
  if (!LOCK_STEPS.some(s => s.key === step)) throw Object.assign(new Error('Which step?'), { status: 400 });
  return S.getStore().withLock([key(round, region)], async () => {
    const locks = await getLocks(round, region);
    if (on) locks[step] = { by: user || 'unknown', ...(cleanFor(forWho, user) ? { for: cleanFor(forWho, user) } : {}), at: new Date().toISOString() };
    else delete locks[step];
    await S.getStore().putInput(key(round, region), locks);
    return locks;
  });
}

/** The worksheet step a line or a field belongs to (the same as the worksheet's stepOf), or null. */
export function stepOfField(field: string, persona: string, r = S.loadRules()): LockStep | null {
  if (S.isOnImageField(field, r)) return persona === S.SHARED_PERSONA ? null : 'on_image';
  if (S.PRODUCT_FIELDS.includes(field)) return 'primary';
  return persona === S.SHARED_PERSONA || /headline/.test(field) ? 'headline' : null;
}

/** Why a change is refused, in words ("Step 2 Captions is locked (brook, 14 Oct)…"). */
export function lockedWords(step: LockStep, lock: StepLock, region: Region): string {
  const s = LOCK_STEPS.find(x => x.key === step)!;
  const day = new Date(lock.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `Step ${s.n} ${s.name} (${region === 'CA' ? 'Canada' : 'US'}) is locked (${whoWords(lock.by, lock.for)}, ${day}). Unlock it on the worksheet to change its lines.`;
}

/** The lock that holds a field in a round and region, if any. */
export async function lockFor(x: { field: string; persona: string; round: string; region?: string }): Promise<{ step: LockStep; lock: StepLock; region: Region } | null> {
  const step = stepOfField(x.field, x.persona);
  if (!step) return null;
  const region = regionOfAny(x.region);
  const lock = (await getLocks(x.round, region))[step];
  return lock ? { step, lock, region } : null;
}

/** Throws (423, in words) when the line's step is locked. */
export async function assertLineUnlocked(batchId: string, lineId: string): Promise<void> {
  const b = await S.loadBatch(batchId);
  const l = b.lines.find(x => x.id === lineId);
  if (!l) return;
  await assertUnlocked({ field: l.field, persona: l.persona, round: roundOf(l, b.brief), region: S.regionOfLine(l, b.brief) });
}
export async function assertUnlocked(x: { field: string; persona: string; round: string; region?: string }): Promise<void> {
  const hit = await lockFor(x);
  if (hit) throw Object.assign(new Error(lockedWords(hit.step, hit.lock, hit.region)), { status: 423, locked: hit.step });
}
/** New lines for a brief (its fields, or its own lines): refused if any lands in a locked step. */
export async function assertBriefUnlocked(b: Pick<S.Brief, 'persona' | 'fields' | 'region' | 'own_lines'> & { round?: string }, round: string): Promise<void> {
  const fields = new Set([...(b.fields || []), ...(b.own_lines || []).map(o => o.field)]);
  for (const field of fields) await assertUnlocked({ field, persona: b.persona, round, region: b.region });
}
export type { Line };
