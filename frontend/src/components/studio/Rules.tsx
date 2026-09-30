// Rules: the live rules in plain words, versions (hosted, admin uploads), and your verdicts on Pre-flight's flags.
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { HOSTED, studio, type ActiveRules, type Meta, type RuleEntry, type RulesVersion } from '@/lib/studioApi';
import { Chip, GhostButton, Intro, Label, PersonaPanel, PinkButton, Src, personaKeys, when } from './ui';

export function Rules({ meta, admin, onActivated }: { meta: Meta | null; admin: boolean; onActivated: () => void }) {
  const [list, setList] = useState<RulesVersion[]>([]);
  const [error, setError] = useState('');
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [drafted, setDrafted] = useState<string | null>(null); // just uploaded as a draft: not live yet
  const [active, setActive] = useState<ActiveRules | null>(null);
  // Versions exist only hosted; the plain-words view of the live rules works everywhere.
  const load = () => { if (HOSTED) studio.rules().then(setList).catch(e => setError(e.message)); studio.activeRules().then(setActive).catch(() => {}); };
  useEffect(() => { load(); }, []);
  const live = list.find(r => r.status === 'active') || (active && !HOSTED ? { version: active.version, status: 'active', created_at: active.updated || '' } as RulesVersion : undefined);
  async function activate(v: string, ask = true) {
    if (ask && !window.confirm(`Make ${v} the live rules? New checks use it straight away.`)) return;
    try { setList(await studio.activateRules(v)); setDrafted(null); onActivated(); } catch (e: any) { setError(e.message); }
  }
  async function upload(andActivate: boolean) {
    if (!file) return;
    try {
      const body = JSON.parse(await file.text());
      const v = version || body.version;
      if (andActivate && !window.confirm(`Upload ${v} and make it the live rules? New checks use it straight away.`)) return;
      setList(await studio.uploadRules(v, body, notes, andActivate));
      setDrafted(andActivate ? null : v);
      if (andActivate) onActivated();
      setFile(null); setVersion(''); setNotes(''); setError('');
    } catch (e: any) { setError(e.message); }
  }
  return (
    <div className="max-w-4xl space-y-5">
      <Intro title="Rules" line="What every line and asset is checked against, in plain words.">
        <p>The live rules are built from the client’s legal, brand and persona material. Each run records the version it was checked under. {admin ? 'You can upload and activate versions below.' : 'Brook changes them.'}</p>
      </Intro>
      <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border-2 px-5 py-4', live ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-amber-400/60 bg-amber-400/10')}>
        <span className={cn('text-sm font-semibold uppercase tracking-wider', live ? 'text-emerald-300' : 'text-amber-200')}>Live</span>
        {live
          ? <span className="text-lg"><span className="font-mono font-semibold">{live.version}</span><span className="text-base text-[#A3A8B1]">{live.activated_by ? `, activated by ${live.activated_by}` : live.created_by ? `, uploaded by ${live.created_by}` : ''}{live.activated_at ? ` at ${when(live.activated_at)}` : ` on ${when(live.created_at)}`}</span></span>
          : <span className="text-base text-amber-100">No rules are live yet. Upload a version and activate it.</span>}
      </div>
      {drafted && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-amber-400/60 bg-amber-400/10 px-5 py-4 text-base text-amber-50">
          <span><span className="font-mono font-semibold">{drafted}</span> uploaded as a draft. {live ? <><span className="font-mono">{live.version}</span> is still live.</> : 'Nothing is live yet.'}</span>
          <PinkButton className="ml-auto px-4 py-1.5 text-base" onClick={() => activate(drafted)}>Activate {drafted}</PinkButton>
        </div>
      )}
      {error && <div className="rounded-lg border-2 border-red-500/45 bg-red-500/10 p-3 text-base text-red-200">{error}</div>}
      {meta?.preflight?.enabled && <Agreement />}
      {active && <LiveRules active={active} meta={meta} />}
      {HOSTED && <h2 className="pt-2 text-lg font-semibold">Versions</h2>}
      {HOSTED && <ul className="divide-y divide-[#272B34] rounded-xl border border-[#272B34] bg-[#16181D]">
        {list.map(r => (
          <li key={r.version} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="font-mono text-base font-semibold">{r.version}</span>
            <Chip tone={r.status === 'active' ? 'outline' : 'grey'} className={r.status === 'active' ? 'border-emerald-500 text-emerald-300' : ''}>{r.status === 'active' ? 'live' : r.status}</Chip>
            <span className="text-sm text-[#858B96]">{when(r.created_at)}{r.created_by ? ` · ${r.created_by}` : ''}{r.notes ? ` · ${r.notes}` : ''}</span>
            {admin && r.status !== 'active' && <GhostButton className="ml-auto" onClick={() => activate(r.version)}>Activate</GhostButton>}
          </li>
        ))}
        {!list.length && !error && <li className="px-5 py-3 text-[#858B96]">No versions yet.</li>}
      </ul>}
      {admin && (
        <section className="space-y-3 rounded-xl border border-dashed border-[#4A505D] p-5">
          <h2 className="text-lg font-semibold">Upload a new version</h2>
          <p className="text-sm text-[#A3A8B1]">A studio-rules.json file. “Upload and activate” makes it live straight away; “Upload as draft” keeps the current version live until you activate the new one. Versions are never overwritten.</p>
          <input type="file" accept="application/json,.json" onChange={e => setFile(e.target.files?.[0] || null)} className="text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <input className="rounded-lg border-2 border-[#343946] px-3 py-2 text-base" placeholder="Version (defaults to the file’s)" value={version} onChange={e => setVersion(e.target.value)} />
            <input className="rounded-lg border-2 border-[#343946] px-3 py-2 text-base" placeholder="What changed" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <PinkButton disabled={!file} onClick={() => upload(true)}>Upload and activate</PinkButton>
            <GhostButton disabled={!file} className="text-base" onClick={() => upload(false)}>Upload as draft</GhostButton>
          </div>
        </section>
      )}
    </div>
  );
}

function LiveRules({ active, meta }: { active: ActiveRules; meta: Meta | null }) {
  const sev = (r: RuleEntry) => r.severity === 'compliance'
    ? <Chip tone="red" className="shrink-0 text-xs">breaks a client rule</Chip>
    : r.severity === 'warn' ? <Chip tone="amber" className="shrink-0 text-xs">worth a look</Chip> : <Chip tone="grey" className="shrink-0 text-xs">a note</Chip>;
  const list = (items: RuleEntry[]) => (
    <ul className="space-y-2">
      {items.map(r => (
        <li key={r.id} className="flex items-start gap-2">
          {sev(r)}
          <div className="min-w-0">
            <div className="text-base text-[#ECEDEF]">{r.rule}{r.status === 'pending' && <span className="ml-2 text-xs text-amber-300">awaiting the client’s confirmation</span>}</div>
            {r.what_to_do && <div className="text-sm text-[#A3A8B1]"><span className="font-semibold">What to do:</span> {r.what_to_do}</div>}
            <div className="text-xs text-[#646A75]"><Src s={r.source} />{r.applies_to === 'both' ? ' · also checked on images' : ''}</div>
          </div>
        </li>
      ))}
    </ul>
  );
  const copyBrand = active.brand.filter(b => b.applies_to !== 'visual');
  const visual = active.brand.filter(b => b.applies_to === 'visual');
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-5">
        <h2 className="mb-1 text-lg font-semibold">Copy rules <span className="text-sm font-normal text-[#858B96]">(every line)</span></h2>
        <p className="mb-3 text-sm text-[#858B96]">Red means it breaks a client rule: fix it, or override with a reason.</p>
        {list(active.compliance)}
      </section>
      <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-5">
        <h2 className="mb-3 text-lg font-semibold">Brand rules</h2>
        {list(copyBrand)}
        {visual.length > 0 && (
          <>
            <h3 className="mb-2 mt-4 text-base font-semibold">On images and video only <span className="text-sm font-normal text-[#858B96]">(checked in Assets, not on copy)</span></h3>
            {list(visual)}
          </>
        )}
        {active.disclaimer && (
          <>
            <h3 className="mb-2 mt-4 text-base font-semibold">On the last screen <span className="text-sm font-normal text-[#858B96]">(checked in Assets)</span></h3>
            {list([active.disclaimer])}
            <p className="mt-2 text-sm text-[#A3A8B1]">{active.disclaimer.active ? <>Approved text: “{active.disclaimer.text}”</> : 'Off for now: no approved disclaimer text in the rules yet. Pre-flight shows a grey note until it’s added.'}</p>
          </>
        )}
      </section>
      {active.clarity.length > 0 && (
        <section className="rounded-xl border border-[#272B34] bg-[#16181D] p-5">
          <h2 className="mb-3 text-lg font-semibold">Clarity</h2>
          {list(active.clarity)}
        </section>
      )}
      <section className="space-y-3 rounded-xl border border-[#272B34] bg-[#16181D] p-5">
        <h2 className="text-lg font-semibold">Personas</h2>
        {meta ? personaKeys(active.personas).map(k => <PersonaPanel key={k} meta={meta} persona={k} />) : Object.entries(active.personas).map(([k, p]) => <div key={k} className="font-semibold">{p.name}</div>)}
      </section>
    </div>
  );
}

/** Your verdicts on Pre-flight's flags (moved here from Pre-flight): they tune the checks; the aim is to agree with 9 in 10. */
function Agreement() {
  const [a, setA] = useState<{ marked: number; agree: number; rate: number | null } | null>(null);
  useEffect(() => { studio.pfAgreement().then(setA).catch(() => {}); }, []);
  const rate = a?.rate;
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-xl border border-[#272B34] bg-[#16181D] px-5 py-4">
      <div className="mr-auto">
        <Label>Your verdicts on the asset checks</Label>
        <p className="text-sm text-[#858B96]">Agree or disagree with each flag in Assets. They help tune the checks: the aim is to agree with 9 in 10.</p>
      </div>
      <div className="text-right">
        <div className="text-2xl font-bold">{rate === null || rate === undefined ? '–' : `${Math.round(rate * 100)}%`}<span className={cn('ml-2 text-sm font-medium', rate != null && rate >= 0.9 ? 'text-emerald-300' : 'text-[#858B96]')}>aim 90%</span></div>
        <div className="text-sm text-[#858B96]">{a ? `${a.agree} of ${a.marked} agreed so far` : ''}</div>
      </div>
    </section>
  );
}
