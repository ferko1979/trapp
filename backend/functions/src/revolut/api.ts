import { createHmac } from "crypto";
import { getDb } from "../shared/firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RevolutOrder {
  id: string;
  token: string;
  public_id: string;
  state: "PENDING" | "PROCESSING" | "AUTHORISED" | "COMPLETED" | "CANCELLED" | "FAILED";
  created_at: string;
  updated_at: string;
  amount: number;
  currency: string;
  merchant_order_ext_ref?: string;
}

export interface RevolutSettings {
  enabled: boolean;
  secretKey: string;
  webhookSecret: string;
  sandboxMode: boolean;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  updatedAt?: FirebaseFirestore.Timestamp;
  updatedByUid?: string;
}

// ─── Config loader ────────────────────────────────────────────────────────────

export async function loadRevolutSettings(): Promise<RevolutSettings | null> {
  const db = getDb();
  const snap = await db.collection("payment_settings").doc("revolut").get();
  if (!snap.exists) return null;
  return snap.data() as RevolutSettings;
}

function getBaseUrl(sandboxMode: boolean): string {
  return sandboxMode
    ? "https://sandbox-merchant.revolut.com/api"
    : "https://merchant.revolut.com/api";
}

// ─── Create order ─────────────────────────────────────────────────────────────

export interface CreateOrderParams {
  amount: number;     // in minor currency units (e.g. 999 = €9.99)
  currency: string;
  extRef: string;     // our internal reference (subscriptionId or preflight key)
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export async function createRevolutOrder(
  settings: RevolutSettings,
  params: CreateOrderParams
): Promise<RevolutOrder> {
  const baseUrl = getBaseUrl(settings.sandboxMode);
  const res = await fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: params.amount,
      currency: params.currency,
      capture_mode: "AUTOMATIC",
      merchant_order_ext_ref: params.extRef,
      description: params.description,
      customer_email: params.customerEmail,
      redirect_url: params.successUrl,
      cancel_redirect_url: params.cancelUrl,
      enforce_challenge: "AUTOMATIC",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Revolut API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<RevolutOrder>;
}

// ─── Get order ────────────────────────────────────────────────────────────────

export async function getRevolutOrder(
  settings: RevolutSettings,
  orderId: string
): Promise<RevolutOrder> {
  const baseUrl = getBaseUrl(settings.sandboxMode);
  const res = await fetch(`${baseUrl}/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${settings.secretKey}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Revolut API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<RevolutOrder>;
}

// ─── Refund order ─────────────────────────────────────────────────────────────

export async function refundRevolutOrder(
  settings: RevolutSettings,
  orderId: string,
  amount?: number
): Promise<void> {
  const baseUrl = getBaseUrl(settings.sandboxMode);
  const body = amount ? JSON.stringify({ amount }) : "{}";
  const res = await fetch(`${baseUrl}/orders/${orderId}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.secretKey}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Revolut refund error ${res.status}: ${text}`);
  }
}

// ─── Checkout URL ─────────────────────────────────────────────────────────────

export function buildCheckoutUrl(settings: RevolutSettings, orderToken: string): string {
  if (settings.sandboxMode) {
    return `https://sandbox-merchant.revolut.com/payment/${orderToken}`;
  }
  return `https://merchant.revolut.com/payment/${orderToken}`;
}

// ─── Webhook signature verification ──────────────────────────────────────────

/**
 * Revolut sends: Revolut-Signature: t=<timestamp>,v1=<hex_hmac>
 * Signed payload: "<timestamp>.<rawBody>"
 * HMAC algorithm: SHA-256 with webhook secret
 */
export function verifyRevolutWebhook(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string
): boolean {
  try {
    const parts: Record<string, string> = {};
    for (const part of signatureHeader.split(",")) {
      const [k, v] = part.split("=");
      if (k && v) parts[k.trim()] = v.trim();
    }
    const timestamp = parts["t"];
    const receivedSig = parts["v1"];
    if (!timestamp || !receivedSig) return false;

    const signedPayload = `${timestamp}.${rawBody}`;
    const expected = createHmac("sha256", webhookSecret)
      .update(signedPayload)
      .digest("hex");

    return expected === receivedSig;
  } catch {
    return false;
  }
}
