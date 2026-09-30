// Which fields a Write & brief brief writes (Nick, 30 Sep: "when I request Meta
// on-image copy, I get a lot of TikTok hooks / primary text"). Pure, with no app
// imports, so backend/tests/studioWriteFields.test.ts can check it.
//
// - Defaults follow the territory's format (the server's defaultFields, sent on
//   /meta as territories[code].default_fields), falling back to the persona's.
// - They apply on first load and when the territory changes, but only while the
//   person hasn't changed the fields in this brief (`fields_touched`).
// - Changing persona or territory never silently drops ticked fields that still
//   exist; when defaults are applied, a one-line note says so.

export interface FieldsMeta {
  fields: Record<string, { label: string }>;
  personas: Record<string, { default_fields: string[] }>;
  territories: Record<string, { persona: string; format: string; status?: string; default_fields?: string[] }>;
}
export interface FieldsBrief { persona: string; territory: string; fields: string[]; fields_touched?: boolean; own_lines?: Array<{ text: string; field: string }> }

const FORMAT_WORDS: Record<string, string> = { STATIC: 'a static', CAROUSEL: 'a carousel', VIDEO: 'a video', UGC: 'UGC', TIKTOK: 'TikTok', TT: 'TikTok' };
const short = (meta: FieldsMeta, f: string) => (meta.fields[f]?.label || f).replace(/^(Meta|TikTok) /, '').replace(/ text$/, '').toLowerCase();

export function defaultFieldsFor(meta: FieldsMeta, territory: string): string[] {
  const t = meta.territories[territory];
  return (t?.default_fields?.length ? t.default_fields : meta.personas[t?.persona || '']?.default_fields || []).filter(f => meta.fields[f]);
}

/** Own lines follow the ticked fields: a line whose field isn't ticked any more goes to the first ticked field. */
export function syncOwnLines<T extends { field: string }>(own: T[] | undefined, fields: string[]): T[] | undefined {
  if (!own || !fields.length) return own;
  return own.map(o => (fields.includes(o.field) ? o : { ...o, field: fields[0] }));
}

/**
 * A new persona and/or territory. Untouched fields take the new territory's defaults (with a note when that changes
 * them); touched fields are kept, minus any the rules don't have. The persona's first live territory when only the
 * persona is given.
 */
export function applyPlace<B extends FieldsBrief>(meta: FieldsMeta, brief: B, patch: { persona?: string; territory?: string }): { brief: B; note: string } {
  const persona = patch.persona ?? brief.persona;
  const territory = patch.territory ?? (patch.persona && patch.persona !== brief.persona
    ? Object.entries(meta.territories).find(([, x]) => x.persona === persona && x.status !== 'retired')?.[0] || ''
    : brief.territory);
  let fields = brief.fields.filter(f => meta.fields[f]);
  let note = '';
  if (!brief.fields_touched || !fields.length) {
    const d = defaultFieldsFor(meta, territory);
    if (d.join() !== fields.join()) note = `Fields set for ${FORMAT_WORDS[String(meta.territories[territory]?.format || '').toUpperCase()] || 'this territory'}: ${d.map(f => short(meta, f)).join(', ')}`;
    fields = d;
  }
  return { brief: { ...brief, persona, territory, fields, own_lines: syncOwnLines(brief.own_lines, fields) }, note };
}

/** Tick or untick a field, or (only) make it the single ticked field. Marks the fields as the person's own choice. */
export function toggleField<B extends FieldsBrief>(brief: B, field: string, only = false): B {
  const fields = only ? [field] : brief.fields.includes(field) ? brief.fields.filter(f => f !== field) : [...brief.fields, field];
  return { ...brief, fields, fields_touched: true, own_lines: syncOwnLines(brief.own_lines, fields) };
}
