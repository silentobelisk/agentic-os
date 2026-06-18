import { getSocialBoard, saveHandles } from "@/lib/social";
import type { SocialHandles } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  try {
    return Response.json(await getSocialBoard(refresh));
  } catch (err) {
    return Response.json({ error: "Failed to load social stats", detail: String(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: SocialHandles = {};
  try {
    body = await request.json();
  } catch {
    /* empty */
  }
  const patch: SocialHandles = {};
  for (const k of ["youtube", "instagram", "tiktok"] as const) {
    if (typeof body[k] === "string") patch[k] = body[k]!.slice(0, 200);
  }
  saveHandles(patch);
  // save then refresh the newly-set handles so the board fills immediately
  return Response.json(await getSocialBoard(true));
}
