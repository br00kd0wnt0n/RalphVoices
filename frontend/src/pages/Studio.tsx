// Copy Studio in four steps: Write → Review → Build & sign off → Assets (then Live, an explainer for now). Locally it talks to
// `npx tsx scripts/studio.ts serve` (no sign-in); hosted, to /api/studio as the signed-in user (see studioApi.ts).
// The start screen is the round board (How it works while the round has no runs, and behind "?"). The context bar
// (persona × territory × region) scopes Write, Review and Build & sign off; Assets, Export and Live show everything in
// the round, and narrowing them there never changes the writing context. Territories, Rules (with Rounds), Export and
// Compare sit top right. The steps live in components/studio/*; rounds and Live in pages/StudioRounds.tsx.
//
// Old tab keys redirect: brief → write, shortlist → review (Kept), ready → build, preflight and compliance → assets.
// Deep links: ?tab=review&batch=<id>&open=L07, ?tab=build&persona=<P>&territory=<T>[&region=CA], ?tab=assets&stub=<code>
// (or the old &asset=<upload id>), ?tab=compare&compare=<name>.

import { useCallback, useEffect, useRef, useState } from 'react';
import { HOSTED, getUser, setSignedInUser, setUser, studio, studioAccess, type Batch, type Brief, type Line, type Meta, type Region, type StudioEvent, REGION_NAMES } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { ArrowLeft, HelpCircle, Map as MapIcon, ScrollText, Shuffle } from 'lucide-react';
import { LivePage, RoundBadge, RoundsPanel } from './StudioRounds';
import { Board, type Step } from '@/components/studio/Board';
import { ALL_VIEW, Chip, GhostButton, Lockup, PINK, PersonaDot, initials, params, personaKeys, regionOf, sameCtx, setTerritoryNames, setWhatToDo, territoryName, type Ctx, type ViewFilter } from '@/components/studio/ui';
import { Home } from '@/components/studio/Home';
import { Write, countsFor } from '@/components/studio/Write';
import { applyPlace } from '@/lib/studioFields';
import { Review } from '@/components/studio/Review';
import { Build } from '@/components/studio/Build';
import { Assets } from '@/components/studio/Assets';
import { Territories, TerritoryDrawer } from '@/components/studio/Territories';
import { personaColor, tint } from '@/lib/personaColors';
import { Rules } from '@/components/studio/Rules';
import { Compare } from '@/components/studio/Compare';
import { ExportMenu } from '@/components/studio/ExportMenu';

type Tab = 'home' | 'howto' | 'write' | 'review' | 'build' | 'assets' | 'live' | 'territories' | 'rules' | 'compare';
const TABS: Tab[] = ['home', 'howto', 'write', 'review', 'build', 'assets', 'live', 'territories', 'rules', 'compare'];
/** Screens that show everything in the round (the bar filters the view there, never the writing context). */
const VIEW_TABS: Tab[] = ['assets', 'live'];
// The four steps, in order, with their full names (never shortened).
const FLOW: Array<[Tab, string]> = [['write', 'Write'], ['review', 'Review'], ['build', 'Build & sign off'], ['assets', 'Assets']];
/** Old tab keys and where they live now. */
const MOVED: Record<string, Tab> = { brief: 'write', shortlist: 'review', ready: 'build', preflight: 'assets', compliance: 'assets' };
function tabFrom(url: string): Tab {
  const t = new URL(url).searchParams.get('tab') || 'home';
  return MOVED[t] || (TABS.includes(t as Tab) ? (t as Tab) : 'home');
}
// Redirect an old link in place (the address shows the new key), remembering that the Shortlist is now Review's Kept tray.
const oldTab = params.get('tab') || '';
const openKept = oldTab === 'shortlist' || params.get('view') === 'kept';
if (MOVED[oldTab]) { const u = new URL(window.location.href); u.searchParams.set('tab', MOVED[oldTab]); window.history.replaceState({ tab: MOVED[oldTab] }, '', u); }

const CTX_KEY = 'voices-studio-context';
function initialCtx(): Ctx {
  if (params.get('persona') && params.get('territory')) return { persona: params.get('persona')!, territory: params.get('territory')!, region: (params.get('region')?.toUpperCase() as Region) || 'US' };
  try { const c = JSON.parse(localStorage.getItem(CTX_KEY) || 'null'); if (c?.persona && c?.territory) return { persona: c.persona, territory: c.territory, region: c.region === 'CA' ? 'CA' : 'US' }; } catch { /* private mode */ }
  return { persona: 'DINK', territory: 'DINK_NEVER', region: 'US' };
}

export function Studio() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [tab, setTabState] = useState<Tab>(tabFrom(window.location.href));
  // Every step opens at the top; the step bar, the screen and the address all follow this one value.
  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    window.scrollTo({ top: 0 });
    (document.activeElement as HTMLElement | null)?.blur?.();
    const u = new URL(window.location.href);
    if (u.searchParams.get('tab') !== t) { u.searchParams.set('tab', t); window.history.pushState({ tab: t }, '', u); }
  }, []);
  useEffect(() => {
    const onPop = () => setTabState(tabFrom(window.location.href));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The context: persona × territory × region, chosen once, for every step.
  const [ctx, setCtxState] = useState<Ctx>(initialCtx);
  const setCtx = useCallback((c: Ctx) => {
    setCtxState(c);
    try { localStorage.setItem(CTX_KEY, JSON.stringify(c)); } catch { /* private mode */ }
  }, []);
  // Assets, Export and Live: everything in the round unless narrowed there (a deep link to a set narrows it).
  const [view, setView] = useState<ViewFilter>(() => (params.get('persona') && ['assets', 'preflight', 'compliance'].includes(params.get('tab') || '') ? { ...ALL_VIEW, persona: params.get('persona')!, territory: params.get('territory') || 'all' } : ALL_VIEW));
  // "This round / All rounds" (header): the views reload with the new filter.
  const [roundKey, setRoundKey] = useState(0);
  // A context from a link is remembered like one chosen in the bar.
  useEffect(() => { try { localStorage.setItem(CTX_KEY, JSON.stringify(ctx)); } catch { /* private mode */ } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [brief, setBrief] = useState<Brief>({ persona: ctx.persona, territory: ctx.territory, region: ctx.region, fields: [], tone: { dry_warm: 3, playful_plain: 3, short_long: 1 }, banned_words: [], banned_ideas: [], reference_lines: [], n: 20, model: 'gpt-4o' });
  const [batch, setBatch] = useState<Batch | null>(null);
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);
  const [user, setUserState] = useState(getUser());
  const [runsTick, setRunsTick] = useState(0);
  const [attached, setAttached] = useState<string | null>(null); // the run new lines go into, if any
  const [admin, setAdmin] = useState(false); // hosted, before rules exist (meta can't load yet)
  // The territory drawer (Write's "Edit territory" and "+ New territory"): a code to edit, null for a new one.
  const [drawer, setDrawer] = useState<{ code: string | null } | null>(null);
  /** After a save in the drawer: refresh, and select the territory (a new one), or the persona's first if it was retired. */
  async function territorySaved(code: string) {
    setDrawer(null);
    const m = await refreshMeta();
    const t = m.territories[code];
    if (t && t.status !== 'retired') setCtx({ persona: t.persona, territory: code, region: ctx.region });
    else if (code === ctx.territory) { const first = Object.entries(m.territories).find(([, x]) => x.persona === ctx.persona && x.status !== 'retired')?.[0] || ''; setCtx({ ...ctx, territory: first }); }
  }
  const esRef = useRef<{ close: () => void } | null>(null);

  // The brief follows the context. Fields: the territory's format defaults (the server's default_fields) until the
  // person changes them, then kept across persona and territory changes (studioFields.ts applyPlace); counts from the
  // rules' default_count.
  const [fieldNote, setFieldNote] = useState('');
  useEffect(() => {
    if (!meta) return;
    setBrief(b => {
      const r = applyPlace(meta, b, { persona: ctx.persona, territory: ctx.territory });
      if (b.fields.length) setFieldNote(r.note);
      const fields = r.brief.fields;
      const field_counts = countsFor(meta, fields, 20, b.field_counts);
      return { ...r.brief, region: ctx.region, fields, field_counts, n: Math.max(1, Object.values(field_counts).reduce((a, x) => a + x, 0)) };
    });
  }, [meta, ctx.persona, ctx.territory, ctx.region]);
  // New lines go into the attached run only while it's for the same persona, territory and region.
  useEffect(() => { if (attached && (!batch || batch.id !== attached || !sameCtx(batch.brief, ctx))) setAttached(null); }, [attached, batch, ctx]);

  const refreshMeta = useCallback(() => studio.meta().then(m => {
    setTerritoryNames(Object.fromEntries(Object.entries(m.territories).map(([k, t]) => [k, t.name])));
    setWhatToDo(m.what_to_do || {});
    setMeta(m);
    setErr('');
    if (HOSTED && m.user) { setSignedInUser(m.user.email); setUserState(m.user.email); }
    return m;
  }), []);
  useEffect(() => {
    refreshMeta().then(m => {
      // A remembered context that no longer exists (a retired or renamed territory) falls back to the persona's first.
      const t = m.territories[ctx.territory];
      if (!t || t.persona !== ctx.persona || t.status === 'retired') {
        const persona = m.personas[ctx.persona] ? ctx.persona : personaKeys(m.personas)[0];
        const first = Object.entries(m.territories).find(([, x]) => x.persona === persona && x.status !== 'retired')?.[0] || '';
        setCtx({ persona, territory: first, region: ctx.region });
      }
    }).catch(async (e: any) => {
      if (HOSTED && e.body?.error === 'no_rules') {
        const a = await studioAccess();
        setAdmin(a.admin);
        if (a.admin) { setTab('rules'); setErr('No rules are active yet. Upload studio-rules.json below, then activate it.'); }
        else setErr('Voices Studio is still being set up: no rules are active yet.');
        return;
      }
      setErr(HOSTED ? (e.status === 403 ? e.message : e.status === 404 ? 'Voices Studio isn’t switched on here yet.' : `Couldn’t reach Voices Studio: ${e.message}`) : 'Studio API not running. In backend/: npx tsx scripts/studio.ts serve');
    });
    // A deep link to a run opens it (and sets the context to it).
    const id = params.get('batch');
    if (id) studio.batch(id).then(b => { setBatch(b); setCtx({ persona: b.brief.persona, territory: b.brief.territory, region: regionOf(b.brief) }); }).catch(() => {});
    return () => esRef.current?.close();
  }, [refreshMeta]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /** Start a run, or add to the current one. ownOnly checks the creative director's lines without Studio writing more. */
  async function run(opts: { ownOnly?: boolean; into?: Batch | null } = {}) {
    setErr('');
    if (!getUser()) { setErr(HOSTED ? 'Still signing you in; try again in a moment.' : 'Add your name (top right) first, so your runs are saved under it.'); return; }
    const candidate = opts.into || (attached && batch?.id === attached ? batch : null);
    const into = candidate && sameCtx(candidate.brief, ctx) ? candidate : null;
    const b: Brief = into ? { ...into.brief, ...brief } : brief;
    try {
      let r;
      try { r = await studio.generate(b, { batch: into?.id, ownOnly: opts.ownOnly }); }
      catch (e: any) {
        if (e.status !== 409 || !e.body?.needs_confirm) throw e;
        if (!window.confirm(`This run is estimated at $${e.body.estimate.toFixed(2)}, over the $${meta?.ask_over ?? 2} ask-first line. Run it?`)) return;
        r = await studio.generate(b, { batch: into?.id, ownOnly: opts.ownOnly, confirm: true });
      }
      setAttached(r.batch);
      if (!into) setBatch({ id: r.batch, brief: b, created: new Date().toISOString(), created_by: getUser(), lines: [], stats: { generated: 0, near_duplicates_removed: 0, similar_flagged: 0, timings_ms: {}, usd: {}, usd_total: 0 } });
      setBrief(cur => ({ ...cur, own_lines: [] }));
      setStatus(opts.ownOnly ? 'Checking your lines…' : 'Writing…');
      setTab('review');
      follow(r.job, r.batch);
    } catch (e: any) { setErr(e.message); }
  }

  /** Reopen a saved run: its lines in Review, its brief on Write; new lines go into it. */
  async function continueRun(id: string, opts: { resume?: boolean } = {}) {
    const b = await studio.batch(id);
    setBatch(b);
    setCtx({ persona: b.brief.persona, territory: b.brief.territory, region: regionOf(b.brief) });
    setBrief({ ...b.brief, own_lines: [] });
    setAttached(b.id);
    setTab('review');
    if (opts.resume) {
      const r = await studio.resume(id);
      setStatus('Checking the lines this run left unchecked…');
      follow(r.job, id);
    }
  }
  async function addLine(text: string, field: string) {
    if (!batch) return;
    setErr('');
    try {
      const r = await studio.generate({ ...batch.brief, own_lines: [{ text, field }] }, { batch: batch.id, ownOnly: true });
      setAttached(batch.id);
      setStatus('Checking your new line…');
      follow(r.job, batch.id);
    } catch (e: any) { setErr(e.message); throw e; }
  }
  async function more(line: Line, n: string) {
    if (!batch) return;
    const r = await studio.more(batch.id, line.id, n, 3);
    setStatus('Writing three more like this…');
    follow(r.job, batch.id);
  }

  const shell = 'min-h-screen text-[#ECEDEF] [&_input:not([type=range]):not([type=file]):not([type=checkbox]):not([type=radio])]:bg-[#101216] [&_input]:text-[#ECEDEF] [&_textarea]:bg-[#101216] [&_textarea]:text-[#ECEDEF] [&_select]:bg-[#101216] [&_select]:text-[#ECEDEF] [&_input::placeholder]:text-[#646A75] [&_textarea::placeholder]:text-[#646A75]';

  if (tab === 'compare') {
    // A separate exercise, deliberately outside the writing flow.
    return (
      <div className={cn(shell, 'bg-[#0D1024]')} style={{ fontSize: 16 }}>
        <header className="bg-[#151A3A] px-4 py-6 text-white sm:px-8">
          <div className="flex flex-wrap items-center gap-4">
            <span className="rounded-full border border-[#4B55A8] px-3 py-0.5 text-sm uppercase tracking-wide text-[#B9BFEA]">Separate exercise</span>
            <Lockup small onHome={() => setTab('home')} />
            <button onClick={() => setTab('home')} className="ml-auto rounded-lg border-2 border-[#4B55A8] px-4 py-2 text-base font-medium hover:border-white">← Back to Studio</button>
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight" style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>Blind compare: choose the writing model</h1>
          <p className="mt-2 max-w-4xl text-base text-[#B9BFEA]">The same brief goes to several models, shuffled and unlabelled: star the lines you’d use, then reveal who wrote them. Nothing here goes into your runs.</p>
        </header>
        {err && <div className="mx-8 mt-4 rounded-lg border-2 border-red-500/45 bg-red-500/10 p-4 text-base text-red-200">{err}</div>}
        <main className="px-4 py-6 sm:px-8">{meta && <Compare meta={meta} brief={brief} />}</main>
      </div>
    );
  }

  const stepIndex = FLOW.findIndex(([t]) => t === tab);
  const viewMode = VIEW_TABS.includes(tab);
  const showCtx = (stepIndex >= 0 || viewMode) && !!meta;
  /** A board cell: set the context (and, for Assets, narrow the view to it) and open the step. */
  const openCell = (persona: string, territory: string, step: Step) => {
    setCtx({ persona, territory, region: ctx.region });
    if (step === 'assets') setView({ persona, territory, region: 'all' });
    setTab(step);
  };
  const utility = (t: Tab, label: string, icon: React.ReactNode, title: string) => (
    <button onClick={() => setTab(t)} title={title} aria-label={label} className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-sm transition', tab === t ? 'border-[#ECEDEF] text-[#ECEDEF]' : 'border-transparent text-[#858B96] hover:text-[#ECEDEF]')}>
      {icon}<span className="hidden min-[1600px]:inline">{label}</span>
    </button>
  );

  return (
    <div className={cn(shell, 'bg-[#0E0F12]')} style={{ fontSize: 16 }}>
      <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center py-2 md:h-16 md:flex-nowrap md:py-0 gap-3 border-b border-[#272B34] bg-[#16181D] px-4 min-[1440px]:gap-4 min-[1440px]:px-6">
        {HOSTED && <a href="/" title="Back to Voices" className="-mr-2 hidden rounded-lg p-1.5 text-[#858B96] hover:bg-[#1C1F26] hover:text-[#ECEDEF] sm:block"><ArrowLeft className="h-4 w-4" aria-label="Back to Voices" /></a>}
        <span className="hidden min-[1440px]:block"><Lockup onHome={() => setTab('home')} /></span>
        <button onClick={() => setTab('home')} className="shrink-0 min-[1440px]:hidden" aria-label="VOICES Studio: the round" title="Voices Studio × Trupanion"><img src="/ralph-world.png" alt="Ralph" className="h-7 w-7 object-contain" /></button>
        <nav aria-label="Studio steps" className="order-last flex w-full min-w-0 flex-nowrap items-center md:order-none md:w-auto gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <GhostButton active={tab === 'howto'} onClick={() => setTab('howto')} title="How it works" aria-label="How it works" className="flex items-center gap-1.5 whitespace-nowrap border-transparent px-2 py-1.5 text-sm">
            <HelpCircle className="h-4 w-4" aria-hidden />
          </GhostButton>
          <span className="mx-1 h-5 w-px bg-[#343946]" aria-hidden />
          {FLOW.map(([t, label], i) => (
            <GhostButton key={t} active={tab === t} aria-current={tab === t ? 'step' : undefined} onClick={() => setTab(t)} className="flex items-center gap-1.5 whitespace-nowrap border-transparent px-2 py-1.5 text-sm hover:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D94D8F]">
              <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold', tab === t ? 'bg-[#0E0F12] text-white' : 'bg-[#272B34] text-[#A3A8B1]')}>{i + 1}</span>
              {t === 'review' && batch && sameCtx(batch.brief, ctx) ? `${label} (${batch.lines.length})` : label}
            </GhostButton>
          ))}
          {/* Live (B3b): live results next to each signed-off ad; for now a page explaining what's coming. */}
          <button onClick={() => setTab('live')} title="Coming soon: live results next to each signed-off ad, from the first weeks in market"
            className={cn('flex items-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-1.5 text-sm', tab === 'live' ? 'text-[#ECEDEF]' : 'text-[#4A505D] hover:text-[#858B96]')}>
            Live <span className="rounded-full border border-[#343946] px-1.5 py-px text-[10px] uppercase tracking-wide">soon</span>
          </button>
        </nav>
        <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-1.5 text-sm text-[#858B96]">
          <span className="mr-1 hidden h-5 w-px bg-[#343946] sm:block" aria-hidden />
          {utility('territories', 'Territories', <MapIcon className="h-4 w-4" aria-hidden />, 'Territories: edit, add or retire')}
          {utility('rules', 'Rules', <ScrollText className="h-4 w-4" aria-hidden />, 'Rules: what every line is checked against')}
          <RoundBadge meta={meta} onViewChange={() => setRoundKey(k => k + 1)} />
          <ExportMenu meta={meta} ctx={ctx} view={view} batch={batch} onImported={m => { setNote(m); setRunsTick(t => t + 1); }} />
          <button onClick={() => setTab('compare')} title="Blind compare: a separate exercise, outside the writing flow" aria-label="Blind compare" className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-dashed border-[#4B55A8] bg-[#1B2150] px-2.5 py-1.5 text-sm font-medium text-white hover:bg-[#232A5C]">
            <Shuffle className="h-4 w-4" aria-hidden /><span className="hidden min-[1600px]:inline">Compare</span>
          </button>
          {HOSTED
            ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#343946] text-xs font-semibold uppercase text-[#C9CCD2]" title={user ? `Signed in as ${user}` : 'Signing in…'}>{initials(user)}</span>
            : <UserBadge user={user} onChange={n => { setUser(n); setUserState(n); setRunsTick(t => t + 1); }} />}
          {meta?.mock && <Chip tone="amber" className="hidden sm:inline-flex">mock</Chip>}
        </div>
      </header>
      {showCtx && (viewMode
        ? <ViewBar meta={meta!} view={view} setView={setView} what={tab === 'live' ? 'Live' : 'Assets'} />
        : <ContextBar meta={meta!} ctx={ctx} setCtx={setCtx} step={stepIndex} onNewTerritory={() => setDrawer({ code: null })} />)}
      {drawer && meta && <TerritoryDrawer meta={meta} persona={ctx.persona} code={drawer.code} onClose={() => setDrawer(null)} onSaved={c => { territorySaved(c).catch(e => setErr(e.message)); }} />}
      {running && (
        <div className={cn('sticky z-10 flex items-center gap-2 border-b border-[#272B34] bg-[#16181D]/95 px-6 py-1.5 text-sm font-medium', showCtx ? 'top-[7.25rem]' : 'top-16')} style={{ color: PINK }}>
          <span className="animate-pulse">●</span> <span className="truncate">{status}</span>
        </div>
      )}
      {err && <div className="mx-4 mt-4 rounded-lg border-2 border-red-500/45 bg-red-500/10 p-4 text-base text-red-200 sm:mx-8">{err}</div>}
      {note && <div className="mx-4 mt-4 flex items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-base text-emerald-100 sm:mx-8"><span className="mr-auto">{note}</span><button className="text-sm underline" onClick={() => setNote('')}>dismiss</button></div>}
      <main key={roundKey} className="px-4 py-6 sm:px-6">
        {tab === 'home' && meta && <Start meta={meta} onOpen={openCell} onHowItWorks={() => setTab('howto')} onStart={() => setTab('write')} onRoundSaved={() => refreshMeta().catch(() => {})} />}
        {tab === 'home' && !meta && !err && <div className="text-base text-[#858B96]">Loading…</div>}
        {tab === 'howto' && <Home onStart={() => setTab('write')} />}
        {tab === 'live' && <LivePage />}
        {meta && tab === 'write' && <Write meta={meta} brief={brief} setBrief={setBrief} ctx={ctx} setCtx={setCtx} run={run} running={running} user={user} runsTick={runsTick} onContinue={continueRun}
          attachedRun={attached && batch?.id === attached ? batch : null} onNewRun={() => setAttached(null)} onTerritories={() => setTab('territories')} onEditTerritory={code => setDrawer({ code })} fieldNote={fieldNote} />}
        {meta && tab === 'review' && <Review meta={meta} ctx={ctx} batch={batch} setBatch={setBatch} status={status} running={running} onMore={more} onMoreRun={() => run({ into: batch })} onAddLine={addLine}
          onDecided={() => setRunsTick(t => t + 1)} onBuild={() => setTab('build')} initialFilter={openKept ? 'kept' : undefined} />}
        {meta && tab === 'build' && <Build meta={meta} ctx={ctx} user={user} onNext={() => setTab('assets')} onReview={() => setTab('review')} />}
        {meta && tab === 'assets' && <Assets meta={meta} view={view} setView={setView} onBuild={() => setTab('build')} />}
        {meta && tab === 'territories' && <Territories meta={meta} onSaved={() => refreshMeta()} onBrief={code => { const t = meta.territories[code]; setCtx({ persona: t.persona, territory: code, region: ctx.region }); setTab('write'); }} />}
        {tab === 'rules' && meta?.rounds && <RoundsPanel meta={meta} onSaved={() => refreshMeta().catch(() => {})} />}
        {tab === 'rules' && (meta || admin) && <Rules meta={meta} admin={HOSTED && (!!meta?.user?.admin || admin)} onActivated={() => refreshMeta().then(() => setErr('')).catch(() => {})} />}
      </main>
    </div>
  );
}

/** The start screen: the round board once the round has runs; How it works until then. */
function Start({ meta, onOpen, onHowItWorks, onStart, onRoundSaved }: { meta: Meta; onOpen: (p: string, t: string, s: Step) => void; onHowItWorks: () => void; onStart: () => void; onRoundSaved: () => void }) {
  const [runs, setRuns] = useState<number | null>(null);
  useEffect(() => { studio.batches().then(r => setRuns(r.length)).catch(() => setRuns(0)); }, []);
  if (runs === null) return <div className="text-base text-[#858B96]">Loading…</div>;
  return runs ? <Board meta={meta} onOpen={onOpen} onHowItWorks={onHowItWorks} onRoundSaved={onRoundSaved} /> : <Home onStart={onStart} />;
}

/** On Assets and Live: the bar shows "All" and narrows this view only (the writing context is untouched). */
function ViewBar({ meta, view, setView, what }: { meta: Meta; view: ViewFilter; setView: (v: ViewFilter) => void; what: string }) {
  const territories = Object.entries(meta.territories).filter(([, x]) => (view.persona === 'all' || x.persona === view.persona) && x.status !== 'retired');
  const sel = 'min-w-0 rounded-lg border border-[#343946] bg-[#101216] px-2.5 py-1.5 text-sm font-medium text-[#ECEDEF]';
  const pc = view.persona === 'all' ? null : personaColor(view.persona);
  return (
    <div className="z-10 md:sticky md:top-16 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#272B34] bg-[#121419]/95 px-4 py-2 backdrop-blur sm:px-6">
      <span className="text-xs font-semibold uppercase tracking-wider text-[#646A75]">Showing</span>
      <span className="flex min-w-0 items-center gap-1.5 rounded-lg border pl-2.5" style={pc ? { borderColor: tint(pc.base, 0.6), background: tint(pc.base, 0.12) } : { borderColor: '#343946' }}>
        {pc ? <PersonaDot persona={view.persona} /> : <span className="h-2.5 w-2.5 rounded-full border border-[#646A75]" aria-hidden />}
        <select aria-label="Persona (this view)" className="min-w-0 rounded-lg py-1.5 pl-0.5 pr-2 text-sm font-semibold" style={{ background: 'transparent', color: pc ? pc.light : '#ECEDEF' }} value={view.persona}
          onChange={e => setView({ persona: e.target.value, territory: 'all', region: view.region })}>
          <option value="all" style={{ background: '#101216', color: '#ECEDEF' }}>All personas</option>
          {personaKeys(meta.personas).map(k => <option key={k} value={k} style={{ background: '#101216', color: '#ECEDEF' }}>{meta.personas[k].name}</option>)}
        </select>
      </span>
      <span className="text-[#4A505D]" aria-hidden>×</span>
      <select aria-label="Territory (this view)" className={cn(sel, 'max-w-[22rem]')} value={view.territory} onChange={e => setView({ ...view, territory: e.target.value })}>
        <option value="all">All territories</option>
        {territories.map(([k, x]) => <option key={k} value={k}>{view.persona === 'all' ? `${meta.personas[x.persona]?.name.replace(/\s*\(.*\)$/, '')}: ` : ''}{territoryName(x)}</option>)}
      </select>
      <span className="text-[#4A505D]" aria-hidden>×</span>
      <select aria-label="Region (this view)" className={sel} value={view.region} onChange={e => setView({ ...view, region: e.target.value as ViewFilter['region'] })}>
        <option value="all">All regions</option>
        {(meta.regions || ['US', 'CA']).map(r => <option key={r} value={r}>{REGION_NAMES[r]}</option>)}
      </select>
      {(view.persona !== 'all' || view.territory !== 'all' || view.region !== 'all') && <button className="text-xs text-[#858B96] underline-offset-2 hover:text-[#ECEDEF] hover:underline" onClick={() => setView(ALL_VIEW)}>show all</button>}
      <span className="ml-auto hidden text-xs text-[#646A75] md:inline">{what}: everything in the round · filters this view only</span>
    </div>
  );
}

/** The persistent context bar: persona × territory × region, chosen once for Write, Review, Build & sign off and Assets. */
function ContextBar({ meta, ctx, setCtx, step, onNewTerritory }: { meta: Meta; ctx: Ctx; setCtx: (c: Ctx) => void; step: number; onNewTerritory: () => void }) {
  const pc = personaColor(ctx.persona);
  const territories = Object.entries(meta.territories).filter(([, x]) => x.persona === ctx.persona && x.status !== 'retired');
  const sel = 'min-w-0 rounded-lg border border-[#343946] bg-[#101216] px-2.5 py-1.5 text-sm font-medium text-[#ECEDEF]';
  return (
    <div className="z-10 md:sticky md:top-16 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#272B34] bg-[#121419]/95 px-4 py-2 backdrop-blur sm:px-6">
      <span className="text-xs font-semibold uppercase tracking-wider text-[#646A75]">Working on</span>
      {/* The persona: a dot and a tinted chip in its deck colour. */}
      <span className="flex min-w-0 items-center gap-1.5 rounded-lg border pl-2.5" style={{ borderColor: tint(pc.base, 0.6), background: tint(pc.base, 0.12) }}>
        <PersonaDot persona={ctx.persona} />
        <select aria-label="Persona" className="min-w-0 rounded-lg py-1.5 pl-0.5 pr-2 text-sm font-semibold" style={{ background: 'transparent', color: pc.light }} value={ctx.persona}
          onChange={e => { const p = e.target.value; const first = Object.entries(meta.territories).find(([, x]) => x.persona === p && x.status !== 'retired')?.[0] || ''; setCtx({ persona: p, territory: first, region: ctx.region }); }}>
          {personaKeys(meta.personas).map(k => <option key={k} value={k} style={{ background: '#101216', color: '#ECEDEF' }}>{meta.personas[k].name}</option>)}
        </select>
      </span>
      <span className="text-[#4A505D]" aria-hidden>×</span>
      <select aria-label="Territory" className={cn(sel, 'max-w-[22rem]')} value={ctx.territory} onChange={e => { if (e.target.value === '__new') onNewTerritory(); else setCtx({ ...ctx, territory: e.target.value }); }}>
        {territories.map(([k, x]) => <option key={k} value={k}>{territoryName(x)}</option>)}
        <option value="__new">+ New territory…</option>
      </select>
      <span className="text-[#4A505D]" aria-hidden>×</span>
      <select aria-label="Region" className={sel} value={ctx.region} onChange={e => setCtx({ ...ctx, region: e.target.value as Region })}>
        {(meta.regions || ['US', 'CA']).map(r => <option key={r} value={r}>{REGION_NAMES[r]}</option>)}
      </select>
      <span className="ml-auto hidden text-xs text-[#646A75] md:inline">Step {step + 1} of 4 · applies to every step</span>
    </div>
  );
}

function UserBadge({ user, onChange }: { user: string; onChange: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user);
  if (editing) {
    return (
      <form className="flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); if (draft.trim()) { onChange(draft.trim()); setEditing(false); } }}>
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => !draft.trim() && setEditing(false)} placeholder="Your name" className="w-32 rounded-lg border px-2 py-1 text-sm" style={{ borderColor: PINK }} />
        <button className="rounded-lg px-2.5 py-1 text-sm font-semibold text-white" style={{ background: PINK }}>Save</button>
      </form>
    );
  }
  if (!user) return <button onClick={() => setEditing(true)} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold text-white" style={{ background: PINK }}>Add your name</button>;
  return <button onClick={() => { setDraft(user); setEditing(true); }} className="whitespace-nowrap rounded-full border border-[#343946] px-3 py-1 text-sm text-[#C9CCD2] hover:border-[#6B7280]" title="Runs are saved under this name">{user} ✎</button>;
}
