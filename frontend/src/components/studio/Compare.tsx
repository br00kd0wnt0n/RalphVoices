// Blind compare: a separate exercise, outside the writing flow (its lines aren't checked or saved to runs).
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { HOSTED, studio, type Brief, type CompareSet, type Meta, type Reveal } from '@/lib/studioApi';
import { Chip, GhostButton, Label, PINK, PinkButton, params } from './ui';

export function Compare({ meta, brief }: { meta: Meta; brief: Brief }) {
  const [names, setNames] = useState<string[]>([]);
  const [set, setSet] = useState<CompareSet | null>(null);
  const [models, setModels] = useState('gpt-4o, gpt-4.1, gpt-5.5, claude-opus-5-5');
  const [n, setN] = useState(8);
  const [status, setStatus] = useState('');
  const [key, setKey] = useState<Reveal | null>(null);
  const load = (name: string) => { setKey(null); studio.compareSet(name).then(setSet); };
  useEffect(() => { studio.compares().then(ns => { setNames(ns); const n = params.get('compare') || ns[0]; if (n) load(n); }).catch(() => {}); }, []);

  async function run() {
    setStatus('Starting…');
    const { job } = await studio.compare(brief, models.split(',').map(s => s.trim()).filter(Boolean), n);
    const es = studio.events(job, e => {
      if (e.type === 'status') setStatus(e.message);
      if (e.type === 'error') { setStatus(`Stopped: ${e.message}`); es.close(); }
      if (e.type === 'done') { es.close(); setStatus(''); studio.compares().then(ns => { setNames(ns); load(e.batch); }); }
    });
  }
  async function mark(id: string, patch: { favourite?: boolean; note?: string }) {
    if (!set) return;
    const l = await studio.compareMark(set.name, id, patch);
    setSet(cur => (cur ? { ...cur, lines: cur.lines.map(x => (x.id === id ? l : x)) } : cur));
  }
  const revealed = !!key;

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-[#272B34] bg-[#16181D] p-5">
        <div className="mr-auto">
          <div className="text-lg font-semibold">The brief</div>
          <div className="text-base text-[#858B96]">{meta.personas[brief.persona]?.name} · {meta.territories[brief.territory]?.name}, from your brief tab. Pick 2–4 writers.</div>
        </div>
        <div><Label>Writers (2-4)</Label><input className="w-96 rounded-lg border-2 border-[#343946] px-3 py-2 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" value={models} onChange={e => setModels(e.target.value)} /></div>
        <div><Label>Lines each</Label><input type="number" className="w-24 rounded-lg border-2 border-[#343946] px-3 py-2 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" value={n} onChange={e => setN(Number(e.target.value))} /></div>
        <PinkButton onClick={run} disabled={!!status}>{status || 'Run blind compare'}</PinkButton>
      </div>
      {names.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <select className="rounded-lg border-2 border-[#343946] bg-[#101216] px-3 py-1.5 text-base" value={set?.name || ''} onChange={e => load(e.target.value)}>
            {names.map(x => <option key={x}>{x}</option>)}
          </select>
          {set && <span className="text-base text-[#858B96]">{set.lines.length} lines · {set.lines.filter(l => l.favourite).length} starred by you{HOSTED ? ' (everyone’s stars show at the reveal)' : ''}</span>}
          {set && !revealed && <GhostButton className="ml-auto" onClick={async () => setKey(await studio.reveal(set.name))}>Reveal the writers</GhostButton>}
        </div>
      )}
      {key && (
        <div className="flex flex-wrap gap-4 rounded-xl border-2 p-5" style={{ borderColor: PINK }}>
          {Object.entries(key.labels).map(([label, model]) => (
            <div key={label} className="text-base"><span className="font-bold">Writer {label}</span> = {model} · <span className="font-semibold">{key.tally[label] || 0} starred</span></div>
          ))}
          {key.by_person && Object.keys(key.by_person).length > 1 && (
            <div className="w-full border-t border-[#272B34] pt-3 text-sm text-[#A3A8B1]">
              {Object.entries(key.by_person).map(([who, t]) => <div key={who}>{who}: {Object.entries(t).map(([label, n]) => `${label} ${n}`).join(' · ')}</div>)}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {set?.lines.map(l => (
          <div key={l.id} className={cn('rounded-xl border-2 bg-[#16181D] p-5', l.favourite ? 'border-[#D94D8F]' : 'border-[#272B34]')}>
            <div className="mb-2 flex items-center gap-2 text-sm text-[#858B96]">
              <span className="font-mono font-semibold text-[#ECEDEF]">{l.id}</span>
              <span>{meta.fields[l.field]?.label}</span>
              <span className="font-mono">{l.chars}/{meta.fields[l.field]?.visible}</span>
              {revealed && <Chip tone="outline">Writer {l.label} · {key!.labels[l.label]}</Chip>}
              <button className="ml-auto text-3xl leading-none" style={{ color: l.favourite ? PINK : '#4A505D' }} onClick={() => mark(l.id, { favourite: !l.favourite })} aria-label="Star">★</button>
            </div>
            <p className="text-[22px] leading-snug text-[#F2F3F5]">{l.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
