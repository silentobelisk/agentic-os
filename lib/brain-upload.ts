// Client-safe helpers for turning a dropped or picked folder into an upload
// payload for POST /api/brain. These use only browser APIs (File, the
// webkitGetAsEntry directory tree) — no node:fs — so they are shared by both
// the Profile panel and the first-run onboarding wizard.

export const TEXT_RE = /\.(md|markdown|mdx|txt|org|rst|text|csv|json)$/i;

// A dropped folder entry from DataTransferItem.webkitGetAsEntry().
export interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  fullPath?: string;
  file?: (cb: (f: File) => void, err?: () => void) => void;
  createReader?: () => { readEntries: (cb: (e: FsEntry[]) => void, err?: () => void) => void };
}

// Recurse a dropped folder entry into a flat file list (with relative paths).
export function entryToFiles(entry: FsEntry): Promise<{ file: File; path: string }[]> {
  return new Promise((resolve) => {
    if (entry.isFile && entry.file) {
      entry.file(
        (f) => resolve([{ file: f, path: (entry.fullPath || "/" + f.name).replace(/^\//, "") }]),
        () => resolve([])
      );
    } else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      const acc: FsEntry[] = [];
      const readBatch = () =>
        reader.readEntries(async (ents) => {
          if (!ents.length) {
            const nested = await Promise.all(acc.map((e) => entryToFiles(e)));
            resolve(nested.flat());
          } else {
            acc.push(...ents);
            readBatch();
          }
        }, () => resolve([]));
      readBatch();
    } else resolve([]);
  });
}

// Filter to supported text notes and cap size, producing the { path, content }
// payload the /api/brain route expects.
export async function toPayload(files: { file: File; path: string }[]): Promise<{ path: string; content: string }[]> {
  const out: { path: string; content: string }[] = [];
  let bytes = 0;
  for (const { file, path } of files) {
    if (!TEXT_RE.test(path) || file.size > 1_000_000) continue;
    if (out.length >= 2000 || bytes > 24_000_000) break;
    try {
      const content = await file.text();
      out.push({ path, content });
      bytes += content.length;
    } catch {
      /* skip */
    }
  }
  return out;
}

// Initials for an operator avatar tile: "Ada Lovelace" → "AL", "Ada" → "AD".
export function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "—";
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}
