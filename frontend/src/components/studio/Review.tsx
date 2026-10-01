// Step 2, Review: every line with its flags and the skeptic's objection; what you keep collects in the Kept tray,
// grouped by field (the old Shortlist), with Cut and Undo. No codes here: they're given at Build & sign off.
import { useEffect, useMemo, useState } from 'react';
import { roundName, studio, finalText, isEdited, type Batch, type Line, type Meta, type RunSummary, type ShortRow } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { personaEdge } from '@/lib/personaColors';
import { Chip, GhostButton, Intro, Label, LineHistory, Overrides, PINK, PersonaChip, PinkButton, Src, chipName, fieldOrder, flagName, params, plainSource, regionOf, sameCtx, sevTone, territoryName, toneWords, when, whatToDo, type Ctx } from './ui';

type Filter = 'all' | 'compliance' | 'open' | 'kept';
const shortField = (meta: Meta, f: string) => (meta.fields[f]?.label || f).replace(/^(Meta|TikTok) /, '').replace(/\s*\(.*\)$/, '').replace(/^./, c => c.toUpperCase());

export function Review({ meta, ctx, batch, setBatch, status, running, onMore, onMoreRun, onAddLine, onDecided, onBuild, initialFilter }: {
  meta: Meta; ctx: Ctx; batch: Batch | null; setBatch: React.Dispatch<React.SetStateAction<Batch | null>>; status: string; running: boolean;
  onMore: (l: Line, note: string) => void; onMoreRun: () => void; onAddLine: (text: string, field: string) => Promise<void>; onDecided: () => void; onBuild: () => void;
  initialFilter?: Filter;
}) {
  const [filter, setFilter] = useState<Filter>(initialFilter || 'all');
  const [group, setGroup] = useState<'field' | 'angle' | 'structure'>('field');
  // Lines decided while a filter is on stay where they are until the filter or grouping changes (no jumping under the cursor).
  const [stay, setStay] = useState<Set<string>>(new Set());
  useEffect(() => { setStay(new Set()); }, [filter, group, batch?.id]);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  // Refetched when a job ends or the open run grows (generate, more like this, add a line), so the picker's counts are current.
  useEffect(() => { studio.batches().then(setRuns).catch(() => setRuns([])); }, [batch?.id, running, batch?.lines.length]);
  const here = (runs || []).filter(r => sameCtx(r, ctx));
  // The open run follows the context: the latest run for it, or none.
  const matches = !!batch && sameCtx(batch.brief, ctx);
  useEffect(() => {
    if (matches || !runs) return;
    if (here[0]) studio.batch(here[0].id).then(setBatch).catch(() => {});
    else setBatch(null);
  }, [ctx.persona, ctx.territory, ctx.region, runs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [kept, setKept] = useState(0);

  const b = matches ? batch : null;
  const lines = b?.lines || [];
  const yours = lines.filter(l => l.model === 'human').length;
  const checked = lines.filter(l => l.status === 'checked').length;
  const overBy = (l: Line) => Math.max(0, [...finalText(l)].length - (meta.fields[l.field]?.visible ?? Infinity));
  const shown = lines.filter(l => stay.has(l.id) || (filter === 'all' ? true : filter === 'compliance' ? l.flags.some(f => f.severity === 'compliance') : filter === 'open' ? !l.decision : true));
  const ranked = shown.map((l, i) => ({ l, i })).sort((a, c) => Number(overBy(a.l) > 0) - Number(overBy(c.l) > 0) || overBy(a.l) - overBy(c.l) || a.i - c.i).map(x => x.l);
  const groups = new Map<string, Line[]>();
  for (const l of ranked) {
    const k = group === 'field' ? shortField(meta, l.field) : group === 'angle' ? `Angle: ${l.angle_label}` : `Structure: ${l.structure.replace('_', ' ')}`;
    groups.set(k, [...(groups.get(k) || []), l]);
  }
  const ordered = group === 'field' ? [...groups.entries()].sort((x, y) => fieldOrder(meta, x[1][0].field) - fieldOrder(meta, y[1][0].field)) : [...groups.entries()];
  const replace = (l: Line) => setBatch(cur => (cur ? { ...cur, lines: cur.lines.map(x => (x.id === l.id ? l : x)) } : cur));
  const counts = { all: lines.length, compliance: lines.filter(l => l.flags.some(f => f.severity === 'compliance')).length, open: lines.filter(l => !l.decision).length };

  return (
    <div className="space-y-5">
      <Intro title="Review" line="Keep, cut or edit; what you keep collects in the Kept tray, by field."
        right={<PinkButton className="px-4 py-2 text-base" onClick={onBuild}>Build & sign off →</PinkButton>}>
        <p>Each line shows its flags (click one for the rule, the quote, what to do and the source) and a skeptic’s objection. Length, structure, tone and tags are behind “details”.</p>
        <p>Lines that run past what shows on screen are listed last. Kept lines from every run for this persona and territory are in the Kept tray; the Google Sheets round trip is in the Export menu.</p>
      </Intro>

      <div className="flex flex-wrap items-center gap-2">
        {([['all', 'All', counts.all], ['compliance', 'Compliance flags', counts.compliance], ['open', 'Undecided', counts.open], ['kept', 'Kept', kept]] as const).map(([k, l, n]) => (
          <GhostButton key={k} active={filter === k} onClick={() => setFilter(k)} className={cn('text-base', k === 'kept' && filter !== k && 'border-emerald-500/50 text-emerald-200')}>{l}{filter === 'kept' && k !== 'kept' ? '' : ` (${n})`}</GhostButton>
        ))}
        {filter !== 'kept' && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold uppercase text-[#858B96]">Group</span>
            {(['field', 'angle', 'structure'] as const).map(g => <GhostButton key={g} active={group === g} onClick={() => setGroup(g)}>{g[0].toUpperCase() + g.slice(1)}</GhostButton>)}
          </span>
        )}
      </div>

      {filter === 'kept' ? <KeptTray meta={meta} ctx={ctx} onCount={setKept} /> : (
        <>
          <KeptCount ctx={ctx} tick={lines.filter(l => l.decision === 'keep' || l.decision === 'edit').length} onCount={setKept} />
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#272B34] bg-[#16181D] px-4 py-3">
            <div className="mr-auto min-w-0">
              <div className="flex items-center gap-2"><Label>Run</Label><PersonaChip meta={meta} persona={ctx.persona} short className="mb-1.5" /></div>
              {b || here.length ? (
                <select aria-label="Run" className="max-w-full rounded-lg border-2 border-[#343946] bg-[#101216] px-3 py-1.5 text-base" value={b?.id || ''} onChange={e => studio.batch(e.target.value).then(setBatch)}>
                  {!b && <option value="">Choose a run…</option>}
                  {/* The open run is described from the run itself (its lines arrive live), never from the list fetched earlier. */}
                  {[...here.map(r => (b && r.id === b.id ? { ...r, lines: b.lines.length, updated: b.updated || r.updated } : r)), ...(b && !here.some(r => r.id === b.id) ? [{ id: b.id, updated: b.updated || b.created, created_by: b.created_by || '', lines: b.lines.length } as RunSummary] : [])].map(r => (
                    <option key={r.id} value={r.id} title={r.id}>{when(r.updated)}{r.created_by ? ` · ${r.created_by.split('@')[0]}` : ''} · {r.lines} lines{r.round && r.round !== (meta.rounds?.working || meta.rounds?.active) ? ` · ${roundName(meta.rounds, r.round)}` : ''}</option>
                  ))}
                </select>
              ) : <p className="text-base text-[#858B96]">No runs for {territoryName(meta.territories[ctx.territory]).replace(/\.$/, '')} yet: write lines on Write.</p>}
              {b && <div className="mt-1 text-sm text-[#858B96]">{checked} of {lines.length} checked{yours ? ` · ${yours} yours` : ''} · writer {b.brief.model}{b.stats.near_duplicates_removed ? ` · ${b.stats.near_duplicates_removed} near-duplicates removed` : ''}</div>}
              {b && <DroppedNote meta={meta} batch={b} />}
            </div>
            {b && <GhostButton className="text-base" disabled={running} onClick={onMoreRun}>{yours ? 'Generate around your lines' : 'Generate more in this run'}</GhostButton>}
          </div>
          {running && (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded bg-[#272B34]"><div className="h-full transition-all" style={{ width: `${lines.length ? (100 * checked) / lines.length : 5}%`, background: PINK }} /></div>
              <div className="text-sm text-[#858B96]">{status}</div>
            </div>
          )}
          {b && <AddLine meta={meta} batch={b} running={running} onAdd={onAddLine} />}
          {ordered.map(([g, ls]) => (
            <section key={g}>
              <h2 className="mb-3 mt-2 text-lg font-bold first-letter:uppercase">{g} <span className="font-normal text-[#858B96]">({ls.length})</span></h2>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {ls.map(l => <LineCard key={l.id} meta={meta} line={l} sequence={l.sequence_id ? lines.filter(x => x.sequence_id === l.sequence_id) : undefined} onChange={x => { if (filter !== 'all') setStay(cur => new Set(cur).add(x.id)); replace(x); onDecided(); }} onMore={onMore} />)}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

/** Keeps the Kept count on the filter button current without showing the tray. */
function KeptCount({ ctx, tick, onCount }: { ctx: Ctx; tick: number; onCount: (n: number) => void }) {
  useEffect(() => { studio.shortlist().then(rows => onCount(rows.filter(r => sameCtx(r, ctx)).length)).catch(() => {}); }, [ctx.persona, ctx.territory, ctx.region, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** A blank slot in Review for a new idea mid-review, without starting a new run (Nick, 29 Sep). */
function AddLine({ meta, batch, running, onAdd }: { meta: Meta; batch: Batch; running: boolean; onAdd: (text: string, field: string) => Promise<void> }) {
  const fields = batch.brief.fields?.length ? batch.brief.fields : Object.keys(meta.fields);
  const [text, setText] = useState('');
  const [field, setField] = useState(fields[0]);
  const [busy, setBusy] = useState(false);
  const f = meta.fields[field];
  const n = [...text.trim()].length;
  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    try { await onAdd(text.trim(), field); setText(''); } catch { /* shown above */ } finally { setBusy(false); }
  }
  return (
    <section className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-dashed border-[#4A505D] bg-[#16181D] p-3" title="Goes into this run as your line, checked like the ones you write first">
      <span className="text-sm font-semibold uppercase tracking-wider text-[#858B96]">Add a line</span>
      <input aria-label="A new line for this run" className="min-w-0 flex-1 rounded-lg border-2 border-[#343946] px-3 py-2 text-lg sm:min-w-[18rem]" placeholder="A new idea for this run…" value={text}
        onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
      <select aria-label="Field for the new line" value={field} onChange={e => setField(e.target.value)} className="rounded-lg border-2 border-[#343946] bg-[#101216] px-2 py-2 text-sm">
        {fields.map(k => <option key={k} value={k}>{meta.fields[k]?.label || k}</option>)}
      </select>
      <span className={cn('w-14 text-right font-mono text-sm', f && n > f.visible ? 'font-bold text-amber-300' : 'text-[#858B96]')}>{n}/{f?.visible}</span>
      <PinkButton className="px-4 py-2 text-base" disabled={!text.trim() || busy || running} onClick={add} title={running ? 'Wait for the current checks to finish' : undefined}>Add and check</PinkButton>
    </section>
  );
}

/** Lines Studio wrote and threw away before showing them (a hard rule broken, or a headline or hook too long), and why. */
function DroppedNote({ meta, batch }: { meta: Meta; batch: Batch }) {
  const [open, setOpen] = useState(false);
  const gone = (batch.dropped || []).filter(d => d.reason);
  if (!gone.length) return null;
  const long = gone.filter(d => d.rule === 'LIMIT_VISIBLE').length, cliche = gone.filter(d => d.rule === 'CA_CLICHE').length, rule = gone.length - long - cliche;
  return (
    <div className="mt-1 text-sm text-[#858B96]">
      <button className="underline-offset-2 hover:text-[#ECEDEF] hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>
        {gone.length} written line{gone.length === 1 ? '' : 's'} dropped before you saw {gone.length === 1 ? 'it' : 'them'}: {[rule ? `broke a client rule (${rule})` : '', long ? `too long for the field (${long})` : '', cliche ? `a Canadian cliché (${cliche})` : ''].filter(Boolean).join(', ')}
      </button>
      {open && (
        <ul className="mt-1 space-y-1 border-l-2 border-[#343946] pl-3">
          {gone.map((d, i) => <li key={i}><span className="text-[#C9CCD2]">“{d.text}”</span> <span className="text-xs">({d.field ? `${shortField(meta, d.field)}: ` : ''}{d.reason})</span></li>)}
        </ul>
      )}
    </div>
  );
}

/** A lighter card: the line, its flags, the skeptic and the actions. Length, structure, tone and tags behind "details"; the note opens on demand. */
function LineCard({ meta, line, sequence, onChange, onMore }: { meta: Meta; line: Line; sequence?: Line[]; onChange: (l: Line) => void; onMore: (l: Line, note: string) => void }) {
  const [open, setOpen] = useState<string | null>(params.get('open') === line.id.split('-').pop() ? line.flags[0]?.rule ?? null : null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.edited_text || line.text);
  const [note, setNote] = useState(line.note || '');
  const [noteOpen, setNoteOpen] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => { setNote(line.note || ''); }, [line.note]);
  const f = meta.fields[line.field];
  // Decisions wait for the checks: keeping a line before its flags arrive is how a red line got kept by accident.
  const checking = line.status !== 'checked';
  const text = finalText(line);
  const edited = isEdited(line);
  const kept = line.decision === 'keep' || line.decision === 'edit';
  const chars = [...text].length;
  const over = f && chars > f.visible;
  const openFlag = line.flags.find(x => x.rule === open);
  const decide = async (patch: Partial<Pick<Line, 'decision' | 'edited_text' | 'note'>>) => onChange(await studio.decide(line.batch, line.id, patch));
  // The model's flags were found on the old wording: the new wording is re-checked straight away (a one-line check).
  const [recheck, setRecheck] = useState('');
  const saveEdit = async () => {
    setRecheck('Re-checking the new wording…');
    try {
      onChange(await studio.editAndRecheck(line.batch, line.id, draft, l => { onChange(l); setEditing(false); }));
      setRecheck('');
    } catch (e: any) { setRecheck(`Not re-checked yet: ${e.message}. Its flags are from the original wording.`); }
  };
  const border = kept ? 'border-emerald-500' : line.decision === 'cut' ? 'border-[#343946] opacity-50' : line.model === 'human' ? 'border-[#D94D8F]/60' : 'border-[#272B34]';

  return (
    <div className={cn('rounded-xl border-2 border-l-4 bg-[#16181D] p-5', border)} style={personaEdge(line.persona)}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-[#858B96]">
        {line.model === 'human' && <Chip tone="outline" className="border-[#D94D8F] font-semibold text-[#D94D8F]">yours</Chip>}
        <span>{shortField(meta, line.field)}</span>
        {over && <span className="font-mono font-bold text-amber-300" title={`${f!.visible} characters show on screen`}>{chars}/{f!.visible}</span>}
        {line.parent && <Chip tone="outline">more like {line.parent.split('-').pop()}</Chip>}
        {line.sequence_id && <Chip tone="outline" title="A carousel card sequence: keep it whole or card by card; the cards are placed at Build & sign off">card {line.card} of {sequence?.length || '?'} · sequence S{line.sequence_id.split('-S').pop()}</Chip>}
        {checking && <span className="animate-pulse" style={{ color: PINK }}>flags still arriving…</span>}
        {recheck && <span className={cn(/^Re-checking/.test(recheck) && 'animate-pulse')} style={{ color: /^Re-checking/.test(recheck) ? PINK : undefined }}>{recheck}</span>}
        {line.ready && !line.ready.superseded_by && <Chip tone="outline" className="border-[#D94D8F]/60 text-[#F2C4DA]" title={`Signed off by ${line.ready.ready_by}, ${when(line.ready.ready_at)}`}>signed off{line.ready.changed_since ? ' · edited since' : ''}</Chip>}
        <button onClick={() => setDetails(!details)} aria-expanded={details} className="ml-auto text-xs text-[#646A75] underline-offset-2 hover:text-[#ECEDEF] hover:underline">{details ? 'hide details' : 'details'}</button>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea className="w-full rounded-lg border-2 border-[#4A505D] p-3 text-[22px] leading-snug" rows={3} value={draft} onChange={e => setDraft(e.target.value)} autoFocus />
          <div className="flex gap-2">
            <PinkButton className="px-4 py-2 text-base" onClick={saveEdit}>Save edit</PinkButton>
            <GhostButton onClick={() => setEditing(false)}>Cancel</GhostButton>
            <span className="self-center font-mono text-sm text-[#858B96]">{[...draft].length}/{f?.visible}</span>
          </div>
        </div>
      ) : <p className="text-[22px] leading-snug text-[#F2F3F5]">{text}</p>}
      {edited && !editing && (
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <p className="text-base text-[#858B96] line-through">{line.text}</p>
          <button className="text-sm text-[#A3A8B1] underline-offset-2 hover:text-[#ECEDEF] hover:underline" disabled={checking} title="Go back to the original wording (the edit is kept in the history)"
            onClick={() => decide({ edited_text: '', decision: kept ? 'keep' : line.decision })}>Revert to original</button>
        </div>
      )}

      {line.flags.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {line.flags.map(fl => (
            <Chip key={fl.rule} tone={sevTone(fl.severity)} className="cursor-pointer" title={`${fl.label}${fl.quote ? `\n"${fl.quote}"` : ''}\nSource: ${plainSource(fl.source)}`} onClick={() => setOpen(open === fl.rule ? null : fl.rule)}>
              {fl.rule === 'LIMIT_VISIBLE' && f ? `cut off after ${f.visible} characters` : fl.rule === 'LIMIT_MAX' && f ? `too long (max ${f.max})` : flagName(fl)}
            </Chip>
          ))}
        </div>
      )}
      {openFlag && (
        <div className={cn('mt-2 rounded-lg border p-3 text-base', openFlag.severity === 'compliance' ? 'border-red-500/45 bg-red-500/10' : openFlag.severity === 'warn' ? 'border-amber-400/40 bg-amber-400/10' : 'border-[#272B34] bg-[#0E0F12]')}>
          <div className="font-semibold">{openFlag.label}</div>
          {openFlag.quote && <div className="mt-1">In the line: <mark className="bg-amber-400/30 px-1 text-amber-50">{openFlag.quote}</mark></div>}
          {openFlag.why && <div className="mt-1 text-[#A3A8B1]">{openFlag.why}</div>}
          {whatToDo(openFlag.rule, f) && <div className="mt-1"><span className="font-semibold">What to do:</span> {whatToDo(openFlag.rule, f)}</div>}
          <div className="mt-1 text-sm text-[#858B96]">Source: <Src s={openFlag.source} />{details && <span className="ml-2 text-xs">found by {openFlag.by.join(' + ')}{openFlag.p !== undefined ? ` · P(yes) ${openFlag.p}` : ''} · {openFlag.source}</span>}</div>
        </div>
      )}
      {line.objection && <p className="mt-3 border-l-4 border-[#343946] pl-3 text-base italic text-[#A3A8B1]">Skeptic: {line.objection}</p>}
      <Overrides line={line} />
      {line.note && !noteOpen && <p className="mt-2 text-sm text-[#A3A8B1]"><span className="text-[#646A75]">Note:</span> {line.note}</p>}

      {details && (
        <div className="mt-3 space-y-2 rounded-lg border border-[#272B34] bg-[#0E0F12] p-3 text-sm text-[#A3A8B1]">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <span className={cn('font-mono', over && 'font-bold text-amber-300')}>{chars} chars · {f?.visible} visible · {f?.max} max</span>
            <span>Structure: {line.structure.replace('_', ' ')}</span>
            <span>Tone: {toneWords(line.tone, meta) || line.tone_label}</span>
            <span>Angle: {line.angle_label}</span>
            {line.decided_by && line.decision && <span>{line.decision} · {line.decided_by}{line.decided_at ? ` · ${when(line.decided_at)}` : ''}</span>}
          </div>
          {line.features.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs uppercase tracking-wider text-[#646A75]">Tags</span>
              {line.features.map(x => <span key={x} className="rounded border border-dashed border-[#343946] px-1.5 py-px text-xs">{x.replace(/_/g, ' ')}</span>)}
            </div>
          )}
          <LineHistory line={line} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <GhostButton active={kept} disabled={checking} title={checking ? 'Flags still arriving' : edited ? 'Keeps your edited wording (Cut or Revert to original to change that)' : undefined} onClick={() => decide({ decision: kept && !edited ? '' : 'keep' })}>{kept && edited ? 'Kept (edited)' : kept ? 'Kept' : 'Keep'}</GhostButton>
        <GhostButton active={line.decision === 'cut'} disabled={checking} title={checking ? 'Flags still arriving' : undefined} onClick={() => decide({ decision: line.decision === 'cut' ? '' : 'cut' })}>Cut</GhostButton>
        <GhostButton active={edited} disabled={checking} title={checking ? 'Flags still arriving' : undefined} onClick={() => { setDraft(line.edited_text || line.text); setEditing(true); }}>Edit</GhostButton>
        <GhostButton onClick={() => onMore(line, note)} title="Writes three siblings, using the note as guidance">More like this</GhostButton>
        {sequence && sequence.length > 1 && sequence.some(x => x.decision !== 'keep' && x.decision !== 'edit') && (
          <GhostButton disabled={sequence.some(x => x.status !== 'checked')} title="Keep every card of this sequence (cards you edited keep the edit)"
            onClick={async () => { for (const x of [...sequence].sort((a, b) => (a.card || 0) - (b.card || 0))) if (x.decision !== 'keep' && x.decision !== 'edit') onChange(await studio.decide(x.batch, x.id, { decision: 'keep' })); }}>
            Keep the whole sequence
          </GhostButton>
        )}
        <GhostButton active={noteOpen} onClick={() => setNoteOpen(!noteOpen)} title="Why; guides 'more like this'">{line.note ? 'Edit note' : 'Note'}</GhostButton>
      </div>
      {noteOpen && (
        <input autoFocus className="mt-2 w-full rounded-lg border-2 border-[#272B34] px-3 py-1.5 text-base" placeholder="Note (why; guides 'more like this')" value={note}
          onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          onBlur={() => { if (note !== (line.note || '')) decide({ note }); setNoteOpen(false); }} />
      )}
    </div>
  );
}

// ---------- the Kept tray (was the Shortlist): kept lines for this persona × territory × region, by field ----------

function KeptTray({ meta, ctx, onCount }: { meta: Meta; ctx: Ctx; onCount: (n: number) => void }) {
  const [rows, setRows] = useState<ShortRow[] | null>(null);
  const [msg, setMsg] = useState('');
  // The last lines cut here, newest first, so a cut can be undone (it goes back to keep or edit, as it was).
  const [cut, setCut] = useState<Array<{ row: ShortRow; prev: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => studio.shortlist().then(all => { const r = all.filter(x => sameCtx(x, ctx)); setRows(r); onCount(r.length); }).catch(e => setMsg(e.message));
  useEffect(() => { load(); }, [ctx.persona, ctx.territory, ctx.region]); // eslint-disable-line react-hooks/exhaustive-deps
  async function cutRow(r: ShortRow) {
    if (!r.batch) return;
    setBusy(r.id); setMsg('');
    try {
      await studio.decide(r.batch, r.id, { decision: 'cut', source: 'shortlist' });
      setCut(cur => [{ row: r, prev: r.decision || 'keep' }, ...cur].slice(0, 5));
      await load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(null); }
  }
  async function undo(x: { row: ShortRow; prev: string }) {
    setBusy(x.row.id);
    try {
      await studio.decide(x.row.batch!, x.row.id, { decision: x.prev as Line['decision'] });
      setCut(cur => cur.filter(y => y.row.id !== x.row.id));
      await load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(null); }
  }
  const byField = useMemo(() => {
    const m = new Map<string, ShortRow[]>();
    for (const r of rows || []) m.set(r.field, [...(m.get(r.field) || []), r]);
    return [...m.entries()].sort((a, b) => fieldOrder(meta, a[0]) - fieldOrder(meta, b[0]));
  }, [rows, meta]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-[#A3A8B1]"><PersonaChip meta={meta} persona={ctx.persona} /> <span>{territoryName(meta.territories[ctx.territory])}{regionOf(ctx) === 'CA' ? ' · Canada' : ''}: kept lines from every run, by field</span></div>
      {msg && <div className="rounded-lg border border-red-500/45 bg-red-500/10 p-3 text-base text-red-200">{msg}</div>}
      {cut.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-[#343946] bg-[#16181D] p-3 text-base">
          {cut.map(x => (
            <div key={x.row.id} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[#C9CCD2]">Cut: <span className="text-sm text-[#858B96]">{shortField(meta, x.row.field)}</span> · {x.row.text}</span>
              <GhostButton disabled={busy === x.row.id} onClick={() => undo(x)}>Undo</GhostButton>
            </div>
          ))}
        </div>
      )}
      {rows && !rows.length && <div className="text-base text-[#858B96]">Nothing kept yet for {territoryName(meta.territories[ctx.territory]).replace(/\.$/, '')}{regionOf(ctx) === 'CA' ? ' (Canada)' : ''}. Keep or edit lines, or import a curated sheet from the Export menu.</div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {byField.map(([field, rs]) => (
          <section key={field} className="rounded-xl border border-l-4 border-[#272B34] bg-[#16181D] p-4" style={personaEdge(ctx.persona)}>
            <h2 className="mb-2 text-base font-bold">{shortField(meta, field)} <span className="font-normal text-[#858B96]">({rs.length})</span></h2>
            <ul className="divide-y divide-[#272B34]">
              {rs.map(r => (
                <li key={r.id} className="flex items-start gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-base leading-snug text-[#F2F3F5]">{r.text}</div>
                    {(r.compliance_flags?.length || r.warn_flags?.length || r.note || r.signed_off || (r.round && r.round !== (meta.rounds?.working || meta.rounds?.active))) ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {r.signed_off && <Chip tone="outline" className="border-[#D94D8F]/60 text-xs text-[#F2C4DA]">signed off</Chip>}
                        {r.round && r.round !== (meta.rounds?.working || meta.rounds?.active) && <Chip tone={meta.rounds?.rounds.find(x => x.id === r.round)?.test ? 'amber' : 'outline'} className="text-xs">{roundName(meta.rounds, r.round)}</Chip>}
                        {(r.compliance_flags || []).map(x => <Chip key={x} tone="red" className="text-xs">{chipName(x)}</Chip>)}
                        {(r.warn_flags || []).map(x => <Chip key={x} tone="amber" className="text-xs">{chipName(x)}</Chip>)}
                        {r.note && <span className="text-sm text-[#858B96]">{r.note}</span>}
                      </div>
                    ) : null}
                  </div>
                  {r.signed_off
                    ? <GhostButton disabled title="Signed off at Build & sign off. Take it out of its versions there first.">Cut</GhostButton>
                    : <GhostButton disabled={!r.batch || busy === r.id} onClick={() => cutRow(r)} title="Cut this line (you can undo it)">Cut</GhostButton>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
