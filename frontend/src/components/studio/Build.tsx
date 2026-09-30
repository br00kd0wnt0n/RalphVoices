// Step 3, Build & sign off (was Ready for production): build the ads from the kept lines (one code per version, the
// visual's on-image text with it), fix or override red flags, lock the expectations and sign off. Behaviour unchanged;
// the persona × territory × region comes from the context bar, and the downloads are in the Export menu.
import { useCallback, useEffect, useRef, useState } from 'react';
import { studio, REGION_NAMES, type DraftVersion, type Meta, type PfStub, type ReadyDraft, type ReadyView } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { personaEdge } from '@/lib/personaColors';
import { PersonaChip, Chip, CodeChip, GhostButton, Intro, Label, LineHistory, NAMING_TIP, Overrides, PINK, PinkButton, Src, chipName, codeState, fieldOrder, sevTone, territoryName, when, type Ctx } from './ui';

export function Build({ meta, ctx, user, onNext, onReview }: { meta: Meta; ctx: Ctx; user: string; onNext: () => void; onReview: () => void }) {
  const pt = ctx;
  const [view, setView] = useState<ReadyView | null>(null);
  // The versions being built (sent as is to preview and sign-off): visual letter + field → line id; on-image per visual.
  const [draft, setDraft] = useState<ReadyDraft | null>(null);
  const [lead, setLead] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  // Each code's asset state (Pre-flight and Trupanion), for the one status chip per version.
  const [stubs, setStubs] = useState<Record<string, PfStub>>({});
  useEffect(() => { if (meta.preflight?.enabled) studio.pfStubs().then(s => setStubs(Object.fromEntries(s.map(x => [x.stub, x])))).catch(() => {}); }, [meta.preflight?.enabled, done]); // eslint-disable-line react-hooks/exhaustive-deps
  // First load of a set: its default versions (the last sign-off's, or a first pairing), and the last expectations.
  const load = useCallback(async () => {
    const v = await studio.ready(pt.persona, pt.territory, pt.region);
    setView(v);
    setDraft(v.draft);
    const lastExp = v.expectations[v.expectations.length - 1];
    setLead(new Set((lastExp?.stubs || []).filter(c => v.plan.versions.some(x => x.code === c))));
    setReason(lastExp?.reason || '');
  }, [pt.persona, pt.territory, pt.region]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDone(''); setError(''); setView(null); load().catch(e => setError(e.message)); }, [load]);
  // Any change to the versions: preview again (codes, what's missing, the free checks). Latest request wins.
  const seq = useRef(0);
  const preview = useCallback(async (d: ReadyDraft) => {
    const n = ++seq.current;
    const v = await studio.readyPreview(pt.persona, pt.territory, pt.region, d);
    if (n === seq.current) setView(v);
  }, [pt.persona, pt.territory, pt.region]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (fn: (d: ReadyDraft) => ReadyDraft) => setDraft(cur => {
    if (!cur) return cur;
    const next = fn(cur);
    preview(next).catch(e => setError(e.message));
    return next;
  });
  const refresh = () => (draft ? preview(draft) : load()).catch(e => setError(e.message));
  // The conflicts check (a model call per version not yet checked on this wording) runs by itself a moment after a change.
  const est = view?.plan.check_estimate;
  useEffect(() => {
    if (!draft || !est?.calls || view?.plan.issues.length) return;
    const t = setTimeout(async () => {
      setChecking(true);
      try { const n = ++seq.current; const v = await studio.readyCheck(pt.persona, pt.territory, pt.region, draft); if (n === seq.current) setView(v); }
      catch (e: any) { setError(e.message); } finally { setChecking(false); }
    }, 1500);
    return () => clearTimeout(t);
  }, [est?.calls, view?.plan.versions.map(v => v.checks?.key).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = view?.plan;
  const byId = new Map((view?.lines || []).map(x => [x.line.id, x]));
  const used = new Set(draft ? [...draft.versions.flatMap(v => Object.values(v.fields)), ...Object.values(draft.on_image).flat()].filter(Boolean) : []);
  const reds = [...used].reduce((n, id) => n + (byId.get(id)?.red.length || 0), 0);
  const leads = [...lead].filter(c => plan?.versions.some(v => v.code === c));
  const latest = view?.latest;
  const sameAsLatest = !!latest && !!plan && JSON.stringify((latest.versions || []).map(v => [v.code, Object.entries(v.fields).map(([f, x]) => [f, x.line_id, x.sha256]).sort()]))
    === JSON.stringify(plan.versions.map(v => [v.code, Object.entries(v.fields).map(([f, id]) => [f, id, byId.get(id)?.sha256]).sort()]))
    && JSON.stringify((latest.on_image || []).map(o => [o.visual, o.card || 0, o.line_id, o.sha256])) === JSON.stringify(plan.on_image.map(o => [o.visual, o.card || 0, o.line_id, byId.get(o.line_id)?.sha256]));
  const canSignOff = meta.can_sign_off !== false;
  const blockedBy = !canSignOff ? 'Versions are signed off by the creative lead or an admin.' : !plan ? '' : sameAsLatest ? `These versions are signed off (set v${latest!.version}). Edit a line or change a version to sign off again.`
    : plan.issues.length ? `${plan.issues.length} thing${plan.issues.length === 1 ? '' : 's'} to finish: ${plan.issues[0]}${plan.issues.length > 1 ? '…' : ''}`
    : reds ? `${reds} red flag${reds === 1 ? '' : 's'} on the lines to fix or override first.` : !leads.length ? 'Star the version(s) you expect to lead.' : !reason.trim() ? 'Say why you expect them to lead.' : '';

  async function signOff() {
    if (!draft) return;
    setBusy(true); setError(''); setDone('');
    try {
      const r = await studio.signOff({ persona: pt.persona, territory: pt.territory, region: pt.region, ...draft, expectation: { codes: leads, reason }, expect_latest: view?.latest?.id ?? null });
      const n = r.signoff.versions?.length || 0;
      setDone(`${n} version${n === 1 ? '' : 's'} signed off (set v${r.signoff.version}), with your expectations locked alongside.`);
      await preview(draft);
    } catch (e: any) {
      setError(e.body?.blocking ? `${e.message}: ${e.body.blocking.map((b: any) => b.line_id.split('-').pop()).join(', ')}` : e.message);
      if (e.status === 409 && e.body?.conflict) await refresh();
    } finally { setBusy(false); }
  }
  const t = meta.territories[pt.territory];
  const label = (f: string) => meta.fields[f]?.label || f;
  const short = (f: string) => label(f).replace(/^(Meta|TikTok) /, '');

  // Versions grouped by platform, then visual letter (the draft's order is kept inside a visual).
  const platforms = view ? Object.keys(view.fields).filter(p => view.fields[p].required.length || view.fields[p].optional.length) : [];
  const indexed = (draft?.versions || []).map((d, i) => ({ d, i, p: plan?.versions[i] }));
  const visualsOf = (p: string) => [...new Set(indexed.filter(x => (x.p?.platform || x.d.platform) === p).map(x => x.d.visual))].sort();
  const nextLetter = (p: string) => VISUAL_LETTERS.find(l => !visualsOf(p).includes(l)) || 'Z';
  const linesFor = (f: string) => (view?.lines || []).filter(x => x.line.field === f);
  // A carousel's on-image text is card by card (card 1 the hook … the end card), shared by every version on the visual.
  const carousel = /^CAR/i.test(t?.format || '');
  const addVersion = (platform: string, visual: string) => change(d => {
    const vf = view!.fields[platform];
    const fields: Record<string, string> = {};
    // Start from the visual's last version, so a shared headline carries over; the lead swaps the primary.
    const prev = [...d.versions].reverse().find(v => v.visual === visual && (v.platform || platform) === platform);
    for (const f of vf.required) fields[f] = prev?.fields[f] || linesFor(f)[0]?.line.id || '';
    return { ...d, versions: [...d.versions, { visual, platform, fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v)) }] };
  });

  return (
    <div className="max-w-7xl space-y-5">
      <Intro title="Build & sign off" line="Build the ads from the kept lines, then sign them off.">
        <p>Each version is one ad and one naming code: a primary text and a headline on Meta, a caption on TikTok. A line can be in several versions, and text on the image goes with the visual (one per visual letter).</p>
        <p>Red flags on the lines must be fixed or overridden with a reason; flags on versions inform, never block. Your expectations (which versions you expect to lead, and why) are locked with the sign-off.</p>
        <p>This is creative sign-off, not compliance clearance: Trupanion reviews copy and visual together at Assets.</p>
      </Intro>

      {error && <div className="rounded-lg border-2 border-red-500/45 bg-red-500/10 p-3 text-base text-red-200">{error}</div>}
      {done && <div className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-emerald-500/50 bg-emerald-500/10 p-3 text-base text-emerald-100"><span className="mr-auto">{done}</span><PinkButton className="px-4 py-1.5 text-base" onClick={onNext}>Next: Assets →</PinkButton></div>}
      {!view && !error && <div className="text-base text-[#858B96]">Loading…</div>}
      {view && !view.lines.length && !view.latest && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#272B34] bg-[#16181D] p-5 text-base text-[#A3A8B1]"><span className="mr-auto">Nothing kept yet for {territoryName(t).replace(/\.$/, '')}{meta.rounds && meta.rounds.active ? ` in ${meta.rounds.active}` : ''}. Keep lines in Review first.</span><GhostButton className="text-base" onClick={onReview}>Go to Review</GhostButton></div>}

      {view && plan && draft && (view.lines.length > 0 || !!view.latest) && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            <div className={cn('flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5 text-base', reds || plan.issues.length ? 'border-red-500/45 bg-red-500/10 text-red-100' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100')}>
              <PersonaChip meta={meta} persona={pt.persona} short />
              <span className="font-semibold">{plan.versions.length} version{plan.versions.length === 1 ? '' : 's'} from {view.lines.length} kept lines</span>
              <span>·</span>
              <span>{plan.issues.length ? `${plan.issues.length} to finish` : reds ? `${reds} red flag${reds === 1 ? '' : 's'} to resolve` : 'Complete, no red flags left'}</span>
              <span className="ml-auto text-sm opacity-80">{checking ? 'Checking the versions…' : est?.calls ? `Conflicts check: ${est.calls} to run (~$${est.usd.toFixed(3)})` : 'Versions checked'} · {t?.format} · {REGION_NAMES[view.region || 'US']}</span>
            </div>

            {platforms.map(p => (
              <section key={p} className="space-y-3">
                <div className="flex items-center gap-3 px-1">
                  <h2 className="text-lg font-semibold">{p === 'TT' ? 'TikTok' : 'Meta'} versions</h2>
                  <span className="text-sm text-[#858B96]">Each needs {view.fields[p].required.map(short).map(s => s.toLowerCase()).join(' and ') || 'a line'}{view.fields[p].optional.length ? `; ${view.fields[p].optional.map(short).map(s => s.toLowerCase()).join(', ')} optional` : ''}.</span>
                  <GhostButton className="ml-auto text-sm" onClick={() => addVersion(p, nextLetter(p))}>+ New visual</GhostButton>
                </div>
                {!visualsOf(p).length && <p className="px-1 text-sm text-[#858B96]">No {p === 'TT' ? 'TikTok' : 'Meta'} versions yet.</p>}
                {visualsOf(p).map(letter => {
                  const vs = indexed.filter(x => x.d.visual === letter && (x.p?.platform || x.d.platform) === p);
                  const oiFields = view.fields[p].per_visual;
                  const ois = plan.on_image.filter(o => o.visual === letter && oiFields.includes(byId.get(o.line_id)?.line.field || ''));
                  const oi = ois[0];
                  const setOnImage = (val: string | string[] | null) => change(d => { const on_image = { ...d.on_image }; if (val && (!Array.isArray(val) || val.length)) on_image[letter] = val; else delete on_image[letter]; return { ...d, on_image }; });
                  return (
                    <div key={letter} className="rounded-xl border border-l-4 border-[#272B34] bg-[#121419] p-4" style={personaEdge(pt.persona)}>
                      <div className="mb-3 flex flex-wrap items-center gap-3">
                        <span className="rounded-md bg-[#D94D8F]/15 px-2.5 py-1 font-mono text-base font-semibold text-[#F2C4DA]">Visual {letter}</span>
                        {!carousel && oiFields.map(f => (
                          <label key={f} className="flex min-w-0 flex-1 items-center gap-2 text-sm text-[#A3A8B1]">
                            {short(f)}
                            <select aria-label={`${label(f)} for visual ${letter}`} className="min-w-0 flex-1 rounded border border-[#343946] bg-[#101216] px-2 py-1 text-sm text-[#ECEDEF]"
                              value={typeof draft.on_image[letter] === 'string' && byId.get(draft.on_image[letter] as string)?.line.field === f ? draft.on_image[letter] as string : ''}
                              onChange={e => setOnImage(e.target.value || null)}>
                              <option value="">None on the image</option>
                              {linesFor(f).map(x => <option key={x.line.id} value={x.line.id}>{x.final_text}</option>)}
                            </select>
                          </label>
                        ))}
                        {oi && <span className="font-mono text-xs text-[#646A75]" title="Same visual: one upload serves all its codes">{oi.visual_key}</span>}
                        {vs.length < LINES_PER_VISUAL && <GhostButton className="text-sm" onClick={() => addVersion(p, letter)}>+ Version on {letter}</GhostButton>}
                      </div>
                      {carousel && oiFields.map(f => (
                        <CarouselCards key={f} label={label(f)} letter={letter} visible={meta.fields[f]?.visible || 40} options={linesFor(f)} cards={Array.isArray(draft.on_image[letter]) ? draft.on_image[letter] as string[] : draft.on_image[letter] ? [draft.on_image[letter] as string] : []} onChange={setOnImage} />
                      ))}
                      {ois.flatMap(o => o.issues).map(x => <div key={x} className="mb-2 text-sm text-red-200">{x}</div>)}
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                        {vs.map(({ d, i, p: pv }) => (
                          <VersionCard key={i} meta={meta} view={view} version={d} planned={pv} stub={pv?.code ? stubs[pv.code] : undefined} lead={!!pv?.code && lead.has(pv.code)}
                            onLead={on => pv?.code && setLead(cur => { const n = new Set(cur); if (on) n.add(pv.code); else n.delete(pv.code); return n; })}
                            onField={(f, id) => change(dd => ({ ...dd, versions: dd.versions.map((x, j) => j !== i ? x : { ...x, fields: Object.fromEntries(Object.entries({ ...x.fields, [f]: id }).filter(([, v]) => v)) }) }))}
                            onVisual={l => change(dd => ({ ...dd, versions: dd.versions.map((x, j) => j !== i ? x : { ...x, visual: l }) }))}
                            onRemove={() => change(dd => ({ ...dd, versions: dd.versions.filter((_, j) => j !== i) }))} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}

            <section className="space-y-3">
              <div className="px-1">
                <h2 className="text-lg font-semibold">Kept lines</h2>
                <p className="text-sm text-[#858B96]">Fix red flags and edit wording here; every version a line is in uses the change.</p>
              </div>
              {[...new Set(view.lines.map(x => x.line.field))].sort((a, b) => fieldOrder(meta, a) - fieldOrder(meta, b)).map(f => (
                <div key={f} className="space-y-2">
                  <div className="px-1 text-sm font-semibold uppercase tracking-wider text-[#858B96]">{label(f)}{view.lines.find(x => x.line.field === f)?.role === 'per_visual' ? ' · goes with the visual' : ''}</div>
                  {view.lines.filter(x => x.line.field === f).map(x => (
                    <ReadyCard key={x.line.id} meta={meta} item={x} used={used.has(x.line.id)} onChanged={refresh} onError={setError} canOverride={meta.can_override !== false} />
                  ))}
                </div>
              ))}
            </section>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <section className="rounded-xl border-2 bg-[#16181D] p-5" style={{ borderColor: PINK }}>
              <h2 className="text-lg font-semibold">Expectations</h2>
              <p className="mb-3 text-sm text-[#A3A8B1]">Which version(s) you expect to lead, and why. Dated and locked with the sign-off, so it can be checked against what actually happens.</p>
              <Label>Expected to lead</Label>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {leads.length ? leads.map(c => <Chip key={c} tone="outline" className="border-[#D94D8F] font-mono text-[#F2C4DA]">{c}</Chip>)
                  : <span className="text-sm text-[#858B96]">Star the versions with “☆ Lead”.</span>}
              </div>
              <Label>Why</Label>
              <textarea rows={4} className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base" placeholder="e.g. A2’s primary answers the DINKs’ ‘what happens at the counter?’ question before the fold." value={reason} onChange={e => setReason(e.target.value)} />
              <PinkButton className="mt-3 w-full" disabled={!!blockedBy || busy} onClick={signOff}>{busy ? 'Checking and signing off…' : `Sign off ${plan.versions.length} version${plan.versions.length === 1 ? '' : 's'}`}</PinkButton>
              <p className="mt-2 text-sm text-[#858B96]">{blockedBy || `Will be signed off as ${user || 'you'}. The versions, their checks and your expectations are locked together. Flags on versions don’t block.`}</p>
            </section>

            {view.signoffs.length > 0 && (
              <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-5">
                <h2 className="mb-2 text-lg font-semibold">Sign-offs</h2>
                <ul className="space-y-3 text-sm">
                  {[...view.signoffs].reverse().map(so => {
                    const e = view.expectations.find(x => x.signoff_id === so.id);
                    const n = so.versions?.length ?? so.lines.length;
                    return (
                      <li key={so.id} className="border-l-2 border-emerald-500/60 pl-3">
                        <div className="text-[#ECEDEF]"><span className="font-semibold">Set v{so.version}</span> · {n} {so.versions ? 'version' : 'line'}{n === 1 ? '' : 's'} · {so.ready_by}, {when(so.ready_at)}</div>
                        <div className="font-mono text-xs text-[#646A75]">{so.sha256.slice(0, 16)}</div>
                        {e && <div className="mt-1 text-[#A3A8B1]">Expected to lead: {(e.stubs?.length ? e.stubs : e.line_ids.map(id => so.lines.find(l => l.line_id === id)?.stub || id)).join(', ')}. “{e.reason}” <span className="font-mono text-xs text-[#646A75]">{e.sha256.slice(0, 10)}</span></div>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

const VISUAL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const LINES_PER_VISUAL = 3;
const VERSION_CHIP: Record<string, string> = { VERSION_REPEAT: 'fields repeat', VERSION_TOO_ALIKE: 'too alike', VERSION_CONFLICT: 'fields clash' };

const DEFAULT_CARDS = 4, MAX_CARDS = 10;
/** A carousel visual's on-image text, card by card: choose each card's line, swap or reorder, or take a whole sequence. */
function CarouselCards({ label, letter, options, cards, visible, onChange }: {
  label: string; letter: string; visible: number; options: ReadyView['lines']; cards: string[]; onChange: (cards: string[] | null) => void;
}) {
  const seqs = [...new Map(options.filter(x => x.line.sequence_id).map(x => [x.line.sequence_id!, options.filter(y => y.line.sequence_id === x.line.sequence_id).sort((a, b) => (a.line.card || 0) - (b.line.card || 0))])).entries()];
  const seqName = (id?: string) => (id ? `S${id.split('-S').pop()}` : '');
  const optLabel = (x: ReadyView['lines'][number]) => `${x.line.sequence_id ? `${seqName(x.line.sequence_id)}·${x.line.card} ` : ''}${x.final_text}`;
  const slots = cards.length ? cards : Array(DEFAULT_CARDS).fill('');
  const set = (next: string[]) => onChange(next.some(Boolean) ? next : null);
  const move = (i: number, d: number) => { const n = [...slots]; [n[i], n[i + d]] = [n[i + d], n[i]]; set(n); };
  return (
    <div className="mb-3 rounded-lg border border-[#272B34] bg-[#16181D] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm text-[#A3A8B1]">
        <span className="font-semibold text-[#ECEDEF]">{label}: carousel cards</span>
        <label className="flex items-center gap-1">Cards
          <select aria-label={`Number of cards on visual ${letter}`} className="rounded border border-[#343946] bg-[#101216] px-1 py-0.5 text-sm" value={slots.length}
            onChange={e => { const n = Number(e.target.value); set(n > slots.length ? [...slots, ...Array(n - slots.length).fill('')] : slots.slice(0, n)); }}>
            {Array.from({ length: MAX_CARDS }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {seqs.length > 0 && (
          <label className="flex items-center gap-1">Use a whole sequence
            <select aria-label={`Sequence for visual ${letter}`} className="rounded border border-[#343946] bg-[#101216] px-1 py-0.5 text-sm" value=""
              onChange={e => { const s = seqs.find(([id]) => id === e.target.value); if (s) set(s[1].map(x => x.line.id)); }}>
              <option value="">Choose…</option>
              {seqs.map(([id, xs]) => <option key={id} value={id}>{seqName(id)}: {xs[0]?.final_text}</option>)}
            </select>
          </label>
        )}
        <span className="text-xs text-[#646A75]">Card 1 is the hook; the last card is the end card. The same cards go with every version on visual {letter}.</span>
      </div>
      <ol className="space-y-1.5">
        {slots.map((id, i) => {
          const x = options.find(o => o.line.id === id);
          return (
            <li key={i} className="flex items-center gap-2">
              <span className="w-14 shrink-0 font-mono text-xs text-[#858B96]">Card {i + 1}</span>
              <select aria-label={`Card ${i + 1} on visual ${letter}`} className={cn('min-w-0 flex-1 rounded border bg-[#101216] px-2 py-1 text-sm', x?.red.length ? 'border-red-500/60 text-red-200' : 'border-[#343946] text-[#ECEDEF]')}
                value={id} onChange={e => { const n = [...slots]; n[i] = e.target.value; set(n); }}>
                <option value="">No text on this card</option>
                {options.map(o => <option key={o.line.id} value={o.line.id}>{o.red.length ? '⚠ ' : ''}{optLabel(o)}</option>)}
              </select>
              {x && <span className={cn('font-mono text-xs', [...x.final_text].length > visible ? 'text-amber-300' : 'text-[#646A75]')}>{[...x.final_text].length}</span>}
              <button className="rounded px-1 text-[#858B96] hover:text-[#ECEDEF] disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move card ${i + 1} up`}>↑</button>
              <button className="rounded px-1 text-[#858B96] hover:text-[#ECEDEF] disabled:opacity-30" disabled={i === slots.length - 1} onClick={() => move(i, 1)} aria-label={`Move card ${i + 1} down`}>↓</button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** One version (one ad): its code, a line per field, what's missing, and the version checks. */
function VersionCard({ meta, view, version, planned, stub, lead, onLead, onField, onVisual, onRemove }: {
  meta: Meta; view: ReadyView; version: DraftVersion; planned?: ReadyView['plan']['versions'][number]; stub?: PfStub; lead: boolean;
  onLead: (on: boolean) => void; onField: (field: string, lineId: string) => void; onVisual: (letter: string) => void; onRemove: () => void;
}) {
  const platform = planned?.platform || version.platform || 'META';
  const vf = view.fields[platform] || { required: [], optional: [], per_visual: [] };
  const flags = planned?.checks?.flags || [];
  const complete = !!planned && !planned.issues.length;
  const c = planned?.compliance;
  // One chip for the whole version: its fields plus the visual's on-image line.
  const signed = !!planned?.code && !!view.latest?.versions?.some(v => v.code === planned.code);
  const ids = [...Object.values(version.fields), ...[view.draft.on_image[version.visual] || ''].flat()].filter(Boolean);
  const edited = signed && ids.some(id => view.lines.find(x => x.line.id === id)?.line.ready?.changed_since);
  const state = codeState({ signed, edited, passed: stub?.status.status === 'ready', compliance: c?.status, ready: stub?.traffic?.ready });
  return (
    <div className={cn('flex flex-col rounded-lg border-2 bg-[#16181D] p-3', !complete ? 'border-red-500/50' : flags.some(f => f.severity === 'red') ? 'border-red-500/40' : 'border-emerald-500/40')}>
      <div className="mb-2 flex items-center gap-2">
        <span className="min-w-0 truncate font-mono text-sm font-semibold" title={`${NAMING_TIP}. Kept at sign-off; the same lines keep their code next time.`}>{planned?.code || '…'}</span>
        <select aria-label="Visual" className="rounded border border-[#343946] bg-[#101216] px-1 py-0.5 font-mono text-xs" value={version.visual} onChange={e => onVisual(e.target.value)} title="Move to another visual">
          {VISUAL_LETTERS.slice(0, 8).concat(version.visual).filter((l, i, a) => a.indexOf(l) === i).map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <button onClick={() => onLead(!lead)} disabled={!complete} title={lead ? 'Expected to lead' : 'Expect this version to lead'} className={cn('ml-auto shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium transition disabled:opacity-40', lead ? 'border-[#D94D8F] bg-[#D94D8F] text-white' : 'border-[#4A505D] text-[#C9CCD2] hover:border-[#D94D8F]')}>
          {lead ? '★ Leads' : '☆ Lead'}
        </button>
        <button onClick={onRemove} className="text-xs text-[#646A75] hover:text-red-300" aria-label="Remove this version" title="Remove this version">✕</button>
      </div>
      <div className="space-y-2">
        {[...vf.required, ...vf.optional].map(f => {
          const opts = view.lines.filter(x => x.line.field === f);
          const id = version.fields[f] || '';
          const x = view.lines.find(y => y.line.id === id);
          const hit = flags.some(fl => fl.fields.includes(f));
          return (
            <label key={f} className="block">
              <span className="text-xs uppercase tracking-wider text-[#858B96]">{(meta.fields[f]?.label || f).replace(/^(Meta|TikTok) /, '')}{vf.optional.includes(f) ? ' (optional)' : ''}{x ? ` · ${[...x.final_text].length}/${meta.fields[f]?.visible}` : ''}</span>
              <select aria-label={`${meta.fields[f]?.label || f} for ${planned?.code || 'this version'}`} className={cn('mt-0.5 w-full rounded border bg-[#101216] px-2 py-1.5 text-sm', hit ? 'border-amber-400/60' : !id && vf.required.includes(f) ? 'border-red-500/60' : 'border-[#343946]', x?.red.length ? 'text-red-200' : 'text-[#ECEDEF]')}
                value={id} onChange={e => onField(f, e.target.value)}>
                <option value="">{vf.required.includes(f) ? 'Choose…' : 'None'}</option>
                {opts.map(o => <option key={o.line.id} value={o.line.id}>{o.red.length ? '⚠ ' : ''}{o.final_text}</option>)}
              </select>
              {!opts.length && vf.required.includes(f) && <span className="text-xs text-red-200">No kept {(meta.fields[f]?.label || f).toLowerCase()} yet: keep one in Review.</span>}
            </label>
          );
        })}
      </div>
      {planned?.issues.map(i => <div key={i} className="mt-2 text-sm text-red-200">{i[0].toUpperCase() + i.slice(1)}</div>)}
      {flags.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-t border-[#272B34] pt-2">
          {flags.map((fl, k) => (
            <li key={k} className="text-sm">
              <Chip tone={fl.severity === 'red' ? 'red' : 'amber'} title={`Source: ${fl.source}`}>{VERSION_CHIP[fl.rule] || chipName(fl.rule)}</Chip>{' '}
              <span className="text-[#ECEDEF]">{fl.rule === 'VERSION_TOO_ALIKE' ? fl.label : fl.why || fl.label}</span>
              {fl.quote && <> <mark className="bg-amber-400/30 px-1 text-amber-50">{fl.quote}</mark></>}
              <div className="text-xs text-[#646A75]">{fl.rule} · <Src s={fl.source} />{fl.rule === 'VERSION_TOO_ALIKE' && fl.why ? ` · ${fl.why}` : ''}</div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 text-xs text-[#646A75]">
        {complete && (planned?.checks?.conflicts === 'checked' ? <span>Checked{flags.length ? '' : ': no flags'}</span> : planned?.checks?.conflicts === 'failed' ? <span className="text-amber-200">Conflicts check failed; runs again at sign-off</span> : <span>Conflicts check pending</span>)}
        <CodeChip state={state} className="ml-auto" title={c?.status === 'changes_requested' && c.note ? `Trupanion: ${c.note}` : undefined} />
      </div>
    </div>
  );
}

/** A kept line on Ready: its wording, red flags to fix or override, and the versions it's in. */
function ReadyCard({ meta, item, used, onChanged, onError, canOverride }: {
  meta: Meta; item: ReadyView['lines'][number]; used: boolean; onChanged: () => void; onError: (m: string) => void; canOverride: boolean;
}) {
  const { line, final_text, red, versions } = item;
  const f = meta.fields[line.field];
  const chars = [...final_text].length;
  const [overriding, setOverriding] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(final_text);
  const [checking, setChecking] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); onChanged(); } catch (e: any) { onError(e.message); } };
  const onOriginal = line.flags.some(x => (x.why || '').includes('on the original wording'));
  const others = line.flags.filter(x => x.severity !== 'compliance');

  return (
    <div className={cn('rounded-xl border-2 bg-[#16181D] px-4 py-3 transition', !used ? 'border-[#272B34] opacity-60' : red.length ? 'border-red-500/60' : 'border-emerald-500/40')}>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm text-[#858B96]">
        {item.in.length ? item.in.map(c => <Chip key={c} tone="outline" className="font-mono">{c}</Chip>) : <span>Not in a version</span>}
        <span className={cn('font-mono', f && chars > f.visible ? 'font-bold text-amber-300' : '')}>{chars}/{f?.visible}</span>
        {line.model === 'human' && <Chip tone="outline" className="border-[#D94D8F] text-[#D94D8F]" title={line.added_by ? `Added by ${line.added_by}` : undefined}>{line.added_by ? `yours · ${line.added_by.split('@')[0]}` : 'yours'}</Chip>}
        {line.ready && !line.ready.superseded_by && <Chip tone="outline" className="border-[#D94D8F]/60 text-[#F2C4DA]">signed off v{line.ready.version} · {line.ready.ready_by}, {when(line.ready.ready_at)}</Chip>}
        {line.ready?.superseded_by && <Chip tone="grey" title={`Signed off in ${line.ready.signoff_id}; a later set (${line.ready.superseded_by}) left it out.`}>not in the latest set</Chip>}
        {line.ready?.changed_since && <Chip tone="amber">edited since sign-off: v{Math.max(...versions.map(v => v.version), line.ready.version)} not yet signed off</Chip>}
        <span className="ml-auto flex gap-3">
          <button className="text-xs text-[#858B96] hover:text-[#ECEDEF]" onClick={() => { setDraft(final_text); setEditing(true); }} title={line.ready ? 'Editing makes a new version of the wording; the signed-off one is kept' : undefined}>edit wording</button>
          <button className="text-xs text-[#646A75] hover:text-[#ECEDEF]" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'hide history' : `history${versions.length ? ` · ${versions.length}` : ''}`}</button>
        </span>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea className="w-full rounded-lg border-2 border-[#4A505D] p-3 text-[18px] leading-snug" rows={2} value={draft} onChange={e => setDraft(e.target.value)} autoFocus />
          <div className="flex items-center gap-2">
            <PinkButton className="px-4 py-2 text-base" onClick={() => act(async () => { await studio.decide(line.batch, line.id, { decision: 'edit', edited_text: draft }); setEditing(false); })}>Save edit</PinkButton>
            <GhostButton onClick={() => setEditing(false)}>Cancel</GhostButton>
            <span className="font-mono text-sm text-[#858B96]">{[...draft].length}/{f?.visible}</span>
          </div>
        </div>
      ) : <p className="text-[18px] leading-snug text-[#F2F3F5]">{final_text}</p>}

      {red.length > 0 && used && (
        <div className="mt-3 space-y-2 rounded-lg border border-red-500/45 bg-red-500/10 p-3">
          <div className="text-sm font-semibold uppercase tracking-wider text-red-200">Fix or override before sign-off</div>
          {red.map(fl => (
            <div key={fl.rule} className="text-base">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="red">{chipName(fl.rule)}</Chip>
                <span className="text-[#ECEDEF]">{fl.label}</span>
                {fl.quote && <mark className="bg-amber-400/30 px-1 text-amber-50">{fl.quote}</mark>}
              </div>
              <div className="mt-0.5 text-sm text-[#A3A8B1]">Source: <Src s={fl.source} />{fl.why ? ` · ${fl.why}` : ''}</div>
              {overriding === fl.rule ? (
                <div className="mt-2 space-y-2">
                  <textarea rows={2} className="w-full rounded-lg border-2 border-red-500/45 px-3 py-2 text-base" placeholder="Why this is OK to run (recorded with your name, and shown on the line)" value={why} onChange={e => setWhy(e.target.value)} autoFocus />
                  <div className="flex gap-2">
                    <PinkButton className="px-4 py-1.5 text-base" disabled={why.trim().length < 5} onClick={() => act(async () => { await studio.override(line.batch, line.id, fl.rule, why); setOverriding(null); setWhy(''); })}>Save override</PinkButton>
                    <GhostButton onClick={() => setOverriding(null)}>Cancel</GhostButton>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <GhostButton onClick={() => { setDraft(final_text); setEditing(true); }}>Edit the wording</GhostButton>
                  {canOverride ? <GhostButton onClick={() => { setOverriding(fl.rule); setWhy(''); }}>Override with a reason…</GhostButton>
                    : <span className="self-center text-xs text-[#646A75]">Fix the wording, or ask the creative lead to override it</span>}
                </div>
              )}
            </div>
          ))}
          {onOriginal && (
            <div className="flex flex-wrap items-center gap-2 border-t border-red-500/30 pt-2 text-sm text-red-100">
              Some flags were found on the original wording. Re-check the edit to clear them.
              <GhostButton disabled={checking} onClick={() => act(async () => { setChecking(true); try { await studio.recheck(line.batch, line.id); } finally { setChecking(false); } })}>{checking ? 'Re-checking…' : 'Re-check this wording'}</GhostButton>
            </div>
          )}
        </div>
      )}
      <Overrides line={line} />
      {others.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {others.map(fl => <Chip key={fl.rule} tone={sevTone(fl.severity)} title={`${fl.label}\nSource: ${fl.source}`}>{chipName(fl.rule)}</Chip>)}
          <span className="self-center text-xs text-[#646A75]">don’t block sign-off</span>
        </div>
      )}
      {showHistory && <LineHistory line={line} />}
    </div>
  );
}
