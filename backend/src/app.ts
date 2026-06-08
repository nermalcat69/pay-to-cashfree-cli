import Fastify, { type FastifyInstance } from "fastify";
import { products } from "./products.js";
import { cashfreeMode, createOrder, isConfigured } from "./cashfree.js";

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
        session_id:  "",
        payment_url: `https://sandbox.cashfree.com/pg/orders/${orderId}`,
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

  // GET /pay/:order_id — UPI QR web page (Cashfree.js upiQr component)
  app.get<{ Params: { order_id: string }; Querystring: { session_id?: string } }>(
    "/pay/:order_id",
    async (req, reply) => {
      const { order_id } = req.params;
      const { session_id = "" } = req.query;
      const mode = cashfreeMode();

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pay with UPI</title>
  <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#f9fafb;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:20px;padding:24px}
    h2{color:#111827;font-size:1.25rem}
    #qr-container{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.1)}
    #status{color:#6b7280;font-size:.9rem;text-align:center}
    #status.paid{color:#10b981;font-weight:600}
    #status.error{color:#ef4444}
    #order-id{color:#9ca3af;font-size:.75rem;font-family:monospace}
  </style>
</head>
<body>
  <h2>Scan to Pay with UPI</h2>
  <div id="qr-container"></div>
  <p id="status">Loading QR code…</p>
  <p id="order-id">Order: ${order_id}</p>
  <script>
    (async () => {
      const cashfree = Cashfree({ mode: "${mode}" });
      const upiQr = cashfree.create("upiQr", { values: { size: "220px" } });

      upiQr.on("loaderror", function(data) {
        const el = document.getElementById("status");
        el.textContent = "Error loading QR: " + (data.error || "unknown");
        el.className = "error";
      });

      upiQr.mount("#qr-container");

      upiQr.on("ready", function() {
        document.getElementById("status").textContent = "Scan with any UPI app to pay";
        cashfree.pay({
          paymentMethod: upiQr,
          paymentSessionId: "${session_id}",
          returnUrl: window.location.origin + "/pay/${order_id}?paid=1",
        }).then(function(result) {
          const el = document.getElementById("status");
          if (result.error) {
            el.textContent = "Error: " + result.error.message;
            el.className = "error";
            console.error("[cashfree.pay error]", result.error);
          } else if (result.paymentDetails) {
            el.textContent = "✓ " + (result.paymentDetails.paymentMessage || "Payment received!");
            el.className = "paid";
          }
        }).catch(function(err) {
          const el = document.getElementById("status");
          el.textContent = "Error: " + (err.message || err);
          el.className = "error";
          console.error("[cashfree.pay exception]", err);
        });
      });

      // Stream status from backend
      const es = new EventSource("/orders/${order_id}/stream");
      es.onmessage = function(e) {
        const data = JSON.parse(e.data);
        const el = document.getElementById("status");
        if (data.status === "PAID") {
          el.textContent = "✓ Payment received!";
          el.className = "paid";
          es.close();
        } else if (data.status === "EXPIRED" || data.status === "CANCELLED") {
          el.textContent = "Payment " + data.status.toLowerCase() + ". Please try again.";
          el.className = "error";
          es.close();
        }
      };
      es.onerror = function() { es.close(); };
    })();
  </script>
</body>
</html>`;

      reply.type("text/html").send(html);
    }
  );

  return app;
}
