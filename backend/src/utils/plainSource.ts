// A rules-file source in plain words, as the Studio page says it (the page's copy: plainSource in
// frontend/src/components/studio/ui.tsx). Used where the server writes for people: the Pre-flight flag report.
const SOURCE_NAMES: Record<string, string> = {
  TM: 'Trigger maps', EP: 'Evidence pack', QB: 'Quote bank', CLB: 'Creative brief', CC: 'Concept cards', RB: 'Rubric',
  BG: 'Brand guidelines', META: 'Meta ads guide', META3P: 'Meta length guides', TT: 'TikTok ads help', TT3P: 'TikTok length guides',
  HOUSE: 'House rule', LEGAL: 'Legal', GUIDE: 'Guide',
};
const MAP_PERSONA: Record<string, string> = { '1': 'DINKs', '2': 'Curators', '3': 'Busy Families' };

/** territories: territory code → name, for "Concept card: Ask Your Vet". */
export function plainSource(src: string | undefined, territories: Record<string, string> = {}): string {
  if (!src) return '';
  const card = (code: string) => (territories[code] ? `Concept card: ${territories[code].replace(/\.$/, '')}` : 'Concept card');
  const parts = src.split(/;\s*/).map(raw => {
    const part = raw.trim()
      .replace(/\s*\((?:NR_[A-Z_]+|facts? [A-Z]\d[^)]*)\)/g, '')
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
  return [...new Set(parts.filter(Boolean))].join(' · ').replace(/\b[A-Z]+_[A-Z]+\b/g, c => territories[c]?.replace(/\.$/, '') ?? c);
}
