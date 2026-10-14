// The upload declaration (Trupanion, 6 Oct: no AI-generated imagery or video; stock approved). Pre-flight can't tell
// AI imagery from a file, so the person uploading declares it, with where the footage or imagery came from and, when
// a customer is shown or quoted, that they are a real member. Required before Pre-flight is marked passed, for every
// format (statics too). Stored per upload in studio_inputs `upload_declaration:<upload id>` (no migration); a new
// upload of the same ad starts from the last one's answers.

export const SOURCES = {
  shot: 'Shot for this campaign',
  stock: 'Licensed stock',
  library: 'Trupanion’s creator / UGC library',
  animated: 'Animated from an approved static or carousel',
  other: 'Other',
} as const;
export type Source = keyof typeof SOURCES;
/** A customer shown or quoted ("This is Molly…", a testimonial): a real member, with consent; or nobody is. */
export type MemberAnswer = 'member' | 'none';

export interface DeclarationInput {
  /** "No AI-generated imagery or video": must be ticked. */
  no_ai: boolean;
  sources: Source[];
  /** Licence, library id or shoot reference (needed for stock, the library and other). */
  reference?: string;
  /** The approved ad an animated version is made from (needed for animated). */
  based_on?: string;
  member: MemberAnswer | null;
}
export interface Declaration extends DeclarationInput { by: string; for?: string; at: string }

/** What's missing, in words; empty when the declaration is complete. */
export function declarationProblems(d: Partial<DeclarationInput> | null | undefined): string[] {
  if (!d) return ['Declare the imagery and footage'];
  const out: string[] = [];
  if (d.no_ai !== true) out.push('Tick "No AI-generated imagery or video"');
  const src = (d.sources || []).filter(s => s in SOURCES);
  if (!src.length) out.push('Say where the imagery or footage came from');
  if (src.some(s => s === 'stock' || s === 'library' || s === 'other') && !String(d.reference || '').trim()) out.push('Add the licence, library or shoot reference');
  if (src.includes('animated') && !String(d.based_on || '').trim()) out.push('Name the approved ad it is animated from');
  if (d.member !== 'member' && d.member !== 'none') out.push('Say whether a customer is shown or quoted');
  return out;
}

/** The cleaned input (unknown sources dropped, text trimmed); throws (400) with what's missing. */
export function cleanDeclaration(body: any): DeclarationInput {
  const d: DeclarationInput = {
    no_ai: body?.no_ai === true,
    sources: [...new Set(((Array.isArray(body?.sources) ? body.sources : []) as string[]).filter(s => s in SOURCES))] as Source[],
    reference: String(body?.reference || '').trim().slice(0, 300) || undefined,
    based_on: String(body?.based_on || '').trim().slice(0, 120) || undefined,
    member: body?.member === 'member' || body?.member === 'none' ? body.member : null,
  };
  const problems = declarationProblems(d);
  if (problems.length) throw Object.assign(new Error(`${problems.join('; ')}.`), { status: 400 });
  return d;
}

/** One line for exports and the report: "No AI · Licensed stock (Getty 123) · no customer shown · brook, 14 Oct". */
export function declarationWords(d: Declaration | null | undefined): string {
  if (!d) return 'Not declared';
  const day = new Date(d.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const src = d.sources.map(s => (s === 'animated' && d.based_on ? `${SOURCES[s]} (${d.based_on})` : SOURCES[s])).join(', ');
  return [
    'No AI imagery or video', `${src}${d.reference ? ` (${d.reference})` : ''}`,
    d.member === 'member' ? 'a real member, with consent' : 'no customer shown or quoted',
    `${d.for && d.for !== d.by ? `${d.by} for ${d.for}` : d.by}, ${day}`,
  ].join(' · ');
}
