// The worksheet (Brook, 2 Oct; Round 2): the month's copy on one page, the way the Round 1 spreadsheet worked. Tabs
// are the steps; one row is one line with what the check found, a count, and Keep / Cut / Edit. No persona or
// territory to pick first, no runs, angles or tone. It is a view over the same lines the other screens use.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { REGION_NAMES, studio, type Batch, type Line, type Meta, type Region, type WorksheetData, type WsRow, type WsStep } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { personaColor, tint } from '@/lib/personaColors';
import { ForPicker, GhostButton, LineHistory, PersonaDot, PinkButton, Src, angleLabel, useActingFor, when, whoWords } from './ui';

const STEPS: Array<{ key: WsStep; n: number; name: string; what: string }> = [
  { key: 'on_image', n: 1, name: 'On-image copy', what: 'Every headline, subhead and carousel card that sits in the artwork, by persona and asset.' },
  { key: 'primary', n: 2, name: 'Captions', what: 'The shared primary texts and captions: one pool, used under every persona’s assets.' },
  { key: 'headline', n: 3, name: 'Headlines', what: 'The shared headline bank: short lines that work under any caption here.' },
];
const LEVEL: Record<string, string> = { red: 'border-red-500/50 bg-red-500/10 text-red-200', amber: 'border-amber-400/40 bg-amber-400/10 text-amber-200', grey: 'border-[#343946] bg-[#1C1F26] text-[#A3A8B1]' };

export function Worksheet({ meta, region, setRegion, onStep, onChanged }: {
  meta: Meta; region: Region; setRegion: (r: Region) => void;
  /** Steps 4 and 5 are the existing Build and Assets screens. */
  onStep: (step: 'build' | 'assets') => void; onChanged: () => void;
}) {
  const [step, setStep] = useState<WsStep>('on_image');
  const [data, setData] = useState<WorksheetData | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => studio.worksheet(region).then(d => { setData(d); setError(''); }).catch(e => setError(e.message)), [region]);
  useEffect(() => { setData(null); load(); }, [load]);
  const changed = () => { load(); onChanged(); };
  const who = useActingFor();
  const s = STEPS.find(x => x.key === step)!;
  const rows = data?.steps[step] || [];
  const c = data?.counts[step];
  // Step 1 reads persona, then asset; the pools are one list.
  const groups: Array<{ key: string; persona?: string; asset?: string; rows: WsRow[] }> = [];
  for (const x of rows) {
    const key = step === 'on_image' ? `${x.persona}|${x.territory}|${x.region}` : 'pool';
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.rows.push(x); else groups.push({ key, ...(step === 'on_image' ? { persona: x.persona, asset: x.asset } : {}), rows: [x] });
  }
  const regions = meta.regions || ['US', 'CA'];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold">{data?.round_label || 'This month'}: copy worksheet</h1>
          <p className="text-base text-[#A3A8B1]">Everything on one page. One decision per line: keep it, cut it, or edit it.</p>
        </div>
        {regions.length > 1 && (
          <label className="text-sm text-[#858B96]">Region{' '}
            <select aria-label="Region" className="rounded-lg border border-[#343946] bg-[#101216] px-2 py-1.5 text-sm text-[#ECEDEF]" value={region} onChange={e => setRegion(e.target.value as Region)}>
              {regions.map(r => <option key={r} value={r}>{REGION_NAMES[r]}</option>)}
            </select>
          </label>
        )}
        <ForPicker meta={meta} doing="Working" />
        <GhostButton title="The same three steps as a workbook (.xlsx), for Excel or Google Sheets. Import it back from the Export menu." onClick={() => studio.worksheetXlsx(region).catch(e => setError(`Download failed: ${e.message}`))}>Download as a sheet</GhostButton>
      </div>

      {/* The steps, in order. 4 and 5 are the existing screens. */}
      <div role="tablist" aria-label="Steps" className="flex flex-wrap gap-1.5 border-b border-[#272B34] pb-2">
        {STEPS.map(x => {
          const k = data?.counts[x.key];
          return (
            <button key={x.key} role="tab" aria-label={`${x.n} ${x.name}`} aria-selected={step === x.key} onClick={() => setStep(x.key)}
              className={cn('rounded-lg border px-3.5 py-2 text-left text-sm transition', step === x.key ? 'border-[#ECEDEF] bg-[#ECEDEF] text-[#0E0F12]' : 'border-[#343946] text-[#C9CCD2] hover:border-[#6B7280]')}>
              <span className="font-semibold">{x.n} {x.name}</span>
              {k && <span className={cn('ml-2 text-xs', step === x.key ? 'text-[#3A3F4A]' : 'text-[#858B96]')}>{k.kept} kept{k.undecided ? ` · ${k.undecided} to decide` : ''}</span>}
            </button>
          );
        })}
        <button role="tab" aria-selected={false} onClick={() => onStep('build')} className="rounded-lg border border-[#343946] px-3.5 py-2 text-sm font-semibold text-[#C9CCD2] hover:border-[#6B7280]">4 Build ads</button>
        <button role="tab" aria-selected={false} onClick={() => onStep('assets')} className="rounded-lg border border-[#343946] px-3.5 py-2 text-sm font-semibold text-[#C9CCD2] hover:border-[#6B7280]">5 Assets</button>
      </div>

      {error && <p className="rounded-lg border-2 border-red-500/45 bg-red-500/10 px-3 py-2 text-base text-red-200">{error}</p>}
      {!data && !error && <p className="text-base text-[#858B96]">Loading the worksheet…</p>}
      {data && c && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-xl border border-[#272B34] bg-[#16181D] px-4 py-3">
            <span className="text-base text-[#C9CCD2]">{s.what}</span>
            <span className="ml-auto whitespace-nowrap text-sm text-[#A3A8B1]">
              <strong className="text-lg text-[#ECEDEF]">{c.total - c.undecided}</strong> of {c.total} decided · <strong className="text-emerald-300">{c.kept}</strong> kept · {c.cut} cut
              {c.undecided > 0 && <> · <strong className="text-[#ECEDEF]">{c.undecided}</strong> to decide</>}
            </span>
          </div>
          {!rows.length && <p className="rounded-xl border border-dashed border-[#343946] px-4 py-6 text-base text-[#858B96]">No lines here yet for {REGION_NAMES[region]}. {step === 'on_image' ? 'Paste the copy deck in Check copy' : 'Write them in the Shared captions context, or paste them in Check copy'} and they appear as rows.</p>}
          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-[#272B34]">
              <table className="w-full min-w-[820px] border-collapse text-left">
                <thead className="bg-[#16181D] text-xs uppercase tracking-wider text-[#858B96]">
                  <tr>
                    <th className="w-12 px-3 py-2">#</th>
                    {step === 'on_image' && <th className="w-24 px-3 py-2">Where</th>}
                    <th className="px-3 py-2">Line</th>
                    <th className="w-56 px-3 py-2">What the check found</th>
                    <th className="w-20 px-3 py-2 text-right">Count</th>
                    <th className="w-52 px-3 py-2">Your call</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(g => (
                    <Fragment key={g.key}>
                      {g.persona && (
                        <tr style={{ background: tint(personaColor(g.persona).base, 0.1) }}>
                          <td colSpan={6} className="border-t border-[#272B34] px-3 py-1.5 text-sm">
                            <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: personaColor(g.persona).light }}><PersonaDot persona={g.persona} />{(meta.personas[g.persona]?.name || g.persona).replace(/\s*\(.*\)$/, '')}</span>
                            <span className="ml-2 font-semibold text-[#ECEDEF]">{g.asset}</span>
                            {meta.territories[g.rows[0].territory]?.format && <span className="ml-2 text-xs text-[#858B96]">{String(meta.territories[g.rows[0].territory].format).toLowerCase()}</span>}
                          </td>
                        </tr>
                      )}
                      {g.rows.map(x => <Row key={x.id} meta={meta} x={x} step={step} who={who} onChanged={changed} onError={setError} />)}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-sm text-[#A3A8B1]"><span className="font-semibold text-red-200">Red</span> breaks a client rule as written and needs a fix. <span className="font-semibold text-amber-200">Amber</span> is only “have a look”: it is yours to keep as it is. A line with nothing to say is <span className="text-emerald-300">clear</span>.</p>
          {data.other > 0 && <p className="text-xs text-[#646A75]">{data.other} other line{data.other === 1 ? '' : 's'} this month (a persona’s own post copy) {data.other === 1 ? 'is' : 'are'} not on the worksheet: captions and headlines are shared. They are in Review, under Advanced.</p>}
        </>
      )}
    </div>
  );
}

function Row({ meta, x, step, who, onChanged, onError }: { meta: Meta; x: WsRow; step: WsStep; who: string; onChanged: () => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(x.text);
  const [busy, setBusy] = useState('');
  const [details, setDetails] = useState(false);
  const [line, setLine] = useState<Line | null>(null);
  useEffect(() => { if (!editing) setDraft(x.text); }, [x.text, editing]);
  // The details (skeptic's line, angle, structure, history, rule sources) come from the run, only when opened.
  useEffect(() => {
    if (!details) return;
    studio.batch(x.run).then((b: Batch) => setLine(b.lines.find(l => l.id === x.id) || null)).catch(() => setLine(null));
  }, [details, x.run, x.id, x.sha256, x.call]);
  const decide = async (decision: 'keep' | 'cut' | '') => {
    setBusy(decision === 'cut' ? 'Cutting…' : 'Saving…');
    try { await studio.decide(x.run, x.id, { decision }); onChanged(); } catch (e: any) { onError(`${x.n}: ${e.message}`); } finally { setBusy(''); }
  };
  const save = async () => {
    const text = draft.trim();
    if (!text || text === x.text) { setEditing(false); return; }
    setBusy('Saving…');
    try { await studio.decide(x.run, x.id, { decision: 'keep', edited_text: text }); }
    catch (e: any) { onError(`${x.n} was not saved: ${e.message}`); setBusy(''); return; }
    // On the worksheet an edit is a decision: the new wording is kept (as "Rewrite" was on the sheet), then re-checked.
    setEditing(false); onChanged();
    setBusy('Re-checking the new wording…');
    try { await studio.recheck(x.run, x.id); }
    catch (e: any) { onError(`${x.n} was saved but not re-checked: ${e.message}. Its flags are from the old wording; edit it again to re-check.`); }
    finally { setBusy(''); onChanged(); }
  };
  const n = [...(editing ? draft : x.text)].length;
  const over = x.visible > 0 && n > x.visible;
  const cut = x.call === 'cut';
  const cols = step === 'on_image' ? 6 : 5;
  const locked = !!x.signed_off;
  return (
    <>
      <tr className={cn('border-t border-[#272B34] align-top', cut && 'opacity-50')}>
        <td className="px-3 py-3 font-mono text-sm text-[#858B96]">{x.n}</td>
        {step === 'on_image' && <td className="px-3 py-3 text-sm text-[#C9CCD2]">{x.where}</td>}
        <td className="px-3 py-3">
          {editing ? (
            <textarea aria-label={`Edit ${x.n}`} className="w-full rounded-lg border-2 border-[#4A505D] bg-[#101216] p-2 text-base leading-snug" rows={Math.max(2, Math.ceil(draft.length / 60))} value={draft} autoFocus onFocus={e => { const n = e.currentTarget.value.length; e.currentTarget.setSelectionRange(n, n); }}
              onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setEditing(false); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }} />
          ) : <div className={cn('text-base leading-snug text-[#F2F3F5]', cut && 'line-through')}>{x.text}</div>}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-[#646A75]">
            {x.edited && <span>edited</span>}
            {x.signed_off && <span className="text-[#F2C4DA]">signed off in Build</span>}
            {x.decided_by && <span>{cut ? 'cut' : 'decided'} by {whoWords(x.decided_by.split('@')[0], x.decided_for)}</span>}
            {busy && <span className="animate-pulse text-[#F2C4DA]" role="status">{busy}</span>}
            <button onClick={() => setDetails(!details)} aria-expanded={details} className="underline-offset-2 hover:text-[#ECEDEF] hover:underline">{details ? 'hide details' : 'details'}</button>
          </div>
        </td>
        <td className="px-3 py-3">
          <div className="flex flex-wrap gap-1">
            {!x.flags.length && <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[13px] font-medium text-emerald-200">clear</span>}
            {x.flags.map(f => <span key={f.rule} className={cn('rounded-full border px-2.5 py-0.5 text-[13px] font-medium', LEVEL[f.level])} title={`${f.level === 'red' ? 'Red: needs a fix' : f.level === 'amber' ? 'Amber: have a look' : 'A note'}${meta.what_to_do?.[f.rule] ? `. ${meta.what_to_do[f.rule]}` : ''}`}>{f.name}{f.rule === 'NEAR_DUP' && f.detail ? ` ${f.detail}` : ''}</span>)}
          </div>
        </td>
        <td className={cn('whitespace-nowrap px-3 py-3 text-right font-mono text-sm', over ? 'font-bold text-red-300' : 'text-[#858B96]')} title={x.card || /^CAR/i.test(String(meta.territories[x.territory]?.format || '')) ? 'The guide for a carousel card' : step === 'on_image' ? 'The guide for text in the artwork: nothing is cut off' : 'What shows before the feed cuts it off'}>{n}{x.visible ? `/${x.visible}` : ''}</td>
        <td className="px-3 py-3">
          {editing ? (
            <div className="flex flex-wrap gap-1.5">
              <PinkButton className="px-3 py-1.5 text-sm" onClick={save} disabled={!!busy}>Save and check</PinkButton>
              <GhostButton onClick={() => setEditing(false)} disabled={!!busy}>Cancel</GhostButton>
            </div>
          ) : locked ? <span className="text-xs text-[#858B96]">Change it in Build (step 4)</span> : (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Your call on ${x.n}`}>
              <GhostButton active={x.call === 'keep'} disabled={!!busy} onClick={() => decide(x.call === 'keep' ? '' : 'keep')}>Keep</GhostButton>
              <GhostButton active={cut} disabled={!!busy} onClick={() => decide(cut ? '' : 'cut')}>Cut</GhostButton>
              <GhostButton disabled={!!busy || cut} onClick={() => setEditing(true)}>Edit</GhostButton>
            </div>
          )}
        </td>
      </tr>
      {details && (
        <tr className="border-t border-dashed border-[#272B34] bg-[#0E0F12]">
          <td />
          <td colSpan={cols - 1} className="px-3 py-3 text-sm text-[#A3A8B1]">
            {!line ? 'Loading…' : (
              <div className="space-y-2">
                {line.objection && <p><span className="font-semibold text-[#C9CCD2]">What a skeptic would say:</span> <em>{line.objection}</em></p>}
                <p className="text-xs">
                  {line.model === 'human' ? `Written by ${line.added_for || (line.added_by || '').split('@')[0] || 'a person'}` : 'Written by Studio'}
                  {line.angle && line.persona && meta.personas[line.persona] ? ` · angle: ${angleLabel(meta, line.persona, line.angle)}` : ''}{line.structure ? ` · ${String(line.structure).replace(/_/g, ' ')}` : ''}
                  {line.decided_at ? ` · last decided ${when(line.decided_at)}` : ''}{who ? ` · you are working for ${who}` : ''}
                </p>
                {line.flags.length > 0 && (
                  <ul className="space-y-1">
                    {line.flags.map(f => <li key={f.rule}><span className={cn('font-semibold', f.severity === 'compliance' ? 'text-red-200' : f.severity === 'warn' ? 'text-amber-200' : 'text-[#C9CCD2]')}>{f.label}</span>{f.quote ? <> (“{f.quote}”)</> : null}{meta.what_to_do?.[f.rule] ? <> What to do: {meta.what_to_do[f.rule]}</> : null} <Src s={f.source} className="text-xs text-[#646A75]" /></li>)}
                  </ul>
                )}
                <LineHistory line={line} />
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
