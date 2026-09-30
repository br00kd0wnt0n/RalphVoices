// Rounds in the Studio (Brook, 30 Sep): the header's round badge with the
// "this round / all rounds" view, the admin's round settings (in Rules), and the
// Live explainer page. Self-contained, so the Studio page only wires them in.
import { useState } from 'react';
import { getRoundView, roundLabel, setRoundView, studio, type Meta, type RoundViewMode } from '@/lib/studioApi';
import { cn } from '@/lib/utils';

const PINK = '#D94D8F';
const input = 'rounded-lg border-2 border-[#343946] bg-[#101216] px-3 py-1.5 text-base text-[#ECEDEF] placeholder:text-[#646A75]';

/** The active round, and whether the views show only it or every round (test rounds marked). */
export function RoundBadge({ meta, onViewChange }: { meta: Meta | null; onViewChange: (v: RoundViewMode) => void }) {
  const [view, setView] = useState<RoundViewMode>(getRoundView());
  const rs = meta?.rounds;
  if (!rs) return null;
  const active = rs.rounds.find(r => r.id === rs.active);
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span title={`Active round: ${roundLabel(active)}. New runs and sign-offs are stamped with it.${active?.test ? ' A test round is never handed to Add3 or B3.' : ''}`}
        className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold', active?.test ? 'border-amber-400 bg-amber-400/15 text-amber-100' : 'border-[#343946] text-[#C9CCD2]')}>
        {active?.id}{active?.test ? ' TEST' : ''}
      </span>
      <select aria-label="Which rounds to show" className="rounded border border-[#343946] bg-[#101216] px-1 py-0.5 text-xs text-[#C9CCD2]" value={view}
        onChange={e => { const v = e.target.value as RoundViewMode; setRoundView(v); setView(v); onViewChange(v); }}>
        <option value="active">This round</option>
        <option value="all">All rounds</option>
      </select>
    </span>
  );
}

/** Admin: create a round (a test run-through is R0, marked test), and set the active one. */
export function RoundsPanel({ meta, onSaved }: { meta: Meta; onSaved: () => void }) {
  const rs = meta.rounds;
  const [form, setForm] = useState({ id: '', name: '', from: '', test: false });
  const [err, setErr] = useState('');
  if (!rs) return null;
  const act = async (fn: () => Promise<unknown>) => { try { setErr(''); await fn(); onSaved(); } catch (e: any) { setErr(e.message); } };
  return (
    <section className="mb-5 max-w-4xl rounded-xl border border-[#272B34] bg-[#16181D] p-5">
      <h2 className="text-lg font-semibold">Rounds</h2>
      <p className="mb-3 text-sm text-[#A3A8B1]">New runs and sign-offs are stamped with the active round, and every view shows it by default ("All rounds" in the header shows the rest). A <strong>test</strong> round (R0) is for a run-through: it's hidden by default, its codes end in _TEST and are never handed to Add3 or B3, it doesn't use up codes (R1 starts at A) and its taste doesn't feed real rounds. Its spend is real and counts toward the budget.</p>
      <ul className="mb-3 space-y-1.5">
        {rs.rounds.map(r => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 text-base">
            <span className="w-10 font-mono font-semibold">{r.id}</span>
            <span>{r.name}</span>
            {r.test && <span className="rounded-full border border-amber-400 px-2 py-px text-xs text-amber-100">TEST</span>}
            {r.from && <span className="text-sm text-[#858B96]">from {r.from}</span>}
            {r.id === rs.active
              ? <span className="rounded-full border border-emerald-500 px-2 py-px text-xs text-emerald-300">active</span>
              : rs.can_edit && <button className="rounded-lg border border-[#4A505D] px-2 py-0.5 text-sm hover:border-[#ECEDEF]" onClick={() => { if (window.confirm(`Make ${r.id} (${r.name}) the active round? New runs and sign-offs are stamped with it, and views show it.`)) act(() => studio.activateRound(r.id)); }}>Make active</button>}
          </li>
        ))}
      </ul>
      {rs.can_edit ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm text-[#A3A8B1]">Id<br /><input className={cn(input, 'w-20')} placeholder="R2" value={form.id} onChange={e => setForm({ ...form, id: e.target.value })} /></label>
          <label className="text-sm text-[#A3A8B1]">Name<br /><input className={cn(input, 'w-56')} placeholder="Round two" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label className="text-sm text-[#A3A8B1]">From<br /><input type="date" className={input} value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} /></label>
          <label className="flex items-center gap-1.5 pb-2 text-sm text-[#A3A8B1]"><input type="checkbox" className="accent-[#D94D8F]" checked={form.test} onChange={e => setForm({ ...form, test: e.target.checked })} /> Test round</label>
          <button className="rounded-lg px-4 py-2 text-base font-semibold text-white disabled:opacity-40" style={{ background: PINK }} disabled={!form.id || !form.name}
            onClick={() => act(async () => { await studio.saveRound({ ...form, activate: false }); setForm({ id: '', name: '', from: '', test: false }); })}>Add round</button>
        </div>
      ) : <p className="text-sm text-[#858B96]">Rounds are set by an admin.</p>}
      {err && <p className="mt-2 text-sm text-red-200">{err}</p>}
    </section>
  );
}

/** Live results: what the page will show once the first weeks in market are read (B3b). Wording follows B3's calls. */
export function LivePage() {
  return (
    <div className="max-w-3xl space-y-5 text-base leading-relaxed text-[#C9CCD2]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#ECEDEF]" style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>Live results: from the first weeks in market</h1>
        <p className="mt-1 text-sm text-[#858B96]">Coming soon. Nothing is shown here until the first full week after launch.</p>
      </div>
      <section>
        <h2 className="mb-1 text-lg font-semibold text-[#ECEDEF]">What you'll see here</h2>
        <p>Every ad you've signed off, next to what happened to it in market:</p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>Where it stands in its ad set: ahead, behind, tied, keep testing, or too early to call. Each comes with a range, where the true figure most likely sits.</li>
          <li>What you expected at sign-off, shown beside it, so expected versus actual is visible ad by ad.</li>
          <li>Each persona's weekly summary, after Brook's review.</li>
        </ul>
      </section>
      <section>
        <h2 className="mb-1 text-lg font-semibold text-[#ECEDEF]">When</h2>
        <p>Results update weekly, from the first full week after launch. Expect most ads to read "too early to call" at first: a fair read on quotes needs about 20,000 impressions per ad.</p>
      </section>
      <section>
        <h2 className="mb-1 text-lg font-semibold text-[#ECEDEF]">How to read it</h2>
        <p>Ads are compared with the other ads in the same ad set (persona, platform, and US or Canada). "Tied" means the data can't separate them yet. We never call a winner inside a tie. Personas here mean the creative written for that persona. Meta's Advantage+ doesn't let us target personas, so the audience is broad.</p>
      </section>
      <section>
        <h2 className="mb-1 text-lg font-semibold text-[#ECEDEF]">Why the codes matter</h2>
        <p>Results join to your ads by naming code, e.g. <span className="font-mono text-[#ECEDEF]">FAM_SUMMER_ST_A2_US_META</span> (visual A, version 2). An ad only appears here if it runs under its code.</p>
      </section>
    </div>
  );
}
