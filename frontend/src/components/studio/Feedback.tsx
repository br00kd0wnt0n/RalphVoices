// Feedback rounds (Brook, 7 Oct): the client's feedback comes through Add3 as one set of notes per round (R1 on the
// copy, R2 on the complete package). On the board: each round with its dates and how many ads have changes wanted, and
// a panel to enter it (the notes as they came, then a state and note per ad). In Build: the ad's own note, with "Done".
// It is separate from Trupanion's compliance decision in Assets and only informs: nothing is held back by it.
import { useCallback, useEffect, useState } from 'react';
import { studio, type FeedbackAd, type FeedbackState, type FeedbackView, type Meta, type Region } from '@/lib/studioApi';
import { dateWords, todayIso } from '@/lib/studioDates';
import { cn } from '@/lib/utils';
import { ForPicker, GhostButton, PersonaDot, PinkButton, personaKeys, regionLabel, territoryName, whoWords, when } from './ui';

const WORDS: Record<FeedbackState, string> = { none: 'No change', change: 'Change wanted', done: 'Done' };
const TONE: Record<FeedbackState, string> = { none: 'border-[#343946] text-[#A3A8B1]', change: 'border-amber-400/60 bg-amber-400/10 text-amber-100', done: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200' };
const input = 'rounded border border-[#343946] bg-[#101216] px-2 py-1 text-sm text-[#ECEDEF]';
const useFeedback = (region: Region, tick = 0) => {
  const [view, setView] = useState<FeedbackView | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => studio.feedback(region).then(v => { setView(v); setError(''); }).catch(e => setError(e.message)), [region]);
  useEffect(() => { load(); }, [load, tick]);
  return { view, error, load, setError };
};

/** The board's feedback strip, and the panel to enter a round. */
export function FeedbackPanel({ meta, region, onFix }: { meta: Meta; region: Region; onFix: (persona: string, territory: string) => void }) {
  const { view, error, load, setError } = useFeedback(region);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (!view) return error ? <p className="text-sm text-red-200">{error}</p> : null;
  const today = todayIso();
  const nextId = `R${view.reviews.length + 1}`;
  const save = async (review: { id: string; label?: string; sent?: string; received?: string; notes?: string }) => {
    try { await studio.saveFeedbackReview(region, review); await load(); } catch (e: any) { setError(e.message); }
  };
  return (
    <section aria-label="Feedback rounds" className="rounded-xl border border-[#272B34] bg-[#16181D] px-4 py-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#858B96]">Feedback · {regionLabel(region)}</h2>
        {view.summary ? <span className="text-sm text-[#C9CCD2]">{view.summary}</span> : <span className="text-sm text-[#858B96]">No feedback round yet. Add one when a round goes to the client.</span>}
        <span className="ml-auto text-xs text-[#646A75]">The client’s notes per round, through Add3. Separate from Trupanion’s compliance decision in Assets; it doesn’t hold an ad back.</span>
      </div>
      {error && <p className="mb-2 text-sm text-red-200">{error}</p>}
      <div className="flex flex-wrap items-stretch gap-2">
        {view.reviews.map(r => (
          <button key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}
            className={cn('min-w-[13rem] rounded-lg border px-3 py-2 text-left transition hover:border-[#6B7280]', open === r.id ? 'border-[#ECEDEF]' : r.counts.change ? 'border-amber-400/60' : 'border-[#343946]')}>
            <div className="text-sm font-semibold text-[#ECEDEF]">{r.label}</div>
            <div className="text-xs text-[#858B96]">{r.sent ? `Sent ${dateWords(r.sent, today)}` : 'Not sent yet'}{r.received ? ` · feedback in ${dateWords(r.received, today)}` : r.sent ? ' · feedback not in yet' : ''}</div>
            <div className="mt-1 text-sm">
              {r.counts.change > 0 && <span className="mr-2 font-semibold text-amber-200">{r.counts.change} with changes wanted</span>}
              {r.counts.done > 0 && <span className="mr-2 text-emerald-200">{r.counts.done} done</span>}
              {r.counts.none > 0 && <span className="mr-2 text-[#A3A8B1]">{r.counts.none} no change</span>}
              {r.counts.unmarked > 0 && <span className="text-[#646A75]">{r.counts.unmarked} not marked</span>}
              {!view.ads.length && <span className="text-[#646A75]">no ads signed off yet</span>}
            </div>
          </button>
        ))}
        {adding
          ? <span className="flex items-center gap-2 rounded-lg border border-[#343946] px-3 py-2 text-sm">
              <NewReview id={nextId} onSave={async r => { await save(r); setAdding(false); setOpen(r.id); }} onCancel={() => setAdding(false)} />
            </span>
          : <GhostButton className="self-center" onClick={() => setAdding(true)}>+ Feedback round</GhostButton>}
      </div>
      {open && view.reviews.some(r => r.id === open) && <ReviewEditor meta={meta} view={view} id={open} onSave={save} onChanged={load} onError={setError} onFix={onFix} />}
    </section>
  );
}

function NewReview({ id, onSave, onCancel }: { id: string; onSave: (r: { id: string; label: string; sent?: string }) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(`${id} feedback`);
  const [sent, setSent] = useState('');
  return (
    <>
      <input aria-label="Name of the feedback round" className={cn(input, 'w-44')} value={label} onChange={e => setLabel(e.target.value)} />
      <label className="text-xs text-[#858B96]">sent <input type="date" aria-label="Date sent" className={input} value={sent} onChange={e => setSent(e.target.value)} /></label>
      <GhostButton onClick={() => onSave({ id, label: label.trim() || `${id} feedback`, ...(sent ? { sent } : {}) })}>Add</GhostButton>
      <button className="text-xs text-[#858B96]" onClick={onCancel}>cancel</button>
    </>
  );
}

function ReviewEditor({ meta, view, id, onSave, onChanged, onError, onFix }: {
  meta: Meta; view: FeedbackView; id: string; onSave: (r: { id: string; label?: string; sent?: string; received?: string; notes?: string }) => Promise<void>;
  onChanged: () => void; onError: (m: string) => void; onFix: (persona: string, territory: string) => void;
}) {
  const r = view.reviews.find(x => x.id === id)!;
  const [sent, setSent] = useState(r.sent || '');
  const [received, setReceived] = useState(r.received || '');
  const [notes, setNotes] = useState(r.notes || '');
  useEffect(() => { setSent(r.sent || ''); setReceived(r.received || ''); setNotes(r.notes || ''); }, [id, r.sent, r.received, r.notes]);
  const dirty = sent !== (r.sent || '') || received !== (r.received || '') || notes !== (r.notes || '');
  const order = personaKeys(meta.personas);
  const ads = [...view.ads].sort((a, b) => order.indexOf(a.persona) - order.indexOf(b.persona) || a.ad.localeCompare(b.ad));
  return (
    <div className="mt-3 space-y-3 border-t border-[#272B34] pt-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-[#858B96]">Sent to the client<br /><input type="date" aria-label="Date sent" className={input} value={sent} onChange={e => setSent(e.target.value)} /></label>
        <label className="text-xs text-[#858B96]">Feedback received<br /><input type="date" aria-label="Date feedback was received" className={input} value={received} onChange={e => setReceived(e.target.value)} /></label>
        <ForPicker meta={meta} doing="Entering feedback" className="mb-1" />
        <PinkButton className="ml-auto px-4 py-1.5 text-sm" disabled={!dirty} onClick={() => onSave({ id, sent, received, notes })}>Save the round</PinkButton>
      </div>
      <label className="block text-xs text-[#858B96]">The notes as they came (paste Add3’s consolidated feedback here, then mark each ad below)
        <textarea aria-label="The feedback notes as received" rows={notes ? Math.min(10, Math.max(3, notes.split('\n').length + 1)) : 3} className={cn(input, 'mt-1 block w-full text-sm leading-relaxed')} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Paste the notes for this round…" />
      </label>
      {!ads.length && <p className="text-sm text-[#858B96]">No ads are signed off in {regionLabel(view.region)} yet: feedback is recorded against signed-off ads.</p>}
      {ads.length > 0 && (
        <table className="w-full border-collapse text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-[#858B96]"><tr><th className="py-1 pr-3">Ad</th><th className="w-[21rem] py-1 pr-3">This round</th><th className="py-1">Note for this ad</th><th className="w-28" /></tr></thead>
          <tbody>{ads.map(a => <AdRow key={a.ad} meta={meta} a={a} review={id} onChanged={onChanged} onError={onError} onFix={onFix} />)}</tbody>
        </table>
      )}
    </div>
  );
}

function AdRow({ meta, a, review, onChanged, onError, onFix }: { meta: Meta; a: FeedbackAd; review: string; onChanged: () => void; onError: (m: string) => void; onFix: (persona: string, territory: string) => void }) {
  const cur = a.items[review];
  const [note, setNote] = useState(cur?.note || '');
  useEffect(() => { setNote(cur?.note || ''); }, [cur?.note, review]);
  const set = async (state: FeedbackState) => { try { await studio.setAdFeedback(a.ad, review, state, note.trim()); onChanged(); } catch (e: any) { onError(e.message); } };
  return (
    <tr className="border-t border-[#272B34] align-top">
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1.5 font-semibold text-[#ECEDEF]"><PersonaDot persona={a.persona} />{territoryName(meta.territories[a.territory]).replace(/\.$/, '') || a.territory}</div>
        <div className="font-mono text-xs text-[#646A75]">{a.ad}</div>
      </td>
      <td className="py-2 pr-3">
        <div role="group" aria-label={`Feedback on ${a.ad}`} className="flex flex-wrap gap-1.5">
          {(['none', 'change', 'done'] as const).map(s => (
            <button key={s} aria-pressed={cur?.state === s} onClick={() => set(s)} className={cn('rounded-full border px-2.5 py-0.5 text-[13px] font-medium transition', cur?.state === s ? TONE[s] : 'border-[#343946] text-[#858B96] hover:text-[#ECEDEF]')}>{WORDS[s]}</button>
          ))}
        </div>
        {cur && <div className="mt-1 text-xs text-[#646A75]">{whoWords((cur.by || '').split('@')[0], cur.for)}, {when(cur.at)}</div>}
      </td>
      <td className="py-2">
        <textarea aria-label={`Note for ${a.ad}`} rows={note.length > 90 ? 3 : 1} className={cn(input, 'block w-full')} placeholder="What the client asked for on this ad" value={note} onChange={e => setNote(e.target.value)}
          onBlur={() => { if (cur && note.trim() !== (cur.note || '')) set(cur.state); }} />
        {!cur && note.trim() && <div className="mt-0.5 text-xs text-[#858B96]">Choose a state to save the note.</div>}
      </td>
      <td className="py-2 pl-3 text-right">{cur?.state === 'change' && <GhostButton className="whitespace-nowrap" onClick={() => onFix(a.persona, a.territory)}>Fix in Build</GhostButton>}</td>
    </tr>
  );
}

/** In Build: the feedback on this asset's ads, newest round first, with "Done" on a change. Nothing when there is none. */
export function FeedbackNote({ region, persona, territory }: { region: Region; persona: string; territory: string }) {
  const { view, load, setError, error } = useFeedback(region);
  if (!view) return null;
  const rows = view.ads.filter(a => a.persona === persona && a.territory === territory)
    .flatMap(a => [...view.reviews].reverse().map(r => ({ a, r, item: a.items[r.id] })).filter(x => x.item && (x.item.state !== 'none' || x.item.note)));
  if (!rows.length) return null;
  const done = async (ad: string, review: string) => { try { await studio.setAdFeedback(ad, review, 'done'); await load(); } catch (e: any) { setError(e.message); } };
  return (
    <section aria-label="Client feedback" className="space-y-1.5">
      {rows.map(({ a, r, item }) => (
        <div key={`${a.ad}${r.id}`} className={cn('flex flex-wrap items-start gap-3 rounded-xl border px-4 py-2.5 text-sm', item!.state === 'change' ? 'border-amber-400/60 bg-amber-400/10 text-amber-50' : 'border-[#272B34] bg-[#16181D] text-[#A3A8B1]')}>
          <span className="mr-auto min-w-0">
            <span className="font-semibold">{r.label}: {WORDS[item!.state].toLowerCase()}</span>
            {item!.note ? <span> · “{item!.note}”</span> : null}
            <span className="ml-2 text-xs opacity-70">{whoWords((item!.by || '').split('@')[0], item!.for)}, {when(item!.at)}</span>
          </span>
          {item!.state === 'change' && <GhostButton onClick={() => done(a.ad, r.id)} title="The change is made here in Build; sign off again for it to count">Mark done</GhostButton>}
        </div>
      ))}
      {error && <p className="text-xs text-red-200">{error}</p>}
    </section>
  );
}
