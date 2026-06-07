import Fastify from "fastify";
import { products } from "./products.js";
import { createOrder, getOrderStatus, isConfigured } from "./cashfree.js";

const app = Fastify({ logger: true });

// ── GET /health ───────────────────────────────────────────────────────────────

app.get("/health", async () => {
  return { status: "ok" };
});

// ── GET /products ─────────────────────────────────────────────────────────────

app.get("/products", async () => {
  return products;
});

// ── POST /orders ──────────────────────────────────────────────────────────────

type CreateOrderBody = {
  product_id:    number;
  variant_index: number;
  name:          string;
  phone:         string;
  email:         string;
};

app.post<{ Body: CreateOrderBody }>("/orders", {
  schema: {
    body: {
      type: "object",
      required: ["product_id", "variant_index", "name", "phone", "email"],
      properties: {
        product_id:    { type: "number" },
        variant_index: { type: "number" },
        name:          { type: "string", minLength: 2 },
        phone:         { type: "string", minLength: 10, maxLength: 13 },
        email:         { type: "string" },
      },
    },
  },
}, async (req, reply) => {
  const { product_id, variant_index, name, phone, email } = req.body;

  const product = products.find((p) => p.id === product_id);
  if (!product) {
    return reply.code(400).send({ error: "product not found" });
  }
  if (variant_index < 0 || variant_index >= product.variants.length) {
    return reply.code(400).send({ error: "variant index out of range" });
  }

  const variant = product.variants[variant_index];

  if (!isConfigured()) {
    const orderId = `DEMO_${Date.now()}`;
    return {
      order_id:    orderId,
      payment_url: `https://sandbox.cashfree.com/pg/links/${orderId}`,
      amount:      variant.price_inr,
      is_demo:     true,
    };
  }

  try {
    const order = await createOrder({
      amount:  variant.price_inr,
      name,
      phone,
      email,
      purpose: `${product.name} — ${variant.label}`,
    });
    return order;
  } catch (err: any) {
    req.log.error(err.message);
    return reply.code(502).send({ error: "payment gateway error" });
  }
});

// ── GET /orders/:id ───────────────────────────────────────────────────────────

app.get<{ Params: { id: string } }>("/orders/:id", async (req, reply) => {
  const { id } = req.params;

  if (!isConfigured() || id.startsWith("DEMO_")) {
    return { order_id: id, status: "DEMO", amount: 0, amount_paid: 0 };
  }

  try {
    return await getOrderStatus(id);
  } catch (err: any) {
    req.log.error(err.message);
    return reply.code(502).send({ error: "payment gateway error" });
  }
});

// ── GET /orders/:id/stream — SSE, polls Cashfree every 2s ────────────────────

const TERMINAL_STATUSES = new Set(["PAID", "EXPIRED", "CANCELLED"]);
const POLL_INTERVAL_MS = 2000;

app.get<{ Params: { id: string } }>("/orders/:id/stream", async (req, reply) => {
  const { id } = req.params;

  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  reply.raw.flushHeaders();

  const send = (data: object) => {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (!isConfigured() || id.startsWith("DEMO_")) {
    send({ order_id: id, status: "DEMO", amount: 0, amount_paid: 0 });
    reply.raw.end();
    return reply;
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stop = () => {
    if (timer) clearInterval(timer);
    closed = true;
  };

  req.raw.on("close", stop);

  const poll = async () => {
    if (closed) return;
    try {
      const status = await getOrderStatus(id);
      if (!closed) {
        send(status);
        if (TERMINAL_STATUSES.has(status.status)) {
          stop();
          reply.raw.end();
        }
      }
    } catch {
      // transient error — keep polling
    }
  };

  await poll();
  if (!closed) {
    timer = setInterval(poll, POLL_INTERVAL_MS);
  }

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
