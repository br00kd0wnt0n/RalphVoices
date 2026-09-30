// One Export menu for every download (top right): the Sheets round trip, kept lines, the handoff pack, the asset
// handoff, the compliance sheet and the features for the weekly read. "This set" is the context bar's choice.
import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { studio, type Batch, type Meta } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { PersonaDot, territoryName, type Ctx } from './ui';

export function ExportMenu({ meta, ctx, batch, onImported }: { meta: Meta | null; ctx: Ctx; batch: Batch | null; onImported: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const q = `?persona=${encodeURIComponent(ctx.persona)}&territory=${encodeURIComponent(ctx.territory)}&region=${ctx.region}`;
  const set = territoryName(meta?.territories[ctx.territory]) || ctx.territory;
  const persona = (meta?.personas[ctx.persona]?.name || ctx.persona).replace(/\s*\(.*\)$/, '');
  const run = batch && batch.brief.territory === ctx.territory ? batch : null;
  const dl = (path: string, name: string) => { setOpen(false); studio.download(path, name).catch(e => onImported(`Download failed: ${e.message}`)); };
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
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} title="Export: every download" aria-label="Export" aria-haspopup="menu" aria-expanded={open} className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-sm transition', open ? 'border-[#ECEDEF] text-[#ECEDEF]' : 'border-transparent text-[#858B96] hover:text-[#ECEDEF]')}>
        <Download className="h-4 w-4" aria-hidden /><span className="hidden min-[1600px]:inline">Export</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-30 max-h-[80vh] w-80 overflow-y-auto rounded-xl border border-[#343946] bg-[#16181D] p-1.5 shadow-2xl">
          <Head>Review in Google Sheets</Head>
          <Item disabled={!run} title={run ? undefined : 'Open a run for this territory in Review first'} onClick={() => run && dl(`/batches/${encodeURIComponent(run.id)}/export.csv`, `${run.id}.csv`)}>Download this run’s sheet</Item>
          <label role="menuitem" className="block cursor-pointer rounded-md px-3 py-1.5 text-sm text-[#ECEDEF] hover:bg-[#272B34]">
            Import the curated sheet…
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importSheet(f); }} />
          </label>
          <Head>Kept lines</Head>
          <Item onClick={() => dl('/shortlist.csv', 'shortlist.csv')}>Kept lines, every set (CSV)</Item>
          <Item onClick={() => dl('/shortlist.md', 'shortlist.md')}>Kept lines, every set (Markdown)</Item>
          <Item disabled={!run} onClick={() => run && dl(`/batches/${encodeURIComponent(run.id)}/export.md`, `${run.id}.md`)}>This run (Markdown)</Item>
          <Head>Handoff pack (signed-off versions)</Head>
          <Item onClick={() => dl(`/handoff.csv${q}`, 'ready-for-production.csv')}><span className="flex items-center gap-1.5"><PersonaDot persona={ctx.persona} />{persona} · {set}: CSV</span></Item>
          <Item onClick={() => dl(`/handoff.md${q}`, 'ready-for-production.md')}><span className="flex items-center gap-1.5"><PersonaDot persona={ctx.persona} />{persona} · {set}: Markdown</span></Item>
          <Item onClick={() => dl('/handoff.csv', 'ready-for-production.csv')}>Every set: CSV</Item>
          <Item onClick={() => dl('/compliance-sheet.csv', 'trupanion-compliance-sheet.csv')} title="The final words only: no internal flags, objections or names">Compliance sheet for Trupanion</Item>
          {meta?.preflight?.enabled && (
            <>
              <Head>Assets</Head>
              <Item onClick={() => dl('/preflight/handoff.csv', 'asset-handoff.csv')} title="Per code: the asset, Ready to traffic and compliance status">Asset handoff for Add3</Item>
              <Item onClick={() => dl('/preflight/features.csv', 'preflight-features.csv')} title="The tags on each ad, for the weekly read of live results">Features for the weekly read</Item>
            </>
          )}
        </div>
      )}
    </div>
  );
}
