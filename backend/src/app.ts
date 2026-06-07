import Fastify, { type FastifyInstance } from "fastify";
import { products } from "./products.js";
import { createOrder, isConfigured } from "./cashfree.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  // GET /health
  app.get("/health", async () => ({ status: "ok" }));

  // GET /products
  app.get("/products", async () => products);

  // POST /orders
  type CreateOrderBody = {
    product_id: number;
    variant_index: number;
    name: string;
    phone: string;
    email: string;
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
    if (!product) return reply.code(400).send({ error: "product not found" });
    if (variant_index < 0 || variant_index >= product.variants.length)
      return reply.code(400).send({ error: "variant index out of range" });

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
      return await createOrder({
        amount:  variant.price_inr,
        name, phone, email,
        purpose: `${product.name} — ${variant.label}`,
      });
    } catch (err: any) {
      req.log.error(err.message);
      return reply.code(502).send({ error: "payment gateway error" });
    }
  });

  // GET /orders/:id  (one-shot status check)
  app.get<{ Params: { id: string } }>("/orders/:id", async (req, reply) => {
    const { id } = req.params;
    if (!isConfigured() || id.startsWith("DEMO_"))
      return { order_id: id, status: "DEMO", amount: 0, amount_paid: 0 };

    const { getOrderStatus } = await import("./cashfree.js");
    try {
      return await getOrderStatus(id);
    } catch (err: any) {
      req.log.error(err.message);
      return reply.code(502).send({ error: "payment gateway error" });
    }
  });

  return app;
}
