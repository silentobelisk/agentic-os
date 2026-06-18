import { mergeProfile, toResponse } from "@/lib/profile-store";
import { readBrainDigest, deterministicCards, synthesizeCards } from "@/lib/brain";
import type { ProfileCard } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { name?: unknown; bio?: unknown; brainPath?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body */
  }

  const name = typeof body.name === "string" ? body.name.slice(0, 80) : undefined;
  const bio = typeof body.bio === "string" ? body.bio.slice(0, 240) : undefined;
  const brainPath = typeof body.brainPath === "string" ? body.brainPath.slice(0, 1000) : "";

  // persist the latest inputs regardless of analysis outcome
  mergeProfile({
    ...(name !== undefined ? { name } : {}),
    ...(bio !== undefined ? { bio } : {}),
    brainPath,
  });

  const digest = readBrainDigest(brainPath);
  if (!digest.ok) {
    return Response.json({ ...toResponse({ name, bio, brainPath }), error: digest.error });
  }

  let cards: ProfileCard[];
  let source: "ai" | "stats";
  try {
    cards = await synthesizeCards(digest, name || "", bio || "");
    source = "ai";
  } catch {
    // model unavailable / timed out / bad output — still give something real
    cards = deterministicCards(digest);
    source = "stats";
  }

  const stored = mergeProfile({
    cards,
    source,
    fileCount: digest.fileCount,
    analyzedAt: Date.now(),
  });

  return Response.json(toResponse(stored));
}
