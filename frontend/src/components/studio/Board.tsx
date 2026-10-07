// The round overview board: the start screen once a round has begun (How it works is behind "?", and is still the start
// screen while the round has no runs). Persona rows (persona colours) × that persona's assets, with a totals column
// and row, for ONE region (the header's switch): US and Canada are separate ads, so no number mixes them. Every count
// after "kept" is in ads (Add3, 6 Oct: an ad is a visual; its versions are copy options, not ads): signed off →
// artwork uploaded → Pre-flight passed → cleared by Trupanion → ready to traffic, red when Trupanion asked for changes. Clicking a cell sets the context and opens the most useful step. Counts come from the
// existing lists (runs, kept lines, codes), all in the round the header shows.
import { useEffect, useState } from 'react';
import { roundLabel, studio, type Meta, type PfStub, type Region, type RunSummary, type ShortRow } from '@/lib/studioApi';
import { personaColor, tint } from '@/lib/personaColors';
import { cn } from '@/lib/utils';
import { GhostButton, HEADING_FONT, Label, PersonaDot, personaKeys, regionLabel, regionOf, territoryName, isOpenTerritory } from './ui';

export type Step = 'write' | 'review' | 'build' | 'assets';
/** kept: lines. Everything after it: ads (a visual with its copy options). options: the copy options on the signed-off ads. */
interface Counts { runs: number; kept: number; signed: number; options: number; uploaded: number; passed: number; cleared: number; ready: number; changes: number; /** Of those, the copy sent back: fixed at Build & sign off. */ copyChanges: number }
const zero = (): Counts => ({ runs: 0, kept: 0, signed: 0, options: 0, uploaded: 0, passed: 0, cleared: 0, ready: 0, changes: 0, copyChanges: 0 });
const add = (a: Counts, b: Counts): Counts => Object.fromEntries(Object.keys(a).map(k => [k, (a as any)[k] + (b as any)[k]])) as unknown as Counts;
const STAGES: Array<[keyof Counts, string]> = [['signed', 'signed off'], ['uploaded', 'uploaded'], ['passed', 'Pre-flight'], ['cleared', 'cleared'], ['ready', 'ready']];
/**
 * The step a cell opens: Build when Trupanion sent copy back (it's fixed there), Assets once anything is signed off,
 * Build when lines are kept, else Review (or Write, not started).
 */
export const stepFor = (c: Counts): Step => (c.copyChanges ? 'build' : c.signed ? 'assets' : c.kept ? 'build' : c.runs ? 'review' : 'write');

export function Board({ meta, region, onOpen, onHowItWorks, onRoundSaved }: {
  /** The region shown (the header's switch). */
  region: Region;
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
    const here = <T extends { persona: string; territory: string; region?: Region }>(x: T) => x.persona === persona && x.territory === territory && regionOf(x) === region;
    c.runs = data.runs.filter(here).length;
    c.kept = data.kept.filter(here).length;
    // An ad is a visual: its codes (copy options) share a visual key. The ad is as far along as its least advanced option.
    const ads = new Map<string, PfStub[]>();
    for (const s of data.stubs.filter(here)) { const k = s.visual_key || s.stub; ads.set(k, [...(ads.get(k) || []), s]); }
    for (const codes of ads.values()) {
      c.signed++;
      c.options += codes.length;
      if (codes.some(s => s.upload)) c.uploaded++;
      if (codes.every(s => s.traffic?.preflight === 'passed')) c.passed++;
      if (codes.every(s => s.traffic?.compliance === 'cleared')) c.cleared++;
      if (codes.every(s => s.traffic?.ready)) c.ready++;
      const back = codes.filter(s => s.traffic?.compliance === 'changes_requested');
      if (back.length) { c.changes++; if (back.some(s => s.traffic.send_back !== 'asset')) c.copyChanges++; }
    }
    return c;
  };
  const rounds = meta.rounds;
  const active = rounds?.rounds.find(r => r.id === (rounds.working || rounds.active));
  const personas = personaKeys(meta.personas);
  const rows = personas.map(p => {
    // Retired territories with runs or sign-offs in this round keep their cell (marked retired).
    const ts = Object.entries(meta.territories).filter(([k, t]) => t.persona === p && isOpenTerritory(meta, k, t)).map(([k]) => k);
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
          <p className="text-base text-[#A3A8B1]"><span className="font-semibold text-[#ECEDEF]">{regionLabel(region)}.</span> Where each asset stands. Click one to work on it. <button className="underline underline-offset-2 hover:text-[#ECEDEF]" onClick={onHowItWorks}>How it works</button></p>
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
              <th colSpan={cols} className="px-1 text-xs font-semibold uppercase tracking-wider text-[#646A75]">Assets · {regionLabel(region)}</th>
              <th className="w-44 px-1 text-xs font-semibold uppercase tracking-wider text-[#646A75]">Persona total, in ads</th>
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
                          <div className="mb-1.5 text-sm font-semibold leading-snug text-[#ECEDEF]">{territoryName(t).replace(/ \(idea from the research; not in the pitch\)/, ' (research idea)')}{t?.status === 'retired' && <span className="ml-1.5 rounded-full border border-[#4A505D] px-1.5 py-px text-[10px] font-normal uppercase tracking-wide text-[#858B96]" title="Retired: its runs and sign-offs in this round still open; no new briefs">retired</span>}</div>
                          <Pipeline c={x.c} />
                        </button>
                      </td>
                    );
                  })}
                  <td className="rounded-xl border border-[#272B34] bg-[#121419] px-3 py-2.5"><Pipeline c={total} /></td>
                </tr>
              );
            })}
            {/* The shared captions pool: post copy reused across personas. Its lines are built into each territory's ads. */}
            {meta.shared && (() => {
              const sp = meta.shared.persona, st = meta.shared.territory, c = cell(sp, st);
              return (
                <tr className="align-top">
                  <th scope="row" className="rounded-xl border border-[#343946] bg-[#16181D] px-3 py-3 text-sm font-semibold text-[#ECEDEF]">{meta.shared.name}</th>
                  <td colSpan={cols} className="p-0">
                    <button onClick={() => onOpen(sp, st, c.runs ? 'review' : 'write')} title={`Open ${meta.shared.name}: ${c.runs ? 'Review' : 'Write'}`}
                      className="h-full w-full rounded-xl border-2 border-[#272B34] bg-[#16181D] px-3 py-2.5 text-left text-sm text-[#C9CCD2] transition hover:border-[#4A505D] hover:bg-[#1C1F26]">
                      {c.runs ? <><span className="font-mono text-base font-semibold text-[#ECEDEF]">{c.kept}</span> kept · {c.runs} run{c.runs === 1 ? '' : 's'}</> : <span className="text-[#646A75]">not started</span>}
                      <span className="ml-2 text-[#858B96]">Captions and primary text for all personas, offered in every territory’s Build.</span>
                    </button>
                  </td>
                  <td />
                </tr>
              );
            })()}
            <tr className="align-top">
              <th scope="row" className="rounded-xl border border-[#272B34] bg-[#121419] px-3 py-3 text-sm font-semibold text-[#C9CCD2]">All personas</th>
              <td colSpan={cols} className="rounded-xl border border-[#272B34] bg-[#121419] px-3 py-2.5 text-sm text-[#858B96]">
                <span className="font-semibold text-[#ECEDEF]">{grand.signed} ad{grand.signed === 1 ? '' : 's'}</span> signed off in {regionLabel(region)}, of {rows.reduce((n, r) => n + r.cells.filter(x => x.c.runs || x.c.kept || x.c.signed).length, 0)} asset{rows.reduce((n, r) => n + r.cells.filter(x => x.c.runs || x.c.kept || x.c.signed).length, 0) === 1 ? '' : 's'} with copy{grand.changes ? <span className="ml-2 font-semibold text-red-200">· {grand.changes} with changes requested</span> : null}
              </td>
              <td className="rounded-xl border-2 border-[#343946] bg-[#121419] px-3 py-2.5"><Pipeline c={grand} /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm text-[#646A75]">Counted in ads, one region at a time: an ad is one visual with its copy options (never one per option). Signed off → artwork uploaded → Pre-flight passed → cleared by Trupanion → ready to traffic. A red cell has changes requested. Totals follow the month in the header (“All months” counts every month).</p>
    </div>
  );
}

function Pipeline({ c }: { c: Counts }) {
  if (!c.runs && !c.kept && !c.signed) return <div className="text-sm text-[#646A75]">not started</div>;
  // Before sign-off there is no ad yet: say where the copy is.
  if (!c.signed) return c.kept
    ? <div className="text-sm text-[#A3A8B1]"><span className="font-mono text-base font-semibold text-[#ECEDEF]">{c.kept}</span> line{c.kept === 1 ? '' : 's'} kept · <span className="text-[#858B96]">not signed off</span></div>
    : <div className="text-sm text-[#858B96]">in review · nothing kept yet</div>;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-1 text-sm">
        {STAGES.map(([k, label], i) => (
          <span key={k} className="flex items-baseline gap-1 whitespace-nowrap">
            {i > 0 && <span className="text-[#4A505D]" aria-hidden>→</span>}
            <span className={cn('font-mono text-base font-semibold', k === 'ready' && c.ready ? 'text-emerald-300' : c[k] ? 'text-[#ECEDEF]' : 'text-[#4A505D]')}>{c[k]}</span>
            <span className="text-xs text-[#858B96]">{i === 0 ? `ad${c.signed === 1 ? '' : 's'} ${label}` : label}</span>
          </span>
        ))}
      </div>
      <div className="text-xs text-[#646A75]">{c.options} copy option{c.options === 1 ? '' : 's'} · {c.kept} line{c.kept === 1 ? '' : 's'} kept</div>
      {c.changes > 0 && <div className="text-xs font-semibold text-red-200">{c.changes} ad{c.changes === 1 ? '' : 's'} with changes requested{c.copyChanges ? ` (${c.copyChanges === c.changes ? '' : `${c.copyChanges} `}copy: fix in Build & sign off)` : ''}</div>}
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
