import { getCurrentUser } from "@/lib/auth/session";
import { subscribe } from "@/lib/chat/service";
import { isActiveMember } from "@/lib/groups/service";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events stream of a group's new chat messages.
 * GET /api/groups/:id/events  →  `event: message` with a ChatMessageDTO per message.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!(await isActiveMember(id, user.id))) return new Response("Forbidden", { status: 403 });

  const encoder = new TextEncoder();
  let cleanup: (() => Promise<void>) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Stream already closed.
        }
      };
      const unsubscribe = await subscribe(id, (message) => {
        send(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
      });
      // Comments keep proxies from closing an idle connection.
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      cleanup = async () => {
        clearInterval(heartbeat);
        await unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        void cleanup?.();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
      // Tell the client to retry after 3s if the connection drops.
      send("retry: 3000\n: connected\n\n");
    },
    async cancel() {
      await cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable response buffering in reverse proxies.
      "X-Accel-Buffering": "no",
    },
  });
}
