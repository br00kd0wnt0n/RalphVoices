// B2: the yes/no items asked of every asset, each tied to a rules-file id (its
// rule text and source are read from the rules file) or a rubric item. Where the
// M3 rubric already asks the question, its two wordings are used unchanged, so
// the concept-card acceptance reproduces the spike. The wordings below are only
// for turn-offs the rubric doesn't cover; they restate no rule.
import type { Rubric, Rules } from './types.js';

export type ItemKind = 'feature' | 'turnoff' | 'brand' | 'clarity' | 'table' | 'video';

export interface YesNoItem {
  id: string;                 // rubric id, or the rules id when the rubric has no item
  kind: ItemKind;
  rule?: string;              // rules-file id the item reads for (turn-off, brand, clarity)
  persona?: string;           // owner persona for a turn-off
  wordings: [string, string];
  wordingSource: string;      // "RB <id>" or "B2"
  flagWhen?: 'yes' | 'no';    // turn-offs flag on Yes; clarity flags on No
  frame?: 'hook' | 'last';    // video: ask with that frame only
}

// Rubric do-not and clarity items → the rules-file id they read for.
const RUBRIC_RULE: Record<string, { rule: string; persona?: string; kind: ItemKind }> = {
  pet_as_practice: { rule: 'DINK_T_PRACTICE', persona: 'DINK', kind: 'turnoff' },
  mocks_viewer: { rule: 'DINK_T_MOCK', persona: 'DINK', kind: 'turnoff' },
  baby_talk: { rule: 'CUR_T_BABY', persona: 'CUR', kind: 'turnoff' },
  older_pet_pitch: { rule: 'CUR_T_OLD_PET', persona: 'CUR', kind: 'turnoff' },
  pity_older: { rule: 'CUR_T_PITY', persona: 'CUR', kind: 'turnoff' },
  fear_death: { rule: 'CUR_T_FEAR', persona: 'CUR', kind: 'turnoff' },
  shames_uninsured: { rule: 'FAM_T_SHAME', persona: 'FAM', kind: 'turnoff' },
  cheap_price_pitch: { rule: 'FAM_T_LATTE', persona: 'FAM', kind: 'turnoff' },
  one_glance: { rule: 'CL_GLANCE', kind: 'clarity' },
  clear_product: { rule: 'CL_PRODUCT', kind: 'clarity' },
};

// Turn-offs and brand items the rubric has no question for. Keyed by rules id.
const B2_WORDINGS: Record<string, [string, string]> = {
  DINK_T_INDULGE: [
    'Does the ad frame spending on the pet as spoiling, indulgent or frivolous?',
    "Does the ad treat what the owner spends on their pet as an extravagance rather than as care?",
  ],
  DINK_T_NAIVE: [
    'Could the viewer feel the ad treats them as naive about money, or is pushing an upsell?',
    'Does the ad talk down to the viewer about money, or feel like a hard sell?',
  ],
  CUR_T_EXPLAIN: [
    'Does the ad spend its space explaining the basics of how insurance works?',
    'Is the ad mainly an explainer of what pet insurance is and how it works?',
  ],
  FAM_T_DEAD_PET: [
    "Does the ad show or suggest a pet's death in a scene with children?",
    "Does the ad invoke children's grief over losing a pet?",
  ],
  FAM_T_THREAT: [
    "Does the ad dramatise a parent refusing a pet's treatment in front of their children?",
    'Is a parent having to say no to vet care in front of the kids shown as a dramatic scene or a threat?',
  ],
  FAM_T_LECTURE: [
    'Does the brand lecture the viewer about their duty to their pet?',
    'Is the tone of the ad preachy, telling the viewer what a good owner should do?',
  ],
  BR_SAD_PET: [
    'Does any pet in the ad look sick, scared or sad?',
    'Is a pet shown unwell, frightened or unhappy anywhere in the ad?',
  ],
};

const VIDEO_WORDINGS: [string, string] = [
  'From this frame alone, would a viewer know the ad is for Trupanion or for medical insurance for pets?',
  'Does this frame make it clear what brand or product the ad is for (Trupanion, or insurance for pets)?',
];

/** Two wordings for a brand item that brings none: does the ad break the rule as written? */
export function genericWordings(rule: string): [string, string] {
  const r = rule.trim().replace(/\.$/, '');
  return [
    `Does the ad go against this brand rule: "${r}"?`,
    `Would a brand reviewer say the ad's images break the rule "${r}"?`,
  ];
}

/** Every item for an asset. Rubric order first (it is the M3 table), then B2's own. */
export function buildItems(rules: Rules, rubric: Rubric, opts: { video?: boolean; visual?: boolean } = {}): YesNoItem[] {
  const items: YesNoItem[] = [];
  const featureIds = new Set(Object.keys(rules.features.items));
  const turnOffIds = new Set(Object.values(rules.personas).flatMap(p => p.turn_offs.map(t => t.id)));
  const brandIds = new Set(rules.brand.map(b => b.id));
  const clarityIds = new Set(rules.clarity.map(c => c.id));
  for (const it of rubric.items) {
    const map = RUBRIC_RULE[it.id];
    if (featureIds.has(it.id)) items.push({ id: it.id, kind: 'feature', wordings: it.wording, wordingSource: `RB ${it.id}` });
    else if (map && (turnOffIds.has(map.rule) || clarityIds.has(map.rule))) {
      items.push({ id: it.id, kind: map.kind, rule: map.rule, persona: map.persona, wordings: it.wording, wordingSource: `RB ${it.id}`, flagWhen: map.kind === 'clarity' ? 'no' : 'yes' });
    } else items.push({ id: it.id, kind: 'table', wordings: it.wording, wordingSource: `RB ${it.id}` });
  }
  const covered = new Set(items.map(i => i.rule).filter(Boolean));
  for (const [rule, w] of Object.entries(B2_WORDINGS)) {
    if (covered.has(rule)) continue;
    const persona = Object.entries(rules.personas).find(([, p]) => p.turn_offs.some(t => t.id === rule))?.[0];
    if (persona) items.push({ id: rule, kind: 'turnoff', rule, persona, wordings: w, wordingSource: 'B2', flagWhen: 'yes' });
    else if (brandIds.has(rule)) items.push({ id: rule, kind: 'brand', rule, wordings: w, wordingSource: 'B2', flagWhen: 'yes' });
  }
  // Brand items marked for the images (rules v2.3 `applies_to: "visual" | "both"`):
  // their own wordings if the rules file gives them, else B2's, else two built from the rule text.
  const have = new Set(items.map(i => i.rule).filter(Boolean));
  for (const b of rules.brand) {
    if (have.has(b.id) || (b.applies_to !== 'visual' && b.applies_to !== 'both')) continue;
    if (b.applies_to === 'visual' && opts.visual === false) continue; // text-only asset: no photograph to judge
    const w: [string, string] = b.wordings && b.wordings.length === 2 ? b.wordings : B2_WORDINGS[b.id] || genericWordings(b.rule);
    items.push({ id: b.id, kind: 'brand', rule: b.id, wordings: w, wordingSource: b.wordings ? 'rules' : B2_WORDINGS[b.id] ? 'B2' : 'B2 (from the rule text)', flagWhen: 'yes' });
  }
  if (opts.video && clarityIds.has('CL_PRODUCT')) {
    items.push({ id: 'video_brand_hook', kind: 'video', rule: 'CL_PRODUCT', wordings: VIDEO_WORDINGS, wordingSource: 'B2', flagWhen: 'no', frame: 'hook' });
    items.push({ id: 'video_brand_end', kind: 'video', rule: 'CL_PRODUCT', wordings: VIDEO_WORDINGS, wordingSource: 'B2', flagWhen: 'no', frame: 'last' });
  }
  return items;
}

/** Turn-offs the rules file lists as model checks that no item asks about (reported, so gaps are visible). */
export function uncoveredTurnOffs(rules: Rules, items: YesNoItem[]): string[] {
  const asked = new Set(items.map(i => i.rule));
  return Object.values(rules.personas).flatMap(p => p.turn_offs).filter(t => t.check === 'model' && !asked.has(t.id)).map(t => t.id);
}
