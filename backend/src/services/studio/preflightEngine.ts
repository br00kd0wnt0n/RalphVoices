// The audit engine Pre-flight runs, behind one small interface so Studio can
// build against it while B2 packages its engine (backend/src/services/audit/).
// `mockEngine` needs no key and no model: it reads the words on a test asset
// from a marker in the file, so the whole flow can be tested end to end. Copy
// match isn't the engine's job: Studio runs it per stub (preflight.ts). The B2 adapter lives in preflightB2.ts.

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
  /** What was read off the asset, piece by piece (card, frame, voice-over): Studio's copy match runs on it per stub. */
  asset_text?: Array<{ where: string; text: string }>;
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
  estimate(input: AuditInput): { usd: number; seconds: number } | Promise<{ usd: number; seconds: number }>;
  run(input: AuditInput, progress: (message: string) => void): Promise<AuditResult>;
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
    const pieces = i.files.map((f, n) => ({ where: i.kind === 'carousel' ? `card ${n + 1}` : i.kind === 'video' ? 'voice-over' : 'image', text: plantedText(f.path) })).filter(p => p.text);
    const found = pieces.map(p => p.text).join('\n');
    progress('Checking the asset');
    // Copy match runs in Studio, per stub (preflight.ts); the engine only reads the asset.
    const flags: AuditFlag[] = [];
    if (/pays? for itself/i.test(found)) flags.push({ rule: 'COMP_PAYS_FOR_ITSELF', severity: 'red', label: 'Never say or imply the policy pays for itself.', source: 'rules', quote: 'pays for itself', where: 'on the asset' });
    if (i.kind === 'video') flags.push({ rule: 'FRAMES_UNAVAILABLE', severity: 'grey', label: 'Video frames unavailable (no ffmpeg); judged on the transcript and caption only', source: 'engine' });
    flags.push({ rule: 'CROSS_PERSONA', severity: 'grey', label: 'How another persona might read it', source: 'engine', persona: 'OWN', cross_persona: true, why: 'Owners may read this as a price message.' });
    return {
      engine: 'mock', flags, text_found: found, asset_text: pieces, transcript: i.kind === 'video' ? found : undefined,
      features: { humour: 0.1, direct_vet_pay: /paid directly|pays your vet/i.test(found) ? 0.9 : 0.05, dollar_figure: /\$\d/.test(found) ? 0.95 : 0.02 },
      objection: 'Sounds nice, but what does it actually cost me?', frames_unavailable: i.kind === 'video', usd: 0,
    };
  },
};
