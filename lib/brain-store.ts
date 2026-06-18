import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The "second brain" is now an UPLOAD-managed folder (no path typing): dropped
// notes are written under ~/.nerve-center/brain/, which graphify then reads.

const TEXT_EXT = new Set([".md", ".markdown", ".mdx", ".txt", ".org", ".rst", ".text", ".csv", ".json"]);

export function dataRoot(): string {
  return process.env.NERVE_DATA_DIR || path.join(os.homedir(), ".nerve-center");
}
export function brainDir(): string {
  return path.join(dataRoot(), "brain");
}
// graphify writes ./graphify-out relative to its cwd; we run it with cwd=dataRoot,
// so the graph lands OUTSIDE the input notes folder (no self-ingestion on rebuild).
export function graphOutDir(): string {
  return path.join(dataRoot(), "graphify-out");
}
export function clearGraph(): void {
  try {
    fs.rmSync(graphOutDir(), { recursive: true, force: true });
  } catch {
    /* noop */
  }
}

export interface UploadFile {
  path: string; // relative path within the dropped folder
  content: string;
}

// strip any traversal / absolute components so writes stay inside brainDir
function sanitizeRel(p: string): string {
  return (p || "")
    .split(/[\\/]/)
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .join("/");
}

export function isTextFile(name: string): boolean {
  return TEXT_EXT.has(path.extname(name).toLowerCase());
}

export function saveUpload(files: UploadFile[]): { fileCount: number; bytes: number } {
  const dir = brainDir();
  // a fresh upload replaces the brain (and any stale graph output)
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  let fileCount = 0;
  let bytes = 0;
  for (const f of files) {
    const rel = sanitizeRel(f.path);
    if (!rel || !isTextFile(rel)) continue;
    const dest = path.join(dir, rel);
    if (!dest.startsWith(dir + path.sep)) continue; // belt-and-suspenders
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const content = String(f.content || "");
      fs.writeFileSync(dest, content);
      fileCount += 1;
      bytes += Buffer.byteLength(content);
    } catch {
      /* skip unwritable file */
    }
  }
  return { fileCount, bytes };
}

function countFiles(dir: string, depth = 0): number {
  if (depth > 8) return 0;
  let n = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.name === "graphify-out") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += countFiles(p, depth + 1);
    else if (e.isFile() && isTextFile(e.name)) n += 1;
  }
  return n;
}

export function brainFileCount(): number {
  return countFiles(brainDir());
}

export function hasGraph(): boolean {
  return fs.existsSync(path.join(graphOutDir(), "graph.json"));
}
