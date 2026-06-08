const SANDBOX_URL = "https://sandbox.cashfree.com/pg";
const PROD_URL = "https://api.cashfree.com/pg";
const API_VERSION = "2025-01-01";

let _appId = "";
let _secretKey = "";
let _mode: "sandbox" | "production" | "" = "";

export function configure(appId: string, secretKey: string, mode?: "sandbox" | "production") {
  _appId = appId;
  _secretKey = secretKey;
  if (mode) _mode = mode;
}

function creds() {
  const appId = _appId || process.env.CASHFREE_APP_ID || "";
  const secretKey = _secretKey || process.env.CASHFREE_SECRET_KEY || "";
  return { appId, secretKey };
}

export function cashfreeMode(): "sandbox" | "production" {
  if (_mode) return _mode;
  return process.env.CASHFREE_MODE === "production" ? "production" : "sandbox";
}

function baseUrl() {
  return cashfreeMode() === "production" ? PROD_URL : SANDBOX_URL;
}

function headers() {
  const { appId, secretKey } = creds();
  return {
    "x-client-id": appId,
    "x-client-secret": secretKey,
    "x-api-version": API_VERSION,
    "Content-Type": "application/json",
  };
}

export type OrderResult = {
  order_id: string;
  session_id: string;
  payment_url: string;
  amount: number;
  is_demo: boolean;
};

export type OrderStatus = {
  order_id: string;
  status: string;
  amount: number;
  amount_paid: number;
};

export async function createOrder(params: {
  amount: number;
  name: string;
  phone: string;
  email: string;
  purpose: string;
}): Promise<OrderResult> {
  const res = await fetch(`${baseUrl()}/orders`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      order_amount: params.amount,
      order_currency: "INR",
      customer_details: {
        customer_id: `cust_${Date.now()}`,
        customer_name: params.name,
        customer_phone: params.phone,
        customer_email: params.email,
      },
      order_meta: {
        return_url: `https://cashfree.com/payment-result?order_id={order_id}`,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cashfree API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  return {
    order_id: data.order_id,
    session_id: data.payment_session_id,
    payment_url: `https://payments.cashfree.com/order/#${data.payment_session_id}`,
    amount: params.amount,
    is_demo: false,
  };
}

export async function getOrderStatus(orderId: string): Promise<OrderStatus> {
  const res = await fetch(`${baseUrl()}/orders/${orderId}`, {
    headers: headers(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cashfree API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  // Orders API uses TERMINATED; normalise to CANCELLED for consistency
  const status = data.order_status === "TERMINATED" ? "CANCELLED" : data.order_status;
  return {
    order_id: data.order_id,
    status,
    amount: data.order_amount,
    amount_paid: status === "PAID" ? data.order_amount : 0,
  };
}

export function isConfigured(): boolean {
  const { appId, secretKey } = creds();
  return !!(appId && secretKey);
}
