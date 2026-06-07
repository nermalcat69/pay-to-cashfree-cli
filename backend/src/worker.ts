import { buildApp } from "./app.js";
import { configure, getOrderStatus, isConfigured } from "./cashfree.js";
import type { FastifyInstance } from "fastify";

// ── Fastify singleton (shared across requests in the same isolate) ─────────────

let appReady: Promise<FastifyInstance> | null = null;

function getApp(): Promise<FastifyInstance> {
  if (!appReady) {
    const app = buildApp();
    appReady = app.ready().then(() => app);
  }
  return appReady;
}

// ── Workers env type ───────────────────────────────────────────────────────────

type Env = {
  CASHFREE_APP_ID: string;
  CASHFREE_SECRET_KEY: string;
};

// ── SSE route (TransformStream — app.inject() doesn't support streaming) ──────

const TERMINAL_STATUSES = new Set(["PAID", "EXPIRED", "CANCELLED"]);
const POLL_INTERVAL_MS = 2000;

function handleSSE(id: string): Response {
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  const send = (data: object) =>
    writer.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`));

  (async () => {
    if (!isConfigured() || id.startsWith("DEMO_")) {
      await send({ order_id: id, status: "DEMO", amount: 0, amount_paid: 0 });
      await writer.close();
      return;
    }

    const pollOnce = async (): Promise<boolean> => {
      try {
        const status = await getOrderStatus(id);
        await send(status);
        return TERMINAL_STATUSES.has(status.status);
      } catch {
        return false;
      }
    };

    // Fire immediately, then loop every 2s until terminal status or client drops.
    if (await pollOnce()) { await writer.close(); return; }

    const loop = async () => {
      if (await pollOnce()) { await writer.close(); return; }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      await loop();
    };

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    await loop().catch(() => writer.close());
  })();

  return new Response(readable, {
    headers: {
      "Content-Type":    "text/event-stream",
      "Cache-Control":   "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

// ── Workers fetch handler ──────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Inject Cashfree credentials from Workers env bindings.
    configure(env.CASHFREE_APP_ID ?? "", env.CASHFREE_SECRET_KEY ?? "");

    const url = new URL(request.url);

    // SSE route — handle natively.
    const sseMatch = url.pathname.match(/^\/orders\/([^/]+)\/stream$/);
    if (sseMatch) return handleSSE(sseMatch[1]);

    // All other routes go through Fastify via inject().
    const app = await getApp();
    const body = request.body ? await request.text() : undefined;

    const res = await app.inject({
      method:  request.method as any,
      url:     url.pathname + url.search,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    });

    return new Response(res.body, {
      status:  res.statusCode,
      headers: res.headers as Record<string, string>,
    });
  },
};
