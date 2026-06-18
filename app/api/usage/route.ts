import { aggregateUsage } from "@/lib/transcripts";
import type { Period } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID: Period[] = ["24h", "7d", "30d", "all"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get("period") || "7d") as Period;
  const period: Period = VALID.includes(raw) ? raw : "7d";
  try {
    const data = await aggregateUsage(period);
    return Response.json(data);
  } catch (err) {
    return Response.json(
      { error: "Failed to read usage data", detail: String(err) },
      { status: 500 }
    );
  }
}
