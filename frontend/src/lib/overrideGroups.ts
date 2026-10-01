// Overridden red flags shown once each (production test, 1 Oct: "Went through with 4 overridden red flags" listed the
// same $5,000 rule four times: the copy override repeated per code, plus the asset's). Grouped by where it was
// overridden (the copy at sign-off, or the asset check), the rule and the reason, with the codes it applies to.
// No app imports, so backend/tests/studioOverrideGroups.test.ts can check it.

export interface OverrideItem { kind: 'copy' | 'asset'; label: string; reason: string; code?: string; by?: string }
export interface OverrideGroup { kind: 'copy' | 'asset'; label: string; reason: string; by?: string; codes: string[] }

export function groupOverrides(items: OverrideItem[]): OverrideGroup[] {
  const out = new Map<string, OverrideGroup>();
  for (const x of items) {
    const k = JSON.stringify([x.kind, x.label.trim().toLowerCase(), x.reason.trim()]);
    const g = out.get(k) || { kind: x.kind, label: x.label, reason: x.reason, by: x.by, codes: [] };
    if (x.code && !g.codes.includes(x.code)) g.codes.push(x.code);
    out.set(k, g);
  }
  return [...out.values()];
}

/** "on the copy at sign-off, A1, A2 and A3" / "in the asset check (every code on it)". */
export function overrideWhere(g: OverrideGroup): string {
  const codes = g.codes.length > 2 ? `${g.codes.slice(0, -1).join(', ')} and ${g.codes.at(-1)}` : g.codes.join(' and ');
  return g.kind === 'copy' ? `on the copy at sign-off${codes ? `, ${codes}` : ''}${g.by ? `, by ${g.by}` : ''}` : `in the asset check${codes ? `, ${codes}` : ' (every code on it)'}`;
}
