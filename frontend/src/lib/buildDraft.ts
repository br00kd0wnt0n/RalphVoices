// Build & sign off (redesign, Nick's screen before Tue 6 Oct): the pure rules for
// building ads from kept lines. The draft is what the server takes as is
// (versions: visual + field → line id; on_image: per visual, a line id or a
// carousel's cards). No app imports, so backend/tests/studioBuildDraft.test.ts
// can check it (as studioFields.ts is checked).

export interface DraftVersionLike { visual: string; fields: Record<string, string>; platform?: string }
export interface DraftLike { versions: DraftVersionLike[]; on_image: Record<string, string | string[]> }

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
  // A visual with no ads left keeps no on-image text.
  const on_image = { ...d.on_image };
  if (gone && !versions.some(v => v.visual === gone.visual)) delete on_image[gone.visual];
  return { ...d, versions, on_image };
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

/** "Ad 1", "Ad 2"… within a visual (and platform), in the draft's order. */
export function adNumber(d: DraftLike, index: number, platformOf: (v: DraftVersionLike) => string): number {
  const v = d.versions[index];
  return d.versions.slice(0, index + 1).filter(x => x.visual === v.visual && platformOf(x) === platformOf(v)).length;
}
export const adName = (d: DraftLike, index: number, platformOf: (v: DraftVersionLike) => string) => `Visual ${d.versions[index].visual} · Ad ${adNumber(d, index, platformOf)}`;

/** Where a line is used: "Visual A · Ad 1", "Visual A · on the image", "Visual B · card 2". */
export function usesOf(d: DraftLike, lineId: string, platformOf: (v: DraftVersionLike) => string): string[] {
  const out: string[] = [];
  d.versions.forEach((v, i) => { if (Object.values(v.fields).includes(lineId)) out.push(adName(d, i, platformOf)); });
  for (const [visual, val] of Object.entries(d.on_image)) {
    if (Array.isArray(val)) val.forEach((id, k) => { if (id === lineId) out.push(`Visual ${visual} · card ${k + 1}`); });
    else if (val === lineId) out.push(`Visual ${visual} · on the image`);
  }
  return out;
}
