const BASE_URL = "https://sandbox.cashfree.com/pg";
const API_VERSION = "2025-01-01";

export type OrderResult = {
  order_id: string;
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

function headers() {
  return {
    "x-client-id": process.env.CASHFREE_APP_ID!,
    "x-client-secret": process.env.CASHFREE_SECRET_KEY!,
    "x-api-version": API_VERSION,
    "Content-Type": "application/json",
  };
}

export async function createOrder(params: {
  amount: number;
  name: string;
  phone: string;
  email: string;
  purpose: string;
}): Promise<OrderResult> {
  const linkId = `order_${Date.now()}`;

  const res = await fetch(`${BASE_URL}/links`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      link_id: linkId,
      link_amount: params.amount,
      link_currency: "INR",
      link_purpose: params.purpose,
      customer_details: {
        customer_name: params.name,
        customer_phone: params.phone,
        customer_email: params.email,
      },
      link_notify: { send_sms: false, send_email: false },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cashfree API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  return {
    order_id: data.link_id,
    payment_url: data.link_url,
    amount: params.amount,
    is_demo: false,
  };
}

export async function getOrderStatus(linkId: string): Promise<OrderStatus> {
  const res = await fetch(`${BASE_URL}/links/${linkId}`, {
    headers: headers(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cashfree API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  return {
    order_id: data.link_id,
    status: data.link_status,
    amount: data.link_amount,
    amount_paid: data.link_amount_paid ?? 0,
  };
}

export function isConfigured(): boolean {
  return !!(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);
}
