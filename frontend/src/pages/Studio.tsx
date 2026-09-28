// Copy Studio. Locally it talks to `npx tsx scripts/studio.ts serve` (no
// sign-in); hosted, to /api/studio as the signed-in user (see studioApi.ts).
// Built for a shared screen: large type, high contrast, flags as neutral chips
// (red = compliance, amber = warning). Nothing here is a score. The last step,
// Ready for production, is creative sign-off, never "approval".

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HOSTED, getUser, setSignedInUser, setUser, studio, studioAccess, type Batch, type Brief, type CompareSet, type Flag, type Line, type Meta, type OwnLine, type RunSummary, type ShortRow, type StudioEvent, type Territory, type Tone, type EditRecord, type LineVersion, type Reveal, type ComplianceStatus, type ReadyView, type RulesVersion } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { ArrowLeft, ChevronRight, ScrollText, Shuffle } from 'lucide-react';

const PINK = '#D94D8F';
type Tab = 'home' | 'territories' | 'brief' | 'review' | 'shortlist' | 'ready' | 'compare' | 'rules';
// The writing flow, in order. Blind compare sits apart from it; Live comes later (B3b).
const FLOW: Array<[Tab, string]> = [['territories', 'Territories'], ['brief', 'Write & brief'], ['review', 'Review'], ['shortlist', 'Shortlist'], ['ready', 'Ready for production']];
// Deep links for the demo: /studio?tab=review&batch=<id>&open=L07 (opens that line's first flag), &compare=<name>,
// ?tab=ready&persona=<P>&territory=<T>.
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
  const [clientLogo, setClientLogo] = useState<string | null>(null);
  useEffect(() => {
    let url = '';
    studio.imageUrl('/brand/client-logo').then(u => { url = u; setClientLogo(u); }).catch(() => setClientLogo(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, []);
  return (
    <button onClick={onHome} className="flex shrink-0 items-center gap-3" aria-label="VOICES Studio: how it works">
      <img src="/ralph-world.png" alt="Ralph" className={cn('object-contain drop-shadow-[0_0_10px_rgba(217,77,143,0.35)]', small ? 'h-7 w-7' : 'h-8 w-8')} />
      <span className={cn('font-light leading-none text-[#ECEDEF]', small ? 'text-lg' : 'text-xl')} style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>
        Voices <span className="font-medium" style={{ color: PINK }}>Studio</span>
      </span>
      <span className={cn('text-[#646A75]', small ? 'text-sm' : 'text-base')} aria-hidden>×</span>
      {clientLogo
        ? <img src={clientLogo} alt="Trupanion" onError={() => setClientLogo(null)} className={cn('w-auto object-contain opacity-95', small ? 'h-4' : 'h-5')} />
        // No logo asset (production, Brook 28 Sep): the client's name as a wordmark.
        : <span className={cn('font-semibold tracking-tight text-[#ECEDEF]', small ? 'text-base' : 'text-lg')} style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>Trupanion</span>}
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
  const [admin, setAdmin] = useState(false); // hosted, before rules exist (meta can't load yet)
  const esRef = useRef<{ close: () => void } | null>(null);

  const refreshMeta = useCallback(() => studio.meta().then(m => {
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
      <header className="sticky top-0 z-20 flex h-16 flex-nowrap items-center gap-4 border-b border-[#272B34] bg-[#16181D] px-6">
        {HOSTED && <a href="/" title="Back to Voices" className="-mr-2 rounded-lg p-1.5 text-[#858B96] hover:bg-[#1C1F26] hover:text-[#ECEDEF]"><ArrowLeft className="h-4 w-4" aria-label="Back to Voices" /></a>}
        <Lockup onHome={() => setTab('home')} />
        <nav className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <GhostButton active={tab === 'home'} onClick={() => setTab('home')} className="whitespace-nowrap border-transparent px-3 py-1.5 text-sm">How it works</GhostButton>
          <span className="mx-1 h-5 w-px bg-[#343946]" aria-hidden />
          {FLOW.map(([t, label], i) => (
            <span key={t} className="flex items-center">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-[#4A505D]" aria-hidden />}
              <GhostButton active={tab === t} onClick={() => setTab(t)} className="flex items-center gap-1.5 whitespace-nowrap border-transparent px-2 py-1.5 text-sm">
                <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold', tab === t ? 'bg-[#0E0F12] text-white' : 'bg-[#272B34] text-[#A3A8B1]')}>{i + 1}</span>
                {t === 'review' && batch ? `Review (${batch.lines.length})` : label}
              </GhostButton>
            </span>
          ))}
          <span className="flex items-center">
            <ChevronRight className="h-3.5 w-3.5 text-[#343946]" aria-hidden />
            {/* B3b: live results next to each signed-off line. No route or API yet. */}
            <span aria-disabled="true" title="Live results next to each signed-off line, from the first weeks in market"
              className="flex cursor-not-allowed items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-[#4A505D]">
              Live <span className="rounded-full border border-[#343946] px-1.5 py-px text-[10px] uppercase tracking-wide">Coming soon</span>
            </span>
          </span>
        </nav>
        <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-2.5 text-sm text-[#858B96]">
          <span className="mr-1 h-5 w-px bg-[#343946]" aria-hidden />
          <button onClick={() => setTab('compare')} title="Blind compare: a separate exercise, outside the writing flow" aria-label="Blind compare" className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-dashed border-[#4B55A8] bg-[#1B2150] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#232A5C]">
            <Shuffle className="h-4 w-4" aria-hidden /> <span className="hidden min-[1800px]:inline">Blind compare</span>
          </button>
          {HOSTED && (
            <button onClick={() => setTab('rules')} title="Rules: what every line is checked against" aria-label="Rules" className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-sm transition', tab === 'rules' ? 'border-[#ECEDEF] text-[#ECEDEF]' : 'border-transparent text-[#858B96] hover:text-[#ECEDEF]')}>
              <ScrollText className="h-4 w-4" aria-hidden />
            </button>
          )}
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
        {tab === 'home' && <Home />}
        {meta && tab === 'territories' && <Territories meta={meta} onSaved={() => refreshMeta()} onBrief={code => { const t = meta.territories[code]; setBrief(b => ({ ...b, persona: t.persona, territory: code, fields: b.persona === t.persona && b.fields.length ? b.fields : meta.personas[t.persona].default_fields })); setTab('brief'); }} />}
        {meta && tab === 'brief' && <BriefPanel meta={meta} brief={brief} run={run} running={running} user={user} runsTick={runsTick} onContinue={continueRun}
          setBrief={b => { if (attached && b.territory !== brief.territory) setAttached(null); setBrief(b); }}
          attachedRun={attached && batch?.id === attached ? batch : null} onNewRun={() => setAttached(null)} />}
        {meta && tab === 'review' && <Review meta={meta} batch={batch} setBatch={setBatch} status={status} running={running} onMore={more} onMoreRun={() => run({ into: batch })} onDecided={() => setRunsTick(t => t + 1)} />}
        {meta && tab === 'shortlist' && <Shortlist batch={batch} onReady={() => setTab('ready')} />}
        {meta && tab === 'ready' && <Ready meta={meta} batch={batch} user={user} />}
        {tab === 'rules' && (meta || admin) && <Rules admin={!!meta?.user?.admin || admin} onActivated={() => refreshMeta().then(() => setErr('')).catch(() => {})} />}
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
  { title: 'Ready for production', what: 'Red flags fixed or overridden with a reason, then the set is locked with your expectations.', you: 'Sign off, and hand over the pack.' },
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
  const [history, setHistory] = useState(false);
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
        {line.ready && <Chip tone="outline" className="border-emerald-500/60 text-emerald-300" title={`Signed off by ${line.ready.ready_by}, ${when(line.ready.ready_at)}`}>ready v{line.ready.version}{line.ready.changed_since ? ' · edited since' : ''}</Chip>}
        {line.decided_by && line.decision
          ? <button onClick={() => setHistory(!history)} className="ml-auto text-xs text-[#858B96] underline-offset-2 hover:text-[#ECEDEF] hover:underline" title="Who decided what, and when">{line.decision} · {line.decided_by}{line.decided_at ? ` · ${when(line.decided_at)}` : ''}</button>
          : <button onClick={() => setHistory(!history)} className="ml-auto text-xs text-[#646A75] hover:text-[#ECEDEF]">history</button>}
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
      <Overrides line={line} />
      {history && <LineHistory line={line} />}

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

function Shortlist({ batch, onReady }: { batch: Batch | null; onReady: () => void }) {
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
        <button className="rounded-lg px-4 py-2 text-base font-semibold text-white" style={{ background: PINK }} onClick={onReady}>Ready for production →</button>
        <button className="rounded-lg border-2 border-[#343946] px-4 py-2 text-base font-medium" onClick={() => studio.download('/shortlist.csv', 'shortlist.csv')}>Shortlist CSV</button>
        <button className="rounded-lg border-2 border-[#343946] px-4 py-2 text-base font-medium" onClick={() => studio.download('/shortlist.md', 'shortlist.md')}>Shortlist Markdown</button>
        {batch && <button className="rounded-lg border-2 border-[#343946] px-4 py-2 text-base font-medium" onClick={() => studio.download(`/batches/${encodeURIComponent(batch.id)}/export.csv`, `${batch.id}.csv`)}>Batch CSV for Sheets</button>}
        {batch && <button className="rounded-lg border-2 border-[#343946] px-4 py-2 text-base font-medium" onClick={() => studio.download(`/batches/${encodeURIComponent(batch.id)}/export.md`, `${batch.id}.md`)}>Batch Markdown</button>}
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

function Ready({ meta, batch, user }: { meta: Meta; batch: Batch | null; user: string }) {
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
      {done && <div className="rounded-lg border-2 border-emerald-500/50 bg-emerald-500/10 p-3 text-base text-emerald-100">{done}</div>}
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
                onChanged={() => load(true).catch(e => setError(e.message))} onError={setError} />
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
              <textarea rows={4} className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base" placeholder="e.g. The plain promise answers the Owners’ first objection in under 40 characters." value={reason} onChange={e => setReason(e.target.value)} />
              <PinkButton className="mt-3 w-full" disabled={!!blockedBy || busy} onClick={signOff}>{busy ? 'Signing off…' : `Mark ${selected.length} line${selected.length === 1 ? '' : 's'} Ready for production`}</PinkButton>
              <p className="mt-2 text-sm text-[#858B96]">{blockedBy || `Signed off as ${user || 'you'}. The set and your expectations are locked together.`}</p>
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

function ReadyCard({ meta, item, included, lead, onInclude, onLead, onChanged, onError }: {
  meta: Meta; item: ReadyView['lines'][number]; included: boolean; lead: boolean;
  onInclude: (on: boolean) => void; onLead: (on: boolean) => void; onChanged: () => void; onError: (m: string) => void;
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
          <input type="checkbox" className="h-4 w-4 accent-[#D94D8F]" checked={included} onChange={e => onInclude(e.target.checked)} /> In this set
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

      {red.length > 0 && (
        <div className="mt-3 space-y-2 rounded-lg border border-red-500/45 bg-red-500/10 p-3">
          <div className="text-sm font-semibold uppercase tracking-wider text-red-200">Fix or override before sign-off</div>
          {red.map(fl => (
            <div key={fl.rule} className="text-base">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="red">{chipName(fl.rule)}</Chip>
                <span className="text-[#ECEDEF]">{fl.label}</span>
                {fl.quote && <mark className="bg-amber-400/30 px-1 text-amber-50">{fl.quote}</mark>}
              </div>
              <div className="mt-0.5 text-sm text-[#A3A8B1]">Source: {fl.source}{fl.why ? ` · ${fl.why}` : ''}</div>
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
                  <GhostButton onClick={() => { setOverriding(fl.rule); setWhy(''); }}>Override with a reason…</GhostButton>
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
        {(Object.keys(COMPLIANCE_WORDS) as ComplianceStatus[]).map(st => (
          <button key={st} onClick={() => {
            // A line that went through with an overridden red flag can only be cleared with a note.
            let n = note;
            if (st === 'cleared' && line.overrides?.length && !n.trim()) {
              n = window.prompt('This line went through with an overridden red flag. Who at Trupanion cleared it?')?.trim() || '';
              if (!n) return;
              setNote(n);
            }
            act(() => studio.compliance(line.batch, line.id, st, n));
          }}
            className={cn('rounded-full border px-3 py-0.5 text-sm font-medium', compliance.status === st ? COMPLIANCE_TONE[st] : 'border-[#272B34] text-[#646A75] hover:text-[#C9CCD2]')}>{COMPLIANCE_WORDS[st]}</button>
        ))}
        <input className="min-w-[10rem] flex-1 rounded-lg border-2 border-[#272B34] px-3 py-1 text-sm" placeholder="Compliance note" value={note} onChange={e => setNote(e.target.value)}
          onBlur={() => note !== (compliance.note || '') && act(() => studio.compliance(line.batch, line.id, compliance.status, note))} />
        <button className="text-xs text-[#858B96] hover:text-[#ECEDEF]" onClick={() => { setDraft(final_text); setEditing(true); }} title={line.ready ? 'Editing makes a new version; the signed-off wording is kept' : undefined}>edit wording</button>
        {compliance.by && <span className="text-xs text-[#858B96]">{compliance.by}, {when(compliance.at)}{compliance.sha256 && compliance.sha256 !== item.sha256 ? ' · on an earlier wording' : ''}</span>}
        <button className="text-xs text-[#646A75] hover:text-[#ECEDEF]" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'hide history' : `history${versions.length ? ` · ${versions.length} version${versions.length === 1 ? '' : 's'}` : ''}`}</button>
      </div>
      {showHistory && <LineHistory line={line} />}
    </div>
  );
}

// ---------- rules versions (hosted) ----------

function Rules({ admin, onActivated }: { admin: boolean; onActivated: () => void }) {
  const [list, setList] = useState<RulesVersion[]>([]);
  const [error, setError] = useState('');
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const load = () => studio.rules().then(setList).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  async function upload() {
    if (!file) return;
    try {
      const body = JSON.parse(await file.text());
      setList(await studio.uploadRules(version || body.version, body, notes));
      setFile(null); setVersion(''); setNotes(''); setError('');
    } catch (e: any) { setError(e.message); }
  }
  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>Rules</h1>
        <p className="text-base text-[#A3A8B1]">Every line is checked against the active rules version, built from the client’s legal, brand and persona material. Each run records the version it was checked under. {admin ? 'You can upload and activate versions.' : 'Only an admin can change them.'}</p>
      </div>
      {error && <div className="rounded-lg border-2 border-red-500/45 bg-red-500/10 p-3 text-base text-red-200">{error}</div>}
      <ul className="divide-y divide-[#272B34] rounded-xl border border-[#272B34] bg-[#16181D]">
        {list.map(r => (
          <li key={r.version} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="font-mono text-base font-semibold">{r.version}</span>
            <Chip tone={r.status === 'active' ? 'outline' : 'grey'} className={r.status === 'active' ? 'border-emerald-500 text-emerald-300' : ''}>{r.status}</Chip>
            <span className="text-sm text-[#858B96]">{when(r.created_at)}{r.created_by ? ` · ${r.created_by}` : ''}{r.notes ? ` · ${r.notes}` : ''}</span>
            {admin && r.status !== 'active' && <GhostButton className="ml-auto" onClick={async () => { if (window.confirm(`Make ${r.version} the active rules? New checks use it straight away.`)) { try { setList(await studio.activateRules(r.version)); onActivated(); } catch (e: any) { setError(e.message); } } }}>Activate</GhostButton>}
          </li>
        ))}
        {!list.length && !error && <li className="px-5 py-3 text-[#858B96]">Loading…</li>}
      </ul>
      {admin && (
        <section className="space-y-3 rounded-xl border border-dashed border-[#4A505D] p-5">
          <h2 className="text-lg font-semibold">Upload a new version</h2>
          <p className="text-sm text-[#A3A8B1]">A studio-rules.json file. It’s saved as a draft; activate it above when it’s ready. Versions are never overwritten.</p>
          <input type="file" accept="application/json,.json" onChange={e => setFile(e.target.files?.[0] || null)} className="text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <input className="rounded-lg border-2 border-[#343946] px-3 py-2 text-base" placeholder="Version (defaults to the file’s)" value={version} onChange={e => setVersion(e.target.value)} />
            <input className="rounded-lg border-2 border-[#343946] px-3 py-2 text-base" placeholder="What changed" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <PinkButton disabled={!file} onClick={upload}>Upload as draft</PinkButton>
        </section>
      )}
    </div>
  );
}
