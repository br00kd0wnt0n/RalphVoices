// Which fields a territory's format uses (rules v2.17). Pure: no engine, so versions.ts and engine.ts both read it.
type Fields = { fields: Record<string, { platform?: string; formats?: string[]; video_role?: string }> };

const FORMAT_ALIAS: Record<string, string> = { TT: 'TIKTOK', VID: 'VIDEO', ST: 'STATIC', CAR: 'CAROUSEL' };
const formatName = (f: string | undefined) => { const x = String(f || '').toUpperCase(); return FORMAT_ALIAS[x] || x; };
/**
 * Is a field offered on a territory of this format? A field with `formats` (rules v2.17) belongs only to those: a
 * static never offers a script, a video never offers a carousel's cards unless the rules say so. No `formats`, or no
 * format given: yes, as before.
 */
export function fieldFitsFormat(field: string, format: string | undefined, r: Fields): boolean {
  const fs = r.fields[field]?.formats;
  if (!Array.isArray(fs) || !fs.length || !format) return true;
  return fs.map(formatName).includes(formatName(format));
}
/** The field with a video role (open, end, script, supers) for a territory's format: video_open on a hero video, tiktok_hook on a TikTok build. */
export function fieldByRole(role: string, format: string | undefined, r: Fields): string | null {
  const tiktok = formatName(format) === 'TIKTOK';
  const hits = Object.keys(r.fields).filter(f => r.fields[f].video_role === role && (/tiktok/i.test(String(r.fields[f].platform)) === tiktok));
  return hits.find(f => fieldFitsFormat(f, format, r)) || null;
}

