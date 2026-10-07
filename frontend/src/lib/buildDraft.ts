// Build & sign off (redesign, Nick's screen before Tue 6 Oct): the pure rules for
// building ads from kept lines. The draft is what the server takes as is
// (versions: visual + field → line id; on_image: per visual, a line id or a
// carousel's cards). No app imports, so backend/tests/studioBuildDraft.test.ts
// can check it (as studioFields.ts is checked).

export interface DraftVersionLike { visual: string; fields: Record<string, string>; platform?: string }
/** on_image_sub: the subhead under each on-image headline (rules v2.14), same shape: a line per visual, or per card. */
export interface DraftLike { versions: DraftVersionLike[]; on_image: Record<string, string | string[]>; on_image_sub?: Record<string, string | string[]> }

const withoutEmpty = (f: Record<string, string>) => Object.fromEntries(Object.entries(f).filter(([, v]) => v));

/** Put a line in one slot of one ad (or clear it with ''). */
export function placeLine<D extends DraftLike>(d: D, index: number, field: string, lineId: string): D {
  return { ...d, versions: d.versions.map((v, i) => (i === index ? { ...v, fields: withoutEmpty({ ...v.fields, [field]: lineId }) } : v)) };
}

/** Put a line in the same slot of every ad on a visual (e.g. one headline for all of them). */
export function useInAllAds<D extends DraftLike>(d: D, visual: string, platform: string, field: string, lineId: string): D {
  return { ...d, versions: d.versions.map(v => (v.visual === visual && (v.platform || platform) === platform ? { ...v, fields: withoutEmpty({ ...v.fields, [field]: lineId }) } : v)) };
}

/** The visual's on-image text: a line, a carousel's cards, or nothing (null). */
export function setOnImage<D extends DraftLike>(d: D, visual: string, value: string | string[] | null): D {
  const on_image = { ...d.on_image };
  if (value && (!Array.isArray(value) || value.some(Boolean))) on_image[visual] = value; else delete on_image[visual];
  return { ...d, on_image };
}
/** The visual's on-image subhead: a line, a carousel's per-card subheads, or nothing (null). */
export function setOnImageSub<D extends DraftLike>(d: D, visual: string, value: string | string[] | null): D {
  const on_image_sub = { ...(d.on_image_sub || {}) };
  if (value && (!Array.isArray(value) || value.some(Boolean))) on_image_sub[visual] = value; else delete on_image_sub[visual];
  return { ...d, on_image_sub };
}
/** One card's subhead (1-based); '' clears it. Optional card by card, so the list only grows as far as needed. */
export function setCardSub<D extends DraftLike>(d: D, visual: string, card: number, lineId: string): D {
  const cur = d.on_image_sub?.[visual];
  const list = Array.isArray(cur) ? [...cur] : [];
  while (list.length < card) list.push('');
  list[card - 1] = lineId;
  while (list.length && !list[list.length - 1]) list.pop();
  return setOnImageSub(d, visual, list);
}

/** One card of a carousel visual (1-based), growing the card list if needed. */
export function setCard<D extends DraftLike>(d: D, visual: string, card: number, lineId: string, cards = 4): D {
  const cur = d.on_image[visual];
  const list = Array.isArray(cur) ? [...cur] : cur ? [cur] : [];
  while (list.length < Math.max(cards, card)) list.push('');
  list[card - 1] = lineId;
  return setOnImage(d, visual, list);
}

/** Move an ad to another visual (a letter, or the next free letter for "new visual"). */
export function moveAd<D extends DraftLike>(d: D, index: number, visual: string): D {
  return { ...d, versions: d.versions.map((v, i) => (i === index ? { ...v, visual } : v)) };
}
export function removeAd<D extends DraftLike>(d: D, index: number): D {
  const gone = d.versions[index];
  const versions = d.versions.filter((_, i) => i !== index);
  // A visual with no ads left keeps no on-image text (nor subhead).
  const on_image = { ...d.on_image };
  const on_image_sub = { ...(d.on_image_sub || {}) };
  if (gone && !versions.some(v => v.visual === gone.visual)) { delete on_image[gone.visual]; delete on_image_sub[gone.visual]; }
  return { ...d, versions, on_image, ...(d.on_image_sub ? { on_image_sub } : {}) };
}
/** Remove a visual: its ads (on that platform) and, when no ad is left on the letter, its on-image text, subhead and cards. The letter is then free again. */
export function removeVisual<D extends DraftLike>(d: D, visual: string, platform: string, platformOf: (v: DraftVersionLike) => string): D {
  const versions = d.versions.filter(v => !(v.visual === visual && platformOf(v) === platform));
  const on_image = { ...d.on_image };
  const on_image_sub = { ...(d.on_image_sub || {}) };
  if (!versions.some(v => v.visual === visual)) { delete on_image[visual]; delete on_image_sub[visual]; }
  return { ...d, versions, on_image, ...(d.on_image_sub ? { on_image_sub } : {}) };
}
/**
 * The open slot after the draft changed: an ad's slot follows its ad when an earlier one was removed (indexes shift
 * down), and closes when its own ad, or its visual, is gone. Nothing may point at an ad that isn't there.
 */
export type SlotLike = { kind: 'ad'; index: number; field: string } | { kind: 'image'; visual: string; field: string; card?: number };
export function slotAfter<S extends SlotLike>(slot: S | null, before: DraftLike, after: DraftLike): S | null {
  if (!slot) return null;
  if (slot.kind === 'image') return after.versions.some(v => v.visual === slot.visual) ? slot : null;
  const ad = before.versions[slot.index];
  const index = ad ? after.versions.indexOf(ad) : -1;   // the same ad object survives a removal elsewhere
  if (index >= 0) return { ...slot, index };
  // Changed in place (moved to another visual, a line placed): the same position is the same ad when no ad was removed.
  return after.versions.length === before.versions.length && after.versions[slot.index] ? slot : null;
}
/** A new ad on a visual, starting from the visual's last ad (so a shared headline carries over), else the first kept lines. */
export function addAd<D extends DraftLike>(d: D, visual: string, platform: string, required: string[], firstLine: (field: string) => string | undefined): D {
  const prev = [...d.versions].reverse().find(v => v.visual === visual && (v.platform || platform) === platform);
  const fields: Record<string, string> = {};
  for (const f of required) fields[f] = prev?.fields[f] || firstLine(f) || '';
  return { ...d, versions: [...d.versions, { visual, platform, fields: withoutEmpty(fields) }] };
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const nextVisual = (d: DraftLike) => LETTERS.find(l => !d.versions.some(v => v.visual === l)) || 'Z';

/** A copy option's number within its ad (a visual and platform), in the draft's order: 1, 2, 3… */
export function adNumber(d: DraftLike, index: number, platformOf: (v: DraftVersionLike) => string): number {
  const v = d.versions[index];
  if (!v) return 0;
  return d.versions.slice(0, index + 1).filter(x => x.visual === v.visual && platformOf(x) === platformOf(v)).length;
}
/** '' for an index with no ad (an ad just removed, while the screen still holds the plan from before). */
export const adName = (d: DraftLike, index: number, platformOf: (v: DraftVersionLike) => string) => (d.versions[index] ? `Ad ${d.versions[index].visual} · option ${adNumber(d, index, platformOf)}` : '');

/** Where a line is used: "Ad A · option 1", "Ad A · on the image", "Ad B · card 2". (An ad is a visual; its versions are its copy options.) */
export function usesOf(d: DraftLike, lineId: string, platformOf: (v: DraftVersionLike) => string): string[] {
  const out: string[] = [];
  d.versions.forEach((v, i) => { if (Object.values(v.fields).includes(lineId)) out.push(adName(d, i, platformOf)); });
  for (const [visual, val] of Object.entries(d.on_image)) {
    if (Array.isArray(val)) val.forEach((id, k) => { if (id === lineId) out.push(`Ad ${visual} · card ${k + 1}`); });
    else if (val === lineId) out.push(`Ad ${visual} · on the image`);
  }
  for (const [visual, val] of Object.entries(d.on_image_sub || {})) {
    if (Array.isArray(val)) val.forEach((id, k) => { if (id === lineId) out.push(`Ad ${visual} · card ${k + 1} subhead`); });
    else if (val === lineId) out.push(`Ad ${visual} · subhead`);
  }
  return out;
}

/**
 * The version checks' flags shown at one slot (a field, or a carousel card `field#k`): the flags that end on it, once
 * per rule. A per-visual slot (on-image text) collects flags from every ad on the visual, and the same clash found in
 * two ads, worded differently by the model, used to show twice (production test, 1 Oct). A flag about another
 * field or code (`other`) stays separate per target; where one ad's is red and another's amber, the red one shows.
 */
export function flagsAt<F extends { rule: string; fields: string[]; other?: string; severity?: string }>(flags: F[], field: string): F[] {
  const seen = new Set<string>();
  return flags
    .filter(f => f.fields[f.fields.length - 1] === field || (f.fields.length === 1 && f.fields[0] === field))
    .sort((a, b) => Number(b.severity === 'red') - Number(a.severity === 'red')) // red in one ad wins over amber in another
    .filter(f => { const k = `${f.rule}|${f.other || ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * The same, for a slot the whole ad shares (on-image text, a card, the subhead): each flag says which copy option(s) it
 * was found with (`from`: "Copy option 2", "Copy options 1 and 3", "Every copy option"), because the clash is between
 * the shared text and ONE option's caption or headline (production, 7 Oct: "The fields clash in tone" beside the
 * on-image text, with nothing to say which option).
 */
export function flagsAtShared<F extends { rule: string; fields: string[]; other?: string; severity?: string }>(options: Array<{ n: number; flags: F[] }>, field: string): Array<F & { from: string }> {
  const groups = new Map<string, { f: F; ns: number[] }>();
  for (const o of options) for (const f of flagsAt(o.flags, field)) {
    const k = `${f.rule}|${f.other || ''}`;
    const g = groups.get(k);
    if (!g) groups.set(k, { f, ns: [o.n] });
    else { if (!g.ns.includes(o.n)) g.ns.push(o.n); if (f.severity === 'red' && g.f.severity !== 'red') g.f = f; }
  }
  const words = (ns: number[]) => (ns.length === options.length && options.length > 1 ? 'Every copy option' : ns.length === 1 ? `Copy option ${ns[0]}` : `Copy options ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`);
  return [...groups.values()].sort((a, b) => Number(b.f.severity === 'red') - Number(a.f.severity === 'red')).map(g => ({ ...g.f, from: words(g.ns.sort((x, y) => x - y)) }));
}

/**
 * Where each red flag that blocks sign-off is: "Ad B · card 2: unsourced figure, price lead" (production test,
 * 1 Oct: a carousel card's red said only "1 red flag to fix or override first", with nothing on the card).
 * `reds` maps a line id to its unresolved red flags' names; a line used in several places is named at its first.
 */
export function redPlaces(d: DraftLike, reds: Record<string, string[]>, platformOf: (v: DraftVersionLike) => string): string[] {
  const ids = [...new Set([...d.versions.flatMap(v => Object.values(v.fields)), ...Object.values(d.on_image).flat(), ...Object.values(d.on_image_sub || {}).flat()].filter(Boolean))];
  return ids.filter(id => reds[id]?.length).map(id => `${usesOf(d, id, platformOf)[0] || 'A line'}: ${reds[id].join(', ')}`);
}
