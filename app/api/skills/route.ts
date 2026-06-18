import { buildSkills } from "@/lib/skills-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await buildSkills();
    return Response.json(data);
  } catch (err) {
    return Response.json(
      { error: "Failed to read skills", detail: String(err) },
      { status: 500 }
    );
  }
}
