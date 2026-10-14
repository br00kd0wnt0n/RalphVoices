// The worksheet (Brook, 2 Oct; Round 2; Studio's start screen since PR 5): the month's copy on one page, the way the Round 1 spreadsheet worked. Tabs
// are the steps; one row is one line with what the check found, a count, and Keep / Cut / Edit. No persona or
// territory to pick first, no runs, angles or tone. It is a view over the same lines the other screens use.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { REGION_NAMES, studio, type Batch, type Brief, type Line, type Meta, type Region, type StudioEvent, type WorksheetData, type WsRow, type WsStep } from '@/lib/studioApi';
import { CopyCheck } from './CopyCheck';
import { cn } from '@/lib/utils';
import { personaColor, tint } from '@/lib/personaColors';
import { regionLabel, personaKeys, ForPicker, GhostButton, LineHistory, PersonaDot, PinkButton, Src, angleLabel, useActingFor, when } from './ui';

const STEPS: Array<{ key: WsStep; n: number; name: string; what: string }> = [
  { key: 'on_image', n: 1, name: 'On-image copy', what: 'Every headline, subhead and carousel card that sits in the artwork, by persona and asset.' },
  { key: 'primary', n: 2, name: 'Captions', what: 'Primary texts and captions: the shared pool, used under every persona’s assets, then the caption written for each asset.' },
  { key: 'headline', n: 3, name: 'Headlines', what: 'The headline bank: short shared lines that work under any caption here, then any written for one asset.' },
];
const LEVEL: Record<string, string> = { red: 'border-red-500/50 bg-red-500/10 text-red-200', amber: 'border-amber-400/40 bg-amber-400/10 text-amber-200', grey: 'border-[#343946] bg-[#1C1F26] text-[#A3A8B1]' };

export function Worksheet({ meta, region, onStep, onChanged, onOpenRun }: {
  /** The region shown: the header's switch. */
  meta: Meta; region: Region;
  /** Steps 4 and 5 are the existing Build and Assets screens. */
  onStep: (step: 'build' | 'assets') => void; onChanged: () => void;
  /** Open a run in Review (from a pasted check's report). */
  onOpenRun?: (run: string) => void;
}) {
  // One panel open at a time above the table: paste a table of copy, or have Studio write more for the shared pool.
  const [panel, setPanel] = useState<'' | 'paste' | 'more'>('');
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
  // Step 1 reads persona, then asset. Steps 2 and 3: the shared pool first, then each asset's own lines the same way.
  const groups: Array<{ key: string; persona?: string; asset?: string; shared?: boolean; rows: WsRow[] }> = [];
  const ownLines = step !== 'on_image' && rows.some(x => x.shared === false);
  for (const x of rows) {
    const byAsset = step === 'on_image' || x.shared === false;
    const key = byAsset ? `${x.persona}|${x.territory}|${x.region}` : 'pool';
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.rows.push(x); else groups.push({ key, ...(byAsset ? { persona: x.persona, asset: x.asset } : { shared: true }), rows: [x] });
  }
  const state = c ? stepState(rows, step) : null;
  // The lock (the Friday lock, made explicit): this step's lines are read-only everywhere until it is unlocked.
  const lock = data?.locks?.[step];
  const [canLock, setCanLock] = useState(false);
  useEffect(() => { studio.worksheetLocks(region).then(x => setCanLock(x.can_lock)).catch(() => setCanLock(false)); }, [region]);
  const [locking, setLocking] = useState(false);
  const toggleLock = async () => {
    if (!lock && c && c.undecided > 0 && !window.confirm(`${c.undecided} line${c.undecided === 1 ? ' is' : 's are'} still undecided. Lock ${s.name.toLowerCase()} anyway? Undecided lines stay out of Build.`)) return;
    setLocking(true);
    try { await studio.setWorksheetLock(step, !lock, region); changed(); } catch (e: any) { setError(e.message); } finally { setLocking(false); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold">{data?.round_label || 'This month'}: copy worksheet <span className="text-lg font-normal text-[#A3A8B1]">· {regionLabel(region)}</span></h1>
          <p className="text-base text-[#A3A8B1]">Everything on one page. One decision per line: keep it, cut it, or edit it.</p>
        </div>
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
              {k && <span className={cn('ml-2 text-xs', step === x.key ? 'text-[#3A3F4A]' : 'text-[#858B96]')}>{data?.locks?.[x.key] ? 'locked · ' : ''}{k.kept} kept{k.undecided ? ` · ${k.undecided} to decide` : ''}</span>}
            </button>
          );
        })}
        <button role="tab" aria-selected={false} onClick={() => onStep('build')} className="rounded-lg border border-[#343946] px-3.5 py-2 text-sm font-semibold text-[#C9CCD2] hover:border-[#6B7280]">4 Build ads</button>
        <button role="tab" aria-selected={false} onClick={() => onStep('assets')} className="rounded-lg border border-[#343946] px-3.5 py-2 text-sm font-semibold text-[#C9CCD2] hover:border-[#6B7280]">5 Assets</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <GhostButton active={panel === 'paste'} aria-expanded={panel === 'paste'} onClick={() => setPanel(panel === 'paste' ? '' : 'paste')} title="Paste a table of copy written elsewhere: every line is checked, kept, and lands as a row in its step and asset">Paste copy</GhostButton>
        {step !== 'on_image' && !lock && <GhostButton active={panel === 'more'} aria-expanded={panel === 'more'} onClick={() => setPanel(panel === 'more' ? '' : 'more')} title="Studio writes more for the shared pool, learning from what has been kept and cut">Write more</GhostButton>}
        <span className="text-sm text-[#858B96]">or add a line at the bottom of the table</span>
      </div>
      {panel === 'paste' && (
        <div className="rounded-xl border border-[#343946] bg-[#121419] p-4">
          <CopyCheck meta={meta} embedded region={region} onChecked={changed} onOpenRun={id => onOpenRun?.(id)} />
        </div>
      )}
      {panel === 'more' && step !== 'on_image' && <WriteMore meta={meta} step={step} region={region} onDone={changed} onError={setError} />}

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
          {(state || lock) && (
            <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 text-base', lock ? 'border-sky-400/40 bg-sky-400/10 text-sky-100' : state?.done ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100' : 'border-[#343946] bg-[#16181D] text-[#C9CCD2]')} role="status">
              <span className="mr-auto">{lock
                ? `Locked by ${lockWho(lock)}, ${when(lock.at)}. Its lines are read-only everywhere in Studio (here, the sheet, Review, Build and Check copy) until it is unlocked.`
                : state?.words}</span>
              {canLock && rows.length > 0 && <GhostButton disabled={locking} onClick={toggleLock} title={lock ? 'Lets this step’s lines be kept, cut, edited and added to again' : 'Makes this step’s lines read-only everywhere until it is unlocked; who locked it and when are recorded'}>{lock ? 'Unlock' : `Lock ${s.name.toLowerCase()}`}</GhostButton>}
              {state?.next && <GhostButton onClick={() => onStep(state.next!)}>{state.next === 'build' ? 'Go to 4 Build ads' : 'Go to 5 Assets'}</GhostButton>}
            </div>
          )}
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
                      {g.shared && ownLines && (
                        <tr className="bg-[#16181D]"><td colSpan={6} className="border-t border-[#272B34] px-3 py-1.5 text-sm font-semibold text-[#ECEDEF]">Shared <span className="ml-1 font-normal text-[#858B96]">used under every persona’s assets</span></td></tr>
                      )}
                      {g.rows.map(x => <Row key={x.id} meta={meta} x={x} step={step} who={who} locked={!!lock} onChanged={changed} onError={setError} />)}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!lock && <AddLine meta={meta} step={step} region={region} onDone={changed} onError={setError} />}
          <p className="text-sm text-[#A3A8B1]"><span className="font-semibold text-red-200">Red</span> breaks a client rule as written and needs a fix. <span className="font-semibold text-amber-200">Amber</span> is only “have a look”: it is yours to keep as it is. A line with nothing to say is <span className="text-emerald-300">clear</span>.</p>
          {data.other > 0 && <p className="text-xs text-[#646A75]">{data.other} other line{data.other === 1 ? '' : 's'} this month (a description, a TikTok hook or a video’s words) {data.other === 1 ? 'is' : 'are'} not on the worksheet. They are in Review.</p>}
        </>
      )}
    </div>
  );
}

/** Follow a job to its end: its status lines as they come, then resolve (or reject with what stopped it). */
function follow(job: string, onStatus: (m: string) => void, keep: { current: { close: () => void } | null }): Promise<void> {
  return new Promise((resolve, reject) => {
    keep.current?.close();
    keep.current = studio.events(job, (e: StudioEvent) => {
      if (e.type === 'status') onStatus(e.message);
      if (e.type === 'error') reject(new Error(e.message));
      if (e.type === 'done') resolve();
    });
  });
}
const sel = 'rounded-lg border-2 border-[#343946] px-2 py-1.5 text-sm';
const askFirst = (meta: Meta, usd: number) => window.confirm(`This is estimated at $${usd.toFixed(2)}, over the $${meta.ask_over ?? 2} ask-first line. Go ahead?`);

/** Add a line at the bottom of the table: typed, placed by asset (steps 2 and 3: the shared pool unless an asset is chosen), checked, kept. */
function AddLine({ meta, step, region, onDone, onError }: { meta: Meta; step: WsStep; region: Region; onDone: () => void; onError: (m: string) => void }) {
  const [text, setText] = useState('');
  const [asset, setAsset] = useState('');
  const [where, setWhere] = useState('Headline');
  const [busy, setBusy] = useState('');
  const es = useRef<{ close: () => void } | null>(null);
  useEffect(() => () => es.current?.close(), []);
  // The month's assets, by persona: live territories that aren't the shared pool.
  const assets = personaKeys(meta.personas).flatMap(p => Object.entries(meta.territories).filter(([, t]) => t.persona === p && t.status !== 'retired' && !t.shared).map(([k, t]) => ({ k, persona: p, name: t.name.replace(/\.$/, ''), format: String(t.format || '') })));
  const chosen = assets.find(a => a.k === asset);
  const carousel = /^CAR/i.test(chosen?.format || '');
  const wheres = carousel ? ['Card', 'Card 1', 'Card 2', 'Card 3', 'Card 4', 'Card 5', 'Card 6', 'Card subhead'] : ['Headline', 'Subhead'];
  useEffect(() => { if (!wheres.includes(where)) setWhere(wheres[0]); }, [carousel]); // eslint-disable-line react-hooks/exhaustive-deps
  const needAsset = step === 'on_image' && !asset;
  const add = async () => {
    const line = { step, text: text.trim(), region, ...(asset ? { asset } : {}), ...(step === 'on_image' ? { where } : {}) };
    if (!line.text || needAsset) return;
    onError(''); setBusy('Checking the new line…');
    try {
      let r;
      try { r = await studio.worksheetAdd(line); }
      catch (e: any) {
        if (e.status !== 409 || !e.body?.needs_confirm) throw e;
        if (!askFirst(meta, e.body.estimate)) { setBusy(''); return; }
        r = await studio.worksheetAdd(line, true);
      }
      await follow(r.job, setBusy, es);
      setText(''); onDone();
    } catch (e: any) { onError(`The line was not added: ${e.message}`); }
    finally { setBusy(''); }
  };
  const noun = step === 'on_image' ? 'on-image line' : step === 'primary' ? 'caption' : 'headline';
  return (
    <div className="rounded-xl border border-dashed border-[#343946] px-4 py-3">
      <div className="mb-2 text-sm font-semibold text-[#C9CCD2]">Add {step === 'on_image' ? 'an' : 'a'} {noun}</div>
      <div className="flex flex-wrap items-start gap-2">
        <select className={cn(sel, 'max-w-[16rem]')} value={asset} onChange={e => setAsset(e.target.value)} aria-label="Asset for the new line">
          <option value="">{step === 'on_image' ? 'Choose the asset…' : 'Shared (every asset)'}</option>
          {personaKeys(meta.personas).filter(p => assets.some(a => a.persona === p)).map(p => (
            <optgroup key={p} label={(meta.personas[p]?.name || p).replace(/\s*\(.*\)$/, '')}>
              {assets.filter(a => a.persona === p && (step !== 'headline' || !/^TIKTOK/i.test(a.format))).map(a => <option key={a.k} value={a.k}>{a.name}</option>)}
            </optgroup>
          ))}
        </select>
        {step === 'on_image' && (
          <select className={sel} value={where} onChange={e => setWhere(e.target.value)} aria-label="Where the new line sits">
            {wheres.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        )}
        <textarea className="min-w-[16rem] flex-1 rounded-lg border-2 border-[#343946] bg-[#101216] p-2 text-base leading-snug" rows={Math.max(1, Math.ceil(text.length / 70))} value={text} placeholder={`Type the ${noun}`} aria-label={`New ${noun}`}
          onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(); }} />
        <PinkButton className="px-3 py-1.5 text-sm" onClick={add} disabled={!!busy || !text.trim() || needAsset}>Add and check</PinkButton>
      </div>
      <p className="mt-1.5 text-xs text-[#858B96]" role="status">
        {busy ? <span className="animate-pulse text-[#F2C4DA]">{busy}</span> : needAsset && text.trim() ? 'Choose the asset the line is for.' : `It is checked like every other line and arrives kept${step === 'on_image' ? '' : asset ? ', as this asset’s own' : ', in the shared pool'}. ${[...text.trim()].length ? `${[...text.trim()].length} characters.` : ''}`}
      </p>
    </div>
  );
}

/** Steps 2 and 3: Studio writes more for the shared pool, into the pool's run, learning from what was kept and cut. */
function WriteMore({ meta, step, region, onDone, onError }: { meta: Meta; step: WsStep; region: Region; onDone: () => void; onError: (m: string) => void }) {
  const field = step === 'primary' ? 'meta_primary' : 'meta_headline';
  const persona = Object.keys(meta.personas).find(p => meta.personas[p].shared) || 'ALL';
  const territory = Object.keys(meta.territories).find(t => meta.territories[t].shared) || 'SHARED';
  const [n, setN] = useState(meta.fields[field]?.default_count || 5);
  const [cost, setCost] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  // What the last run came to ("6 lines ready. 2 dropped before you saw them: …"), kept on show after it ends.
  const [result, setResult] = useState('');
  const es = useRef<{ close: () => void } | null>(null);
  useEffect(() => () => es.current?.close(), []);
  /** The pool's run for this region (new lines join it), and the brief: its own, with only this field and count. */
  const plan = useCallback(async (): Promise<{ brief: Brief; run?: string }> => {
    const run = (await studio.batches()).filter(r => r.persona === persona && r.territory === territory && (r.region || 'US') === region).sort((a, b) => a.created.localeCompare(b.created))[0]?.id;
    const base: Brief = run ? (await studio.batch(run)).brief : { persona, territory, region, fields: [], tone: { dry_warm: 3, playful_plain: 3, short_long: 1 }, banned_words: [], banned_ideas: [], reference_lines: [], n, model: 'gpt-4o' };
    return { brief: { ...base, region, fields: [field], field_counts: { [field]: n }, n, own_lines: [], carousel: undefined }, run };
  }, [persona, territory, region, field, n]);
  useEffect(() => {
    let live = true;
    setCost(null);
    const t = setTimeout(() => { plan().then(p => studio.estimate(p.brief)).then(e => { if (live) setCost(e.usd); }).catch(() => {}); }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [plan]);
  const write = async () => {
    onError(''); setResult(''); setBusy('Starting…');
    try {
      const p = await plan();
      let r;
      try { r = await studio.generate(p.brief, { batch: p.run }); }
      catch (e: any) {
        if (e.status !== 409 || !e.body?.needs_confirm) throw e;
        if (!askFirst(meta, e.body.estimate)) { setBusy(''); return; }
        r = await studio.generate(p.brief, { batch: p.run, confirm: true });
      }
      let ready = '';
      await follow(r.job, m => { setBusy(m); if (/\blines? ready\b/.test(m)) ready = m.replace(/\s*Checking…$/, ''); }, es);
      setResult(ready);
      onDone();
    } catch (e: any) { onError(`Nothing was written: ${e.message}`); }
    finally { setBusy(''); }
  };
  const noun = step === 'primary' ? 'shared captions' : 'shared headlines';
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#343946] bg-[#121419] px-4 py-3">
      <span className="text-base text-[#C9CCD2]">Write</span>
      <input type="number" min={1} max={20} className={cn(sel, 'w-20')} value={n} aria-label={`How many ${noun} to write`} onChange={e => setN(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
      <span className="text-base text-[#C9CCD2]">more {noun} for {REGION_NAMES[region]}</span>
      <PinkButton className="px-3 py-1.5 text-sm" onClick={write} disabled={!!busy}>Write and check</PinkButton>
      <span className="text-sm text-[#858B96]" role="status">{busy ? <span className="animate-pulse text-[#F2C4DA]">{busy}</span> : `${cost === null ? '' : `About $${cost.toFixed(2)}. `}Studio learns from the lines kept and cut so far. New lines arrive undecided, as rows at the end of the shared pool.`}</span>
      {result && !busy && <p className={cn('w-full text-sm', /^0 lines/.test(result) ? 'text-amber-200' : 'text-emerald-200')} role="status">{result}</p>}
    </div>
  );
}

/** "brook", or "brook for Nick Larson". */
const lockWho = (l: { by: string; for?: string }) => { const by = l.by.split('@')[0]; return l.for && l.for !== l.by ? `${by} for ${l.for.split('@')[0]}` : by; };

/**
 * Who made the call on a line, said the same way on every row: whose call it is, then who entered it when that was
 * someone else ("kept by nick · entered by brook"; "kept by brook" when it was their own). The records are as stored.
 */
export function attribution(x: Pick<WsRow, 'call' | 'decided_by' | 'decided_for'>): string {
  const name = (s?: string) => String(s || '').split('@')[0];
  const by = name(x.decided_by), whose = name(x.decided_for);
  const verb = x.call === 'cut' ? 'cut' : 'kept';
  return whose && whose.toLowerCase() !== by.toLowerCase() ? `${verb} by ${whose} · entered by ${by}` : `${verb} by ${by}`;
}

/** What state a step is in, and what happens next, in a sentence (so a step with every row locked doesn't read as dead). */
export function stepState(rows: WsRow[], step: WsStep): { words: string; done: boolean; next?: 'build' | 'assets' } | null {
  if (!rows.length) return null;
  const live = rows.filter(x => x.call !== 'cut');
  const undecided = rows.filter(x => !x.call).length;
  const kept = rows.filter(x => x.call === 'keep');
  const signed = kept.filter(x => x.signed_off).length;
  const lines = (n: number) => `${n} line${n === 1 ? '' : 's'}`;
  const locked = signed ? ` ${signed === kept.length ? 'All' : signed} of the kept lines ${signed === 1 && signed !== kept.length ? 'is' : 'are'} signed off: those are changed in Build, not here.` : '';
  if (undecided) return { words: `${lines(undecided)} to decide here: Keep, Cut or Edit each.${signed ? ` ${signed} kept ${signed === 1 ? 'line is' : 'lines are'} already signed off: those are changed in Build, not here.` : ''}`, done: false };
  if (kept.length && signed === kept.length) {
    return { words: `This step is finished: ${signed === 1 ? 'the kept line is' : `all ${signed} kept lines are`} signed off in Build, so nothing here needs a decision. To change one, edit it in Build (step 4) and sign off again. Next is the artwork, in Assets (step 5).`, done: true, next: 'assets' };
  }
  if (!live.length) return { words: 'Every line here is cut. Add lines in Check copy or Write, or undo a cut.', done: false };
  return { words: `Every line here is decided (${kept.length} kept).${locked} Next: ${step === 'on_image' ? 'finish steps 2 and 3, then ' : ''}build the ads from the kept lines (step 4).`, done: false, next: 'build' };
}

function Row({ meta, x, step, who, locked: stepLocked, onChanged, onError }: { meta: Meta; x: WsRow; step: WsStep; who: string; locked?: boolean; onChanged: () => void; onError: (m: string) => void }) {
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
            {x.decided_by && x.call && <span>{attribution(x)}</span>}
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
          ) : locked ? <span className="text-sm text-[#A3A8B1]">Signed off. To change it, edit it in Build (step 4) and sign off again.</span> : stepLocked ? <span className="text-sm text-sky-200/80">Locked</span> : (
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
