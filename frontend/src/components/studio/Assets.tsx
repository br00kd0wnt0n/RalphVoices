// Step 4, Assets (Pre-flight + Compliance on one screen): per code, the same code list and the same image, with one
// status track: Uploaded → Checks → Pre-flight passed → Trupanion decision → Ready to traffic (plus Changes requested).
// Every action is kept: upload, agree/disagree, override, mark Pre-flight passed, record Trupanion's decision per code
// (with who at Trupanion), send back to the copy or the visual. The producer (compliance emails) lands on "Awaiting
// Trupanion"; everyone else on "Needs upload or review".
import { useCallback, useEffect, useRef, useState } from 'react';
import { studio, type CodeCompliance, type ComplianceAsset, type ComplianceStatus, type ComplianceView, type Meta, type PfFlag, type PfReport, type PfStub, type StudioEvent } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { personaEdge } from '@/lib/personaColors';
import { personaColor, tint } from '@/lib/personaColors';
import { AuthMedia, PersonaChip, PersonaDot, inViewFilter, personaKeys, type ViewFilter, Chip, CodeChip, COMPLIANCE_TONE, COMPLIANCE_WORDS, COPY_STATUS, GhostButton, Intro, Label, NAMING_TIP, PINK, PinkButton, SEV_ORDER, chipName, codeState, inRegion, params, plainSource, regionOf, territoryName, when, whatToDo } from './ui';

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

/** Codes grouped by the visual they run on (codes sharing an upload together; before any upload, the same visual letter). */
function byVisual(rs: CodeRow[]): Array<[string, CodeRow[]]> {
  const groups = new Map<string, CodeRow[]>();
  for (const r of rs) {
    const s = r.s;
    const k = s.upload ? `u:${s.upload.id}` : s.visual_key ? `v:${s.visual_key}` : `s:${s.stub}`;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  return [...groups.entries()].map(([k, g]) => [k.startsWith('u:') ? g[0].s.upload!.files.map(f => f.filename).join(', ') : k.startsWith('v:') ? 'not uploaded yet' : '', g]);
}

export function Assets({ meta, view, setView, onBuild }: { meta: Meta; view: ViewFilter; setView: (v: ViewFilter) => void; onBuild: () => void }) {
  const enabled = !!meta.preflight?.enabled;
  const canReady = !!meta.preflight?.can_set_ready;
  const canCompliance = meta.can_set_compliance !== false;
  // The producer (compliance emails, not an admin or the creative lead) starts on what's waiting for Trupanion, across every set.
  const producer = canCompliance && !meta.user?.admin && !canReady;
  const [filter, setFilter] = useState<Filter>(producer ? 'awaiting' : 'needs');
  const [format, setFormat] = useState<string>('all');
  const [stubs, setStubs] = useState<PfStub[] | null>(null);
  const [comp, setComp] = useState<ComplianceView | null>(null);
  const [sel, setSel] = useState<string | null>(params.get('stub'));
  const [report, setReport] = useState<PfReport | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [pending, setPending] = useState<{ upload_id: string; estimate: { usd: number; seconds: number } } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const esRef = useRef<{ close: () => void } | null>(null);
  useEffect(() => () => esRef.current?.close(), []);

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
  useEffect(() => { setPending(null); setFiles([]); setReport(null); if (sel && enabled) loadReport(sel).catch(e => setError(e.message)); }, [sel, enabled, loadReport]);

  const rows: CodeRow[] = (stubs || []).map(s => {
    const asset = comp?.assets.find(a => a.codes.some(c => c.stub === s.stub));
    return { s, asset, c: asset?.codes.find(c => c.stub === s.stub)?.compliance };
  });
  const formatOf = (s: PfStub) => String(meta.territories[s.territory]?.format || '').toUpperCase() || 'OTHER';
  const scoped = rows.filter(r => inViewFilter(r.s, view) && (format === 'all' || formatOf(r.s) === format));
  const shown = scoped.filter(r => inFilter(r, filter));
  // Keep a selection in view: the first shown code when the current one isn't in the list.
  useEffect(() => {
    if (!stubs) return;
    if (!sel || !shown.some(r => r.s.stub === sel)) setSel(shown[0]?.s.stub ?? (sel && scoped.some(r => r.s.stub === sel) ? sel : null));
  }, [stubs, comp, filter, format, view.persona, view.territory, view.region]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return <div className="max-w-3xl rounded-xl border border-[#272B34] bg-[#16181D] p-6 text-base text-[#A3A8B1]">Assets need the database: in <code>backend/</code>, run <code>npx tsx scripts/studio.ts serve --store pg --database-url …</code> (hosted Studio has it on).</div>;

  async function upload(also: string[]) {
    if (!sel || !files.length) return;
    setError(''); setProgress('Uploading…');
    try {
      const r = await studio.pfUpload(sel, files, also);
      if (r.format_notes?.length) setError(r.format_notes.join(' '));
      setPending({ upload_id: r.upload_id, estimate: r.estimate });
      setFiles([]); setProgress('');
      await refresh();
    } catch (e: any) { setProgress(''); setError(e.message); }
  }
  async function runAudit(uploadId: string) {
    setError('');
    try {
      let r;
      try { r = await studio.pfAudit(uploadId); }
      catch (e: any) {
        if (e.status !== 409) throw e;
        if (!window.confirm(`This check is estimated at $${e.body.estimate.toFixed(2)}, over the $${meta.ask_over} ask-first line. Run it?`)) return;
        r = await studio.pfAudit(uploadId, true);
      }
      setPending(null);
      setProgress('Starting the checks…');
      await refresh();
      esRef.current?.close();
      esRef.current = studio.events(r.job, (e: StudioEvent) => {
        if (e.type === 'status') setProgress(e.message);
        if (e.type === 'error') { setProgress(''); setError(`The checks stopped: ${e.message}`); refresh(); }
        if (e.type === 'done') { setProgress(''); refresh(); }
      });
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
  const count = (f: Filter) => scoped.filter(r => inFilter(r, f)).length;
  const row = rows.find(r => r.s.stub === sel) || null;

  return (
    <div className="max-w-[1500px] space-y-5">
      <Intro title="Assets" line="Each code’s finished asset: checked, passed, then Trupanion’s decision.">
        <p>Upload the asset for a signed-off code (one upload can serve every code on the same visual). Studio checks it against the signed-off copy and the rules: agree or disagree with each flag; red flags are fixed with a new upload or overridden with a reason. The creative lead then marks it Pre-flight passed.</p>
        <p>Vivan coordinates with Trupanion and records their decision here, per code, with who at Trupanion made it: cleared, or changes requested with a note (the copy goes back to Build & sign off, the visual to a new upload). A code is Ready to traffic once Pre-flight has passed and Trupanion has cleared it.</p>
      </Intro>
      {meta.preflight?.storage?.startsWith('refused') && <div className="rounded-lg border-2 border-amber-400/50 bg-amber-400/10 p-3 text-base text-amber-100">Uploads are switched off: {meta.preflight.storage.replace(/^refused:\s*/, '')}. An admin sets this on Railway.</div>}
      {error && <div className="rounded-lg border-2 border-red-500/45 bg-red-500/10 p-3 text-base text-red-200">{error}</div>}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-xs font-semibold uppercase tracking-wider text-[#646A75]">Status</span>
          {FILTERS.map(([k, l]) => <GhostButton key={k} active={filter === k} onClick={() => setFilter(k)} className="text-base">{l} ({count(k)})</GhostButton>)}
          {filter === (producer ? 'awaiting' : 'needs') && <span className="text-xs text-[#646A75]">your default</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-xs font-semibold uppercase tracking-wider text-[#646A75]">Persona</span>
          <button className={chip(view.persona === 'all')} onClick={() => setView({ ...view, persona: 'all', territory: 'all' })}>All</button>
          {personaKeys(meta.personas).map(p => {
            const pc = personaColor(p), on = view.persona === p;
            return <button key={p} className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition" style={on ? { borderColor: pc.edge, background: tint(pc.base, 0.22), color: pc.light } : { borderColor: tint(pc.base, 0.45), color: pc.light }}
              onClick={() => setView({ ...view, persona: on ? 'all' : p, territory: 'all' })}><PersonaDot persona={p} />{meta.personas[p].name.replace(/\s*\(.*\)$/, '')}</button>;
          })}
          <span className="ml-3 text-xs font-semibold uppercase tracking-wider text-[#646A75]">Region</span>
          {(['all', ...(meta.regions || ['US', 'CA'])] as const).map(r => <button key={r} className={chip(view.region === r)} onClick={() => setView({ ...view, region: r as ViewFilter['region'] })}>{r === 'all' ? 'All' : r === 'CA' ? 'Canada' : r}</button>)}
          <span className="ml-3 text-xs font-semibold uppercase tracking-wider text-[#646A75]">Format</span>
          {['all', ...formats].map(f => <button key={f} className={chip(format === f)} onClick={() => setFormat(f)}>{f === 'all' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}</button>)}
        </div>
      </div>

      {stubs && !scoped.length && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#272B34] bg-[#16181D] p-5 text-base text-[#A3A8B1]">
          <span className="mr-auto">{view.persona !== 'all' || view.territory !== 'all' || view.region !== 'all' || format !== 'all' ? 'Nothing signed off for this filter.' : 'Nothing signed off yet in this round.'} Each code gets its asset here once it’s signed off.</span>
          {(view.persona !== 'all' || view.territory !== 'all' || view.region !== 'all' || format !== 'all') && <GhostButton onClick={() => { setView({ persona: 'all', territory: 'all', region: 'all' }); setFormat('all'); }}>Show all</GhostButton>}
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
                  {byVisual(rs).map(([visual, group]) => group.map((r, gi) => (
                    <li key={r.s.stub} className={cn(visual && group.length > 1 && gi > 0 && '-mt-1 ml-3 border-l-2 border-[#343946] pl-2')}>
                      {visual && gi === 0 && group.length > 1 && <div className="mb-1 px-1 text-xs text-[#858B96]">One visual, {group.length} codes: {visual}</div>}
                      <button onClick={() => setSel(r.s.stub)} className={cn('w-full rounded-lg border px-3 py-2 text-left transition', sel === r.s.stub ? 'border-[#D94D8F] bg-[#D94D8F]/10' : 'border-[#272B34] hover:border-[#4A505D]')}>
                        <div className="break-all font-mono text-sm" title={NAMING_TIP}>{r.s.stub}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <Track r={r} compact />
                          <CodeChip state={stateOf(r)} className="ml-auto" />
                        </div>
                        <div className="mt-1 truncate text-sm text-[#858B96]">{r.s.copy.map(c => c.text).join(' · ')}</div>
                      </button>
                    </li>
                  )))}
                </ul>
                </div>
                ))}
              </section>
            ))}
          </aside>

          <main className="min-w-0 space-y-4">
            {!row && <div className="text-base text-[#858B96]">Choose a code.</div>}
            {row && !report && <div className="text-base text-[#858B96]">Loading…</div>}
            {row && report && report.stub === row.s.stub && (
              <CodeView meta={meta} row={row} report={report} stubs={stubs || []} canReady={canReady} canCompliance={canCompliance} progress={progress} pending={pending} files={files} setFiles={setFiles}
                onUpload={upload} onAudit={runAudit} onChanged={refresh} onError={setError} />
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function CodeView({ meta, row, report, stubs, canReady, canCompliance, progress, pending, files, setFiles, onUpload, onAudit, onChanged, onError }: {
  meta: Meta; row: CodeRow; report: PfReport; stubs: PfStub[]; canReady: boolean; canCompliance: boolean; progress: string;
  pending: { upload_id: string; estimate: { usd: number; seconds: number } } | null;
  files: File[]; setFiles: (f: File[]) => void; onUpload: (also: string[]) => void; onAudit: (uploadId: string) => void;
  onChanged: () => Promise<void>; onError: (m: string) => void;
}) {
  report = { ...report, same_visual_as: report.same_visual_as ?? [], on_asset_copy: report.on_asset_copy ?? report.copy, post_copy: report.post_copy ?? [] };
  const a = report.audit;
  const res = a?.result || null;
  const up = report.upload;
  const current = !!(a && up && a.upload_id === up.id);
  const main = (current ? report.flags : []).filter(f => !f.cross_persona).sort((x, y) => (x.check === 'copy_match' ? -1 : 0) - (y.check === 'copy_match' ? -1 : 0) || SEV_ORDER[x.severity] - SEV_ORDER[y.severity]);
  const cross = (current ? report.flags : []).filter(f => f.cross_persona);
  const openRed = main.filter(f => f.severity === 'red' && !f.override).length;
  const auditForLatest = current;
  const auditedLatest = auditForLatest && a!.status === 'done';
  const ready = report.status.status === 'ready';
  const readyBlock = !up ? 'Upload the asset first.' : !auditForLatest ? 'Run the checks on this upload first.' : a!.status === 'running' || a!.status === 'queued' ? 'The checks are still running.' : a!.status === 'failed' ? 'The checks failed; run them again.' : openRed ? `${openRed} red flag${openRed === 1 ? '' : 's'} to fix (a new upload) or override.` : '';
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await onChanged(); } catch (e: any) { onError(e.body?.blocking ? `${e.message}: ${e.body.blocking.map((b: any) => b.label || b.rule).join('; ')}` : e.message); } };
  const copyRows = res?.copy_match ?? res?.report?.copy_match;
  const sameVisual = (s: PfStub) => !!report.visual_key && s.visual_key === report.visual_key;
  const siblings = stubs.filter(s => s.stub !== report.stub && s.persona === report.persona && s.territory === report.territory && regionOf(s) === regionOf(report)).sort((x, y) => Number(sameVisual(y)) - Number(sameVisual(x)));
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
            <div className="flex flex-wrap items-center gap-2"><span className="break-all font-mono text-lg font-semibold" title={NAMING_TIP}>{report.stub}</span><CodeChip state={stateOf(row)} /></div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#858B96]"><PersonaChip meta={meta} persona={report.persona} short /><span>{territoryName(meta.territories[report.territory]) || report.territory}{inRegion(report.region)} · signed off in {report.signoff_id}</span></div>
          </div>
          {canReady && (ready
            ? <GhostButton className="text-base" onClick={() => act(() => studio.pfReady(report.stub, false))} title={`Pre-flight passed by ${report.status.ready_by}, ${when(report.status.ready_at)}`}>Take back Pre-flight</GhostButton>
            : <PinkButton className="px-4 py-2 text-base" disabled={!!readyBlock} title={readyBlock || 'Ready to traffic once Trupanion has cleared it too'} onClick={() => act(() => studio.pfReady(report.stub, true))}>Mark Pre-flight passed</PinkButton>)}
        </div>
        <Track r={row} />
        <p className="text-sm text-[#A3A8B1]">
          {ready ? `Pre-flight passed by ${report.status.ready_by}, ${when(report.status.ready_at)}. ` : readyBlock ? `${readyBlock} ` : ''}
          {report.traffic && !report.traffic.ready && report.traffic.blocker ? report.traffic.blocker : report.traffic?.ready ? 'Ready to traffic.' : ''}
          {!canReady && !ready && <span className="text-[#646A75]"> Pre-flight is passed by the creative lead or an admin.</span>}
        </p>
        {c?.status === 'changes_requested' && (
          <div className="rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
            <span className="font-semibold">Trupanion asked for changes {c.send_back === 'asset' ? 'to the visual' : 'to the copy'}{c.client_by ? ` (${c.client_by})` : ''}</span>{c.note ? `: “${c.note}”` : ''}
            <div className="text-amber-200/80">{c.send_back === 'asset' ? 'Upload a new version below; it goes back to Trupanion.' : 'The copy is edited and signed off again at Build & sign off.'} {c.by ? `Recorded by ${c.by}, ${when(c.at)}.` : ''}</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
            <Label>The asset</Label>
            {up ? (
              <>
                <div className={cn('grid gap-2', up.kind === 'carousel' ? 'grid-cols-3' : 'grid-cols-1')}>
                  {up.files.map(f => (
                    <div key={f.position}>
                      <AuthMedia path={studio.pfFile(up.id, f.position)} video={up.kind === 'video'} alt={f.filename} className={up.kind === 'carousel' ? 'aspect-square w-full' : 'max-h-96 w-full'} />
                      {up.kind === 'carousel' && <div className="mt-0.5 text-center text-xs text-[#858B96]">card {f.position + 1}</div>}
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-sm text-[#858B96]">{up.kind} · {up.files.map(f => f.filename).join(', ')} · {up.uploaded_by}, {when(up.uploaded_at)}</div>
                {report.same_visual_as.length > 0 && <p className="mt-1 text-sm text-[#A3A8B1]">Same visual as <span className="font-mono">{report.same_visual_as.join(', ')}</span>.</p>}
              </>
            ) : <p className="text-sm text-[#858B96]">Nothing uploaded yet.</p>}
            {report.format_note && <p className="mt-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">{report.format_note}</p>}
            <div className="mt-3 space-y-2 border-t border-[#272B34] pt-3">
              <input key={up?.id || 'none'} type="file" multiple accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime" onChange={e => setFiles([...(e.target.files || [])])} className="max-w-full text-sm" />
              <p className="text-xs text-[#646A75]">One image (static), several (carousel cards, in order), or one video. A new upload replaces the asset and reopens it for review.</p>
              {siblings.length > 0 && files.length > 0 && (
                <fieldset className="rounded-lg border border-[#272B34] px-3 py-2">
                  <legend className="px-1 text-xs text-[#858B96]">Also use this visual for (codes signed off on this visual are ticked)</legend>
                  {siblings.map(s => (
                    <label key={s.stub} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-[#D94D8F]" checked={also.includes(s.stub)} onChange={e => setAlso(cur => e.target.checked ? [...cur, s.stub] : cur.filter(x => x !== s.stub))} />
                      <span className="font-mono">{s.stub}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <PinkButton className="px-4 py-1.5 text-base" disabled={!files.length || !!progress} onClick={() => onUpload(also)}>{up ? 'Upload a new version' : 'Upload'}</PinkButton>
                {files.length > 0 && <span className="text-sm text-[#858B96]">{files.length} file{files.length === 1 ? '' : 's'}</span>}
              </div>
              {(pending || (up && !auditForLatest)) && !progress && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#343946] bg-[#101216] px-3 py-2 text-sm">
                  <span>{pending ? `About $${pending.estimate.usd.toFixed(2)} and ${secs(pending.estimate.seconds)} to check.` : 'Not checked yet.'}</span>
                  <PinkButton className="ml-auto px-3 py-1 text-sm" onClick={() => onAudit(pending?.upload_id || up!.id)}>Run the checks</PinkButton>
                </div>
              )}
              {a && up && auditForLatest && a.status === 'failed' && !progress && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-500/45 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                  <span className="min-w-0 flex-1">The checks failed: {a.error}</span>
                  <PinkButton className="px-3 py-1 text-sm" onClick={() => onAudit(up.id)}>Run again</PinkButton>
                </div>
              )}
              {a?.stale && auditForLatest && up && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                  <span className="min-w-0 flex-1">{a.stale}</span>
                  <PinkButton className="px-3 py-1 text-sm" disabled={!!progress} onClick={() => onAudit(up.id)}>Check again</PinkButton>
                </div>
              )}
              {a && up && auditedLatest && !a.stale && !progress && (
                <button className="text-xs text-[#858B96] underline-offset-2 hover:text-[#ECEDEF] hover:underline" onClick={() => onAudit(up.id)} title="Run the checks again on this upload (e.g. after a rules change)">Check again</button>
              )}
              {progress && <div className="flex items-center gap-2 text-sm font-medium" style={{ color: PINK }}><span className="animate-pulse">●</span> {progress}</div>}
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

        <div className="space-y-4">
          <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
            <h2 className="mb-2 text-lg font-semibold">Copy match</h2>
            {!auditedLatest && <p className="text-sm text-[#858B96]">{report.on_asset_copy.length ? 'Run the checks to compare the asset with the signed-off wording.' : 'Nothing to compare: this code’s copy runs in the post.'}</p>}
            {auditedLatest && copyRows && copyRows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="text-xs uppercase text-[#858B96]"><th className="pb-1 pr-3">Field</th><th className="pb-1 pr-3">Signed off</th><th className="pb-1 pr-3">On the asset</th><th className="pb-1">Result</th></tr></thead>
                  <tbody>{copyRows.map((r, i) => (
                    <tr key={i} className="border-t border-[#272B34] align-top">
                      <td className="py-1.5 pr-3 text-[#858B96]">{r.field}{r.card ? `, card ${r.card}` : ''}</td>
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
            <ul className="space-y-3">{main.map(f => <FlagRow key={f.id} flag={f} canOverride={canReady} onChanged={onChanged} onError={onError} />)}</ul>
            {cross.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-[#858B96]">How it travels: {cross.length} note{cross.length === 1 ? '' : 's'} from the other personas</summary>
                <ul className="mt-2 space-y-3">{cross.map(f => <FlagRow key={f.id} flag={f} canOverride={false} onChanged={onChanged} onError={onError} />)}</ul>
              </details>
            )}
          </section>

          {row.asset
            ? <Decision meta={meta} asset={row.asset} stub={row.s.stub} can={canCompliance} onChanged={onChanged} onError={onError} />
            : <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-4 text-sm text-[#858B96]"><h2 className="mb-1 text-lg font-semibold text-[#ECEDEF]">Trupanion’s decision</h2>Once the asset is uploaded, Trupanion reviews it with its copy and flags.</section>}
        </div>
      </div>
    </>
  );
}

function FlagRow({ flag, canOverride, onChanged, onError }: { flag: PfFlag; canOverride: boolean; onChanged: () => Promise<void>; onError: (m: string) => void }) {
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
          {flag.override && <div className="mt-2 rounded border border-red-500/30 bg-red-500/5 px-2 py-1 text-sm text-red-100"><span className="font-semibold">Overridden</span> by {flag.override.by}, {when(flag.override.at)}: “{flag.override.reason}”</div>}
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
              <div className="flex gap-2">
                <PinkButton className="px-3 py-1 text-sm" disabled={why.trim().length < 5} onClick={() => act(async () => { await studio.pfOverride(flag.id, why); setOverriding(false); setWhy(''); })}>Save override</PinkButton>
                <GhostButton className="text-sm" onClick={() => setOverriding(false)}>Cancel</GhostButton>
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
  useEffect(() => { setNote(''); setSendBack(cur?.send_back || 'asset'); setApply(initial()); }, [asset.upload_id, stub, cur?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const reds = asset.flags.filter(f => !f.cross_persona && f.severity === 'red');
  const acceptedReds = [
    ...reds.filter(f => f.override && (!f.for_stub || apply.has(f.for_stub))).map(f => ({ key: f.id, label: f.label, where: `asset check${f.for_stub ? `, ${f.for_stub}` : ''}`, reason: f.override!.reason })),
    ...asset.codes.filter(c => apply.has(c.stub)).flatMap(c => (c.compliance.override_details || c.compliance.overrides.map(label => ({ label, reason: '', by: '' })))
      .map((o, i) => ({ key: `${c.stub}-${i}`, label: o.label, where: `copy, ${c.stub}${o.by ? `, by ${o.by}` : ''}`, reason: o.reason }))),
  ];
  const needsNote = acceptedReds.length > 0 && !note.trim();
  async function set(status: ComplianceStatus) {
    setBusy(true);
    try {
      await studio.setAssetCompliance(asset.upload_id, { status, note: note.trim() || undefined, client_by: clientBy.trim() || undefined, send_back: status === 'changes_requested' ? sendBack : undefined, codes: apply.size === asset.codes.length ? undefined : [...apply] });
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
      {cur && cur.status !== 'pending' && <p className="text-sm text-[#A3A8B1]">{cur.client_by ? `Trupanion: ${cur.client_by} · ` : ''}recorded by {cur.by}, {when(cur.at)}{cur.note ? ` · “${cur.note}”` : ''}</p>}
      {cur?.stale && <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">{cur.stale}: review it again.</p>}
      {mine?.compliance.overrides.length > 0 && <p className="text-sm text-amber-200">Please check specifically: {mine.compliance.overrides.join('; ')}</p>}
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
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{acceptedReds.map(x => <li key={x.key}>{x.label} <span className="text-amber-200/70">({x.where}{x.reason ? `; overridden because “${x.reason}”` : ''})</span></li>)}</ul>
            </div>
          )}
          <textarea rows={2} className={cn('w-full rounded-lg border-2 px-3 py-2 text-base', needsNote ? 'border-amber-400/60' : 'border-[#343946]')} placeholder={acceptedReds.length ? 'Note (required to clear: what Trupanion accepted; for changes: what needs changing)' : 'Note (required for changes: what needs changing)'} value={note} onChange={e => setNote(e.target.value)} />
          {asset.codes.length > 1 && (
            <fieldset className="text-sm">
              <legend className="mb-1 text-[#858B96]">Applies to {apply.size} of the {asset.codes.length} codes on this asset</legend>
              {asset.codes.map(c => (
                <label key={c.stub} className="mr-4 inline-flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" className="accent-[#D94D8F]" checked={apply.has(c.stub)} onChange={e => setApply(s => { const n = new Set(s); if (e.target.checked) n.add(c.stub); else n.delete(c.stub); return n; })} />
                  <span className="font-mono">{c.stub.replace(/^.*?_([A-Z]\d+)_.*$/, '$1')}</span>
                  <span className="text-xs text-[#646A75]">{COMPLIANCE_WORDS[c.compliance.status].toLowerCase()}</span>
                </label>
              ))}
            </fieldset>
          )}
          <fieldset className="text-sm">
            <legend className="mb-1 text-[#858B96]">If you request changes, what goes back?</legend>
            {(['asset', 'copy'] as const).map(k => <label key={k} className="mr-5 inline-flex cursor-pointer items-center gap-2"><input type="radio" name={`send-back-${stub}`} className="accent-[#D94D8F]" checked={sendBack === k} onChange={() => setSendBack(k)} />{SEND_BACK[k]}</label>)}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <PinkButton className="px-4 py-2 text-base" disabled={busy || !apply.size || !clientBy.trim() || needsNote} title={!clientBy.trim() ? 'Say who at Trupanion cleared it' : needsNote ? 'Say in the note what Trupanion accepted' : undefined} onClick={() => set('cleared')}>Cleared by Trupanion</PinkButton>
            <GhostButton className="px-4 py-2 text-base" disabled={busy || !apply.size || !note.trim() || !clientBy.trim()} title={!clientBy.trim() ? 'Say who at Trupanion asked for changes' : !note.trim() ? 'Say what needs changing first' : undefined} onClick={() => set('changes_requested')}>Changes requested</GhostButton>
            <GhostButton className="px-4 py-2 text-base" disabled={busy || !apply.size} onClick={() => set('pending')}>Back to pending</GhostButton>
          </div>
        </>
      )}
      <p className="flex flex-wrap items-center gap-2 text-xs text-[#646A75]"><PersonaChip meta={meta} persona={asset.persona} short /> {territoryName(meta.territories[asset.territory])}{inRegion(asset.region)} · the decision is Trupanion’s; Studio records it.</p>
    </section>
  );
}
