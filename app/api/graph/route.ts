import { parseGraph } from "@/lib/graphify";
import { hasGraph } from "@/lib/brain-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasGraph()) return Response.json({ ready: false });
  const graph = parseGraph();
  if (!graph) return Response.json({ ready: false, error: "Graph output unreadable" });
  return Response.json({ ready: true, graph });
}
