// The worksheet as Studio's default screen (Round 2 brief, PR 5): "as simple as the sheet". Studio opens on the
// worksheet, with only its five steps in the header (the worksheet's three, then Build ads and Assets). Everything
// else (the round board, Write, Review, Territories, Rules, Check copy, Compare, How it works, Live) is behind
// "Advanced", unchanged. The choice is per browser (localStorage), and a link to an advanced screen still opens it.
// No app imports, so backend/tests/studioRoute.test.ts can check it.
import type { StudioTab } from './studioRoute';

export type StudioMode = 'simple' | 'advanced';
const KEY = 'voices-studio-mode';

/** The screens of the simple view. Anything else is an advanced screen. */
export const SIMPLE_TABS: StudioTab[] = ['worksheet', 'build', 'assets'];
export const isAdvancedTab = (t: StudioTab) => !SIMPLE_TABS.includes(t);

export function getMode(store: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): StudioMode {
  try { return store?.getItem(KEY) === 'advanced' ? 'advanced' : 'simple'; } catch { return 'simple'; }
}
export function setMode(m: StudioMode, store: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { store?.setItem(KEY, m); } catch { /* private mode: the choice lasts this visit */ }
}
/** /studio is "your start": the worksheet in the simple view, the round board in the advanced one. */
export const startTab = (t: StudioTab, mode: StudioMode): StudioTab => (t === 'home' && mode === 'simple' ? 'worksheet' : t);
