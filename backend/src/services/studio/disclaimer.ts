// The approved disclaimer, by region (rules v2.16 `disclaimer.text_by_region`: US, CA, and NA which is valid in
// both). One place for "which text does this ad need, and where does it sit": Pre-flight's check, the small print shown
// in Build and Assets, the handoffs and the design brief all read it here. Pure: no store, no engine.

export const DISCLAIMER_REGION_NAMES: Record<string, string> = { US: 'US', CA: 'Canada', NA: 'North America' };
/**
 * The disclaimer versions an asset may carry, by its region (rules v2.16 `disclaimer.text_by_region`): its own
 * region's, or the North America one (approved for both). Rules without regional versions have just `text`.
 */
export function disclaimerVersions(rules: any, region: string = 'US'): Array<{ key: string; name: string; text: string }> {
  const d = rules?.disclaimer;
  const by = (d?.text_by_region || {}) as Record<string, string>;
  const own = String(by[region] || d?.text || '').trim();
  const out = own ? [{ key: by[region] ? region : '', name: by[region] ? `the ${DISCLAIMER_REGION_NAMES[region] || region} disclaimer` : 'the approved disclaimer', text: own }] : [];
  const na = String(by.NA || '').trim();
  if (na && na !== own) out.push({ key: 'NA', name: 'the North America disclaimer', text: na });
  return out;
}

/** Where the disclaimer must sit, by the asset's format: on the image of a static, the last card of a carousel, the last frame of a video. */
export function disclaimerPlace(format: string | undefined): string {
  const f = String(format || '').toUpperCase();
  return /^CAR/.test(f) ? 'the last card' : /^(VID|UGC|TT|TIKTOK)/.test(f) ? 'the last frame' : 'the image';
}
/**
 * What an ad in a region needs: its region's text (to copy, with its length), and whether the North America version is
 * also accepted. Null when the rules carry no disclaimer text yet.
 */
export function disclaimerFor(rules: any, region: string = 'US'): { text: string; chars: number; name: string; also?: { name: string; chars: number }; rule: string } | null {
  const [own, na] = disclaimerVersions(rules, region);
  if (!own) return null;
  return { text: own.text, chars: [...own.text].length, name: own.name, ...(na ? { also: { name: na.name, chars: [...na.text].length } } : {}), rule: String(rules?.disclaimer?.rule || '') };
}
