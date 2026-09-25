// B1-lite Copy Studio (dev-only page). Talks to the local studio API
// (`npx tsx scripts/studio.ts serve` in backend/), which reads and writes the
// client folder on Brook's laptop. Built for a shared screen: large type, high
// contrast, flags as neutral chips (red = compliance, amber = warning). Nothing
// here is a score.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { studio, type Batch, type Brief, type CompareSet, type Flag, type Line, type Meta, type ShortRow, type StudioEvent, type Tone } from '@/lib/studioApi';
import { cn } from '@/lib/utils';

const PINK = '#D94D8F';
type Tab = 'brief' | 'review' | 'shortlist' | 'compare';

// ---------- small building blocks ----------

function PinkButton({ className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className={cn('rounded-lg px-5 py-3 text-lg font-semibold text-white shadow-sm transition disabled:opacity-40', className)} style={{ background: PINK }} />;
}
function GhostButton({ className, active, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button {...p} className={cn('rounded-lg border-2 px-3 py-1.5 text-base font-medium transition disabled:opacity-40', active ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white text-neutral-800 hover:border-neutral-500', className)} />;
}
function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-neutral-500">{children}</div>;
}
function Chip({ children, tone = 'grey', className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'grey' | 'amber' | 'red' | 'outline' }) {
  const t = { grey: 'bg-neutral-100 text-neutral-700 border-neutral-200', amber: 'bg-amber-100 text-amber-900 border-amber-300', red: 'bg-red-100 text-red-900 border-red-300', outline: 'bg-white text-neutral-700 border-neutral-300' }[tone];
  return <span {...p} className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-medium', t, className)}>{children}</span>;
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

function Slider({ label, left, right, value, onChange }: { label: string; left: string; right: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-3 text-base">
        <span className="w-20 text-right text-neutral-600">{left}</span>
        <input type="range" min={1} max={5} step={1} value={value} onChange={e => onChange(Number(e.target.value))} className="flex-1 accent-[#D94D8F]" />
        <span className="w-20 text-neutral-600">{right}</span>
        <span className="w-6 text-center font-mono font-semibold">{value}</span>
      </div>
    </div>
  );
}

// ---------- page ----------

export function Studio() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('brief');
  const [brief, setBrief] = useState<Brief>({ persona: 'DINK', territory: 'DINK_NEVER', fields: [], tone: { dry_warm: 3, playful_plain: 3, short_long: 2 }, banned_words: [], banned_ideas: [], reference_lines: [], n: 20, model: 'gpt-4o' });
  const [batch, setBatch] = useState<Batch | null>(null);
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const refreshMeta = useCallback(() => studio.meta().then(m => { setMeta(m); setErr(''); return m; }), []);
  useEffect(() => {
    refreshMeta().then(m => setBrief(b => ({ ...b, fields: m.personas[b.persona]?.default_fields || [] })))
      .catch(() => setErr('Studio API not running. In backend/: npx tsx scripts/studio.ts serve'));
    studio.batches().then(bs => { if (bs[0]) studio.batch(bs[0].id).then(setBatch); }).catch(() => {});
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
        setStatus('Done');
      }
    });
  }, [upsertLine, refreshMeta]);

  async function runGenerate() {
    setErr('');
    try {
      let r;
      try { r = await studio.generate(brief); }
      catch (e: any) {
        if (e.status !== 409) throw e;
        if (!window.confirm(`This batch is estimated at $${e.body.estimate.toFixed(2)}, over the $2 ask-first line. Run it?`)) return;
        r = await studio.generate(brief, true);
      }
      setBatch({ id: r.batch, brief, created: new Date().toISOString(), lines: [], stats: { generated: 0, near_duplicates_removed: 0, similar_flagged: 0, timings_ms: {}, usd: {}, usd_total: 0 } });
      setStatus('Writing…');
      setTab('review');
      follow(r.batch, r.batch);
    } catch (e: any) { setErr(e.message); }
  }

  async function more(line: Line, note: string) {
    if (!batch) return;
    const r = await studio.more(batch.id, line.id, note, 3);
    setStatus('Writing three more like this…');
    follow(r.job, batch.id);
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900" style={{ fontSize: 18 }}>
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-4 border-b border-neutral-200 bg-white px-8 py-4">
        <div className="text-3xl font-bold tracking-tight" style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>
          VOICES <span style={{ color: PINK }}>Studio</span>
        </div>
        <nav className="ml-6 flex gap-2">
          {(['brief', 'review', 'shortlist', 'compare'] as Tab[]).map(t => (
            <GhostButton key={t} active={tab === t} onClick={() => setTab(t)} className="px-4 py-2 text-lg capitalize">
              {t === 'review' && batch ? `Review (${batch.lines.length})` : t === 'compare' ? 'Blind compare' : t}
            </GhostButton>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-base text-neutral-600">
          {running && <span className="animate-pulse font-medium" style={{ color: PINK }}>● {status}</span>}
          {meta?.mock && <Chip tone="amber">mock: no cost</Chip>}
          {meta && <span>Spend ${meta.spend.toFixed(2)} of ${meta.cap}</span>}
        </div>
      </header>
      {err && <div className="mx-8 mt-4 rounded-lg border-2 border-red-300 bg-red-50 p-4 text-lg text-red-900">{err}</div>}
      <main className="px-8 py-6">
        {meta && tab === 'brief' && <BriefPanel meta={meta} brief={brief} setBrief={setBrief} onGenerate={runGenerate} running={running} />}
        {meta && tab === 'review' && <Review meta={meta} batch={batch} setBatch={setBatch} status={status} running={running} onMore={more} />}
        {meta && tab === 'shortlist' && <Shortlist batch={batch} />}
        {meta && tab === 'compare' && <Compare meta={meta} brief={brief} />}
      </main>
    </div>
  );
}

// ---------- 1. brief ----------

function BriefPanel({ meta, brief, setBrief, onGenerate, running }: { meta: Meta; brief: Brief; setBrief: (b: Brief) => void; onGenerate: () => void; running: boolean }) {
  const [est, setEst] = useState<{ usd: number; minutes: string } | null>(null);
  const territories = Object.entries(meta.territories).filter(([, t]) => t.persona === brief.persona);
  const t = meta.territories[brief.territory];
  const set = (patch: Partial<Brief>) => setBrief({ ...brief, ...patch });
  const setTone = (k: keyof Tone, v: number) => set({ tone: { ...brief.tone, [k]: v } });

  useEffect(() => {
    const h = setTimeout(() => {
      studio.estimate(brief).then(e => setEst({ usd: e.usd, minutes: Object.entries(e.minutes_at_budget).map(([m, v]) => `${m} ${v} min`).join(' · ') })).catch(() => setEst(null));
    }, 300);
    return () => clearTimeout(h);
  }, [brief]);

  return (
    <div className="grid max-w-7xl grid-cols-1 gap-8 lg:grid-cols-[1.1fr_1fr]">
      <section className="space-y-6 rounded-xl border border-neutral-200 bg-white p-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Persona</Label>
            <select className="w-full rounded-lg border-2 border-neutral-300 bg-white px-3 py-2.5 text-lg" value={brief.persona}
              onChange={e => { const p = e.target.value; const first = Object.entries(meta.territories).find(([, x]) => x.persona === p)?.[0] || ''; set({ persona: p, territory: first, fields: meta.personas[p].default_fields }); }}>
              {Object.entries(meta.personas).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Territory</Label>
            <select className="w-full rounded-lg border-2 border-neutral-300 bg-white px-3 py-2.5 text-lg" value={brief.territory} onChange={e => set({ territory: e.target.value })}>
              {territories.map(([k, x]) => <option key={k} value={k}>{x.name}{x.status ? ' (springboard)' : ''}</option>)}
            </select>
          </div>
        </div>
        {t && <p className="rounded-lg bg-neutral-50 p-3 text-base text-neutral-700"><span className="font-semibold">{t.format}.</span> {t.premise}</p>}
        <div>
          <Label>Angles in the grid (the persona's triggers × 6 structures × tone)</Label>
          <div className="flex flex-wrap gap-1.5">
            {meta.personas[brief.persona]?.triggers.map(tr => (
              <Chip key={tr.id} tone={tr.id === t?.angle ? 'outline' : 'grey'} className={tr.id === t?.angle ? 'border-2 border-neutral-800' : ''}>{tr.label}</Chip>
            ))}
          </div>
        </div>

        <div>
          <Label>Fields</Label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(meta.fields).map(([k, f]) => {
              const on = brief.fields.includes(k);
              return (
                <GhostButton key={k} active={on} onClick={() => set({ fields: on ? brief.fields.filter(x => x !== k) : [...brief.fields, k] })}>
                  {f.label} <span className="opacity-70">· {f.visible}</span>
                </GhostButton>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <Slider label="Dry – warm" left="dry" right="warm" value={brief.tone.dry_warm} onChange={v => setTone('dry_warm', v)} />
          <Slider label="Playful – plain" left="playful" right="plain" value={brief.tone.playful_plain} onChange={v => setTone('playful_plain', v)} />
          <Slider label="Short – long" left="short" right="long" value={brief.tone.short_long} onChange={v => setTone('short_long', v)} />
        </div>
      </section>

      <section className="space-y-6 rounded-xl border border-neutral-200 bg-white p-6">
        <div>
          <Label>Banned words (comma-separated)</Label>
          <input className="w-full rounded-lg border-2 border-neutral-300 px-3 py-2.5 text-lg" value={brief.banned_words.join(', ')}
            onChange={e => set({ banned_words: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="e.g. furbaby, hassle-free" />
        </div>
        <div>
          <Label>Off-limits ideas (one per line)</Label>
          <textarea rows={3} className="w-full rounded-lg border-2 border-neutral-300 px-3 py-2.5 text-lg" value={brief.banned_ideas.join('\n')}
            onChange={e => set({ banned_ideas: e.target.value.split('\n') })} placeholder="e.g. no sick pets on screen" />
        </div>
        <div>
          <Label>Reference lines, 2-3 in the voice you want</Label>
          <textarea rows={3} className="w-full rounded-lg border-2 border-neutral-300 px-3 py-2.5 text-lg" value={brief.reference_lines.join('\n')}
            onChange={e => set({ reference_lines: e.target.value.split('\n') })} placeholder="One per line" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Lines (n)</Label>
            <input type="number" min={4} max={60} className="w-full rounded-lg border-2 border-neutral-300 px-3 py-2.5 text-lg" value={brief.n} onChange={e => set({ n: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Writing model</Label>
            <input list="studio-models" className="w-full rounded-lg border-2 border-neutral-300 px-3 py-2.5 text-lg" value={brief.model} onChange={e => set({ model: e.target.value })} />
            <datalist id="studio-models">{['gpt-4o', 'gpt-4.1', 'gpt-5', 'gpt-5-mini', 'gpt-4o-mini'].map(m => <option key={m} value={m} />)}</datalist>
          </div>
        </div>
        <div className="flex items-center gap-4 border-t border-neutral-200 pt-5">
          <PinkButton onClick={onGenerate} disabled={running || !brief.fields.length}>{running ? 'Running…' : 'Generate and check'}</PinkButton>
          {est && <div className="text-base text-neutral-600">~${est.usd.toFixed(2)} · {est.minutes}</div>}
        </div>
        <p className="text-sm text-neutral-500">Checks run on every line as it's written: character limits, compliance and brand rules, persona turn-offs, readable at a glance, product clarity, near-duplicates and a skeptic's objection. Every flag names its source. Flags, not scores. {meta.needs_review ? `${meta.needs_review} rules-file items still open for review.` : ''}</p>
      </section>
    </div>
  );
}

// ---------- 2. review grid ----------

function Review({ meta, batch, setBatch, status, running, onMore }: { meta: Meta; batch: Batch | null; setBatch: React.Dispatch<React.SetStateAction<Batch | null>>; status: string; running: boolean; onMore: (l: Line, note: string) => void }) {
  const [group, setGroup] = useState<'angle' | 'structure'>('angle');
  const [filter, setFilter] = useState<'all' | 'compliance' | 'open' | 'kept'>('all');
  const [batches, setBatches] = useState<Array<{ id: string; lines: number }>>([]);
  useEffect(() => { studio.batches().then(setBatches).catch(() => {}); }, [batch?.id, running]);

  if (!batch) return <div className="text-xl text-neutral-600">No batch yet. Write a brief and press Generate.</div>;
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
          <div className="text-2xl font-bold">{meta.personas[batch.brief.persona]?.name} · {t?.name}</div>
          <div className="text-base text-neutral-600">
            {checked} of {batch.lines.length} checked · writer {batch.brief.model}
            {batch.stats.near_duplicates_removed ? ` · ${batch.stats.near_duplicates_removed} near-duplicates removed` : ''}
            {batch.stats.timings_ms.total ? ` · ${(batch.stats.timings_ms.total / 1000).toFixed(0)}s · $${batch.stats.usd_total.toFixed(2)}` : ''}
          </div>
        </div>
        <select className="rounded-lg border-2 border-neutral-300 bg-white px-3 py-1.5 text-base" value={batch.id} onChange={e => studio.batch(e.target.value).then(setBatch)}>
          {[...batches.map(b => b.id), ...(batches.some(b => b.id === batch.id) ? [] : [batch.id])].map(id => <option key={id} value={id}>{id}</option>)}
        </select>
        <div className="ml-auto flex flex-wrap gap-2">
          <span className="self-center text-sm font-semibold uppercase text-neutral-500">Group</span>
          <GhostButton active={group === 'angle'} onClick={() => setGroup('angle')}>Angle</GhostButton>
          <GhostButton active={group === 'structure'} onClick={() => setGroup('structure')}>Structure</GhostButton>
          <span className="ml-3 self-center text-sm font-semibold uppercase text-neutral-500">Show</span>
          {(['all', 'compliance', 'open', 'kept'] as const).map(f => <GhostButton key={f} active={filter === f} onClick={() => setFilter(f)}>{f === 'compliance' ? 'Compliance flags' : f === 'open' ? 'Undecided' : f === 'kept' ? 'Kept' : 'All'}</GhostButton>)}
        </div>
      </div>
      {running && (
        <div className="h-2 w-full overflow-hidden rounded bg-neutral-200">
          <div className="h-full transition-all" style={{ width: `${batch.lines.length ? (100 * checked) / batch.lines.length : 5}%`, background: PINK }} />
        </div>
      )}
      {running && <div className="text-base text-neutral-600">{status}</div>}
      {[...groups.entries()].map(([g, ls]) => (
        <section key={g}>
          <h2 className="mb-3 mt-2 text-xl font-bold capitalize">{g} <span className="font-normal text-neutral-500">({ls.length})</span></h2>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {ls.map(l => <LineCard key={l.id} meta={meta} line={l} onChange={replace} onMore={onMore} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function LineCard({ meta, line, onChange, onMore }: { meta: Meta; line: Line; onChange: (l: Line) => void; onMore: (l: Line, note: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
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
  const border = line.decision === 'keep' || line.decision === 'edit' ? 'border-emerald-500' : line.decision === 'cut' ? 'border-neutral-300 opacity-50' : 'border-neutral-200';

  return (
    <div className={cn('rounded-xl border-2 bg-white p-5', border)}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
        <span className="font-mono font-semibold text-neutral-900">{line.id.split('-').pop()}</span>
        <span>{f?.label || line.field}</span>
        <span className={cn('font-mono', over ? 'font-bold text-amber-700' : '')}>{chars}/{f?.visible}</span>
        <span>· {line.structure.replace('_', ' ')}</span>
        <span>· {line.tone_label}</span>
        {line.parent && <Chip tone="outline">more like {line.parent.split('-').pop()}</Chip>}
        {line.status !== 'checked' && <span className="animate-pulse" style={{ color: PINK }}>checking…</span>}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea className="w-full rounded-lg border-2 border-neutral-400 p-3 text-xl leading-snug" rows={3} value={draft} onChange={e => setDraft(e.target.value)} autoFocus />
          <div className="flex gap-2">
            <PinkButton className="px-4 py-2 text-base" onClick={async () => { await decide({ decision: 'edit', edited_text: draft }); setEditing(false); }}>Save edit</PinkButton>
            <GhostButton onClick={() => setEditing(false)}>Cancel</GhostButton>
            <span className="self-center font-mono text-sm text-neutral-500">{[...draft].length}/{f?.visible}</span>
          </div>
        </div>
      ) : (
        <p className="text-2xl leading-snug">{text}</p>
      )}
      {line.decision === 'edit' && line.edited_text && !editing && <p className="mt-1 text-base text-neutral-500 line-through">{line.text}</p>}

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
        <div className={cn('mt-2 rounded-lg border p-3 text-base', openFlag.severity === 'compliance' ? 'border-red-300 bg-red-50' : openFlag.severity === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-neutral-200 bg-neutral-50')}>
          <div className="font-semibold">{openFlag.label}</div>
          {openFlag.quote && <div className="mt-1">In the line: <mark className="bg-yellow-200 px-1">{openFlag.quote}</mark></div>}
          {openFlag.why && <div className="mt-1 text-neutral-700">{openFlag.why}</div>}
          <div className="mt-1 text-sm text-neutral-600">Source: {openFlag.source} · found by {openFlag.by.join(' + ')}{openFlag.p !== undefined ? ` · P(yes) ${openFlag.p}` : ''}</div>
        </div>
      )}
      {line.features.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">{line.features.map(x => <Chip key={x} tone="outline" className="text-xs">{x.replace(/_/g, ' ')}</Chip>)}</div>
      )}
      {line.objection && <p className="mt-3 border-l-4 border-neutral-300 pl-3 text-lg italic text-neutral-700">Skeptic: {line.objection}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <GhostButton active={line.decision === 'keep'} onClick={() => decide({ decision: line.decision === 'keep' ? '' : 'keep' })}>Keep</GhostButton>
        <GhostButton active={line.decision === 'cut'} onClick={() => decide({ decision: line.decision === 'cut' ? '' : 'cut' })}>Cut</GhostButton>
        <GhostButton active={line.decision === 'edit'} onClick={() => { setDraft(line.edited_text || line.text); setEditing(true); }}>Edit</GhostButton>
        <GhostButton onClick={() => onMore(line, note)} title="Writes three siblings, using the note as guidance">More like this</GhostButton>
        <input className="min-w-[12rem] flex-1 rounded-lg border-2 border-neutral-200 px-3 py-1.5 text-base" placeholder="Note (why; guides 'more like this')" value={note}
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
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-5">
        <div className="mr-auto">
          <div className="text-2xl font-bold">Shortlist</div>
          <div className="text-base text-neutral-600">Kept and edited lines with naming stubs (PERSONA_TERRITORY_FORMAT_v#_PLATFORM; add the date at trafficking).</div>
        </div>
        <a className="rounded-lg px-4 py-2 text-base font-semibold text-white" style={{ background: PINK }} href={studio.url('/shortlist.csv')}>Shortlist CSV</a>
        <a className="rounded-lg border-2 border-neutral-300 px-4 py-2 text-base font-medium" href={studio.url('/shortlist.md')}>Shortlist Markdown</a>
        {batch && <a className="rounded-lg border-2 border-neutral-300 px-4 py-2 text-base font-medium" href={studio.url(`/batches/${encodeURIComponent(batch.id)}/export.csv`)}>Batch CSV for Sheets</a>}
        {batch && <a className="rounded-lg border-2 border-neutral-300 px-4 py-2 text-base font-medium" href={studio.url(`/batches/${encodeURIComponent(batch.id)}/export.md`)}>Batch Markdown</a>}
        <label className="cursor-pointer rounded-lg border-2 border-dashed border-neutral-400 px-4 py-2 text-base font-medium">
          Import curated CSV
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </div>
      {msg && <div className="rounded-lg bg-emerald-50 p-3 text-base text-emerald-900">{msg}</div>}
      {!rows.length && <div className="text-lg text-neutral-600">Nothing kept yet. Keep or edit lines in Review, or import a curated sheet.</div>}
      {[...groups.entries()].map(([g, rs]) => (
        <section key={g} className="rounded-xl border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 text-xl font-bold">{g} <span className="font-normal text-neutral-500">({rs.length})</span></h2>
          <table className="w-full text-left text-lg">
            <thead><tr className="text-sm uppercase text-neutral-500"><th className="pb-2 pr-4">Naming stub</th><th className="pb-2 pr-4">Field</th><th className="pb-2 pr-4">Line</th><th className="pb-2">Note</th></tr></thead>
            <tbody>
              {rs.map(r => (
                <tr key={r.id} className="border-t border-neutral-100 align-top">
                  <td className="py-2 pr-4 font-mono text-sm">{r.stub}</td>
                  <td className="py-2 pr-4 text-base text-neutral-600">{r.field.replace('_', ' ')}</td>
                  <td className="py-2 pr-4">
                    {r.text}
                    {((r.compliance_flags?.length ?? 0) > 0 || (r.warn_flags?.length ?? 0) > 0) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(r.compliance_flags || []).map(f => <Chip key={f} tone="red" className="text-xs">{chipName(f)}</Chip>)}
                        {(r.warn_flags || []).map(f => <Chip key={f} tone="amber" className="text-xs">{chipName(f)}</Chip>)}
                      </div>
                    )}
                  </td>
                  <td className="py-2 text-base text-neutral-600">{r.note}</td>
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
  const [models, setModels] = useState('gpt-4o, gpt-4.1, gpt-5-mini');
  const [n, setN] = useState(8);
  const [status, setStatus] = useState('');
  const [key, setKey] = useState<{ labels: Record<string, string>; tally: Record<string, number> } | null>(null);
  const load = (name: string) => { setKey(null); studio.compareSet(name).then(setSet); };
  useEffect(() => { studio.compares().then(ns => { setNames(ns); if (ns[0]) load(ns[0]); }).catch(() => {}); }, []);

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
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-neutral-200 bg-white p-5">
        <div className="mr-auto">
          <div className="text-2xl font-bold">Blind compare</div>
          <div className="text-base text-neutral-600">The current brief ({meta.personas[brief.persona]?.name} · {meta.territories[brief.territory]?.name}) goes to each writer. Lines are shuffled and unlabelled; star the ones you'd use, then reveal.</div>
        </div>
        <div><Label>Writers</Label><input className="w-72 rounded-lg border-2 border-neutral-300 px-3 py-2 text-lg" value={models} onChange={e => setModels(e.target.value)} /></div>
        <div><Label>Lines each</Label><input type="number" className="w-24 rounded-lg border-2 border-neutral-300 px-3 py-2 text-lg" value={n} onChange={e => setN(Number(e.target.value))} /></div>
        <PinkButton onClick={run} disabled={!!status}>{status || 'Run blind compare'}</PinkButton>
      </div>
      {names.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <select className="rounded-lg border-2 border-neutral-300 bg-white px-3 py-1.5 text-base" value={set?.name || ''} onChange={e => load(e.target.value)}>
            {names.map(x => <option key={x}>{x}</option>)}
          </select>
          {set && <span className="text-base text-neutral-600">{set.lines.length} lines · {set.lines.filter(l => l.favourite).length} starred</span>}
          {set && !revealed && <GhostButton className="ml-auto" onClick={async () => setKey(await studio.reveal(set.name))}>Reveal the writers</GhostButton>}
        </div>
      )}
      {key && (
        <div className="flex flex-wrap gap-4 rounded-xl border-2 p-5" style={{ borderColor: PINK }}>
          {Object.entries(key.labels).map(([label, model]) => (
            <div key={label} className="text-xl"><span className="font-bold">Writer {label}</span> = {model} · <span className="font-semibold">{key.tally[label] || 0} starred</span></div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {set?.lines.map(l => (
          <div key={l.id} className={cn('rounded-xl border-2 bg-white p-5', l.favourite ? 'border-[#D94D8F]' : 'border-neutral-200')}>
            <div className="mb-2 flex items-center gap-2 text-sm text-neutral-600">
              <span className="font-mono font-semibold text-neutral-900">{l.id}</span>
              <span>{meta.fields[l.field]?.label}</span>
              <span className="font-mono">{l.chars}/{meta.fields[l.field]?.visible}</span>
              {revealed && <Chip tone="outline">Writer {l.label} · {key!.labels[l.label]}</Chip>}
              <button className="ml-auto text-3xl leading-none" style={{ color: l.favourite ? PINK : '#bbb' }} onClick={() => mark(l.id, { favourite: !l.favourite })} aria-label="Star">★</button>
            </div>
            <p className="text-2xl leading-snug">{l.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
