// Studio's addresses (Brook, 9 Oct): each step has its own path, /studio/write, /studio/review, /studio/build,
// /studio/assets, /studio/live, and the board is /studio. The utilities have paths too (/studio/territories, /rules,
// /worksheet, /check, /compare, /howto). The rest of the state stays in the query (persona, territory, region, stub,
// batch…), so /studio/assets?stub=<code> is a link to one ad. Old links keep working: /studio?tab=assets, and the
// older keys (brief, shortlist, ready, preflight, compliance), land on the new paths.
// No app imports, so backend/tests/studioRoute.test.ts can check it.

export const STUDIO_TABS = ['home', 'howto', 'write', 'review', 'build', 'assets', 'live', 'territories', 'rules', 'check', 'compare', 'worksheet'] as const;
export type StudioTab = typeof STUDIO_TABS[number];
/** Old tab keys and where they live now. */
export const MOVED: Record<string, StudioTab> = { brief: 'write', shortlist: 'review', ready: 'build', preflight: 'assets', compliance: 'assets' };
const BASE = '/studio';
/** Query keys that belong to one screen: dropped from the address when another screen opens. */
const OWN: Partial<Record<StudioTab, string[]>> = { assets: ['stub', 'asset'], review: ['batch', 'open', 'view'], compare: ['compare'] };
/** Screens that work in one persona × territory: the address carries them. */
const SCOPED: StudioTab[] = ['write', 'review', 'build'];

/** The key the address asks for: the path's step (/studio/assets), else an old ?tab=; '' for the board. */
export function tabKey(pathname: string, search: string): string {
  const seg = pathname.replace(/\/+$/, '').startsWith(`${BASE}/`) ? pathname.replace(/\/+$/, '').slice(BASE.length + 1).split('/')[0].toLowerCase() : '';
  return seg || (new URLSearchParams(search).get('tab') || '').toLowerCase();
}
export function tabFrom(pathname: string, search: string): StudioTab {
  const k = tabKey(pathname, search);
  return MOVED[k] || ((STUDIO_TABS as readonly string[]).includes(k) ? (k as StudioTab) : 'home');
}
export const pathFor = (tab: StudioTab) => (tab === 'home' ? BASE : `${BASE}/${tab}`);

/** The address of a screen: its path, with the query kept except ?tab= and the keys other screens own. */
export function urlFor(tab: StudioTab, search: string, hash = ''): string {
  const q = new URLSearchParams(search);
  q.delete('tab');
  for (const [t, keys] of Object.entries(OWN)) if (t !== tab) for (const k of keys!) q.delete(k);
  const s = q.toString();
  return `${pathFor(tab)}${s ? `?${s}` : ''}${hash}`;
}

/**
 * The query a screen shows, kept true to what is on it so the address can be shared: the persona × territory × region
 * of the writing steps, the region alone elsewhere, and the open ad on Assets. Other keys are left as they are.
 */
export function withState(tab: StudioTab, search: string, s: { persona?: string; territory?: string; region?: string; stub?: string | null }): string {
  const q = new URLSearchParams(search);
  const put = (k: string, v?: string | null) => { if (v) q.set(k, v); else q.delete(k); };
  const scoped = SCOPED.includes(tab);
  put('persona', scoped ? s.persona : null);
  put('territory', scoped ? s.territory : null);
  put('region', s.region);
  if (tab === 'assets' && s.stub !== undefined) { put('stub', s.stub); q.delete('asset'); }
  const out = q.toString();
  return out ? `?${out}` : '';
}
