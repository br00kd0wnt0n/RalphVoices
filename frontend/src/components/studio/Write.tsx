// Step 1, Write: the territory (picked at the top), your lines first, then how many of each field Studio writes around
// them. The per-field counts default to the rules' fields.<id>.default_count, else an even split of n.
import { useEffect, useRef, useState } from 'react';
import { toggleField as toggleFieldIn } from '@/lib/studioFields';
import { roundName, studio, type Batch, type Brief, type Meta, type OwnLine, type RunSummary, type Tone, REGION_NAMES } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { personaColor, personaEdge, tint } from '@/lib/personaColors';
import { CanadaNote, Chip, GhostButton, Intro, Label, PersonaChip, PersonaPanel, PinkButton, angleLabel, fieldOrder, regionOf, territoryName, when, type Ctx } from './ui';

/** A field's starting count: the rules' default_count, else an even split of n over the ticked fields. */
export function defaultCount(meta: Meta, f: string, fields: string[], n: number): number {
  const d = meta.fields[f]?.default_count;
  return typeof d === 'number' ? d : Math.max(1, Math.round(n / Math.max(1, fields.length)));
}
/** Counts for a set of fields: the ones already set are kept. */
export function countsFor(meta: Meta, fields: string[], n: number, prev: Record<string, number> = {}): Record<string, number> {
  return Object.fromEntries(fields.map(f => [f, prev[f] ?? defaultCount(meta, f, fields, n)]));
}
const shortField = (meta: Meta, f: string) => (meta.fields[f]?.label || f).replace(/^(Meta|TikTok) /, '').replace(/\s*\(.*\)$/, '').replace(/^./, c => c.toUpperCase());

export function Write({ meta, brief, setBrief, ctx, setCtx, run, running, user, runsTick, onContinue, attachedRun, onNewRun, onTerritories, onEditTerritory, fieldNote }: {
  meta: Meta; brief: Brief; setBrief: (b: Brief) => void; ctx: Ctx; setCtx: (c: Ctx) => void; run: (o?: { ownOnly?: boolean }) => void; running: boolean;
  user: string; runsTick: number; onContinue: (id: string, opts?: { resume?: boolean }) => void;
  attachedRun: Batch | null; onNewRun: () => void; onTerritories: () => void;
  /** Open the territory drawer: a code to edit it, null for a new one. */
  onEditTerritory: (code: string | null) => void;
  /** "Fields set for a static: …" when a new territory applied its defaults. */
  fieldNote?: string;
}) {
  const [more, setMore] = useState(false);
  const territories = Object.entries(meta.territories).filter(([, x]) => x.persona === ctx.persona && x.status !== 'retired');
  const t = meta.territories[ctx.territory];
  const pc = personaColor(ctx.persona);
  // "Territory changed since this run": the open run (or the latest for this territory) predates the territory's last edit.
  const [latestRun, setLatestRun] = useState<RunSummary | null>(null);
  useEffect(() => { studio.batches().then(rs => setLatestRun(rs.find(r => r.territory === ctx.territory && regionOf(r) === ctx.region) || null)).catch(() => setLatestRun(null)); }, [ctx.territory, ctx.region, runsTick]);
  const runAt = attachedRun ? (attachedRun.updated || attachedRun.created) : latestRun?.updated;
  const changedSinceRun = !!(t?.updated_at && runAt && t.updated_at > runAt);
  const set = (patch: Partial<Brief>) => setBrief({ ...brief, ...patch });
  const setTone = (k: keyof Tone, v: number) => set({ tone: { ...brief.tone, [k]: v } });
  const own: OwnLine[] = brief.own_lines?.length ? brief.own_lines : [{ text: '', field: brief.fields[0] || 'meta_primary' }];
  const written = own.filter(o => o.text.trim());
  const setOwn = (next: OwnLine[]) => set({ own_lines: next });
  const setRow = (i: number, patch: Partial<OwnLine>) => setOwn(own.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  const rowRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  useEffect(() => { if (focusRow !== null) { rowRefs.current[focusRow]?.focus(); setFocusRow(null); } }, [focusRow, own.length]);

  // Per-field counts: every ticked field has one; the total is what Studio writes. On a carousel territory the on-image
  // field is written as card sequences (sequences × cards) instead of a count.
  const carousel = /^CAR/i.test(t?.format || '');
  const seq = brief.carousel || { sequences: 3, cards: 4 };
  const seqOn = carousel && brief.fields.some(f => /on_image/.test(f));
  const counts = countsFor(meta, brief.fields, brief.n, brief.field_counts);
  const total = Object.entries(counts).reduce((a, [f, x]) => a + (seqOn && /on_image/.test(f) ? seq.sequences * seq.cards : x), 0);
  // Ticking marks the fields as the person's own choice (studioFields.ts): a new territory then keeps them.
  const pick = (f: string, only: boolean) => {
    const b = toggleFieldIn(brief, f, only);
    const fields = [...b.fields].sort((x, y) => fieldOrder(meta, x) - fieldOrder(meta, y));
    const next = countsFor(meta, fields, brief.n, brief.field_counts);
    setBrief({ ...b, fields, field_counts: next, n: Math.max(1, Object.values(next).reduce((a, x) => a + x, 0)) });
  };
  const toggleField = (f: string) => pick(f, false);
  /** "only": this field and nothing else. */
  const onlyField = (f: string) => pick(f, true);
  const setCount = (f: string, v: number) => {
    const next = { ...counts, [f]: Math.max(0, Math.min(60, Math.floor(v) || 0)) };
    set({ field_counts: next, n: Math.max(1, Object.values(next).reduce((a, x) => a + x, 0)) });
  };

  // The cost before running (debounced; the server prices the brief as sent).
  const [est, setEst] = useState<{ usd: number; minutes: number; summary?: string } | null>(null);
  useEffect(() => {
    if (!brief.fields.length) { setEst(null); return; }
    const h = setTimeout(() => {
      studio.estimate({ ...brief, field_counts: counts, n: Math.max(1, Object.values(counts).reduce((a, x) => a + x, 0)), ...(seqOn ? { carousel: seq } : {}), own_lines: written }, total === 0)
        .then(e => setEst({ usd: e.usd, minutes: Math.max(0, ...Object.values(e.minutes_at_budget || {})), summary: e.allocation?.summary })).catch(() => setEst(null));
    }, 400);
    return () => clearTimeout(h);
  }, [JSON.stringify(counts), JSON.stringify(seq), brief.persona, brief.territory, brief.model, written.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function onPaste(i: number, e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const parts = e.clipboardData.getData('text').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    if (parts.length < 2) return;
    e.preventDefault();
    const field = own[i].field;
    setOwn([...own.slice(0, i), ...parts.map(text => ({ text, field })), ...own.slice(i + 1)].filter((o, k, a) => o.text || k === a.length - 1));
  }
  const platforms = [...new Set(Object.values(meta.fields).map(f => String(f.platform).toUpperCase().startsWith('META') ? 'Meta' : 'TikTok'))].sort((a, b) => (a === 'Meta' ? -1 : 0) - (b === 'Meta' ? -1 : 0));

  return (
    <div className="max-w-7xl space-y-5">
      <Intro title="Write" line="Pick the territory, write your lines, and set how many of each field Studio writes around them.">
        <p>Your lines are checked first, in seconds. Studio then writes the counts you set per field, spread across the persona’s angles, structures and tone, avoiding what you’ve already covered.</p>
        <p>Every line, yours or Studio’s, gets the same checks: limits, compliance and brand rules, persona turn-offs, glance and product clarity, near-duplicates, and a skeptic’s objection. Flags, not scores.</p>
      </Intro>

      {/* The territory picker: the persona's territories (the persona and region are in the bar above). */}
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <Label>Territory</Label>
          <PersonaChip meta={meta} persona={ctx.persona} short className="mb-1.5" />
          {t && <button onClick={() => onEditTerritory(ctx.territory)} className="mb-1.5 text-sm font-medium text-[#C9CCD2] underline-offset-2 hover:text-[#ECEDEF] hover:underline">Edit territory</button>}
          <button onClick={onTerritories} className="mb-1.5 text-xs text-[#646A75] underline-offset-2 hover:text-[#ECEDEF] hover:underline">all territories and history</button>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {territories.map(([code, x]) => (
            <button key={code} onClick={() => setCtx({ ...ctx, territory: code })} aria-pressed={code === ctx.territory}
              className={cn('rounded-xl border-2 border-l-4 bg-[#16181D] px-4 py-3 text-left transition', code === ctx.territory ? '' : 'border-[#272B34] hover:border-[#4A505D]')}
              style={code === ctx.territory ? { borderColor: pc.edge, background: tint(pc.base, 0.1) } : personaEdge(ctx.persona)}>
              <div className="flex items-center gap-2"><span className="font-semibold" style={code === ctx.territory ? { color: pc.light } : undefined}>{territoryName(x)}</span>{x.origin && x.origin !== 'pitch' && <Chip tone="outline" className="text-xs">{x.origin}</Chip>}</div>
              <div className="text-sm text-[#858B96]">{x.format} · {angleLabel(meta, x.persona, x.angle)}</div>
              {x.headline && <div className="mt-1 truncate text-sm text-[#C9CCD2]" title={x.headline}>“{x.headline}”</div>}
            </button>
          ))}
          <button onClick={() => onEditTerritory(null)} className="rounded-xl border-2 border-dashed border-[#343946] px-4 py-3 text-left text-[#858B96] transition hover:border-[#6B7280] hover:text-[#ECEDEF]">
            <div className="font-semibold">+ New territory</div>
            <div className="text-sm">For {meta.personas[ctx.persona]?.name}</div>
          </button>
        </div>
        {t && <p className="mt-2 px-1 text-sm text-[#A3A8B1]">{t.premise}</p>}
        {changedSinceRun && <p className="mt-1 px-1 text-sm text-amber-200" title={`Edited by ${t!.updated_by || 'someone'}, ${when(t!.updated_at)}`}>Territory changed since this run: generate again to use it.</p>}
      </section>
      {ctx.region === 'CA' && <CanadaNote className="text-base" />}

      {attachedRun ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 px-4 py-3 text-base" style={{ borderColor: pc.edge, background: tint(pc.base, 0.1) }}>
          <span>Adding to the run from {when(attachedRun.created)}{attachedRun.created_by ? ` by ${attachedRun.created_by.split('@')[0]}` : ''} <span className="text-[#A3A8B1]">({attachedRun.lines.length} line{attachedRun.lines.length === 1 ? '' : 's'})</span></span>
          <GhostButton className="ml-auto px-3 py-1 text-sm" onClick={onNewRun}>Start a new run</GhostButton>
        </div>
      ) : <p className="px-1 text-sm text-[#858B96]">This starts a new run.</p>}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          {/* Your lines: the first action */}
          <section className="rounded-xl border-2 border-l-4 border-[#343946] bg-[#16181D] p-5" style={personaEdge(ctx.persona)}>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
              <h2 className="shrink-0 text-lg font-semibold">Your lines</h2>
              <span className="text-sm text-[#858B96]">One per row; paste several at once.</span>
            </div>
            <div className="space-y-2">
              {own.map((o, i) => {
                const f = meta.fields[o.field];
                const n = [...o.text].length;
                return (
                  <div key={i} className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                    <textarea ref={el => { rowRefs.current[i] = el; }} rows={Math.min(4, Math.max(1, Math.ceil(n / 48)))} value={o.text} placeholder={i === 0 ? 'Write a line…' : ''}
                      onChange={e => setRow(i, { text: e.target.value.replace(/\n/g, ' ') })}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setOwn([...own.slice(0, i + 1), { text: '', field: o.field }, ...own.slice(i + 1)]); setFocusRow(i + 1); } }}
                      onPaste={e => onPaste(i, e)}
                      className="min-w-0 flex-1 resize-none rounded-lg border-2 border-[#343946] px-3 py-2 text-[20px] leading-snug focus:border-[#D94D8F] focus:outline-none" />
                    <select aria-label="Field" value={o.field} onChange={e => setRow(i, { field: e.target.value })} className="w-40 rounded-lg border-2 border-[#343946] bg-[#16181D] px-2 py-2 text-sm">
                      {Object.keys(meta.fields).sort((a, b) => fieldOrder(meta, a) - fieldOrder(meta, b)).map(k => <option key={k} value={k}>{meta.fields[k].label}</option>)}
                    </select>
                    <span className={cn('w-14 pt-2.5 text-right font-mono text-sm', f && n > f.visible ? 'font-bold text-amber-300' : 'text-[#858B96]')}>{n}/{f?.visible}</span>
                    <button aria-label="Remove line" onClick={() => setOwn(own.length > 1 ? own.filter((_, k) => k !== i) : [{ text: '', field: o.field }])} className="pt-2 text-base text-[#646A75] hover:text-[#C9CCD2]">×</button>
                  </div>
                );
              })}
            </div>
            <button onClick={() => { setOwn([...own, { text: '', field: own[own.length - 1]?.field || brief.fields[0] }]); setFocusRow(own.length); }} className="mt-2 text-base font-medium text-[#858B96] hover:text-[#ECEDEF]">+ Add a line</button>
          </section>

          {/* How many of each field Studio writes */}
          <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-5">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-lg font-semibold">Studio writes</h2>
              <span className="text-sm text-[#858B96]">Tick the fields, set how many of each. Defaults come from the territory’s format and the rules.</span>
            </div>
            {fieldNote && <p className="-mt-1 mb-2 text-sm text-amber-200">{fieldNote}</p>}
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
              {platforms.map(pl => (
                <div key={pl}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#646A75]">{pl}</div>
                  {Object.keys(meta.fields).filter(k => (String(meta.fields[k].platform).toUpperCase().startsWith('META') ? 'Meta' : 'TikTok') === pl).sort((a, b) => fieldOrder(meta, a) - fieldOrder(meta, b)).map(k => {
                    const f = meta.fields[k];
                    const on = brief.fields.includes(k);
                    // On a carousel territory, on-image text is written as card sequences: sequences × cards, not a count.
                    const cards = on && carousel && /on_image/.test(k);
                    return (
                      <div key={k} className={cn('group flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5', on ? 'bg-[#101216]' : '')}>
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                          <input type="checkbox" aria-label={f.label} className="h-4 w-4 accent-[#D94D8F]" checked={on} onChange={() => toggleField(k)} />
                          <span className={cn('truncate', on ? 'text-[#ECEDEF]' : 'text-[#858B96]')} title={f.label}>{shortField(meta, k)}</span>
                          <span className="shrink-0 text-xs text-[#646A75]">{f.visible} visible</span>
                        </label>
                        {!(on && brief.fields.length === 1) && <button onClick={() => onlyField(k)} title={`Write ${f.label} only`} className="shrink-0 rounded px-1.5 text-xs text-[#646A75] opacity-0 transition hover:bg-[#272B34] hover:text-[#ECEDEF] focus:opacity-100 group-hover:opacity-100">only</button>}
                        {on && !cards && <input type="number" min={0} max={60} aria-label={`How many ${f.label}`} value={counts[k]} onChange={e => setCount(k, Number(e.target.value))}
                          className="w-16 rounded-lg border-2 border-[#343946] px-2 py-1 text-right font-mono text-base" />}
                        {cards && <span className="flex basis-full items-center justify-end gap-1 text-sm text-[#A3A8B1]" title="Carousel: card sequences, each one idea (card 1 the hook … the end card)">
                          <input type="number" min={1} max={6} aria-label="Card sequences" value={seq.sequences} onChange={e => set({ carousel: { ...seq, sequences: Math.max(1, Math.min(6, Number(e.target.value) || 1)) } })} className="w-12 rounded-lg border-2 border-[#343946] px-1.5 py-1 text-right font-mono" />
                          × <input type="number" min={2} max={10} aria-label="Cards in each" value={seq.cards} onChange={e => set({ carousel: { ...seq, cards: Math.max(2, Math.min(10, Number(e.target.value) || 4)) } })} className="w-12 rounded-lg border-2 border-[#343946] px-1.5 py-1 text-right font-mono" /> cards
                        </span>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-5 border-t border-[#272B34] pt-4">
              {([['dry_warm', 'dry', 'warm'], ['playful_plain', 'playful', 'plain'], ['short_long', 'short', 'long']] as const).map(([k, l, r]) => (
                <div key={k} className="w-36">
                  <Label>{l}–{r} <span className="font-mono text-[#C9CCD2]">{brief.tone[k]}</span></Label>
                  <input type="range" min={1} max={5} value={brief.tone[k]} onChange={e => setTone(k, Number(e.target.value))} className="w-full accent-[#D94D8F]" />
                </div>
              ))}
            </div>
          </section>

          {/* Run: the total and the cost, before running */}
          <section className="flex flex-wrap items-center gap-3 rounded-xl border border-[#272B34] bg-[#16181D] px-5 py-4">
            <div className="mr-auto min-w-0">
              <div className="text-base font-semibold">{written.length ? `${written.length} of yours` : 'None of yours yet'} + Studio writes {total}</div>
              <div className="text-sm text-[#858B96]">
                {/* Exactly what Generate writes: the server's allocation (the counts generate keeps to). */}
                {est?.summary ? `Generate writes ${est.summary}` : brief.fields.filter(f => counts[f] || (seqOn && /on_image/.test(f))).map(f => seqOn && /on_image/.test(f) ? `${seq.sequences} × ${seq.cards} carousel cards` : `${counts[f]} ${shortField(meta, f).toLowerCase()}`).join(' · ') || 'Set a count to generate'}
                {est ? ` · about $${est.usd.toFixed(2)}${meta.mock ? ' (mock: free)' : ''}` : ''}
              </div>
            </div>
            <PinkButton disabled={running || !written.length} onClick={() => run({ ownOnly: true })}>Check my lines{written.length ? ` (${written.length})` : ''}</PinkButton>
            <GhostButton disabled={running || !brief.fields.length || !total} onClick={() => run()} className="px-4 py-2.5 text-base">
              {written.length ? `Check mine + generate ${total}` : `Generate ${total} lines`}
            </GhostButton>
          </section>
        </div>

        <div className="space-y-5">
          <PersonaPanel meta={meta} persona={ctx.persona} region={regionOf(brief)} open />
          <RunsList user={user} tick={runsTick} meta={meta} ctx={ctx} onContinue={onContinue} />
          <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
            <button className="flex w-full items-center justify-between text-lg font-semibold" onClick={() => setMore(!more)} aria-expanded={more}>
              More options <span className="text-[#646A75]">{more ? '−' : '+'}</span>
            </button>
            {more && (
              <div className="mt-4 space-y-4">
                <div>
                  <Label>Banned words (comma-separated)</Label>
                  <input className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base" value={brief.banned_words.join(', ')}
                    onChange={e => set({ banned_words: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} placeholder="e.g. furbaby, hassle-free" />
                </div>
                <div>
                  <Label>Off-limits ideas (one per line)</Label>
                  <textarea rows={2} className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base" value={brief.banned_ideas.join('\n')} onChange={e => set({ banned_ideas: e.target.value.split('\n') })} />
                </div>
                <div>
                  <Label>Reference lines (a voice to match, not checked)</Label>
                  <textarea rows={2} className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base" value={brief.reference_lines.join('\n')} onChange={e => set({ reference_lines: e.target.value.split('\n') })} />
                </div>
                <div>
                  <Label>Writing model</Label>
                  <input list="studio-models" className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base" value={brief.model} onChange={e => set({ model: e.target.value })} />
                  <datalist id="studio-models">{['gpt-4o', 'gpt-4.1', 'gpt-5.5', 'claude-opus-5-5', 'claude-opus-5', 'gpt-5-mini'].map(m => <option key={m} value={m} />)}</datalist>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------- runs: saved by person, continue any time (for the chosen persona × territory × region) ----------

function RunsList({ user, tick, meta, ctx, onContinue }: { user: string; tick: number; meta: Meta; ctx: Ctx; onContinue: (id: string, opts?: { resume?: boolean }) => void }) {
  const [mine, setMine] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  useEffect(() => { studio.batches(mine && user ? user : undefined).then(setRuns).catch(() => setRuns([])); }, [user, mine, tick]);
  const here = runs.filter(r => r.territory === ctx.territory && regionOf(r) === ctx.region);
  return (
    <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="mr-auto text-lg font-semibold">Runs for this territory</h3>
        <GhostButton active={!mine} className="px-2 py-1 text-sm" onClick={() => setMine(false)}>All</GhostButton>
        <GhostButton active={mine} className="px-2 py-1 text-sm" onClick={() => setMine(true)}>Mine</GhostButton>
      </div>
      {!here.length && <p className="text-base text-[#858B96]">No runs for {territoryName(meta.territories[ctx.territory]).replace(/\.$/, '') || 'this territory'}{ctx.region === 'CA' ? ` (${REGION_NAMES.CA})` : ''} yet.</p>}
      <ul className="max-h-60 space-y-2 overflow-y-auto">
        {here.slice(0, 30).map(r => (
          <li key={r.id} className="flex items-center gap-3 rounded-lg border border-l-4 border-[#272B34] px-3 py-2" style={personaEdge(r.persona)}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-medium">{when(r.updated)}{r.created_by ? ` · ${r.created_by.split('@')[0]}` : ''}{r.round && r.round !== (meta.rounds?.working || meta.rounds?.active) && <Chip tone={meta.rounds?.rounds.find(x => x.id === r.round)?.test ? 'amber' : 'outline'} className="ml-2 text-xs">{roundName(meta.rounds, r.round)}</Chip>}</div>
              <div className="text-sm text-[#858B96]">
                {r.lines} lines{r.yours ? ` (${r.yours} yours)` : ''} · {r.kept} kept
                {r.unchecked > 0 && <span className="text-amber-300"> · {r.unchecked} unchecked</span>}
              </div>
            </div>
            {r.unchecked > 0
              ? <GhostButton className="px-3 py-1 text-sm" onClick={() => onContinue(r.id, { resume: true })} title="The run was interrupted; check the lines it left unchecked">Resume</GhostButton>
              : <GhostButton className="px-3 py-1 text-sm" onClick={() => onContinue(r.id)}>Continue</GhostButton>}
          </li>
        ))}
      </ul>
    </section>
  );
}
