// Which code an upload goes to, and which code stays selected in Assets (production test, 1 Oct, finding 25: files
// chosen for FAM_SUMMER_ST_B1 were uploaded to DINK_UNEXPECTED_CAR_A1, the first code in the list, after a background
// refresh moved the selection while the file input kept its files). No app imports, so
// backend/tests/studioUploadTarget.test.ts can check it.

export interface Picked { files: unknown[]; sizes: string[] }

/**
 * The upload for the code whose Upload button was pressed, with the files chosen for that code. Never the code that
 * happens to be selected now, and never another code's files: a code with no files of its own uploads nothing.
 */
export function uploadFor<F extends Picked>(code: string, picked: Record<string, F | undefined>): { stub: string; files: F['files']; sizes: string[] } | null {
  const p = picked[code];
  if (!code || !p || !p.files.length) return null;
  return { stub: code, files: p.files, sizes: p.sizes };
}

/**
 * The code to keep selected after the lists refresh. The current one while it's still listed; while it has files
 * waiting or an upload or check running, it stays even if a filter would hide it (a refresh never moves someone off
 * the code they're uploading to); otherwise the first code shown, or none.
 *
 * `arrive`: the codes of the asset the person came for (from a board cell or Build). On arrival that asset's ad opens:
 * its first listed code, unless the current one is already one of them or is held by files or a running check. It
 * goes before "the first code shown", which otherwise opened the first ad in the list whatever was clicked
 * (production, 8 Oct).
 */
export function keepSelection(sel: string | null, shown: string[], listed: string[], held: string[], arrive: string[] = []): string | null {
  const wanted = arrive.filter(c => listed.includes(c));
  if (wanted.length && !(sel && wanted.includes(sel)) && !(sel && held.includes(sel) && listed.includes(sel))) return wanted[0];
  if (sel && shown.includes(sel)) return sel;
  if (sel && listed.includes(sel) && held.includes(sel)) return sel;
  return shown[0] ?? (sel && listed.includes(sel) ? sel : null);
}

/** The Upload button says where the files go: "Upload 1 file to FAM_SUMMER_ST_B1_US_META_TEST". */
export const uploadLabel = (code: string, n: number, replacing: boolean) =>
  `${replacing ? 'Upload a new version' : 'Upload'}${n ? ` (${n} file${n === 1 ? '' : 's'})` : ''} to ${code}`;
