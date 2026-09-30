// Territories: a utility (top right), editable with history. "Write for this" sets the context and opens Write.
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { studio, type Meta, type Territory } from '@/lib/studioApi';
import { Chip, GhostButton, Intro, Label, PINK, PersonaPanel, PinkButton, plainSource, personaKeys, territoryName } from './ui';

export function Territories({ meta, onSaved, onBrief }: { meta: Meta; onSaved: () => void; onBrief: (code: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null); // code, or 'new:<persona>'
  const [showRetired, setShowRetired] = useState(false);
  return (
    <div className="max-w-7xl space-y-8">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto min-w-0 flex-1">
          <Intro title="Territories" line="Pick one to write for; edit them as feedback comes in.">
            <p>These start from the pitch. Every change keeps who made it and why, and the pitch version stays on record. “Write for this” sets the persona and territory for every step.</p>
          </Intro>
        </div>
        <GhostButton active={showRetired} onClick={() => setShowRetired(!showRetired)}>Show retired</GhostButton>
      </div>
      {personaKeys(meta.personas).map(pk => { const p = meta.personas[pk];
        const list = Object.entries(meta.territories).filter(([, x]) => x.persona === pk && (showRetired || x.status !== 'retired'));
        return (
          <section key={pk}>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <GhostButton className="px-3 py-1 text-sm" onClick={() => setEditing(`new:${pk}`)}>+ New territory</GhostButton>
            </div>
            <PersonaPanel meta={meta} persona={pk} className="mb-3" />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {editing === `new:${pk}` && <TerritoryEditor meta={meta} persona={pk} onDone={saved => { setEditing(null); if (saved) onSaved(); }} />}
              {list.map(([code, t]) => editing === code
                ? <TerritoryEditor key={code} meta={meta} code={code} territory={t} persona={pk} onDone={saved => { setEditing(null); if (saved) onSaved(); }} />
                : <TerritoryCard key={code} meta={meta} code={code} t={t} onEdit={() => setEditing(code)} onBrief={() => onBrief(code)} onSaved={onSaved} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TerritoryCard({ meta, code, t, onEdit, onBrief, onSaved }: { meta: Meta; code: string; t: Territory; onEdit: () => void; onBrief: () => void; onSaved: () => void }) {
  const [history, setHistory] = useState(false);
  const retired = t.status === 'retired';
  const angle = meta.personas[t.persona]?.triggers.find(x => x.id === t.angle)?.label || t.angle;
  async function toggleRetire() {
    const note = window.prompt(retired ? 'Why restore it?' : 'Why retire it? (e.g. client feedback, 28 Sep)') ?? null;
    if (note === null) return;
    await studio.saveTerritory(code, { status: retired ? 'active' : 'retired' }, note);
    onSaved();
  }
  return (
    <div className={cn('flex flex-col rounded-xl border-2 bg-[#16181D] p-5', retired ? 'border-[#272B34] opacity-60' : 'border-[#272B34]')}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-bold">{territoryName(t)}</h3>
        <Chip tone={t.origin === 'pitch' ? 'grey' : 'outline'} className={t.origin !== 'pitch' ? 'border-[#D94D8F] text-[#D94D8F]' : ''}>{t.origin === 'new' ? 'new' : t.origin === 'edited' ? 'edited' : t.status === 'springboard' ? 'from the research' : 'from the pitch'}</Chip>
        {retired && <Chip tone="grey">retired</Chip>}

      </div>
      <div className="mb-2 text-sm text-[#858B96]">{t.format} · Angle: {angle}</div>
      {t.headline && <p className="mb-2 text-base font-semibold text-[#F2F3F5]" title={t.headline_source ? `Pitched headline · ${plainSource(t.headline_source)}` : 'Pitched headline'}><span className="mr-1 text-xs font-normal uppercase tracking-wider text-[#858B96]">Pitched as</span>“{t.headline}”</p>}
      {(t.name_note || t.headline_note) && <p className="mb-2 text-sm text-amber-200">{[t.pitched_name && t.pitched_name !== t.name ? `Pitched as “${t.pitched_name.replace(/\.$/, '')}”.` : '', t.name_note, t.headline_note].filter(Boolean).join(' ')}</p>}
      <p className="mb-3 text-base leading-snug text-[#C9CCD2]">{t.premise}</p>
      {t.updated_by && <p className="mb-3 text-sm text-[#858B96]">Changed by {t.updated_by}, {t.updated_at?.slice(0, 10)}{t.note ? `: ${t.note}` : ''}</p>}
      {history && t.history?.length ? (
        <ul className="mb-3 space-y-1 border-l-2 border-[#272B34] pl-3 text-sm text-[#858B96]">
          {[...t.history].reverse().map((h, i) => (
            <li key={i}>{h.at.slice(0, 10)} · {h.by}{h.note ? `: ${h.note}` : ''}{h.before ? ` (was “${h.before.name}”: ${h.before.premise?.slice(0, 90)}${(h.before.premise?.length || 0) > 90 ? '…' : ''})` : ' (added)'}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2">
        {!retired && <PinkButton className="px-3 py-1.5 text-base" onClick={onBrief}>Write for this</PinkButton>}
        <GhostButton onClick={onEdit}>Edit</GhostButton>
        <GhostButton onClick={toggleRetire}>{retired ? 'Restore' : 'Retire'}</GhostButton>
        {t.history?.length ? <GhostButton onClick={() => setHistory(!history)}>History ({t.history.length})</GhostButton> : null}
      </div>
    </div>
  );
}

function TerritoryEditor({ meta, code, territory, persona, onDone }: { meta: Meta; code?: string; territory?: Territory; persona: string; onDone: (saved: boolean) => void }) {
  const p = meta.personas[persona];
  const [d, setD] = useState({ name: territory?.name || '', premise: territory?.premise || '', angle: territory?.angle || p.triggers[0].id, format: territory?.format || 'STATIC' });
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  async function save() {
    try { await studio.saveTerritory(code || null, { ...d, persona }, note); onDone(true); } catch (e: any) { setError(e.message); }
  }
  return (
    <div className="space-y-3 rounded-xl border-2 bg-[#16181D] p-5" style={{ borderColor: PINK }}>
      <div><Label>Name</Label><input className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></div>
      <div><Label>Premise</Label><textarea rows={3} className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" value={d.premise} onChange={e => setD({ ...d, premise: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Leads on</Label>
          <select className="w-full rounded-lg border-2 border-[#343946] bg-[#101216] px-2 py-2 text-base" value={d.angle} onChange={e => setD({ ...d, angle: e.target.value })}>
            {p.triggers.map(tr => <option key={tr.id} value={tr.id}>{tr.label}</option>)}
          </select>
        </div>
        <div><Label>Format</Label>
          <select className="w-full rounded-lg border-2 border-[#343946] bg-[#101216] px-2 py-2 text-base" value={d.format} onChange={e => setD({ ...d, format: e.target.value })}>
            {(meta.formats || ['STATIC', 'UGC', 'VIDEO', 'CAROUSEL']).map(f => <option key={f}>{f}</option>)}
          </select>
        </div>
      </div>
      <div><Label>Why the change</Label><input className="w-full rounded-lg border-2 border-[#343946] px-3 py-2 text-base bg-[#101216] text-[#ECEDEF] placeholder:text-[#646A75]" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. client feedback 28 Sep; CD preference" /></div>
      {error && <p className="text-base text-red-300">{error}</p>}
      <div className="flex gap-2">
        <PinkButton className="px-4 py-2 text-base" disabled={!d.name.trim()} onClick={save}>{code ? 'Save changes' : 'Add territory'}</PinkButton>
        <GhostButton onClick={() => onDone(false)}>Cancel</GhostButton>
      </div>
    </div>
  );
}
