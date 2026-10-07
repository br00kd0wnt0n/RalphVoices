// Step 3, Build & sign off, redesigned for Nick (before Tue 6 Oct's R1): per visual, numbered steps. ① the text on
// the image (or a carousel's cards; TikTok's hook sits in each ad), ② the ads, each shown like a feed ad whose slots
// open a tray of the kept lines, then ③ which ad you expect to lead and why, and ④ sign off (also in a bar at the
// bottom). One place for each line (the tray), plain flag labels at the slot they concern, and one status per ad:
// Draft, Signed off, Edited since sign-off. Behaviour and endpoints are unchanged: versions, checks, expect_latest,
// overrides, carousel cards and TikTok versions. The draft rules are in lib/buildDraft.ts.
import { useCallback, useEffect, useRef, useState } from 'react';
import { onOriginal, studio, REGION_NAMES, type DraftVersion, type PlannedVersion, type Meta, type ReadyDraft, type ReadyView, type VersionFlag } from '@/lib/studioApi';
import { addAd, adName, flagsAt, flagsAtShared, moveAd, redPlaces, nextVisual, placeLine, removeAd, removeVisual, slotAfter, setCard, setCardSub, setOnImage, setOnImageSub, useInAllAds, usesOf } from '@/lib/buildDraft';
import { cn } from '@/lib/utils';
import { personaColor, personaEdge, tint } from '@/lib/personaColors';
import { PersonaChip, Chip, GhostButton, Intro, Label, LineHistory, NAMING_TIP, Overrides, PINK, PinkButton, Src, chipName, flagName, sevTone, specFor, territoryName, when, ForPicker, useActingFor, whoWords, type Ctx } from './ui';

type RL = ReadyView['lines'][number];
/** Where the tray places a line: a field of one ad, or the visual's image (a carousel card, 1-based). */
type Slot = { kind: 'ad'; index: number; field: string } | { kind: 'image'; visual: string; field: string; card?: number };
/** The on-image subhead field (rules v2.14 meta_on_image_sub): under the on-image headline, per visual or per card. */
const isSubField = (f: string) => /_sub$/.test(f);
/** A slot's current line in the draft: an ad's field, the on-image headline or subhead, or a card's. */
function currentIn(d: ReadyDraft, slot: Slot): string {
  if (slot.kind === 'ad') return d.versions[slot.index]?.fields[slot.field] || '';
  const map = isSubField(slot.field) ? d.on_image_sub || {} : d.on_image;
  const v = map[slot.visual];
  return slot.card ? ([v || ''].flat()[slot.card - 1] || '') : typeof v === 'string' ? v : '';
}
const DEFAULT_CARDS = 4, MAX_CARDS = 10;

export function Build({ meta, ctx, user, onNext, onReview }: { meta: Meta; ctx: Ctx; user: string; onNext: () => void; onReview: () => void }) {
  const pt = ctx;
  // "On behalf of": whose call the sign-off, expectation and overrides here are recorded as (the picker; '' = yours).
  const actingFor = useActingFor();
  const [view, setView] = useState<ReadyView | null>(null);
  // The ads being built (sent as is to preview and sign-off): visual letter + field → line id; on-image per visual.
  const [draft, setDraft] = useState<ReadyDraft | null>(null);
  const [lead, setLead] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [history, setHistory] = useState(false);

  // First load of a set: its default versions (the last sign-off's, or a first pairing), and the last expectations.
  const load = useCallback(async () => {
    const v = await studio.ready(pt.persona, pt.territory, pt.region);
    setView(v);
    setDraft(v.draft);
    const lastExp = v.expectations[v.expectations.length - 1];
    setLead(new Set((lastExp?.stubs || []).filter(c => v.plan.versions.some(x => x.code === c))));
    setReason(lastExp?.reason || '');
  }, [pt.persona, pt.territory, pt.region]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDone(''); setError(''); setView(null); setSlot(null); load().catch(e => setError(e.message)); }, [load]);
  // Any change to the ads: preview again (codes, what's missing, the free checks). Latest request wins.
  const seq = useRef(0);
  const preview = useCallback(async (d: ReadyDraft) => {
    const n = ++seq.current;
    const v = await studio.readyPreview(pt.persona, pt.territory, pt.region, d);
    if (n === seq.current) setView(v);
  }, [pt.persona, pt.territory, pt.region]); // eslint-disable-line react-hooks/exhaustive-deps
  // The latest draft, so two changes in a row build on each other without side effects inside a state updater.
  const draftRef = useRef<ReadyDraft | null>(null);
  draftRef.current = draft;
  const change = (fn: (d: ReadyDraft) => ReadyDraft) => {
    const cur = draftRef.current;
    if (!cur) return;
    const next = fn(cur);
    draftRef.current = next;
    setDraft(next);
    // The open tray follows its ad, or closes when the ad or visual it was for is gone.
    setSlot(s => slotAfter(s, cur, next));
    preview(next).catch(e => setError(e.message));
  };
  const refresh = () => (draft ? preview(draft) : load()).catch(e => setError(e.message));
  // The conflicts check (a model call per ad not yet checked on this wording) runs by itself a moment after a change.
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
  // Esc closes the tray.
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSlot(null); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);

  const plan = view?.plan;
  const platformOf = (v: DraftVersion) => v.platform || fieldPlatform(Object.keys(v.fields)[0] || '');
  const byId = new Map((view?.lines || []).map(x => [x.line.id, x]));
  const used = new Set(draft ? [...draft.versions.flatMap(v => Object.values(v.fields)), ...Object.values(draft.on_image).flat(), ...Object.values(draft.on_image_sub || {}).flat()].filter(Boolean) : []);
  const reds = [...used].reduce((n, id) => n + (byId.get(id)?.red.length || 0), 0);
  // Which line, where: "Visual B · card 2: unsourced figure".
  const redList = draft ? redPlaces(draft, Object.fromEntries([...used].map(id => [id, (byId.get(id)?.red || []).map(f => chipName(f.rule))])), platformOf) : [];
  const leads = [...lead].filter(c => plan?.versions.some(v => v.code === c));
  const latest = view?.latest;
  const sameAsLatest = !!latest && !!plan && JSON.stringify((latest.versions || []).map(v => [v.code, Object.entries(v.fields).map(([f, x]) => [f, x.line_id, x.sha256]).sort()]))
    === JSON.stringify(plan.versions.map(v => [v.code, Object.entries(v.fields).map(([f, id]) => [f, id, byId.get(id)?.sha256]).sort()]))
    && JSON.stringify((latest.on_image || []).map(o => [o.visual, o.card || 0, o.line_id, o.sha256])) === JSON.stringify(plan.on_image.map(o => [o.visual, o.card || 0, o.line_id, byId.get(o.line_id)?.sha256]));
  const canSignOff = meta.can_sign_off !== false;
  const blockedBy = !canSignOff ? 'Ads are signed off by the creative lead or an admin.' : !plan ? '' : sameAsLatest ? `This is signed off (set v${latest!.version}). Change a line or a copy option to sign off again.`
    : plan.issues.length ? `${plan.issues.length} thing${plan.issues.length === 1 ? '' : 's'} to finish: ${plan.issues[0]}${plan.issues.length > 1 ? '…' : ''}`
    : reds ? `${reds} red flag${reds === 1 ? '' : 's'} to fix or override first: ${redList[0]}${redList.length > 1 ? ` (and ${redList.length - 1} more)` : ''}.` : !leads.length ? 'Choose the copy option(s) you expect to do best (step ③).' : !reason.trim() ? 'Say why you expect them to lead (step ③).' : '';

  async function signOff() {
    if (!draft) return;
    setBusy(true); setError(''); setDone('');
    try {
      const r = await studio.signOff({ persona: pt.persona, territory: pt.territory, region: pt.region, ...draft, expectation: { codes: leads, reason }, expect_latest: view?.latest?.id ?? null });
      const n = r.signoff.versions?.length || 0;
      { const ads = new Set((r.signoff.versions || []).map(v => `${v.platform}|${v.visual}`)).size || 1; setDone(`${ads} ad${ads === 1 ? '' : 's'} signed off with ${n} copy option${n === 1 ? '' : 's'} (set v${r.signoff.version}), with your expectation kept alongside.`); }
      await preview(draft);
    } catch (e: any) {
      setError(e.body?.blocking ? `${e.message}: ${e.body.blocking.map((b: any) => byId.get(b.line_id)?.final_text || b.line_id).join(' · ')}` : e.message);
      if (e.status === 409 && e.body?.conflict) await refresh();
    } finally { setBusy(false); }
  }
  const t = meta.territories[pt.territory];
  const label = (f: string) => meta.fields[f]?.label || f;
  const short = (f: string) => { const x = label(f).replace(/^(Meta|TikTok) /, ''); return x.charAt(0).toUpperCase() + x.slice(1); };
  const carousel = /^CAR/i.test(t?.format || '');
  const color = personaColor(pt.persona);

  // Ads by platform, then visual letter (the draft's order is kept inside a visual).
  const fieldPlatform = (f: string) => (/tiktok/i.test(meta.fields[f]?.platform || '') ? 'TT' : 'META');
  const platforms = view ? Object.keys(view.fields).filter(p => view.fields[p].required.length || view.fields[p].optional.length) : [];
  // The plan describes the draft it was worked out for. Between a change and the server's answer it is the old one:
  // with a different number of ads it can't be paired by position (an ad would show the removed ad's code and checks).
  // (A new ad is added at the end, so a shorter plan still lines up; a longer one is from before a removal.)
  const planFits = !!plan && !!draft && plan.versions.length <= draft.versions.length;
  const indexed = (draft?.versions || []).map((d, i) => ({ d, i, p: planFits ? plan!.versions[i] : undefined }));
  const visualsOf = (p: string) => [...new Set(indexed.filter(x => (x.p?.platform || platformOf(x.d)) === p).map(x => x.d.visual))].sort();
  const linesFor = (f: string) => (view?.lines || []).filter(x => x.line.field === f);
  const nameOf = (i: number) => (draft ? adName(draft, i, platformOf) : '');
  const nameOfCode = (code?: string) => { const i = planFits ? plan!.versions.findIndex(v => v.code === code) : -1; return (i >= 0 && nameOf(i)) || code || ''; };
  const newAd = (p: string, visual: string) => change(d => addAd(d, visual, p, view!.fields[p].required, f => linesFor(f)[0]?.line.id));
  const visualCount = new Set(draft?.versions.map(v => `${platformOf(v)}|${v.visual}`)).size;

  // Each ad's status on this screen only: Draft, Signed off, or Edited since sign-off.
  const statusOf = (i: number): 'draft' | 'signed' | 'edited' => {
    const pv = planFits ? plan?.versions[i] : undefined;
    const sv = pv?.code ? latest?.versions?.find(v => v.code === pv.code) : undefined;
    if (!sv || !pv) return 'draft';
    const same = JSON.stringify(Object.entries(sv.fields).map(([f, x]) => [f, x.line_id]).sort()) === JSON.stringify(Object.entries(pv.fields).sort());
    if (!same) return 'draft';
    const ids = [...Object.values(pv.fields), ...plan!.on_image.filter(o => o.visual === pv.visual).map(o => o.line_id)];
    return ids.some(id => byId.get(id) && byId.get(id)!.sha256 !== (Object.values(sv.fields).find(x => x.line_id === id)?.sha256 ?? latest?.on_image?.find(o => o.line_id === id)?.sha256 ?? byId.get(id)!.sha256)) ? 'edited' : 'signed';
  };

  // The tray's lines: the field for the slot, those in use first, then "Not used yet".
  const trayField = slot?.field || '';
  const place = (id: string) => {
    if (!slot) return;
    if (slot.kind === 'ad') change(d => placeLine(d, slot.index, slot.field, id));
    else if (isSubField(slot.field)) change(d => (slot.card ? setCardSub(d, slot.visual, slot.card, id) : setOnImageSub(d, slot.visual, id || null)));
    else if (slot.card) change(d => setCard(d, slot.visual, slot.card!, id, DEFAULT_CARDS));
    else change(d => setOnImage(d, slot.visual, id || null));
  };

  return (
    <div className="max-w-7xl space-y-5 pb-28">
      <Intro title="Build & sign off" line="Build each ad from your kept lines, then sign it off.">
        <p>An ad is one piece of artwork with its copy as text options: it runs as one ad, and Meta mixes its primary texts and headlines. Work down each ad: ① the text on the image, ② the copy options (click a slot to choose a line), then ③ which option you expect to do best and why, and ④ sign off.</p>
        <p>Red flags must be fixed or overridden with a reason before sign-off; the other flags inform. This is creative sign-off, not compliance clearance: Trupanion reviews copy and visual together at Assets.</p>
      </Intro>

      {error && <div className="rounded-lg border-2 border-red-500/45 bg-red-500/10 p-3 text-base text-red-200">{error}</div>}
      {done && <div className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-emerald-500/50 bg-emerald-500/10 p-3 text-base text-emerald-100"><span className="mr-auto">{done}</span><PinkButton className="px-4 py-1.5 text-base" onClick={onNext}>Next: Assets →</PinkButton></div>}
      {!view && !error && <div className="text-base text-[#858B96]">Loading…</div>}
      {view && !view.lines.length && !view.latest && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#272B34] bg-[#16181D] p-5 text-base text-[#A3A8B1]"><span className="mr-auto">Nothing kept yet for {territoryName(t).replace(/\.$/, '')}. Keep lines in Review first.</span><GhostButton className="text-base" onClick={onReview}>Go to Review</GhostButton></div>}

      {view && plan && draft && (view.lines.length > 0 || !!view.latest) && (
        <>
          <div className="flex flex-wrap items-center gap-3 px-1 text-sm text-[#A3A8B1]">
            <PersonaChip meta={meta} persona={pt.persona} short />
            <span>{territoryName(t)} · {t?.format?.toLowerCase()} · {REGION_NAMES[view.region || 'US']}</span>
            <span className="ml-auto text-xs text-[#646A75]">{checking ? 'Checking the copy options…' : est?.calls ? `Checking ${est.calls} copy option${est.calls === 1 ? '' : 's'} shortly` : 'Copy options checked'}</span>
          </div>

          {platforms.map(p => (
            <div key={p} className="space-y-5">
              {visualsOf(p).map(letter => {
                const vs = indexed.filter(x => x.d.visual === letter && (x.p?.platform || platformOf(x.d)) === p);
                // Flags at a slot the whole ad shares say which copy option(s) they were found with.
                const sharedFlags = (field: string) => flagsAtShared(vs.map((x, k) => ({ n: k + 1, flags: x.p?.checks?.flags || [] })), field);
                const oiFields = view.fields[p].per_visual.filter(f => !isSubField(f));
                // The optional subhead under the on-image headline (per card on a carousel).
                const subField = view.fields[p].per_visual.find(isSubField);
                const subVal = draft.on_image_sub?.[letter];
                const subs = Array.isArray(subVal) ? subVal : [];
                const ois = plan.on_image.filter(o => o.visual === letter);
                const cards = Array.isArray(draft.on_image[letter]) ? draft.on_image[letter] as string[] : draft.on_image[letter] ? [draft.on_image[letter] as string] : [];
                const hookField = p === 'TT' ? [...view.fields[p].required, ...view.fields[p].optional].find(f => /hook/.test(f)) : undefined;
                let step = 0;
                return (
                  <section key={`${p}${letter}`} className="rounded-xl border border-l-4 border-[#272B34] bg-[#121419] p-4 sm:p-5" style={personaEdge(pt.persona)}>
                    <div className="mb-4 flex flex-wrap items-center gap-3">
                      <h2 className="text-xl font-semibold" style={{ color: color.light }}>Ad {letter}</h2>
                      <span className="text-sm text-[#858B96]">{p === 'TT' ? 'TikTok' : 'Meta'} · one ad · {vs.length} copy option{vs.length === 1 ? '' : 's'}</span>
                      {/* The ad's name: its copy options' codes without the option number. What it is trafficked and reported under. */}
                      {vs[0]?.p?.code && <span className="font-mono text-xs text-[#858B96]" title="The ad's name: what it is trafficked and reported under (the date is added at trafficking). The copy options' codes below are Studio's own ids.">{vs[0].p.code.replace(/_([A-Z])\d+_/, '_$1_')}</span>}
                      {/* The whole visual: its ads and its on-image text. Nothing is deleted from the kept lines; the letter is free again. */}
                      <button className="ml-auto text-xs text-[#858B96] underline-offset-2 hover:text-red-200 hover:underline" title="Takes this ad, its copy options and its on-image text out of the set. The lines stay kept." aria-label={`Remove ad ${letter}`}
                        onClick={() => { if (vs.length + cards.filter(Boolean).length <= 1 || window.confirm(`Remove ad ${letter}: its ${vs.length} copy option${vs.length === 1 ? '' : 's'}${cards.some(Boolean) ? ' and its on-image text' : ''}? The lines stay kept.`)) change(d => removeVisual(d, letter, p, platformOf)); }}>Remove this ad</button>
                    </div>

                    {oiFields.length > 0 && (
                      <Step n={++step} title={carousel ? 'The carousel cards (text on each card)' : 'The text on the image'} hint={`${carousel ? 'Card 1 is the hook; the last card is the end card. Every copy option on this ad runs with them.' : 'It goes into the artwork, so every copy option on this ad runs with it.'}${subField ? ` A subhead under the headline is optional${carousel ? ', card by card' : ''}.` : ''}`}>
                        {carousel ? oiFields.map(f => (
                          <CardStrip key={f} meta={meta} field={f} letter={letter} cards={cards} lines={linesFor(f)} byId={byId} flagsFor={k => sharedFlags(`${f}#${k}`)}
                            onOpen={card => setSlot({ kind: 'image', visual: letter, field: f, card })} onChange={next => change(d => setOnImage(d, letter, next))}
                            subField={subField} subs={subs} onOpenSub={card => subField && setSlot({ kind: 'image', visual: letter, field: subField, card })} onSubsChange={next => change(d => setOnImageSub(d, letter, next))}
                            subFlagsFor={k => (subField ? sharedFlags(`${subField}#${k}`) : [])}
                            nameOfCode={nameOfCode} onChanged={refresh} onError={setError} />
                        )) : oiFields.map(f => {
                          const id = typeof draft.on_image[letter] === 'string' ? draft.on_image[letter] as string : '';
                          return (
                            <div key={f} className="space-y-1.5">
                              <SlotBox meta={meta} x={id ? byId.get(id) : undefined} field={f} placeholder={`Choose ${short(f).toLowerCase()}`} className="text-xl font-semibold"
                                active={slot?.kind === 'image' && slot.visual === letter && !isSubField(slot.field)} onOpen={() => setSlot({ kind: 'image', visual: letter, field: f })}
                                flags={sharedFlags(f)} onChanged={refresh} onError={setError} />
                              {subField && (
                                <SlotBox meta={meta} x={typeof subVal === 'string' && subVal ? byId.get(subVal) : undefined} field={subField} placeholder="Add a subhead (optional)" className="text-base text-[#C9CCD2]"
                                  active={slot?.kind === 'image' && slot.visual === letter && isSubField(slot.field)} onOpen={() => setSlot({ kind: 'image', visual: letter, field: subField })}
                                  flags={sharedFlags(subField)} onChanged={refresh} onError={setError} />
                              )}
                            </div>
                          );
                        })}
                        {ois.flatMap(o => o.issues).map(x => <div key={x} className="mt-2 text-sm text-red-200">{x}</div>)}
                      </Step>
                    )}
                    {hookField && oiFields.length === 0 && <p className="mb-3 text-sm text-[#858B96]">The hook goes on the video: choose it in each ad below.</p>}

                    <Step n={++step} title="The copy options" hint="Click a slot to choose a line. They are this ad's text options: one ad, not one each.">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {vs.map(({ d, i, p: pv }) => (
                          <AdPreview key={i} meta={meta} view={view} draft={draft} version={d} index={i} planned={pv} platform={p} name={nameOf(i)} status={statusOf(i)} carousel={carousel}
                            cards={cards} byId={byId} lead={!!pv?.code && lead.has(pv.code)} activeSlot={slot} nameOfCode={nameOfCode}
                            visuals={visualsOf(p).filter(l => l !== letter)}
                            onLead={on => pv?.code && setLead(cur => { const n = new Set(cur); if (on) n.add(pv.code); else n.delete(pv.code); return n; })}
                            onSlot={s => setSlot(s)} onMove={to => change(dd => moveAd(dd, i, to === 'new' ? nextVisual(dd) : to))}
                            onRemove={() => change(dd => removeAd(dd, i))} onChanged={refresh} onError={setError} />
                        ))}
                        <button onClick={() => newAd(p, letter)} className="flex min-h-40 items-center justify-center rounded-xl border-2 border-dashed border-[#343946] text-base text-[#858B96] hover:border-[#4A505D] hover:text-[#ECEDEF]">+ Copy option on ad {letter}</button>
                      </div>
                    </Step>
                  </section>
                );
              })}
              <GhostButton className="text-base" onClick={() => newAd(p, nextVisual(draft))}>+ New {p === 'TT' ? 'TikTok' : 'Meta'} ad</GhostButton>
            </div>
          ))}

          {/* ③ and ④ apply to the whole persona × territory set. */}
          <section className="rounded-xl border-2 bg-[#16181D] p-5" style={{ borderColor: PINK }}>
            <Step n={3} title="Which copy option do you expect to do best, and why?" hint="Dated and kept with the sign-off as a record of your call. Results come back per ad, not per option, so it can't be scored option by option.">
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {plan.versions.map((v, i) => v.code && !v.issues.length ? (
                  <button key={v.code} onClick={() => setLead(cur => { const n = new Set(cur); if (n.has(v.code)) n.delete(v.code); else n.add(v.code); return n; })}
                    className={cn('rounded-full border px-3 py-1 text-sm', lead.has(v.code) ? 'border-[#D94D8F] bg-[#D94D8F] text-white' : 'border-[#4A505D] text-[#C9CCD2] hover:border-[#D94D8F]')}>
                    {lead.has(v.code) ? '★ ' : ''}{nameOf(i)}
                  </button>
                ) : null)}
                {/* Whose expectation it is, when it's entered for them (it's recorded as theirs). */}
                <ForPicker meta={meta} doing="This expectation is" className="ml-auto" />
              </div>
              <textarea rows={3} aria-label="Why you expect them to lead" className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base" placeholder="e.g. Ad 2's primary answers the ‘what happens at the counter?’ question before the fold." value={reason} onChange={e => setReason(e.target.value)} />
            </Step>
            <Step n={4} title="Sign off" hint={blockedBy || `Signed off as ${whoWords(user || 'you', actingFor)}: the ads, their checks and your expectations are locked together.`}>
              <div className="flex flex-wrap items-center gap-3">
                <PinkButton disabled={!!blockedBy || busy} onClick={signOff}>{busy ? 'Checking and signing off…' : `Sign off ${visualCount} ad${visualCount === 1 ? '' : 's'}${actingFor ? ` for ${actingFor}` : ''}`}</PinkButton>
                <ForPicker meta={meta} doing="Signing off" />
              </div>
            </Step>
            {view.signoffs.length > 0 && (
              <div className="mt-2 border-t border-[#272B34] pt-3 text-sm">
                <button className="text-[#858B96] hover:text-[#ECEDEF]" onClick={() => setHistory(!history)}>{history ? '▾' : '▸'} History ({view.signoffs.map(s => `set v${s.version}`).join(', ')})</button>
                {history && (
                  <ul className="mt-2 space-y-2">
                    {[...view.signoffs].reverse().map(so => {
                      const e = view.expectations.find(x => x.signoff_id === so.id);
                      const n = so.versions?.length ?? so.lines.length;
                      return (
                        <li key={so.id} className="border-l-2 border-[#343946] pl-3 text-[#A3A8B1]">
                          <span className="font-semibold text-[#ECEDEF]">Set v{so.version}</span> · {n} copy option{n === 1 ? '' : 's'} · {whoWords(so.ready_by, so.ready_for)}, {when(so.ready_at)}
                          {e && <div>Expected to do best: {(e.stubs || []).map(nameOfCode).join(', ') || '–'}. “{e.reason}”</div>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </section>

          {/* The same sign-off, always in reach. */}
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#272B34] bg-[#16181D]/95 px-4 py-3 backdrop-blur sm:px-6">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold">{visualCount} ad{visualCount === 1 ? '' : 's'} · {plan.versions.length} copy option{plan.versions.length === 1 ? '' : 's'}</span>
              <span className={reds || plan.issues.length ? 'text-red-200' : 'text-emerald-200'}>{plan.issues.length ? `${plan.issues.length} to finish` : reds ? `${reds} red flag${reds === 1 ? '' : 's'}` : 'no red flags'}</span>
              <span className="text-[#A3A8B1]">Expected best: {leads.length ? leads.map(nameOfCode).join(', ') : 'not chosen'}</span>
              <span className="ml-auto hidden max-w-md truncate text-xs text-[#858B96] md:inline" title={blockedBy}>{blockedBy}</span>
              <ForPicker meta={meta} doing="Signing off" />
              <PinkButton className="px-4 py-1.5 text-base" disabled={!!blockedBy || busy} onClick={signOff} title={blockedBy || undefined}>{busy ? 'Signing off…' : 'Sign off'}</PinkButton>
            </div>
          </div>

          {slot && (slot.kind === 'image' || !!draft.versions[slot.index]) && (
            <Tray meta={meta} title={slot.kind === 'ad' ? `${short(trayField)} for ${nameOf(slot.index)}` : slot.card ? `Card ${slot.card}${isSubField(trayField) ? ' subhead' : ''}, ad ${slot.visual}` : `${short(trayField)}, ad ${slot.visual}`}
              lines={linesFor(trayField)} draft={draft} platformOf={platformOf}
              current={currentIn(draft, slot)}
              optional={slot.kind === 'image' || !view.fields[platformOf(draft.versions[slot.index])]?.required.includes(trayField)}
              field={label(trayField)} shared={view.lines.some(x => x.shared) || !/on_image/.test(trayField)}
              onPlace={id => { place(id); setSlot(null); }}
              onAll={slot.kind === 'ad' && /headline|description/.test(trayField) ? (id => { const v = draft.versions[slot.index]; change(d => useInAllAds(d, v.visual, platformOf(v), trayField, id)); setSlot(null); }) : undefined}
              allLabel={slot.kind === 'ad' ? `Use in every copy option on ad ${draft.versions[slot.index]?.visual}` : ''}
              onClose={() => setSlot(null)} />
          )}
        </>
      )}
    </div>
  );
}

/** A numbered step inside a visual (or the set's last steps). */
function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#272B34] text-sm font-bold text-[#ECEDEF]">{n}</span>
        <h3 className="text-base font-semibold">{title}</h3>
        {hint && <span className="text-sm text-[#858B96]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ---------- flags: plain labels at the slot they concern ----------

/** The ads' version flags that concern a field (or a carousel card, `field#k`). */
function versionFlagWords(meta: Meta, f: VersionFlag, nameOfCode: (c?: string) => string): string {
  const fl = (id: string) => { const [base, card] = id.split('#'); return `${(meta.fields[base]?.label || base).replace(/^(Meta|TikTok) /, '').replace(/ text$/, '').toLowerCase()}${card ? ` card ${card}` : ''}`; };
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (f.rule === 'VERSION_REPEAT' && f.fields.length >= 2) return `${cap(fl(f.fields[1]))} repeats the ${fl(f.fields[0])}`;
  if (f.rule === 'VERSION_TOO_ALIKE') return `Too alike: ${nameOfCode(f.other)}`;
  if (f.rule === 'VERSION_CONFLICT') return f.label.replace(/^Fields /, 'The fields ');
  if (f.severity === 'red') return `${cap(chipName(f.rule))} ${f.fields.length > 1 ? 'is in a different field' : 'is missing'}`;
  return f.label;
}
function FlagNote({ meta, f, nameOfCode }: { meta: Meta; f: VersionFlag & { from?: string }; nameOfCode: (c?: string) => string }) {
  return (
    <span className={cn('mr-1.5 mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs', f.severity === 'red' ? 'border-red-500/50 bg-red-500/10 text-red-200' : 'border-amber-400/50 bg-amber-400/10 text-amber-100')}
      title={`${f.from ? `${f.from}. ` : ''}${f.why || f.label}${f.quote ? ` · “${f.quote}”` : ''}\n${f.rule} · ${f.source}`}>
      {/* On a slot the whole ad shares: which copy option(s) it was found with. */}
      {f.from && <span className="font-semibold">{f.from}:</span>}{f.from ? versionFlagWords(meta, f, nameOfCode).replace(/^The fields /, 'its fields ') : versionFlagWords(meta, f, nameOfCode)}
    </span>
  );
}

// ---------- a slot: a line on the ad, with its edit and its line flags ----------

function SlotBox({ meta, x, field, placeholder, active, onOpen, flags = [], nameOfCode = c => c || '', className, ariaLabel, onChanged, onError }: {
  meta: Meta; x?: RL; field: string; placeholder: string; active?: boolean; onOpen: () => void; flags?: VersionFlag[]; nameOfCode?: (c?: string) => string;
  className?: string; ariaLabel?: string; onChanged: () => void; onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const f = specFor(meta, field, x?.line);
  const chars = x ? [...x.final_text].length : 0;
  // Save, then re-check the new wording straight away (the model's flags were found on the old one).
  const [rechecking, setRechecking] = useState(false);
  const save = async () => {
    let saved = false;
    try {
      setRechecking(true);
      await studio.editAndRecheck(x!.line.batch, x!.line.id, text, () => { saved = true; setEditing(false); onChanged(); });
      onChanged();
    } catch (e: any) { onError(saved ? `Saved, but not re-checked: ${e.message}. Flags marked "original wording" are from the old wording.` : e.message); } finally { setRechecking(false); }
  };
  return (
    <div className="group">
      {editing && x ? (
        <div className="space-y-1.5">
          <textarea autoFocus rows={2} aria-label={`Edit ${f?.label || field}`} className="w-full rounded-lg border-2 border-[#4A505D] p-2 text-base" value={text} onChange={e => setText(e.target.value)} />
          <div className="flex items-center gap-2 text-sm">
            <PinkButton className="px-3 py-1 text-sm" onClick={save}>Save</PinkButton>
            <GhostButton className="px-2 py-0.5 text-sm" onClick={() => setEditing(false)}>Cancel</GhostButton>
            <span className={cn('font-mono text-xs', f && [...text].length > f.visible ? 'text-amber-300' : 'text-[#858B96]')}>{[...text].length}/{f?.visible}</span>
            {x.line.ready && <span className="text-xs text-[#646A75]">A signed-off line keeps its signed wording; the edit is a new version.</span>}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-1">
          <button onClick={onOpen} aria-label={ariaLabel || (x ? `Change ${f?.label || field}: ${x.final_text}` : placeholder)}
            className={cn('min-w-0 flex-1 rounded-md px-1.5 py-1 text-left transition', active ? 'ring-2 ring-[#D94D8F]' : 'hover:bg-white/5', !x && 'border border-dashed border-[#4A505D] text-[#858B96]', x?.red.length ? 'text-red-100' : '', className)}>
            {x ? x.final_text : placeholder}
          </button>
          {x && <button onClick={() => { setText(x.final_text); setEditing(true); }} className="shrink-0 rounded px-1 text-sm text-[#646A75] opacity-60 hover:text-[#ECEDEF] group-hover:opacity-100" aria-label={`Edit the wording of ${f?.label || field}`} title="Edit the wording">✎</button>}
        </div>
      )}
      {rechecking && <div className="animate-pulse px-1.5 text-xs" style={{ color: '#D94D8F' }}>Re-checking the new wording…</div>}
      {x && f && chars > f.visible && <div className="px-1.5 text-xs text-amber-300">{chars}/{f.visible}: {/on_image/.test(field) ? 'long for the image' : 'cut off on screen'}</div>}
      {(flags.length > 0 || (x && x.line.flags.some(fl => fl.severity !== 'compliance'))) && (
        <div className="px-1">
          {flags.map((fl, k) => <FlagNote key={k} meta={meta} f={fl} nameOfCode={nameOfCode} />)}
          {x?.line.flags.filter(fl => fl.severity !== 'compliance').map(fl => <span key={fl.rule} className={cn('mr-1.5 mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs', sevTone(fl.severity) === 'amber' ? 'border-amber-400/40 text-amber-200' : 'border-[#343946] text-[#A3A8B1]')} title={`${fl.label}\n${fl.rule} · ${fl.source}`}>{flagName(fl)}</span>)}
        </div>
      )}
      {x && x.red.length > 0 && <RedFix meta={meta} x={x} onEdit={() => { setText(x.final_text); setEditing(true); }} onChanged={onChanged} onError={onError} />}
    </div>
  );
}

/**
 * Trupanion asked for a copy change on this ad (recorded at Assets): where the fix happens, so it says what was asked,
 * then that the edit needs signing off, then that it's back with Trupanion (production test, 1 Oct).
 */
function ChangeRequest({ request, status }: { request: NonNullable<PlannedVersion['compliance']['request']>; status: 'draft' | 'signed' | 'edited' }) {
  const who = [request.client_by, request.at ? when(request.at) : ''].filter(Boolean).join(', ');
  if (!request.answered) return (
    <div role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-2 text-sm text-red-100">
      <span className="font-semibold">Trupanion asked for changes{who ? ` (${who})` : ''}:</span> “{request.note}”. Edit the wording above and sign off again.
    </div>
  );
  return (
    <div className="rounded-lg border border-amber-400/50 bg-amber-400/10 p-2 text-sm text-amber-100">
      {status === 'signed' ? 'Fixed and signed off again: back with Trupanion for review.' : 'Edited for Trupanion’s request: sign off again to send it back to them.'}
      <span className="block text-xs text-amber-200/80">They asked{who ? ` (${who})` : ''}: “{request.note}”</span>
    </div>
  );
}

/** A red flag on a line: fix the wording, or override with a reason (creative lead or admin). Blocks sign-off until then. */
function RedFix({ meta, x, onEdit, onChanged, onError }: { meta: Meta; x: RL; onEdit: () => void; onChanged: () => void; onError: (m: string) => void }) {
  const [overriding, setOverriding] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [checking, setChecking] = useState(false);
  const canOverride = meta.can_override !== false;
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); onChanged(); } catch (e: any) { onError(e.message); } };
  const fromOriginal = x.line.flags.some(onOriginal);
  return (
    <div className="mt-1.5 space-y-2 rounded-lg border border-red-500/45 bg-red-500/10 p-2.5 text-sm">
      {x.red.map(fl => (
        <div key={fl.rule}>
          <div className="flex flex-wrap items-center gap-1.5"><Chip tone="red" className="text-xs">{flagName(fl)}</Chip><span className="text-[#ECEDEF]">{fl.label}</span>{fl.quote && <mark className="bg-amber-400/30 px-1 text-amber-50">{fl.quote}</mark>}</div>
          <details className="text-xs text-[#A3A8B1]"><summary className="cursor-pointer">details</summary>{fl.rule} · <Src s={fl.source} />{fl.why ? ` · ${fl.why}` : ''}</details>
          {overriding === fl.rule ? (
            <div className="mt-1.5 space-y-1.5">
              <textarea rows={2} autoFocus aria-label="Why this is OK to run" className="w-full rounded-lg border-2 border-red-500/45 px-2 py-1.5 text-sm" placeholder="Why this is OK to run (recorded with your name)" value={why} onChange={e => setWhy(e.target.value)} />
              <div className="flex flex-wrap items-center gap-2">
                <PinkButton className="px-3 py-1 text-sm" disabled={why.trim().length < 5} onClick={() => act(async () => { await studio.override(x.line.batch, x.line.id, fl.rule, why); setOverriding(null); setWhy(''); })}>Save override</PinkButton>
                <GhostButton className="px-2 py-0.5 text-sm" onClick={() => setOverriding(null)}>Cancel</GhostButton>
                <ForPicker meta={meta} doing="Overriding" />
              </div>
            </div>
          ) : (
            <div className="mt-1 flex flex-wrap gap-1.5">
              <GhostButton className="px-2 py-0.5 text-sm" onClick={onEdit}>Fix the wording</GhostButton>
              {canOverride ? <GhostButton className="px-2 py-0.5 text-sm" onClick={() => { setOverriding(fl.rule); setWhy(''); }}>Override with a reason…</GhostButton>
                : <span className="self-center text-xs text-[#646A75]">Fix it, or ask the creative lead to override it</span>}
            </div>
          )}
        </div>
      ))}
      {fromOriginal && (
        <div className="flex flex-wrap items-center gap-2 border-t border-red-500/30 pt-2 text-red-100">
          Some flags were found on the original wording.
          <GhostButton className="px-2 py-0.5 text-sm" disabled={checking} onClick={() => act(async () => { setChecking(true); try { await studio.recheck(x.line.batch, x.line.id); } finally { setChecking(false); } })}>{checking ? 'Re-checking…' : 'Re-check this wording'}</GhostButton>
        </div>
      )}
      <Overrides line={x.line} />
    </div>
  );
}

// ---------- ① a carousel's cards ----------

function CardStrip({ meta, field, letter, cards, lines, byId, flagsFor, onOpen, onChange, nameOfCode, onChanged, onError, subField, subs = [], onOpenSub, subFlagsFor, onSubsChange }: {
  meta: Meta; field: string; letter: string; cards: string[]; lines: RL[]; byId: Map<string, RL>; flagsFor: (card: number) => VersionFlag[];
  onOpen: (card: number) => void; onChange: (cards: string[] | null) => void;
  nameOfCode: (c?: string) => string; onChanged: () => void; onError: (m: string) => void;
  /** The optional subhead field, and each card's subhead (rules v2.14). */
  subField?: string; subs?: string[]; onOpenSub?: (card: number) => void; subFlagsFor?: (card: number) => VersionFlag[];
  onSubsChange?: (subs: string[] | null) => void;
}) {
  const slots = cards.length ? cards : Array(DEFAULT_CARDS).fill('');
  const set = (next: string[]) => onChange(next.some(Boolean) ? next : null);
  // A card's subhead moves with it, and goes when the card does.
  const setSubs = (next: string[]) => { const t = [...next]; while (t.length && !t[t.length - 1]) t.pop(); onSubsChange?.(t.length ? t : null); };
  const move = (i: number, d: number) => {
    const n = [...slots]; [n[i], n[i + d]] = [n[i + d], n[i]]; set(n);
    if (subs.length) { const m = [...subs]; while (m.length < slots.length) m.push(''); [m[i], m[i + d]] = [m[i + d], m[i]]; setSubs(m); }
  };
  const seqs = [...new Map(lines.filter(x => x.line.sequence_id).map(x => [x.line.sequence_id!, lines.filter(y => y.line.sequence_id === x.line.sequence_id).sort((a, b) => (a.line.card || 0) - (b.line.card || 0))])).entries()];
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm text-[#A3A8B1]">
        <label className="flex items-center gap-1">Cards
          <select aria-label={`Number of cards on ad ${letter}`} className="rounded border border-[#343946] bg-[#101216] px-1 py-0.5 text-sm" value={slots.length}
            onChange={e => { const n = Number(e.target.value); set(n > slots.length ? [...slots, ...Array(n - slots.length).fill('')] : slots.slice(0, n)); if (n < subs.length) setSubs(subs.slice(0, n)); }}>
            {Array.from({ length: MAX_CARDS }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {seqs.length > 0 && (
          <label className="flex items-center gap-1">Use a whole sequence
            <select aria-label={`Sequence for ad ${letter}`} className="max-w-xs rounded border border-[#343946] bg-[#101216] px-1 py-0.5 text-sm" value=""
              onChange={e => { const s = seqs.find(([id]) => id === e.target.value); if (s) set(s[1].map(x => x.line.id)); }}>
              <option value="">Choose…</option>
              {seqs.map(([id, xs]) => <option key={id} value={id}>{xs.map(x => x.final_text).join(' → ')}</option>)}
            </select>
          </label>
        )}
      </div>
      <ol className="flex gap-2 overflow-x-auto pb-1">
        {slots.map((id, i) => {
          const x = id ? byId.get(id) : undefined;
          return (
            <li key={i} className="w-44 shrink-0 rounded-lg border border-[#343946] bg-[#16181D] p-2">
              <div className="mb-1 flex items-center justify-between text-xs text-[#858B96]">
                <span>Card {i + 1}{i === 0 ? ' · hook' : i === slots.length - 1 ? ' · end' : ''}</span>
                <span className="flex gap-0.5">
                  <button className="px-1 hover:text-[#ECEDEF] disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move card ${i + 1} left`}>←</button>
                  <button className="px-1 hover:text-[#ECEDEF] disabled:opacity-30" disabled={i === slots.length - 1} onClick={() => move(i, 1)} aria-label={`Move card ${i + 1} right`}>→</button>
                </span>
              </div>
              {/* The same slot as every other field: the line's flags, the version checks for this card, an inline edit (re-checked), and Fix / Override for a red. */}
              <SlotBox meta={meta} x={x} field={field} placeholder="Choose card text" onOpen={() => onOpen(i + 1)} flags={flagsFor(i + 1)} nameOfCode={nameOfCode}
                className={cn('flex aspect-square w-full items-center justify-center p-2 text-center text-sm font-semibold leading-snug', x ? 'bg-[#1C1F26] text-[#F2F3F5] hover:bg-[#232733]' : '', x?.red.length ? 'ring-1 ring-red-500/60' : '')}
                ariaLabel={x ? `Change card ${i + 1}: ${x.final_text}` : `Choose card ${i + 1}`} onChanged={onChanged} onError={onError} />
              {subField && onOpenSub && (
                <div className="mt-1">
                  <SlotBox meta={meta} x={subs[i] ? byId.get(subs[i]) : undefined} field={subField} placeholder="Subhead (optional)" onOpen={() => onOpenSub(i + 1)} flags={subFlagsFor?.(i + 1) || []} nameOfCode={nameOfCode}
                    className="w-full text-center text-xs text-[#C9CCD2]" ariaLabel={subs[i] ? `Change card ${i + 1}'s subhead` : `Add a subhead to card ${i + 1}`} onChanged={onChanged} onError={onError} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- ② an ad, shown like a feed ad ----------

function AdPreview({ meta, view, draft, version, index, planned, platform, name, status, carousel, cards, byId, lead, activeSlot, nameOfCode, visuals, onLead, onSlot, onMove, onRemove, onChanged, onError }: {
  meta: Meta; view: ReadyView; draft: ReadyDraft; version: DraftVersion; index: number; planned?: ReadyView['plan']['versions'][number]; platform: string; name: string;
  status: 'draft' | 'signed' | 'edited'; carousel: boolean; cards: string[]; byId: Map<string, RL>; lead: boolean; activeSlot: Slot | null; nameOfCode: (c?: string) => string;
  visuals: string[]; onLead: (on: boolean) => void; onSlot: (s: Slot) => void; onMove: (to: string) => void; onRemove: () => void; onChanged: () => void; onError: (m: string) => void;
}) {
  const vf = view.fields[platform] || { required: [], optional: [], per_visual: [] };
  const flags = planned?.checks?.flags || [];
  const complete = !!planned && !planned.issues.length;
  const [copied, setCopied] = useState(false);
  const slotProps = (field: string) => ({
    meta, field, x: version.fields[field] ? byId.get(version.fields[field]) : undefined, nameOfCode,
    placeholder: `Choose ${(meta.fields[field]?.label || field).replace(/^(Meta|TikTok) /, '').toLowerCase()}${vf.optional.includes(field) ? ' (optional)' : ''}`,
    active: activeSlot?.kind === 'ad' && activeSlot.index === index && activeSlot.field === field,
    onOpen: () => onSlot({ kind: 'ad', index, field }), flags: flagsAt(flags, field), onChanged, onError,
  });
  const find = (re: RegExp) => [...vf.required, ...vf.optional].find(f => re.test(f));
  const primary = find(/primary/), headline = find(/headline/), description = find(/description/), caption = find(/caption/), hook = find(/hook/);
  const others = [...vf.required, ...vf.optional].filter(f => ![primary, headline, description, caption, hook].includes(f));
  const oiId = typeof draft.on_image[version.visual] === 'string' ? draft.on_image[version.visual] as string : '';
  const oi = oiId ? byId.get(oiId) : undefined;
  const oiField = vf.per_visual.find(f => !isSubField(f));
  // The subhead under it (rules v2.14), on the image too; per card on a carousel.
  const subVal = draft.on_image_sub?.[version.visual];
  const sub = typeof subVal === 'string' && subVal ? byId.get(subVal) : undefined;
  const cardSub = (k: number) => (Array.isArray(subVal) && subVal[k] ? byId.get(subVal[k]) : undefined);
  const adFlags = flags.filter(f => !f.fields.length);
  const tone = personaColor(view.persona);
  return (
    <article className={cn('flex flex-col overflow-hidden rounded-xl border-2 bg-[#16181D]', !complete ? 'border-red-500/40' : lead ? 'border-[#D94D8F]' : 'border-[#272B34]')}>
      <header className="flex items-center gap-2 border-b border-[#272B34] px-3 py-2 text-xs text-[#858B96]">
        <span className="h-6 w-6 shrink-0 rounded-full" style={{ background: tint(tone.base, 0.5) }} aria-hidden />
        <span><span className="font-semibold text-[#ECEDEF]">Trupanion</span> · Sponsored</span>
        <span className="ml-auto font-semibold text-[#C9CCD2]">{name}</span>
        <details className="relative">
          <summary className="cursor-pointer list-none rounded px-1.5 text-base leading-none text-[#858B96] hover:text-[#ECEDEF]" aria-label={`More for ${name}`}>⋯</summary>
          <div className="absolute right-0 z-10 mt-1 w-48 rounded-lg border border-[#343946] bg-[#101216] py-1 text-sm text-[#ECEDEF] shadow-lg">
            {visuals.map(l => <button key={l} className="block w-full px-3 py-1.5 text-left hover:bg-white/5" onClick={() => onMove(l)}>Move to ad {l}</button>)}
            <button className="block w-full px-3 py-1.5 text-left hover:bg-white/5" onClick={() => onMove('new')}>Move to a new ad</button>
            <button className="block w-full px-3 py-1.5 text-left text-red-200 hover:bg-white/5" onClick={onRemove}>Remove this copy option</button>
          </div>
        </details>
      </header>

      {platform === 'TT' ? (
        <div className="space-y-2 p-3">
          <div className="relative mx-auto flex aspect-[9/16] w-full max-w-[220px] flex-col justify-center rounded-lg p-3" style={{ background: `linear-gradient(160deg, ${tint(tone.base, 0.35)}, #0E0F12)` }}>
            {hook ? <SlotBox {...slotProps(hook)} className="text-center text-lg font-bold text-white" /> : <span className="text-center text-sm text-[#858B96]">The video</span>}
          </div>
          {caption && <SlotBox {...slotProps(caption)} className="text-sm" />}
        </div>
      ) : (
        <>
          {primary && <div className="px-2 pt-2"><SlotBox {...slotProps(primary)} className="text-[15px] leading-snug text-[#F2F3F5]" /></div>}
          {/* The image: the visual's on-image text (or a carousel's cards), the same on every ad of the visual. */}
          <div className="mt-2">
            {carousel ? (
              <div className="flex gap-1.5 overflow-x-auto px-2 pb-1">
                {(cards.length ? cards : Array(DEFAULT_CARDS).fill('')).map((id, k) => {
                  const x = id ? byId.get(id) : undefined;
                  return (
                    <button key={k} onClick={() => oiField && onSlot({ kind: 'image', visual: version.visual, field: oiField, card: k + 1 })}
                      className="flex aspect-square w-32 shrink-0 items-center justify-center rounded-md p-2 text-center text-xs font-semibold leading-snug text-white" style={{ background: `linear-gradient(160deg, ${tint(tone.base, 0.4)}, #16181D)` }}
                      aria-label={x ? `Card ${k + 1}: ${x.final_text}` : `Choose card ${k + 1}`}>
                      {x ? <span>{x.final_text}{cardSub(k) && <span className="mt-1 block text-[10px] font-normal text-white/80">{cardSub(k)!.final_text}</span>}</span> : <span className="text-[#A3A8B1]">Card {k + 1}</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <button onClick={() => oiField && onSlot({ kind: 'image', visual: version.visual, field: oiField })} disabled={!oiField}
                className="flex aspect-[4/3] w-full items-center justify-center p-6 text-center text-xl font-bold leading-tight text-white" style={{ background: `linear-gradient(160deg, ${tint(tone.base, 0.45)}, #16181D)` }}
                aria-label={oi ? `On-image text: ${oi.final_text}` : oiField ? 'Choose the on-image text' : 'The image'}>
                {oi ? <span>{oi.final_text}{sub && <span className="mt-2 block text-base font-normal text-white/85">{sub.final_text}</span>}</span> : <span className="text-base font-normal text-[#A3A8B1]">{oiField ? 'Choose the on-image text (step ①)' : 'The image'}</span>}
              </button>
            )}
          </div>
          <div className="flex items-start gap-2 border-t border-[#272B34] bg-[#1C1F26] px-2 py-2">
            <div className="min-w-0 flex-1">
              {headline && <SlotBox {...slotProps(headline)} className="text-sm font-semibold text-[#ECEDEF]" />}
              {description && <SlotBox {...slotProps(description)} className="text-xs text-[#A3A8B1]" />}
            </div>
            <span className="mt-1 shrink-0 rounded-md bg-[#343946] px-3 py-1.5 text-xs font-semibold text-[#ECEDEF]" aria-hidden>Learn more</span>
          </div>
        </>
      )}
      {others.map(f => <div key={f} className="px-2 pb-1"><SlotBox {...slotProps(f)} className="text-sm" /></div>)}

      <footer className="mt-auto space-y-1.5 border-t border-[#272B34] px-3 py-2">
        {planned?.compliance.request && <ChangeRequest request={planned.compliance.request} status={status} />}
        {planned?.issues.map(i => <div key={i} className="text-sm text-red-200">{i[0].toUpperCase() + i.slice(1)}</div>)}
        {adFlags.length > 0 && <div>{adFlags.map((f, k) => <FlagNote key={k} meta={meta} f={f} nameOfCode={nameOfCode} />)}</div>}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={cn('rounded-full border px-2 py-0.5', status === 'signed' ? 'border-emerald-500/60 text-emerald-300' : status === 'edited' ? 'border-amber-400/60 text-amber-200' : 'border-[#343946] text-[#A3A8B1]')}>
            {status === 'signed' ? 'Signed off' : status === 'edited' ? 'Edited since sign-off' : 'Draft'}
          </span>
          <button onClick={() => onLead(!lead)} disabled={!complete} className={cn('rounded-full border px-2.5 py-0.5 font-medium disabled:opacity-40', lead ? 'border-[#D94D8F] bg-[#D94D8F] text-white' : 'border-[#4A505D] text-[#C9CCD2] hover:border-[#D94D8F]')}>
            {lead ? '★ Expected to do best' : '☆ Expect to do best'}
          </button>
          {planned?.code && (
            <button className="ml-auto font-mono text-[11px] text-[#646A75] hover:text-[#A3A8B1]" title={`${NAMING_TIP}. Click to copy.`}
              onClick={() => { navigator.clipboard?.writeText(planned.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); }}>
              {copied ? 'copied' : planned.code}
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}

// ---------- the tray: kept lines for a slot ----------

function Tray({ meta, title, lines, draft, platformOf, current, optional, field, shared, onPlace, onAll, allLabel, onClose }: {
  /** field: the field's name, for the empty tray; shared: post copy, which can also come from the shared captions pool. */
  field: string; shared: boolean;
  meta: Meta; title: string; lines: RL[]; draft: ReadyDraft; platformOf: (v: DraftVersion) => string; current: string; optional: boolean;
  onPlace: (id: string) => void; onAll?: (id: string) => void; allLabel: string; onClose: () => void;
}) {
  const [hist, setHist] = useState<string | null>(null);
  const withUses = lines.map(x => ({ x, uses: usesOf(draft, x.line.id, platformOf) }));
  const inUse = withUses.filter(y => y.uses.length), free = withUses.filter(y => !y.uses.length);
  const pool = withUses.filter(y => y.x.shared), mine = withUses.filter(y => !y.x.shared), anyShared = pool.length > 0;
  const Item = ({ x, uses }: { x: RL; uses: string[] }) => {
    const f = specFor(meta, x.line.field, x.line);
    const chars = [...x.final_text].length;
    return (
      <li className={cn('rounded-lg border p-3', x.line.id === current ? 'border-[#D94D8F] bg-[#D94D8F]/10' : 'border-[#272B34] bg-[#16181D]')}>
        <button className="w-full text-left text-base leading-snug text-[#F2F3F5] hover:text-white" onClick={() => onPlace(x.line.id)}>{x.final_text}</button>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          <span className={cn('font-mono', f && chars > f.visible ? 'text-amber-300' : 'text-[#858B96]')}>{chars}/{f?.visible}</span>
          {x.red.map(fl => <Chip key={fl.rule} tone="red" className="text-xs" title={fl.label}>{flagName(fl)}</Chip>)}
          {x.line.flags.filter(fl => fl.severity !== 'compliance').map(fl => <Chip key={fl.rule} tone={sevTone(fl.severity)} className="text-xs" title={fl.label}>{flagName(fl)}</Chip>)}
          {x.shared && <Chip tone="outline" className="text-xs" title="From the shared captions pool">shared</Chip>}
          {x.line.card && <span className="text-[#858B96]">sequence card {x.line.card}</span>}
          {uses.length > 0 && <span className="text-[#A3A8B1]">In: {uses.join(', ')}</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <GhostButton className="px-2.5 py-0.5 text-sm" onClick={() => onPlace(x.line.id)}>{x.line.id === current ? 'In this slot' : 'Use here'}</GhostButton>
          {onAll && <GhostButton className="px-2.5 py-0.5 text-sm" onClick={() => onAll(x.line.id)}>{allLabel}</GhostButton>}
          <button className="text-xs text-[#646A75] hover:text-[#ECEDEF]" onClick={() => setHist(hist === x.line.id ? null : x.line.id)}>{hist === x.line.id ? 'hide history' : 'history'}</button>
        </div>
        {hist === x.line.id && <LineHistory line={x.line} />}
      </li>
    );
  };
  return (
    <aside role="dialog" aria-label={title} className="fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-[#343946] bg-[#101216] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-[#272B34] px-4 py-3">
        <h2 className="mr-auto text-base font-semibold">{title}</h2>
        {optional && current && <GhostButton className="px-2 py-0.5 text-sm" onClick={() => onPlace('')}>Clear</GhostButton>}
        <button onClick={onClose} className="rounded px-2 text-lg text-[#858B96] hover:text-[#ECEDEF]" aria-label="Close">✕</button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!lines.length && (
          <div className="space-y-2 rounded-lg border border-dashed border-[#343946] p-3 text-sm text-[#A3A8B1]">
            <p className="font-semibold text-[#C9CCD2]">No kept lines for {field} yet.</p>
            <p>{optional ? 'This slot is optional: leave it empty, or ' : 'To fill this slot, '}write or paste {field.toLowerCase()} lines in Write (tick the field){shared ? ', for this territory or in Shared captions for copy used across personas' : ' for this territory'}, then keep them in Review. Kept lines appear here.</p>
          </div>
        )}
        {/* Post copy: the shared captions pool first, then this territory's own lines. */}
        {anyShared ? <>
          <div><Label>Shared captions ({pool.length})</Label><p className="mb-2 text-xs text-[#858B96]">Reused across personas: Trupanion’s decision on the wording can be recorded once for every code using it.</p><ul className="space-y-2">{pool.map(y => <Item key={y.x.line.id} {...y} />)}</ul></div>
          <div><Label>This territory ({mine.length})</Label>{mine.length ? <ul className="space-y-2">{mine.map(y => <Item key={y.x.line.id} {...y} />)}</ul> : <p className="text-sm text-[#858B96]">No kept lines of its own for this field.</p>}</div>
        </> : <>
          {inUse.length > 0 && <div><Label>In use</Label><ul className="space-y-2">{inUse.map(y => <Item key={y.x.line.id} {...y} />)}</ul></div>}
          {free.length > 0 && <div><Label>Not used yet</Label><ul className="space-y-2">{free.map(y => <Item key={y.x.line.id} {...y} />)}</ul></div>}
        </>}
      </div>
    </aside>
  );
}
