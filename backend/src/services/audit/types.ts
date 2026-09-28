// B2 pre-flight audit: shared types. Self-contained (no imports from Studio or
// weekly code); the rules and rubric are read from the client folder at run time.

export type Severity = 'red' | 'amber' | 'grey';

/** A pattern in the rules file: a bare regex, or one carrying its own severity. */
export type Pattern = string | { re: string; severity?: 'compliance' | 'warn' | 'note'; why?: string };

export interface RuleItem {
  id: string;
  rule: string;
  severity?: 'compliance' | 'warn' | 'note';
  check?: string;
  patterns?: Pattern[];
  trigger_patterns?: string[];
  requires_patterns?: string[];
  wordings?: [string, string];
  lead_fields?: string[];
  structures?: string[];
  min_words?: number;
  status?: string;
  needs_confirmation?: boolean;
  source: string;
}

export interface Fact {
  id: string;
  text: string;
  numbers: string[];
  source: string;
  personas?: string[];
  category?: boolean;
  check_hint?: string;
  misattribution_patterns?: string[];
}

export interface Field { platform: string; label: string; visible: number; max: number; source: string }

export interface PersonaRules {
  name: string;
  platforms?: string[];
  triggers: Array<{ id: string; label: string; detail: string; source: string }>;
  turn_offs: RuleItem[];
  verbatims: Array<{ id: string; text: string; source: string }>;
}

export interface Rules {
  version: string;
  sources: Record<string, { title: string }>;
  fields: Record<string, Field>;
  facts: Fact[];
  figure_rule: {
    id: string; rule: string; severity?: string; source: string;
    citation_rule?: { id: string; rule: string; source: string };
    attribution_rule?: { id: string; rule: string; source: string };
  };
  compliance: RuleItem[];
  brand: RuleItem[];
  clarity: RuleItem[];
  features: { source: string; items: Record<string, string> };
  personas: Record<string, PersonaRules>;
}

export interface RubricItem { id: string; group: string; wording: [string, string] }
export interface Rubric { version: string; system: string; items: RubricItem[] }

export type AssetKind = 'static' | 'carousel' | 'video' | 'text';

export interface Stub {
  stub: string;        // PERSONA_TERRITORY_FORMAT_v#_PLATFORM, as B3 normalises it
  persona: string;
  territory: string;
  format: string;      // ST | VID | CAR | TT | UGC
  version: number;
  platform: string;    // META | TT
}

export interface Frame {
  label: string;       // "card 1", "0.0 s", "1.5 s (hook)", "last frame"
  path: string;        // image file
  at?: number;         // seconds, for video
  role?: 'first' | 'hook' | 'last' | 'card';
}

export interface Asset {
  name: string;        // file or folder name as dropped
  stub: Stub | null;
  stub_error?: string;
  kind: AssetKind;
  source: string;      // path of the file or folder
  frames: Frame[];
  copy: Record<string, string>;  // sidecar fields keyed by rules field id (or a free label)
  copy_labels: Record<string, string>;
  transcript?: string;
  text_only?: string;  // text-only assets (concept cards): the whole ad description
  duration?: number;
}

export interface FrameText { label: string; text: string; ocr: string; ocr_only: string[]; description: string }

export interface Flag {
  severity: Severity;
  rule: string;         // rules-file id (or a rubric id / LIMIT_* / TEXT_LOAD)
  label: string;        // the rule as written in the rules file
  source: string;       // from the rules file
  quote?: string;       // the words it rests on
  where?: string;       // field or frame
  why?: string;
  by: string[];         // which layers found it: rule, ocr, model, yesno
  p?: number;           // averaged P(Yes) of the two wordings, when asked
  persona?: string;     // for turn-offs
}

export interface YesNo { id: string; p: number; pa: number | null; pb: number | null }

export interface AssetAudit {
  asset: string;
  stub: string | null;
  persona: string | null;
  kind: AssetKind;
  frames: FrameText[];
  copy: Record<string, string>;
  features: Record<string, number>;      // feature id -> averaged P(Yes)
  items: Record<string, YesNo>;          // every yes/no item asked
  flags: Flag[];
  set_aside: Array<{ rule: string; quote?: string; why: string }>;  // reads one layer raised and another contradicted
  objection: string;
  text_load: { words: number; where: string } | null;
  usd: number;
  seconds: number;
  calls: number;
  errors: string[];
}
