// The uploaded artwork beside an ad's words in Build & sign off (Brook, 9 Oct): read-only. The latest upload for the
// ad's signed-off codes, one size at a time (a carousel's cards in order), with a one-line status. Files, checks and
// Trupanion's decision stay in Assets: clicking the artwork opens Assets on this ad.
import { useState } from 'react';
import { studio, type PfStub } from '@/lib/studioApi';
import { SIZES } from '@/lib/studioSizes';
import { cn } from '@/lib/utils';
import { AuthMedia, GhostButton, when } from './ui';

const ASPECT: Record<string, string> = { '1:1': 'aspect-square', '4:5': 'aspect-[4/5]', '9:16': 'aspect-[9/16]' };

/** The code whose asset stands for the ad: among the ad's signed-off codes, the one with the newest upload (else the first). */
export function artworkStub(stubs: PfStub[], codes: string[]): PfStub | null {
  const mine = stubs.filter(s => codes.includes(s.stub));
  const withUpload = mine.filter(s => s.upload).sort((a, b) => (b.upload!.uploaded_at || '').localeCompare(a.upload!.uploaded_at || ''));
  return withUpload[0] || mine[0] || null;
}

/** "checked: 3 red, 1 amber" and the like, for the upload on show. */
export function auditWords(s: PfStub): string {
  const a = s.audit;
  if (!a) return 'not checked yet';
  if (a.status === 'running' || a.status === 'queued') return 'being checked';
  if (a.status !== 'done') return 'the check did not finish';
  if (a.stale) return 'checked before the latest change; check it again in Assets';
  const parts = [a.red ? `${a.red} red` : '', a.amber ? `${a.amber} amber` : ''].filter(Boolean);
  return parts.length ? `checked: ${parts.join(', ')}` : 'checked: no red or amber flags';
}

export function Artwork({ stubs, codes, edited, onOpen, className }: {
  /** null while loading. */
  stubs: PfStub[] | null;
  /** The ad's signed-off codes (none: not signed off yet). */
  codes: string[];
  /** The words on screen differ from the signed-off ones the artwork was made from. */
  edited?: boolean;
  onOpen: (stub: string) => void; className?: string;
}) {
  const [size, setSize] = useState('');
  const s = stubs ? artworkStub(stubs, codes) : null;
  const up = s?.upload || null;
  const expected = s?.sizes?.expected || [];
  const bySize = up ? SIZES.map(z => ({ z: z as string, fs: up.files.filter(f => (f.aspect || expected[0] || '1:1') === z) })).filter(g => g.fs.length) : [];
  const shown = bySize.find(g => g.z === size) || bySize[0];
  const files = shown?.fs || up?.files || [];
  return (
    <aside className={cn('rounded-xl border border-[#272B34] bg-[#16181D] p-3', className)} aria-label="Artwork">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <div className="mr-auto text-xs font-semibold uppercase tracking-wider text-[#858B96]">Artwork</div>
        {bySize.length > 1 && bySize.map(g => <GhostButton key={g.z} aria-pressed={shown?.z === g.z} active={shown?.z === g.z} className="px-2 py-0.5 text-xs" onClick={() => setSize(g.z)}>{g.z}</GhostButton>)}
      </div>
      {!stubs ? <div className="h-24 animate-pulse rounded-lg bg-[#1C1F26]" />
        : !s ? <p className="text-sm text-[#858B96]">Artwork is uploaded in Assets once this ad is signed off.</p>
        : !up ? (
          <>
            <p className="text-sm text-[#A3A8B1]">Artwork not uploaded yet.</p>
            <button className="mt-1 text-sm text-[#858B96] underline underline-offset-2 hover:text-[#ECEDEF]" onClick={() => onOpen(s.stub)}>Open this ad in Assets →</button>
          </>
        ) : (
          <>
            <button className="block w-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D94D8F]" title="Open this ad in Assets" aria-label="Open this ad in Assets" onClick={() => onOpen(s.stub)}>
              {up.kind === 'video'
                ? <div className="flex h-24 items-center justify-center rounded-lg bg-[#101216] text-sm text-[#A3A8B1]">Video · {files[0]?.filename}</div>
                : (
                  <div className={cn('grid gap-1.5', up.kind === 'carousel' && files.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
                    {files.map(f => (
                      <div key={f.position}>
                        <AuthMedia path={studio.pfFile(up.id, f.position)} alt={f.filename} className={cn('w-full', ASPECT[shown?.z || '1:1'])} />
                        {up.kind === 'carousel' && <div className="mt-0.5 text-center text-xs text-[#858B96]">card {(f.position % 100) + 1}</div>}
                      </div>
                    ))}
                  </div>
                )}
            </button>
            <p className="mt-2 text-sm text-[#A3A8B1]">Uploaded {when(up.uploaded_at)} · {auditWords(s)}</p>
            {(s.sizes?.missing.length ?? 0) > 0 && <p className="text-xs text-amber-200">{s.sizes!.missing.join(', ')} not uploaded</p>}
            {edited && <p className="mt-1 text-xs text-amber-200">The words here were edited after this artwork’s sign-off.</p>}
            <button className="mt-1 text-sm text-[#858B96] underline underline-offset-2 hover:text-[#ECEDEF]" onClick={() => onOpen(s.stub)}>Files, flags and Trupanion’s decision are in Assets →</button>
          </>
        )}
    </aside>
  );
}
