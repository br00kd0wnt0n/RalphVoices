// The audit engine Pre-flight runs, behind one small interface so Studio can
// build against it while B2 packages its engine (backend/src/services/audit/).
// `mockEngine` needs no key and no model: it reads the words on a test asset
// from a marker in the file and checks copy match, so the whole flow can be
// tested end to end. The B2 adapter lives in preflightB2.ts.

import fs from 'node:fs';

export type AssetKind = 'static' | 'carousel' | 'video';
export type FlagSeverity = 'red' | 'amber' | 'grey';

export interface SignedCopy { line_id: string; field: string; label: string; text: string; version: number }

export interface AuditInput {
  stub: string; persona: string; territory: string; kind: AssetKind;
  /** Local temp copies of the uploaded files, in card order (estimate gets the bytes instead of a path). */
  files: Array<{ path: string; filename: string; contentType: string; data?: Buffer }>;
  /** The signed-off wording for this stub (Ready for production). */
  copy: SignedCopy[];
  rules: any;
  /** The M3 rubric (B2's feature wordings), when the engine needs it. */
  rubric?: any;
}

export interface AuditFlag {
  rule: string;
  severity: FlagSeverity;
  label: string;
  source: string;
  quote?: string;
  why?: string;
  /** Where on the asset: 'card 2', '1.5 s (hook)', 'caption'. */
  where?: string;
  /**
   * Where on the asset the flag rests: an uploaded card (asset_position, for
   * statics and carousels), a thumbnail file the service stores (path), or a
   * video frame described in words (label, description).
   */
  frame?: { path?: string; asset_position?: number; label?: string; description?: string };
  /** Another persona's turn-off (a grey note on how the asset travels). */
  cross_persona?: boolean;
  /** 'copy_match' for the headline check. */
  check?: string;
  /** Cross-persona grey notes name the persona they come from. */
  persona?: string;
}

export interface AuditResult {
  engine: string;
  flags: AuditFlag[];
  text_found: string;
  transcript?: string;
  /** Feature probabilities (P(Yes)) by feature id, as B2 reports them. */
  features: Record<string, number>;
  objection?: string;
  notes?: string[];
  frames_unavailable?: boolean;
  usd: number;
  /** The engine's full report (B2's AuditReport), kept for exports. */
  report?: any;
}

export interface AuditEngine {
  name: string;
  estimate(input: AuditInput): { usd: number; seconds: number };
  run(input: AuditInput, progress: (message: string) => void): Promise<AuditResult>;
}

// ---------- copy match (used by the mock; B2 has its own) ----------

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9$%'. ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Every signed-off line must appear on the asset word for word (after
 * normalising case and punctuation). A missing sentence, such as a dropped
 * caveat, is red: the asset doesn't carry the wording that was signed off.
 */
export function copyMatchFlags(copy: SignedCopy[], found: string): AuditFlag[] {
  const onAsset = norm(found);
  const flags: AuditFlag[] = [];
  for (const c of copy) {
    if (onAsset.includes(norm(c.text))) continue;
    const sentences = c.text.split(/(?<=[.!?])\s+/).filter(Boolean);
    let missing = sentences.filter(s => !onAsset.includes(norm(s)));
    // One sentence cut short (a dropped caveat at the end): quote just the words that didn't make it.
    if (missing.length === 1) {
      const words = missing[0].split(/\s+/);
      let keep = 0;
      while (keep < words.length && onAsset.includes(norm(words.slice(0, keep + 1).join(' ')))) keep++;
      if (keep > 0 && keep < words.length) missing = [words.slice(keep).join(' ')];
    }
    flags.push({
      rule: 'COPY_MATCH', severity: 'red', check: 'copy_match', where: c.label,
      label: 'The asset must carry the signed-off wording',
      source: `Ready for production, ${c.label} v${c.version}`,
      quote: (missing.length ? missing : [c.text]).join(' '),
      why: missing.length && missing.join(' ') !== c.text
        ? 'The asset carries part of the signed-off line, not all of it'
        : 'This signed-off line isn’t on the asset as written',
    });
  }
  return flags;
}

// ---------- mock engine ----------

/** Test assets carry their words after a marker, e.g. an image file ending in "VOICES_TEXT: Your vet bill…". */
export function plantedText(file: string): string {
  const s = fs.readFileSync(file).toString('latin1');
  const i = s.lastIndexOf('VOICES_TEXT:');
  return i >= 0 ? Buffer.from(s.slice(i + 12), 'latin1').toString('utf8').trim() : '';
}

export const mockEngine: AuditEngine = {
  name: 'mock',
  estimate: i => ({ usd: 0, seconds: 2 + i.files.length }),
  async run(i, progress) {
    progress(`Reading ${i.files.length} file${i.files.length === 1 ? '' : 's'}`);
    const found = i.files.map(f => plantedText(f.path)).filter(Boolean).join('\n');
    progress('Checking copy match');
    const flags = copyMatchFlags(i.copy, found);
    if (/pays? for itself/i.test(found)) flags.push({ rule: 'COMP_PAYS_FOR_ITSELF', severity: 'red', label: 'Never say or imply the policy pays for itself.', source: 'rules', quote: 'pays for itself', where: 'on the asset' });
    if (i.kind === 'video') flags.push({ rule: 'FRAMES_UNAVAILABLE', severity: 'grey', label: 'Video frames unavailable (no ffmpeg); judged on the transcript and caption only', source: 'engine' });
    flags.push({ rule: 'CROSS_PERSONA', severity: 'grey', label: 'How another persona might read it', source: 'engine', persona: 'OWN', cross_persona: true, why: 'Owners may read this as a price message.' });
    if (i.kind !== 'video' && flags.length) flags[0].frame = { asset_position: 0, label: 'card 1' };
    return {
      engine: 'mock', flags, text_found: found, transcript: i.kind === 'video' ? found : undefined,
      features: { humour: 0.1, direct_vet_pay: /paid directly|pays your vet/i.test(found) ? 0.9 : 0.05, dollar_figure: /\$\d/.test(found) ? 0.95 : 0.02 },
      objection: 'Sounds nice, but what does it actually cost me?', frames_unavailable: i.kind === 'video', usd: 0,
    };
  },
};
