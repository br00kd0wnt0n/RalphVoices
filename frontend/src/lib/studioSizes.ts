// Asset sizes on the Assets screen (the server's services/studio/sizes.ts has the
// same rules): read a chosen file's size in the browser, so the person can see
// and correct it before uploading.
export type Size = '1:1' | '4:5' | '9:16';
export const SIZES: Size[] = ['1:1', '4:5', '9:16'];
const RATIO: Record<Size, number> = { '1:1': 1, '4:5': 0.8, '9:16': 0.5625 };

export function snapSize(w: number, h: number): Size | null {
  if (!(w > 0 && h > 0)) return null;
  let best: Size | null = null, off = Infinity;
  for (const s of SIZES) { const d = Math.abs(w / h - RATIO[s]) / RATIO[s]; if (d < off) { off = d; best = s; } }
  return off <= 0.05 ? best : null;
}
export function sizeFromName(name: string): Size | null {
  const m = /(?:^|[^0-9])(1x1|4x5|9x16|1:1|4:5|9:16)(?![0-9])/i.exec(name);
  if (m) return m[1].replace(/x/i, ':') as Size;
  const d = /(?:^|[^0-9])(\d{3,4})x(\d{3,4})(?![0-9])/i.exec(name);
  return d ? snapSize(Number(d[1]), Number(d[2])) : null;
}
/** A file's size from its pixels (image or video), else its name; null when neither says. */
export async function detectFileSize(f: File): Promise<Size | null> {
  const url = URL.createObjectURL(f);
  try {
    const dims = await new Promise<{ w: number; h: number } | null>(resolve => {
      if (f.type.startsWith('video/')) {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => resolve({ w: v.videoWidth, h: v.videoHeight });
        v.onerror = () => resolve(null);
        v.src = url;
      } else {
        const i = new Image();
        i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight });
        i.onerror = () => resolve(null);
        i.src = url;
      }
      setTimeout(() => resolve(null), 5000);
    });
    return (dims && snapSize(dims.w, dims.h)) || sizeFromName(f.name);
  } finally { URL.revokeObjectURL(url); }
}
