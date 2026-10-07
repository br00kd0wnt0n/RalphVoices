// The month's key dates (Brook, 7 Oct): a strip on the board with today marked and the next date obvious, an editor
// for admins (the schedule moves), and the one line Build and Assets show ("R1 feedback due Fri 9 Oct, in 2 days").
// Stored on the month's record (`round.milestones`); the logic is in lib/studioDates.ts.
import { useState } from 'react';
import { studio, type Meta, type Milestone, type Round } from '@/lib/studioApi';
import { dateWords, dayWords, screenDate, strip, todayIso } from '@/lib/studioDates';
import { cn } from '@/lib/utils';
import { GhostButton, PinkButton } from './ui';

const activeRound = (meta: Meta): Round | undefined => meta.rounds?.rounds.find(r => r.id === (meta.rounds!.working || meta.rounds!.active));

/** On Build and Assets: the date that matters to this step (or the next of all), in one line. Nothing when no dates are set. */
export function DateNote({ meta, screen, className }: { meta: Meta; screen: 'build' | 'assets'; className?: string }) {
  const d = screenDate(activeRound(meta)?.milestones, todayIso(), screen);
  if (!d) return null;
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-sm', d.days <= 1 ? 'border-amber-400/50 bg-amber-400/10 text-amber-100' : 'border-[#343946] bg-[#16181D] text-[#C9CCD2]', className)}
      title={`From the month's schedule${d.m.track ? ` (${d.m.track})` : ''}. All the dates are on the board.`}>
      <span aria-hidden>📅</span><span><span className="font-semibold">{d.m.label}</span> {dateWords(d.m.date, todayIso())}, {dayWords(d.days)}</span>
    </span>
  );
}

/** The strip on the board. */
export function KeyDates({ meta, onSaved }: { meta: Meta; onSaved: () => void }) {
  const round = activeRound(meta);
  const [editing, setEditing] = useState(false);
  if (!round) return null;
  const can = !!meta.rounds?.can_edit;
  const today = todayIso();
  const { items, tracks } = strip(round.milestones, today);
  if (editing) return <Editor round={round} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved(); }} />;
  if (!items.length) return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-[#343946] px-4 py-3 text-sm text-[#858B96]">
      <span className="mr-auto">No key dates for this month yet. {can ? 'Add the schedule so everyone sees what is due and when.' : 'An admin adds them.'}</span>
      {can && <GhostButton onClick={() => setEditing(true)}>Add key dates</GhostButton>}
    </div>
  );
  const next = items.find(x => x.state === 'today') || items.find(x => x.state === 'next');
  return (
    <section aria-label="Key dates" className="rounded-xl border border-[#272B34] bg-[#16181D] px-4 py-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#858B96]">Key dates</h2>
        {next
          ? <span className="text-sm text-[#C9CCD2]">Next: <span className="font-semibold text-[#ECEDEF]">{next.label}</span>, {dateWords(next.date, today)} ({dayWords(next.days)})</span>
          : <span className="text-sm text-[#858B96]">Every date has passed.</span>}
        <span className="ml-auto text-xs text-[#646A75]">Today is {dateWords(today)}</span>
        {can && <button className="text-xs text-[#858B96] underline-offset-2 hover:text-[#ECEDEF] hover:underline" onClick={() => setEditing(true)}>edit dates</button>}
      </div>
      <ol className="flex flex-wrap gap-1.5">
        {items.map(x => (
          <li key={x.id} aria-current={x === next ? 'step' : undefined} title={`${x.label}: ${dateWords(x.date, today)}, ${dayWords(x.days)}${x.track ? ` · ${x.track}` : ''}`}
            className={cn('min-w-[7.5rem] flex-1 rounded-lg border px-2.5 py-1.5',
              x.state === 'today' ? 'border-[#D94D8F] bg-[#D94D8F]/15' : x === next ? 'border-amber-400/60 bg-amber-400/10' : x.state === 'past' ? 'border-[#272B34] opacity-55' : 'border-[#343946]')}>
            <div className={cn('text-xs font-semibold', x.state === 'today' ? 'text-[#F2C4DA]' : x === next ? 'text-amber-100' : 'text-[#858B96]')}>
              {dateWords(x.date, today)}{x.state === 'today' ? ' · today' : x === next ? ` · ${dayWords(x.days)}` : x.state === 'past' ? ' · done' : ''}
            </div>
            <div className="text-sm leading-snug text-[#ECEDEF]">{x.label}</div>
            {tracks.length > 1 && x.track && <div className="text-[11px] uppercase tracking-wide text-[#646A75]">{x.track}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Editor({ round, onClose, onSaved }: { round: Round; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<Milestone[]>(round.milestones?.length ? round.milestones : [{ id: '', label: '', date: '' }]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<Milestone>) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  async function save() {
    setBusy(true); setErr('');
    try {
      const milestones = rows.filter(r => r.label.trim() || r.date).map(r => ({ ...r, label: r.label.trim(), track: r.track?.trim() || undefined }));
      await studio.saveRound({ id: round.id, name: round.name, label: round.label, from: round.from, test: round.test, milestones });
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const input = 'rounded border border-[#343946] bg-[#101216] px-2 py-1 text-sm text-[#ECEDEF]';
  return (
    <section aria-label="Edit key dates" className="space-y-2 rounded-xl border-2 border-[#343946] bg-[#16181D] px-4 py-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[#858B96]">Key dates for {round.label || round.name}</h2>
      <p className="text-sm text-[#A3A8B1]">One row per date. “Shown on” puts the date at the top of Build or Assets as well as on the board. Track is optional (statics, video…).</p>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input type="date" aria-label={`Date ${i + 1}`} className={input} value={r.date} onChange={e => set(i, { date: e.target.value })} />
          <input aria-label={`What is due on date ${i + 1}`} placeholder="e.g. R1 feedback due" className={cn(input, 'min-w-[14rem] flex-1')} value={r.label} onChange={e => set(i, { label: e.target.value })} />
          <input aria-label={`Track for date ${i + 1}`} placeholder="track (optional)" className={cn(input, 'w-36')} value={r.track || ''} onChange={e => set(i, { track: e.target.value })} />
          <select aria-label={`Shown on, date ${i + 1}`} className={input} value={r.screen || ''} onChange={e => set(i, { screen: (e.target.value || undefined) as Milestone['screen'] })}>
            <option value="">Board only</option><option value="build">Board and Build</option><option value="assets">Board and Assets</option>
          </select>
          <button aria-label={`Remove date ${i + 1}`} className="px-1 text-[#858B96] hover:text-red-200" onClick={() => setRows(rs => rs.filter((_, k) => k !== i))}>✕</button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <GhostButton onClick={() => setRows(rs => [...rs, { id: '', label: '', date: '' }])}>+ Add a date</GhostButton>
        <span className="mr-auto text-xs text-red-200">{err}</span>
        <GhostButton onClick={onClose} disabled={busy}>Cancel</GhostButton>
        <PinkButton className="px-4 py-1.5 text-sm" onClick={save} disabled={busy}>Save dates</PinkButton>
      </div>
    </section>
  );
}
