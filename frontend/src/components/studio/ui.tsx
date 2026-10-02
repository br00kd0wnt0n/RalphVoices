// Shared building blocks for Copy Studio (pages/Studio.tsx and components/studio/*): buttons, chips, plain-words
// sources, persona panel, the lockup, history and overrides. Built for a shared screen: large type, high contrast,
// flags as neutral chips (red = compliance, amber = warning). Nothing here is a score.

import { useEffect, useState } from 'react';
import { getActingFor, onActingFor, onOriginal, setActingFor, studio, whoWords, type Flag, type Meta, type Territory, type Tone, type Line, type EditRecord, type LineVersion, type ComplianceStatus, type Region, REGION_NAMES, CANADA_NOTE } from '@/lib/studioApi';
import { cn } from '@/lib/utils';
import { personaColor, personaEdge, tint } from '@/lib/personaColors';
import { HelpCircle } from 'lucide-react';

export const PINK = '#D94D8F';
export const HEADING_FONT = { fontFamily: '"Space Grotesk", system-ui, sans-serif' };
// Deep links (and the old tab keys, redirected in pages/Studio.tsx).
export const params = new URLSearchParams(window.location.search);

// ---------- small building blocks ----------

export function PinkButton({ className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className={cn('rounded-lg px-5 py-2.5 text-base font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-40', className)} style={{ background: PINK }} />;
}
export function GhostButton({ className, active, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button {...p} className={cn('rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-40', active ? 'border-[#ECEDEF] bg-[#ECEDEF] text-[#0E0F12]' : 'border-[#343946] bg-transparent text-[#C9CCD2] hover:border-[#6B7280] hover:text-[#ECEDEF]', className)} />;
}
export function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[#858B96]">{children}</div>;
}
export function Chip({ children, tone = 'grey', className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'grey' | 'amber' | 'red' | 'outline' }) {
  const t = { grey: 'bg-[#1C1F26] text-[#A3A8B1] border-[#343946]', amber: 'bg-amber-400/10 text-amber-200 border-amber-400/40', red: 'bg-red-500/10 text-red-200 border-red-500/45', outline: 'bg-transparent text-[#A3A8B1] border-[#343946]' }[tone];
  return <span {...p} className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[13px] font-medium', t, className)}>{children}</span>;
}
// Plain names for the chips; the full rule, quote and source open on click.
export const CHIP: Record<string, string> = {
  LIMIT_VISIBLE: 'cut off on screen', LIMIT_MAX: 'too long for the field', LIMIT_ON_ASSET: 'long for the image', SHARED_CTA: 'no call to action', NEAR_DUP: 'similar line', CL_GLANCE: 'not a glance read', CL_PRODUCT: 'product unclear',
  COMP_UGC_MEMBER: 'cast a member', COMP_VERBATIM: 'verbatim quote', FIG_UNSOURCED: 'unsourced figure', FIG_CITATION: 'needs citation', FIG_ATTRIBUTION: 'misattributed figure',
  COMP_DIRECT_PAY: 'direct pay caveat', COMP_PAYS_FOR_ITSELF: 'pays for itself', COMP_PAID_SHARE: 'whole bill', COMP_PREEXISTING: 'pre-existing', COMP_ROUTINE: 'routine care',
  COMP_CLAIM_SPEED: 'claim speed', COMP_CHEAP_LOCKED: 'cheap / locked price', COMP_PRICE_LEAD: 'price lead', COMP_COVERAGE_CAVEAT: 'coverage caveat', COMP_SUPERLATIVE: 'superlative',
  COMP_FACT_FRAMING: 'figure framing', BR_NAMING: '"pet insurance"', BR_CASE: 'all caps', BR_BOAST: 'boastful', BR_PLAIN: 'not plain', BR_SAD_PET: 'sad pet', CHECK_FAILED: 'check failed',
};
export const chipName = (rule: string) => CHIP[rule] || (rule.startsWith('BRIEF_BANNED:') ? `banned: ${rule.slice(13)}` : /^[A-Z]+_T_/.test(rule) ? `turn-off: ${rule.replace(/^[A-Z]+_T_/, '').replace(/_/g, ' ').toLowerCase()}` : rule.replace(/_/g, ' ').toLowerCase());
/** A flag's chip name, saying when it was found on the wording before an edit (until the re-check replaces it). */
export const flagName = (f: Pick<Flag, 'rule' | 'original' | 'why'>) => `${chipName(f.rule)}${onOriginal(f) ? ' (original wording)' : ''}`;
export const sevTone = (s: Flag['severity']) => (s === 'compliance' ? 'red' : s === 'warn' ? 'amber' : 'grey') as 'red' | 'amber' | 'grey';

// ---------- plain words for codes ----------

/** Source codes in the rules file, as people say them. */
export const SOURCE_NAMES: Record<string, string> = {
  TM: 'Trigger maps', EP: 'Evidence pack', QB: 'Quote bank', CLB: 'Creative brief', CC: 'Concept cards', RB: 'Rubric',
  BG: 'Brand guidelines', META: 'Meta ads guide', META3P: 'Meta length guides', TT: 'TikTok ads help', TT3P: 'TikTok length guides',
  HOUSE: 'House rule', LEGAL: 'Legal', GUIDE: 'Guide',
};
export const MAP_PERSONA: Record<string, string> = { '1': 'DINKs', '2': 'Curators', '3': 'Busy Families' };
/** Territory code → name, for "Concept card: Ask Your Vet". Filled when the rules load. */
let TERRITORY_NAMES: Record<string, string> = {};
export function setTerritoryNames(m: Record<string, string>) { TERRITORY_NAMES = m; }
/**
 * A rules-file source in plain words; the codes stay in the raw source (a tooltip or "details").
 * "CC CUR_VET slide 2" → "Concept card: Ask Your Vet, slide 2"; "Brook decision 25 Sep (NR_EXCLUSIONS)" →
 * "Ralph decision, 25 Sep"; "RB mocks_viewer" → "Rubric"; "TM Trigger map 1 watch-outs" → "Trigger maps: DINKs, watch-outs".
 */
export function plainSource(src?: string): string {
  if (!src) return '';
  const card = (code: string) => TERRITORY_NAMES[code] ? `Concept card: ${TERRITORY_NAMES[code].replace(/\.$/, '')}` : 'Concept card';
  const parts = src.split(/;\s*/).map(raw => {
    let part = raw.trim()
      .replace(/\s*\((?:NR_[A-Z_]+|facts? [A-Z]\d[^)]*)\)/g, '')                   // checklist and fact codes
      .replace(/\bBrook decision (\d+ \w+)/g, 'Ralph decision, $1')
      .replace(/\bpersonas\.json\b.*$/, 'Persona profiles');
    const m = /^([A-Z][A-Z0-9]+)\b\s*:?\s*(.*)$/.exec(part);
    if (!m || !SOURCE_NAMES[m[1]]) return part;
    const [, code] = m;
    let rest = m[2];
    if (code === 'RB') return /^draft/.test(rest) ? `Rubric, ${rest}` : 'Rubric';
    if (code === 'CC') {
      const c = /^(?:card\s+)?([A-Z]+_[A-Z]+)\b\s*(.*)$/.exec(rest);
      if (c) return `${card(c[1])}${c[2] ? `, ${c[2].replace(/^\((.*)\)$/, '$1')}` : ''}`;
    }
    if (code === 'TM') {
      const t = /^Trigger map (\d)\s*(?:\([^)]*\))?:?\s*(.*)$/.exec(rest);
      if (t) rest = `${MAP_PERSONA[t[1]] || `map ${t[1]}`}${t[2] ? `, ${t[2].replace(/^#(\d)/, 'trigger $1')}` : ''}`;
    }
    return rest ? (/^[§p]/.test(rest) ? `${SOURCE_NAMES[code]} ${rest}` : `${SOURCE_NAMES[code]}: ${rest}`) : SOURCE_NAMES[code];
  });
  // Any territory code left (e.g. in a parenthesis) reads as its name.
  return [...new Set(parts.filter(Boolean))].join(' · ').replace(/\b[A-Z]+_[A-Z]+\b/g, c => TERRITORY_NAMES[c]?.replace(/\.$/, '') ?? c);
}
/** A source in plain words, with the rules file's own wording (codes and all) on hover. */
export function Src({ s, className }: { s?: string; className?: string }) {
  if (!s) return null;
  return <span className={className} title={`Source in the rules file: ${s}`}>{plainSource(s)}</span>;
}
/** Tone levels (1-5) in words, from the rules file's tone controls: "even · light touch · short". */
export function toneWords(tone: Tone | undefined, meta: Meta): string {
  if (!tone) return '';
  const pick = (k: keyof Tone) => {
    const c = meta.tone_controls?.[k] || {};
    const keys = Object.keys(c).map(Number).sort((a, b) => Math.abs(a - tone[k]) - Math.abs(b - tone[k]));
    const w = keys.length ? String(c[String(keys[0])]).split(',')[0].trim() : '';
    return k === 'short_long' ? (tone[k] <= 2 ? 'short' : tone[k] >= 4 ? 'long' : 'medium') : w;
  };
  return (['dry_warm', 'playful_plain', 'short_long'] as const).map(pick).filter(Boolean).join(' · ');
}
/** Territory names as shown: the research springboard isn't "on the board". */
export function territoryName(t?: Territory): string {
  if (!t) return '';
  const name = t.name.replace(/\s*\(springboard[^)]*\)\s*/i, '').trim();
  return t.status === 'springboard' ? `${name} (idea from the research; not in the pitch)` : name;
}
export const personaName = (meta: Meta, code: string) => meta.personas[code]?.name || code;
/** One persona order everywhere (the database doesn't keep the rules file's key order). */
export const PERSONA_ORDER = ['DINK', 'CUR', 'FAM'];
/** The personas, in deck order. The shared captions pool's built-in persona isn't one of them (it has its own entry in the pickers). */
export function personaKeys(personas: Record<string, unknown>): string[] {
  const rank = (k: string) => (PERSONA_ORDER.indexOf(k) + 1) || PERSONA_ORDER.length + 1;
  return Object.keys(personas).filter(k => !(personas[k] as { shared?: boolean } | undefined)?.shared).sort((a, b) => rank(a) - rank(b));
}
/** A territory the pickers and the board show: active, or retired with runs or sign-offs in the round in view. */
export const isOpenTerritory = (meta: Pick<Meta, 'retired_with_work'>, code: string, t: { status?: string }) => t.status !== 'retired' || !!meta.retired_with_work?.includes(code);
/** The context is the shared captions pool (post copy reused across personas). */
export const isSharedCtx = (meta: Meta | null, c: { persona: string }) => !!meta?.personas[c.persona]?.shared;
/**
 * The length guide for a line: the field's own, or its `card` guide (rules v2.15+) when the line is a carousel card
 * (a card number, or a carousel territory). Mirrors `fieldLimits` in the engine.
 */
export function limitsOf(meta: Pick<Meta, 'fields' | 'territories'>, field: string, ctx: { card?: number; territory?: string } = {}): { visible: number; max: number; card: boolean } | undefined {
  const f = meta.fields[field];
  if (!f) return undefined;
  const isCard = !!ctx.card || /^CAR/i.test(meta.territories[ctx.territory || '']?.format || '');
  return isCard && f.card ? { visible: f.card.visible, max: f.card.max, card: true } : { visible: f.visible, max: f.max, card: false };
}
/** The field's spec with the length guide that applies to this line (the card guide for a carousel card). */
export function specFor(meta: Pick<Meta, 'fields' | 'territories'>, field: string, ctx: { card?: number; territory?: string } = {}) {
  const f = meta.fields[field], lim = limitsOf(meta, field, ctx);
  return f && lim ? { ...f, visible: lim.visible, max: lim.max } : f;
}
export const angleLabel = (meta: Meta, persona: string, id: string) => meta.personas[persona]?.triggers.find(x => x.id === id)?.label || id;
export const NAMING_TIP = 'Naming code: Add3 reports results by this';
export const regionOf = (x?: { region?: Region } | null): Region => x?.region || 'US';
/** " · Canada" after a heading for Canadian work; nothing for the US (the default). */
export const inRegion = (r?: Region) => (r === 'CA' ? ` · ${REGION_NAMES.CA}` : '');
/** The note on Write & brief and in "Who this is" when Canada is chosen. */
export function CanadaNote({ className }: { className?: string }) {
  return <p className={cn('rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100', className)}>{CANADA_NOTE}</p>;
}
/** One line on what to do about a flag, where there's a clear fix. */
/** Rule id → the fix in plain words, from the live rules file (v2.7+). Filled when the rules load; it wins over the list below. */
let WHAT_TO_DO: Record<string, string> = {};
export function setWhatToDo(m: Record<string, string>) { WHAT_TO_DO = m; }
export function whatToDo(rule: string, f?: { visible?: number; max?: number }): string {
  if (WHAT_TO_DO[rule]) return WHAT_TO_DO[rule];
  if (rule === 'LIMIT_VISIBLE') return f?.visible ? `Keep the point in the first ${f.visible} characters; the rest is cut off on screen.` : 'Keep the point early; the end is cut off on screen.';
  if (rule === 'LIMIT_ON_ASSET') return f?.visible ? `Text in the artwork reads best at ${f.visible} characters or fewer. Nothing is cut off; it's about how much there is to read.` : 'Keep the text in the artwork short.';
  if (rule === 'LIMIT_MAX') return f?.max ? `Cut it to ${f.max} characters or fewer.` : 'Cut it to fit the field.';
  const map: Record<string, string> = {
    COMP_PAYS_FOR_ITSELF: 'Say what it does instead of what it saves.',
    COMP_DIRECT_PAY: 'Add “at participating hospitals”.',
    COMP_PAID_SHARE: 'Say what’s covered, not “the whole bill”.',
    COMP_PREEXISTING: 'Don’t imply pre-existing conditions are covered.',
    COMP_ROUTINE: 'Don’t imply check-ups or vaccines are covered.',
    COMP_CLAIM_SPEED: 'Drop the speed promise, or say “can be”, not “every”.',
    COMP_SUPERLATIVE: 'Remove the superlative, or point to the proof.',
    COMP_PRICE_LEAD: 'Lead with the benefit; move the price later.',
    COMP_CHEAP_LOCKED: 'Don’t call Trupanion cheap or promise the price won’t change.',
    BR_NAMING: 'Say “medical insurance for pets”.',
    BR_CASE: 'Use sentence case; capitals are a design choice on the image.',
    COPY_CAVEAT: 'Put the caveat on the asset, as signed off.',
    COPY_MATCH: 'Use the signed-off wording on the asset.',
  };
  return map[rule] || '';
}

/** Who a persona is, from the active rules file (never the readout). Collapsed by default. */
export function PersonaPanel({ meta, persona, region, open: startOpen = false, className }: { meta: Meta; persona: string; region?: Region; open?: boolean; className?: string }) {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => { setOpen(startOpen); }, [persona, startOpen]);
  const p = meta.personas[persona];
  if (!p) return null;
  const c = p.context;
  return (
    <section className={cn('rounded-xl border border-l-4 border-[#272B34] bg-[#16181D]', className)} style={personaEdge(persona)}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="flex flex-wrap items-center gap-x-2"><span className="text-sm font-semibold uppercase tracking-wider text-[#858B96]">Who this is</span> <span className="flex items-center gap-1.5 text-base font-semibold" style={{ color: personaColor(persona).light }}><PersonaDot persona={persona} />{p.name}</span></span>
        <span className="text-[#646A75]">{open ? '−' : '+'}</span>
      </button>
      {region === 'CA' && <CanadaNote className="mx-4 mb-3" />}
      {open && (
        <div className="space-y-3 border-t border-[#272B34] px-4 py-3 text-sm">
          {(c?.who || !!c?.platforms?.length) && <p className="text-base text-[#C9CCD2]">{c?.who || p.name}{c?.platforms?.length ? <span className="text-[#858B96]"> · on {c.platforms.join(', ')}</span> : null}</p>}
          {c?.tension && <p className="text-[#C9CCD2]"><span className="font-semibold">The tension:</span> {c.tension}</p>}
          {(c?.who || c?.tension) && c?.who_source && <p className="-mt-2 text-xs text-[#646A75]"><Src s={c.who_source} /></p>}
          <div>
            <Label>What moves them</Label>
            <ul className="space-y-1.5">{p.triggers.map(t => <li key={t.id}><span className="font-semibold text-[#ECEDEF]">{t.label}</span>{t.detail ? <span className="text-[#C9CCD2]">: {t.detail}</span> : null}{t.source && <div className="text-xs text-[#646A75]"><Src s={t.source} /></div>}</li>)}</ul>
          </div>
          {!!c?.turn_offs?.length && (
            <div>
              <Label>Turn-offs</Label>
              <ul className="space-y-1.5">{c.turn_offs.map(t => <li key={t.id}><span className="text-[#C9CCD2]">{t.rule}</span><div className="text-xs text-[#646A75]"><Src s={t.source} /></div></li>)}</ul>
            </div>
          )}
          {!!c?.language?.length && (
            <div>
              <Label>Language to use</Label>
              <ul className="space-y-1">{c.language.map((l, i) => <li key={i}><span className={cn(l.caution ? 'text-amber-200' : 'text-[#C9CCD2]')}>“{l.text}”</span>{l.caution && <span className="ml-1 text-xs text-amber-300">use carefully</span>}<span className="ml-1 text-xs text-[#646A75]"><Src s={l.source} /></span></li>)}</ul>
            </div>
          )}
          <CastingNotes meta={meta} />
          <p className="text-xs text-[#646A75]">From the live rules file.</p>
        </div>
      )}
    </section>
  );
}

/** Who to cast (rules v2.12, Trupanion's breed data). The same for every persona: the data isn't split by persona. */
export function CastingNotes({ meta, heading = true }: { meta: Meta; heading?: boolean }) {
  const notes = meta.casting?.notes || [];
  if (!notes.length) return null;
  return (
    <div>
      {heading && <Label>Who to cast</Label>}
      <ul className="space-y-1.5">
        {notes.map((n, i) => (
          <li key={i}>
            <span className={cn(n.caution ? 'text-amber-200' : 'text-[#C9CCD2]')}>{n.text}</span>{n.caution && <span className="ml-1 text-xs text-amber-300">use carefully</span>}
            <div className="text-xs text-[#646A75]"><Src s={n.source} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- brand lockup: Ralph × client ----------

export function Lockup({ onHome, small }: { onHome?: () => void; small?: boolean }) {
  const [clientLogo, setClientLogo] = useState<string | null>(null);
  useEffect(() => {
    let url = '';
    studio.imageUrl('/brand/client-logo').then(u => { url = u; setClientLogo(u); }).catch(() => setClientLogo(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, []);
  return (
    <button onClick={onHome} className="flex shrink-0 items-center gap-3" aria-label="VOICES Studio: how it works">
      <img src="/ralph-world.png" alt="Ralph" className={cn('object-contain drop-shadow-[0_0_10px_rgba(217,77,143,0.35)]', small ? 'h-7 w-7' : 'h-7 w-7 min-[1440px]:h-8 min-[1440px]:w-8')} />
      <span className={cn('font-light leading-none text-[#ECEDEF]', small ? 'text-lg' : 'text-lg min-[1440px]:text-xl')} style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>
        Voices <span className="font-medium" style={{ color: PINK }}>Studio</span>
      </span>
      <span className={cn('text-[#646A75]', small ? 'text-sm' : 'text-base')} aria-hidden>×</span>
      {clientLogo
        ? <img src={clientLogo} alt="Trupanion" onError={() => setClientLogo(null)} className={cn('w-auto object-contain opacity-95', small ? 'h-4' : 'h-5')} />
        // No logo asset (production, Brook 28 Sep): the client's name as a wordmark.
        : <span className={cn('font-semibold tracking-tight text-[#ECEDEF]', small ? 'text-base' : 'text-base min-[1440px]:text-lg')} style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>Trupanion</span>}
    </button>
  );
}


/** Fields in a steady order: Meta first, then TikTok, each in the rules' order. */
export const fieldOrder = (meta: Meta, f: string) => (String(meta.fields[f]?.platform || '').toUpperCase().startsWith('META') ? 0 : 1000) + Math.max(0, Object.keys(meta.fields).indexOf(f));

export const COMPLIANCE_WORDS: Record<ComplianceStatus, string> = { pending: 'Pending', cleared: 'Cleared', changes_requested: 'Changes requested' };
export const COMPLIANCE_TONE: Record<ComplianceStatus, string> = {
  pending: 'border-[#343946] text-[#A3A8B1]', cleared: 'border-emerald-500 bg-emerald-500/15 text-emerald-200', changes_requested: 'border-amber-400 bg-amber-400/15 text-amber-100',
};

/** Initials for the signed-in badge: nick.larson@ralph.world → NL. */
export function initials(email: string) {
  const name = (email || '').split('@')[0].split(/[._-]+/).filter(Boolean);
  return name.length ? (name.length === 1 ? name[0].slice(0, 2) : name[0][0] + name[1][0]) : '…';
}

// ---------- attribution and history ----------

export const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
export const describe = (x: any): string => {
  if (!x || typeof x !== 'object') return '';
  if ('decision' in x) return [x.decision || 'undecided', x.edited_text ? `“${x.edited_text}”` : '', x.note ? `note: ${x.note}` : ''].filter(Boolean).join(' · ');
  if ('overrides' in x) return `overrides: ${(x.overrides || []).map((o: any) => chipName(o.rule)).join(', ') || 'none'}`;
  if ('compliance' in x) return `compliance: ${COMPLIANCE_WORDS[x.compliance?.status as ComplianceStatus] || 'pending'}${x.compliance?.note ? ` (${x.compliance.note})` : ''}`;
  if ('ready' in x) return x.ready ? `ready for production, v${x.ready.version}` : 'not signed off';
  if ('flags' in x) return x.rechecked ? `re-checked: ${(x.flags || []).length} flags` : `${(x.flags || []).length} flags`;
  return '';
};

export function LineHistory({ line }: { line: Line }) {
  const [edits, setEdits] = useState<EditRecord[] | null>(null);
  const [versions, setVersions] = useState<LineVersion[]>([]);
  useEffect(() => {
    studio.history(line.id).then(setEdits).catch(() => setEdits([]));
    studio.versions(line.id).then(setVersions).catch(() => {});
  }, [line.id, line.decided_at]);
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-[#272B34] bg-[#0E0F12] p-3 text-sm text-[#A3A8B1]">
      {versions.length > 0 && (
        <div>
          <Label>Versions</Label>
          <ul className="space-y-1">
            {versions.map(v => (
              <li key={v.version}><span className="font-semibold text-[#ECEDEF]">v{v.version}</span> · {when(v.created_at)} · {v.created_by}{v.signoff_id ? ' · signed off' : ''} · <span className="font-mono text-xs">{v.sha256.slice(0, 10)}</span><div className="text-[#C9CCD2]">{v.text}</div></li>
            ))}
          </ul>
        </div>
      )}
      <Label>History</Label>
      {edits === null ? <div>Loading…</div> : !edits.length ? <div>No decisions yet.</div> : (
        <ul className="space-y-1">{edits.map((e, i) => <li key={i}>{when(e.at)} · <span className="text-[#ECEDEF]">{e.by}</span> · {describe(e.after)}</li>)}</ul>
      )}
    </div>
  );
}

export function Overrides({ line }: { line: Line }) {
  if (!line.overrides?.length) return null;
  return (
    <ul className="mt-3 space-y-1">
      {line.overrides.map(o => (
        <li key={o.rule} className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-sm text-red-100">
          <span className="font-semibold">Override: {chipName(o.rule)}</span> · {whoWords(o.by, o.for)}, {when(o.at)}<div className="text-[#C9CCD2]">“{o.reason}”</div>
        </li>
      ))}
    </ul>
  );
}

export const SEV_ORDER = { red: 0, amber: 1, grey: 2 } as const;
export const COPY_STATUS: Record<string, { tone: 'grey' | 'amber' | 'red' | 'outline'; words: string }> = {
  match: { tone: 'outline', words: 'matches' }, reworded: { tone: 'amber', words: 'reworded' },
  'not on asset': { tone: 'red', words: 'not on the asset' }, 'not expected on asset': { tone: 'grey', words: 'not expected on the asset' },
  'wrong card': { tone: 'amber', words: 'on another card' },
};

/** An image or video the signed-in API serves (fetched with the token, shown from a blob URL). */
export function AuthMedia({ path, video, className, alt }: { path: string; video?: boolean; className?: string; alt?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let u = '';
    setUrl(null); setFailed(false);
    studio.imageUrl(path).then(x => { u = x; setUrl(x); }).catch(() => setFailed(true));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [path]);
  if (failed) return <div className={cn('flex items-center justify-center rounded-lg bg-[#101216] text-xs text-[#646A75]', className)}>not available</div>;
  if (!url) return <div className={cn('animate-pulse rounded-lg bg-[#1C1F26]', className)} />;
  return video ? <video src={url} controls preload="metadata" className={cn('rounded-lg bg-black', className)} /> : <img src={url} alt={alt || ''} className={cn('rounded-lg object-contain bg-[#101216]', className)} />;
}

// ---------- page introductions: one line, the rest behind "?" ----------

export function Intro({ title, line, children, right }: { title: string; line: React.ReactNode; children?: React.ReactNode; right?: React.ReactNode }) {
  const [more, setMore] = useState(false);
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="mr-auto min-w-0 max-w-4xl">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight" style={HEADING_FONT}>{title}</h1>
          {children && (
            <button onClick={() => setMore(!more)} aria-expanded={more} aria-label={more ? 'Hide the details' : 'How this step works'} title="How this step works"
              className={cn('rounded-full p-1 transition', more ? 'text-[#ECEDEF]' : 'text-[#646A75] hover:text-[#ECEDEF]')}>
              <HelpCircle className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>
        <p className="text-base text-[#A3A8B1]">{line}</p>
        {more && <div className="mt-2 max-w-3xl space-y-1.5 rounded-lg border border-[#272B34] bg-[#101216] px-4 py-3 text-sm leading-relaxed text-[#C9CCD2]">{children}</div>}
      </div>
      {right}
    </div>
  );
}

// ---------- one status vocabulary, one chip per code ----------
// Draft → Signed off → Pre-flight passed → Cleared → Ready to traffic, plus Changes requested and Edited since.
// Computed from the whole version: all its fields plus the visual's on-image line.

export type CodeState = 'draft' | 'signed' | 'passed' | 'cleared' | 'ready' | 'changes' | 'edited';
export const CODE_STATE: Record<CodeState, { words: string; cls: string; tip: string }> = {
  draft: { words: 'Draft', cls: 'border-[#343946] text-[#A3A8B1]', tip: 'Not signed off yet' },
  signed: { words: 'Signed off', cls: 'border-[#D94D8F]/70 text-[#F2C4DA]', tip: 'Creative sign-off; the asset comes next' },
  passed: { words: 'Pre-flight passed', cls: 'border-sky-400/60 text-sky-200', tip: 'The asset passed Pre-flight; Trupanion’s decision comes next' },
  cleared: { words: 'Cleared', cls: 'border-emerald-500/60 text-emerald-200', tip: 'Trupanion cleared it; Pre-flight still to pass' },
  ready: { words: 'Ready to traffic', cls: 'border-emerald-500 bg-emerald-500/15 text-emerald-100', tip: 'Pre-flight passed and Trupanion cleared it' },
  changes: { words: 'Changes requested', cls: 'border-amber-400 bg-amber-400/15 text-amber-100', tip: 'Trupanion asked for changes' },
  edited: { words: 'Edited since', cls: 'border-amber-400/60 text-amber-200', tip: 'Wording changed since sign-off: sign it off again' },
};
export function codeState(x: { signed: boolean; edited?: boolean; passed?: boolean; compliance?: ComplianceStatus; ready?: boolean }): CodeState {
  if (x.compliance === 'changes_requested') return 'changes';
  if (x.signed && x.edited) return 'edited';
  if (x.ready) return 'ready';
  if (x.compliance === 'cleared') return 'cleared';
  if (x.passed) return 'passed';
  return x.signed ? 'signed' : 'draft';
}
export function CodeChip({ state, title, className }: { state: CodeState; title?: string; className?: string }) {
  const s = CODE_STATE[state];
  return <span title={title || s.tip} className={cn('inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold', s.cls, className)}>{s.words}</span>;
}

// ---------- persona colour (lib/personaColors.ts): an accent, never a background ----------

export function PersonaDot({ persona, className }: { persona?: string | null; className?: string }) {
  return <span aria-hidden className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', className)} style={{ background: personaColor(persona).edge }} />;
}
/** A dot and the persona's name in its light tint, on a faint fill of its colour. */
export function PersonaChip({ meta, persona, short, className }: { meta: Meta; persona: string; short?: boolean; className?: string }) {
  const c = personaColor(persona);
  const name = meta.personas[persona]?.name || persona;
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold', className)} style={{ borderColor: tint(c.base, 0.55), background: tint(c.base, 0.12), color: c.light }} title={name}>
      <PersonaDot persona={persona} className="h-2 w-2" /><span className="truncate">{short ? name.replace(/\s*\(.*\)$/, '') : name}</span>
    </span>
  );
}

// ---------- the context: persona × territory × region, chosen once ----------

export interface Ctx { persona: string; territory: string; region: Region }
/** What Assets, Export and Live show: every set in the round by default ('all'); narrowing it never changes the writing context. */
export interface ViewFilter { persona: string | 'all'; territory: string | 'all'; region: Region | 'all' }
export const ALL_VIEW: ViewFilter = { persona: 'all', territory: 'all', region: 'all' };
export const inViewFilter = (x: { persona: string; territory: string; region?: Region }, v: ViewFilter) =>
  (v.persona === 'all' || x.persona === v.persona) && (v.territory === 'all' || x.territory === v.territory) && (v.region === 'all' || regionOf(x) === v.region);
export const ctxKey = (x: Ctx) => `${x.persona}|${x.territory}|${x.region}`;
export const sameCtx = (a: { persona: string; territory: string; region?: Region }, b: Ctx) => a.persona === b.persona && a.territory === b.territory && regionOf(a) === b.region;

// ---------- "on behalf of": whose call a decision records ----------

/** The person the next calls are recorded for ('' = yourself), kept in step across every picker on the page. */
export function useActingFor(): string {
  const [who, setWho] = useState(getActingFor());
  useEffect(() => onActingFor(() => setWho(getActingFor())), []);
  return who;
}

/**
 * The "for" picker (Brook, 1 Oct): beside sign-off, an override's reason, the expectation, Pre-flight passed and the
 * Trupanion decision. Brook may enter Nick's call for him; it's stored as Nick's, entered by Brook. Chosen from the
 * Studio users (hosted) or typed (local); remembered for the session; a chip says so while it's set. Permissions are
 * always the signed-in person's.
 */
export function ForPicker({ meta, doing, className }: { meta: Meta | null; doing: string; className?: string }) {
  const who = useActingFor();
  const me = (meta?.user?.email || '').toLowerCase();
  const people = (meta?.people || []).filter(p => p.toLowerCase() !== me);
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5 text-xs text-[#858B96]', className)}>
      {who && <span className="rounded-full border border-amber-400/60 bg-amber-400/10 px-2 py-0.5 font-medium text-amber-100" role="status">{doing} for {who}</span>}
      <label className="inline-flex items-center gap-1">
        <span>{who ? 'change' : 'for'}</span>
        {meta?.people
          ? <select aria-label="On behalf of" title="Whose call this is, when you're entering it for them (it's recorded as theirs, entered by you)" className="rounded border border-[#343946] bg-[#101216] px-1 py-0.5 text-xs text-[#C9CCD2]" value={who} onChange={e => setActingFor(e.target.value)}>
              <option value="">yourself</option>
              {who && !people.includes(who) && <option value={who}>{who}</option>}
              {people.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          : <input aria-label="On behalf of" title="Whose call this is, when you're entering it for them" className="w-32 rounded border border-[#343946] px-1.5 py-0.5 text-xs" placeholder="yourself" defaultValue={who} key={who} onBlur={e => setActingFor(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />}
      </label>
    </span>
  );
}
export { whoWords };
