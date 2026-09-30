// One Export menu for every download (top right). It defaults to everything Ready to traffic in the round (the round the
// header shows), with the option to narrow to one persona × territory; then the handoff pack, the asset handoff, the
// compliance sheet, the Sheets round trip, kept lines and the features for the weekly read.
import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { studio, type Batch, type Meta } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { PersonaDot, territoryName, type Ctx, type ViewFilter } from './ui';

export function ExportMenu({ meta, ctx, view, batch, onImported }: { meta: Meta | null; ctx: Ctx; view: ViewFilter; batch: Batch | null; onImported: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  // Narrowing: a persona × territory narrowed on Assets wins; else the writing context.
  const target = view.persona !== 'all' && view.territory !== 'all' ? { persona: view.persona, territory: view.territory, region: view.region === 'all' ? ctx.region : view.region } : ctx;
  const q = `?persona=${encodeURIComponent(target.persona)}&territory=${encodeURIComponent(target.territory)}&region=${target.region}`;
  const set = territoryName(meta?.territories[target.territory]) || target.territory;
  const persona = (meta?.personas[target.persona]?.name || target.persona).replace(/\s*\(.*\)$/, '');
  const inScope = (row: Record<string, string>) => !narrow || (row.Persona === target.persona && row.Territory === target.territory && (!row.Region || row.Region === target.region));
  const ready = (v: string) => v === 'yes' || /^Ready to traffic/.test(v || '');
  const run = batch && batch.brief.territory === ctx.territory ? batch : null;
  const dl = (path: string, name: string) => { setOpen(false); studio.download(path, name).catch(e => onImported(`Download failed: ${e.message}`)); };
  const dlReady = (path: string, name: string) => {
    setOpen(false);
    studio.downloadCsvRows(path, name, row => ready(row['Ready to traffic']) && inScope(row))
      .then(n => onImported(`${n} code${n === 1 ? '' : 's'} ready to traffic${narrow ? ` (${persona} · ${set})` : ' this month'}.`))
      .catch(e => onImported(`Download failed: ${e.message}`));
  };
  async function importSheet(file: File) {
    setOpen(false);
    try {
      const r = await studio.ingest(await file.text());
      onImported(`Read ${r.rows} rows: ${r.kept} keep, ${r.edited} edit, ${r.cut} cut${r.unknown.length ? `; ${r.unknown.length} unknown ids` : ''}. Taste examples: ${r.taste_total}.`);
    } catch (e: any) { onImported(`Import failed: ${e.message}`); }
  }
  const Item = ({ onClick, children, disabled, title }: { onClick: () => void; children: React.ReactNode; disabled?: boolean; title?: string }) => (
    <button role="menuitem" disabled={disabled} title={title} onClick={onClick} className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-[#ECEDEF] hover:bg-[#272B34] disabled:opacity-40 disabled:hover:bg-transparent">{children}</button>
  );
  const Head = ({ children }: { children: React.ReactNode }) => <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[#646A75]">{children}</div>;
  const scopeName = <span className="inline-flex items-center gap-1.5"><PersonaDot persona={target.persona} />{persona} · {set}</span>;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} title="Export: every download" aria-label="Export" aria-haspopup="menu" aria-expanded={open} className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-sm transition', open ? 'border-[#ECEDEF] text-[#ECEDEF]' : 'border-transparent text-[#858B96] hover:text-[#ECEDEF]')}>
        <Download className="h-4 w-4" aria-hidden /><span className="hidden min-[1600px]:inline">Export</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-30 max-h-[80vh] w-[22rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-[#343946] bg-[#16181D] p-1.5 shadow-2xl">
          <div className="flex gap-1 rounded-lg bg-[#101216] p-1 text-xs">
            <button className={cn('flex-1 rounded-md px-2 py-1', !narrow ? 'bg-[#ECEDEF] font-semibold text-[#0E0F12]' : 'text-[#C9CCD2]')} onClick={() => setNarrow(false)}>Everything this month</button>
            <button className={cn('flex-1 truncate rounded-md px-2 py-1', narrow ? 'bg-[#ECEDEF] font-semibold text-[#0E0F12]' : 'text-[#C9CCD2]')} onClick={() => setNarrow(true)} title={`${persona} · ${set}`}>Just {persona}</button>
          </div>
          <p className="px-3 pt-1 text-xs text-[#646A75]">{narrow ? <>Only {scopeName}</> : 'Every persona and territory this month.'}</p>
          {meta?.preflight?.enabled && (
            <>
              <Head>Ready to traffic</Head>
              <Item onClick={() => dlReady('/preflight/handoff.csv', 'ready-to-traffic-assets.csv')} title="Codes that passed Pre-flight and Trupanion cleared: the asset, flags and who cleared it">Ready to traffic: asset handoff for Add3</Item>
              <Item onClick={() => dlReady(narrow ? `/handoff.csv${q}` : '/handoff.csv', 'ready-to-traffic-copy.csv')} title="The copy of every ready code, a column per field">Ready to traffic: the copy, per code</Item>
            </>
          )}
          <Head>Everything signed off (any status)</Head>
          <Item onClick={() => dl(narrow ? `/handoff.csv${q}` : '/handoff.csv', 'ready-for-production.csv')}>Handoff pack (CSV)</Item>
          {narrow && <Item onClick={() => dl(`/handoff.md${q}`, 'ready-for-production.md')}>Handoff pack (Markdown)</Item>}
          {meta?.preflight?.enabled && <Item onClick={() => dl('/preflight/handoff.csv', 'asset-handoff.csv')} title="Per code: the asset, Ready to traffic and compliance status">Asset handoff, every code</Item>}
          <Item onClick={() => dl('/compliance-sheet.csv', 'trupanion-compliance-sheet.csv')} title="The final words only: no internal flags, objections or names">Compliance sheet for Trupanion</Item>
          <Head>Review in Google Sheets</Head>
          <Item disabled={!run} title={run ? undefined : 'Open a run for this territory in Review first'} onClick={() => run && dl(`/batches/${encodeURIComponent(run.id)}/export.csv`, `${run.id}.csv`)}>Download this run’s sheet</Item>
          <label role="menuitem" className="block cursor-pointer rounded-md px-3 py-1.5 text-sm text-[#ECEDEF] hover:bg-[#272B34]">
            Import the curated sheet…
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importSheet(f); }} />
          </label>
          <Head>Kept lines</Head>
          <Item onClick={() => dl('/shortlist.csv', 'shortlist.csv')}>Kept lines (CSV)</Item>
          <Item onClick={() => dl('/shortlist.md', 'shortlist.md')}>Kept lines (Markdown)</Item>
          <Item disabled={!run} onClick={() => run && dl(`/batches/${encodeURIComponent(run.id)}/export.md`, `${run.id}.md`)}>This run (Markdown)</Item>
          {meta?.preflight?.enabled && (
            <>
              <Head>Weekly read</Head>
              <Item onClick={() => dl('/preflight/features.csv', 'preflight-features.csv')} title="The tags on each ad, for the weekly read of live results (never the test run)">Features for the weekly read</Item>
            </>
          )}
        </div>
      )}
    </div>
  );
}
