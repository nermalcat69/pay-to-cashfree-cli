import { buildApp } from "./app.js";
import { getOrderStatus, isConfigured } from "./cashfree.js";

const app = buildApp();

// ── GET /orders/:id/stream — SSE, polls Cashfree every 2s ────────────────────
// Kept here (not in app.ts) because Fastify's reply.raw streaming
// doesn't survive app.inject() used in the Workers entry.

const TERMINAL_STATUSES = new Set(["PAID", "EXPIRED", "CANCELLED"]);
const POLL_INTERVAL_MS = 2000;

app.get<{ Params: { id: string } }>("/orders/:id/stream", async (req, reply) => {
  const { id } = req.params;

  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  reply.raw.flushHeaders();

  const send = (data: object) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);

  if (!isConfigured() || id.startsWith("DEMO_")) {
    send({ order_id: id, status: "DEMO", amount: 0, amount_paid: 0 });
    reply.raw.end();
    return reply;
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stop = () => { if (timer) clearInterval(timer); closed = true; };
  req.raw.on("close", stop);

  const poll = async () => {
    if (closed) return;
    try {
      const status = await getOrderStatus(id);
      if (!closed) {
        send(status);
        if (TERMINAL_STATUSES.has(status.status)) { stop(); reply.raw.end(); }
      }
    } catch { /* transient — keep polling */ }
  };

  await poll();
  if (!closed) timer = setInterval(poll, POLL_INTERVAL_MS);

  await new Promise<void>((resolve) => req.raw.on("close", resolve));
  return reply;
});

// ── start ─────────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 8080);
try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
