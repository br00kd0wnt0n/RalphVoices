// Step 4, Assets (Pre-flight + Compliance on one screen): per code, the same code list and the same image, with one
// status track: Uploaded → Checks → Pre-flight passed → Trupanion decision → Ready to traffic (plus Changes requested).
// Every action is kept: upload, agree/disagree, override, mark Pre-flight passed, record Trupanion's decision per code
// (with who at Trupanion), send back to the copy or the visual. The producer (compliance emails) lands on "Awaiting
// Trupanion"; everyone else on "Needs upload or review".
import { useCallback, useEffect, useRef, useState } from 'react';
import { studio, type CodeCompliance, type ComplianceAsset, type ComplianceStatus, type ComplianceView, type Meta, type PfFlag, type PfReport, type PfStub, type StudioEvent } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { DateNote } from './KeyDates';
import { FeedbackNote } from './Feedback';
import { groupOverrides, overrideWhere } from '@/lib/overrideGroups';
import { keepSelection, uploadFor, uploadLabel } from '@/lib/uploadTarget';
import { SIZES, detectFileSize } from '@/lib/studioSizes';
import { personaEdge } from '@/lib/personaColors';
import { personaColor, tint } from '@/lib/personaColors';
import { AuthMedia, DisclaimerNote, ForPicker, whoWords, PersonaChip, PersonaDot, inViewFilter, personaKeys, type ViewFilter, Chip, CodeChip, COMPLIANCE_TONE, COMPLIANCE_WORDS, COPY_STATUS, GhostButton, Intro, Label, NAMING_TIP, PINK, PinkButton, SEV_ORDER, chipName, codeState, inRegion, params, plainSource, regionOf, territoryName, when, whatToDo } from './ui';

type Filter = 'needs' | 'awaiting' | 'changes' | 'ready' | 'all';
const FILTERS: Array<[Filter, string]> = [['needs', 'Needs upload or review'], ['awaiting', 'Awaiting Trupanion'], ['changes', 'Changes requested'], ['ready', 'Ready to traffic'], ['all', 'All']];
const SEND_BACK: Record<'copy' | 'asset', string> = { copy: 'The copy (edited and signed off again at Build & sign off)', asset: 'The visual (a new upload here)' };

interface CodeRow { s: PfStub; c?: CodeCompliance; asset?: ComplianceAsset }
const complianceOf = (r: CodeRow): ComplianceStatus => r.c?.status || r.s.traffic?.compliance || 'pending';
const auditDone = (s: PfStub) => !!s.upload && s.audit?.status === 'done';
const inFilter = (r: CodeRow, f: Filter) => {
  const comp = complianceOf(r);
  if (f === 'all') return true;
  if (f === 'changes') return comp === 'changes_requested';
  if (f === 'ready') return !!r.s.traffic?.ready;
  if (f === 'awaiting') return !!r.s.upload && comp === 'pending' && !r.s.traffic?.ready;
  return !r.s.upload || !auditDone(r.s) || !!r.s.audit?.open_red || r.s.status.status !== 'ready' || comp === 'changes_requested';
};
/**
 * An ad on this screen (Add3, 6 Oct: one ad per visual, its codes are copy options): the codes that share a visual.
 * It sits in ONE status, that of its least advanced option: changes requested if any option has them, else needs
 * upload or review if any does, else awaiting Trupanion, else ready.
 */
interface AdRow { key: string; ad: string; codes: CodeRow[]; bucket: Exclude<Filter, 'all'>; lead: CodeRow }
const BUCKETS: Array<Exclude<Filter, 'all'>> = ['changes', 'needs', 'awaiting', 'ready'];
function adsOf(rs: CodeRow[]): AdRow[] {
  const groups = new Map<string, CodeRow[]>();
  for (const r of rs) { const k = `${r.s.territory}|${regionOf(r.s)}|${r.s.visual_key || r.s.stub}`; groups.set(k, [...(groups.get(k) || []), r]); }
  return [...groups.entries()].map(([key, codes]) => {
    const bucket = BUCKETS.find(b => (b === 'ready' ? codes.every(c => inFilter(c, b)) : codes.some(c => inFilter(c, b)))) || 'needs';
    // The option that holds the ad back is the one its row shows.
    const lead = codes.find(c => inFilter(c, bucket)) || codes[0];
    return { key, ad: codes[0].s.visual_key || codes[0].s.stub, codes, bucket, lead };
  });
}
/** A code's short option name: "A2" from …_ST_A2_US_META. */
const optionOf = (stub: string) => /_([A-Z]\d+)_[A-Z]{2}_[A-Z]+$/.exec(stub)?.[1] || stub;
const stateOf = (r: CodeRow) => codeState({ signed: true, edited: !!r.c?.wording_edited, passed: r.s.status.status === 'ready', compliance: complianceOf(r), ready: r.s.traffic?.ready });

/** The five steps for one code: done, current, or a problem at that step. */
function steps(r: CodeRow): Array<{ label: string; state: 'done' | 'todo' | 'bad' }> {
  const s = r.s, comp = complianceOf(r);
  const checks = !s.upload ? 'todo' : s.audit?.status === 'failed' || s.audit?.open_red ? 'bad' : auditDone(s) ? 'done' : 'todo';
  return [
    { label: 'Uploaded', state: s.upload ? 'done' : 'todo' },
    { label: 'Checks', state: checks },
    { label: 'Pre-flight passed', state: s.status.status === 'ready' ? 'done' : 'todo' },
    { label: comp === 'changes_requested' ? 'Changes requested' : 'Trupanion decision', state: comp === 'cleared' ? 'done' : comp === 'changes_requested' ? 'bad' : 'todo' },
    { label: 'Ready to traffic', state: s.traffic?.ready ? 'done' : 'todo' },
  ];
}
function Track({ r, compact }: { r: CodeRow; compact?: boolean }) {
  const st = steps(r);
  const dot = (x: { state: string }) => x.state === 'done' ? 'bg-emerald-400 border-emerald-400' : x.state === 'bad' ? 'bg-amber-400 border-amber-400' : 'border-[#4A505D] bg-transparent';
  if (compact) return <span className="flex items-center gap-1" aria-label={st.map(x => `${x.label}: ${x.state}`).join(', ')}>{st.map(x => <span key={x.label} title={x.label} className={cn('h-2 w-2 rounded-full border', dot(x))} />)}</span>;
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
      {st.map((x, i) => (
        <li key={x.label} className="flex items-center gap-1">
          <span className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1', x.state === 'done' ? 'border-emerald-500/50 text-emerald-200' : x.state === 'bad' ? 'border-amber-400/60 bg-amber-400/10 text-amber-100' : 'border-[#343946] text-[#858B96]')}>
            <span className={cn('h-2 w-2 rounded-full border', dot(x))} />{x.label}
          </span>
          {i < st.length - 1 && <span className="text-[#4A505D]" aria-hidden>→</span>}
        </li>
      ))}
    </ol>
  );
}

/** A thumbnail box in the shape of its size (a 4:5 card isn't squashed into a square). */
const ASPECT: Record<string, string> = { '1:1': 'aspect-square', '4:5': 'aspect-[4/5]', '9:16': 'aspect-[9/16]' };

/** onFixCopy: open Build & sign off on a code's persona, territory and region (where copy Trupanion sent back is fixed). */
/** focus: an asset (territory), or one ad (a code of it), to open on arrival, with every persona still listed (from a board cell, or Build's "next"). */
export function Assets({ meta, view, setView, onBuild, onFixCopy, focus }: { meta: Meta; view: ViewFilter; setView: (v: ViewFilter) => void; onBuild: () => void; onFixCopy?: (s: PfStub) => void; focus?: string | null }) {
  const enabled = !!meta.preflight?.enabled;
  const canReady = !!meta.preflight?.can_set_ready;
  const canCompliance = meta.can_set_compliance !== false;
  // The producer (compliance emails, not an admin or the creative lead) starts on what's waiting for Trupanion, across every set.
  const producer = canCompliance && !meta.user?.admin && !canReady;
  // A link to one code (?stub=, or an old ?asset=) opens on All, so the code is in the list whatever its status.
  const [filter, setFilter] = useState<Filter>(params.get('stub') || params.get('asset') ? 'all' : producer ? 'awaiting' : 'needs');
  const [format, setFormat] = useState<string>('all');
  const [stubs, setStubs] = useState<PfStub[] | null>(null);
  const [comp, setComp] = useState<ComplianceView | null>(null);
  const [sel, setSel] = useState<string | null>(params.get('stub'));
  const [report, setReport] = useState<PfReport | null>(null);
  const [error, setError] = useState('');
  // Per code, so another code's upload or check never blocks this one, and the files chosen for a code (with their
  // sizes) survive refreshes and moving between codes until they're uploaded (production test, 1 Oct: Upload was
  // disabled with no reason while another code's audit ran, and the 12 files chosen were cleared when it finished).
  const [progressBy, setProgressBy] = useState<Record<string, string>>({});
  const setProgress = (stub: string, text: string) => setProgressBy(cur => { const n = { ...cur }; if (text) n[stub] = text; else delete n[stub]; return n; });
  const [pendingBy, setPendingBy] = useState<Record<string, { upload_id: string; estimate: { usd: number; seconds: number; sizes?: number } } | null>>({});
  const [picked, setPicked] = useState<Record<string, { files: File[]; sizes: string[] }>>({});
  const esRef = useRef<Map<string, { close: () => void }>>(new Map());
  useEffect(() => () => esRef.current.forEach(x => x.close()), []);

  const loadLists = useCallback(async () => {
    const [s, c] = await Promise.all([studio.pfStubs(), studio.complianceView()]);
    setStubs(s); setComp(c);
    // An old ?asset= link (Compliance) opens that asset's first code.
    const asset = params.get('asset');
    if (asset && !params.get('stub')) { const a = c.assets.find(x => x.upload_id === asset); if (a) setSel(cur => cur || a.codes[0]?.stub || null); }
  }, []);
  const loadReport = useCallback((stub: string) => studio.pfReport(stub).then(setReport), []);
  const refresh = useCallback(async () => {
    try { await Promise.all([loadLists(), sel ? loadReport(sel) : Promise.resolve()]); setError(''); }
    catch (e: any) { setError(e.message); }
  }, [loadLists, loadReport, sel]);
  useEffect(() => { if (enabled) loadLists().catch(e => setError(e.message)); }, [enabled, loadLists]);
  useEffect(() => { setReport(null); if (sel && enabled) loadReport(sel).catch(e => setError(e.message)); }, [sel, enabled, loadReport]);

  const rows: CodeRow[] = (stubs || []).map(s => {
    const asset = comp?.assets.find(a => a.codes.some(c => c.stub === s.stub));
    return { s, asset, c: asset?.codes.find(c => c.stub === s.stub)?.compliance };
  });
  // Arriving for one asset (a board cell, Build's "next"): its ad opens, once, when its codes have loaded. It is decided
  // in the same place as the default selection below (keepSelection), so the default can't override it.
  const arrived = useRef<string | null>(null);
  const formatOf = (s: PfStub) => String(meta.territories[s.territory]?.format || '').toUpperCase() || 'OTHER';
  const scoped = rows.filter(r => inViewFilter(r.s, view) && (format === 'all' || formatOf(r.s) === format));
  // The list and the counts are in ads; an ad is in one status (its least advanced copy option's).
  const ads = adsOf(scoped);
  const shownAds = ads.filter(a => filter === 'all' || a.bucket === filter);
  const shown = shownAds.flatMap(a => a.codes);
  // Keep a selection in view (keepSelection): the first shown code when the current one isn't in the list, but never
  // off a code with files waiting or an upload or check running.
  useEffect(() => {
    if (!stubs) return;
    const arriving = focus && arrived.current !== focus && !params.get('stub') ? scoped.filter(r => r.s.territory === focus || r.s.stub === focus).map(r => r.s.stub) : [];
    if (focus && arrived.current !== focus) { arrived.current = focus; if (arriving.length) setFilter('all'); }
    const next = keepSelection(sel, shown.map(r => r.s.stub), scoped.map(r => r.s.stub), [...Object.keys(picked), ...Object.keys(progressBy)], arriving);
    if (next !== sel) setSel(next);
  }, [stubs, comp, filter, format, view.persona, view.territory, view.region, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return <div className="max-w-3xl rounded-xl border border-[#272B34] bg-[#16181D] p-6 text-base text-[#A3A8B1]">Assets need the database: in <code>backend/</code>, run <code>npx tsx scripts/studio.ts serve --store pg --database-url …</code> (hosted Studio has it on).</div>;

  /** Upload to the code whose button was pressed (never the current selection), with that code's own files. */
  async function upload(code: string, also: string[], sizes: string[] = []) {
    const plan = uploadFor(code, picked);
    if (!plan) return;
    const stub = plan.stub, files = plan.files;
    setError(''); setProgress(stub, 'Uploading…');
    try {
      const r = await studio.pfUpload(stub, files, also, sizes);
      if (r.format_notes?.length) setError(r.format_notes.join(' '));
      setPendingBy(cur => ({ ...cur, [stub]: { upload_id: r.upload_id, estimate: r.estimate } }));
      setPicked(cur => { const n = { ...cur }; delete n[stub]; return n; });
      setProgress(stub, '');
      await refresh();
    } catch (e: any) { setProgress(stub, ''); setError(e.message); }
  }
  async function runAudit(stub: string, uploadId: string) {
    setError('');
    try {
      let r;
      try { r = await studio.pfAudit(uploadId); }
      catch (e: any) {
        if (e.status !== 409) throw e;
        if (!window.confirm(`This check is estimated at $${e.body.estimate.toFixed(2)}, over the $${meta.ask_over} ask-first line. Run it?`)) return;
        r = await studio.pfAudit(uploadId, true);
      }
      setPendingBy(cur => ({ ...cur, [stub]: null }));
      setProgress(stub, 'Starting the checks…');
      await refresh();
      esRef.current.get(stub)?.close();
      esRef.current.set(stub, studio.events(r.job, (e: StudioEvent) => {
        if (e.type === 'status') setProgress(stub, e.message);
        if (e.type === 'error') { setProgress(stub, ''); setError(`The checks on ${stub} stopped: ${e.message}`); refresh(); }
        if (e.type === 'done') { setProgress(stub, ''); esRef.current.delete(stub); refresh(); }
      }));
    } catch (e: any) { setError(e.message); }
  }

  // Grouped by persona (its colour), then territory × region, then visual.
  const byPersona = personaKeys(Object.fromEntries(shown.map(r => [r.s.persona, 1]))).map(p => {
    const sets = new Map<string, CodeRow[]>();
    for (const r of shown.filter(x => x.s.persona === p)) { const k = `${r.s.territory}|${regionOf(r.s)}`; sets.set(k, [...(sets.get(k) || []), r]); }
    return [p, [...sets.values()]] as const;
  });
  const formats = [...new Set(rows.filter(r => inViewFilter(r.s, view)).map(r => formatOf(r.s)))].sort();
  const chip = (on: boolean) => cn('rounded-full border px-3 py-1 text-sm transition', on ? 'border-[#ECEDEF] bg-[#ECEDEF] text-[#0E0F12]' : 'border-[#343946] text-[#C9CCD2] hover:border-[#6B7280]');
  const count = (f: Filter) => ads.filter(a => f === 'all' || a.bucket === f).length;
  const row = rows.find(r => r.s.stub === sel) || null;

  return (
    <div className="max-w-[1500px] space-y-5">
      <Intro title="Assets" line="Each ad’s finished artwork: checked, passed, then Trupanion’s decision." right={<DateNote meta={meta} screen="assets" />}>
        <p>An ad is one piece of artwork with its copy as text options. Upload the artwork once for the ad: it serves every copy option. Studio checks it against the signed-off on-image copy, the disclaimer and the rules: agree or disagree with each flag; red flags are fixed with a new upload or overridden with a reason. The creative lead then marks the ad Pre-flight passed.</p>
        <p>Vivan coordinates with Trupanion and records their decision here, once for the ad (or per copy option if they differ), with who at Trupanion made it: cleared, or changes requested with a note (the copy goes back to Build & sign off, the visual to a new upload). An ad is Ready to traffic once Pre-flight has passed and Trupanion has cleared every copy option on it.</p>
      </Intro>
      {meta.preflight?.storage?.startsWith('refused') && <div className="rounded-lg border-2 border-amber-400/50 bg-amber-400/10 p-3 text-base text-amber-100">Uploads are switched off: {meta.preflight.storage.replace(/^refused:\s*/, '')}. An admin sets this on Railway.</div>}
      {error && <div className="rounded-lg border-2 border-red-500/45 bg-red-500/10 p-3 text-base text-red-200">{error}</div>}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-xs font-semibold uppercase tracking-wider text-[#646A75]">Status</span>
          {FILTERS.map(([k, l]) => <GhostButton key={k} active={filter === k} onClick={() => setFilter(k)} className="text-base">{l} ({stubs ? count(k) : '…'})</GhostButton>)}
          {filter === (producer ? 'awaiting' : 'needs') && <span className="text-xs text-[#646A75]">your default</span>}
          {/* The flag report for the ads these filters show: one internal document for the team (nothing of Trupanion's decision). */}
          {stubs && shownAds.length > 0 && (
            <span className="ml-auto flex flex-wrap items-center gap-1.5 text-sm text-[#858B96]" title="One internal document for the ads listed below: a summary, then each ad’s flags (red, amber, note) with the size or card, the quote, overrides and marks, and what was checked. Trupanion’s decision is not in it.">
              Flag report for {shownAds.length === 1 ? 'this ad' : `these ${shownAds.length} ads`}:
              {([['html', 'For a doc'], ['md', 'Markdown'], ['csv', 'Sheet']] as const).map(([ext, words]) => (
                <GhostButton key={ext} className="px-2.5 py-0.5 text-sm" title={ext === 'html' ? 'A page that opens in the browser or Word and pastes into a doc with its headings and table' : undefined}
                  onClick={() => studio.download(`/preflight/flag-report.${ext}?stubs=${encodeURIComponent(shownAds.map(a => a.codes[0].s.stub).join(','))}`, `preflight-flag-report.${ext}`).catch(e => setError(e.message))}>{words}</GhostButton>
              ))}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-xs font-semibold uppercase tracking-wider text-[#646A75]">Persona</span>
          <button className={chip(view.persona === 'all')} onClick={() => setView({ ...view, persona: 'all', territory: 'all' })}>All</button>
          {personaKeys(meta.personas).map(p => {
            const pc = personaColor(p), on = view.persona === p;
            return <button key={p} className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition" style={on ? { borderColor: pc.edge, background: tint(pc.base, 0.22), color: pc.light } : { borderColor: tint(pc.base, 0.45), color: pc.light }}
              onClick={() => setView({ ...view, persona: on ? 'all' : p, territory: 'all' })}><PersonaDot persona={p} />{meta.personas[p].name.replace(/\s*\(.*\)$/, '')}</button>;
          })}
          <span className="ml-3 text-xs font-semibold uppercase tracking-wider text-[#646A75]">Format</span>
          {['all', ...formats].map(f => <button key={f} className={chip(format === f)} onClick={() => setFormat(f)}>{f === 'all' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}</button>)}
        </div>
      </div>

      {!stubs && !error && <div className="text-base text-[#858B96]">Loading the month’s ads…</div>}
      {stubs && !scoped.length && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#272B34] bg-[#16181D] p-5 text-base text-[#A3A8B1]">
          <span className="mr-auto">{view.persona !== 'all' || view.territory !== 'all' || format !== 'all' ? 'Nothing signed off for this filter.' : `Nothing signed off yet this month in ${view.region === 'CA' ? 'Canada' : 'the US'}.`} Each ad gets its artwork here once it’s signed off.</span>
          {(view.persona !== 'all' || view.territory !== 'all' || format !== 'all') && <GhostButton onClick={() => { setView({ persona: 'all', territory: 'all', region: view.region }); setFormat('all'); }}>Show all</GhostButton>}
          <GhostButton onClick={onBuild}>Build & sign off</GhostButton>
        </div>
      )}

      {scoped.length > 0 && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-4 lg:sticky lg:top-32 lg:max-h-[calc(100vh-9rem)] lg:self-start lg:overflow-y-auto">
            {!shown.length && <p className="rounded-xl border border-[#272B34] bg-[#16181D] p-4 text-sm text-[#858B96]">Nothing here. <button className="underline" onClick={() => setFilter('all')}>Show all</button></p>}
            {byPersona.map(([p, sets]) => (
              <section key={p} className="space-y-2 rounded-xl border border-l-4 border-[#272B34] bg-[#16181D] p-3" style={personaEdge(p)}>
                <PersonaChip meta={meta} persona={p} short />
                {sets.map(rs => (
                <div key={`${rs[0].s.territory}|${regionOf(rs[0].s)}`}>
                <div className="mb-1.5 px-1 text-sm font-semibold">{territoryName(meta.territories[rs[0].s.territory]) || rs[0].s.territory}{inRegion(rs[0].s.region)}</div>
                <ul className="space-y-1.5">
                  {adsOf(rs).map(a => {
                    const on = a.codes.some(c => c.s.stub === sel);
                    const onImage = a.lead.s.copy.filter(c => /on_image|hook/.test(c.field) && !/_sub$/.test(c.field)).map(c => c.text);
                    return (
                      <li key={a.key}>
                        {/* One row per ad; its copy options are inside (the first that holds it back opens). */}
                        <button onClick={() => { if (!on) setSel(a.lead.s.stub); }} aria-current={on ? 'true' : undefined} className={cn('w-full rounded-lg border px-3 py-2 text-left transition', on ? 'border-[#D94D8F] bg-[#D94D8F]/10' : 'border-[#272B34] hover:border-[#4A505D]')}>
                          <div className="break-all font-mono text-sm" title="The ad's name: what it is trafficked and reported under">{a.ad}</div>
                          <div className="mt-1 flex items-center gap-2">
                            <Track r={a.lead} compact />
                            <span className="text-xs text-[#858B96]">{a.codes.length} copy option{a.codes.length === 1 ? '' : 's'}</span>
                            <CodeChip state={stateOf(a.lead)} className="ml-auto" />
                          </div>
                          <div className="mt-1 truncate text-sm text-[#858B96]">{a.lead.s.upload ? a.lead.s.upload.files.map(f => f.filename).join(', ') : 'artwork not uploaded yet'}{onImage.length ? ` · ${onImage.join(' / ')}` : ''}</div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                </div>
                ))}
              </section>
            ))}
          </aside>

          <main className="min-w-0 space-y-4">
            {!row && <div className="text-base text-[#858B96]">Choose an ad.</div>}
            {row && !report && <div className="text-base text-[#858B96]">Loading…</div>}
            {row && report && report.stub === row.s.stub && (
              <CodeView meta={meta} row={row} report={report} stubs={stubs || []} onSelect={setSel} canReady={canReady} canCompliance={canCompliance} producer={producer} progress={progressBy[report.stub] || ''}
                elsewhere={Object.keys(progressBy).filter(k => k !== report.stub)} pending={pendingBy[report.stub] || null}
                files={picked[report.stub]?.files || []} fileSizes={picked[report.stub]?.sizes || []}
                setFiles={f => setPicked(cur => ({ ...cur, [report.stub]: { files: f, sizes: f.map(() => '') } }))}
                setFileSizes={z => setPicked(cur => ({ ...cur, [report.stub]: { files: cur[report.stub]?.files || [], sizes: typeof z === 'function' ? z(cur[report.stub]?.sizes || []) : z } }))}
                onUpload={upload} onAudit={runAudit} onChanged={refresh} onError={setError} onFixCopy={onFixCopy} />
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function CodeView({ meta, row, report, stubs, onSelect, canReady, canCompliance, producer, progress, elsewhere, pending, files, setFiles, fileSizes, setFileSizes, onUpload, onAudit, onChanged, onError, onFixCopy }: {
  meta: Meta; row: CodeRow; report: PfReport; stubs: PfStub[]; canReady: boolean; canCompliance: boolean; producer: boolean; progress: string;
  /** Other codes with an upload or check running (they don't block this one). */
  elsewhere: string[];
  fileSizes: string[]; setFileSizes: (z: string[] | ((cur: string[]) => string[])) => void;
  pending: { upload_id: string; estimate: { usd: number; seconds: number; sizes?: number } } | null;
  /** Show another copy option of the same ad. */
  onSelect: (stub: string) => void;
  files: File[]; setFiles: (f: File[]) => void; onUpload: (code: string, also: string[], sizes: string[]) => void; onAudit: (code: string, uploadId: string) => void;
  onChanged: () => Promise<void>; onError: (m: string) => void; onFixCopy?: (s: PfStub) => void;
}) {
  report = { ...report, same_visual_as: report.same_visual_as ?? [], on_asset_copy: report.on_asset_copy ?? report.copy, post_copy: report.post_copy ?? [] };
  const a = report.audit;
  // A check this page isn't following (started elsewhere, or before a reload or a restart) is polled, so it flips to
  // done, or to "interrupted: run again", without a reload.
  useEffect(() => {
    if (!a || (a.status !== 'running' && a.status !== 'queued') || progress) return;
    const t = setInterval(() => { onChanged().catch(() => {}); }, 20_000);
    return () => clearInterval(t);
  }, [a?.id, a?.status, progress]); // eslint-disable-line react-hooks/exhaustive-deps
  const res = a?.result || null;
  const up = report.upload;
  const current = !!(a && up && a.upload_id === up.id);
  const main = (current ? report.flags : []).filter(f => !f.cross_persona).sort((x, y) => (x.check === 'copy_match' ? -1 : 0) - (y.check === 'copy_match' ? -1 : 0) || SEV_ORDER[x.severity] - SEV_ORDER[y.severity]);
  const cross = (current ? report.flags : []).filter(f => f.cross_persona);
  const openRed = main.filter(f => f.severity === 'red' && !f.override).length;
  const auditForLatest = current;
  // Sizes (the client's WBS): each chosen file's size, read in the browser and correctable; the asset by size.
  // Sizes are read once, when the files are chosen; a choice made by hand is kept (in the parent, per code).
  useEffect(() => {
    if (!files.length || fileSizes.some(Boolean)) return;
    let live = true;
    Promise.all(files.map(detectFileSize)).then(z => { if (live) setFileSizes(cur => z.map((x, i) => cur[i] || x || '')); });
    return () => { live = false; };
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps
  const expected = report.sizes?.expected || [];
  const bySize = up ? SIZES.map(z => ({ z, fs: up.files.filter(f => (f.aspect || expected[0] || '1:1') === z) })).filter(g => g.fs.length) : [];
  const [sizeTab, setSizeTab] = useState('');
  const shownSize = bySize.find(g => g.z === sizeTab) || bySize[0];
  const auditedLatest = auditForLatest && a!.status === 'done';
  const ready = report.status.status === 'ready';
  const readyBlock = !up ? 'Upload the asset first.' : !auditForLatest ? 'Run the checks on this upload first.' : a!.status === 'running' || a!.status === 'queued' ? 'The checks are still running.' : a!.status === 'failed' ? (a!.result?.interrupted ? 'The checks were interrupted by a server restart; run them again.' : 'The checks failed; run them again.') : openRed ? `${openRed} red flag${openRed === 1 ? '' : 's'} to fix (a new upload) or override.` : '';
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await onChanged(); } catch (e: any) { onError(e.body?.blocking ? `${e.message}: ${e.body.blocking.map((b: any) => b.label || b.rule).join('; ')}` : e.message); } };
  const copyRows = res?.copy_match ?? res?.report?.copy_match;
  const sameVisual = (s: PfStub) => !!report.visual_key && s.visual_key === report.visual_key;
  const siblings = stubs.filter(s => s.stub !== report.stub && s.persona === report.persona && s.territory === report.territory && regionOf(s) === regionOf(report)).sort((x, y) => Number(sameVisual(y)) - Number(sameVisual(x)));
  // The ad's copy options: this code and the others on its visual, in order.
  const options = [...stubs.filter(s => s.stub === report.stub || (sameVisual(s) && siblings.includes(s)))].sort((x, y) => x.stub.localeCompare(y.stub, undefined, { numeric: true }));
  const [also, setAlso] = useState<string[]>([]);
  useEffect(() => { setAlso(siblings.filter(sameVisual).map(s => s.stub)); }, [report.stub]); // eslint-disable-line react-hooks/exhaustive-deps
  const secs = (n: number) => (n >= 90 ? `${Math.round(n / 60)} min` : `${Math.round(n)} s`);
  const tagged = res ? Object.entries(res.features || {}).filter(([, p]) => p >= 0.5).sort((x, y) => y[1] - x[1]) : [];
  const c = report.compliance;

  return (
    <>
      <div className="space-y-3 rounded-xl border border-l-4 border-[#272B34] bg-[#16181D] px-5 py-4" style={personaEdge(report.persona)}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto min-w-0">
            <div className="flex flex-wrap items-center gap-2"><span className="break-all font-mono text-lg font-semibold" title="The ad's name: what it is trafficked and reported under">{report.visual_key || report.stub}</span><CodeChip state={stateOf(row)} /></div>
            {/* The ad's copy options (Studio's own codes): one artwork, one Pre-flight pass and one decision cover them; pick one to see its copy and flags. */}
            {options.length > 1 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm" role="group" aria-label="Copy options on this ad">
                <span className="text-xs uppercase tracking-wider text-[#646A75]">Copy option</span>
                {options.map(o => (
                  <button key={o.stub} onClick={() => onSelect(o.stub)} aria-pressed={o.stub === report.stub} title={o.stub}
                    className={cn('rounded-full border px-2.5 py-0.5 font-mono text-[13px]', o.stub === report.stub ? 'border-[#ECEDEF] bg-[#ECEDEF] text-[#0E0F12]' : 'border-[#343946] text-[#C9CCD2] hover:border-[#6B7280]')}>{optionOf(o.stub)}</button>
                ))}
                <span className="font-mono text-xs text-[#646A75]" title={NAMING_TIP}>{report.stub}</span>
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#858B96]"><PersonaChip meta={meta} persona={report.persona} short /><span>{territoryName(meta.territories[report.territory]) || report.territory}{inRegion(report.region)} · signed off in {report.signoff_id}</span></div>
          </div>
          {canReady && (ready
            ? <GhostButton className="text-base" onClick={() => act(() => studio.pfReady(report.stub, false))} title={`Pre-flight passed by ${whoWords(report.status.ready_by, report.status.ready_for)}, ${when(report.status.ready_at)}`}>Take back Pre-flight</GhostButton>
            : report.same_visual_as.length > 0
              // A shared visual (one upload, one audit): every code on it by default, each passing on its own flags.
              ? <span className="flex flex-wrap items-center gap-2">
                  <PinkButton className="px-4 py-2 text-base" disabled={!!readyBlock} title={readyBlock || `Every code on this visual: ${[report.stub, ...report.same_visual_as].join(', ')}`}
                    onClick={async () => {
                      try {
                        const r = await studio.pfReadyVisual(report.stub);
                        await onChanged(); // refreshes (and clears the error line), so what didn't pass is said after it
                        if (r.blocked.length) onError(`Passed: ${r.passed.join(', ') || 'none'}. Not passed: ${r.blocked.map(b => `${b.code} (${b.error})`).join('; ')}`);
                      } catch (e: any) { onError(e.message); }
                    }}>
                    Mark this ad Pre-flight passed ({report.same_visual_as.length + 1} copy options)
                  </PinkButton>
                  <button className="text-sm text-[#858B96] underline-offset-2 hover:text-[#ECEDEF] hover:underline disabled:opacity-40" disabled={!!readyBlock} onClick={() => act(() => studio.pfReady(report.stub, true))}>just option {optionOf(report.stub)}</button>
                </span>
              : <PinkButton className="px-4 py-2 text-base" disabled={!!readyBlock} title={readyBlock || 'Ready to traffic once Trupanion has cleared it too'} onClick={() => act(() => studio.pfReady(report.stub, true))}>Mark Pre-flight passed</PinkButton>)}
          {/* Whose call "passed" is, when it's marked for them (the creative lead's, entered by you). */}
          {canReady && !ready && <ForPicker meta={meta} doing="Marking passed" />}
        </div>
        <Track r={row} />
        {/* The client's feedback on this ad (a round's note): it informs; it is not Trupanion's compliance decision below. */}
        <FeedbackNote region={report.region} persona={report.persona} territory={report.territory} />
        <p className="text-sm text-[#A3A8B1]">
          {ready ? `Pre-flight passed by ${whoWords(report.status.ready_by, report.status.ready_for)}, ${when(report.status.ready_at)}. ` : readyBlock ? `${readyBlock} ` : ''}
          {report.traffic && !report.traffic.ready && report.traffic.blocker ? report.traffic.blocker : report.traffic?.ready ? 'Ready to traffic.' : ''}
          {!canReady && !ready && <span className="text-[#646A75]"> Pre-flight is passed by the creative lead or an admin.</span>}
        </p>
        {c?.status === 'changes_requested' && (
          <div className="rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
            <span className="font-semibold">Trupanion asked for changes {c.send_back === 'asset' ? 'to the visual' : 'to the copy'}{c.client_by ? ` (${c.client_by})` : ''}</span>{c.note ? `: “${c.note}”` : ''}
            <div className="text-amber-200/80">{c.send_back === 'asset' ? 'Upload a new version below; it goes back to Trupanion.' : 'The copy is edited and signed off again at Build & sign off.'} {c.by ? `Recorded by ${c.by}, ${when(c.at)}.` : ''}</div>
            {c.send_back !== 'asset' && onFixCopy && <GhostButton className="mt-1.5 px-3 py-1 text-sm" onClick={() => onFixCopy(row.s)}>Fix the copy in Build & sign off →</GhostButton>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
            <Label>The asset</Label>
            {up ? (
              <>
                {(bySize.length > 1 || (report.sizes?.missing.length ?? 0) > 0) && (
                  <div className="mb-2 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Sizes">
                    {bySize.map(g => <GhostButton key={g.z} role="tab" aria-selected={shownSize?.z === g.z} active={shownSize?.z === g.z} className="px-2.5 py-0.5 text-sm" onClick={() => setSizeTab(g.z)}>{g.z}</GhostButton>)}
                    {report.sizes?.missing.map(z => <Chip key={z} tone="amber" className="text-xs" title="Expected for this format; Pre-flight can still pass, and the handoff notes it">{z} not uploaded</Chip>)}
                  </div>
                )}
                <div className={cn('grid gap-2', up.kind === 'carousel' ? 'grid-cols-3' : 'grid-cols-1')}>
                  {(shownSize?.fs || up.files).map(f => (
                    <div key={f.position}>
                      <AuthMedia path={studio.pfFile(up.id, f.position)} video={up.kind === 'video'} alt={f.filename} className={up.kind === 'carousel' ? cn('w-full', ASPECT[shownSize?.z || '1:1']) : 'max-h-96 w-full'} />
                      {up.kind === 'carousel' && <div className="mt-0.5 text-center text-xs text-[#858B96]">card {(f.position % 100) + 1}</div>}
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-sm text-[#858B96]">{up.kind} · {up.files.map(f => f.filename).join(', ')} · {up.uploaded_by}, {when(up.uploaded_at)}</div>
                {report.same_visual_as.length > 0 && <p className="mt-1 text-sm text-[#A3A8B1]">Same visual as <span className="font-mono">{report.same_visual_as.join(', ')}</span>.</p>}
              </>
            ) : <p className="text-sm text-[#858B96]">Nothing uploaded yet.</p>}
            {report.format_note && <p className="mt-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">{report.format_note}</p>}
            <div className="mt-3 space-y-2 border-t border-[#272B34] pt-3">
              <input key={`${report.stub}|${up?.id || 'none'}`} type="file" multiple accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime" onChange={e => setFiles([...(e.target.files || [])])} className="max-w-full text-sm" />
              <p className="text-xs text-[#646A75]">Every size at once: {expected.length ? expected.join(', ') : '1:1, 4:5, 9:16'} for this code. One image or video per size; a carousel's cards in order within each size. Sizes are read from the files; correct any below. A new upload replaces the asset and reopens it for review.</p>
              {files.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-[#272B34] px-3 py-2 text-sm">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <select aria-label={`Size of ${f.name}`} className="rounded border border-[#343946] bg-[#101216] px-1 py-0.5 text-xs" value={fileSizes[i] || ''}
                        onChange={e => setFileSizes(cur => cur.map((x, j) => (j === i ? e.target.value : x)))}>
                        <option value="">{`Size? (${expected[0] || '1:1'} if not set)`}</option>
                        {SIZES.map(z => <option key={z} value={z}>{z}</option>)}
                      </select>
                    </li>
                  ))}
                </ul>
              )}
              {siblings.length > 0 && files.length > 0 && (
                <fieldset className="rounded-lg border border-[#272B34] px-3 py-2">
                  <legend className="px-1 text-xs text-[#858B96]">This artwork also serves (the ad’s other copy options are ticked)</legend>
                  {siblings.map(s => (
                    <label key={s.stub} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-[#D94D8F]" checked={also.includes(s.stub)} onChange={e => setAlso(cur => e.target.checked ? [...cur, s.stub] : cur.filter(x => x !== s.stub))} />
                      <span className="font-mono">{s.stub}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {/* What the artwork must carry before it is uploaded: the region's disclaimer, and where. */}
              <DisclaimerNote meta={meta} region={report.region} format={meta.territories[report.territory]?.format} />
              <div className="flex flex-wrap items-center gap-2">
                <PinkButton className="px-4 py-1.5 text-base" disabled={!files.length || !!progress} onClick={() => onUpload(report.stub, also, fileSizes)}>{uploadLabel(report.stub, files.length, !!up)}</PinkButton>
              </div>
              {(pending || (up && !auditForLatest)) && !progress && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#343946] bg-[#101216] px-3 py-2 text-sm">
                  <span>{pending ? `About $${pending.estimate.usd.toFixed(2)} and ${secs(pending.estimate.seconds)} to check${(pending.estimate.sizes ?? 1) > 1 ? ` (${pending.estimate.sizes} sizes, one check each)` : ''}.` : 'Not checked yet.'}</span>
                  <PinkButton className="ml-auto px-3 py-1 text-sm" onClick={() => onAudit(report.stub, pending?.upload_id || up!.id)}>Run the checks</PinkButton>
                </div>
              )}
              {a && up && auditForLatest && a.status === 'failed' && !progress && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-500/45 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                  <span className="min-w-0 flex-1">{a.result?.interrupted ? a.error : `The checks failed: ${a.error}`}</span>
                  <PinkButton className="px-3 py-1 text-sm" onClick={() => onAudit(report.stub, up.id)}>Run the checks again</PinkButton>
                </div>
              )}
              {a?.stale && auditForLatest && up && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                  <span className="min-w-0 flex-1">{a.stale}</span>
                  <PinkButton className="px-3 py-1 text-sm" disabled={!!progress} onClick={() => onAudit(report.stub, up.id)}>Check again</PinkButton>
                </div>
              )}
              {a && up && auditedLatest && !a.stale && !progress && (
                <button className="text-xs text-[#858B96] underline-offset-2 hover:text-[#ECEDEF] hover:underline" onClick={() => onAudit(report.stub, up.id)} title="Run the checks again on this upload (e.g. after a rules change)">Check again</button>
              )}
              {progress && <div className="flex items-center gap-2 text-sm font-medium" style={{ color: PINK }}><span className="animate-pulse">●</span> {progress}</div>}
              {!progress && elsewhere.length > 0 && <p className="text-xs text-[#858B96]">Checks running on {elsewhere.join(', ')}: you can upload and check this code meanwhile.</p>}
            </div>
            {report.history.length > 1 && (
              <details className="mt-3 text-sm text-[#858B96]"><summary className="cursor-pointer">Earlier uploads ({report.history.length - 1})</summary>
                <ul className="mt-1 space-y-0.5">{report.history.slice(1).map(h => <li key={h.id}>{h.kind}, {h.files} file{h.files === 1 ? '' : 's'} · {h.uploaded_by}, {when(h.uploaded_at)}</li>)}</ul>
              </details>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-[#272B34] bg-[#16181D] p-4">
            <div>
              <Label>On the asset (checked against it)</Label>
              {report.on_asset_copy.length
                ? <ul className="space-y-2">{[...report.on_asset_copy].sort((a, b) => (a.card || 0) - (b.card || 0)).map(x => <li key={`${x.card || 0}|${x.line_id}`}><div className="text-xs text-[#858B96]">{x.label}{x.card ? ` · card ${x.card}` : ''} · v{x.version}</div><div className="text-base leading-snug text-[#F2F3F5]">{x.text}</div></li>)}</ul>
                : <p className="text-sm text-[#858B96]">None: this code’s copy all runs in the post.</p>}
            </div>
            {report.post_copy.length > 0 && (
              <div>
                <Label>Post copy (travels with the ad)</Label>
                <ul className="space-y-2">{report.post_copy.map(x => <li key={x.line_id}><div className="text-xs text-[#858B96]">{x.label} · v{x.version}</div><div className="text-base leading-snug text-[#C9CCD2]">{x.text}</div></li>)}</ul>
              </div>
            )}
          </section>

          {res && auditForLatest && (
            <details className="rounded-xl border border-[#272B34] bg-[#16181D] p-4 text-sm">
              <summary className="cursor-pointer font-semibold text-[#C9CCD2]">What the checks read</summary>
              <div className="mt-3 space-y-3">
                <div><Label>Text found on the asset</Label><pre className="whitespace-pre-wrap font-sans text-base text-[#C9CCD2]">{res.text_found || '(none)'}</pre></div>
                {res.transcript != null && <div><Label>Transcript</Label><p className="text-base text-[#C9CCD2]">{res.transcript || '(no speech)'}</p></div>}
                <div><Label>Features</Label><div className="flex flex-wrap gap-1.5">{tagged.length ? tagged.map(([k, p]) => <Chip key={k} tone="outline" title={`P(yes) ${p.toFixed(2)}`}>{k.replace(/_/g, ' ')}</Chip>) : <span className="text-[#858B96]">none tagged</span>}</div></div>
                {res.objection && <p className="border-l-4 border-[#343946] pl-3 text-base italic text-[#A3A8B1]">Skeptic: {res.objection}</p>}
                {!!res.notes?.length && <ul className="list-disc space-y-0.5 pl-5 text-[#858B96]">{res.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
                <div className="text-xs text-[#646A75]">{a?.engine}{a?.rules_version ? ` · rules ${a.rules_version}` : ''} · ${a?.usd.toFixed(3)} · {a?.started_by}, {when(a?.finished_at || a?.started_at)}</div>
              </div>
            </details>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
            <h2 className="mb-2 text-lg font-semibold">Copy match</h2>
            {!auditedLatest && <p className="text-sm text-[#858B96]">{report.on_asset_copy.length ? 'Run the checks to compare the asset with the signed-off wording.' : 'Nothing to compare: this code’s copy runs in the post.'}</p>}
            {auditedLatest && copyRows && copyRows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="text-xs uppercase text-[#858B96]"><th className="pb-1 pr-3">Field</th><th className="pb-1 pr-3">Signed off</th><th className="pb-1 pr-3">On the asset</th><th className="pb-1">Result</th></tr></thead>
                  <tbody>{copyRows.map((r, i) => (
                    <tr key={i} className="border-t border-[#272B34] align-top">
                      <td className="py-1.5 pr-3 text-[#858B96]">{r.size ? `${r.size} · ` : ''}{r.field}{r.card ? `, card ${r.card}` : ''}</td>
                      <td className="py-1.5 pr-3">{r.signed_off}</td>
                      <td className="py-1.5 pr-3 text-[#C9CCD2]">{r.found || '–'}</td>
                      <td className="py-1.5"><Chip tone={COPY_STATUS[r.status]?.tone || 'grey'} className="text-xs">{r.found_on ? `on card ${r.found_on}` : COPY_STATUS[r.status]?.words || r.status}</Chip></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {auditedLatest && !copyRows?.length && (report.on_asset_copy.length
              ? (main.some(f => f.check === 'copy_match') ? <p className="text-sm text-red-200">See the copy-match flag below.</p> : <p className="text-sm text-emerald-200">The signed-off wording is on the asset.</p>)
              : <p className="text-sm text-[#858B96]">Nothing to compare: this code’s copy runs in the post.</p>)}
          </section>

          <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
            <h2 className="mb-2 text-lg font-semibold">Flags <span className="text-sm font-normal text-[#858B96]">{auditedLatest ? `${main.filter(f => f.severity === 'red').length} red · ${main.filter(f => f.severity === 'amber').length} amber · ${main.filter(f => f.severity === 'grey').length} grey` : ''}</span></h2>
            {!auditedLatest && <p className="text-sm text-[#858B96]">No finished checks for this upload yet.</p>}
            {auditedLatest && !main.length && <p className="text-sm text-emerald-200">No flags.</p>}
            <ul className="space-y-3">{main.map(f => <FlagRow key={f.id} meta={meta} flag={f} canOverride={canReady} copyOverrides={report.copy_overrides} onChanged={onChanged} onError={onError} />)}</ul>
            {cross.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-[#858B96]">How it travels: {cross.length} note{cross.length === 1 ? '' : 's'} from the other personas</summary>
                <ul className="mt-2 space-y-3">{cross.map(f => <FlagRow key={f.id} flag={f} canOverride={false} onChanged={onChanged} onError={onError} />)}</ul>
              </details>
            )}
          </section>

          {/* The producer's decision comes first for her; for everyone else it follows the checks. */}
          {row.asset
            ? <div className={producer ? 'order-first' : ''}><Decision meta={meta} asset={row.asset} stub={row.s.stub} can={canCompliance} onChanged={onChanged} onError={onError} /></div>
            : <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-4 text-sm text-[#858B96]"><h2 className="mb-1 text-lg font-semibold text-[#ECEDEF]">Trupanion’s decision</h2>Once the asset is uploaded, Trupanion reviews it with its copy and flags.</section>}
        </div>
      </div>
    </>
  );
}

function FlagRow({ flag, canOverride, copyOverrides = [], onChanged, onError, meta }: { meta?: Meta; flag: PfFlag; canOverride: boolean; copyOverrides?: NonNullable<PfReport['copy_overrides']>; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const [overriding, setOverriding] = useState(false);
  const [details, setDetails] = useState(false);
  const numeric = !!flag.why && /^\s*P\(yes\)/i.test(flag.why);
  const [why, setWhy] = useState('');
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await onChanged(); } catch (e: any) { onError(e.message); } };
  const agree = flag.agreements.filter(x => x.agree).length, disagree = flag.agreements.length - agree;
  const tone = flag.severity === 'red' ? 'red' : flag.severity === 'amber' ? 'amber' : 'grey';
  return (
    <li className={cn('rounded-lg border p-3', flag.severity === 'red' && !flag.override ? 'border-red-500/45 bg-red-500/5' : 'border-[#272B34]')}>
      <div className="flex gap-3">
        {flag.frame?.upload_id && flag.frame.position !== undefined && <AuthMedia path={studio.pfFile(flag.frame.upload_id, flag.frame.position)} className="h-20 w-20 shrink-0 object-cover" alt={flag.frame.label} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={tone}>{flag.check === 'copy_match' ? 'copy match' : chipName(flag.rule)}</Chip>
            <span className="text-base text-[#ECEDEF]">{flag.label}</span>
            {flag.persona && flag.cross_persona && <span className="text-xs text-[#858B96]">({flag.persona})</span>}
          </div>
          {flag.quote && (flag.check === 'copy_match'
            ? <div className="mt-1 text-sm">{/^signed off/i.test(flag.quote) ? '' : 'Missing from the asset: '}<mark className="bg-amber-400/30 px-1 text-amber-50">{flag.quote}</mark></div>
            : <div className="mt-1 text-sm">On the asset: <mark className="bg-amber-400/30 px-1 text-amber-50">{flag.quote}</mark></div>)}
          {flag.why && !numeric && <div className="mt-0.5 text-sm text-[#A3A8B1]">{flag.why}</div>}
          {whatToDo(flag.rule) && <div className="mt-0.5 text-sm"><span className="font-semibold">What to do:</span> {whatToDo(flag.rule)}</div>}
          <div className="mt-0.5 text-xs text-[#858B96]">{[flag.where, flag.frame?.label && !flag.frame.upload_id ? `frame ${flag.frame.label}${flag.frame.description ? `: ${flag.frame.description}` : ''}` : '', `Source: ${plainSource(flag.source)}`].filter(Boolean).join(' · ')}
            <button className="ml-2 underline-offset-2 hover:underline" onClick={() => setDetails(!details)}>{details ? 'hide details' : 'details'}</button>
            {details && <span className="ml-2">{[numeric ? flag.why : '', flag.rule, flag.source].filter(Boolean).join(' · ')}</span>}
          </div>
          {/* The same rule was overridden on the copy at sign-off: say so, and offer its reason here in one click. */}
          {flag.severity === 'red' && !flag.override && copyOverrides.filter(o => o.rule === flag.rule).map((o, k) => (
            <div key={k} className="mt-2 flex flex-wrap items-center gap-2 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-sm text-amber-100">
              <span className="min-w-0 flex-1">Overridden at sign-off ({o.field}) by {whoWords(o.by, o.for)}, {when(o.at)}: “{o.reason}”. The asset needs its own override.</span>
              {canOverride && <GhostButton className="px-2 py-0.5 text-xs" onClick={() => act(() => studio.pfOverride(flag.id, `Same as at sign-off (${o.by}): ${o.reason}`))}>Override here with the same reason</GhostButton>}
            </div>
          ))}
          {flag.override && <div className="mt-2 rounded border border-red-500/30 bg-red-500/5 px-2 py-1 text-sm text-red-100"><span className="font-semibold">Overridden</span> by {whoWords(flag.override.by, flag.override.for)}, {when(flag.override.at)}: “{flag.override.reason}”</div>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <GhostButton active={flag.mine === true} className="px-2 py-0.5 text-xs" onClick={() => act(() => studio.pfAgree(flag.id, true))}>Agree</GhostButton>
            <GhostButton active={flag.mine === false} className="px-2 py-0.5 text-xs" onClick={() => {
              const note = flag.mine === false ? undefined : window.prompt('Why not? (optional, helps tune the checks)') ?? undefined;
              act(() => studio.pfAgree(flag.id, false, note || undefined));
            }}>Disagree</GhostButton>
            {flag.agreements.length > 0 && <span className="text-xs text-[#858B96]" title={flag.agreements.map(x => `${x.by}: ${x.agree ? 'agree' : 'disagree'}${x.note ? ` (${x.note})` : ''}`).join('\n')}>{agree} agree · {disagree} disagree</span>}
            {flag.severity === 'red' && !flag.override && canOverride && !overriding && <GhostButton className="ml-auto px-2 py-0.5 text-xs" onClick={() => setOverriding(true)}>Override with a reason…</GhostButton>}
          </div>
          {overriding && (
            <div className="mt-2 space-y-2">
              <textarea rows={2} autoFocus className="w-full rounded-lg border-2 border-red-500/45 px-3 py-2 text-sm" placeholder="Why this asset can run as it is (recorded with your name, and shown here)" value={why} onChange={e => setWhy(e.target.value)} />
              <div className="flex flex-wrap items-center gap-2">
                <PinkButton className="px-3 py-1 text-sm" disabled={why.trim().length < 5} onClick={() => act(async () => { await studio.pfOverride(flag.id, why); setOverriding(false); setWhy(''); })}>Save override</PinkButton>
                <GhostButton className="text-sm" onClick={() => setOverriding(false)}>Cancel</GhostButton>
                <ForPicker meta={meta || null} doing="Overriding" />
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** Trupanion's decision on this code (and, if ticked, the other codes on the same asset). The producer records it, with who at Trupanion. */
function Decision({ meta, asset, stub, can, onChanged, onError }: { meta: Meta; asset: ComplianceAsset; stub: string; can: boolean; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const mine = asset.codes.find(c => c.stub === stub)!;
  const cur = mine?.compliance;
  const [note, setNote] = useState('');
  const [clientBy, setClientBy] = useState('');
  const [sendBack, setSendBack] = useState<'copy' | 'asset'>('asset');
  // Applies to this code, plus the codes on the same asset that stand where it stands (e.g. all still pending).
  const initial = () => new Set(asset.codes.filter(c => c.stub === stub || c.compliance.status === cur?.status).map(c => c.stub));
  const [apply, setApply] = useState<Set<string>>(initial);
  const [busy, setBusy] = useState(false);
  // A shared caption is one piece of copy: Trupanion's decision on it can go to every other code using the same wording.
  const sharedAlso = [...new Set(asset.codes.filter(c => apply.has(c.stub)).flatMap(c => c.compliance.shared_also || []))].filter(s => !apply.has(s));
  const [applyShared, setApplyShared] = useState(true);
  useEffect(() => { setNote(''); setSendBack(cur?.send_back || 'asset'); setApply(initial()); }, [asset.upload_id, stub, cur?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const reds = asset.flags.filter(f => !f.cross_persona && f.severity === 'red');
  // Each override once, with the codes it applies to (groupOverrides).
  const acceptedReds = groupOverrides([
    ...reds.filter(f => f.override && (!f.for_stub || apply.has(f.for_stub))).map(f => ({ kind: 'asset' as const, label: f.label.replace(/^\d+:\d+: /, ''), code: f.for_stub || undefined, reason: f.override!.reason })),
    ...asset.codes.filter(c => apply.has(c.stub)).flatMap(c => (c.compliance.override_details || c.compliance.overrides.map(label => ({ label, reason: '', by: '' })))
      .map(o => ({ kind: 'copy' as const, label: o.label, code: c.stub, by: o.by || undefined, reason: o.reason }))),
  ]);
  const needsNote = acceptedReds.length > 0 && !note.trim();
  async function set(status: ComplianceStatus) {
    setBusy(true);
    try {
      await studio.setAssetCompliance(asset.upload_id, { status, note: note.trim() || undefined, client_by: clientBy.trim() || undefined, send_back: status === 'changes_requested' ? sendBack : undefined, codes: apply.size === asset.codes.length ? undefined : [...apply], ...(sharedAlso.length && applyShared && status !== 'pending' ? { apply_shared: true } : {}) });
      setNote('');
      await onChanged();
    } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  }
  return (
    <section className={cn('space-y-3 rounded-xl bg-[#16181D] p-5', can ? 'border-2' : 'border border-[#272B34]')} style={can ? { borderColor: PINK } : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">Trupanion’s decision</h2>
        {cur && <span className={cn('rounded-full border px-3 py-0.5 text-sm font-semibold', COMPLIANCE_TONE[cur.status])}>{COMPLIANCE_WORDS[cur.status]}</span>}
      </div>
      {cur && cur.status !== 'pending' && <p className="text-sm text-[#A3A8B1]">{cur.client_by ? `Trupanion: ${cur.client_by} · ` : ''}recorded by {whoWords(cur.by, cur.for)}, {when(cur.at)}{cur.note ? ` · “${cur.note}”` : ''}</p>}
      {cur?.stale && <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">{cur.stale}: review it again.</p>}
      {(mine?.compliance.check_specifically?.length ?? 0) > 0 && (
        <div className="text-sm text-amber-200">Please check specifically:
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{mine!.compliance.check_specifically!.map(x => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      {!can && <p className="text-sm text-[#858B96]">Vivan (or an admin) records Trupanion’s decisions.</p>}
      {can && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Label>Who at Trupanion</Label>
            <input aria-label="Who at Trupanion made the decision" className="min-w-0 flex-1 rounded-lg border-2 border-[#343946] px-3 py-1.5 text-base sm:min-w-[14rem]" placeholder="e.g. J. Doe, Trupanion legal" value={clientBy} onChange={e => setClientBy(e.target.value)} />
          </div>
          {acceptedReds.length > 0 && (
            <div className="rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
              <div className="font-semibold">Went through with {acceptedReds.length === 1 ? 'an overridden red flag' : `${acceptedReds.length} overridden red flags`}. To clear, say in the note what Trupanion accepted.</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{acceptedReds.map((x, i) => <li key={i}>{x.label} <span className="text-amber-200/70">({overrideWhere(x)}{x.reason ? `; overridden because “${x.reason}”` : ''})</span></li>)}</ul>
            </div>
          )}
          <textarea rows={2} className={cn('w-full rounded-lg border-2 px-3 py-2 text-base', needsNote ? 'border-amber-400/60' : 'border-[#343946]')} placeholder={acceptedReds.length ? 'Note (required to clear: what Trupanion accepted; for changes: what needs changing)' : 'Note (required for changes: what needs changing)'} value={note} onChange={e => setNote(e.target.value)} />
          {asset.codes.length > 1 && (
            <fieldset className="text-sm">
              <legend className="mb-1 text-[#858B96]">Applies to {apply.size} of the {asset.codes.length} copy options on this ad</legend>
              {asset.codes.map(c => (
                <label key={c.stub} className="mr-4 inline-flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" className="accent-[#D94D8F]" checked={apply.has(c.stub)} onChange={e => setApply(s => { const n = new Set(s); if (e.target.checked) n.add(c.stub); else n.delete(c.stub); return n; })} />
                  <span className="font-mono">{c.stub.replace(/^.*?_([A-Z]\d+)_.*$/, '$1')}</span>
                  <span className="text-xs text-[#646A75]">{COMPLIANCE_WORDS[c.compliance.status].toLowerCase()}</span>
                </label>
              ))}
            </fieldset>
          )}
          {sharedAlso.length > 0 && (
            <label className="flex cursor-pointer items-start gap-2 text-sm text-[#C9CCD2]">
              <input type="checkbox" className="mt-1 accent-[#D94D8F]" checked={applyShared} onChange={e => setApplyShared(e.target.checked)} />
              <span>Also record it for the {sharedAlso.length} other code{sharedAlso.length === 1 ? '' : 's'} using this shared caption on the same wording
                <span className="block font-mono text-xs text-[#858B96]">{sharedAlso.join(', ')}</span>
                <span className="block text-xs text-[#858B96]">Covers the caption only: each code’s own asset still needs its decision.</span>
              </span>
            </label>
          )}
          <fieldset className="text-sm">
            <legend className="mb-1 text-[#858B96]">If you request changes, what goes back?</legend>
            {(['asset', 'copy'] as const).map(k => <label key={k} className="mr-5 inline-flex cursor-pointer items-center gap-2"><input type="radio" name={`send-back-${stub}`} className="accent-[#D94D8F]" checked={sendBack === k} onChange={() => setSendBack(k)} />{SEND_BACK[k]}</label>)}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <PinkButton className="px-4 py-2 text-base" disabled={busy || !apply.size || !clientBy.trim() || needsNote} title={!clientBy.trim() ? 'Say who at Trupanion cleared it' : needsNote ? 'Say in the note what Trupanion accepted' : undefined} onClick={() => set('cleared')}>Cleared by Trupanion</PinkButton>
            <GhostButton className="px-4 py-2 text-base" disabled={busy || !apply.size || !note.trim() || !clientBy.trim()} title={!clientBy.trim() ? 'Say who at Trupanion asked for changes' : !note.trim() ? 'Say what needs changing first' : undefined} onClick={() => set('changes_requested')}>Changes requested</GhostButton>
            <GhostButton className="px-4 py-2 text-base" disabled={busy || !apply.size} onClick={() => set('pending')}>Back to pending</GhostButton>
            <ForPicker meta={meta} doing="Recording" />
          </div>
        </>
      )}
      <p className="flex flex-wrap items-center gap-2 text-xs text-[#646A75]"><PersonaChip meta={meta} persona={asset.persona} short /> {territoryName(meta.territories[asset.territory])}{inRegion(asset.region)} · the decision is Trupanion’s; Studio records it.</p>
    </section>
  );
}
