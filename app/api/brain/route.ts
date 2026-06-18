import { saveUpload, brainFileCount, hasGraph, brainDir, type UploadFile } from "@/lib/brain-store";
import { mergeProfile } from "@/lib/profile-store";
import { graphifyJob } from "@/lib/graphify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 2000;
const MAX_BYTES = 25 * 1024 * 1024; // 25MB of notes is plenty for text

export async function GET() {
  return Response.json({
    fileCount: brainFileCount(),
    hasGraph: hasGraph(),
    building: graphifyJob().status === "running",
  });
}

export async function POST(request: Request) {
  let body: { files?: UploadFile[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) return Response.json({ ok: false, error: "No files" }, { status: 400 });
  if (files.length > MAX_FILES)
    return Response.json({ ok: false, error: `Too many files (max ${MAX_FILES})` }, { status: 413 });
  const totalBytes = files.reduce((n, f) => n + (typeof f.content === "string" ? f.content.length : 0), 0);
  if (totalBytes > MAX_BYTES)
    return Response.json({ ok: false, error: "Upload too large (max 25MB of text)" }, { status: 413 });

  const { fileCount, bytes } = saveUpload(files);
  if (!fileCount) return Response.json({ ok: false, error: "No supported notes found in upload" }, { status: 400 });

  // keep the profile's brainPath pointed at the managed folder
  mergeProfile({ brainPath: brainDir() });

  return Response.json({ ok: true, fileCount, bytes, hasGraph: hasGraph() });
}
