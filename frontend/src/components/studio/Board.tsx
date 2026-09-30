// The round overview board: the start screen once a round has begun (How it works is behind "?", and is still the start
// screen while the round has no runs). Persona rows (persona colours) × that persona's live territories, with a totals
// column and row. Each cell: lines kept → ads signed off → uploaded → cleared by Trupanion → ready to traffic, red when
// Trupanion asked for changes. Clicking a cell sets the context and opens the most useful step. Counts come from the
// existing lists (runs, kept lines, codes), all in the round the header shows.
import { useEffect, useState } from 'react';
import { roundLabel, studio, type Meta, type PfStub, type RunSummary, type ShortRow } from '@/lib/studioApi';
import { personaColor, tint } from '@/lib/personaColors';
import { cn } from '@/lib/utils';
import { GhostButton, HEADING_FONT, Label, PersonaDot, personaKeys, territoryName } from './ui';

export type Step = 'write' | 'review' | 'build' | 'assets';
interface Counts { runs: number; kept: number; signed: number; uploaded: number; cleared: number; ready: number; changes: number }
const zero = (): Counts => ({ runs: 0, kept: 0, signed: 0, uploaded: 0, cleared: 0, ready: 0, changes: 0 });
const add = (a: Counts, b: Counts): Counts => Object.fromEntries(Object.keys(a).map(k => [k, (a as any)[k] + (b as any)[k]])) as unknown as Counts;
const STAGES: Array<[keyof Counts, string]> = [['kept', 'kept'], ['signed', 'signed off'], ['uploaded', 'uploaded'], ['cleared', 'cleared'], ['ready', 'ready']];
/** The step a cell opens: Assets once anything is signed off, Build when lines are kept, else Review (or Write, not started). */
export const stepFor = (c: Counts): Step => (c.signed ? 'assets' : c.kept ? 'build' : c.runs ? 'review' : 'write');

export function Board({ meta, onOpen, onHowItWorks, onRoundSaved }: {
  meta: Meta; onOpen: (persona: string, territory: string, step: Step) => void; onHowItWorks: () => void; onRoundSaved: () => void;
}) {
  const [data, setData] = useState<{ runs: RunSummary[]; kept: ShortRow[]; stubs: PfStub[]; rules: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([studio.batches(), studio.shortlist(), meta.preflight?.enabled ? studio.pfStubs() : Promise.resolve([] as PfStub[]), studio.activeRules().then(r => r.version).catch(() => '')])
      .then(([runs, kept, stubs, rules]) => setData({ runs, kept, stubs, rules })).catch(e => setError(e.message));
  }, [meta.preflight?.enabled]);
  if (error) return <div className="rounded-lg border-2 border-red-500/45 bg-red-500/10 p-4 text-base text-red-200">{error}</div>;
  if (!data) return <div className="text-base text-[#858B96]">Loading the month…</div>;

  const cell = (persona: string, territory: string): Counts => {
    const c = zero();
    c.runs = data.runs.filter(r => r.persona === persona && r.territory === territory).length;
    c.kept = data.kept.filter(r => r.persona === persona && r.territory === territory).length;
    for (const s of data.stubs.filter(x => x.persona === persona && x.territory === territory)) {
      c.signed++;
      if (s.upload) c.uploaded++;
      if (s.traffic?.compliance === 'cleared') c.cleared++;
      if (s.traffic?.ready) c.ready++;
      if (s.traffic?.compliance === 'changes_requested') c.changes++;
    }
    return c;
  };
  const rounds = meta.rounds;
  const active = rounds?.rounds.find(r => r.id === rounds.active);
  const personas = personaKeys(meta.personas);
  const rows = personas.map(p => {
    const ts = Object.entries(meta.territories).filter(([, t]) => t.persona === p && t.status !== 'retired').map(([k]) => k);
    const cells = ts.map(t => ({ t, c: cell(p, t) }));
    return { p, cells, total: cells.reduce((a, x) => add(a, x.c), zero()) };
  });
  const grand = rows.reduce((a, r) => add(a, r.total), zero());
  const cols = Math.max(...rows.map(r => r.cells.length), 1);

  return (
    <div className="max-w-[1500px] space-y-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="mr-auto">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight" style={HEADING_FONT}>{active ? roundLabel(active) : 'This month'}</h1>
            {active?.test && <span className="rounded-full border border-amber-400 bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-100">TEST: never handed off</span>}
          </div>
          <p className="text-base text-[#A3A8B1]">Where every persona × territory stands. Click a cell to work on it. <button className="underline underline-offset-2 hover:text-[#ECEDEF]" onClick={onHowItWorks}>How it works</button></p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {data.rules && <span className="rounded-lg border border-[#272B34] bg-[#16181D] px-3 py-1.5 text-sm text-[#A3A8B1]">Rules <span className="font-mono text-[#ECEDEF]">{data.rules}</span></span>}
          {active && <Deadline meta={meta} round={active} onSaved={onRoundSaved} />}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-2 text-left">
          <thead>
            <tr>
              <th className="w-48" />
              {Array.from({ length: cols }, (_, i) => <th key={i} className="px-1 text-xs font-semibold uppercase tracking-wider text-[#646A75]">Territory {i + 1}</th>)}
              <th className="w-44 px-1 text-xs font-semibold uppercase tracking-wider text-[#646A75]">Persona total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, cells, total }) => {
              const pc = personaColor(p);
              return (
                <tr key={p} className="align-top">
                  <th scope="row" className="rounded-xl border-l-4 px-3 py-3" style={{ borderLeftColor: pc.edge, background: tint(pc.base, 0.1) }}>
                    <div className="flex items-center gap-2 text-base font-semibold" style={{ color: pc.light }}><PersonaDot persona={p} />{meta.personas[p]?.name.replace(/\s*\(.*\)$/, '')}</div>
                  </th>
                  {Array.from({ length: cols }, (_, i) => {
                    const x = cells[i];
                    if (!x) return <td key={i} />;
                    const t = meta.territories[x.t];
                    return (
                      <td key={x.t} className="p-0">
                        <button onClick={() => onOpen(p, x.t, stepFor(x.c))} title={`Open ${territoryName(t)}: ${stepFor(x.c) === 'assets' ? 'Assets' : stepFor(x.c) === 'build' ? 'Build & sign off' : stepFor(x.c) === 'review' ? 'Review' : 'Write'}`}
                          className={cn('h-full w-full rounded-xl border-2 border-l-4 bg-[#16181D] px-3 py-2.5 text-left transition hover:bg-[#1C1F26]', x.c.changes ? 'border-red-500/60' : 'border-[#272B34] hover:border-[#4A505D]')}
                          style={{ borderLeftColor: x.c.changes ? undefined : pc.edge }}>
                          <div className="mb-1.5 text-sm font-semibold leading-snug text-[#ECEDEF]">{territoryName(t).replace(/ \(idea from the research; not in the pitch\)/, ' (research idea)')}</div>
                          <Pipeline c={x.c} />
                        </button>
                      </td>
                    );
                  })}
                  <td className="rounded-xl border border-[#272B34] bg-[#121419] px-3 py-2.5"><Pipeline c={total} /></td>
                </tr>
              );
            })}
            <tr className="align-top">
              <th scope="row" className="rounded-xl border border-[#272B34] bg-[#121419] px-3 py-3 text-sm font-semibold text-[#C9CCD2]">All personas</th>
              <td colSpan={cols} className="rounded-xl border border-[#272B34] bg-[#121419] px-3 py-2.5 text-sm text-[#858B96]">
                {grand.runs} run{grand.runs === 1 ? '' : 's'} this month{grand.changes ? <span className="ml-2 font-semibold text-red-200">· {grand.changes} with changes requested</span> : null}
              </td>
              <td className="rounded-xl border-2 border-[#343946] bg-[#121419] px-3 py-2.5"><Pipeline c={grand} /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm text-[#646A75]">Lines kept → ads signed off (codes) → assets uploaded → cleared by Trupanion → ready to traffic. A red cell has changes requested. Totals follow the month in the header (“All months” counts every month).</p>
    </div>
  );
}

function Pipeline({ c }: { c: Counts }) {
  if (!c.runs && !c.kept && !c.signed) return <div className="text-sm text-[#646A75]">not started</div>;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-1 text-sm">
        {STAGES.map(([k, label], i) => (
          <span key={k} className="flex items-baseline gap-1 whitespace-nowrap">
            {i > 0 && <span className="text-[#4A505D]" aria-hidden>→</span>}
            <span className={cn('font-mono text-base font-semibold', k === 'ready' && c.ready ? 'text-emerald-300' : c[k] ? 'text-[#ECEDEF]' : 'text-[#4A505D]')}>{c[k]}</span>
            <span className="text-xs text-[#858B96]">{label}</span>
          </span>
        ))}
      </div>
      {c.changes > 0 && <div className="text-xs font-semibold text-red-200">{c.changes} with changes requested</div>}
    </div>
  );
}

/** "Assets due 12 Oct · 12 days": the round's asset deadline; an admin sets it here (stored with the round). */
function Deadline({ meta, round, onSaved }: { meta: Meta; round: NonNullable<Meta['rounds']>['rounds'][number]; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(round.assets_due || '');
  const [err, setErr] = useState('');
  const can = !!meta.rounds?.can_edit;
  const days = round.assets_due ? Math.ceil((new Date(`${round.assets_due}T23:59:59`).getTime() - Date.now()) / 86_400_000) : null;
  async function save(v: string) {
    try { await studio.saveRound({ id: round.id, name: round.name, from: round.from, test: round.test, assets_due: v }); setEditing(false); setErr(''); onSaved(); }
    catch (e: any) { setErr(e.message); }
  }
  if (editing) return (
    <span className="flex items-center gap-2 rounded-lg border border-[#343946] bg-[#16181D] px-3 py-1.5 text-sm">
      <Label>Assets due</Label>
      <input type="date" aria-label="Assets due" className="rounded border border-[#343946] px-2 py-0.5 text-sm" value={date} onChange={e => setDate(e.target.value)} />
      <GhostButton className="px-2 py-0.5 text-xs" onClick={() => save(date)}>Save</GhostButton>
      {round.assets_due && <GhostButton className="px-2 py-0.5 text-xs" onClick={() => save('')}>Clear</GhostButton>}
      <button className="text-xs text-[#858B96]" onClick={() => setEditing(false)}>cancel</button>
      {err && <span className="text-xs text-red-200">{err}</span>}
    </span>
  );
  return (
    <span className={cn('flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm', days !== null && days < 0 ? 'border-red-500/50 text-red-100' : days !== null && days <= 3 ? 'border-amber-400/50 text-amber-100' : 'border-[#272B34] bg-[#16181D] text-[#C9CCD2]')}>
      {round.assets_due
        ? <>Assets due <span className="font-semibold">{new Date(`${round.assets_due}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span><span className="text-[#858B96]">· {days! < 0 ? `${-days!} day${days === -1 ? '' : 's'} late` : days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`}</span></>
        : <span className="text-[#858B96]">No asset deadline set</span>}
      {can && <button className="text-xs text-[#858B96] underline-offset-2 hover:text-[#ECEDEF] hover:underline" onClick={() => { setDate(round.assets_due || ''); setEditing(true); }}>{round.assets_due ? 'change' : 'set'}</button>}
    </span>
  );
}
