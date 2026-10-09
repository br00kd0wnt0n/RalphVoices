// One Export menu for every download (top right). It defaults to everything Ready to traffic in the round (the round the
// header shows), with the option to narrow to one persona × territory; then the handoff pack, the asset handoff, the
// compliance sheet, the Sheets round trip, kept lines and the features for the weekly read.
import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { studio, type Batch, type Meta } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { PersonaDot, territoryName, type Ctx, type ViewFilter } from './ui';
import { SheetImport } from './SheetImport';

export function ExportMenu({ meta, ctx, view, batch, onImported }: { meta: Meta | null; ctx: Ctx; view: ViewFilter; batch: Batch | null; onImported: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [sheet, setSheet] = useState<File | null>(null);
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
  const dlReady = (path: string, name: string, noun = 'code') => {
    setOpen(false);
    studio.downloadCsvRows(path, name, row => ready(row['Ready to traffic']) && inScope(row))
      .then(n => onImported(`${n} ${noun}${n === 1 ? '' : 's'} ready to traffic${narrow ? ` (${persona} · ${set})` : ' this month'}.`))
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
              <Item onClick={() => dlReady(narrow ? `/handoff-ads.csv${q}` : '/handoff-ads.csv', 'ready-to-traffic-ads.csv', 'ad')} title="For Add3: one row per ad (a visual), with its primary texts and headlines as text options. Only ads whose every copy option is ready.">Ready to traffic: the ads, with their text options</Item>
              <Item onClick={() => dlReady(narrow ? `/handoff.csv${q}` : '/handoff.csv', 'ready-to-traffic-copy.csv')} title="The copy of every ready code, a column per field">Ready to traffic: the copy, per code</Item>
            </>
          )}
          <Head>For design</Head>
          <Item onClick={() => dl(narrow ? `/design-brief.md${q}` : '/design-brief.md', 'design-brief.md')} title="One section per ad: the words that go into the artwork in order, with their lengths, the sizes, and the disclaimer with where it sits">Design brief (to read)</Item>
          <Item onClick={() => dl(narrow ? `/design-brief.csv${q}` : '/design-brief.csv', 'design-brief.csv')} title="The same, one row per ad, for a sheet">Design brief (sheet)</Item>
          {meta?.preflight?.enabled && (
            <>
              <Head>Pre-flight flags (internal)</Head>
              <Item onClick={() => dl(`/preflight/flag-report.html${narrow ? q : `?region=${ctx.region}`}`, 'preflight-flag-report.html')} title="One internal document for the team: a summary, then each ad’s flags with the size or card, overrides and marks. Opens in the browser or Word and pastes into a doc. Assets exports the same for the ads its filters show.">Flag report (for a doc)</Item>
              <Item onClick={() => dl(`/preflight/flag-report.md${narrow ? q : `?region=${ctx.region}`}`, 'preflight-flag-report.md')}>Flag report (Markdown)</Item>
              <Item onClick={() => dl(`/preflight/flag-report.csv${narrow ? q : `?region=${ctx.region}`}`, 'preflight-flag-report.csv')} title="One row per flag">Flag report (sheet)</Item>
            </>
          )}
          <Head>Everything signed off (any status)</Head>
          <Item onClick={() => dl(narrow ? `/handoff-ads.csv${q}` : '/handoff-ads.csv', 'ad-handoff.csv')} title="One row per ad (a visual): on-image text, then Primary text 1..n and Headline 1..n as the ad's text options. The ad's name is what Add3 traffic and report under.">Ad handoff: one row per ad, with text options</Item>
          <Item onClick={() => dl(narrow ? `/handoff.csv${q}` : '/handoff.csv', 'ready-for-production.csv')} title="The internal record: one row per copy option (A1, A2, A3)">Handoff pack, per copy option (CSV)</Item>
          {narrow && <Item onClick={() => dl(`/handoff.md${q}`, 'ready-for-production.md')}>Handoff pack (Markdown)</Item>}
          {meta?.preflight?.enabled && <Item onClick={() => dl('/preflight/handoff.csv', 'asset-handoff.csv')} title="Per code: the asset, Ready to traffic and compliance status">Asset handoff, every code</Item>}
          <Item onClick={() => dl(narrow ? `/compliance-sheet-ads.csv${q}` : '/compliance-sheet-ads.csv', 'trupanion-compliance-sheet.csv')} title="One row per ad: the on-image text and every primary text and headline option. The final words only: no internal flags, objections, codes or names">Compliance sheet for Trupanion (one row per ad)</Item>
          <Item onClick={() => dl('/compliance-sheet.csv', 'trupanion-compliance-sheet-per-option.csv')} title="The internal record: one row per copy option (A1, A2, A3). The final words only">Compliance sheet, per copy option</Item>
          <Head>Copy worksheet (the month, one tab per step)</Head>
          <Item onClick={() => { setOpen(false); studio.worksheetXlsx(ctx.region).catch(e => onImported(`Download failed: ${e.message}`)); }} title="On-image copy, shared primary texts and shared headlines, with Keep / Cut / Rewrite cells. Opens in Excel or Google Sheets.">Download the worksheet (.xlsx)</Item>
          <label role="menuitem" className="block cursor-pointer rounded-md px-3 py-1.5 text-sm text-[#ECEDEF] hover:bg-[#272B34]" title="Shows what would change before anything is written">
            Import a filled-in worksheet…
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setOpen(false); setSheet(f); } }} />
          </label>
          <Head>Review in Google Sheets (one run)</Head>
          <Item disabled={!run} title={run ? undefined : 'Open a run for this territory in Review first'} onClick={() => run && dl(`/batches/${encodeURIComponent(run.id)}/export.csv`, `${run.id}.csv`)}>Download this run’s sheet</Item>
          <label role="menuitem" className="block cursor-pointer rounded-md px-3 py-1.5 text-sm text-[#ECEDEF] hover:bg-[#272B34]">
            Import the curated sheet…
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importSheet(f); }} />
          </label>
          <Head>Kept lines</Head>
          <Item onClick={() => dl('/bulk/latest/report.md', 'copy-check.md')} title="The latest Check copy report: each line with its flags in plain words, to share back">Copy check report (Markdown)</Item>
          <Item onClick={() => dl('/bulk/latest/report.csv', 'copy-check.csv')} title="The same, one row per line, for Sheets">Copy check report (CSV)</Item>
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
      {sheet && <SheetImport meta={meta} file={sheet} onClose={() => setSheet(null)} onDone={onImported} />}
    </div>
  );
}
