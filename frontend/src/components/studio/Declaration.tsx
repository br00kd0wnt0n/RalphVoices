// The upload declaration (Trupanion, 6 Oct: no AI-generated imagery or video; stock approved), under the asset in
// Assets. Pre-flight can't tell AI imagery from a file, so the person uploading declares it: the no-AI tick, where
// the imagery or footage came from (with its licence or reference), and whether a customer is shown or quoted (then a
// real member, with consent). Needed before Pre-flight is marked passed, for statics too. The server's rules are in
// backend/src/services/studio/declaration.ts; this form mirrors them.
import { useEffect, useState } from 'react';
import { studio, type UploadDeclaration } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { GhostButton, PinkButton, when, whoWords } from './ui';

const SOURCES: Array<[UploadDeclaration['sources'][number], string]> = [
  ['shot', 'Shot for this campaign'], ['stock', 'Licensed stock'], ['library', 'Trupanion’s creator / UGC library'],
  ['animated', 'Animated from an approved static or carousel'], ['other', 'Other'],
];
type Draft = Pick<UploadDeclaration, 'no_ai' | 'sources' | 'reference' | 'based_on' | 'member'>;
const EMPTY: Draft = { no_ai: false, sources: [], reference: '', based_on: '', member: null };

/** What's missing, in words (mirrors declarationProblems on the server). */
export function declarationMissing(d: Draft): string[] {
  const out: string[] = [];
  if (!d.no_ai) out.push('the no-AI tick');
  if (!d.sources.length) out.push('where it came from');
  if (d.sources.some(s => s === 'stock' || s === 'library' || s === 'other') && !(d.reference || '').trim()) out.push('the licence or reference');
  if (d.sources.includes('animated') && !(d.based_on || '').trim()) out.push('the ad it is animated from');
  if (d.member !== 'member' && d.member !== 'none') out.push('whether a customer is shown');
  return out;
}

export function Declaration({ uploadId, declared, draft, adName, onSaved, onError }: {
  uploadId: string; declared: UploadDeclaration | null; draft: UploadDeclaration | null;
  /** This ad's name, to tell it apart from the ad an animated version is made from. */
  adName: string;
  onSaved: () => void; onError: (m: string) => void;
}) {
  const start = (d: UploadDeclaration | null): Draft => (d ? { no_ai: d.no_ai, sources: d.sources, reference: d.reference || '', based_on: d.based_on || '', member: d.member } : EMPTY);
  const [editing, setEditing] = useState(!declared);
  const [d, setD] = useState<Draft>(start(declared || draft));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setEditing(!declared); setD(start(declared || draft)); }, [uploadId, declared?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = declarationMissing(d);
  const save = async () => {
    setBusy(true);
    try { await studio.pfDeclare(uploadId, d); setEditing(false); onSaved(); } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };
  if (declared && !editing) {
    const src = declared.sources.map(s => SOURCES.find(x => x[0] === s)?.[1] || s).join(', ');
    return (
      <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-[#C9CCD2]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-emerald-200">Declared</span>
          <span className="mr-auto">No AI imagery or video · {src}{declared.reference ? ` (${declared.reference})` : ''}{declared.based_on ? ` · from ${declared.based_on}` : ''} · {declared.member === 'member' ? 'a real member, with consent' : 'no customer shown or quoted'}</span>
          <button className="text-xs text-[#858B96] underline-offset-2 hover:text-[#ECEDEF] hover:underline" onClick={() => setEditing(true)}>Change</button>
        </div>
        <div className="text-xs text-[#858B96]">{whoWords(declared.by, declared.for)}, {when(declared.at)}</div>
      </div>
    );
  }
  const box = 'h-4 w-4 accent-[#D94D8F]';
  return (
    <fieldset className="mt-3 space-y-2 rounded-lg border border-[#343946] px-3 py-3 text-sm text-[#C9CCD2]">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-[#858B96]">Imagery and footage{draft && !declared ? ' (from the last upload of this ad)' : ''}</legend>
      <p className="text-xs text-[#858B96]">Trupanion: no AI-generated imagery or video; stock is approved. Needed before Pre-flight can be marked passed.</p>
      <label className="flex cursor-pointer items-start gap-2"><input type="checkbox" className={box} checked={d.no_ai} onChange={e => setD({ ...d, no_ai: e.target.checked })} /><span>No AI-generated imagery or video in this asset</span></label>
      <div>
        <div className="mb-1 text-xs text-[#858B96]">Where it came from (tick all that apply)</div>
        <div className="grid gap-1 sm:grid-cols-2">
          {SOURCES.map(([k, label]) => (
            <label key={k} className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" className={box} checked={d.sources.includes(k)} onChange={e => setD({ ...d, sources: e.target.checked ? [...d.sources, k] : d.sources.filter(x => x !== k) })} />{label}
            </label>
          ))}
        </div>
      </div>
      {d.sources.some(s => s === 'stock' || s === 'library' || s === 'other' || s === 'shot') && (
        <input className="w-full rounded-lg border-2 border-[#343946] px-2 py-1.5 text-sm" placeholder={d.sources.includes('stock') ? 'Licence or stock ids, e.g. Getty 123456' : d.sources.includes('library') ? 'Library reference, e.g. UGC bank clip id' : 'Reference (optional for a shoot)'}
          aria-label="Licence or reference" value={d.reference || ''} onChange={e => setD({ ...d, reference: e.target.value })} />
      )}
      {d.sources.includes('animated') && (
        <input className="w-full rounded-lg border-2 border-[#343946] px-2 py-1.5 font-mono text-sm" placeholder="The approved ad it is animated from, e.g. DINK_SOCK_EATER_DOG_ST_A_US_META"
          aria-label="The ad it is animated from" value={d.based_on || ''} onChange={e => setD({ ...d, based_on: e.target.value })} />
      )}
      <div className="space-y-1">
        <div className="text-xs text-[#858B96]">Is a customer shown or quoted (a testimonial, "This is Molly…")?</div>
        <label className="flex cursor-pointer items-center gap-2"><input type="radio" name={`member-${uploadId}`} className={box} checked={d.member === 'none'} onChange={() => setD({ ...d, member: 'none' })} />No customer is shown or quoted</label>
        <label className="flex cursor-pointer items-center gap-2"><input type="radio" name={`member-${uploadId}`} className={box} checked={d.member === 'member'} onChange={() => setD({ ...d, member: 'member' })} />Yes: a real Trupanion member, with their consent</label>
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <PinkButton className="px-3 py-1.5 text-sm" disabled={busy || missing.length > 0} onClick={save}>Save the declaration</PinkButton>
        {declared && <GhostButton disabled={busy} onClick={() => { setEditing(false); setD(start(declared)); }}>Cancel</GhostButton>}
        <span className={cn('text-xs', missing.length ? 'text-amber-200' : 'text-[#858B96]')}>{missing.length ? `Still needed: ${missing.join(', ')}.` : `Recorded for this upload of ${adName}.`}</span>
      </div>
    </fieldset>
  );
}
