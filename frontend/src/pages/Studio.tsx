// B1-lite Copy Studio (dev-only page). Talks to the local studio API
// (`npx tsx scripts/studio.ts serve` in backend/), which reads and writes the
// client folder on Brook's laptop. Built for a shared screen: large type, high
// contrast, flags as neutral chips (red = compliance, amber = warning). Nothing
// here is a score.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getUser, setUser, studio, type Batch, type Brief, type CompareSet, type Flag, type Line, type Meta, type OwnLine, type RefDoc, type RunSummary, type ShortRow, type StudioEvent, type Territory, type Tone } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { BookOpen, ChevronRight, Shuffle } from 'lucide-react';

const PINK = '#D94D8F';
type Tab = 'home' | 'territories' | 'brief' | 'review' | 'shortlist' | 'compare' | 'readout';
// The writing flow, in order. Readout and Blind compare sit apart from it.
const FLOW: Array<[Tab, string]> = [['territories', 'Territories'], ['brief', 'Write & brief'], ['review', 'Review'], ['shortlist', 'Shortlist']];
// Deep links for the demo: /studio?tab=review&batch=<id>&open=L07 (opens that line's first flag), &compare=<name>.
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
  LIMIT_VISIBLE: 'truncated', LIMIT_MAX: 'over limit', NEAR_DUP: 'similar line', CL_GLANCE: 'not a glance read', CL_PRODUCT: 'product unclear',
  COMP_UGC_MEMBER: 'cast a member', COMP_VERBATIM: 'verbatim quote', FIG_UNSOURCED: 'unsourced figure', FIG_CITATION: 'needs citation', FIG_ATTRIBUTION: 'misattributed figure',
  COMP_DIRECT_PAY: 'direct pay caveat', COMP_PAYS_FOR_ITSELF: 'pays for itself', COMP_PAID_SHARE: 'whole bill', COMP_PREEXISTING: 'pre-existing', COMP_ROUTINE: 'routine care',
  COMP_CLAIM_SPEED: 'claim speed', COMP_CHEAP_LOCKED: 'cheap / locked price', COMP_PRICE_LEAD: 'price lead', COMP_COVERAGE_CAVEAT: 'coverage caveat', COMP_SUPERLATIVE: 'superlative',
  COMP_FACT_FRAMING: 'figure framing', BR_NAMING: '"pet insurance"', BR_CASE: 'all caps', BR_BOAST: 'boastful', BR_PLAIN: 'not plain', BR_SAD_PET: 'sad pet', CHECK_FAILED: 'check failed',
};
const chipName = (rule: string) => CHIP[rule] || (rule.startsWith('BRIEF_BANNED:') ? `banned: ${rule.slice(13)}` : /^[A-Z]+_T_/.test(rule) ? `turn-off: ${rule.replace(/^[A-Z]+_T_/, '').replace(/_/g, ' ').toLowerCase()}` : rule.replace(/_/g, ' ').toLowerCase());
const sevTone = (s: Flag['severity']) => (s === 'compliance' ? 'red' : s === 'warn' ? 'amber' : 'grey') as 'red' | 'amber' | 'grey';

// ---------- brand lockup: Ralph × client ----------

function Lockup({ onHome, small }: { onHome?: () => void; small?: boolean }) {
  const [clientLogo, setClientLogo] = useState(true);
  return (
    <button onClick={onHome} className="flex shrink-0 items-center gap-3" aria-label="VOICES Studio: how it works">
      <img src="/ralph-world.png" alt="Ralph" className={cn('object-contain drop-shadow-[0_0_10px_rgba(217,77,143,0.35)]', small ? 'h-7 w-7' : 'h-8 w-8')} />
      <span className={cn('font-light leading-none text-[#ECEDEF]', small ? 'text-lg' : 'text-xl')} style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>
        Voices <span className="font-medium" style={{ color: PINK }}>Studio</span>
      </span>
      {clientLogo && (
        <>
          <span className={cn('text-[#646A75]', small ? 'text-sm' : 'text-base')} aria-hidden>×</span>
          <img src={studio.url('/brand/client-logo')} alt="Trupanion" onError={() => setClientLogo(false)} className={cn('w-auto object-contain opacity-95', small ? 'h-4' : 'h-5')} />
        </>
      )}
    </button>
  );
}

// ---------- page ----------

export function Studio() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'home');
  const [brief, setBrief] = useState<Brief>({ persona: 'DINK', territory: 'DINK_NEVER', fields: [], tone: { dry_warm: 3, playful_plain: 3, short_long: 2 }, banned_words: [], banned_ideas: [], reference_lines: [], n: 20, model: 'gpt-4o' });
  const [batch, setBatch] = useState<Batch | null>(null);
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);
  const [user, setUserState] = useState(getUser());
  const [runsTick, setRunsTick] = useState(0); // refreshes the runs list after a run or a decision
  const [attached, setAttached] = useState<string | null>(null); // the run new lines go into, if any
  const esRef = useRef<EventSource | null>(null);

  const refreshMeta = useCallback(() => studio.meta().then(m => { setMeta(m); setErr(''); return m; }), []);
  useEffect(() => {
    refreshMeta().then(m => setBrief(b => ({ ...b, fields: m.personas[b.persona]?.default_fields || [] })))
      .catch(() => setErr('Studio API not running. In backend/: npx tsx scripts/studio.ts serve'));
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
    if (!getUser()) { setErr('Add your name (top right) first, so your runs are saved under it.'); return; }
    const into = opts.into || (attached && batch?.id === attached ? batch : null);
    const b: Brief = into ? { ...into.brief, ...brief, persona: into.brief.persona, territory: into.brief.territory } : brief;
    try {
      let r;
      try { r = await studio.generate(b, { batch: into?.id, ownOnly: opts.ownOnly }); }
      catch (e: any) {
        if (e.status !== 409) throw e;
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
  async function continueRun(id: string) {
    const b = await studio.batch(id);
    setBatch(b);
    setBrief({ ...b.brief, own_lines: [] });
    setAttached(b.id);
    setTab('review');
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
      <header className="sticky top-0 z-20 flex h-16 flex-nowrap items-center gap-5 border-b border-[#272B34] bg-[#16181D] px-6">
        <Lockup onHome={() => setTab('home')} />
        <nav className="flex flex-nowrap items-center gap-1">
          <GhostButton active={tab === 'home'} onClick={() => setTab('home')} className="whitespace-nowrap border-transparent px-3 py-1.5 text-sm">How it works</GhostButton>
          <span className="mx-1 h-5 w-px bg-[#343946]" aria-hidden />
          {FLOW.map(([t, label], i) => (
            <span key={t} className="flex items-center">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-[#4A505D]" aria-hidden />}
              <GhostButton active={tab === t} onClick={() => setTab(t)} className="flex items-center gap-1.5 whitespace-nowrap border-transparent px-2.5 py-1.5 text-sm">
                <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold', tab === t ? 'bg-[#0E0F12] text-white' : 'bg-[#272B34] text-[#A3A8B1]')}>{i + 1}</span>
                {t === 'review' && batch ? `Review (${batch.lines.length})` : label}
              </GhostButton>
            </span>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-2.5 text-sm text-[#858B96]">
          <span className="mr-1 h-5 w-px bg-[#343946]" aria-hidden />
          <button onClick={() => setTab('readout')} title="Reference: the persona intelligence readout" className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition', tab === 'readout' ? 'border-teal-300 bg-teal-300 text-[#0E0F12]' : 'border-teal-500/50 bg-teal-500/10 text-teal-200 hover:border-teal-300')}>
            <BookOpen className="h-4 w-4" aria-hidden /> Readout
          </button>
          <button onClick={() => setTab('compare')} title="A separate exercise, outside the writing flow" className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-dashed border-[#4B55A8] bg-[#1B2150] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#232A5C]">
            <Shuffle className="h-4 w-4" aria-hidden /> Blind compare
          </button>
          <UserBadge user={user} onChange={n => { setUser(n); setUserState(n); setRunsTick(t => t + 1); }} />
          {running && <span className="max-w-[16rem] truncate animate-pulse font-medium" style={{ color: PINK }} title={status}>● {status}</span>}
          {meta?.mock && <Chip tone="amber">mock</Chip>}
        </div>
      </header>
      {err && <div className="mx-8 mt-4 rounded-lg border-2 border-red-500/45 bg-red-500/10 p-4 text-base text-red-200">{err}</div>}
      <main className="px-6 py-6">
        {tab === 'home' && <Home />}
        {meta && tab === 'territories' && <Territories meta={meta} onSaved={() => refreshMeta()} onBrief={code => { const t = meta.territories[code]; setBrief(b => ({ ...b, persona: t.persona, territory: code, fields: b.persona === t.persona && b.fields.length ? b.fields : meta.personas[t.persona].default_fields })); setTab('brief'); }} />}
        {meta && tab === 'brief' && <BriefPanel meta={meta} brief={brief} run={run} running={running} user={user} runsTick={runsTick} onContinue={continueRun}
          setBrief={b => { if (attached && b.territory !== brief.territory) setAttached(null); setBrief(b); }}
          attachedRun={attached && batch?.id === attached ? batch : null} onNewRun={() => setAttached(null)} />}
        {meta && tab === 'review' && <Review meta={meta} batch={batch} setBatch={setBatch} status={status} running={running} onMore={more} onMoreRun={() => run({ into: batch })} onDecided={() => setRunsTick(t => t + 1)} />}
        {tab === 'readout' && <Readout persona={brief.persona} meta={meta} />}
        {meta && tab === 'shortlist' && <Shortlist batch={batch} />}
      </main>
    </div>
  );
}

// ---------- 0. landing: how Voices Studio works ----------

const STEPS: Array<{ title: string; what: string; you: string }> = [
  { title: 'Territories', what: 'Start from the pitch; update them as feedback comes in.', you: 'Edit, add or retire territories.' },
  { title: 'Write', what: 'Your lines come first, checked in seconds.', you: 'Write a few lines; pick fields and tone.' },
  { title: 'Generate', what: 'About 20 lines around yours, in your voice, covering what you didn’t.', you: 'Watch them arrive, already checked.' },
  { title: 'Review', what: 'Length, flags with their sources, and a skeptic’s objection.', you: 'Keep, cut, edit, or ask for more like this.' },
  { title: 'Shortlist', what: 'Kept lines get naming codes. Runs are saved to continue later.', you: 'Curate in Sheets and import it back.' },
];

function Home() {
  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <section className="space-y-3">
        <h1 className="text-4xl font-bold leading-tight tracking-tight" style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>
          Twenty options per persona, stress-tested as you write.
        </h1>
        <p className="text-lg text-[#A3A8B1]">You bring the taste. Studio brings range, the rules, and the audience’s pushback. The market decides what wins.</p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">How Voices Studio works</h2>
        <ol className="grid grid-cols-5 gap-3">
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
            <li className="flex items-center gap-2"><Chip tone="red">red</Chip> Compliance: a hard rule, or two checks agree.</li>
            <li className="flex items-center gap-2"><Chip tone="amber">amber</Chip> Worth a look: one check raised it.</li>
            <li className="flex items-center gap-2"><Chip tone="grey">grey</Chip> A note, e.g. cast a real member.</li>
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
          <span className="mt-auto pt-2 text-sm text-[#8F97D6]">In the header, on the right.</span>
        </div>
      </section>
    </div>
  );
}

// ---------- 1. brief ----------

function BriefPanel({ meta, brief, setBrief, run, running, user, runsTick, onContinue, attachedRun, onNewRun }: {
  meta: Meta; brief: Brief; setBrief: (b: Brief) => void; run: (o?: { ownOnly?: boolean }) => void; running: boolean;
  user: string; runsTick: number; onContinue: (id: string) => void;
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
      {attachedRun && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 px-4 py-3 text-base" style={{ borderColor: PINK, background: 'rgba(217,77,143,0.10)' }}>
          <span>Adding to your run <b>{meta.territories[attachedRun.brief.territory]?.name}</b> ({attachedRun.lines.length} lines). New lines go into it.</span>
          <GhostButton className="ml-auto px-3 py-1 text-sm" onClick={onNewRun}>Start a new run</GhostButton>
        </div>
      )}
      {/* Setup, in one row */}
      <section className="flex flex-wrap items-end gap-4 rounded-xl border border-[#272B34] bg-[#16181D] p-4">
        <div>
          <Label>Persona</Label>
          <select className="rounded-lg border-2 border-[#343946] bg-[#101216] px-3 py-2 text-base" value={brief.persona}
            onChange={e => { const p = e.target.value; const first = Object.entries(meta.territories).find(([, x]) => x.persona === p && x.status !== 'retired')?.[0] || ''; set({ persona: p, territory: first, fields: meta.personas[p].default_fields, own_lines: own.map(o => ({ ...o, field: meta.personas[p].default_fields[0] })) }); }}>
            {Object.entries(meta.personas).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <Label>Territory</Label>
          <select className="rounded-lg border-2 border-[#343946] bg-[#101216] px-3 py-2 text-base" value={brief.territory} onChange={e => set({ territory: e.target.value })}>
            {territories.map(([k, x]) => <option key={k} value={k}>{x.name}{x.origin === 'new' ? ' (new)' : x.origin === 'edited' ? ' (edited)' : ''}</option>)}
          </select>
        </div>
        <div>
          <Label>Fields</Label>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(meta.fields).map(([k, f]) => {
              const on = brief.fields.includes(k);
              return <GhostButton key={k} active={on} className="px-2.5 py-1.5 text-sm" onClick={() => set({ fields: on ? brief.fields.filter(x => x !== k) : [...brief.fields, k] })}>{f.label} · {f.visible}</GhostButton>;
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
      {t && <p className="px-1 text-base text-[#A3A8B1]"><span className="font-semibold">{t.name}</span> · {t.format} · leads on “{meta.personas[t.persona]?.triggers.find(x => x.id === t.angle)?.label}”. {t.premise}</p>}

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

function RunsList({ user, tick, meta, onContinue }: { user: string; tick: number; meta: Meta; onContinue: (id: string) => void }) {
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
              </div>
            </div>
            <GhostButton className="px-3 py-1 text-sm" onClick={() => onContinue(r.id)}>Continue</GhostButton>
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
      {Object.entries(meta.personas).map(([pk, p]) => {
        const list = Object.entries(meta.territories).filter(([, x]) => x.persona === pk && (showRetired || x.status !== 'retired'));
        return (
          <section key={pk}>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <GhostButton className="px-3 py-1 text-sm" onClick={() => setEditing(`new:${pk}`)}>+ New territory</GhostButton>
            </div>
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
        <h3 className="text-lg font-bold">{t.name}</h3>
        <Chip tone={t.origin === 'pitch' ? 'grey' : 'outline'} className={t.origin !== 'pitch' ? 'border-[#D94D8F] text-[#D94D8F]' : ''}>{t.origin === 'new' ? 'new' : t.origin === 'edited' ? 'edited' : 'from the pitch'}</Chip>
        {retired && <Chip tone="grey">retired</Chip>}
        {t.status === 'springboard' && <Chip tone="grey">springboard</Chip>}
      </div>
      <div className="mb-2 text-sm text-[#858B96]">{t.format} · leads on “{angle}”</div>
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

// ---------- readout: the persona intelligence readout, to review in the tool ----------

function Readout({ persona, meta }: { persona: string; meta: Meta | null }) {
  const [docs, setDocs] = useState<RefDoc[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    studio.docs().then(setDocs).catch(() => {});
    studio.docText('readout').then(setText).catch(e => setError(e.message));
  }, []);
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const toc = blocks.filter(b => b.type === 'h' && b.level <= 3) as Array<{ type: 'h'; level: number; text: string; id: string }>;
  // Jump to the section for the persona being briefed.
  const personaName = meta?.personas[persona]?.name.split(/[ (]/)[0].toUpperCase();
  useEffect(() => {
    if (!personaName || !toc.length) return;
    const target = toc.find(h => h.level === 3 && h.text.toUpperCase().includes(personaName));
    if (target) setTimeout(() => document.getElementById(target.id)?.scrollIntoView({ block: 'start' }), 50);
  }, [toc.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const deck = docs.find(d => d.id === 'readout-deck' && d.available);
  return (
    <div className="max-w-7xl space-y-5">
    <div className="flex items-center gap-3 rounded-xl border border-teal-500/40 bg-teal-500/10 px-4 py-2.5 text-sm text-teal-100">
      <BookOpen className="h-4 w-4" aria-hidden /> <span className="font-semibold uppercase tracking-wider text-teal-200">Reference</span>
      <span>The persona intelligence readout: background for the writing, outside the flow.</span>
    </div>
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[260px_1fr]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Label>Contents</Label>
        <nav className="max-h-[70vh] space-y-1 overflow-y-auto text-sm">
          {toc.map(h => <a key={h.id} href={`#${h.id}`} className={cn('block rounded px-2 py-1 hover:bg-[#1C1F26]', h.level === 3 ? 'pl-5 text-[#858B96]' : 'font-semibold')}>{h.text}</a>)}
        </nav>
        {deck && <a href={studio.url('/docs/readout-deck')} className="mt-4 block rounded-lg border-2 border-[#343946] px-3 py-2 text-center text-sm font-medium">Download the deck (.pptx)</a>}
      </aside>
      <article className="max-w-4xl rounded-xl border border-[#272B34] bg-[#16181D] p-8">
        {error && <p className="text-base text-red-300">{error}</p>}
        {!error && !text && <p className="text-[#858B96]">Loading…</p>}
        <Markdown blocks={blocks} />
      </article>
    </div>
    </div>
  );
}

// A small, safe Markdown renderer for the readout: headings, paragraphs,
// lists, quotes, tables, rules, bold, italic, code and links. No raw HTML.
type MdBlock =
  | { type: 'h'; level: number; text: string; id: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'hr' };
function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r/g, '').split('\n');
  const out: MdBlock[] = [];
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) { out.push({ type: 'h', level: h[1].length, text: h[2].trim(), id: slug(h[2]) || `h${i}` }); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { out.push({ type: 'hr' }); i++; continue; }
    if (l.trim().startsWith('|') && lines[i + 1] && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(l); const rows: string[][] = []; i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(cells(lines[i])); i++; }
      out.push({ type: 'table', head, rows }); continue;
    }
    if (/^\s*>/.test(l)) { const q: string[] = []; while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; } out.push({ type: 'quote', text: q.join(' ') }); continue; }
    if (/^\s*[-*+]\s+/.test(l)) { const items: string[] = []; while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++; } out.push({ type: 'ul', items }); continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { const items: string[] = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; } out.push({ type: 'ol', items }); continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|\s*>|\s*\|)/.test(lines[i])) { para.push(lines[i].trim()); i++; }
    out.push({ type: 'p', text: para.join(' ') });
  }
  return out;
}
function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[3] || m[4]) parts.push(<em key={k++}>{m[3] || m[4]}</em>);
    else if (m[5]) parts.push(<code key={k++} className="rounded bg-[#1C1F26] px-1 text-[0.9em]">{m[5]}</code>);
    else if (m[6]) parts.push(<a key={k++} href={m[7]} target="_blank" rel="noreferrer" className="text-[#D94D8F] underline">{m[6]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
function Markdown({ blocks }: { blocks: MdBlock[] }) {
  return (
    <div className="space-y-4 text-base leading-relaxed text-[#C9CCD2]">
      {blocks.map((b, i) => {
        if (b.type === 'h') {
          const cls = ['', 'text-3xl font-bold', 'mt-10 text-2xl font-bold', 'mt-8 text-xl font-semibold', 'mt-6 text-lg font-semibold', 'font-semibold', 'font-semibold'][b.level];
          return <div key={i} id={b.id} className={cn('scroll-mt-28 text-[#ECEDEF]', cls)} style={b.level <= 2 ? { fontFamily: '"Space Grotesk", system-ui, sans-serif' } : undefined}><Inline text={b.text} /></div>;
        }
        if (b.type === 'p') return <p key={i}><Inline text={b.text} /></p>;
        if (b.type === 'ul') return <ul key={i} className="list-disc space-y-1 pl-6">{b.items.map((x, k) => <li key={k}><Inline text={x} /></li>)}</ul>;
        if (b.type === 'ol') return <ol key={i} className="list-decimal space-y-1 pl-6">{b.items.map((x, k) => <li key={k}><Inline text={x} /></li>)}</ol>;
        if (b.type === 'quote') return <blockquote key={i} className="border-l-4 pl-4 italic text-[#A3A8B1]" style={{ borderColor: PINK }}><Inline text={b.text} /></blockquote>;
        if (b.type === 'hr') return <hr key={i} className="border-[#272B34]" />;
        return (
          <div key={i} className="overflow-x-auto">
            <table className="w-full border-collapse text-base">
              <thead><tr>{b.head.map((h, k) => <th key={k} className="border-b-2 border-[#343946] px-2 py-1 text-left font-semibold"><Inline text={h} /></th>)}</tr></thead>
              <tbody>{b.rows.map((r, k) => <tr key={k} className="border-b border-[#272B34] align-top">{r.map((c, j) => <td key={j} className="px-2 py-1"><Inline text={c} /></td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ---------- 2. review grid ----------

function Review({ meta, batch, setBatch, status, running, onMore, onMoreRun, onDecided }: { meta: Meta; batch: Batch | null; setBatch: React.Dispatch<React.SetStateAction<Batch | null>>; status: string; running: boolean; onMore: (l: Line, note: string) => void; onMoreRun: () => void; onDecided: () => void }) {
  const [group, setGroup] = useState<'angle' | 'structure'>('angle');
  const [filter, setFilter] = useState<'all' | 'compliance' | 'open' | 'kept'>('all');
  const [batches, setBatches] = useState<RunSummary[]>([]);
  useEffect(() => { studio.batches().then(setBatches).catch(() => {}); }, [batch?.id, running]);

  if (!batch) return <div className="text-base text-[#858B96]">No run open yet. Write your lines on the brief tab, or continue a saved run.</div>;
  const yours = batch.lines.filter(l => l.model === 'human').length;
  const checked = batch.lines.filter(l => l.status === 'checked').length;
  const shown = batch.lines.filter(l =>
    filter === 'all' ? true : filter === 'compliance' ? l.flags.some(f => f.severity === 'compliance') : filter === 'open' ? !l.decision : l.decision === 'keep' || l.decision === 'edit');
  const groups = new Map<string, Line[]>();
  for (const l of shown) {
    const k = group === 'angle' ? `${l.angle} · ${l.angle_label}` : l.structure.replace('_', ' ');
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
          {[...batches.map(b => b.id), ...(batches.some(b => b.id === batch.id) ? [] : [batch.id])].map(id => <option key={id} value={id}>{id}</option>)}
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
          <h2 className="mb-3 mt-2 text-lg font-bold capitalize">{g} <span className="font-normal text-[#858B96]">({ls.length})</span></h2>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {ls.map(l => <LineCard key={l.id} meta={meta} line={l} onChange={x => { replace(x); onDecided(); }} onMore={onMore} />)}
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
  useEffect(() => { setNote(line.note || ''); }, [line.note]);
  const f = meta.fields[line.field];
  const text = line.decision === 'edit' && line.edited_text ? line.edited_text : line.text;
  const chars = [...text].length;
  const over = f && chars > f.visible;
  const openFlag = line.flags.find(x => x.rule === open);
  const decide = async (patch: Partial<Pick<Line, 'decision' | 'edited_text' | 'note'>>) => onChange(await studio.decide(line.batch, line.id, patch));
  const border = line.decision === 'keep' || line.decision === 'edit' ? 'border-emerald-500' : line.decision === 'cut' ? 'border-[#343946] opacity-50' : line.model === 'human' ? 'border-[#D94D8F]/60' : 'border-[#272B34]';

  return (
    <div className={cn('rounded-xl border-2 bg-[#16181D] p-5', border)}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-[#858B96]">
        <span className="font-mono font-semibold text-[#ECEDEF]">{line.id.split('-').pop()}</span>
        {line.model === 'human' && <Chip tone="outline" className="border-[#D94D8F] font-semibold text-[#D94D8F]">yours</Chip>}
        <span>{f?.label || line.field}</span>
        <span className={cn('font-mono', over ? 'font-bold text-amber-300' : '')}>{chars}/{f?.visible}</span>
        <span>· {line.structure.replace('_', ' ')}</span>
        <span>· {line.tone_label}</span>
        {line.parent && <Chip tone="outline">more like {line.parent.split('-').pop()}</Chip>}
        {line.status !== 'checked' && <span className="animate-pulse" style={{ color: PINK }}>checking…</span>}
        {line.decided_by && line.decision && <span className="ml-auto text-xs text-[#858B96]">{line.decision} · {line.decided_by}</span>}
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
        <div className="mt-3 flex flex-wrap gap-1.5">
          {line.flags.map(fl => (
            <Chip key={fl.rule} tone={sevTone(fl.severity)} className="cursor-pointer" title={`${fl.label}${fl.quote ? `\n"${fl.quote}"` : ''}\nSource: ${fl.source}`} onClick={() => setOpen(open === fl.rule ? null : fl.rule)}>
              {chipName(fl.rule)}
            </Chip>
          ))}
        </div>
      )}
      {openFlag && (
        <div className={cn('mt-2 rounded-lg border p-3 text-base', openFlag.severity === 'compliance' ? 'border-red-500/45 bg-red-500/10' : openFlag.severity === 'warn' ? 'border-amber-400/40 bg-amber-400/10' : 'border-[#272B34] bg-[#0E0F12]')}>
          <div className="font-semibold">{openFlag.label}</div>
          {openFlag.quote && <div className="mt-1">In the line: <mark className="bg-amber-400/30 text-amber-50 px-1">{openFlag.quote}</mark></div>}
          {openFlag.why && <div className="mt-1 text-[#A3A8B1]">{openFlag.why}</div>}
          <div className="mt-1 text-sm text-[#858B96]">Source: {openFlag.source} · found by {openFlag.by.join(' + ')}{openFlag.p !== undefined ? ` · P(yes) ${openFlag.p}` : ''}</div>
        </div>
      )}
      {line.features.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">{line.features.map(x => <Chip key={x} tone="outline" className="text-xs">{x.replace(/_/g, ' ')}</Chip>)}</div>
      )}
      {line.objection && <p className="mt-3 border-l-4 border-[#343946] pl-3 text-base italic text-[#A3A8B1]">Skeptic: {line.objection}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <GhostButton active={line.decision === 'keep'} onClick={() => decide({ decision: line.decision === 'keep' ? '' : 'keep' })}>Keep</GhostButton>
        <GhostButton active={line.decision === 'cut'} onClick={() => decide({ decision: line.decision === 'cut' ? '' : 'cut' })}>Cut</GhostButton>
        <GhostButton active={line.decision === 'edit'} onClick={() => { setDraft(line.edited_text || line.text); setEditing(true); }}>Edit</GhostButton>
        <GhostButton onClick={() => onMore(line, note)} title="Writes three siblings, using the note as guidance">More like this</GhostButton>
        <input className="min-w-[12rem] flex-1 rounded-lg border-2 border-[#272B34] px-3 py-1.5 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" placeholder="Note (why; guides 'more like this')" value={note}
          onChange={e => setNote(e.target.value)} onBlur={() => note !== (line.note || '') && decide({ note })} />
      </div>
    </div>
  );
}

// ---------- 3. shortlist and export ----------

function Shortlist({ batch }: { batch: Batch | null }) {
  const [rows, setRows] = useState<ShortRow[]>([]);
  const [msg, setMsg] = useState('');
  const load = () => studio.shortlist().then(setRows).catch(e => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const groups = useMemo(() => {
    const m = new Map<string, ShortRow[]>();
    for (const r of rows) m.set(`${r.persona} · ${r.territory}`, [...(m.get(`${r.persona} · ${r.territory}`) || []), r]);
    return m;
  }, [rows]);

  async function upload(file: File) {
    const r = await studio.ingest(await file.text());
    setMsg(`Read ${r.rows} rows: ${r.kept} keep, ${r.edited} edit, ${r.cut} cut${r.unknown.length ? `; ${r.unknown.length} unknown ids` : ''}. Taste examples: ${r.taste_total}.`);
    load();
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#272B34] bg-[#16181D] p-5">
        <div className="mr-auto">
          <div className="text-lg font-semibold">Shortlist</div>
          <div className="text-base text-[#858B96]">Kept and edited lines with naming stubs (PERSONA_TERRITORY_FORMAT_v#_PLATFORM; add the date at trafficking).</div>
        </div>
        <a className="rounded-lg px-4 py-2 text-base font-semibold text-white" style={{ background: PINK }} href={studio.url('/shortlist.csv')}>Shortlist CSV</a>
        <a className="rounded-lg border-2 border-[#343946] px-4 py-2 text-base font-medium" href={studio.url('/shortlist.md')}>Shortlist Markdown</a>
        {batch && <a className="rounded-lg border-2 border-[#343946] px-4 py-2 text-base font-medium" href={studio.url(`/batches/${encodeURIComponent(batch.id)}/export.csv`)}>Batch CSV for Sheets</a>}
        {batch && <a className="rounded-lg border-2 border-[#343946] px-4 py-2 text-base font-medium" href={studio.url(`/batches/${encodeURIComponent(batch.id)}/export.md`)}>Batch Markdown</a>}
        <label className="cursor-pointer rounded-lg border-2 border-dashed border-[#4A505D] px-4 py-2 text-base font-medium">
          Import curated CSV
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </div>
      {msg && <div className="rounded-lg bg-emerald-500/10 p-3 text-base text-emerald-200">{msg}</div>}
      {!rows.length && <div className="text-base text-[#858B96]">Nothing kept yet. Keep or edit lines in Review, or import a curated sheet.</div>}
      {[...groups.entries()].map(([g, rs]) => (
        <section key={g} className="rounded-xl border border-[#272B34] bg-[#16181D] p-5">
          <h2 className="mb-3 text-lg font-bold">{g} <span className="font-normal text-[#858B96]">({rs.length})</span></h2>
          <table className="w-full text-left text-base">
            <thead><tr className="text-sm uppercase text-[#858B96]"><th className="pb-2 pr-4">Naming stub</th><th className="pb-2 pr-4">Field</th><th className="pb-2 pr-4">Line</th><th className="pb-2">Note</th></tr></thead>
            <tbody>
              {rs.map(r => (
                <tr key={r.id} className="border-t border-[#272B34] align-top">
                  <td className="py-2 pr-4 font-mono text-sm">{r.stub}</td>
                  <td className="py-2 pr-4 text-base text-[#858B96]">{r.field.replace('_', ' ')}</td>
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
  const [key, setKey] = useState<{ labels: Record<string, string>; tally: Record<string, number> } | null>(null);
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
          {set && <span className="text-base text-[#858B96]">{set.lines.length} lines · {set.lines.filter(l => l.favourite).length} starred</span>}
          {set && !revealed && <GhostButton className="ml-auto" onClick={async () => setKey(await studio.reveal(set.name))}>Reveal the writers</GhostButton>}
        </div>
      )}
      {key && (
        <div className="flex flex-wrap gap-4 rounded-xl border-2 p-5" style={{ borderColor: PINK }}>
          {Object.entries(key.labels).map(([label, model]) => (
            <div key={label} className="text-base"><span className="font-bold">Writer {label}</span> = {model} · <span className="font-semibold">{key.tally[label] || 0} starred</span></div>
          ))}
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
