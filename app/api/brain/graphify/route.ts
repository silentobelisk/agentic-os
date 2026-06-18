import { startGraphify, cancelGraphify, graphifyJob } from "@/lib/graphify";
import { brainFileCount } from "@/lib/brain-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { cancel?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    /* empty */
  }
  if (body.cancel) {
    cancelGraphify();
    return Response.json({ ok: true, status: graphifyJob().status });
  }
  if (brainFileCount() === 0) {
    return Response.json({ ok: false, error: "No notes uploaded yet" }, { status: 400 });
  }
  const r = startGraphify();
  return Response.json({ ok: true, ...r });
}

// SSE: observe the build (never kills it on disconnect)
export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let cursor = 0;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* closed */
        }
      };
      const tick = () => {
        const j = graphifyJob();
        const fresh = j.log.slice(cursor);
        cursor = j.log.length;
        send({ status: j.status, lines: fresh, error: j.error });
        if (j.status !== "running") {
          clearInterval(timer);
          send({ status: j.status, done: true, error: j.error });
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              /* noop */
            }
          }
        }
      };
      const timer = setInterval(tick, 700);
      tick();
      request.signal.addEventListener("abort", () => {
        clearInterval(timer);
        closed = true;
        try {
          controller.close();
        } catch {
          /* noop */
        }
      });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
