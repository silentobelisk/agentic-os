import { getIndustry } from "@/lib/industry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    const data = await getIndustry(force);
    return Response.json(data);
  } catch (err) {
    return Response.json(
      { cards: [], online: false, generatedAt: Date.now(), note: String(err) },
      { status: 200 }
    );
  }
}
