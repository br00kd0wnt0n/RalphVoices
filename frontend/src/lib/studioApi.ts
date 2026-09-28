// Client for Copy Studio. Two modes:
// - Local (dev, or VITE_STUDIO_API set): `backend/scripts/studio.ts serve` on
//   127.0.0.1. No sign-in; the page asks for a name and sends it as X-Studio-User.
// - Hosted (production builds, or VITE_STUDIO_HOSTED=1 in dev): the main API at
//   `${VITE_API_URL}/studio`, signed in with the same bearer token as api.ts.
// Streams and downloads go through fetch, so the token is sent as a header and
// never put in a URL.

import { authHeaders } from '@/lib/api';

export const HOSTED: boolean = !import.meta.env.VITE_STUDIO_API && (import.meta.env.PROD || import.meta.env.VITE_STUDIO_HOSTED === '1');
export const STUDIO_API: string = HOSTED
  ? `${import.meta.env.VITE_API_URL || '/api'}/studio`
  : import.meta.env.VITE_STUDIO_API || 'http://127.0.0.1:4100/api/studio';

export type Severity = 'compliance' | 'warn' | 'note';
export interface Tone { dry_warm: number; playful_plain: number; short_long: number }
export interface Flag { rule: string; severity: Severity; label: string; source: string; quote: string; why?: string; by: string[]; p?: number }
export type ComplianceStatus = 'pending' | 'cleared' | 'changes_requested';
export interface Override { rule: string; label?: string; reason: string; by: string; at: string }
export interface ReadyMark { signoff_id: string; version: number; sha256: string; ready_by: string; ready_at: string; stub: string; changed_since?: boolean }
export interface Line {
  id: string; batch: string; persona: string; territory: string; field: string; text: string; chars: number;
  angle: string; angle_label: string; structure: string; tone: Tone; tone_label: string; features: string[]; flags: Flag[];
  objection?: string; status: 'generated' | 'checking' | 'checked'; model: string; parent?: string;
  decision?: '' | 'keep' | 'cut' | 'edit'; edited_text?: string; note?: string; decided_by?: string; decided_at?: string;
  overrides?: Override[];
  compliance?: { status: ComplianceStatus; note?: string; by?: string; at?: string; sha256?: string };
  ready?: ReadyMark;
  rechecked_at?: string;
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
  needs_review: number; spend: number; cap: number; cap_window?: 'all' | 'month'; mock: boolean; ask_over: number; studio_dir?: string;
  store?: 'file' | 'pg';
  /** Hosted: the signed-in person. */
  user?: { email: string; name: string | null; admin: boolean } | null;
}
export interface ShortRow { stub: string; id: string; persona: string; territory: string; field: string; platform: string; format: string; text: string; angle: string; structure: string; note: string; flags: string; compliance_flags: string[]; warn_flags: string[] }
export interface CompareLine { id: string; label: string; field: string; text: string; chars: number; angle: string; structure: string; favourite?: boolean; note?: string; stars?: Record<string, boolean> }
export interface CompareSet { name: string; brief: Brief; n_per_model: number; lines: CompareLine[]; created: string; revealed?: boolean; revealed_by?: string; revealed_at?: string }
export interface Reveal { labels: Record<string, string>; tally: Record<string, number>; by_person?: Record<string, Record<string, number>> }
export interface EditRecord { line_id: string; batch_id: string; before: any; after: any; by: string; at: string }
export interface LineVersion { line_id: string; batch_id: string; version: number; field: string; text: string; sha256: string; created_by: string; created_at: string; signoff_id?: string }
export interface Signoff {
  id: string; persona: string; territory: string; version: number; ready_by: string; ready_at: string; sha256: string; expectation_id: string;
  lines: Array<{ line_id: string; batch_id: string; version: number; sha256: string; stub: string; field: string; text: string; chars: number; overrides?: Override[] }>;
}
export interface Expectation { id: string; persona: string; territory: string; signoff_id: string; line_ids: string[]; reason: string; created_by: string; created_at: string; sha256: string }
export interface ReadyLine { line: Line; final_text: string; sha256: string; stub: string; red: Flag[]; compliance: NonNullable<Line['compliance']>; versions: LineVersion[] }
export interface ReadyView { persona: string; territory: string; lines: ReadyLine[]; signoffs: Signoff[]; expectations: Expectation[]; latest: Signoff | null }
export interface RulesVersion { version: string; status: 'draft' | 'active' | 'retired'; notes?: string; created_by?: string; created_at: string }
export type StudioEvent =
  | { type: 'status'; message: string }
  | { type: 'line'; line: Line }
  | { type: 'stats'; stats: RunStats }
  | { type: 'done'; batch: string }
  | { type: 'error'; message: string };

// Who is working. Locally there's no sign-in, so the page asks once and
// remembers the name in this browser; hosted, it's the signed-in email.
const USER_KEY = 'voices-studio-user';
let signedIn = '';
export function setSignedInUser(email: string) { signedIn = email; }
export function getUser(): string {
  if (HOSTED) return signedIn;
  try { return localStorage.getItem(USER_KEY) || ''; } catch { return ''; }
}
export function setUser(name: string) {
  try { localStorage.setItem(USER_KEY, name.trim()); } catch { /* private mode: name lasts for this page only */ }
}

function headers(extra?: HeadersInit): Record<string, string> {
  return { ...(HOSTED ? authHeaders() : { 'X-Studio-User': getUser() }), ...((extra as Record<string, string>) || {}) };
}
async function raw(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${STUDIO_API}${path}`, { ...init, headers: headers(init?.headers) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.message || body.error || `HTTP ${res.status}`), { status: res.status, body });
  }
  return res;
}
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await raw(path, { ...init, headers: { 'Content-Type': 'application/json', ...((init?.headers as Record<string, string>) || {}) } });
  return (await res.json()) as T;
}
const enc = encodeURIComponent;
const lineUrl = (batch: string, line: string) => `/batches/${enc(batch)}/lines/${enc(line)}`;
const qs = (q: Record<string, string | undefined>) => {
  const s = Object.entries(q).filter(([, v]) => v).map(([k, v]) => `${k}=${enc(v!)}`).join('&');
  return s ? `?${s}` : '';
};

/** Save a file the server sends (CSV, Markdown, the deck) without putting a token in a link. */
async function download(path: string, fallbackName: string) {
  const res = await raw(path);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A job's progress as server-sent events, read with fetch so the sign-in header goes with it. */
function events(job: string, on: (e: StudioEvent) => void): { close: () => void } {
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${STUDIO_API}/jobs/${enc(job)}/events`, { headers: headers(), signal: ctrl.signal });
      if (!res.ok || !res.body) { on({ type: 'error', message: `Lost the progress stream (HTTP ${res.status})` }); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = chunk.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n');
          if (data) on(JSON.parse(data));
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') on({ type: 'error', message: 'Lost the progress stream. Reopen the run; Resume checks anything left unchecked.' });
    }
  })();
  return { close: () => ctrl.abort() };
}

export const studio = {
  meta: () => req<Meta>('/meta'),
  estimate: (brief: Brief, ownOnly = false) =>
    req<{ usd: number; calls: number; spent: number; minutes_at_budget: Record<string, number> }>('/estimate', { method: 'POST', body: JSON.stringify({ brief, own_only: ownOnly }) }),
  /** Start a run, or continue one (batch). ownOnly checks the creative director's lines without writing more. */
  generate: (brief: Brief, opts: { confirm?: boolean; batch?: string; ownOnly?: boolean } = {}) =>
    req<{ batch: string; job: string; estimate: number }>('/generate', { method: 'POST', body: JSON.stringify({ brief, confirm: !!opts.confirm, batch: opts.batch, own_only: !!opts.ownOnly }) }),
  batches: (user?: string) => req<RunSummary[]>(`/batches${qs({ user })}`),
  batch: (id: string) => req<Batch>(`/batches/${enc(id)}`),
  decide: (batch: string, line: string, patch: Partial<Pick<Line, 'decision' | 'edited_text' | 'note'>>) =>
    req<Line>(lineUrl(batch, line), { method: 'PATCH', body: JSON.stringify(patch) }),
  history: (line: string) => req<EditRecord[]>(`/lines/${enc(line)}/history`),
  versions: (line: string) => req<LineVersion[]>(`/lines/${enc(line)}/versions`),
  /** Check the lines an interrupted run left unchecked. */
  resume: (batch: string) => req<{ job: string }>(`/batches/${enc(batch)}/resume`, { method: 'POST' }),
  more: (batch: string, line: string, note: string, k = 3) =>
    req<{ job: string }>(`${lineUrl(batch, line)}/more`, { method: 'POST', body: JSON.stringify({ note, k }) }),
  saveTerritory: (code: string | null, territory: Partial<Territory>, note: string) =>
    req<{ code: string; territory: Territory }>(code ? `/territories/${enc(code)}` : '/territories', { method: code ? 'PUT' : 'POST', body: JSON.stringify({ territory, note }) }),
  /** An object URL for an image the server sends (the client logo). */
  imageUrl: async (path: string) => URL.createObjectURL(await (await raw(path)).blob()),
  shortlist: () => req<ShortRow[]>('/shortlist'),
  ingest: (csv: string) => req<{ rows: number; matched: number; kept: number; edited: number; cut: number; unknown: string[]; taste_total: number; shortlist: number }>('/ingest', { method: 'POST', body: csv, headers: { 'Content-Type': 'text/csv' } }),
  compares: () => req<string[]>('/compare'),
  compare: (brief: Brief, models: string[], n: number) => req<{ job: string }>('/compare', { method: 'POST', body: JSON.stringify({ brief, models, n }) }),
  compareSet: (name: string) => req<CompareSet>(`/compare/${enc(name)}`),
  compareMark: (name: string, id: string, patch: { favourite?: boolean; note?: string }) =>
    req<CompareLine>(`/compare/${enc(name)}/lines/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  reveal: (name: string) => req<Reveal>(`/compare/${enc(name)}/reveal`, { method: 'POST' }),

  // Ready for production
  ready: (persona: string, territory: string) => req<ReadyView>(`/ready${qs({ persona, territory })}`),
  signOff: (body: { persona: string; territory: string; line_ids: string[]; expectation: { line_ids: string[]; reason: string } }) =>
    req<{ signoff: Signoff; expectation: Expectation }>('/ready', { method: 'POST', body: JSON.stringify(body) }),
  override: (batch: string, line: string, rule: string, reason: string) =>
    req<Line>(`${lineUrl(batch, line)}/override`, { method: 'POST', body: JSON.stringify({ rule, reason }) }),
  compliance: (batch: string, line: string, status: ComplianceStatus, note?: string) =>
    req<Line>(`${lineUrl(batch, line)}/compliance`, { method: 'PATCH', body: JSON.stringify({ status, note }) }),
  recheck: (batch: string, line: string) => req<Line>(`${lineUrl(batch, line)}/recheck`, { method: 'POST' }),

  // Rules versions (hosted only)
  rules: () => req<RulesVersion[]>('/rules'),
  activateRules: (version: string) => req<RulesVersion[]>(`/rules/${enc(version)}/activate`, { method: 'POST' }),
  uploadRules: (version: string, rules: unknown, notes: string) => req<RulesVersion[]>('/rules', { method: 'POST', body: JSON.stringify({ version, rules, notes }) }),

  download,
  events,
};

/** Hosted: may the signed-in person use the Studio? False when it's switched off (404) or they aren't on the list. */
export async function studioAccess(): Promise<{ allowed: boolean; admin: boolean }> {
  if (!HOSTED) return { allowed: true, admin: false };
  try {
    const res = await fetch(`${STUDIO_API}/access`, { headers: authHeaders() });
    return res.ok ? await res.json() : { allowed: false, admin: false };
  } catch { return { allowed: false, admin: false }; }
}
