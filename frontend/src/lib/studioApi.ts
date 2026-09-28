// Client for the local B1-lite Copy Studio API (`backend/scripts/studio.ts serve`).
// Dev-only: it talks to 127.0.0.1, never to the production API client in api.ts.

export const STUDIO_API: string = import.meta.env.VITE_STUDIO_API || 'http://127.0.0.1:4100/api/studio';

export type Severity = 'compliance' | 'warn' | 'note';
export interface Tone { dry_warm: number; playful_plain: number; short_long: number }
export interface Flag { rule: string; severity: Severity; label: string; source: string; quote: string; why?: string; by: string[]; p?: number }
export interface Line {
  id: string; batch: string; persona: string; territory: string; field: string; text: string; chars: number;
  angle: string; angle_label: string; structure: string; tone: Tone; tone_label: string; features: string[]; flags: Flag[];
  objection?: string; status: 'generated' | 'checking' | 'checked'; model: string; parent?: string;
  decision?: '' | 'keep' | 'cut' | 'edit'; edited_text?: string; note?: string; decided_by?: string; decided_at?: string;
}
export interface OwnLine { text: string; field: string }
export interface Brief {
  name?: string; persona: string; territory: string; fields: string[]; tone: Tone;
  banned_words: string[]; banned_ideas: string[]; reference_lines: string[]; own_lines?: OwnLine[]; n: number; model: string;
}
export interface RunStats {
  generated: number; near_duplicates_removed: number; similar_flagged: number;
  timings_ms: Record<string, number>; usd: Record<string, number>; usd_total: number;
}
export interface Batch { id: string; brief: Brief; created: string; created_by?: string; updated?: string; rules_version?: string; lines: Line[]; stats: RunStats }
export interface RunSummary {
  id: string; name: string; persona: string; territory: string; created: string; updated: string; created_by: string;
  lines: number; yours: number; kept: number; undecided: number; usd: number;
  /** Lines left unchecked when a run was interrupted (e.g. a server restart). */
  unchecked: number;
}
export interface FieldSpec { platform: string; label: string; visible: number; max: number; source: string }
export interface Territory {
  persona: string; name: string; angle: string; format: string; premise: string; source: string;
  status?: string; origin?: 'pitch' | 'edited' | 'new'; note?: string; updated_by?: string; updated_at?: string;
  history?: Array<{ at: string; by: string; note: string; before: Partial<Territory> | null }>;
}
export interface Meta {
  personas: Record<string, { name: string; default_fields: string[]; triggers: Array<{ id: string; label: string }> }>;
  territories: Record<string, Territory>;
  formats: string[];
  fields: Record<string, FieldSpec>;
  structures: Record<string, string>;
  tone_controls: Record<string, Record<string, string>>;
  needs_review: number; spend: number; cap: number; mock: boolean; ask_over: number; studio_dir: string;
}
export interface RefDoc { id: string; title: string; kind: 'md' | 'file'; available: boolean }
export interface ShortRow { stub: string; id: string; persona: string; territory: string; field: string; platform: string; format: string; text: string; angle: string; structure: string; note: string; flags: string; compliance_flags: string[]; warn_flags: string[] }
export interface CompareLine { id: string; label: string; field: string; text: string; chars: number; angle: string; structure: string; favourite?: boolean; note?: string }
export interface CompareSet { name: string; brief: Brief; n_per_model: number; lines: CompareLine[]; created: string; revealed?: boolean }
export type StudioEvent =
  | { type: 'status'; message: string }
  | { type: 'line'; line: Line }
  | { type: 'stats'; stats: RunStats }
  | { type: 'done'; batch: string }
  | { type: 'error'; message: string };

// Who is working. Locally there's no sign-in, so the page asks once and
// remembers the name in this browser; the hosted build uses the signed-in user.
const USER_KEY = 'voices-studio-user';
export function getUser(): string {
  try { return localStorage.getItem(USER_KEY) || ''; } catch { return ''; }
}
export function setUser(name: string) {
  try { localStorage.setItem(USER_KEY, name.trim()); } catch { /* private mode: name lasts for this page only */ }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${STUDIO_API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Studio-User': getUser(), ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
  return body as T;
}

export const studio = {
  meta: () => req<Meta>('/meta'),
  estimate: (brief: Brief, ownOnly = false) =>
    req<{ usd: number; calls: number; spent: number; minutes_at_budget: Record<string, number> }>('/estimate', { method: 'POST', body: JSON.stringify({ brief, own_only: ownOnly }) }),
  /** Start a run, or continue one (batch). ownOnly checks the creative director's lines without writing more. */
  generate: (brief: Brief, opts: { confirm?: boolean; batch?: string; ownOnly?: boolean } = {}) =>
    req<{ batch: string; job: string; estimate: number }>('/generate', { method: 'POST', body: JSON.stringify({ brief, confirm: !!opts.confirm, batch: opts.batch, own_only: !!opts.ownOnly }) }),
  batches: (user?: string) => req<RunSummary[]>(`/batches${user ? `?user=${encodeURIComponent(user)}` : ''}`),
  batch: (id: string) => req<Batch>(`/batches/${encodeURIComponent(id)}`),
  decide: (batch: string, line: string, patch: Partial<Pick<Line, 'decision' | 'edited_text' | 'note'>>) =>
    req<Line>(`/batches/${encodeURIComponent(batch)}/lines/${encodeURIComponent(line)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  /** Check the lines an interrupted run left unchecked. */
  resume: (batch: string) => req<{ job: string }>(`/batches/${encodeURIComponent(batch)}/resume`, { method: 'POST' }),
  more: (batch: string, line: string, note: string, k = 3) =>
    req<{ job: string }>(`/batches/${encodeURIComponent(batch)}/lines/${encodeURIComponent(line)}/more`, { method: 'POST', body: JSON.stringify({ note, k }) }),
  saveTerritory: (code: string | null, territory: Partial<Territory>, note: string) =>
    req<{ code: string; territory: Territory }>(code ? `/territories/${encodeURIComponent(code)}` : '/territories', { method: code ? 'PUT' : 'POST', body: JSON.stringify({ territory, note }) }),
  docs: () => req<RefDoc[]>('/docs'),
  docText: async (id: string) => {
    const res = await fetch(`${STUDIO_API}/docs/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return res.text();
  },
  shortlist: () => req<ShortRow[]>('/shortlist'),
  ingest: (csv: string) => req<{ rows: number; matched: number; kept: number; edited: number; cut: number; unknown: string[]; taste_total: number; shortlist: number }>('/ingest', { method: 'POST', body: csv, headers: { 'Content-Type': 'text/csv' } }),
  compares: () => req<string[]>('/compare'),
  compare: (brief: Brief, models: string[], n: number) => req<{ job: string }>('/compare', { method: 'POST', body: JSON.stringify({ brief, models, n }) }),
  compareSet: (name: string) => req<CompareSet>(`/compare/${encodeURIComponent(name)}`),
  compareMark: (name: string, id: string, patch: { favourite?: boolean; note?: string }) =>
    req<CompareLine>(`/compare/${encodeURIComponent(name)}/lines/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  reveal: (name: string) => req<{ labels: Record<string, string>; tally: Record<string, number> }>(`/compare/${encodeURIComponent(name)}/reveal`, { method: 'POST' }),
  url: (path: string) => `${STUDIO_API}${path}`,
  events: (job: string, on: (e: StudioEvent) => void): EventSource => {
    const es = new EventSource(`${STUDIO_API}/jobs/${encodeURIComponent(job)}/events`);
    es.onmessage = m => on(JSON.parse(m.data));
    es.onerror = () => es.close();
    return es;
  },
};
