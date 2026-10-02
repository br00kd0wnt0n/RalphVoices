// Import a filled-in copy worksheet (Brook, 2 Oct): the preview says, row by row, what the sheet would change in
// Studio as it is now; nothing is written until Apply. Decisions are recorded for the person in the "for" picker,
// rewrites are re-checked, new lines are filed and checked. A row changed in Studio since the sheet was exported is
// left alone unless ticked.
import { useEffect, useRef, useState } from 'react';
import { studio, type Meta, type SheetAction, type SheetPreview, type SheetResult, type StudioEvent } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { Chip, ForPicker, GhostButton, PinkButton, useActingFor } from './ui';

const WORD: Record<SheetAction, string> = { keep: 'Keep', cut: 'Cut', rewrite: 'Rewrite', new: 'New line', none: 'No change', conflict: 'Changed in Studio', error: 'Not read' };
const TONE: Record<SheetAction, 'outline' | 'amber' | 'red' | 'grey'> = { keep: 'outline', cut: 'outline', rewrite: 'outline', new: 'outline', none: 'grey', conflict: 'amber', error: 'red' };

export function SheetImport({ meta, file, onClose, onDone }: { meta: Meta | null; file: File; onClose: () => void; onDone: (msg: string) => void }) {
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [accept, setAccept] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<SheetResult | null>(null);
  const who = useActingFor();
  const es = useRef<{ close: () => void } | null>(null);
  useEffect(() => () => es.current?.close(), []);
  useEffect(() => {
    let live = true;
    studio.worksheetPreview(file, accept).then(p => { if (live) { setPreview(p); setError(''); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [file, accept]);
  // A sheet with no row ids: rows that matched nothing by wording are only added as new lines when ticked.
  const [addNew, setAddNew] = useState(false);
  const unmatched = preview?.no_ids ? preview.counts.new : 0;
  const changes = preview ? preview.counts.keep + preview.counts.cut + preview.counts.rewrite + (unmatched && !addNew ? 0 : preview.counts.new) : 0;

  async function apply() {
    if (!preview) return;
    setError(''); setStatus('Starting…');
    try {
      let r;
      try { r = await studio.worksheetApply(file, accept, false, addNew); }
      catch (e: any) {
        if (e.status !== 409 || !e.body?.needs_confirm) throw e;
        if (!window.confirm(`Checking the rewrites and new lines is estimated at $${e.body.estimate.toFixed(2)}, over the $${meta?.ask_over ?? 2} ask-first line. Run it?`)) { setStatus(''); return; }
        r = await studio.worksheetApply(file, accept, true, addNew);
      }
      es.current?.close();
      es.current = studio.events(r.job, (e: StudioEvent) => {
        if (e.type === 'status') setStatus(e.message);
        if (e.type === 'error') { setStatus(''); setError(`The import stopped: ${e.message}. What was written before it stopped is kept; open the sheet again to see what is left.`); }
        if (e.type === 'done') {
          setStatus('');
          const res = e.result as SheetResult;
          setResult(res);
          const a = res.applied;
          onDone(`Worksheet imported${who ? ` for ${who}` : ''}: ${a.keep} kept, ${a.cut} cut, ${a.rewrite} rewritten and re-checked, ${a.new} new line${a.new === 1 ? '' : 's'}${res.failed.length ? `; ${res.failed.length} failed` : ''}.`);
        }
      });
    } catch (e: any) { setStatus(''); setError(e.message); }
  }

  return (
    <div role="dialog" aria-label="Import a filled-in worksheet" className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8">
      <div className="w-full max-w-5xl space-y-4 rounded-xl border border-[#343946] bg-[#101216] p-5 shadow-2xl">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-lg font-semibold">Import a filled-in worksheet</h2>
          <span className="truncate text-sm text-[#858B96]" title={file.name}>{file.name}</span>
          <button onClick={onClose} className="rounded px-2 text-lg text-[#858B96] hover:text-[#ECEDEF]" aria-label="Close">✕</button>
        </div>
        {error && <p className="rounded-lg border-2 border-red-500/45 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
        {!preview && !error && <p className="text-base text-[#858B96]">Reading the sheet…</p>}
        {preview && !result && (
          <>
            <p className="text-sm text-[#C9CCD2]">
              Nothing has been written yet. This is what the sheet would change in Studio as it is now:
              {' '}<strong>{preview.counts.keep}</strong> keep · <strong>{preview.counts.cut}</strong> cut · <strong>{preview.counts.rewrite}</strong> rewrite · <strong>{preview.counts.new}</strong> new
              {preview.counts.conflict > 0 && <> · <span className="text-amber-200">{preview.counts.conflict} changed in Studio since the export</span></>}
              {preview.counts.error > 0 && <> · <span className="text-red-200">{preview.counts.error} not read</span></>}.
              {' '}Rows the sheet leaves as they are aren’t listed.
            </p>
            {preview.matched > 0 && <p className="text-sm text-[#A3A8B1]">{preview.matched} row{preview.matched === 1 ? ' was' : 's were'} matched to {preview.matched === 1 ? 'its line' : 'their lines'} in Studio by wording (the sheet has no row ids).</p>}
            {unmatched > 0 && (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                <input type="checkbox" className="mt-1 accent-[#D94D8F]" checked={addNew} onChange={e => setAddNew(e.target.checked)} />
                <span>{unmatched} row{unmatched === 1 ? '' : 's'} on the sheet matched nothing in Studio by wording (“New line” below). Tick to add {unmatched === 1 ? 'it' : 'them'} as new lines; left unticked, {unmatched === 1 ? 'it is' : 'they are'} skipped.</span>
              </label>
            )}
            {preview.problems.map(x => <p key={x} className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">{x}</p>)}
            {preview.rows.length > 0 && (
              <div className="max-h-[50vh] overflow-auto rounded-lg border border-[#272B34]">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-[#16181D] text-xs uppercase tracking-wider text-[#858B96]"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">What happens</th><th className="px-3 py-2">In Studio now</th><th className="px-3 py-2">From the sheet</th></tr></thead>
                  <tbody>
                    {preview.rows.map(x => (
                      <tr key={`${x.tab}-${x.row}`} className="border-t border-[#272B34] align-top">
                        <td className="whitespace-nowrap px-3 py-2 text-[#C9CCD2]"><span className="font-mono">{x.n || `row ${x.row}`}</span><div className="text-xs text-[#646A75]">{x.tab}</div></td>
                        <td className="px-3 py-2">
                          <Chip tone={TONE[x.action]} className="text-xs">{WORD[x.action]}</Chip>
                          {x.action === 'conflict' && x.id && (
                            <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-xs text-[#C9CCD2]">
                              <input type="checkbox" className="accent-[#D94D8F]" checked={accept.includes(x.id)} onChange={e => setAccept(a => (e.target.checked ? [...a, x.id!] : a.filter(i => i !== x.id)))} />
                              use the sheet’s
                            </label>
                          )}
                          {x.action !== 'conflict' && x.id && accept.includes(x.id) && <button className="mt-1 block text-xs text-[#858B96] underline" onClick={() => setAccept(a => a.filter(i => i !== x.id))}>leave Studio’s wording</button>}
                        </td>
                        <td className="px-3 py-2 text-[#C9CCD2]">{x.now || (x.action === 'new' ? <span className="text-[#646A75]">{[x.territory && meta?.territories[x.territory]?.name?.replace(/\.$/, ''), x.where].filter(Boolean).join(' · ') || 'the shared pool'}</span> : '')}</td>
                        <td className="px-3 py-2">
                          {x.text && <div className="text-[#F2F3F5]">{x.text}{x.chars !== undefined && <span className={cn('ml-2 font-mono text-xs', x.visible && x.chars > x.visible ? 'text-amber-300' : 'text-[#858B96]')}>{x.chars}{x.visible ? `/${x.visible}` : ''}</span>}</div>}
                          {x.note && <div className={cn('text-xs', x.action === 'error' ? 'text-red-200' : x.action === 'conflict' ? 'text-amber-200' : 'text-[#858B96]')}>{x.note}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <span className="mr-auto text-sm text-[#858B96]">
                {preview.estimate.checks > 0 ? `${preview.estimate.checks} line${preview.estimate.checks === 1 ? '' : 's'} to check (each rewrite and new line): about $${preview.estimate.usd.toFixed(2)}${meta?.mock ? ' (mock: free)' : ''}, ${Math.max(1, Math.round(preview.estimate.seconds / 60))} min.` : 'No checks to run.'}
                {status && <span className="ml-2 text-[#ECEDEF]" role="status">{status}</span>}
              </span>
              <ForPicker meta={meta} doing="Recording these" />
              <GhostButton onClick={onClose} disabled={!!status}>Cancel</GhostButton>
              <PinkButton onClick={apply} disabled={!changes || !!status}>{changes ? `Apply ${changes} change${changes === 1 ? '' : 's'}` : 'Nothing to apply'}</PinkButton>
            </div>
          </>
        )}
        {result && (
          <div className="space-y-2 text-base text-[#C9CCD2]">
            <p><strong className="text-[#ECEDEF]">Done.</strong> {result.applied.keep} kept · {result.applied.cut} cut · {result.applied.rewrite} rewritten and re-checked · {result.applied.new} new{result.skipped ? ` · ${result.skipped} left alone` : ''}.</p>
            {result.failed.length > 0 && <ul className="list-disc pl-5 text-sm text-red-200">{result.failed.map(f => <li key={`${f.tab}-${f.n}`}>{f.n} ({f.tab}): {f.error}</li>)}</ul>}
            <div className="text-right"><PinkButton onClick={onClose}>Close</PinkButton></div>
          </div>
        )}
      </div>
    </div>
  );
}
