// Check copy (Brook, 1 Oct): paste a table of someone's copy from a Google Doc (persona, territory, field, text), see
// what Studio makes of it and what it costs, check every line as "Check my lines" does, and share the report back.
// The lines are filed into a run per persona × territory (persona-less post copy into Shared captions), kept, and
// marked as entered for the person whose copy it is.
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { getActingFor, setActingFor, studio, type BulkDefaults, type BulkPreview, type BulkRecord, type BulkReport, type Meta, type StudioEvent } from '@/lib/studioApi';
import { Chip, GhostButton, Intro, Label, PinkButton, personaKeys, when } from './ui';

const FOR_KEY = 'voices-studio-check-for';
const FIELD_WORDS: Array<[string, string]> = [['', 'the table says'], ['on-image', 'On-image headline'], ['subhead', 'On-image subhead'], ['primary', 'Primary text'], ['headline', 'Meta headline'], ['caption', 'TikTok caption'], ['hook', 'TikTok hook']];
const TONE = { red: 'red', amber: 'amber', clear: 'outline', grey: 'grey' } as const;
const WORD = { red: 'Red', amber: 'Amber', clear: 'Clear' } as const;
const secs = (n: number) => (n >= 90 ? `${Math.round(n / 60)} min` : `${Math.round(n)} s`);

export function CopyCheck({ meta, onOpenRun }: { meta: Meta; onOpenRun: (run: string) => void }) {
  const [text, setText] = useState('');
  // Whose copy it is. Tied to the "for" picker: a name from the Studio list also sets who you're acting for (so keeping,
  // overriding and signing off these lines are recorded as theirs); anyone else (they may not use Studio) stays a name here.
  const [forWhom, setForWhom] = useState(() => { try { return getActingFor() || localStorage.getItem(FOR_KEY) || ''; } catch { return ''; } });
  const me = (meta.user?.email || '').toLowerCase();
  const people = (meta.people || []).filter(p => p.toLowerCase() !== me);
  const listed = people.find(p => p.toLowerCase() === forWhom.trim().toLowerCase());
  useEffect(() => { if (listed && getActingFor() !== listed) setActingFor(listed); }, [listed]);
  const [defaults, setDefaults] = useState<BulkDefaults>({ region: 'US' });
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [report, setReport] = useState<BulkReport | null>(null);
  const [past, setPast] = useState<BulkRecord[]>([]);
  const [copied, setCopied] = useState(false);
  const esRef = useRef<{ close: () => void } | null>(null);
  useEffect(() => () => esRef.current?.close(), []);
  const loadPast = () => studio.bulkList().then(setPast).catch(() => {});
  useEffect(() => { loadPast(); }, []);
  useEffect(() => { try { localStorage.setItem(FOR_KEY, forWhom); } catch { /* private mode */ } }, [forWhom]);

  // What Studio makes of the table, a moment after typing stops.
  useEffect(() => {
    if (!text.trim()) { setPreview(null); return; }
    let live = true;
    const t = setTimeout(() => { studio.bulkParse(text, defaults).then(p => { if (live) { setPreview(p); setError(''); } }).catch(e => { if (live) setError(e.message); }); }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [text, defaults.persona, defaults.territory, defaults.field, defaults.region]);

  async function check() {
    if (!preview?.rows.length) return;
    setError(''); setReport(null); setStatus('Starting…');
    try {
      let r;
      try { r = await studio.bulkCheck(text, defaults, forWhom.trim()); }
      catch (e: any) {
        if (e.status !== 409 || !e.body?.needs_confirm) throw e;
        if (!window.confirm(`This check is estimated at $${e.body.estimate.toFixed(2)}, over the $${meta.ask_over ?? 2} ask-first line. Run it?`)) { setStatus(''); return; }
        r = await studio.bulkCheck(text, defaults, forWhom.trim(), true);
      }
      const id = r.bulk;
      esRef.current?.close();
      esRef.current = studio.events(r.job, (e: StudioEvent) => {
        if (e.type === 'status') setStatus(e.message);
        if (e.type === 'error') { setStatus(''); setError(`The check stopped: ${e.message}`); }
        if (e.type === 'done') { setStatus(''); studio.bulkReport(id).then(setReport).catch(x => setError(x.message)); loadPast(); }
      });
    } catch (e: any) { setStatus(''); setError(e.message); }
  }
  const copyMd = async () => {
    if (!report) return;
    try { await navigator.clipboard.writeText(await studio.bulkReportMd(report.id)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e: any) { setError(`Couldn't copy: ${e.message}`); }
  };
  const territories = Object.entries(meta.territories).filter(([, t]) => t.persona === defaults.persona && t.status !== 'retired' && !t.shared);
  const sel = 'rounded-lg border-2 border-[#343946] px-2 py-1.5 text-sm';

  return (
    <div className="max-w-6xl space-y-5">
      <Intro title="Check copy" line="Paste copy written elsewhere, check every line against the rules, and share the report back.">
        <p>Copy a table from a Google Doc or Sheet with the columns <strong>persona</strong>, <strong>territory</strong> (optional), <strong>field</strong> and <strong>text</strong>, and paste it below. Field can be on-image, subhead, primary, headline, description, caption or hook. A header row is optional.</p>
        <p>Primary text and headlines with no persona go to <strong>Shared captions</strong> (reused across personas). On-image headlines and subheads are persona-specific. Every line is kept, so it can be built into ads and signed off later.</p>
      </Intro>

      <section className="space-y-3 rounded-xl border border-[#272B34] bg-[#16181D] p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-[#A3A8B1]">Whose copy is this?<br />
            <input className={cn(sel, 'w-56')} placeholder="e.g. Nick Larson" value={forWhom} onChange={e => setForWhom(e.target.value)} aria-label="Whose copy this is" list="check-copy-people" />
            <datalist id="check-copy-people">{people.map(p => <option key={p} value={p} />)}</datalist>
            {listed && <span className="block text-xs text-amber-100">You’re now working for {listed} (shown in the header).</span>}
          </label>
          <label className="text-sm text-[#A3A8B1]">Region<br />
            <select className={sel} value={defaults.region} onChange={e => setDefaults({ ...defaults, region: e.target.value })} aria-label="Region for rows that don't say">
              {(meta.regions || ['US', 'CA']).map(r => <option key={r} value={r}>{r === 'CA' ? 'Canada' : r}</option>)}
            </select>
          </label>
          <span className="pb-2 text-xs text-[#646A75]">For rows that don’t say:</span>
          <label className="text-sm text-[#A3A8B1]">Persona<br />
            <select className={sel} value={defaults.persona || ''} onChange={e => setDefaults({ ...defaults, persona: e.target.value || undefined, territory: undefined })} aria-label="Persona for rows that don't say">
              <option value="">Shared (no persona)</option>
              {personaKeys(meta.personas).map(p => <option key={p} value={p}>{meta.personas[p].name}</option>)}
            </select>
          </label>
          {defaults.persona && (
            <label className="text-sm text-[#A3A8B1]">Territory<br />
              <select className={cn(sel, 'max-w-[16rem]')} value={defaults.territory || ''} onChange={e => setDefaults({ ...defaults, territory: e.target.value || undefined })} aria-label="Territory for rows that don't say">
                <option value="">The persona’s first</option>
                {territories.map(([k, t]) => <option key={k} value={k}>{t.name.replace(/\.$/, '')}</option>)}
              </select>
            </label>
          )}
          <label className="text-sm text-[#A3A8B1]">Field<br />
            <select className={sel} value={defaults.field || ''} onChange={e => setDefaults({ ...defaults, field: e.target.value || undefined })} aria-label="Field for rows that don't say">
              {FIELD_WORDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        <textarea rows={8} className="w-full rounded-lg border-2 border-[#343946] p-3 font-mono text-sm" value={text} onChange={e => setText(e.target.value)} aria-label="The table to check"
          placeholder={'persona\tterritory\tfield\ttext\nBusy Families\tOne Bill\ton-image\tSummer plans, vet bills covered\nBusy Families\tOne Bill\tsubhead\tThe trip stays booked\n\t\tprimary\tTrupanion is medical insurance for pets. Get a quote.'} />
        {error && <div className="rounded-lg border-2 border-red-500/45 bg-red-500/10 p-3 text-base text-red-200">{error}</div>}

        {preview && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-base text-[#ECEDEF]">{preview.rows.length} line{preview.rows.length === 1 ? '' : 's'} to check, in {preview.estimate.runs} run{preview.estimate.runs === 1 ? '' : 's'}</span>
              {preview.rows.length > 0 && <span className="text-sm text-[#A3A8B1]">about ${preview.estimate.usd.toFixed(2)} and {secs(preview.estimate.seconds)}</span>}
              {preview.errors.length > 0 && <span className="text-sm text-amber-200">{preview.errors.length} row{preview.errors.length === 1 ? '' : 's'} can’t be checked (below)</span>}
              <PinkButton className="ml-auto px-4 py-2 text-base" disabled={!preview.rows.length || !!status} onClick={check}>
                {status ? 'Checking…' : `Check ${preview.rows.length} line${preview.rows.length === 1 ? '' : 's'}${forWhom.trim() ? ` for ${forWhom.trim()}` : ''}`}
              </PinkButton>
            </div>
            {status && <div className="flex items-center gap-2 text-sm font-medium" style={{ color: '#D94D8F' }}><span className="animate-pulse">●</span> {status}</div>}
            {preview.errors.length > 0 && (
              <ul className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                {preview.errors.map(e => <li key={e.n}>Row {e.n}: {e.error} <span className="text-amber-200/70">({e.raw})</span></li>)}
              </ul>
            )}
            <div className="max-h-72 overflow-auto rounded-lg border border-[#272B34]">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[#1C1F26] text-xs uppercase tracking-wider text-[#858B96]"><tr><th className="px-3 py-1.5">Persona</th><th className="px-3 py-1.5">Territory</th><th className="px-3 py-1.5">Field</th><th className="px-3 py-1.5">Text</th></tr></thead>
                <tbody>
                  {preview.rows.map(x => (
                    <tr key={x.n} className="border-t border-[#272B34] align-top">
                      <td className="px-3 py-1.5 text-[#C9CCD2]">{x.shared ? <Chip tone="outline" className="text-xs">Shared</Chip> : x.persona_name}</td>
                      <td className="px-3 py-1.5 text-[#C9CCD2]">{x.territory_name}{x.notes.map(n => <div key={n} className="text-xs text-amber-200">{n}</div>)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-[#C9CCD2]">{x.field_label}</td>
                      <td className="px-3 py-1.5 text-[#ECEDEF]">{x.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {report && (
        <section className="space-y-3 rounded-xl border border-[#272B34] bg-[#16181D] p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="mr-auto text-lg font-semibold">Report{report.for ? ` for ${report.for}` : ''}: <span className="font-normal text-[#C9CCD2]">{report.summary}</span></h2>
            <GhostButton onClick={copyMd}>{copied ? 'Copied' : 'Copy as Markdown'}</GhostButton>
            <GhostButton onClick={() => studio.download(`/bulk/${encodeURIComponent(report.id)}/report.md`, `copy-check-${report.id}.md`).catch(e => setError(e.message))}>Markdown</GhostButton>
            <GhostButton onClick={() => studio.download(`/bulk/${encodeURIComponent(report.id)}/report.csv`, `copy-check-${report.id}.csv`).catch(e => setError(e.message))}>CSV (for Sheets)</GhostButton>
          </div>
          <p className="text-sm text-[#858B96]">Red breaks a client rule: fix it, or it needs an override with a reason. Amber is worth a look. The lines are kept: open a run to edit, build and sign off.</p>
          <ul className="space-y-2">
            {[...report.rows].sort((a, b) => ['red', 'amber', 'clear'].indexOf(a.status) - ['red', 'amber', 'clear'].indexOf(b.status)).map(x => (
              <li key={x.line_id} className={cn('rounded-lg border p-3', x.status === 'red' ? 'border-red-500/45 bg-red-500/5' : x.status === 'amber' ? 'border-amber-400/30' : 'border-[#272B34]')}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-sm text-[#858B96]">
                  <Chip tone={TONE[x.status]} className={cn('text-xs', x.status === 'clear' && 'border-emerald-500 text-emerald-300')}>{WORD[x.status]}</Chip>
                  <span>{x.persona} · {x.territory}{x.region !== 'US' ? ' · Canada' : ''} · {x.field}</span>
                  <span className={cn('font-mono', x.over && 'font-bold text-amber-300')}>{x.chars}{x.visible ? `/${x.visible}` : ''}</span>
                  <button className="ml-auto text-xs underline-offset-2 hover:text-[#ECEDEF] hover:underline" onClick={() => onOpenRun(x.run)}>{x.shared ? 'open in Review (shared captions)' : 'open in Review'}</button>
                </div>
                <p className="text-lg leading-snug text-[#F2F3F5]">{x.text}</p>
                {x.flags.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-sm">
                    {x.flags.map((f, i) => (
                      <li key={i} className={f.severity === 'red' ? 'text-red-200' : f.severity === 'amber' ? 'text-amber-200' : 'text-[#A3A8B1]'}>
                        <span className="font-semibold">{f.severity === 'grey' ? 'Note' : WORD[f.severity]}:</span> {f.name}{f.quote ? <> (<mark className="bg-amber-400/30 px-1 text-amber-50">{f.quote}</mark>)</> : null}{f.what ? `: ${f.what}` : ''}{f.todo ? <span className="text-[#C9CCD2]">. What to do: {f.todo}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {report.errors.length > 0 && <p className="text-sm text-amber-200">{report.errors.length} row{report.errors.length === 1 ? '' : 's'} weren’t checked: {report.errors.map(e => `row ${e.n} (${e.error})`).join('; ')}</p>}
        </section>
      )}

      {past.length > 0 && (
        <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-5">
          <Label>Earlier copy checks</Label>
          <ul className="mt-2 divide-y divide-[#272B34] text-sm">
            {past.map(b => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-1.5">
                <span className="text-[#ECEDEF]">{when(b.at)}</span>
                <span className="text-[#A3A8B1]">{b.lines} line{b.lines === 1 ? '' : 's'}{b.for ? ` for ${b.for}` : ''} · entered by {b.by}</span>
                <button className="ml-auto underline-offset-2 hover:text-[#ECEDEF] hover:underline" onClick={() => studio.bulkReport(b.id).then(setReport).catch(e => setError(e.message))}>show report</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
