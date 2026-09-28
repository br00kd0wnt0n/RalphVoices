// B2: rule-based copy checks on every block of words an asset carries: the
// sidecar copy fields and the text on each image or frame. The patterns, facts
// and limits all come from the rules file; this file only applies them.
// (Studio has its own version of these checks; B2 doesn't import Studio code.)
import type { Flag, Pattern, RuleItem, Rules, Severity } from './types.js';

export interface TextBlock {
  where: string;      // "Meta headline", "card 1", "1.5 s (hook)"
  field?: string;     // rules field id for sidecar copy; undefined for on-image text
  text: string;
  lead?: boolean;     // the first thing seen: a headline/hook field, or the first card or frame
  onImage?: boolean;
  ocrOnly?: boolean;  // words only tesseract read (vision didn't): findings are amber at most
}

const SEV: Record<string, Severity> = { compliance: 'red', warn: 'amber', note: 'grey' };
const RANK: Record<Severity, number> = { red: 2, amber: 1, grey: 0 };
export const sevOf = (s?: string, dflt: Severity = 'amber'): Severity => (s ? SEV[s] ?? dflt : dflt);

const pat = (p: Pattern) => (typeof p === 'string' ? { re: p } : p);

export function labelOf(i: RuleItem): string {
  return i.rule + (i.status === 'pending' ? ' (rule pending)' : '') + (i.needs_confirmation ? ' (exclusions to be confirmed)' : '');
}

/** Merge a flag into the list: one flag per rule and place, keeping the strongest severity. */
export function addFlag(flags: Flag[], f: Flag): void {
  const ex = flags.find(x => x.rule === f.rule && (x.persona || '') === (f.persona || '') && (x.where || '') === (f.where || ''));
  if (!ex) { flags.push(f); return; }
  for (const b of f.by) if (!ex.by.includes(b)) ex.by.push(b);
  if (!ex.quote && f.quote) ex.quote = f.quote;
  if (f.p !== undefined) ex.p = f.p;
  if (f.why && !ex.why) ex.why = f.why;
  if (RANK[f.severity] > RANK[ex.severity]) ex.severity = f.severity;
}

function words(s: string) { return s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean); }

function figureKey(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '').replace(/million/, 'm').replace(/billion/, 'b').replace(/^\$/, '').replace(/,/g, '');
}
export function figuresIn(text: string): string[] {
  // 24/7 and decades or ages ("late 50s", "the 1990s") aren't claims.
  const t = text.replace(/24\/7/g, ' ').replace(/\b\d{1,3}0['’]?s\b/g, ' ');
  return [...t.matchAll(/\$?\d[\d,]*(?:\.\d+)?\s?(?:%|x\b|k\b|m\b|million\b|billion\b|b\b)?/gi)].map(m => m[0].trim()).filter(Boolean);
}

function truncTail(text: string, visible: number): string {
  const cs = [...text];
  let i = visible;
  while (i > 0 && /\S/.test(cs[i - 1])) i--;
  return cs.slice(i).join('');
}

// Curly quotes and OCR's stray line breaks shouldn't hide a match.
const clean = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s*\n\s*/g, ' ');

/**
 * Rule-based flags for one asset. `blocks` are all its words; `persona` is the
 * intended persona (its turn-offs are amber); the other personas' turn-offs
 * come back as grey notes, for cross-persona travel.
 */
export function copyFlags(blocks: TextBlock[], rules: Rules, persona: string | null): Flag[] {
  const flags: Flag[] = [];
  const all = clean(blocks.map(b => b.text).join('\n'));

  for (const b of blocks) {
    const text = clean(b.text);
    if (!text.trim()) continue;
    const by = [b.ocrOnly ? 'ocr' : 'rule'];
    const cap = (s: Severity): Severity => (b.ocrOnly && s === 'red' ? 'amber' : s);
    const ocrWhy = b.ocrOnly ? ' (read by tesseract only; check the image)' : '';

    // Character limits: sidecar copy fields only.
    const f = b.field ? rules.fields[b.field] : undefined;
    if (f && !b.onImage) {
      const n = [...b.text].length;
      if (n > f.max) addFlag(flags, { severity: 'amber', rule: 'LIMIT_MAX', label: `Over the ${f.label} limit (${n}/${f.max})`, source: f.source, where: b.where, by: ['rule'], why: `${n} characters; limit ${f.max}` });
      else if (n > f.visible) addFlag(flags, { severity: f.max <= 60 ? 'amber' : 'grey', rule: 'LIMIT_VISIBLE', label: `Truncated: ${n} characters, ${f.visible} visible in ${f.label}`, source: f.source, where: b.where, quote: truncTail(b.text, f.visible), by: ['rule'] });
    }

    const personaItems = Object.entries(rules.personas).flatMap(([code, pr]) => pr.turn_offs.map(t => ({ ...t, persona: code })));
    const items: Array<RuleItem & { persona?: string }> = [...rules.compliance, ...rules.brand, ...personaItems];
    for (const it of items) {
      const own = !it.persona || it.persona === persona;
      const lower = (s: Severity): Severity => (own ? s : 'grey');
      if (it.check === 'banned' || it.check === 'price_lead') {
        let best: { sev: Severity; quote: string; why?: string } | null = null;
        for (const p0 of it.patterns || []) {
          const p = pat(p0);
          const m = new RegExp(p.re, 'i').exec(text);
          if (!m) continue;
          let sev = sevOf(p.severity || it.severity);
          let why = p.why;
          if (it.check === 'price_lead') {
            const firstClause = text.search(/[.!?—:;]/);
            const leads = b.lead || (b.field && (it.lead_fields || []).includes(b.field)) || m.index < (firstClause > 0 ? firstClause : 60);
            sev = leads ? sevOf(it.severity, 'red') : 'amber';
            why = leads ? 'Price leads' : "Premium mentioned mid-copy; fine only if price isn't the message";
          }
          const quote = m[0] + (text.slice(m.index + m[0].length).match(/^\w*/)?.[0] || '');
          if (!best || RANK[sev] > RANK[best.sev]) best = { sev, quote, why };
        }
        if (best) addFlag(flags, { severity: lower(cap(best.sev)), rule: it.id, label: labelOf(it), source: it.source, quote: best.quote, where: b.where, why: (best.why || '') + ocrWhy || undefined, by, persona: it.persona });
      } else if (it.check === 'case' && b.field && !b.onImage) {
        const letters = text.replace(/[^A-Za-z]/g, '');
        const upper = letters.replace(/[^A-Z]/g, '').length;
        if (letters.length >= 8 && upper / letters.length > 0.6) addFlag(flags, { severity: sevOf(it.severity), rule: it.id, label: labelOf(it), source: it.source, where: b.where, why: 'All caps in a copy field', by });
      } else if (it.check === 'require') {
        const trig = (it.trigger_patterns || []).map(p => new RegExp(p, 'i').exec(text)).find(Boolean);
        if (!trig) continue;
        const req = (s: string) => (it.requires_patterns || []).some(p => new RegExp(p, 'i').test(s));
        if (req(text)) continue;
        const elsewhere = req(all);
        addFlag(flags, {
          severity: elsewhere ? 'amber' : cap(sevOf(it.severity, 'red')), rule: it.id, label: it.rule, source: it.source, quote: trig[0], where: b.where, by,
          why: elsewhere ? 'The caveat is elsewhere in the ad, not with the claim' + ocrWhy : 'Direct-pay claim without "at participating hospitals" anywhere in the ad' + ocrWhy,
        });
      } else if (it.check === 'verbatim') {
        const k = it.min_words || 6;
        const lw = words(text);
        const shingles = new Set<string>();
        for (let i = 0; i + k <= lw.length; i++) shingles.add(lw.slice(i, i + k).join(' '));
        outer: for (const pr of Object.values(rules.personas)) for (const v of pr.verbatims || []) {
          const vw = words(v.text);
          for (let i = 0; i + k <= vw.length; i++) {
            const s = vw.slice(i, i + k).join(' ');
            if (shingles.has(s)) { addFlag(flags, { severity: cap(sevOf(it.severity, 'red')), rule: it.id, label: it.rule, source: `${it.source}; ${v.id} (${v.source})`, quote: s, where: b.where, by }); break outer; }
          }
        }
      }
    }

    // Figures must come from the facts list (the intended persona's facts plus the shared ones).
    const facts = rules.facts.filter(x => !x.personas || !persona || x.personas.includes(persona));
    const allowed = new Set(facts.flatMap(x => x.numbers.map(figureKey)));
    const used = new Set<string>();
    for (const raw of figuresIn(text)) {
      const key = figureKey(raw);
      used.add(key);
      const small = /^\d+$/.test(key) && Number(key) <= 12 && !raw.includes('$');
      if (!small && !allowed.has(key)) {
        addFlag(flags, { severity: cap(sevOf(rules.figure_rule.severity, 'red')), rule: rules.figure_rule.id, label: rules.figure_rule.rule, source: rules.figure_rule.source, quote: raw, where: b.where, why: `"${raw}" isn't in the facts list${ocrWhy}`, by });
      }
    }
    for (const fact of facts) {
      const hit = fact.numbers.map(figureKey).find(k => used.has(k) && !(/^\d+$/.test(k) && Number(k) <= 12));
      if (!hit) continue;
      const cr = rules.figure_rule.citation_rule;
      if (fact.category && cr) addFlag(flags, { severity: 'amber', rule: cr.id, label: cr.rule, source: `${cr.source}; ${fact.id} (${fact.source})`, quote: hit, where: b.where, why: 'Third-party category stat: needs an on-ad citation', by });
      const ar = rules.figure_rule.attribution_rule;
      for (const mp of fact.misattribution_patterns || []) {
        const m = new RegExp(mp, 'i').exec(text);
        if (m && ar) { addFlag(flags, { severity: cap('red'), rule: ar.id, label: ar.rule, source: `${ar.source}; ${fact.id} (${fact.source})`, quote: m[0], where: b.where, why: fact.check_hint, by }); break; }
      }
    }
  }
  return flags;
}

/** Words on the first frame or card: the on-image text load. */
export function wordCount(text: string): number {
  return (text.match(/[A-Za-z0-9$%'’]+/g) || []).length;
}

/**
 * Words tesseract read that vision didn't (4+ letters, not already in vision's
 * text). A cross-check for missed or garbled small print, not a second reading.
 */
export function ocrOnlyWords(vision: string, tess: string): string[] {
  const seen = new Set(words(vision));
  const out: string[] = [];
  for (const w of words(tess)) {
    if (w.length < 4 || seen.has(w) || !/^[a-z']+$/.test(w) || !/[aeiouy]/.test(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}
