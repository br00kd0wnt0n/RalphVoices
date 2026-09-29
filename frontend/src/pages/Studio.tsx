// Copy Studio. Locally it talks to `npx tsx scripts/studio.ts serve` (no
// sign-in); hosted, to /api/studio as the signed-in user (see studioApi.ts).
// Built for a shared screen: large type, high contrast, flags as neutral chips
// (red = compliance, amber = warning). Nothing here is a score. The last step,
// Ready for production, is creative sign-off, never "approval".

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HOSTED, getUser, setSignedInUser, setUser, studio, studioAccess, type Batch, type Brief, type CompareSet, type Flag, type Line, type Meta, type OwnLine, type RunSummary, type ShortRow, type StudioEvent, type Territory, type Tone, type EditRecord, type LineVersion, type Reveal, type ComplianceStatus, type ReadyView, type RulesVersion, type ActiveRules, type RuleEntry, type PfStub, type PfReport, type PfFlag } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { ArrowLeft, HelpCircle, ScrollText, Shuffle } from 'lucide-react';

const PINK = '#D94D8F';
type Tab = 'home' | 'territories' | 'brief' | 'review' | 'shortlist' | 'ready' | 'preflight' | 'compare' | 'rules';
// The writing flow, in order. Blind compare sits apart from it; Live comes later (B3b).
const FLOW: Array<[Tab, string]> = [['territories', 'Territories'], ['brief', 'Write & brief'], ['review', 'Review'], ['shortlist', 'Shortlist'], ['ready', 'Ready for production'], ['preflight', 'Pre-flight']];
// Below 1600 px (and inside the tools.ralph.world frame) the bar uses short labels; the full name is in the tooltip.
const SHORT: Partial<Record<Tab, string>> = { brief: 'Write', ready: 'Ready' };
// Deep links for the demo: /studio?tab=review&batch=<id>&open=L07 (opens that line's first flag), &compare=<name>,
// ?tab=ready&persona=<P>&territory=<T>, ?tab=preflight&stub=<naming code>.
const params = new URLSearchParams(window.location.search);

// ---------- small building blocks ----------

function PinkButton({ className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className={cn('rounded-lg px-5 py-2.5 text-base font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-40', className)} style={{ background: PINK }} />;
}
function GhostButton({ className, active, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button {...p} className={cn('rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-40', active ? 'border-[#ECEDEF] bg-[#ECEDEF] text-[#0E0F12]' : 'border-[#343946] bg-transparent text-[#C9CCD2] hover:border-[#6B7280] hover:text-[#ECEDEF]', className)} />;
}
function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[#858B96]">{children}</div>;
}
function Chip({ children, tone = 'grey', className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'grey' | 'amber' | 'red' | 'outline' }) {
  const t = { grey: 'bg-[#1C1F26] text-[#A3A8B1] border-[#343946]', amber: 'bg-amber-400/10 text-amber-200 border-amber-400/40', red: 'bg-red-500/10 text-red-200 border-red-500/45', outline: 'bg-transparent text-[#A3A8B1] border-[#343946]' }[tone];
  return <span {...p} className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[13px] font-medium', t, className)}>{children}</span>;
}
// Plain names for the chips; the full rule, quote and source open on click.
const CHIP: Record<string, string> = {
  LIMIT_VISIBLE: 'cut off on screen', LIMIT_MAX: 'too long for the field', NEAR_DUP: 'similar line', CL_GLANCE: 'not a glance read', CL_PRODUCT: 'product unclear',
  COMP_UGC_MEMBER: 'cast a member', COMP_VERBATIM: 'verbatim quote', FIG_UNSOURCED: 'unsourced figure', FIG_CITATION: 'needs citation', FIG_ATTRIBUTION: 'misattributed figure',
  COMP_DIRECT_PAY: 'direct pay caveat', COMP_PAYS_FOR_ITSELF: 'pays for itself', COMP_PAID_SHARE: 'whole bill', COMP_PREEXISTING: 'pre-existing', COMP_ROUTINE: 'routine care',
  COMP_CLAIM_SPEED: 'claim speed', COMP_CHEAP_LOCKED: 'cheap / locked price', COMP_PRICE_LEAD: 'price lead', COMP_COVERAGE_CAVEAT: 'coverage caveat', COMP_SUPERLATIVE: 'superlative',
  COMP_FACT_FRAMING: 'figure framing', BR_NAMING: '"pet insurance"', BR_CASE: 'all caps', BR_BOAST: 'boastful', BR_PLAIN: 'not plain', BR_SAD_PET: 'sad pet', CHECK_FAILED: 'check failed',
};
const chipName = (rule: string) => CHIP[rule] || (rule.startsWith('BRIEF_BANNED:') ? `banned: ${rule.slice(13)}` : /^[A-Z]+_T_/.test(rule) ? `turn-off: ${rule.replace(/^[A-Z]+_T_/, '').replace(/_/g, ' ').toLowerCase()}` : rule.replace(/_/g, ' ').toLowerCase());
const sevTone = (s: Flag['severity']) => (s === 'compliance' ? 'red' : s === 'warn' ? 'amber' : 'grey') as 'red' | 'amber' | 'grey';

// ---------- plain words for codes ----------

/** Source codes in the rules file, as people say them. */
const SOURCE_NAMES: Record<string, string> = {
  TM: 'Trigger maps', EP: 'Evidence pack', QB: 'Quote bank', CLB: 'Creative brief', CC: 'Concept cards', RB: 'Rubric',
  BG: 'Brand guidelines', META: 'Meta ads guide', META3P: 'Meta length guides', TT: 'TikTok ads help', TT3P: 'TikTok length guides',
  HOUSE: 'House rule', LEGAL: 'Legal', GUIDE: 'Guide',
};
const MAP_PERSONA: Record<string, string> = { '1': 'DINKs', '2': 'Curators', '3': 'Busy Families' };
/** Territory code → name, for "Concept card: Ask Your Vet". Filled when the rules load. */
let TERRITORY_NAMES: Record<string, string> = {};
/**
 * A rules-file source in plain words; the codes stay in the raw source (a tooltip or "details").
 * "CC CUR_VET slide 2" → "Concept card: Ask Your Vet, slide 2"; "Brook decision 25 Sep (NR_EXCLUSIONS)" →
 * "Ralph decision, 25 Sep"; "RB mocks_viewer" → "Rubric"; "TM Trigger map 1 watch-outs" → "Trigger maps: DINKs, watch-outs".
 */
function plainSource(src?: string): string {
  if (!src) return '';
  const card = (code: string) => TERRITORY_NAMES[code] ? `Concept card: ${TERRITORY_NAMES[code].replace(/\.$/, '')}` : 'Concept card';
  const parts = src.split(/;\s*/).map(raw => {
    let part = raw.trim()
      .replace(/\s*\((?:NR_[A-Z_]+|facts? [A-Z]\d[^)]*)\)/g, '')                   // checklist and fact codes
      .replace(/\bBrook decision (\d+ \w+)/g, 'Ralph decision, $1')
      .replace(/\bpersonas\.json\b.*$/, 'Persona profiles');
    const m = /^([A-Z][A-Z0-9]+)\b\s*:?\s*(.*)$/.exec(part);
    if (!m || !SOURCE_NAMES[m[1]]) return part;
    const [, code] = m;
    let rest = m[2];
    if (code === 'RB') return /^draft/.test(rest) ? `Rubric, ${rest}` : 'Rubric';
    if (code === 'CC') {
      const c = /^(?:card\s+)?([A-Z]+_[A-Z]+)\b\s*(.*)$/.exec(rest);
      if (c) return `${card(c[1])}${c[2] ? `, ${c[2].replace(/^\((.*)\)$/, '$1')}` : ''}`;
    }
    if (code === 'TM') {
      const t = /^Trigger map (\d)\s*(?:\([^)]*\))?:?\s*(.*)$/.exec(rest);
      if (t) rest = `${MAP_PERSONA[t[1]] || `map ${t[1]}`}${t[2] ? `, ${t[2].replace(/^#(\d)/, 'trigger $1')}` : ''}`;
    }
    return rest ? (/^[§p]/.test(rest) ? `${SOURCE_NAMES[code]} ${rest}` : `${SOURCE_NAMES[code]}: ${rest}`) : SOURCE_NAMES[code];
  });
  // Any territory code left (e.g. in a parenthesis) reads as its name.
  return [...new Set(parts.filter(Boolean))].join(' · ').replace(/\b[A-Z]+_[A-Z]+\b/g, c => TERRITORY_NAMES[c]?.replace(/\.$/, '') ?? c);
}
/** A source in plain words, with the rules file's own wording (codes and all) on hover. */
function Src({ s, className }: { s?: string; className?: string }) {
  if (!s) return null;
  return <span className={className} title={`Source in the rules file: ${s}`}>{plainSource(s)}</span>;
}
/** Tone levels (1-5) in words, from the rules file's tone controls: "even · light touch · short". */
function toneWords(tone: Tone | undefined, meta: Meta): string {
  if (!tone) return '';
  const pick = (k: keyof Tone) => {
    const c = meta.tone_controls?.[k] || {};
    const keys = Object.keys(c).map(Number).sort((a, b) => Math.abs(a - tone[k]) - Math.abs(b - tone[k]));
    const w = keys.length ? String(c[String(keys[0])]).split(',')[0].trim() : '';
    return k === 'short_long' ? (tone[k] <= 2 ? 'short' : tone[k] >= 4 ? 'long' : 'medium') : w;
  };
  return (['dry_warm', 'playful_plain', 'short_long'] as const).map(pick).filter(Boolean).join(' · ');
}
/** Territory names as shown: the research springboard isn't "on the board". */
function territoryName(t?: Territory): string {
  if (!t) return '';
  const name = t.name.replace(/\s*\(springboard[^)]*\)\s*/i, '').trim();
  return t.status === 'springboard' ? `${name} (idea from the research; not in the pitch)` : name;
}
const personaName = (meta: Meta, code: string) => meta.personas[code]?.name || code;
/** One persona order everywhere (the database doesn't keep the rules file's key order). */
const PERSONA_ORDER = ['DINK', 'CUR', 'FAM'];
function personaKeys(personas: Record<string, unknown>): string[] {
  const rank = (k: string) => (PERSONA_ORDER.indexOf(k) + 1) || PERSONA_ORDER.length + 1;
  return Object.keys(personas).sort((a, b) => rank(a) - rank(b));
}
const angleLabel = (meta: Meta, persona: string, id: string) => meta.personas[persona]?.triggers.find(x => x.id === id)?.label || id;
const NAMING_TIP = 'Naming code: Add3 reports results by this';
/** One line on what to do about a flag, where there's a clear fix. */
/** Rule id → the fix in plain words, from the live rules file (v2.7+). Filled when the rules load; it wins over the list below. */
let WHAT_TO_DO: Record<string, string> = {};
function whatToDo(rule: string, f?: { visible?: number; max?: number }): string {
  if (WHAT_TO_DO[rule]) return WHAT_TO_DO[rule];
  if (rule === 'LIMIT_VISIBLE') return f?.visible ? `Keep the point in the first ${f.visible} characters; the rest is cut off on screen.` : 'Keep the point early; the end is cut off on screen.';
  if (rule === 'LIMIT_MAX') return f?.max ? `Cut it to ${f.max} characters or fewer.` : 'Cut it to fit the field.';
  const map: Record<string, string> = {
    COMP_PAYS_FOR_ITSELF: 'Say what it does instead of what it saves.',
    COMP_DIRECT_PAY: 'Add “at participating hospitals”.',
    COMP_PAID_SHARE: 'Say what’s covered, not “the whole bill”.',
    COMP_PREEXISTING: 'Don’t imply pre-existing conditions are covered.',
    COMP_ROUTINE: 'Don’t imply check-ups or vaccines are covered.',
    COMP_CLAIM_SPEED: 'Drop the speed promise, or say “can be”, not “every”.',
    COMP_SUPERLATIVE: 'Remove the superlative, or point to the proof.',
    COMP_PRICE_LEAD: 'Lead with the benefit; move the price later.',
    COMP_CHEAP_LOCKED: 'Don’t call Trupanion cheap or promise the price won’t change.',
    BR_NAMING: 'Say “medical insurance for pets”.',
    BR_CASE: 'Use sentence case; capitals are a design choice on the image.',
    COPY_CAVEAT: 'Put the caveat on the asset, as signed off.',
    COPY_MATCH: 'Use the signed-off wording on the asset.',
  };
  return map[rule] || '';
}

/** Who a persona is, from the active rules file (never the readout). Collapsed by default. */
function PersonaPanel({ meta, persona, open: startOpen = false, className }: { meta: Meta; persona: string; open?: boolean; className?: string }) {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => { setOpen(startOpen); }, [persona, startOpen]);
  const p = meta.personas[persona];
  if (!p) return null;
  const c = p.context;
  return (
    <section className={cn('rounded-xl border border-[#272B34] bg-[#16181D]', className)}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span><span className="text-sm font-semibold uppercase tracking-wider text-[#858B96]">Who this is</span> <span className="ml-1 text-base font-semibold">{p.name}</span></span>
        <span className="text-[#646A75]">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-[#272B34] px-4 py-3 text-sm">
          {(c?.who || c?.platforms?.length) && <p className="text-base text-[#C9CCD2]">{c?.who || p.name}{c?.platforms?.length ? <span className="text-[#858B96]"> · on {c.platforms.join(', ')}</span> : null}</p>}
          {c?.tension && <p className="text-[#C9CCD2]"><span className="font-semibold">The tension:</span> {c.tension}</p>}
          {(c?.who || c?.tension) && c?.who_source && <p className="-mt-2 text-xs text-[#646A75]"><Src s={c.who_source} /></p>}
          <div>
            <Label>What moves them</Label>
            <ul className="space-y-1.5">{p.triggers.map(t => <li key={t.id}><span className="font-semibold text-[#ECEDEF]">{t.label}</span>{t.detail ? <span className="text-[#C9CCD2]">: {t.detail}</span> : null}{t.source && <div className="text-xs text-[#646A75]"><Src s={t.source} /></div>}</li>)}</ul>
          </div>
          {!!c?.turn_offs?.length && (
            <div>
              <Label>Turn-offs</Label>
              <ul className="space-y-1.5">{c.turn_offs.map(t => <li key={t.id}><span className="text-[#C9CCD2]">{t.rule}</span><div className="text-xs text-[#646A75]"><Src s={t.source} /></div></li>)}</ul>
            </div>
          )}
          {!!c?.language?.length && (
            <div>
              <Label>Language to use</Label>
              <ul className="space-y-1">{c.language.map((l, i) => <li key={i}><span className={cn(l.caution ? 'text-amber-200' : 'text-[#C9CCD2]')}>“{l.text}”</span>{l.caution && <span className="ml-1 text-xs text-amber-300">use carefully</span>}<span className="ml-1 text-xs text-[#646A75]"><Src s={l.source} /></span></li>)}</ul>
            </div>
          )}
          <p className="text-xs text-[#646A75]">From the live rules file.</p>
        </div>
      )}
    </section>
  );
}

// ---------- brand lockup: Ralph × client ----------

function Lockup({ onHome, small }: { onHome?: () => void; small?: boolean }) {
  const [clientLogo, setClientLogo] = useState<string | null>(null);
  useEffect(() => {
    let url = '';
    studio.imageUrl('/brand/client-logo').then(u => { url = u; setClientLogo(u); }).catch(() => setClientLogo(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, []);
  return (
    <button onClick={onHome} className="flex shrink-0 items-center gap-3" aria-label="VOICES Studio: how it works">
      <img src="/ralph-world.png" alt="Ralph" className={cn('object-contain drop-shadow-[0_0_10px_rgba(217,77,143,0.35)]', small ? 'h-7 w-7' : 'h-7 w-7 min-[1440px]:h-8 min-[1440px]:w-8')} />
      <span className={cn('font-light leading-none text-[#ECEDEF]', small ? 'text-lg' : 'text-lg min-[1440px]:text-xl')} style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>
        Voices <span className="font-medium" style={{ color: PINK }}>Studio</span>
      </span>
      <span className={cn('text-[#646A75]', small ? 'text-sm' : 'text-base')} aria-hidden>×</span>
      {clientLogo
        ? <img src={clientLogo} alt="Trupanion" onError={() => setClientLogo(null)} className={cn('w-auto object-contain opacity-95', small ? 'h-4' : 'h-5')} />
        // No logo asset (production, Brook 28 Sep): the client's name as a wordmark.
        : <span className={cn('font-semibold tracking-tight text-[#ECEDEF]', small ? 'text-base' : 'text-base min-[1440px]:text-lg')} style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>Trupanion</span>}
    </button>
  );
}

// ---------- page ----------

export function Studio() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTabState] = useState<Tab>((params.get('tab') as Tab) || 'home');
  // Every step opens at the top, so moving on never looks like staying put.
  // The step bar, the screen and the address all follow this one value: no hover or focus is left looking like the current step.
  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    window.scrollTo({ top: 0 });
    (document.activeElement as HTMLElement | null)?.blur?.();
    const u = new URL(window.location.href);
    if (u.searchParams.get('tab') !== t) { u.searchParams.set('tab', t); window.history.pushState({ tab: t }, '', u); }
  }, []);
  useEffect(() => {
    const onPop = () => setTabState((new URL(window.location.href).searchParams.get('tab') as Tab) || 'home');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [brief, setBrief] = useState<Brief>({ persona: 'DINK', territory: 'DINK_NEVER', fields: [], tone: { dry_warm: 3, playful_plain: 3, short_long: 2 }, banned_words: [], banned_ideas: [], reference_lines: [], n: 20, model: 'gpt-4o' });
  const [batch, setBatch] = useState<Batch | null>(null);
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);
  const [user, setUserState] = useState(getUser());
  const [runsTick, setRunsTick] = useState(0); // refreshes the runs list after a run or a decision
  const [attached, setAttached] = useState<string | null>(null); // the run new lines go into, if any
  const [admin, setAdmin] = useState(false); // hosted, before rules exist (meta can't load yet)
  const esRef = useRef<{ close: () => void } | null>(null);
  // New lines go into the attached run only while the brief is for the same persona and territory.
  // One rule for every way the brief changes ("Write for this", the dropdowns, the address, "Continue").
  useEffect(() => {
    if (!attached) return;
    if (!batch || batch.id !== attached || batch.brief.persona !== brief.persona || batch.brief.territory !== brief.territory) setAttached(null);
  }, [attached, batch, brief.persona, brief.territory]);

  const refreshMeta = useCallback(() => studio.meta().then(m => {
    TERRITORY_NAMES = Object.fromEntries(Object.entries(m.territories).map(([k, t]) => [k, t.name]));
    WHAT_TO_DO = m.what_to_do || {};
    setMeta(m);
    setErr('');
    if (HOSTED && m.user) { setSignedInUser(m.user.email); setUserState(m.user.email); }
    return m;
  }), []);
  useEffect(() => {
    refreshMeta().then(m => setBrief(b => ({ ...b, fields: m.personas[b.persona]?.default_fields || [] })))
      .catch(async (e: any) => {
        if (HOSTED && e.body?.error === 'no_rules') {
          // First run after a deploy: nothing works until an admin uploads and activates the rules.
          const a = await studioAccess();
          setAdmin(a.admin);
          if (a.admin) { setTab('rules'); setErr('No rules are active yet. Upload studio-rules.json below, then activate it.'); }
          else setErr('Voices Studio is still being set up: no rules are active yet.');
          return;
        }
        setErr(HOSTED ? (e.status === 403 ? e.message : e.status === 404 ? 'Voices Studio isn’t switched on here yet.' : `Couldn’t reach Voices Studio: ${e.message}`) : 'Studio API not running. In backend/: npx tsx scripts/studio.ts serve');
      });
    studio.batches().then(bs => { const id = params.get('batch') || bs[0]?.id; if (id) studio.batch(id).then(setBatch); }).catch(() => {});
    return () => esRef.current?.close();
  }, [refreshMeta]);

  const upsertLine = useCallback((l: Line) => {
    setBatch(b => {
      if (!b || b.id !== l.batch) return b;
      const i = b.lines.findIndex(x => x.id === l.id);
      const lines = i >= 0 ? b.lines.map(x => (x.id === l.id ? { ...l, decision: x.decision ?? l.decision, note: x.note ?? l.note, edited_text: x.edited_text ?? l.edited_text } : x)) : [...b.lines, l];
      return { ...b, lines };
    });
  }, []);

  const follow = useCallback((job: string, batchId: string) => {
    esRef.current?.close();
    setRunning(true);
    esRef.current = studio.events(job, (e: StudioEvent) => {
      if (e.type === 'status') setStatus(e.message);
      if (e.type === 'line') upsertLine(e.line);
      if (e.type === 'stats') setBatch(b => (b ? { ...b, stats: e.stats } : b));
      if (e.type === 'error') { setStatus(`Stopped: ${e.message}`); setRunning(false); }
      if (e.type === 'done') {
        setRunning(false);
        studio.batch(batchId).then(setBatch).catch(() => {});
        refreshMeta().catch(() => {});
        setRunsTick(t => t + 1);
        setStatus('Done');
      }
    });
  }, [upsertLine, refreshMeta]);

  /**
   * Start a run, or add to the current one. ownOnly checks the creative
   * director's lines without Studio writing more; into = continue that run.
   */
  async function run(opts: { ownOnly?: boolean; into?: Batch | null } = {}) {
    setErr('');
    if (!getUser()) { setErr(HOSTED ? 'Still signing you in; try again in a moment.' : 'Add your name (top right) first, so your runs are saved under it.'); return; }
    const candidate = opts.into || (attached && batch?.id === attached ? batch : null);
    // A run for another persona or territory is never added to: this starts a new run instead.
    const into = candidate && candidate.brief.persona === brief.persona && candidate.brief.territory === brief.territory ? candidate : null;
    const b: Brief = into ? { ...into.brief, ...brief } : brief;
    try {
      let r;
      try { r = await studio.generate(b, { batch: into?.id, ownOnly: opts.ownOnly }); }
      catch (e: any) {
        if (e.status !== 409 || !e.body?.needs_confirm) throw e;
        if (!window.confirm(`This run is estimated at $${e.body.estimate.toFixed(2)}, over the $2 ask-first line. Run it?`)) return;
        r = await studio.generate(b, { batch: into?.id, ownOnly: opts.ownOnly, confirm: true });
      }
      setAttached(r.batch);
      if (!into) setBatch({ id: r.batch, brief: b, created: new Date().toISOString(), created_by: getUser(), lines: [], stats: { generated: 0, near_duplicates_removed: 0, similar_flagged: 0, timings_ms: {}, usd: {}, usd_total: 0 } });
      setBrief(cur => ({ ...cur, own_lines: [] })); // the lines now live in the run
      setStatus(opts.ownOnly ? 'Checking your lines…' : 'Writing…');
      setTab('review');
      follow(r.job, r.batch);
    } catch (e: any) { setErr(e.message); }
  }

  /** Reopen a saved run: its lines in Review, its brief in the brief tab, new lines go into it. */
  async function continueRun(id: string, opts: { resume?: boolean } = {}) {
    const b = await studio.batch(id);
    setBatch(b);
    setBrief({ ...b.brief, own_lines: [] });
    setAttached(b.id);
    setTab('review');
    if (opts.resume) {
      const r = await studio.resume(id);
      setStatus('Checking the lines this run left unchecked…');
      follow(r.job, id);
    }
  }

  async function more(line: Line, note: string) {
    if (!batch) return;
    const r = await studio.more(batch.id, line.id, note, 3);
    setStatus('Writing three more like this…');
    follow(r.job, batch.id);
  }

  if (tab === 'compare') {
    // A separate exercise, deliberately outside the writing flow: its lines
    // aren't checked, aren't saved to runs and never reach the shortlist.
    return (
      <div className="min-h-screen bg-[#0D1024] text-[#ECEDEF] [&_input:not([type=range]):not([type=file])]:bg-[#101216] [&_input]:text-[#ECEDEF] [&_textarea]:bg-[#101216] [&_textarea]:text-[#ECEDEF] [&_select]:bg-[#101216] [&_select]:text-[#ECEDEF] [&_input::placeholder]:text-[#646A75] [&_textarea::placeholder]:text-[#646A75]" style={{ fontSize: 16 }}>
        <header className="bg-[#151A3A] px-8 py-6 text-white">
          <div className="flex flex-wrap items-center gap-4">
            <span className="rounded-full border border-[#4B55A8] px-3 py-0.5 text-sm uppercase tracking-wide text-[#B9BFEA]">Separate exercise</span>
            <Lockup small onHome={() => setTab('home')} />
            <button onClick={() => setTab('home')} className="ml-auto rounded-lg border-2 border-[#4B55A8] px-4 py-2 text-base font-medium hover:border-white">← Back to Studio</button>
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight" style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>Blind compare: choose the writing model</h1>
          <p className="mt-2 max-w-4xl text-base text-[#B9BFEA]">The same brief goes to several models. Their lines are shuffled and unlabelled: star the ones you’d use, then reveal who wrote them. This sits outside your work: lines here aren’t checked, aren’t saved to your runs and never reach the shortlist.</p>
        </header>
        {err && <div className="mx-8 mt-4 rounded-lg border-2 border-red-500/45 bg-red-500/10 p-4 text-base text-red-200">{err}</div>}
        <main className="px-8 py-6">{meta && <Compare meta={meta} brief={brief} />}</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0E0F12] text-[#ECEDEF] [&_input:not([type=range]):not([type=file])]:bg-[#101216] [&_input]:text-[#ECEDEF] [&_textarea]:bg-[#101216] [&_textarea]:text-[#ECEDEF] [&_select]:bg-[#101216] [&_select]:text-[#ECEDEF] [&_input::placeholder]:text-[#646A75] [&_textarea::placeholder]:text-[#646A75]" style={{ fontSize: 16 }}>
      <header className="sticky top-0 z-20 flex h-16 flex-nowrap items-center gap-3 border-b border-[#272B34] bg-[#16181D] px-4 min-[1440px]:gap-4 min-[1440px]:px-6">
        {HOSTED && <a href="/" title="Back to Voices" className="-mr-2 rounded-lg p-1.5 text-[#858B96] hover:bg-[#1C1F26] hover:text-[#ECEDEF]"><ArrowLeft className="h-4 w-4" aria-label="Back to Voices" /></a>}
        <Lockup onHome={() => setTab('home')} />
        <nav className="flex min-w-0 flex-nowrap items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <GhostButton active={tab === 'home'} onClick={() => setTab('home')} title="How it works" aria-label="How it works" className="flex items-center gap-1.5 whitespace-nowrap border-transparent px-2 py-1.5 text-sm">
            <HelpCircle className="h-4 w-4 min-[1600px]:hidden" aria-hidden /><span className="hidden min-[1600px]:inline">How it works</span>
          </GhostButton>
          <span className="mx-1 h-5 w-px bg-[#343946]" aria-hidden />
          {FLOW.map(([t, label], i) => (
            <span key={t} className="flex items-center">
              <GhostButton active={tab === t} aria-current={tab === t ? 'step' : undefined} onClick={() => setTab(t)} title={label} aria-label={label} className="flex items-center gap-1.5 whitespace-nowrap border-transparent px-1.5 py-1.5 text-sm hover:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D94D8F]">
                <span className={cn('hidden h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold min-[1280px]:flex', tab === t ? 'bg-[#0E0F12] text-white' : 'bg-[#272B34] text-[#A3A8B1]')}>{i + 1}</span>
                {t === 'review' && batch ? `Review (${batch.lines.length})` : SHORT[t] ? <><span className="min-[1600px]:hidden">{SHORT[t]}</span><span className="hidden min-[1600px]:inline">{label}</span></> : label}
              </GhostButton>
            </span>
          ))}
          <span className="flex items-center">
            {/* B3b: live results next to each signed-off line. No route or API yet. */}
            <span aria-disabled="true" title="Coming soon: live results next to each signed-off line, from the first weeks in market"
              className="flex cursor-not-allowed items-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-1.5 text-sm text-[#4A505D]">
              Live <span className="rounded-full border border-[#343946] px-1.5 py-px text-[10px] uppercase tracking-wide">soon</span>
            </span>
          </span>
        </nav>
        <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-2.5 text-sm text-[#858B96]">
          <span className="mr-1 h-5 w-px bg-[#343946]" aria-hidden />
          <button onClick={() => setTab('compare')} title="Blind compare: a separate exercise, outside the writing flow" aria-label="Blind compare" className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-dashed border-[#4B55A8] bg-[#1B2150] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#232A5C]">
            <Shuffle className="h-4 w-4" aria-hidden /> Compare
          </button>
          <button onClick={() => setTab('rules')} title="Rules: what every line is checked against" className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-sm transition', tab === 'rules' ? 'border-[#ECEDEF] text-[#ECEDEF]' : 'border-transparent text-[#858B96] hover:text-[#ECEDEF]')}>
            <ScrollText className="h-4 w-4" aria-hidden /> Rules
          </button>
          {HOSTED
            ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#343946] text-xs font-semibold uppercase text-[#C9CCD2]" title={user ? `Signed in as ${user}; your runs and decisions are saved under this address` : 'Signing in…'}>{initials(user)}</span>
            : <UserBadge user={user} onChange={n => { setUser(n); setUserState(n); setRunsTick(t => t + 1); }} />}
          {meta?.mock && <Chip tone="amber">mock</Chip>}
        </div>
      </header>
      {running && (
        <div className="sticky top-16 z-10 flex items-center gap-2 border-b border-[#272B34] bg-[#16181D]/95 px-6 py-1.5 text-sm font-medium" style={{ color: PINK }}>
          <span className="animate-pulse">●</span> <span className="truncate">{status}</span>
        </div>
      )}
      {err && <div className="mx-8 mt-4 rounded-lg border-2 border-red-500/45 bg-red-500/10 p-4 text-base text-red-200">{err}</div>}
      <main className="px-6 py-6">
        {tab === 'home' && <Home onStart={() => setTab('territories')} />}
        {meta && tab === 'territories' && <Territories meta={meta} onSaved={() => refreshMeta()} onBrief={code => { const t = meta.territories[code]; setBrief(b => ({ ...b, persona: t.persona, territory: code, fields: b.persona === t.persona && b.fields.length ? b.fields : meta.personas[t.persona].default_fields })); setTab('brief'); }} />}
        {meta && tab === 'brief' && <BriefPanel meta={meta} brief={brief} run={run} running={running} user={user} runsTick={runsTick} onContinue={continueRun}
          setBrief={setBrief}
          attachedRun={attached && batch?.id === attached ? batch : null} onNewRun={() => setAttached(null)} />}
        {meta && tab === 'review' && <Review meta={meta} batch={batch} setBatch={setBatch} status={status} running={running} onMore={more} onMoreRun={() => run({ into: batch })} onDecided={() => setRunsTick(t => t + 1)} />}
        {meta && tab === 'shortlist' && <Shortlist meta={meta} batch={batch} onReady={() => setTab('ready')} />}
        {meta && tab === 'ready' && <Ready meta={meta} batch={batch} user={user} onNext={() => setTab('preflight')} />}
        {meta && tab === 'preflight' && <Preflight meta={meta} />}
        {tab === 'rules' && (meta || admin) && <Rules meta={meta} admin={HOSTED && (!!meta?.user?.admin || admin)} onActivated={() => refreshMeta().then(() => setErr('')).catch(() => {})} />}
      </main>
    </div>
  );
}

// ---------- 0. landing: how Voices Studio works ----------

const STEPS: Array<{ title: string; what: string; you: string }> = [
  { title: 'Territories', what: 'Start from the pitch; update them as feedback comes in.', you: 'Edit, add or retire territories.' },
  { title: 'Write & brief', what: 'Your lines come first, checked in seconds; then about 20 more around them, in your voice.', you: 'Write a few lines, pick fields and tone, then generate.' },
  { title: 'Review', what: 'Length, flags with their sources, and a skeptic’s objection.', you: 'Keep, cut, edit, or ask for more like this.' },
  { title: 'Shortlist', what: 'Kept lines get naming codes. Runs are saved to continue later.', you: 'Curate in Sheets and import it back.' },
  { title: 'Ready for production', what: 'Red flags fixed or overridden with a reason, then the set is locked with your expectations.', you: 'Sign off, and hand over the pack.' },
  { title: 'Pre-flight', what: 'The finished asset checked against the signed-off copy and the rules.', you: 'Upload, agree or disagree, mark Ready to traffic.' },
];

function Home({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <section className="space-y-3">
        <h1 className="text-4xl font-bold leading-tight tracking-tight" style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>
          Write your lines. Studio adds alternatives from angles you haven’t tried, and checks every one.
        </h1>
        <p className="text-lg text-[#A3A8B1]">You bring the taste. Studio brings range, the rules, and the audience’s pushback. The market decides what wins.</p>
        <PinkButton className="mt-1" onClick={onStart}>Start: pick a territory →</PinkButton>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">How Voices Studio works</h2>
        <ol className="grid grid-cols-6 gap-3">
          {STEPS.map((st, i) => (
            <li key={st.title}>
              <div className="flex h-full w-full flex-col rounded-xl border border-[#272B34] bg-[#16181D] p-4">
                <div className="mb-2 flex items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: PINK }}>{i + 1}</span>
                  <span className="text-base font-semibold">{st.title}</span>
                </div>
                <p className="mb-3 text-sm leading-snug text-[#A3A8B1]">{st.what}</p>
                <p className="mt-auto border-t border-[#272B34] pt-2.5 text-sm leading-snug text-[#C9CCD2]"><span style={{ color: PINK }}>You:</span> {st.you}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
          <h3 className="mb-2.5 text-base font-semibold">Reading the flags</h3>
          <ul className="space-y-2 text-sm leading-snug text-[#C9CCD2]">
            <li className="flex items-center gap-2"><Chip tone="red">red</Chip> Breaks a client rule: fix it, or override with a reason.</li>
            <li className="flex items-center gap-2"><Chip tone="amber">amber</Chip> Worth a look.</li>
            <li className="flex items-center gap-2"><Chip tone="grey">grey</Chip> A note.</li>
          </ul>
        </div>
        <div className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
          <h3 className="mb-2.5 text-base font-semibold">What Studio is, and isn’t</h3>
          <ul className="space-y-1.5 text-sm leading-snug text-[#C9CCD2]">
            <li>✓ A writing partner: range fast, problems caught early.</li>
            <li>✓ A stress test: the audience’s objections first.</li>
            <li>✗ Not a score, and not a prediction of what wins.</li>
          </ul>
        </div>
        <div className="flex flex-col rounded-xl border border-dashed border-[#4B55A8] bg-[#151A3A] p-4">
          <span className="text-xs uppercase tracking-wider text-[#8F97D6]">Separate exercise</span>
          <span className="mt-1 text-base font-semibold text-white">Blind compare: choose the writing model</span>
          <span className="mt-1 text-sm leading-snug text-[#B9BFEA]">Models write to the same brief, unlabelled. Star, then reveal. Nothing goes into your runs.</span>
          <span className="mt-auto pt-2 text-sm text-[#8F97D6]">“Compare”, top right.</span>
        </div>
      </section>
    </div>
  );
}

// ---------- 1. brief ----------

function BriefPanel({ meta, brief, setBrief, run, running, user, runsTick, onContinue, attachedRun, onNewRun }: {
  meta: Meta; brief: Brief; setBrief: (b: Brief) => void; run: (o?: { ownOnly?: boolean }) => void; running: boolean;
  user: string; runsTick: number; onContinue: (id: string, opts?: { resume?: boolean }) => void;
  attachedRun: Batch | null; onNewRun: () => void;
}) {
  const [more, setMore] = useState(false);
  const territories = Object.entries(meta.territories).filter(([, x]) => x.persona === brief.persona && x.status !== 'retired');
  const t = meta.territories[brief.territory];
  const set = (patch: Partial<Brief>) => setBrief({ ...brief, ...patch });
  const setTone = (k: keyof Tone, v: number) => set({ tone: { ...brief.tone, [k]: v } });
  const own: OwnLine[] = brief.own_lines?.length ? brief.own_lines : [{ text: '', field: brief.fields[0] || 'meta_primary' }];
  const written = own.filter(o => o.text.trim());
  const setOwn = (next: OwnLine[]) => set({ own_lines: next });
  const setRow = (i: number, patch: Partial<OwnLine>) => setOwn(own.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  // Enter adds a row below and moves the cursor into it.
  const rowRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  useEffect(() => { if (focusRow !== null) { rowRefs.current[focusRow]?.focus(); setFocusRow(null); } }, [focusRow, own.length]);


  // Paste several lines at once: split them into rows.
  function onPaste(i: number, e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const parts = e.clipboardData.getData('text').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    if (parts.length < 2) return;
    e.preventDefault();
    const field = own[i].field;
    setOwn([...own.slice(0, i), ...parts.map(text => ({ text, field })), ...own.slice(i + 1)].filter((o, k, a) => o.text || k === a.length - 1));
  }

  return (
    <div className="max-w-7xl space-y-5">
      {attachedRun ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 px-4 py-3 text-base" style={{ borderColor: PINK, background: 'rgba(217,77,143,0.10)' }}>
          <span>Adding to: <b>{territoryName(meta.territories[attachedRun.brief.territory]) || attachedRun.brief.territory}</b> · {when(attachedRun.created)}{attachedRun.created_by ? ` · ${attachedRun.created_by.split('@')[0].split('.')[0].replace(/^./, c => c.toUpperCase())}` : ''} <span className="text-[#A3A8B1]">({attachedRun.lines.length} line{attachedRun.lines.length === 1 ? '' : 's'}; new lines go into this run)</span></span>
          <GhostButton className="ml-auto px-3 py-1 text-sm" onClick={onNewRun}>Start a new run</GhostButton>
        </div>
      ) : (
        <p className="px-1 text-sm text-[#A3A8B1]">This starts a new run.</p>
      )}
      {/* Setup, in one row */}
      <section className="flex flex-wrap items-end gap-4 rounded-xl border border-[#272B34] bg-[#16181D] p-4">
        <div>
          <Label>Persona</Label>
          <select className="rounded-lg border-2 border-[#343946] bg-[#101216] px-3 py-2 text-base" value={brief.persona}
            onChange={e => { const p = e.target.value; const first = Object.entries(meta.territories).find(([, x]) => x.persona === p && x.status !== 'retired')?.[0] || ''; set({ persona: p, territory: first, fields: meta.personas[p].default_fields, own_lines: own.map(o => ({ ...o, field: meta.personas[p].default_fields[0] })) }); }}>
            {personaKeys(meta.personas).map(k => <option key={k} value={k}>{meta.personas[k].name}</option>)}
          </select>
        </div>
        <div>
          <Label>Territory</Label>
          <select className="rounded-lg border-2 border-[#343946] bg-[#101216] px-3 py-2 text-base" value={brief.territory} onChange={e => set({ territory: e.target.value })}>
            {territories.map(([k, x]) => <option key={k} value={k}>{territoryName(x)}{x.origin === 'new' ? ' (new)' : x.origin === 'edited' ? ' (edited)' : ''}</option>)}
          </select>
        </div>
        <div>
          <Label>Fields</Label>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(meta.fields).map(([k, f]) => {
              const on = brief.fields.includes(k);
              return <GhostButton key={k} active={on} className="px-2.5 py-1.5 text-sm" onClick={() => set({ fields: on ? brief.fields.filter(x => x !== k) : [...brief.fields, k] })}>{f.label} · {f.visible} chars visible</GhostButton>;
            })}
          </div>
        </div>
        <div className="flex gap-4">
          {([['dry_warm', 'dry', 'warm'], ['playful_plain', 'playful', 'plain'], ['short_long', 'short', 'long']] as const).map(([k, l, r]) => (
            <div key={k} className="w-36">
              <Label>{l}–{r} <span className="font-mono text-[#C9CCD2]">{brief.tone[k]}</span></Label>
              <input type="range" min={1} max={5} value={brief.tone[k]} onChange={e => setTone(k, Number(e.target.value))} className="w-full accent-[#D94D8F]" />
            </div>
          ))}
        </div>
      </section>
      {t && <p className="px-1 text-base text-[#A3A8B1]"><span className="font-semibold">{territoryName(t)}</span> · {t.format} · Angle: {angleLabel(meta, t.persona, t.angle)}. {t.premise}</p>}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.6fr_1fr]">
        {/* Your lines: the first action */}
        <section className="rounded-xl border-2 bg-[#16181D] p-5" style={{ borderColor: PINK }}>
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="shrink-0 whitespace-nowrap text-lg font-semibold">Your lines</h2>
            <span className="text-base text-[#858B96]">Write first. One line per row; paste several at once. Studio checks them, then writes around them.</span>
          </div>
          <div className="space-y-2">
            {own.map((o, i) => {
              const f = meta.fields[o.field];
              const n = [...o.text].length;
              return (
                <div key={i} className="flex items-start gap-2">
                  <textarea ref={el => { rowRefs.current[i] = el; }} rows={Math.min(4, Math.max(1, Math.ceil(n / 48)))} value={o.text} placeholder={i === 0 ? 'Write a line…' : ''}
                    onChange={e => setRow(i, { text: e.target.value.replace(/\n/g, ' ') })}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setOwn([...own.slice(0, i + 1), { text: '', field: o.field }, ...own.slice(i + 1)]); setFocusRow(i + 1); } }}
                    onPaste={e => onPaste(i, e)}
                    className="flex-1 resize-none rounded-lg border-2 border-[#343946] px-3 py-2 text-[20px] leading-snug focus:border-[#D94D8F] focus:outline-none" />
                  <select value={o.field} onChange={e => setRow(i, { field: e.target.value })} className="w-44 rounded-lg border-2 border-[#343946] bg-[#16181D] px-2 py-2 text-sm">
                    {Object.entries(meta.fields).map(([k, ff]) => <option key={k} value={k}>{ff.label}</option>)}
                  </select>
                  <span className={cn('w-16 pt-2.5 text-right font-mono text-sm', f && n > f.visible ? 'font-bold text-amber-300' : 'text-[#858B96]')}>{n}/{f?.visible}</span>
                  <button aria-label="Remove line" onClick={() => setOwn(own.length > 1 ? own.filter((_, k) => k !== i) : [{ text: '', field: o.field }])} className="pt-2 text-base text-[#646A75] hover:text-[#C9CCD2]">×</button>
                </div>
              );
            })}
          </div>
          <button onClick={() => { setOwn([...own, { text: '', field: own[own.length - 1]?.field || brief.fields[0] }]); setFocusRow(own.length); }} className="mt-2 text-base font-medium text-[#858B96] hover:text-[#ECEDEF]">+ Add a line</button>

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[#272B34] pt-4">
            <PinkButton disabled={running || !written.length} onClick={() => run({ ownOnly: true })}>Check my lines{written.length ? ` (${written.length})` : ''}</PinkButton>
            <GhostButton disabled={running || !brief.fields.length} onClick={() => run()} className="px-4 py-3 text-base">
              {written.length ? `Check mine + generate ${brief.n} around them` : `Generate ${brief.n} lines`}
            </GhostButton>
          </div>
        </section>

        <div className="space-y-5">
          <PersonaPanel meta={meta} persona={brief.persona} open />
          <RunsList user={user} tick={runsTick} meta={meta} onContinue={onContinue} />
          <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
            <button className="flex w-full items-center justify-between text-lg font-semibold" onClick={() => setMore(!more)}>
              More options <span className="text-[#646A75]">{more ? '−' : '+'}</span>
            </button>
            {more && (
              <div className="mt-4 space-y-4">
                <div>
                  <Label>Banned words (comma-separated)</Label>
                  <input className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" value={brief.banned_words.join(', ')}
                    onChange={e => set({ banned_words: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} placeholder="e.g. furbaby, hassle-free" />
                </div>
                <div>
                  <Label>Off-limits ideas (one per line)</Label>
                  <textarea rows={2} className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" value={brief.banned_ideas.join('\n')} onChange={e => set({ banned_ideas: e.target.value.split('\n') })} />
                </div>
                <div>
                  <Label>Reference lines (a voice to match, not checked)</Label>
                  <textarea rows={2} className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" value={brief.reference_lines.join('\n')} onChange={e => set({ reference_lines: e.target.value.split('\n') })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Studio writes</Label>
                    <input type="number" min={4} max={60} className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" value={brief.n} onChange={e => set({ n: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label>Writing model</Label>
                    <input list="studio-models" className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" value={brief.model} onChange={e => set({ model: e.target.value })} />
                    <datalist id="studio-models">{['gpt-4o', 'gpt-4.1', 'gpt-5.5', 'claude-opus-5-5', 'claude-opus-5', 'gpt-5-mini'].map(m => <option key={m} value={m} />)}</datalist>
                  </div>
                </div>
              </div>
            )}
          </section>
          <p className="text-sm text-[#858B96]">Every line, yours or Studio’s, gets the same checks: limits, compliance and brand rules, persona turn-offs, glance and product clarity, near-duplicates, and a skeptic’s objection. Flags, not scores.</p>
        </div>
      </div>
    </div>
  );
}

// ---------- runs: saved by person, continue any time ----------

function RunsList({ user, tick, meta, onContinue }: { user: string; tick: number; meta: Meta; onContinue: (id: string, opts?: { resume?: boolean }) => void }) {
  const [mine, setMine] = useState(true);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  useEffect(() => { studio.batches(mine && user ? user : undefined).then(setRuns).catch(() => setRuns([])); }, [user, mine, tick]);
  return (
    <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="mr-auto text-lg font-semibold">{mine && user ? 'Your runs' : 'All runs'}</h3>
        <GhostButton active={mine} className="px-2 py-1 text-sm" onClick={() => setMine(true)}>Mine</GhostButton>
        <GhostButton active={!mine} className="px-2 py-1 text-sm" onClick={() => setMine(false)}>All</GhostButton>
      </div>
      {!runs.length && <p className="text-base text-[#858B96]">{user ? 'No runs yet. Check your lines or generate to start one.' : 'Add your name (top right) to see your runs.'}</p>}
      <ul className="max-h-60 space-y-2 overflow-y-auto">
        {runs.slice(0, 30).map(r => (
          <li key={r.id} className="flex items-center gap-3 rounded-lg border border-[#272B34] px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-medium">{meta.territories[r.territory]?.name || r.territory}</div>
              <div className="text-sm text-[#858B96]">
                {new Date(r.updated).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {r.lines} lines{r.yours ? ` (${r.yours} yours)` : ''} · {r.kept} kept{!mine && r.created_by ? ` · ${r.created_by}` : ''}
                {r.unchecked > 0 && <span className="text-amber-300"> · {r.unchecked} unchecked</span>}
              </div>
            </div>
            {r.unchecked > 0
              ? <GhostButton className="px-3 py-1 text-sm" onClick={() => onContinue(r.id, { resume: true })} title="The run was interrupted; check the lines it left unchecked">Resume</GhostButton>
              : <GhostButton className="px-3 py-1 text-sm" onClick={() => onContinue(r.id)}>Continue</GhostButton>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function UserBadge({ user, onChange }: { user: string; onChange: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user);
  if (editing) {
    return (
      <form className="flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); if (draft.trim()) { onChange(draft.trim()); setEditing(false); } }}>
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => !draft.trim() && setEditing(false)} placeholder="Your name"
          className="w-32 rounded-lg border px-2 py-1 text-sm" style={{ borderColor: PINK }} />
        <button className="rounded-lg px-2.5 py-1 text-sm font-semibold text-white" style={{ background: PINK }}>Save</button>
      </form>
    );
  }
  if (!user) return <button onClick={() => setEditing(true)} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold text-white" style={{ background: PINK }}>Add your name</button>;
  return <button onClick={() => { setDraft(user); setEditing(true); }} className="whitespace-nowrap rounded-full border border-[#343946] px-3 py-1 text-sm text-[#C9CCD2] hover:border-[#6B7280]" title="Runs are saved under this name">{user} ✎</button>;
}

// ---------- territories: editable, with history ----------

function Territories({ meta, onSaved, onBrief }: { meta: Meta; onSaved: () => void; onBrief: (code: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null); // code, or 'new:<persona>'
  const [showRetired, setShowRetired] = useState(false);
  return (
    <div className="max-w-7xl space-y-8">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>Territories</h1>
          <p className="max-w-3xl text-base text-[#A3A8B1]">These start from the pitch. Edit them as client feedback and your preferences come in: every change keeps who made it and why, and the pitch version stays on record.</p>
        </div>
        <GhostButton active={showRetired} onClick={() => setShowRetired(!showRetired)}>Show retired</GhostButton>
      </div>
      {personaKeys(meta.personas).map(pk => { const p = meta.personas[pk];
        const list = Object.entries(meta.territories).filter(([, x]) => x.persona === pk && (showRetired || x.status !== 'retired'));
        return (
          <section key={pk}>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <GhostButton className="px-3 py-1 text-sm" onClick={() => setEditing(`new:${pk}`)}>+ New territory</GhostButton>
            </div>
            <PersonaPanel meta={meta} persona={pk} className="mb-3" />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {editing === `new:${pk}` && <TerritoryEditor meta={meta} persona={pk} onDone={saved => { setEditing(null); if (saved) onSaved(); }} />}
              {list.map(([code, t]) => editing === code
                ? <TerritoryEditor key={code} meta={meta} code={code} territory={t} persona={pk} onDone={saved => { setEditing(null); if (saved) onSaved(); }} />
                : <TerritoryCard key={code} meta={meta} code={code} t={t} onEdit={() => setEditing(code)} onBrief={() => onBrief(code)} onSaved={onSaved} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TerritoryCard({ meta, code, t, onEdit, onBrief, onSaved }: { meta: Meta; code: string; t: Territory; onEdit: () => void; onBrief: () => void; onSaved: () => void }) {
  const [history, setHistory] = useState(false);
  const retired = t.status === 'retired';
  const angle = meta.personas[t.persona]?.triggers.find(x => x.id === t.angle)?.label || t.angle;
  async function toggleRetire() {
    const note = window.prompt(retired ? 'Why restore it?' : 'Why retire it? (e.g. client feedback, 28 Sep)') ?? null;
    if (note === null) return;
    await studio.saveTerritory(code, { status: retired ? 'active' : 'retired' }, note);
    onSaved();
  }
  return (
    <div className={cn('flex flex-col rounded-xl border-2 bg-[#16181D] p-5', retired ? 'border-[#272B34] opacity-60' : 'border-[#272B34]')}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-bold">{territoryName(t)}</h3>
        <Chip tone={t.origin === 'pitch' ? 'grey' : 'outline'} className={t.origin !== 'pitch' ? 'border-[#D94D8F] text-[#D94D8F]' : ''}>{t.origin === 'new' ? 'new' : t.origin === 'edited' ? 'edited' : t.status === 'springboard' ? 'from the research' : 'from the pitch'}</Chip>
        {retired && <Chip tone="grey">retired</Chip>}

      </div>
      <div className="mb-2 text-sm text-[#858B96]">{t.format} · Angle: {angle}</div>
      {t.headline && <p className="mb-2 text-base font-semibold text-[#F2F3F5]" title={t.headline_source ? `Pitched headline · ${plainSource(t.headline_source)}` : 'Pitched headline'}><span className="mr-1 text-xs font-normal uppercase tracking-wider text-[#858B96]">Pitched as</span>“{t.headline}”</p>}
      {(t.name_note || t.headline_note) && <p className="mb-2 text-sm text-amber-200">{[t.pitched_name && t.pitched_name !== t.name ? `Pitched as “${t.pitched_name.replace(/\.$/, '')}”.` : '', t.name_note, t.headline_note].filter(Boolean).join(' ')}</p>}
      <p className="mb-3 text-base leading-snug text-[#C9CCD2]">{t.premise}</p>
      {t.updated_by && <p className="mb-3 text-sm text-[#858B96]">Changed by {t.updated_by}, {t.updated_at?.slice(0, 10)}{t.note ? `: ${t.note}` : ''}</p>}
      {history && t.history?.length ? (
        <ul className="mb-3 space-y-1 border-l-2 border-[#272B34] pl-3 text-sm text-[#858B96]">
          {[...t.history].reverse().map((h, i) => (
            <li key={i}>{h.at.slice(0, 10)} · {h.by}{h.note ? `: ${h.note}` : ''}{h.before ? ` (was “${h.before.name}”: ${h.before.premise?.slice(0, 90)}${(h.before.premise?.length || 0) > 90 ? '…' : ''})` : ' (added)'}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2">
        {!retired && <PinkButton className="px-3 py-1.5 text-base" onClick={onBrief}>Write for this</PinkButton>}
        <GhostButton onClick={onEdit}>Edit</GhostButton>
        <GhostButton onClick={toggleRetire}>{retired ? 'Restore' : 'Retire'}</GhostButton>
        {t.history?.length ? <GhostButton onClick={() => setHistory(!history)}>History ({t.history.length})</GhostButton> : null}
      </div>
    </div>
  );
}

function TerritoryEditor({ meta, code, territory, persona, onDone }: { meta: Meta; code?: string; territory?: Territory; persona: string; onDone: (saved: boolean) => void }) {
  const p = meta.personas[persona];
  const [d, setD] = useState({ name: territory?.name || '', premise: territory?.premise || '', angle: territory?.angle || p.triggers[0].id, format: territory?.format || 'STATIC' });
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  async function save() {
    try { await studio.saveTerritory(code || null, { ...d, persona }, note); onDone(true); } catch (e: any) { setError(e.message); }
  }
  return (
    <div className="space-y-3 rounded-xl border-2 bg-[#16181D] p-5" style={{ borderColor: PINK }}>
      <div><Label>Name</Label><input className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></div>
      <div><Label>Premise</Label><textarea rows={3} className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" value={d.premise} onChange={e => setD({ ...d, premise: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Leads on</Label>
          <select className="w-full rounded-lg border-2 border-[#343946] bg-[#101216] px-2 py-2 text-base" value={d.angle} onChange={e => setD({ ...d, angle: e.target.value })}>
            {p.triggers.map(tr => <option key={tr.id} value={tr.id}>{tr.label}</option>)}
          </select>
        </div>
        <div><Label>Format</Label>
          <select className="w-full rounded-lg border-2 border-[#343946] bg-[#101216] px-2 py-2 text-base" value={d.format} onChange={e => setD({ ...d, format: e.target.value })}>
            {(meta.formats || ['STATIC', 'UGC', 'VIDEO', 'CAROUSEL']).map(f => <option key={f}>{f}</option>)}
          </select>
        </div>
      </div>
      <div><Label>Why the change</Label><input className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. client feedback 28 Sep; CD preference" /></div>
      {error && <p className="text-base text-red-300">{error}</p>}
      <div className="flex gap-2">
        <PinkButton className="px-4 py-2 text-base" disabled={!d.name.trim()} onClick={save}>{code ? 'Save changes' : 'Add territory'}</PinkButton>
        <GhostButton onClick={() => onDone(false)}>Cancel</GhostButton>
      </div>
    </div>
  );
}

// ---------- 2. review grid ----------

function Review({ meta, batch, setBatch, status, running, onMore, onMoreRun, onDecided }: { meta: Meta; batch: Batch | null; setBatch: React.Dispatch<React.SetStateAction<Batch | null>>; status: string; running: boolean; onMore: (l: Line, note: string) => void; onMoreRun: () => void; onDecided: () => void }) {
  const [group, setGroup] = useState<'angle' | 'structure'>('angle');
  const [filter, setFilter] = useState<'all' | 'compliance' | 'open' | 'kept'>('all');
  // Lines decided while a filter is on stay where they are until the filter or grouping changes (no jumping under the cursor).
  const [stay, setStay] = useState<Set<string>>(new Set());
  useEffect(() => { setStay(new Set()); }, [filter, group, batch?.id]);
  const [batches, setBatches] = useState<RunSummary[]>([]);
  useEffect(() => { studio.batches().then(setBatches).catch(() => {}); }, [batch?.id, running]);

  if (!batch) return <div className="text-base text-[#858B96]">No run open yet. Write your lines on the brief tab, or continue a saved run.</div>;
  const yours = batch.lines.filter(l => l.model === 'human').length;
  const checked = batch.lines.filter(l => l.status === 'checked').length;
  const shown = batch.lines.filter(l => stay.has(l.id) ||
    (filter === 'all' ? true : filter === 'compliance' ? l.flags.some(f => f.severity === 'compliance') : filter === 'open' ? !l.decision : l.decision === 'keep' || l.decision === 'edit'));
  const groups = new Map<string, Line[]>();
  for (const l of shown) {
    const k = group === 'angle' ? `Angle: ${l.angle_label}` : `Structure: ${l.structure.replace('_', ' ')}`;
    groups.set(k, [...(groups.get(k) || []), l]);
  }
  const t = meta.territories[batch.brief.territory];
  const replace = (l: Line) => setBatch(cur => (cur ? { ...cur, lines: cur.lines.map(x => (x.id === l.id ? l : x)) } : cur));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-4">
          <div className="text-lg font-semibold">{meta.personas[batch.brief.persona]?.name} · {t?.name}</div>
          <div className="text-base text-[#858B96]">
            {checked} of {batch.lines.length} checked{yours ? ` · ${yours} yours` : ''} · writer {batch.brief.model}{batch.created_by ? ` · run by ${batch.created_by}` : ''}
            {batch.stats.near_duplicates_removed ? ` · ${batch.stats.near_duplicates_removed} near-duplicates removed` : ''}
            {batch.stats.timings_ms.total ? ` · ${(batch.stats.timings_ms.total / 1000).toFixed(0)}s` : ''}
          </div>
        </div>
        <select className="rounded-lg border-2 border-[#343946] bg-[#101216] px-3 py-1.5 text-base" value={batch.id} onChange={e => studio.batch(e.target.value).then(setBatch)}>
          {[...batches, ...(batches.some(b => b.id === batch.id) ? [] : [{ id: batch.id, territory: batch.brief.territory, updated: batch.updated || batch.created, created_by: batch.created_by || '' } as RunSummary])].map(b => (
            <option key={b.id} value={b.id} title={b.id}>{territoryName(meta.territories[b.territory]) || b.territory} · {new Date(b.updated).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{b.created_by ? ` · ${b.created_by.split('@')[0]}` : ''}</option>
          ))}
        </select>
        <PinkButton className="px-4 py-2 text-base" disabled={running} onClick={onMoreRun}>{yours ? 'Generate around your lines' : 'Generate more in this run'}</PinkButton>
        <div className="ml-auto flex flex-wrap gap-2">
          <span className="self-center text-sm font-semibold uppercase text-[#858B96]">Group</span>
          <GhostButton active={group === 'angle'} onClick={() => setGroup('angle')}>Angle</GhostButton>
          <GhostButton active={group === 'structure'} onClick={() => setGroup('structure')}>Structure</GhostButton>
          <span className="ml-3 self-center text-sm font-semibold uppercase text-[#858B96]">Show</span>
          {(['all', 'compliance', 'open', 'kept'] as const).map(f => <GhostButton key={f} active={filter === f} onClick={() => setFilter(f)}>{f === 'compliance' ? 'Compliance flags' : f === 'open' ? 'Undecided' : f === 'kept' ? 'Kept' : 'All'}</GhostButton>)}
        </div>
      </div>
      {running && (
        <div className="h-2 w-full overflow-hidden rounded bg-[#272B34]">
          <div className="h-full transition-all" style={{ width: `${batch.lines.length ? (100 * checked) / batch.lines.length : 5}%`, background: PINK }} />
        </div>
      )}
      {running && <div className="text-base text-[#858B96]">{status}</div>}
      {[...groups.entries()].map(([g, ls]) => (
        <section key={g}>
          <h2 className="mb-3 mt-2 text-lg font-bold first-letter:uppercase">{g} <span className="font-normal text-[#858B96]">({ls.length})</span></h2>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {ls.map(l => <LineCard key={l.id} meta={meta} line={l} onChange={x => { if (filter !== 'all') setStay(cur => new Set(cur).add(x.id)); replace(x); onDecided(); }} onMore={onMore} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function LineCard({ meta, line, onChange, onMore }: { meta: Meta; line: Line; onChange: (l: Line) => void; onMore: (l: Line, note: string) => void }) {
  const [open, setOpen] = useState<string | null>(params.get('open') === line.id.split('-').pop() ? line.flags[0]?.rule ?? null : null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.edited_text || line.text);
  const [note, setNote] = useState(line.note || '');
  const [history, setHistory] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => { setNote(line.note || ''); }, [line.note]);
  const f = meta.fields[line.field];
  // Decisions wait for the checks: keeping a line before its flags arrive is how a red line got kept by accident.
  const checking = line.status !== 'checked';
  const text = line.decision === 'edit' && line.edited_text ? line.edited_text : line.text;
  const chars = [...text].length;
  const over = f && chars > f.visible;
  const openFlag = line.flags.find(x => x.rule === open);
  const decide = async (patch: Partial<Pick<Line, 'decision' | 'edited_text' | 'note'>>) => onChange(await studio.decide(line.batch, line.id, patch));
  const border = line.decision === 'keep' || line.decision === 'edit' ? 'border-emerald-500' : line.decision === 'cut' ? 'border-[#343946] opacity-50' : line.model === 'human' ? 'border-[#D94D8F]/60' : 'border-[#272B34]';

  return (
    <div className={cn('rounded-xl border-2 bg-[#16181D] p-5', border)}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-[#858B96]">
        {line.model === 'human' && <Chip tone="outline" className="border-[#D94D8F] font-semibold text-[#D94D8F]">yours</Chip>}
        <span title={line.id}>{f?.label || line.field}</span>
        <span className={cn('font-mono', over ? 'font-bold text-amber-300' : '')} title={f ? `${f.visible} characters show on screen; ${f.max} is the most the field takes` : undefined}>{chars} chars · {f?.visible} visible</span>
        <span>· Structure: {line.structure.replace('_', ' ')}</span>
        <span>· Tone: {toneWords(line.tone, meta) || line.tone_label}</span>
        {line.parent && <Chip tone="outline">more like {line.parent.split('-').pop()}</Chip>}
        {checking && <span className="animate-pulse" style={{ color: PINK }}>flags still arriving…</span>}
        {line.ready && <Chip tone="outline" className="border-emerald-500/60 text-emerald-300" title={`Signed off by ${line.ready.ready_by}, ${when(line.ready.ready_at)}`}>ready v{line.ready.version}{line.ready.changed_since ? ' · edited since' : ''}</Chip>}
      </div>
      {/* Who decided, on a line of its own with a fixed height: a decision never changes the card's size, so nothing below it moves. */}
      <div className="-mt-1 mb-1 flex h-5 items-center justify-end text-xs">
        <button onClick={() => setHistory(!history)} className={cn('truncate underline-offset-2 hover:text-[#ECEDEF] hover:underline', line.decided_by && line.decision ? 'text-[#858B96]' : 'text-[#646A75]')} title="Who decided what, and when">
          {line.decided_by && line.decision ? `${line.decision} · ${line.decided_by}${line.decided_at ? ` · ${when(line.decided_at)}` : ''}` : 'history'}
        </button>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea className="w-full rounded-lg border-2 border-[#4A505D] p-3 text-[22px] leading-snug bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" rows={3} value={draft} onChange={e => setDraft(e.target.value)} autoFocus />
          <div className="flex gap-2">
            <PinkButton className="px-4 py-2 text-base" onClick={async () => { await decide({ decision: 'edit', edited_text: draft }); setEditing(false); }}>Save edit</PinkButton>
            <GhostButton onClick={() => setEditing(false)}>Cancel</GhostButton>
            <span className="self-center font-mono text-sm text-[#858B96]">{[...draft].length}/{f?.visible}</span>
          </div>
        </div>
      ) : (
        <p className="text-[22px] leading-snug text-[#F2F3F5]">{text}</p>
      )}
      {line.decision === 'edit' && line.edited_text && !editing && <p className="mt-1 text-base text-[#858B96] line-through">{line.text}</p>}

      {line.flags.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-[#858B96]">Flags</span>
          {line.flags.map(fl => (
            <Chip key={fl.rule} tone={sevTone(fl.severity)} className="cursor-pointer" title={`${fl.label}${fl.quote ? `\n"${fl.quote}"` : ''}\nSource: ${plainSource(fl.source)}`} onClick={() => setOpen(open === fl.rule ? null : fl.rule)}>
              {fl.rule === 'LIMIT_VISIBLE' && f ? `cut off on screen after ${f.visible} characters` : fl.rule === 'LIMIT_MAX' && f ? `too long for this field (max ${f.max})` : chipName(fl.rule)}
            </Chip>
          ))}
        </div>
      )}
      {openFlag && (
        <div className={cn('mt-2 rounded-lg border p-3 text-base', openFlag.severity === 'compliance' ? 'border-red-500/45 bg-red-500/10' : openFlag.severity === 'warn' ? 'border-amber-400/40 bg-amber-400/10' : 'border-[#272B34] bg-[#0E0F12]')}>
          <div className="font-semibold">{openFlag.label}</div>
          {openFlag.quote && <div className="mt-1">In the line: <mark className="bg-amber-400/30 text-amber-50 px-1">{openFlag.quote}</mark></div>}
          {openFlag.why && <div className="mt-1 text-[#A3A8B1]">{openFlag.why}</div>}
          {whatToDo(openFlag.rule, f) && <div className="mt-1"><span className="font-semibold">What to do:</span> {whatToDo(openFlag.rule, f)}</div>}
          <div className="mt-1 text-sm text-[#858B96]">Source: <Src s={openFlag.source} />
            <button className="ml-2 text-xs underline-offset-2 hover:underline" onClick={() => setDetails(!details)}>{details ? 'hide details' : 'details'}</button>
            {details && <span className="ml-2 text-xs">found by {openFlag.by.join(' + ')}{openFlag.p !== undefined ? ` · P(yes) ${openFlag.p}` : ''} · {openFlag.source}</span>}
          </div>
        </div>
      )}
      {line.features.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-[#646A75]">Tags (what the line contains)</span>
          {line.features.map(x => <span key={x} className="rounded border border-dashed border-[#343946] px-1.5 py-px text-xs text-[#A3A8B1]">{x.replace(/_/g, ' ')}</span>)}
        </div>
      )}
      {line.objection && <p className="mt-3 border-l-4 border-[#343946] pl-3 text-base italic text-[#A3A8B1]">Skeptic: {line.objection}</p>}
      <Overrides line={line} />
      {history && <LineHistory line={line} />}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <GhostButton active={line.decision === 'keep'} disabled={checking} title={checking ? 'Flags still arriving' : undefined} onClick={() => decide({ decision: line.decision === 'keep' ? '' : 'keep' })}>Keep</GhostButton>
        <GhostButton active={line.decision === 'cut'} disabled={checking} title={checking ? 'Flags still arriving' : undefined} onClick={() => decide({ decision: line.decision === 'cut' ? '' : 'cut' })}>Cut</GhostButton>
        <GhostButton active={line.decision === 'edit'} disabled={checking} title={checking ? 'Flags still arriving' : undefined} onClick={() => { setDraft(line.edited_text || line.text); setEditing(true); }}>Edit</GhostButton>
        <GhostButton onClick={() => onMore(line, note)} title="Writes three siblings, using the note as guidance">More like this</GhostButton>
        <input className="min-w-[12rem] flex-1 rounded-lg border-2 border-[#272B34] px-3 py-1.5 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" placeholder="Note (why; guides 'more like this')" value={note}
          onChange={e => setNote(e.target.value)} onBlur={() => note !== (line.note || '') && decide({ note })} />
      </div>
    </div>
  );
}

// ---------- 3. shortlist and export ----------

function Shortlist({ meta, batch, onReady }: { meta: Meta; batch: Batch | null; onReady: () => void }) {
  const [rows, setRows] = useState<ShortRow[]>([]);
  const [msg, setMsg] = useState('');
  const load = () => studio.shortlist().then(setRows).catch(e => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const groups = useMemo(() => {
    const m = new Map<string, ShortRow[]>();
    for (const r of rows) { const k = `${personaName(meta, r.persona)} · ${territoryName(meta.territories[r.territory]) || r.territory}`; m.set(k, [...(m.get(k) || []), r]); }
    return m;
  }, [rows]);

  async function upload(file: File) {
    const r = await studio.ingest(await file.text());
    setMsg(`Read ${r.rows} rows: ${r.kept} keep, ${r.edited} edit, ${r.cut} cut${r.unknown.length ? `; ${r.unknown.length} unknown ids` : ''}. Taste examples: ${r.taste_total}.`);
    load();
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="space-y-4 rounded-xl border border-[#272B34] bg-[#16181D] p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto max-w-3xl">
            <div className="text-lg font-semibold">Shortlist</div>
            <div className="text-base text-[#858B96]">Kept and edited lines, each with its naming code (PERSONA_TERRITORY_FORMAT_v#_PLATFORM; Add3 reports results by it, with the date added at trafficking).</div>
          </div>
          <PinkButton onClick={onReady}>Ready for production →</PinkButton>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#272B34] bg-[#101216] p-3">
          <div className="mr-auto min-w-[16rem] max-w-xl">
            <div className="font-semibold">Review in Google Sheets</div>
            <div className="text-sm text-[#858B96]">Download the sheet, mark keep / cut / edit in Sheets with the team, then import it back: decisions and notes land on the lines, and taste examples feed the next run.</div>
          </div>
          <GhostButton className="text-base" disabled={!batch} onClick={() => batch && studio.download(`/batches/${encodeURIComponent(batch.id)}/export.csv`, `${batch.id}.csv`)} title={batch ? undefined : 'Open a run first'}>1. Download the sheet</GhostButton>
          <label className="cursor-pointer rounded-lg border border-dashed border-[#4A505D] px-3 py-1.5 text-base font-medium">
            2. Import it back
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>
        <details className="text-sm text-[#858B96]">
          <summary className="cursor-pointer">More downloads</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <GhostButton onClick={() => studio.download('/shortlist.csv', 'shortlist.csv')}>Shortlist CSV</GhostButton>
            <GhostButton onClick={() => studio.download('/shortlist.md', 'shortlist.md')}>Shortlist Markdown</GhostButton>
            {batch && <GhostButton onClick={() => studio.download(`/batches/${encodeURIComponent(batch.id)}/export.md`, `${batch.id}.md`)}>This run as Markdown</GhostButton>}
          </div>
        </details>
      </div>
      {msg && <div className="rounded-lg bg-emerald-500/10 p-3 text-base text-emerald-200">{msg}</div>}
      {!rows.length && <div className="text-base text-[#858B96]">Nothing kept yet. Keep or edit lines in Review, or import a curated sheet.</div>}
      {[...groups.entries()].map(([g, rs]) => (
        <section key={g} className="rounded-xl border border-[#272B34] bg-[#16181D] p-5">
          <h2 className="mb-3 text-lg font-bold">{g} <span className="font-normal text-[#858B96]">({rs.length})</span></h2>
          <table className="w-full text-left text-base">
            <thead><tr className="text-sm uppercase text-[#858B96]"><th className="pb-2 pr-4" title={NAMING_TIP}>Naming code</th><th className="pb-2 pr-4">Field</th><th className="pb-2 pr-4">Line</th><th className="pb-2">Note</th></tr></thead>
            <tbody>
              {rs.map(r => (
                <tr key={r.id} className="border-t border-[#272B34] align-top">
                  <td className="py-2 pr-4 font-mono text-sm" title={NAMING_TIP}>{r.stub}</td>
                  <td className="py-2 pr-4 text-base text-[#858B96]">{meta.fields[r.field]?.label || r.field.replace(/_/g, ' ')}</td>
                  <td className="py-2 pr-4">
                    {r.text}
                    {((r.compliance_flags?.length ?? 0) > 0 || (r.warn_flags?.length ?? 0) > 0) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(r.compliance_flags || []).map(f => <Chip key={f} tone="red" className="text-xs">{chipName(f)}</Chip>)}
                        {(r.warn_flags || []).map(f => <Chip key={f} tone="amber" className="text-xs">{chipName(f)}</Chip>)}
                      </div>
                    )}
                  </td>
                  <td className="py-2 text-base text-[#858B96]">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

// ---------- 4. blind compare ----------

function Compare({ meta, brief }: { meta: Meta; brief: Brief }) {
  const [names, setNames] = useState<string[]>([]);
  const [set, setSet] = useState<CompareSet | null>(null);
  const [models, setModels] = useState('gpt-4o, gpt-4.1, gpt-5.5, claude-opus-5-5');
  const [n, setN] = useState(8);
  const [status, setStatus] = useState('');
  const [key, setKey] = useState<Reveal | null>(null);
  const load = (name: string) => { setKey(null); studio.compareSet(name).then(setSet); };
  useEffect(() => { studio.compares().then(ns => { setNames(ns); const n = params.get('compare') || ns[0]; if (n) load(n); }).catch(() => {}); }, []);

  async function run() {
    setStatus('Starting…');
    const { job } = await studio.compare(brief, models.split(',').map(s => s.trim()).filter(Boolean), n);
    const es = studio.events(job, e => {
      if (e.type === 'status') setStatus(e.message);
      if (e.type === 'error') { setStatus(`Stopped: ${e.message}`); es.close(); }
      if (e.type === 'done') { es.close(); setStatus(''); studio.compares().then(ns => { setNames(ns); load(e.batch); }); }
    });
  }
  async function mark(id: string, patch: { favourite?: boolean; note?: string }) {
    if (!set) return;
    const l = await studio.compareMark(set.name, id, patch);
    setSet(cur => (cur ? { ...cur, lines: cur.lines.map(x => (x.id === id ? l : x)) } : cur));
  }
  const revealed = !!key;

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-[#272B34] bg-[#16181D] p-5">
        <div className="mr-auto">
          <div className="text-lg font-semibold">The brief</div>
          <div className="text-base text-[#858B96]">{meta.personas[brief.persona]?.name} · {meta.territories[brief.territory]?.name}, from your brief tab. Pick 2–4 writers.</div>
        </div>
        <div><Label>Writers (2-4)</Label><input className="w-96 rounded-lg border-2 border-[#343946] px-3 py-2 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" value={models} onChange={e => setModels(e.target.value)} /></div>
        <div><Label>Lines each</Label><input type="number" className="w-24 rounded-lg border-2 border-[#343946] px-3 py-2 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" value={n} onChange={e => setN(Number(e.target.value))} /></div>
        <PinkButton onClick={run} disabled={!!status}>{status || 'Run blind compare'}</PinkButton>
      </div>
      {names.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <select className="rounded-lg border-2 border-[#343946] bg-[#101216] px-3 py-1.5 text-base" value={set?.name || ''} onChange={e => load(e.target.value)}>
            {names.map(x => <option key={x}>{x}</option>)}
          </select>
          {set && <span className="text-base text-[#858B96]">{set.lines.length} lines · {set.lines.filter(l => l.favourite).length} starred by you{HOSTED ? ' (everyone’s stars show at the reveal)' : ''}</span>}
          {set && !revealed && <GhostButton className="ml-auto" onClick={async () => setKey(await studio.reveal(set.name))}>Reveal the writers</GhostButton>}
        </div>
      )}
      {key && (
        <div className="flex flex-wrap gap-4 rounded-xl border-2 p-5" style={{ borderColor: PINK }}>
          {Object.entries(key.labels).map(([label, model]) => (
            <div key={label} className="text-base"><span className="font-bold">Writer {label}</span> = {model} · <span className="font-semibold">{key.tally[label] || 0} starred</span></div>
          ))}
          {key.by_person && Object.keys(key.by_person).length > 1 && (
            <div className="w-full border-t border-[#272B34] pt-3 text-sm text-[#A3A8B1]">
              {Object.entries(key.by_person).map(([who, t]) => <div key={who}>{who}: {Object.entries(t).map(([label, n]) => `${label} ${n}`).join(' · ')}</div>)}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {set?.lines.map(l => (
          <div key={l.id} className={cn('rounded-xl border-2 bg-[#16181D] p-5', l.favourite ? 'border-[#D94D8F]' : 'border-[#272B34]')}>
            <div className="mb-2 flex items-center gap-2 text-sm text-[#858B96]">
              <span className="font-mono font-semibold text-[#ECEDEF]">{l.id}</span>
              <span>{meta.fields[l.field]?.label}</span>
              <span className="font-mono">{l.chars}/{meta.fields[l.field]?.visible}</span>
              {revealed && <Chip tone="outline">Writer {l.label} · {key!.labels[l.label]}</Chip>}
              <button className="ml-auto text-3xl leading-none" style={{ color: l.favourite ? PINK : '#4A505D' }} onClick={() => mark(l.id, { favourite: !l.favourite })} aria-label="Star">★</button>
            </div>
            <p className="text-[22px] leading-snug text-[#F2F3F5]">{l.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Initials for the signed-in badge: nick.larson@ralph.world → NL. */
function initials(email: string) {
  const name = (email || '').split('@')[0].split(/[._-]+/).filter(Boolean);
  return name.length ? (name.length === 1 ? name[0].slice(0, 2) : name[0][0] + name[1][0]) : '…';
}

// ---------- attribution and history ----------

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const describe = (x: any): string => {
  if (!x || typeof x !== 'object') return '';
  if ('decision' in x) return [x.decision || 'undecided', x.edited_text ? `“${x.edited_text}”` : '', x.note ? `note: ${x.note}` : ''].filter(Boolean).join(' · ');
  if ('overrides' in x) return `overrides: ${(x.overrides || []).map((o: any) => chipName(o.rule)).join(', ') || 'none'}`;
  if ('compliance' in x) return `compliance: ${COMPLIANCE_WORDS[x.compliance?.status as ComplianceStatus] || 'pending'}${x.compliance?.note ? ` (${x.compliance.note})` : ''}`;
  if ('ready' in x) return x.ready ? `ready for production, v${x.ready.version}` : 'not signed off';
  if ('flags' in x) return x.rechecked ? `re-checked: ${(x.flags || []).length} flags` : `${(x.flags || []).length} flags`;
  return '';
};

function LineHistory({ line }: { line: Line }) {
  const [edits, setEdits] = useState<EditRecord[] | null>(null);
  const [versions, setVersions] = useState<LineVersion[]>([]);
  useEffect(() => {
    studio.history(line.id).then(setEdits).catch(() => setEdits([]));
    studio.versions(line.id).then(setVersions).catch(() => {});
  }, [line.id, line.decided_at]);
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-[#272B34] bg-[#0E0F12] p-3 text-sm text-[#A3A8B1]">
      {versions.length > 0 && (
        <div>
          <Label>Versions</Label>
          <ul className="space-y-1">
            {versions.map(v => (
              <li key={v.version}><span className="font-semibold text-[#ECEDEF]">v{v.version}</span> · {when(v.created_at)} · {v.created_by}{v.signoff_id ? ' · signed off' : ''} · <span className="font-mono text-xs">{v.sha256.slice(0, 10)}</span><div className="text-[#C9CCD2]">{v.text}</div></li>
            ))}
          </ul>
        </div>
      )}
      <Label>History</Label>
      {edits === null ? <div>Loading…</div> : !edits.length ? <div>No decisions yet.</div> : (
        <ul className="space-y-1">{edits.map((e, i) => <li key={i}>{when(e.at)} · <span className="text-[#ECEDEF]">{e.by}</span> · {describe(e.after)}</li>)}</ul>
      )}
    </div>
  );
}

function Overrides({ line }: { line: Line }) {
  if (!line.overrides?.length) return null;
  return (
    <ul className="mt-3 space-y-1">
      {line.overrides.map(o => (
        <li key={o.rule} className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-sm text-red-100">
          <span className="font-semibold">Override: {chipName(o.rule)}</span> · {o.by}, {when(o.at)}<div className="text-[#C9CCD2]">“{o.reason}”</div>
        </li>
      ))}
    </ul>
  );
}

// ---------- 5. Ready for production ----------

const COMPLIANCE_WORDS: Record<ComplianceStatus, string> = { pending: 'Pending', cleared: 'Cleared', changes_requested: 'Changes requested' };
const COMPLIANCE_TONE: Record<ComplianceStatus, string> = {
  pending: 'border-[#343946] text-[#A3A8B1]', cleared: 'border-emerald-500 bg-emerald-500/15 text-emerald-200', changes_requested: 'border-amber-400 bg-amber-400/15 text-amber-100',
};

function Ready({ meta, batch, user, onNext }: { meta: Meta; batch: Batch | null; user: string; onNext: () => void }) {
  const [groups, setGroups] = useState<Array<{ persona: string; territory: string; n: number }>>([]);
  // Deep link: /studio?tab=ready&persona=DINK&territory=DINK_NEVER
  const [pt, setPt] = useState<{ persona: string; territory: string } | null>(
    params.get('persona') && params.get('territory') ? { persona: params.get('persona')!, territory: params.get('territory')! }
      : batch ? { persona: batch.brief.persona, territory: batch.brief.territory } : null);
  const [view, setView] = useState<ReadyView | null>(null);
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [lead, setLead] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    studio.shortlist().then(rows => {
      const m = new Map<string, { persona: string; territory: string; n: number }>();
      for (const r of rows) { const k = `${r.persona}|${r.territory}`; m.set(k, { persona: r.persona, territory: r.territory, n: (m.get(k)?.n || 0) + 1 }); }
      const gs = [...m.values()];
      setGroups(gs);
      setPt(cur => (cur && gs.some(g => g.persona === cur.persona && g.territory === cur.territory) ? cur : gs[0] ? { persona: gs[0].persona, territory: gs[0].territory } : cur));
    }).catch(e => setError(e.message));
  }, []);
  const load = useCallback(async (keepSelection = false) => {
    if (!pt) return;
    const v = await studio.ready(pt.persona, pt.territory);
    setView(v);
    if (!keepSelection) {
      setInclude(new Set(v.lines.map(x => x.line.id)));
      const lastExp = v.expectations[v.expectations.length - 1];
      setLead(new Set(lastExp?.line_ids.filter(id => v.lines.some(x => x.line.id === id)) || []));
      setReason(lastExp?.reason || '');
    }
  }, [pt]);
  useEffect(() => { setDone(''); setError(''); load().catch(e => setError(e.message)); }, [load]);

  const selected = view?.lines.filter(x => include.has(x.line.id)) || [];
  const reds = selected.reduce((n, x) => n + x.red.length, 0);
  const leads = [...lead].filter(id => include.has(id));
  // Nothing to sign off if the set and every wording match the latest sign-off.
  const latest = view?.latest;
  const unchanged = !!latest && latest.lines.length === selected.length && selected.every(x => latest.lines.some(l => l.line_id === x.line.id && l.sha256 === x.sha256));
  const blockedBy = unchanged ? `This set is signed off (v${latest!.version}). Edit a line or change the set to sign off again.` : !selected.length ? 'Choose at least one line.' : reds ? `${reds} red flag${reds === 1 ? '' : 's'} to fix or override first.` : !leads.length ? 'Pick the line(s) you expect to lead.' : !reason.trim() ? 'Say why you expect them to lead.' : '';

  async function signOff() {
    if (!pt) return;
    setBusy(true); setError(''); setDone('');
    try {
      const r = await studio.signOff({ persona: pt.persona, territory: pt.territory, line_ids: selected.map(x => x.line.id), expectation: { line_ids: leads, reason } });
      setDone(`${r.signoff.lines.length} line${r.signoff.lines.length === 1 ? '' : 's'} marked Ready for production (set v${r.signoff.version}), with your expectations locked alongside.`);
      await load(true);
    } catch (e: any) {
      setError(e.body?.blocking ? `${e.message}: ${e.body.blocking.map((b: any) => b.line_id.split('-').pop()).join(', ')}` : e.message);
    } finally { setBusy(false); }
  }
  const t = pt ? meta.territories[pt.territory] : null;
  const q = pt ? `?persona=${encodeURIComponent(pt.persona)}&territory=${encodeURIComponent(pt.territory)}` : '';

  return (
    <div className="max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start gap-4 rounded-xl border border-[#272B34] bg-[#16181D] p-5">
        <div className="mr-auto max-w-3xl">
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>Ready for production</h1>
          <p className="mt-1 text-base text-[#A3A8B1]">Creative sign-off on the kept lines for one persona and territory. It isn’t compliance clearance: that’s tracked per line below. Red flags must be fixed or overridden with a reason; amber and grey don’t block. Once signed off, the set is locked, and a later edit becomes a new version.</p>
        </div>
        <div>
          <Label>Persona × territory</Label>
          <select className="rounded-lg border-2 border-[#343946] bg-[#101216] px-3 py-2 text-base" value={pt ? `${pt.persona}|${pt.territory}` : ''}
            onChange={e => { const [persona, territory] = e.target.value.split('|'); setPt({ persona, territory }); }}>
            {!groups.length && <option value="">Nothing kept yet</option>}
            {groups.map(g => <option key={`${g.persona}|${g.territory}`} value={`${g.persona}|${g.territory}`}>{meta.personas[g.persona]?.name || g.persona} · {meta.territories[g.territory]?.name || g.territory} ({g.n})</option>)}
          </select>
        </div>
      </div>

      {error && <div className="rounded-lg border-2 border-red-500/45 bg-red-500/10 p-3 text-base text-red-200">{error}</div>}
      {done && <div className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-emerald-500/50 bg-emerald-500/10 p-3 text-base text-emerald-100"><span className="mr-auto">{done}</span><PinkButton className="px-4 py-1.5 text-base" onClick={onNext}>Next: Pre-flight →</PinkButton></div>}
      {!view && !error && <div className="text-base text-[#858B96]">{groups.length ? 'Loading…' : 'Nothing kept yet. Keep or edit lines in Review first.'}</div>}

      {view && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <div className={cn('flex items-center gap-3 rounded-lg border px-4 py-2.5 text-base', reds ? 'border-red-500/45 bg-red-500/10 text-red-100' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100')}>
              <span className="font-semibold">{selected.length} of {view.lines.length} lines in this set</span>
              <span>·</span>
              <span>{reds ? `${reds} red flag${reds === 1 ? '' : 's'} to resolve` : 'No red flags left'}</span>
              <span className="ml-auto text-sm opacity-80">{t?.format}</span>
            </div>
            {view.lines.map(x => (
              <ReadyCard key={x.line.id} meta={meta} item={x} included={include.has(x.line.id)} lead={lead.has(x.line.id)}
                onInclude={on => setInclude(cur => { const n = new Set(cur); if (on) n.add(x.line.id); else n.delete(x.line.id); return n; })}
                onLead={on => setLead(cur => { const n = new Set(cur); if (on) n.add(x.line.id); else n.delete(x.line.id); return n; })}
                onChanged={() => load(true).catch(e => setError(e.message))} onError={setError} canCompliance={meta.can_set_compliance !== false} canOverride={meta.can_override !== false} />
            ))}
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <section className="rounded-xl border-2 bg-[#16181D] p-5" style={{ borderColor: PINK }}>
              <h2 className="text-lg font-semibold">Expectations</h2>
              <p className="mb-3 text-sm text-[#A3A8B1]">Which line(s) you expect to lead, and why. Dated and locked with the sign-off, so it can be checked against what actually happens.</p>
              <Label>Expected to lead</Label>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {leads.length ? leads.map(id => <Chip key={id} tone="outline" className="border-[#D94D8F] text-[#F2C4DA]">{view.lines.find(x => x.line.id === id)?.stub || id.split('-').pop()}</Chip>)
                  : <span className="text-sm text-[#858B96]">Pick with “Expect to lead” on a line.</span>}
              </div>
              <Label>Why</Label>
              <textarea rows={4} className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base" placeholder="e.g. The direct-pay line answers the DINKs’ ‘what happens at the counter?’ question in under 40 characters." value={reason} onChange={e => setReason(e.target.value)} />
              <PinkButton className="mt-3 w-full" disabled={!!blockedBy || busy} onClick={signOff}>{busy ? 'Signing off…' : `Mark ${selected.length} line${selected.length === 1 ? '' : 's'} Ready for production`}</PinkButton>
              <p className="mt-2 text-sm text-[#858B96]">{blockedBy || `Will be signed off as ${user || 'you'}. The set and your expectations are locked together.`}</p>
            </section>

            <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-5">
              <h2 className="mb-2 text-lg font-semibold">Handoff pack</h2>
              <p className="mb-3 text-sm text-[#A3A8B1]">The latest signed-off wording, with naming codes and compliance status.</p>
              <div className="flex flex-col gap-2">
                <GhostButton className="text-base" onClick={() => studio.download(`/handoff.csv${q}`, 'ready-for-production.csv')}>Handoff CSV (this set)</GhostButton>
                <GhostButton className="text-base" onClick={() => studio.download(`/handoff.md${q}`, 'ready-for-production.md')}>Handoff Markdown (this set)</GhostButton>
                <GhostButton className="text-base" onClick={() => studio.download('/handoff.csv', 'ready-for-production.csv')}>Handoff CSV (every set)</GhostButton>
                <GhostButton className="text-base" onClick={() => studio.download('/compliance-sheet.csv', 'trupanion-compliance-sheet.csv')}>Compliance sheet for Trupanion</GhostButton>
              </div>
              <p className="mt-2 text-xs text-[#858B96]">The compliance sheet has the final words only: no internal flags, objections or names.</p>
            </section>

            {view.signoffs.length > 0 && (
              <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-5">
                <h2 className="mb-2 text-lg font-semibold">Sign-offs</h2>
                <ul className="space-y-3 text-sm">
                  {[...view.signoffs].reverse().map(so => {
                    const e = view.expectations.find(x => x.signoff_id === so.id);
                    return (
                      <li key={so.id} className="border-l-2 border-emerald-500/60 pl-3">
                        <div className="text-[#ECEDEF]"><span className="font-semibold">Set v{so.version}</span> · {so.lines.length} lines · {so.ready_by}, {when(so.ready_at)}</div>
                        <div className="font-mono text-xs text-[#646A75]">{so.sha256.slice(0, 16)}</div>
                        {e && <div className="mt-1 text-[#A3A8B1]">Expected to lead: {e.line_ids.map(id => so.lines.find(l => l.line_id === id)?.stub || id).join(', ')}. “{e.reason}” <span className="font-mono text-xs text-[#646A75]">{e.sha256.slice(0, 10)}</span></div>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function ReadyCard({ meta, item, included, lead, onInclude, onLead, onChanged, onError, canCompliance, canOverride }: {
  meta: Meta; item: ReadyView['lines'][number]; included: boolean; lead: boolean;
  onInclude: (on: boolean) => void; onLead: (on: boolean) => void; onChanged: () => void; onError: (m: string) => void; canCompliance: boolean; canOverride: boolean;
}) {
  const { line, final_text, red, compliance, versions } = item;
  const f = meta.fields[line.field];
  const chars = [...final_text].length;
  const [overriding, setOverriding] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(final_text);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState(compliance.note || '');
  const [showHistory, setShowHistory] = useState(false);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); onChanged(); } catch (e: any) { onError(e.message); } };
  const onOriginal = line.flags.some(x => (x.why || '').includes('on the original wording'));
  const others = line.flags.filter(x => x.severity !== 'compliance');

  return (
    <div className={cn('rounded-xl border-2 bg-[#16181D] p-5 transition', !included ? 'border-[#272B34] opacity-50' : red.length ? 'border-red-500/60' : 'border-emerald-500/60')}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-[#858B96]">
        <label className="flex cursor-pointer items-center gap-2 font-medium text-[#ECEDEF]">
          <input type="checkbox" className="h-4 w-4 accent-[#D94D8F]" checked={included} onChange={e => onInclude(e.target.checked)} aria-label={`Include ${item.stub} in this set`} /> {included ? 'In this set' : 'Not in this set'}
        </label>
        <span className="font-mono" title={line.id}>{item.stub}</span>
        <span>{f?.label || line.field}</span>
        <span className={cn('font-mono', f && chars > f.visible ? 'font-bold text-amber-300' : '')}>{chars}/{f?.visible}</span>
        {line.model === 'human' && <Chip tone="outline" className="border-[#D94D8F] text-[#D94D8F]">yours</Chip>}
        {line.ready && <Chip tone="outline" className="border-emerald-500/60 text-emerald-300">ready v{line.ready.version} · {line.ready.ready_by}, {when(line.ready.ready_at)}</Chip>}
        {line.ready?.changed_since && <Chip tone="amber">edited since sign-off: v{Math.max(...versions.map(v => v.version), line.ready.version)} not yet signed off</Chip>}
        <button onClick={() => onLead(!lead)} disabled={!included} className={cn('ml-auto rounded-full border px-3 py-0.5 text-sm font-medium transition disabled:opacity-40', lead ? 'border-[#D94D8F] bg-[#D94D8F] text-white' : 'border-[#4A505D] text-[#C9CCD2] hover:border-[#D94D8F]')}>
          {lead ? '★ Expected to lead' : '☆ Expect to lead'}
        </button>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea className="w-full rounded-lg border-2 border-[#4A505D] p-3 text-[20px] leading-snug" rows={3} value={draft} onChange={e => setDraft(e.target.value)} autoFocus />
          <div className="flex items-center gap-2">
            <PinkButton className="px-4 py-2 text-base" onClick={() => act(async () => { await studio.decide(line.batch, line.id, { decision: 'edit', edited_text: draft }); setEditing(false); })}>Save edit</PinkButton>
            <GhostButton onClick={() => setEditing(false)}>Cancel</GhostButton>
            <span className="font-mono text-sm text-[#858B96]">{[...draft].length}/{f?.visible}</span>
          </div>
        </div>
      ) : <p className="text-[21px] leading-snug text-[#F2F3F5]">{final_text}</p>}

      {red.length > 0 && included && (
        <div className="mt-3 space-y-2 rounded-lg border border-red-500/45 bg-red-500/10 p-3">
          <div className="text-sm font-semibold uppercase tracking-wider text-red-200">Fix or override before sign-off</div>
          {red.map(fl => (
            <div key={fl.rule} className="text-base">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="red">{chipName(fl.rule)}</Chip>
                <span className="text-[#ECEDEF]">{fl.label}</span>
                {fl.quote && <mark className="bg-amber-400/30 px-1 text-amber-50">{fl.quote}</mark>}
              </div>
              <div className="mt-0.5 text-sm text-[#A3A8B1]">Source: <Src s={fl.source} />{fl.why ? ` · ${fl.why}` : ''}</div>
              {overriding === fl.rule ? (
                <div className="mt-2 space-y-2">
                  <textarea rows={2} className="w-full rounded-lg border-2 border-red-500/45 px-3 py-2 text-base" placeholder="Why this is OK to run (recorded with your name, and shown on the line)" value={why} onChange={e => setWhy(e.target.value)} autoFocus />
                  <div className="flex gap-2">
                    <PinkButton className="px-4 py-1.5 text-base" disabled={why.trim().length < 5} onClick={() => act(async () => { await studio.override(line.batch, line.id, fl.rule, why); setOverriding(null); setWhy(''); })}>Save override</PinkButton>
                    <GhostButton onClick={() => setOverriding(null)}>Cancel</GhostButton>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <GhostButton onClick={() => { setDraft(final_text); setEditing(true); }}>Edit the wording</GhostButton>
                  {canOverride ? <GhostButton onClick={() => { setOverriding(fl.rule); setWhy(''); }}>Override with a reason…</GhostButton>
                    : <span className="self-center text-xs text-[#646A75]">Fix the wording, or ask the creative lead to override it</span>}
                </div>
              )}
            </div>
          ))}
          {onOriginal && (
            <div className="flex flex-wrap items-center gap-2 border-t border-red-500/30 pt-2 text-sm text-red-100">
              Some flags were found on the original wording. Re-check the edit to clear them.
              <GhostButton disabled={checking} onClick={() => act(async () => { setChecking(true); try { await studio.recheck(line.batch, line.id); } finally { setChecking(false); } })}>{checking ? 'Re-checking…' : 'Re-check this wording'}</GhostButton>
            </div>
          )}
        </div>
      )}
      <Overrides line={line} />
      {others.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {others.map(fl => <Chip key={fl.rule} tone={sevTone(fl.severity)} title={`${fl.label}\nSource: ${fl.source}`}>{chipName(fl.rule)}</Chip>)}
          <span className="self-center text-xs text-[#646A75]">don’t block sign-off</span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#272B34] pt-3">
        <span className="text-sm font-semibold uppercase tracking-wider text-[#858B96]">Compliance</span>
        {!canCompliance && <span className="text-xs text-[#646A75]">Vivan updates this</span>}
        {(Object.keys(COMPLIANCE_WORDS) as ComplianceStatus[]).map(st => (
          <button key={st} disabled={!canCompliance} aria-pressed={compliance.status === st} onClick={() => {
            // A line that went through with an overridden red flag can only be cleared with a note.
            let n = note;
            if (st === 'cleared' && line.overrides?.length && !n.trim()) {
              n = window.prompt('This line went through with an overridden red flag. Who at Trupanion cleared it?')?.trim() || '';
              if (!n) return;
              setNote(n);
            }
            act(() => studio.compliance(line.batch, line.id, st, n));
          }}
            className={cn('rounded-full border px-3 py-0.5 text-sm font-medium disabled:cursor-default', compliance.status === st ? COMPLIANCE_TONE[st] : cn('border-[#272B34] text-[#646A75]', canCompliance && 'hover:text-[#C9CCD2]'), !canCompliance && compliance.status !== st && 'hidden')}>{COMPLIANCE_WORDS[st]}</button>
        ))}
        {!canCompliance ? (note ? <span className="flex-1 text-sm text-[#C9CCD2]">{note}</span> : <span className="flex-1" />) : <input aria-label="Compliance note" className="min-w-[10rem] flex-1 rounded-lg border-2 border-[#272B34] px-3 py-1 text-sm" placeholder="Compliance note" value={note} onChange={e => setNote(e.target.value)}
          onBlur={() => note !== (compliance.note || '') && act(() => studio.compliance(line.batch, line.id, compliance.status, note))} />}
        <button className="text-xs text-[#858B96] hover:text-[#ECEDEF]" onClick={() => { setDraft(final_text); setEditing(true); }} title={line.ready ? 'Editing makes a new version; the signed-off wording is kept' : undefined}>edit wording</button>
        {compliance.by && <span className="text-xs text-[#858B96]">{compliance.by}, {when(compliance.at)}{compliance.sha256 && compliance.sha256 !== item.sha256 ? ' · on an earlier wording' : ''}</span>}
        <button className="text-xs text-[#646A75] hover:text-[#ECEDEF]" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'hide history' : `history${versions.length ? ` · ${versions.length} version${versions.length === 1 ? '' : 's'}` : ''}`}</button>
      </div>
      {showHistory && <LineHistory line={line} />}
    </div>
  );
}

// ---------- rules versions (hosted) ----------

function Rules({ meta, admin, onActivated }: { meta: Meta | null; admin: boolean; onActivated: () => void }) {
  const [list, setList] = useState<RulesVersion[]>([]);
  const [error, setError] = useState('');
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [drafted, setDrafted] = useState<string | null>(null); // just uploaded as a draft: not live yet
  const [active, setActive] = useState<ActiveRules | null>(null);
  // Versions exist only hosted; the plain-words view of the live rules works everywhere.
  const load = () => { if (HOSTED) studio.rules().then(setList).catch(e => setError(e.message)); studio.activeRules().then(setActive).catch(() => {}); };
  useEffect(() => { load(); }, []);
  const live = list.find(r => r.status === 'active') || (active && !HOSTED ? { version: active.version, status: 'active', created_at: active.updated || '' } as RulesVersion : undefined);
  async function activate(v: string, ask = true) {
    if (ask && !window.confirm(`Make ${v} the live rules? New checks use it straight away.`)) return;
    try { setList(await studio.activateRules(v)); setDrafted(null); onActivated(); } catch (e: any) { setError(e.message); }
  }
  async function upload(andActivate: boolean) {
    if (!file) return;
    try {
      const body = JSON.parse(await file.text());
      const v = version || body.version;
      if (andActivate && !window.confirm(`Upload ${v} and make it the live rules? New checks use it straight away.`)) return;
      setList(await studio.uploadRules(v, body, notes, andActivate));
      setDrafted(andActivate ? null : v);
      if (andActivate) onActivated();
      setFile(null); setVersion(''); setNotes(''); setError('');
    } catch (e: any) { setError(e.message); }
  }
  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>Rules</h1>
        <p className="text-base text-[#A3A8B1]">Every line is checked against the live rules, built from the client’s legal, brand and persona material. Each run records the version it was checked under. {admin ? 'You can upload and activate versions.' : 'Brook changes them; here they are in plain words.'}</p>
      </div>
      <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border-2 px-5 py-4', live ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-amber-400/60 bg-amber-400/10')}>
        <span className={cn('text-sm font-semibold uppercase tracking-wider', live ? 'text-emerald-300' : 'text-amber-200')}>Live</span>
        {live
          ? <span className="text-lg"><span className="font-mono font-semibold">{live.version}</span><span className="text-base text-[#A3A8B1]">{live.activated_by ? `, activated by ${live.activated_by}` : live.created_by ? `, uploaded by ${live.created_by}` : ''}{live.activated_at ? ` at ${when(live.activated_at)}` : ` on ${when(live.created_at)}`}</span></span>
          : <span className="text-base text-amber-100">No rules are live yet. Upload a version and activate it.</span>}
      </div>
      {drafted && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-amber-400/60 bg-amber-400/10 px-5 py-4 text-base text-amber-50">
          <span><span className="font-mono font-semibold">{drafted}</span> uploaded as a draft. {live ? <><span className="font-mono">{live.version}</span> is still live.</> : 'Nothing is live yet.'}</span>
          <PinkButton className="ml-auto px-4 py-1.5 text-base" onClick={() => activate(drafted)}>Activate {drafted}</PinkButton>
        </div>
      )}
      {error && <div className="rounded-lg border-2 border-red-500/45 bg-red-500/10 p-3 text-base text-red-200">{error}</div>}
      {active && <LiveRules active={active} meta={meta} />}
      {HOSTED && <h2 className="pt-2 text-lg font-semibold">Versions</h2>}
      {HOSTED && <ul className="divide-y divide-[#272B34] rounded-xl border border-[#272B34] bg-[#16181D]">
        {list.map(r => (
          <li key={r.version} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="font-mono text-base font-semibold">{r.version}</span>
            <Chip tone={r.status === 'active' ? 'outline' : 'grey'} className={r.status === 'active' ? 'border-emerald-500 text-emerald-300' : ''}>{r.status === 'active' ? 'live' : r.status}</Chip>
            <span className="text-sm text-[#858B96]">{when(r.created_at)}{r.created_by ? ` · ${r.created_by}` : ''}{r.notes ? ` · ${r.notes}` : ''}</span>
            {admin && r.status !== 'active' && <GhostButton className="ml-auto" onClick={() => activate(r.version)}>Activate</GhostButton>}
          </li>
        ))}
        {!list.length && !error && <li className="px-5 py-3 text-[#858B96]">No versions yet.</li>}
      </ul>}
      {admin && (
        <section className="space-y-3 rounded-xl border border-dashed border-[#4A505D] p-5">
          <h2 className="text-lg font-semibold">Upload a new version</h2>
          <p className="text-sm text-[#A3A8B1]">A studio-rules.json file. “Upload and activate” makes it live straight away; “Upload as draft” keeps the current version live until you activate the new one. Versions are never overwritten.</p>
          <input type="file" accept="application/json,.json" onChange={e => setFile(e.target.files?.[0] || null)} className="text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <input className="rounded-lg border-2 border-[#343946] px-3 py-2 text-base" placeholder="Version (defaults to the file’s)" value={version} onChange={e => setVersion(e.target.value)} />
            <input className="rounded-lg border-2 border-[#343946] px-3 py-2 text-base" placeholder="What changed" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <PinkButton disabled={!file} onClick={() => upload(true)}>Upload and activate</PinkButton>
            <GhostButton disabled={!file} className="text-base" onClick={() => upload(false)}>Upload as draft</GhostButton>
          </div>
        </section>
      )}
    </div>
  );
}

// ---------- 6. Pre-flight: the finished asset for each signed-off naming code ----------

const SEV_ORDER = { red: 0, amber: 1, grey: 2 } as const;
const COPY_STATUS: Record<string, { tone: 'grey' | 'amber' | 'red' | 'outline'; words: string }> = {
  match: { tone: 'outline', words: 'matches' }, reworded: { tone: 'amber', words: 'reworded' },
  'not on asset': { tone: 'red', words: 'not on the asset' }, 'not expected on asset': { tone: 'grey', words: 'not expected on the asset' },
};

/** An image or video the signed-in API serves (fetched with the token, shown from a blob URL). */
function AuthMedia({ path, video, className, alt }: { path: string; video?: boolean; className?: string; alt?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let u = '';
    setUrl(null); setFailed(false);
    studio.imageUrl(path).then(x => { u = x; setUrl(x); }).catch(() => setFailed(true));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [path]);
  if (failed) return <div className={cn('flex items-center justify-center rounded-lg bg-[#101216] text-xs text-[#646A75]', className)}>not available</div>;
  if (!url) return <div className={cn('animate-pulse rounded-lg bg-[#1C1F26]', className)} />;
  return video ? <video src={url} controls preload="metadata" className={cn('rounded-lg bg-black', className)} /> : <img src={url} alt={alt || ''} className={cn('rounded-lg object-contain bg-[#101216]', className)} />;
}

/** Codes grouped by the visual they run on (codes sharing an upload together), in list order. */
function byVisual(ss: PfStub[]): Array<[string, PfStub[]]> {
  const groups = new Map<string, PfStub[]>();
  for (const s of ss) {
    const k = s.upload ? `u:${s.upload.id}` : `s:${s.stub}`;
    groups.set(k, [...(groups.get(k) || []), s]);
  }
  return [...groups.entries()].map(([k, g]) => [k.startsWith('u:') ? g[0].upload!.files.map(f => f.filename).join(', ') : '', g]);
}

function stubState(s: PfStub): { words: string; tone: 'grey' | 'amber' | 'red' | 'outline'; className?: string } {
  if (s.status.status === 'ready') return { words: 'Ready to traffic', tone: 'outline', className: 'border-emerald-500 text-emerald-300' };
  if (!s.upload) return { words: 'not uploaded', tone: 'grey' };
  if (!s.audit || s.audit.id && s.audit.status === 'queued') return { words: 'not audited', tone: 'grey' };
  if (s.audit.status === 'running') return { words: 'auditing…', tone: 'amber' };
  if (s.audit.status === 'failed') return { words: 'audit failed', tone: 'red' };
  if (s.audit.open_red) return { words: `${s.audit.open_red} red to resolve`, tone: 'red' };
  return { words: 'needs review', tone: 'amber' };
}

function Preflight({ meta }: { meta: Meta }) {
  const enabled = !!meta.preflight?.enabled;
  const canReady = !!meta.preflight?.can_set_ready;
  const [stubs, setStubs] = useState<PfStub[]>([]);
  const [sel, setSel] = useState<string | null>(params.get('stub'));
  const [report, setReport] = useState<PfReport | null>(null);
  const [agreement, setAgreement] = useState<{ marked: number; agree: number; rate: number | null } | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [pending, setPending] = useState<{ upload_id: string; estimate: { usd: number; seconds: number } } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const esRef = useRef<{ close: () => void } | null>(null);
  useEffect(() => () => esRef.current?.close(), []);

  const loadStubs = useCallback(() => studio.pfStubs().then(s => {
    setStubs(s);
    setSel(cur => (cur && s.some(x => x.stub === cur) ? cur : s[0]?.stub ?? null));
  }), []);
  const loadAgreement = useCallback(() => studio.pfAgreement().then(setAgreement).catch(() => {}), []);
  const loadReport = useCallback((stub: string) => studio.pfReport(stub).then(setReport), []);
  const refresh = useCallback(async () => {
    try { await Promise.all([loadStubs(), loadAgreement(), sel ? loadReport(sel) : Promise.resolve()]); setError(''); }
    catch (e: any) { setError(e.message); }
  }, [loadStubs, loadAgreement, loadReport, sel]);
  useEffect(() => { if (enabled) { loadStubs().catch(e => setError(e.message)); loadAgreement(); } }, [enabled, loadStubs, loadAgreement]);
  useEffect(() => { setPending(null); setFiles([]); setReport(null); if (sel && enabled) loadReport(sel).catch(e => setError(e.message)); }, [sel, enabled, loadReport]);

  if (!enabled) return <div className="max-w-3xl rounded-xl border border-[#272B34] bg-[#16181D] p-6 text-base text-[#A3A8B1]">Pre-flight needs the database: in <code>backend/</code>, run <code>npx tsx scripts/studio.ts serve --store pg --database-url …</code> (hosted Studio has it on).</div>;

  async function upload(also: string[]) {
    if (!sel || !files.length) return;
    setError(''); setProgress('Uploading…');
    try {
      const r = await studio.pfUpload(sel, files, also);
      if (r.format_notes?.length) setError(r.format_notes.join(' '));
      setPending({ upload_id: r.upload_id, estimate: r.estimate });
      setFiles([]); setProgress('');
      await refresh();
    } catch (e: any) { setProgress(''); setError(e.message); }
  }
  async function runAudit(uploadId: string) {
    setError('');
    try {
      let r;
      try { r = await studio.pfAudit(uploadId); }
      catch (e: any) {
        if (e.status !== 409) throw e;
        if (!window.confirm(`This audit is estimated at $${e.body.estimate.toFixed(2)}, over the $${meta.ask_over} ask-first line. Run it?`)) return;
        r = await studio.pfAudit(uploadId, true);
      }
      setPending(null);
      setProgress('Starting the audit…');
      await refresh();
      esRef.current?.close();
      esRef.current = studio.events(r.job, (e: StudioEvent) => {
        if (e.type === 'status') setProgress(e.message);
        if (e.type === 'error') { setProgress(''); setError(`The audit stopped: ${e.message}`); refresh(); }
        if (e.type === 'done') { setProgress(''); refresh(); }
      });
    } catch (e: any) { setError(e.message); }
  }

  const groups = new Map<string, PfStub[]>();
  for (const s of stubs) groups.set(`${s.persona}|${s.territory}`, [...(groups.get(`${s.persona}|${s.territory}`) || []), s]);
  const rate = agreement?.rate;

  return (
    <div className="max-w-[1500px] space-y-5">
      <div className="flex flex-wrap items-start gap-4 rounded-xl border border-[#272B34] bg-[#16181D] p-5">
        <div className="mr-auto max-w-3xl">
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>Pre-flight</h1>
          <p className="mt-1 text-base text-[#A3A8B1]">The finished asset for each signed-off naming code, checked against the signed-off copy and the rules before it goes to Add3. Agree or disagree with each flag; red flags are fixed with a new upload or overridden with a reason, then the asset is marked Ready to traffic.</p>
        </div>
        <div className="min-w-[15rem] rounded-lg border border-[#272B34] bg-[#101216] px-4 py-3">
          <Label>Your verdicts on the flags</Label>
          <p className="mb-1 max-w-[16rem] text-xs text-[#858B96]">They help us tune the checks (the aim: agree with 9 in 10).</p>
          <div className="text-2xl font-bold">{rate === null || rate === undefined ? '–' : `${Math.round(rate * 100)}%`}<span className={cn('ml-2 text-sm font-medium', rate !== null && rate !== undefined && rate >= 0.9 ? 'text-emerald-300' : 'text-[#858B96]')}>aim 90%</span></div>
          <div className="text-sm text-[#858B96]">{agreement ? `${agreement.agree} of ${agreement.marked} agreed so far` : ''}</div>
        </div>
        <div className="flex flex-col gap-2">
          <GhostButton className="text-base" onClick={() => studio.download('/preflight/features.csv', 'preflight-features.csv')} title="The tags on each ad, for the weekly read of live results (B3)">Export tags for the weekly read</GhostButton>
          <GhostButton className="text-base" onClick={() => studio.download('/preflight/handoff.csv', 'asset-handoff.csv')}>Asset handoff list</GhostButton>
        </div>
      </div>
      {meta.preflight?.storage?.startsWith('refused') && <div className="rounded-lg border-2 border-amber-400/50 bg-amber-400/10 p-3 text-base text-amber-100">Uploads are switched off: {meta.preflight.storage.replace(/^refused:\s*/, '')}. An admin sets this on Railway.</div>}
      {error && <div className="rounded-lg border-2 border-red-500/45 bg-red-500/10 p-3 text-base text-red-200">{error}</div>}
      {!stubs.length && !error && <div className="text-base text-[#858B96]">Nothing signed off yet. Mark lines Ready for production first; each naming code then gets its asset here.</div>}

      {stubs.length > 0 && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:self-start lg:overflow-y-auto">
            {[...groups.entries()].map(([k, ss]) => (
              <section key={k} className="rounded-xl border border-[#272B34] bg-[#16181D] p-3">
                <div className="mb-2 px-1 text-sm font-semibold">{meta.personas[ss[0].persona]?.name || ss[0].persona} · {meta.territories[ss[0].territory]?.name || ss[0].territory}</div>
                <ul className="space-y-1.5">
                  {byVisual(ss).map(([visual, group]) => group.map((s, gi) => {
                    const st = stubState(s);
                    return (
                      <li key={s.stub} className={cn(visual && group.length > 1 && gi > 0 && '-mt-1 ml-3 border-l-2 border-[#343946] pl-2')}>
                        {visual && gi === 0 && group.length > 1 && <div className="mb-1 px-1 text-xs text-[#858B96]">One visual, {group.length} codes: {visual}</div>}
                        <button onClick={() => setSel(s.stub)} className={cn('w-full rounded-lg border px-3 py-2 text-left transition', sel === s.stub ? 'border-[#D94D8F] bg-[#D94D8F]/10' : 'border-[#272B34] hover:border-[#4A505D]')}>
                          <div className="flex items-center gap-2">
                            <span className="truncate font-mono text-sm" title={NAMING_TIP}>{s.stub}</span>
                            <Chip tone={st.tone} className={cn('ml-auto shrink-0 text-xs', st.className)}>{st.words}</Chip>
                            {s.audit?.stale && <Chip tone="amber" className="shrink-0 text-xs" title={s.audit.stale}>older rules</Chip>}
                          </div>
                          <div className="mt-1 truncate text-sm text-[#858B96]">{s.copy.map(c => c.text).join(' · ')}</div>
                        </button>
                      </li>
                    );
                  }))}
                </ul>
              </section>
            ))}
          </aside>

          <main className="min-w-0 space-y-4">
            {!report && <div className="text-base text-[#858B96]">Loading…</div>}
            {report && <PreflightReport meta={meta} report={report} stubs={stubs} canReady={canReady} progress={progress} pending={pending} files={files} setFiles={setFiles}
              onUpload={upload} onAudit={runAudit} onChanged={refresh} onError={setError} />}
          </main>
        </div>
      )}
    </div>
  );
}

function PreflightReport({ meta, report, stubs, canReady, progress, pending, files, setFiles, onUpload, onAudit, onChanged, onError }: {
  meta: Meta; report: PfReport; stubs: PfStub[]; canReady: boolean; progress: string;
  pending: { upload_id: string; estimate: { usd: number; seconds: number } } | null;
  files: File[]; setFiles: (f: File[]) => void; onUpload: (also: string[]) => void; onAudit: (uploadId: string) => void;
  onChanged: () => Promise<void>; onError: (m: string) => void;
}) {
  // Tolerate a server from before shared visuals / post copy (fields missing).
  report = { ...report, same_visual_as: report.same_visual_as ?? [], on_asset_copy: report.on_asset_copy ?? report.copy, post_copy: report.post_copy ?? [] };
  const a = report.audit;
  const res = a?.result || null;
  const up = report.upload;
  const current = !!(report.audit && report.upload && report.audit.upload_id === report.upload.id);
  const main = (current ? report.flags : []).filter(f => !f.cross_persona).sort((x, y) => (x.check === 'copy_match' ? -1 : 0) - (y.check === 'copy_match' ? -1 : 0) || SEV_ORDER[x.severity] - SEV_ORDER[y.severity]);
  const cross = (current ? report.flags : []).filter(f => f.cross_persona);
  const openRed = main.filter(f => f.severity === 'red' && !f.override).length;
  // The latest audit may be of an earlier upload: only findings for the current upload count.
  const auditForLatest = !!(a && up && a.upload_id === up.id);
  const auditedLatest = auditForLatest && a!.status === 'done';
  const ready = report.status.status === 'ready';
  const readyBlock = !up ? 'Upload the asset first.' : !auditForLatest ? 'Run the audit on this upload first.' : !a ? 'Run the audit first.' : a.status === 'running' || a.status === 'queued' ? 'The audit is still running.' : a.status === 'failed' ? 'The audit failed; run it again.' : openRed ? `${openRed} red flag${openRed === 1 ? '' : 's'} to fix (a new upload) or override.` : '';
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await onChanged(); } catch (e: any) { onError(e.body?.blocking ? `${e.message}: ${e.body.blocking.map((b: any) => b.label || b.rule).join('; ')}` : e.message); } };
  const copyRows = res?.copy_match ?? res?.report?.copy_match;
  const [also, setAlso] = useState<string[]>([]);
  useEffect(() => { setAlso([]); }, [report.stub]);
  // Other signed-off codes in the same set: 2-3 copy lines often run on one visual.
  const siblings = stubs.filter(s => s.stub !== report.stub && s.persona === report.persona && s.territory === report.territory);
  const secs = (n: number) => (n >= 90 ? `${Math.round(n / 60)} min` : `${Math.round(n)} s`);
  const tagged = res ? Object.entries(res.features || {}).filter(([, p]) => p >= 0.5).sort((x, y) => y[1] - x[1]) : [];

  return (
    <>
      <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border-2 px-5 py-4', ready ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-[#272B34] bg-[#16181D]')}>
        <div className="mr-auto">
          <div className="font-mono text-lg font-semibold" title={NAMING_TIP}>{report.stub}</div>
          <div className="text-sm text-[#858B96]">{personaName(meta, report.persona)} · {territoryName(meta.territories[report.territory]) || report.territory} · signed off in {report.signoff_id}</div>
        </div>
        {ready
          ? <span className="text-base text-emerald-100"><span className="font-semibold">Ready to traffic</span> · {report.status.ready_by}, {when(report.status.ready_at)}</span>
          : <span className="text-sm text-[#A3A8B1]">{readyBlock || (canReady ? 'Reviewed and nothing red left open.' : '')}</span>}
        {canReady && (ready
          ? <GhostButton className="text-base" onClick={() => act(() => studio.pfReady(report.stub, false))}>Take back</GhostButton>
          : <PinkButton className="px-4 py-2 text-base" disabled={!!readyBlock} onClick={() => act(() => studio.pfReady(report.stub, true))}>Mark Ready to traffic</PinkButton>)}
        {!canReady && !ready && <span className="text-xs text-[#646A75]">Set by the creative lead or an admin</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          <section className="space-y-3 rounded-xl border border-[#272B34] bg-[#16181D] p-4">
            {a?.stale && auditForLatest && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                <span className="min-w-0 flex-1">{a.stale}</span>
                {up && <PinkButton className="px-3 py-1 text-sm" disabled={!!progress} onClick={() => onAudit(up.id)}>Audit again</PinkButton>}
              </div>
            )}
            {report.format_note && <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">{report.format_note}</p>}
            {report.same_visual_as.length > 0 && <p className="text-sm text-[#A3A8B1]">Same visual as <span className="font-mono">{report.same_visual_as.join(', ')}</span>. Checked once; copy match is for this code’s own lines.</p>}
            <div>
              <Label>On the asset (checked against it)</Label>
              {report.on_asset_copy.length
                ? <ul className="space-y-2">{report.on_asset_copy.map(c => <li key={c.line_id}><div className="text-xs text-[#858B96]">{c.label} · v{c.version}</div><div className="text-base leading-snug text-[#F2F3F5]">{c.text}</div></li>)}</ul>
                : <p className="text-sm text-[#858B96]">None: this code’s copy all runs in the post.</p>}
            </div>
            {report.post_copy.length > 0 && (
              <div>
                <Label>Post copy (travels with the ad, not checked against the asset)</Label>
                <ul className="space-y-2">{report.post_copy.map(c => <li key={c.line_id}><div className="text-xs text-[#858B96]">{c.label} · v{c.version}</div><div className="text-base leading-snug text-[#C9CCD2]">{c.text}</div></li>)}</ul>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
            <Label>The asset</Label>
            {up ? (
              <>
                <div className={cn('grid gap-2', up.kind === 'carousel' ? 'grid-cols-3' : 'grid-cols-1')}>
                  {up.files.map(f => (
                    <div key={f.position}>
                      <AuthMedia path={studio.pfFile(up.id, f.position)} video={up.kind === 'video'} alt={f.filename} className={up.kind === 'carousel' ? 'aspect-square w-full' : 'max-h-80 w-full'} />
                      {up.kind === 'carousel' && <div className="mt-0.5 text-center text-xs text-[#858B96]">card {f.position + 1}</div>}
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-sm text-[#858B96]">{up.kind} · {up.files.map(f => f.filename).join(', ')} · {up.uploaded_by}, {when(up.uploaded_at)}</div>
              </>
            ) : <p className="text-sm text-[#858B96]">Nothing uploaded yet.</p>}
            <div className="mt-3 space-y-2 border-t border-[#272B34] pt-3">
              <input key={up?.id || 'none'} type="file" multiple accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime" onChange={e => setFiles([...(e.target.files || [])])} className="text-sm" />
              <p className="text-xs text-[#646A75]">One image (static), several images (carousel cards, in order), or one video (MP4, MOV). A new upload replaces the asset and reopens it for review.</p>
              {siblings.length > 0 && files.length > 0 && (
                <fieldset className="rounded-lg border border-[#272B34] px-3 py-2">
                  <legend className="px-1 text-xs text-[#858B96]">Also use this visual for (the same asset, another copy line)</legend>
                  {siblings.map(s => (
                    <label key={s.stub} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-[#D94D8F]" checked={also.includes(s.stub)} onChange={e => setAlso(cur => e.target.checked ? [...cur, s.stub] : cur.filter(x => x !== s.stub))} />
                      <span className="font-mono">{s.stub}</span>
                      <span className="truncate text-[#858B96]">{s.copy.map(c => c.text).join(' · ')}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <PinkButton className="px-4 py-1.5 text-base" disabled={!files.length || !!progress} onClick={() => onUpload(also)}>{up ? 'Upload a new version' : 'Upload'}</PinkButton>
                {files.length > 0 && <span className="text-sm text-[#858B96]">{files.length} file{files.length === 1 ? '' : 's'}</span>}
              </div>
              {(pending || (up && !auditForLatest)) && !progress && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#343946] bg-[#101216] px-3 py-2 text-sm">
                  <span>{pending ? `About $${pending.estimate.usd.toFixed(2)} and ${secs(pending.estimate.seconds)} to audit.` : 'Not audited yet.'}</span>
                  <PinkButton className="ml-auto px-3 py-1 text-sm" disabled={!!progress} onClick={() => onAudit(pending?.upload_id || up!.id)}>Run the audit</PinkButton>
                </div>
              )}
              {a && up && auditForLatest && a.status === 'failed' && !progress && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-500/45 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                  <span className="min-w-0 flex-1">The audit failed: {a.error}</span>
                  <PinkButton className="px-3 py-1 text-sm" onClick={() => onAudit(up.id)}>Run again</PinkButton>
                </div>
              )}
              {a && up && auditedLatest && !progress && (
                <button className="text-xs text-[#858B96] underline-offset-2 hover:text-[#ECEDEF] hover:underline" onClick={() => onAudit(up.id)} title="Run the checks again on this upload (e.g. after a rules change)">Audit again</button>
              )}
              {progress && <div className="flex items-center gap-2 text-sm font-medium" style={{ color: PINK }}><span className="animate-pulse">●</span> {progress}</div>}
            </div>
            {report.history.length > 1 && (
              <details className="mt-3 text-sm text-[#858B96]"><summary className="cursor-pointer">Earlier uploads ({report.history.length - 1})</summary>
                <ul className="mt-1 space-y-0.5">{report.history.slice(1).map(h => <li key={h.id}>{h.kind}, {h.files} file{h.files === 1 ? '' : 's'} · {h.uploaded_by}, {when(h.uploaded_at)}</li>)}</ul>
              </details>
            )}
          </section>

          {res && auditForLatest && (
            <section className="space-y-3 rounded-xl border border-[#272B34] bg-[#16181D] p-4 text-sm">
              <div><Label>Text found on the asset</Label><pre className="whitespace-pre-wrap font-sans text-base text-[#C9CCD2]">{res.text_found || '(none)'}</pre></div>
              {res.transcript !== undefined && res.transcript !== null && <div><Label>Transcript</Label><p className="text-base text-[#C9CCD2]">{res.transcript || '(no speech)'}</p></div>}
              <div><Label>Features</Label>
                <div className="flex flex-wrap gap-1.5">{tagged.length ? tagged.map(([k, p]) => <Chip key={k} tone="outline" title={`P(yes) ${p.toFixed(2)}`}>{k.replace(/_/g, ' ')}</Chip>) : <span className="text-[#858B96]">none tagged</span>}</div>
              </div>
              {res.objection && <p className="border-l-4 border-[#343946] pl-3 text-base italic text-[#A3A8B1]">Skeptic: {res.objection}</p>}
              {!!res.notes?.length && <ul className="list-disc space-y-0.5 pl-5 text-[#858B96]">{res.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
              <div className="text-xs text-[#646A75]">{a?.engine}{a?.rules_version ? ` · rules ${a.rules_version}` : ''} · ${a?.usd.toFixed(3)} · {a?.started_by}, {when(a?.finished_at || a?.started_at)}</div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border-2 bg-[#16181D] p-4" style={{ borderColor: PINK }}>
            <h2 className="mb-2 text-lg font-semibold">Copy match</h2>
            <p className="mb-3 text-sm text-[#A3A8B1]">Does the asset carry the signed-off wording? A missing caveat is red.</p>
            {!auditedLatest && <p className="text-sm text-[#858B96]">{report.on_asset_copy.length ? 'Run the audit to check.' : 'Nothing to compare: this code’s copy runs in the post, not on the asset.'}</p>}
            {auditedLatest && copyRows && copyRows.length > 0 && (
              <table className="w-full text-left text-sm">
                <thead><tr className="text-xs uppercase text-[#858B96]"><th className="pb-1 pr-3">Field</th><th className="pb-1 pr-3">Signed off</th><th className="pb-1 pr-3">On the asset</th><th className="pb-1">Result</th></tr></thead>
                <tbody>{copyRows.map((r, i) => (
                  <tr key={i} className="border-t border-[#272B34] align-top">
                    <td className="py-1.5 pr-3 text-[#858B96]">{r.field}</td>
                    <td className="py-1.5 pr-3">{r.signed_off}</td>
                    <td className="py-1.5 pr-3 text-[#C9CCD2]">{r.found || '–'}</td>
                    <td className="py-1.5"><Chip tone={COPY_STATUS[r.status]?.tone || 'grey'} className="text-xs">{COPY_STATUS[r.status]?.words || r.status}</Chip></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {auditedLatest && (!copyRows || !copyRows.length) && !report.on_asset_copy.length && <p className="text-sm text-[#858B96]">Nothing to compare: this code’s copy runs in the post, not on the asset.</p>}
            {auditedLatest && !copyRows && report.on_asset_copy.length > 0 && (main.some(f => f.check === 'copy_match')
              ? <p className="text-sm text-red-200">See the copy-match flag{main.filter(f => f.check === 'copy_match').length === 1 ? '' : 's'} below.</p>
              : <p className="text-sm text-emerald-200">The signed-off wording is on the asset.</p>)}
          </section>

          <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
            <h2 className="mb-2 text-lg font-semibold">Flags <span className="text-sm font-normal text-[#858B96]">{auditedLatest ? `${main.filter(f => f.severity === 'red').length} red · ${main.filter(f => f.severity === 'amber').length} amber · ${main.filter(f => f.severity === 'grey').length} grey` : ''}</span></h2>
            {!auditedLatest && <p className="text-sm text-[#858B96]">No finished audit for this upload yet.</p>}
            {auditedLatest && !main.length && <p className="text-sm text-emerald-200">No flags.</p>}
            <ul className="space-y-3">{main.map(f => <PfFlagRow key={f.id} flag={f} canOverride={canReady} onChanged={onChanged} onError={onError} />)}</ul>
          </section>

          {cross.length > 0 && (
            <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
              <h2 className="mb-1 text-lg font-semibold">How it travels</h2>
              <p className="mb-2 text-sm text-[#A3A8B1]">Other personas’ turn-offs, as grey notes. They don’t block anything.</p>
              <ul className="space-y-3">{cross.map(f => <PfFlagRow key={f.id} flag={f} canOverride={false} onChanged={onChanged} onError={onError} />)}</ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function PfFlagRow({ flag, canOverride, onChanged, onError }: { flag: PfFlag; canOverride: boolean; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const [overriding, setOverriding] = useState(false);
  const [details, setDetails] = useState(false);
  // The engine's numbers (P(Yes) …) are for tuning, behind "details"; the reason in words stays in view.
  const numeric = !!flag.why && /^\s*P\(yes\)/i.test(flag.why);
  const [why, setWhy] = useState('');
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await onChanged(); } catch (e: any) { onError(e.message); } };
  const agree = flag.agreements.filter(x => x.agree).length, disagree = flag.agreements.length - agree;
  const tone = flag.severity === 'red' ? 'red' : flag.severity === 'amber' ? 'amber' : 'grey';
  return (
    <li className={cn('rounded-lg border p-3', flag.severity === 'red' && !flag.override ? 'border-red-500/45 bg-red-500/5' : 'border-[#272B34]')}>
      <div className="flex gap-3">
        {flag.frame?.upload_id && flag.frame.position !== undefined && (
          <AuthMedia path={studio.pfFile(flag.frame.upload_id, flag.frame.position)} className="h-20 w-20 shrink-0 object-cover" alt={flag.frame.label} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={tone}>{flag.check === 'copy_match' ? 'copy match' : chipName(flag.rule)}</Chip>
            <span className="text-base text-[#ECEDEF]">{flag.label}</span>
            {flag.persona && flag.cross_persona && <span className="text-xs text-[#858B96]">({flag.persona})</span>}
          </div>
          {flag.quote && (flag.check === 'copy_match'
            ? <div className="mt-1 text-sm">{/^signed off/i.test(flag.quote) ? '' : 'Missing from the asset: '}<mark className="bg-amber-400/30 px-1 text-amber-50">{flag.quote}</mark></div>
            : <div className="mt-1 text-sm">On the asset: <mark className="bg-amber-400/30 px-1 text-amber-50">{flag.quote}</mark></div>)}
          {flag.why && !numeric && <div className="mt-0.5 text-sm text-[#A3A8B1]">{flag.why}</div>}
          {whatToDo(flag.rule) && <div className="mt-0.5 text-sm"><span className="font-semibold">What to do:</span> {whatToDo(flag.rule)}</div>}
          <div className="mt-0.5 text-xs text-[#858B96]">{[flag.where, flag.frame?.label && !flag.frame.upload_id ? `frame ${flag.frame.label}${flag.frame.description ? `: ${flag.frame.description}` : ''}` : '', `Source: ${plainSource(flag.source)}`].filter(Boolean).join(' · ')}
            <button className="ml-2 underline-offset-2 hover:underline" onClick={() => setDetails(!details)}>{details ? 'hide details' : 'details'}</button>
            {details && <span className="ml-2">{[numeric ? flag.why : '', flag.rule, flag.source].filter(Boolean).join(' · ')}</span>}
          </div>
          {flag.override && <div className="mt-2 rounded border border-red-500/30 bg-red-500/5 px-2 py-1 text-sm text-red-100"><span className="font-semibold">Overridden</span> by {flag.override.by}, {when(flag.override.at)}: “{flag.override.reason}”</div>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <GhostButton active={flag.mine === true} className="px-2 py-0.5 text-xs" onClick={() => act(() => studio.pfAgree(flag.id, true))}>Agree</GhostButton>
            <GhostButton active={flag.mine === false} className="px-2 py-0.5 text-xs" onClick={() => {
              const note = flag.mine === false ? undefined : window.prompt('Why not? (optional, helps tune the checks)') ?? undefined;
              act(() => studio.pfAgree(flag.id, false, note || undefined));
            }}>Disagree</GhostButton>
            {flag.agreements.length > 0 && <span className="text-xs text-[#858B96]" title={flag.agreements.map(x => `${x.by}: ${x.agree ? 'agree' : 'disagree'}${x.note ? ` (${x.note})` : ''}`).join('\n')}>{agree} agree · {disagree} disagree</span>}
            {flag.severity === 'red' && !flag.override && canOverride && !overriding && <GhostButton className="ml-auto px-2 py-0.5 text-xs" onClick={() => setOverriding(true)}>Override with a reason…</GhostButton>}
          </div>
          {overriding && (
            <div className="mt-2 space-y-2">
              <textarea rows={2} autoFocus className="w-full rounded-lg border-2 border-red-500/45 px-3 py-2 text-sm" placeholder="Why this asset can run as it is (recorded with your name, and shown here)" value={why} onChange={e => setWhy(e.target.value)} />
              <div className="flex gap-2">
                <PinkButton className="px-3 py-1 text-sm" disabled={why.trim().length < 5} onClick={() => act(async () => { await studio.pfOverride(flag.id, why); setOverriding(false); setWhy(''); })}>Save override</PinkButton>
                <GhostButton className="text-sm" onClick={() => setOverriding(false)}>Cancel</GhostButton>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** The live rules in plain words, read-only, with sources. Image-only brand rules are marked (Pre-flight uses them). */
function LiveRules({ active, meta }: { active: ActiveRules; meta: Meta | null }) {
  const sev = (r: RuleEntry) => r.severity === 'compliance'
    ? <Chip tone="red" className="shrink-0 text-xs">breaks a client rule</Chip>
    : r.severity === 'warn' ? <Chip tone="amber" className="shrink-0 text-xs">worth a look</Chip> : <Chip tone="grey" className="shrink-0 text-xs">a note</Chip>;
  const list = (items: RuleEntry[]) => (
    <ul className="space-y-2">
      {items.map(r => (
        <li key={r.id} className="flex items-start gap-2">
          {sev(r)}
          <div className="min-w-0">
            <div className="text-base text-[#ECEDEF]">{r.rule}{r.status === 'pending' && <span className="ml-2 text-xs text-amber-300">awaiting the client’s confirmation</span>}</div>
            {r.what_to_do && <div className="text-sm text-[#A3A8B1]"><span className="font-semibold">What to do:</span> {r.what_to_do}</div>}
            <div className="text-xs text-[#646A75]"><Src s={r.source} />{r.applies_to === 'both' ? ' · also checked on images' : ''}</div>
          </div>
        </li>
      ))}
    </ul>
  );
  const copyBrand = active.brand.filter(b => b.applies_to !== 'visual');
  const visual = active.brand.filter(b => b.applies_to === 'visual');
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-5">
        <h2 className="mb-1 text-lg font-semibold">Copy rules <span className="text-sm font-normal text-[#858B96]">(every line)</span></h2>
        <p className="mb-3 text-sm text-[#858B96]">Red means it breaks a client rule: fix it, or override with a reason.</p>
        {list(active.compliance)}
      </section>
      <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-5">
        <h2 className="mb-3 text-lg font-semibold">Brand rules</h2>
        {list(copyBrand)}
        {visual.length > 0 && (
          <>
            <h3 className="mb-2 mt-4 text-base font-semibold">On images and video only <span className="text-sm font-normal text-[#858B96]">(checked in Pre-flight, not on copy)</span></h3>
            {list(visual)}
          </>
        )}
        {active.disclaimer && (
          <>
            <h3 className="mb-2 mt-4 text-base font-semibold">On the last screen <span className="text-sm font-normal text-[#858B96]">(checked in Pre-flight)</span></h3>
            {list([active.disclaimer])}
            <p className="mt-2 text-sm text-[#A3A8B1]">{active.disclaimer.active ? <>Approved text: “{active.disclaimer.text}”</> : 'Off for now: no approved disclaimer text in the rules yet. Pre-flight shows a grey note until it’s added.'}</p>
          </>
        )}
      </section>
      {active.clarity.length > 0 && (
        <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-5">
          <h2 className="mb-3 text-lg font-semibold">Clarity</h2>
          {list(active.clarity)}
        </section>
      )}
      <section className="space-y-3 rounded-xl border border-[#272B34] bg-[#16181D] p-5">
        <h2 className="text-lg font-semibold">Personas</h2>
        {meta ? personaKeys(active.personas).map(k => <PersonaPanel key={k} meta={meta} persona={k} />) : Object.entries(active.personas).map(([k, p]) => <div key={k} className="font-semibold">{p.name}</div>)}
      </section>
    </div>
  );
}
