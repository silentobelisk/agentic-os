import { computePlanUsage } from "@/lib/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await computePlanUsage();
    return Response.json(data);
  } catch (err) {
    return Response.json(
      { error: "Failed to read plan usage", detail: String(err) },
      { status: 500 }
    );
  }
}
