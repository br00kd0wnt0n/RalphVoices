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
/** Where the ads run: US and Canada are separate ads. The naming code carries it. */
export type Region = 'US' | 'CA';
export const REGION_NAMES: Record<Region, string> = { US: 'US', CA: 'Canada' };
/** Shown on Write & brief and in "Who this is" when Canada is chosen. */
export const CANADA_NOTE = 'These personas are built on US research; check that they hold for Canadian audiences.';
/** superseded_by: a later sign-off of its set left it out (it keeps its code). */
export interface ReadyMark { signoff_id: string; version: number; sha256: string; ready_by: string; ready_at: string; stub: string; codes?: string[]; changed_since?: boolean; superseded_by?: string }
export interface Line {
  id: string; batch: string; persona: string; territory: string; region?: Region; field: string; text: string; chars: number;
  angle: string; angle_label: string; structure: string; tone: Tone; tone_label: string; features: string[]; flags: Flag[];
  objection?: string; status: 'generated' | 'checking' | 'checked'; model: string; parent?: string;
  decision?: '' | 'keep' | 'cut' | 'edit'; edited_text?: string; note?: string; decided_by?: string; decided_at?: string;
  overrides?: Override[];
  compliance?: { status: ComplianceStatus; note?: string; by?: string; at?: string; sha256?: string; upload_id?: string; code?: string; send_back?: 'copy' | 'asset'; client_by?: string };
  ready?: ReadyMark;
  /** Who added a person's line (Write & brief, or Add a line in Review). */
  added_by?: string;
  rechecked_at?: string;
  /** Carousel on-image text written as a card sequence: its card number and sequence. */
  card?: number; sequence_id?: string;
}
/** Mirrors the backend's isEdited/finalText (engine.ts): a saved edit counts unless the line is cut, whatever button was pressed last. */
export const isEdited = (l: Pick<Line, 'decision' | 'edited_text' | 'text'>) => !!l.edited_text && l.edited_text !== l.text && l.decision !== 'cut';
export const finalText = (l: Pick<Line, 'decision' | 'edited_text' | 'text'>) => (isEdited(l) ? l.edited_text! : l.text);
export interface OwnLine { text: string; field: string }
export interface Brief {
  name?: string; persona: string; territory: string; region?: Region; fields: string[]; tone: Tone;
  banned_words: string[]; banned_ideas: string[]; reference_lines: string[]; own_lines?: OwnLine[]; n: number; model: string;
  /** Carousel territories with on-image text ticked: card sequences to write, and cards in each. */
  carousel?: { sequences: number; cards: number };
  /** Client only: the person has changed the fields in this brief, so a new territory keeps them (studioFields.ts). */
  fields_touched?: boolean;
  /** Lines Studio writes per field (Write's counts); n is their sum. */
  field_counts?: Record<string, number>;
}
export interface RunStats {
  generated: number; near_duplicates_removed: number; similar_flagged: number;
  timings_ms: Record<string, number>; usd: Record<string, number>; usd_total: number;
}
export interface Batch { id: string; brief: Brief; created: string; created_by?: string; updated?: string; rules_version?: string; lines: Line[]; stats: RunStats }
export interface RunSummary {
  id: string; name: string; persona: string; territory: string; region?: Region; created: string; updated: string; created_by: string;
  lines: number; yours: number; kept: number; undecided: number; usd: number;
  /** Lines left unchecked when a run was interrupted (e.g. a server restart). */
  unchecked: number;
  /** The run's round (none before rounds: R1). */
  round?: string;
}
export interface FieldSpec { platform: string; label: string; visible: number; max: number; source: string; /** Options Write asks for by default (rules v2.11+). */ default_count?: number }
export interface Territory {
  persona: string; name: string; angle: string; format: string; premise: string; source: string;
  /** The pitched headline ("headline as sold"), from the concept cards (rules v2.4+). */
  headline?: string; headline_source?: string; headline_note?: string; pitched_name?: string; name_note?: string;
  status?: string; origin?: 'pitch' | 'edited' | 'new'; note?: string; updated_by?: string; updated_at?: string;
  /** The fields a brief for it starts with, by its format (server's defaultFields). */
  default_fields?: string[];
  history?: Array<{ at: string; by: string; note: string; before: Partial<Territory> | null }>;
}
export interface PersonaContext {
  who?: string; tension?: string; who_source?: string; platforms: string[];
  turn_offs: Array<{ id: string; rule: string; source: string; severity?: string }>;
  language: Array<{ text: string; caution: boolean; source: string }>;
}
export interface Meta {
  personas: Record<string, { name: string; default_fields: string[]; triggers: Array<{ id: string; label: string; detail?: string; source?: string }>; context?: PersonaContext }>;
  /** Source codes (TM, EP, CLB…) → titles, for plain-words sources. */
  sources?: Record<string, string>;
  what_to_do?: Record<string, string>;
  can_set_compliance?: boolean;
  can_override?: boolean;
  /** May this person sign lines off at Ready for production (the creative lead or an admin). */
  can_sign_off?: boolean;
  territories: Record<string, Territory>;
  formats: string[];
  /** Where ads can run, and the naming code's pattern (from the backend's one definition). */
  regions?: Region[];
  code_pattern?: string;
  fields: Record<string, FieldSpec>;
  structures: Record<string, string>;
  tone_controls: Record<string, Record<string, string>>;
  needs_review: number; spend: number; cap: number; cap_window?: 'all' | 'month'; mock: boolean; ask_over: number; studio_dir?: string;
  store?: 'file' | 'pg';
  /** Pre-flight needs the database; can_set_ready: may this person mark assets Ready to traffic. */
  preflight?: { enabled: boolean; storage?: string; engine?: string; can_set_ready?: boolean };
  /** Hosted: the signed-in person. */
  user?: { email: string; name: string | null; admin: boolean } | null;
  /** The rounds and the active one; can_edit: may this person create rounds and set the active one (admins). */
  rounds?: RoundsState & { can_edit: boolean };
}
export interface ShortRow { stub: string; id: string; batch?: string; decision?: string; signed_off?: string; round?: string; persona: string; territory: string; region?: Region; field: string; platform: string; format: string; text: string; angle: string; structure: string; note: string; flags: string; compliance_flags: string[]; warn_flags: string[] }
export interface CompareLine { id: string; label: string; field: string; text: string; chars: number; angle: string; structure: string; favourite?: boolean; note?: string; stars?: Record<string, boolean> }
export interface CompareSet { name: string; brief: Brief; n_per_model: number; lines: CompareLine[]; created: string; revealed?: boolean; revealed_by?: string; revealed_at?: string }
export interface Reveal { labels: Record<string, string>; tally: Record<string, number>; by_person?: Record<string, Record<string, number>> }
export interface EditRecord { line_id: string; batch_id: string; before: any; after: any; by: string; at: string }
export interface LineVersion { line_id: string; batch_id: string; version: number; field: string; text: string; sha256: string; created_by: string; created_at: string; signoff_id?: string }
export interface SignedField { line_id: string; batch_id: string; version: number; sha256: string; field: string; text: string; chars: number; overrides?: Override[] }
/** A live version: one code = one ad = a set of fields (Meta primary + headline; TikTok caption). */
export interface SignedVersion { code: string; visual: string; number: number; platform: string; fields: Record<string, SignedField> }
export interface Signoff {
  id: string; persona: string; territory: string; region?: Region; version: number; ready_by: string; ready_at: string; sha256: string; expectation_id: string;
  lines: Array<SignedField & { stub: string; codes?: string[] }>;
  /** Missing on sign-offs from before live versions (one code per line). */
  versions?: SignedVersion[];
  on_image?: Array<SignedField & { visual: string; visual_key: string; card?: number }>;
  checks?: VersionCheck[];
}
/** stubs: the codes expected to lead. */
export interface Expectation { id: string; persona: string; territory: string; signoff_id: string; line_ids: string[]; stubs?: string[]; reason: string; created_by: string; created_at: string; sha256: string }
/** Version checks at Ready (inform, never block). */
export interface VersionFlag { rule: string; severity: 'red' | 'amber'; label: string; source: string; fields: string[]; quote: string; why?: string; by: 'rule' | 'model'; other?: string }
export interface VersionCheck { code: string; key: string; flags: VersionFlag[]; conflicts: 'checked' | 'not_checked' | 'failed'; at?: string }
export type FieldRole = 'required' | 'optional' | 'per_visual';
/** A kept line on Ready: role, platform, and the codes it's in (in: "A1", "on-image A"). */
export interface ReadyLine { line: Line; final_text: string; sha256: string; role: FieldRole; platform: string; in: string[]; red: Flag[]; versions: LineVersion[] }
export interface DraftVersion { visual: string; fields: Record<string, string>; platform?: string }
/** on_image: per visual letter, a line id, or on a carousel the cards in order ('' for a card with no text). */
export interface ReadyDraft { versions: DraftVersion[]; on_image: Record<string, string | string[]> }
export interface PlannedVersion extends DraftVersion {
  code: string; number: number; platform: string; issues: string[]; checks?: VersionCheck;
  compliance: { status: ComplianceStatus; note?: string; client_by?: string; by?: string; at?: string; send_back?: 'copy' | 'asset' };
}
export interface ReadyView {
  persona: string; territory: string; region: Region; lines: ReadyLine[]; draft: ReadyDraft;
  plan: { versions: PlannedVersion[]; on_image: Array<{ visual: string; visual_key: string; line_id: string; card?: number; issues: string[] }>; issues: string[]; check_estimate: { usd: number; calls: number } };
  /** Per platform (META, TT): the fields a version has, by role. */
  fields: Record<string, { required: string[]; optional: string[]; per_visual: string[] }>;
  signoffs: Signoff[]; expectations: Expectation[]; latest: Signoff | null;
}
export interface RuleEntry { id: string; rule: string; severity: 'compliance' | 'warn' | 'note'; source: string; applies_to: 'text' | 'visual' | 'both'; status?: string; what_to_do?: string }
export interface ActiveRules {
  version: string; updated?: string; compliance: RuleEntry[]; brand: RuleEntry[]; clarity: RuleEntry[];
  personas: Record<string, { name: string; triggers: Array<{ label: string; detail?: string; source?: string }>; turn_offs: RuleEntry[]; language: Array<{ text: string; caution: boolean; source: string }> }>;
  disclaimer?: (RuleEntry & { text: string | null; active: boolean }) | null;
}
export interface RulesVersion { version: string; status: 'draft' | 'active' | 'retired'; notes?: string; created_by?: string; created_at: string; activated_by?: string | null; activated_at?: string | null }
// ---------- Pre-flight ----------
export interface SignedCopy { line_id: string; field: string; label: string; text: string; version: number; card?: number }
export interface PfUpload { id: string; kind: 'static' | 'carousel' | 'video'; files: Array<{ position: number; filename: string; content_type: string; size: number; aspect?: '1:1' | '4:5' | '9:16' | null }>; uploaded_by: string; uploaded_at: string; stubs: string[] }
export interface PfStatus { status: 'open' | 'ready'; ready_by?: string; ready_at?: string; upload_id?: string }
export interface PfStub {
  /** The round of its sign-off; test: a test round's code (never handed off). */
  round?: string; test?: boolean;
  stub: string; persona: string; territory: string; signoff_id: string; ready_by: string; ready_at: string; copy: SignedCopy[];
  region: Region;
  /** Codes on the same visual share it (null for an earlier v# code): suggested as one upload. */
  visual_key: string | null;
  upload: PfUpload | null;
  /** The sizes the code is expected in (by format), uploaded, and missing (amber; noted in the handoff). */
  sizes?: PfSizes;
  /** Ready to traffic = Pre-flight passed AND compliance cleared (status is only the Pre-flight part). */
  traffic: Traffic;
  audit: { id: string; status: string; usd: number; red: number; amber: number; grey: number; open_red: number; finished_at: string | null; error: string | null; stale?: string | null } | null;
  status: PfStatus;
}
export interface PfFlag {
  id: string; rule: string; severity: 'red' | 'amber' | 'grey'; label: string; source: string; quote?: string; why?: string; where?: string;
  check?: string; persona?: string; cross_persona?: boolean;
  /** The size the flag is about (1:1, 4:5, 9:16), on a code with several. */
  size?: string;
  frame?: { upload_id?: string; position?: number; label?: string; description?: string };
  override: { reason: string; by: string; at: string } | null;
  agreements: Array<{ by: string; agree: boolean; note?: string; at: string }>;
  mine: boolean | null;
}
export interface PfSizes { expected: string[]; uploaded: string[]; missing: string[] }
export interface PfReport {
  stub: string; persona: string; territory: string; region: Region; visual_key: string | null; signoff_id: string; copy: SignedCopy[]; upload: PfUpload | null;
  sizes?: PfSizes;
  same_visual_as: string[]; on_asset_copy: SignedCopy[]; post_copy: SignedCopy[];
  /** Set when the upload's type doesn't fit the code's format (a note, never a block). */
  format_note?: string | null;
  history: Array<{ id: string; kind: string; uploaded_by: string; uploaded_at: string; files: number }>;
  audit: null | { id: string; upload_id: string; status: string; engine: string; stale?: string | null; rules_version?: string; usd: number; error?: string; started_by?: string; started_at: string; finished_at: string | null;
    result: null | { text_found: string; transcript?: string; copy_match?: Array<{ field: string; signed_off: string; found: string; similarity: number; status: string; card?: number; found_on?: number; size?: string }>; features: Record<string, number>; objection?: string; notes?: string[]; frames_unavailable?: boolean;
      report?: { copy_match?: Array<{ field: string; signed_off: string; found: string; similarity: number; status: string; card?: number; found_on?: number; size?: string }>; tagged_features?: string[]; set_aside?: Array<{ rule: string; quote?: string; why: string }> } } };
  flags: PfFlag[]; status: PfStatus;
  compliance?: CodeCompliance;
  traffic?: Traffic;
}
export interface Traffic { ready: boolean; preflight: 'passed' | 'open'; compliance: ComplianceStatus; words: string; blocker?: string; legacy?: boolean }
/** A code's compliance status on its current asset (Compliance step, after Pre-flight). */
export interface CodeCompliance {
  status: ComplianceStatus; note?: string; at?: string; send_back?: 'copy' | 'asset';
  /** by: who recorded it in Studio (the producer); client_by: who at Trupanion made the decision. */
  by?: string; client_by?: string; recorded?: boolean; wording_edited?: boolean;
  stale?: string; on_asset: boolean; overrides: string[];
  override_details?: Array<{ label: string; reason: string; by: string }>;
}
export interface ComplianceAsset {
  upload_id: string; persona: string; territory: string; region: Region; upload: PfUpload;
  audit: { id: string; status: string; finished_at: string | null; stale?: string | null } | null;
  flags: Array<{ id: string; rule: string; severity: 'red' | 'amber' | 'grey'; for_stub: string | null; label: string; quote?: string; why?: string; where?: string; source?: string; cross_persona: boolean; override: { reason: string; by: string; at: string } | null }>;
  codes: Array<{ stub: string; copy: SignedCopy[]; ready: PfStatus; traffic: Traffic; compliance: CodeCompliance }>;
  status: ComplianceStatus;
}
export interface ComplianceView { assets: ComplianceAsset[]; waiting: Array<{ stub: string; persona: string; territory: string; region: Region; copy: SignedCopy[] }> }

export type StudioEvent =
  | { type: 'status'; message: string }
  | { type: 'line'; line: Line }
  | { type: 'stats'; stats: RunStats }
  | { type: 'done'; batch: string }
  | { type: 'error'; message: string };

// Who is working. Locally there's no sign-in, so the page asks once and
// remembers the name in this browser; hosted, it's the signed-in email.
const USER_KEY = 'voices-studio-user';

// ---------- rounds ----------
/** A round (R1, R2…; R0 a test run-through): stamped on new runs and sign-offs; views show the active one by default. */
/** label: what people see ("Month 1", "Test"); the id (R1…) is what's stored and stamped. */
export interface Round { id: string; name: string; label?: string; from?: string; test?: boolean; created_by?: string; created_at?: string; /** When the round's assets are due (YYYY-MM-DD). */ assets_due?: string }
export interface RoundsState { active: string; rounds: Round[] }
const ROUND_VIEW_KEY = 'voices-studio-round-view';
/** 'active': this round only (the default); 'all': every round, test rounds marked. Sent as ?round=all on every request. */
export type RoundViewMode = 'active' | 'all';
let roundViewMode: RoundViewMode = (() => { try { return localStorage.getItem(ROUND_VIEW_KEY) === 'all' ? 'all' : 'active'; } catch { return 'active'; } })();
export const getRoundView = (): RoundViewMode => roundViewMode;
export function setRoundView(v: RoundViewMode) {
  roundViewMode = v;
  try { localStorage.setItem(ROUND_VIEW_KEY, v); } catch { /* private mode: this page only */ }
}
const withRound = (path: string) => (roundViewMode === 'all' ? `${path}${path.includes('?') ? '&' : '?'}round=all` : path);
/**
 * A round as people see it: "Month 1", "Test", or the admin's label (the client's schedule uses "R1/R2" for review
 * rounds, so Studio shows months; the ids R0, R1… are unchanged underneath). Mirrors the server's monthLabel.
 */
export const roundLabel = (r?: Pick<Round, 'id' | 'label' | 'test'> | null) => (r ? r.label?.trim() || (r.test ? 'Test' : `Month ${Number(r.id.replace(/^R/i, '')) || r.id}`) : '');
/** The label for a round id, from /meta's rounds. */
export const roundName = (rounds: RoundsState | undefined, id?: string) => (id ? roundLabel(rounds?.rounds.find(r => r.id === id) || { id }) : '');
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
  const res = await fetch(`${STUDIO_API}${withRound(path)}`, { ...init, headers: headers(init?.headers) });
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

/** Parse CSV (quotes, commas and newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** Download a CSV the server sends, keeping only the rows that pass `keep` (by header name). Returns the rows kept. */
async function downloadCsvRows(path: string, name: string, keep: (row: Record<string, string>) => boolean): Promise<number> {
  const [head, ...rows] = parseCsv(await (await raw(path)).text());
  const kept = rows.filter(r => r.length > 1 && keep(Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))));
  const url = URL.createObjectURL(new Blob([[head, ...kept].map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return kept.length;
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
    req<{ usd: number; calls: number; spent: number; minutes_at_budget: Record<string, number>; allocation: { total: number; summary: string; fields: Array<{ field: string; count: number }>; sequences: { field: string; sequences: number; cards: number } | null } }>('/estimate', { method: 'POST', body: JSON.stringify({ brief, own_only: ownOnly }) }),
  /** Start a run, or continue one (batch). ownOnly checks the creative director's lines without writing more. */
  generate: (brief: Brief, opts: { confirm?: boolean; batch?: string; ownOnly?: boolean } = {}) =>
    req<{ batch: string; job: string; estimate: number }>('/generate', { method: 'POST', body: JSON.stringify({ brief, confirm: !!opts.confirm, batch: opts.batch, own_only: !!opts.ownOnly }) }),
  batches: (user?: string) => req<RunSummary[]>(`/batches${qs({ user })}`),
  batch: (id: string) => req<Batch>(`/batches/${enc(id)}`),
  decide: (batch: string, line: string, patch: Partial<Pick<Line, 'decision' | 'edited_text' | 'note'>> & { source?: 'shortlist' }) =>
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
  /** The set with its default versions (the last sign-off's, or a first pairing of the kept lines). */
  ready: (persona: string, territory: string, region: Region = 'US') => req<ReadyView>(`/ready${qs({ persona, territory, region })}`),
  /** The versions as built on screen: codes, what's missing, free checks, compliance per version. */
  readyPreview: (persona: string, territory: string, region: Region, draft: ReadyDraft) =>
    req<ReadyView>('/ready/preview', { method: 'POST', body: JSON.stringify({ persona, territory, region, ...draft }) }),
  /** The conflicts check (a model call per version not yet checked on this wording; see plan.check_estimate). */
  readyCheck: (persona: string, territory: string, region: Region, draft: ReadyDraft) =>
    req<ReadyView>('/ready/check', { method: 'POST', body: JSON.stringify({ persona, territory, region, ...draft }) }),
  /** expect_latest: the latest sign-off the screen showed (null for none); a different one now is a 409 ("X just signed this off"). */
  signOff: (body: { persona: string; territory: string; region: Region } & ReadyDraft & { expectation: { codes: string[]; reason: string }; expect_latest: string | null }) =>
    req<{ signoff: Signoff; expectation: Expectation }>('/ready', { method: 'POST', body: JSON.stringify(body) }),
  override: (batch: string, line: string, rule: string, reason: string) =>
    req<Line>(`${lineUrl(batch, line)}/override`, { method: 'POST', body: JSON.stringify({ rule, reason }) }),
  compliance: (batch: string, line: string, status: ComplianceStatus, note?: string) =>
    req<Line>(`${lineUrl(batch, line)}/compliance`, { method: 'PATCH', body: JSON.stringify({ status, note }) }),
  recheck: (batch: string, line: string) => req<Line>(`${lineUrl(batch, line)}/recheck`, { method: 'POST' }),

  // Pre-flight
  pfStubs: () => req<PfStub[]>('/preflight/stubs'),
  /** Upload the visual for a stub; `also`: other signed-off stubs that run on the same visual. */
  /** sizes: each file's size (1:1, 4:5, 9:16; '' to let the server read it), in file order. */
  pfUpload: async (stub: string, files: File[], also: string[] = [], sizes: string[] = []) => {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    if (also.length) form.append('also', also.join(','));
    if (sizes.length) form.append('sizes', sizes.join(','));
    const res = await raw(`/preflight/stubs/${enc(stub)}/uploads`, { method: 'POST', body: form });
    return (await res.json()) as { upload_id: string; kind: string; storage: string; estimate: { usd: number; seconds: number; sizes?: number }; format_notes?: string[]; sizes?: Array<{ size: string; files: string[] }> };
  },
  pfAudit: (uploadId: string, confirm = false) => req<{ audit: string; job: string; estimate: { usd: number; seconds: number } }>(`/preflight/uploads/${enc(uploadId)}/audit`, { method: 'POST', body: JSON.stringify({ confirm }) }),
  complianceView: () => req<ComplianceView>('/compliance'),
  setAssetCompliance: (upload: string, body: { status: ComplianceStatus; note?: string; send_back?: 'copy' | 'asset'; codes?: string[]; client_by?: string }) =>
    req<{ upload_id: string; codes: string[]; status: ComplianceStatus }>(`/compliance/assets/${enc(upload)}`, { method: 'POST', body: JSON.stringify(body) }),
  pfReport: (stub: string) => req<PfReport>(`/preflight/stubs/${enc(stub)}/report`),
  pfFile: (uploadId: string, position: number) => `/preflight/files/${enc(uploadId)}/${position}`,
  pfAgree: (flagId: string, agree: boolean, note?: string) => req<unknown>(`/preflight/flags/${enc(flagId)}/agree`, { method: 'POST', body: JSON.stringify({ agree, note }) }),
  pfOverride: (flagId: string, reason: string) => req<unknown>(`/preflight/flags/${enc(flagId)}/override`, { method: 'POST', body: JSON.stringify({ reason }) }),
  pfReady: (stub: string, ready: boolean) => req<PfStatus>(`/preflight/stubs/${enc(stub)}/ready`, { method: 'POST', body: JSON.stringify({ ready }) }),
  pfAgreement: () => req<{ marked: number; agree: number; rate: number | null; by_severity: Record<string, { marked: number; agree: number }> }>('/preflight/agreement'),

  /** The live rules, read-only and in plain words (everyone). */
  activeRules: () => req<ActiveRules>('/rules/active'),
  // Rules versions (hosted only)
  rules: () => req<RulesVersion[]>('/rules'),
  activateRules: (version: string) => req<RulesVersion[]>(`/rules/${enc(version)}/activate`, { method: 'POST' }),
  /** Rounds (admin): create or rename one (optionally making it active), or set the active round. */
  saveRound: (round: { id: string; name: string; label?: string; from?: string; test?: boolean; activate?: boolean; assets_due?: string }) => req<RoundsState>('/rounds', { method: 'POST', body: JSON.stringify(round) }),
  activateRound: (id: string) => req<RoundsState>(`/rounds/${enc(id)}/activate`, { method: 'POST' }),
  uploadRules: (version: string, rules: unknown, notes: string, activate = false) => req<RulesVersion[]>('/rules', { method: 'POST', body: JSON.stringify({ version, rules, notes, activate }) }),

  download,
  downloadCsvRows,
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
