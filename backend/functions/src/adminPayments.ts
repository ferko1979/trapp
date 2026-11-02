import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { writeAuditLog } from "./adminAuditLog";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function asBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

const SETTINGS = { col: "payment_settings", doc: "stripe" };

// ─── adminGetPaymentSettings ──────────────────────────────────────────────────

export const adminGetPaymentSettings = onCall(async (request) => {
  requireAdmin(request);

  const db = getDb();
  const snap = await db.collection(SETTINGS.col).doc(SETTINGS.doc).get();
  const d = snap.data() ?? {};

  const sk = asString(d.secretKey);
  const wh = asString(d.webhookSecret);

  return {
    ok: true,
    settings: {
      enabled: asBoolean(d.enabled, false),
      publishableKey: asString(d.publishableKey),
      // Mask secret keys — show last 4 chars only
      secretKeyMasked: sk ? `sk_••••••••${sk.slice(-4)}` : "",
      webhookSecretMasked: wh ? `whsec_••••••••` : "",
      hasSecretKey: sk.length > 0,
      hasWebhookSecret: wh.length > 0,
      isTestMode: sk.startsWith("sk_test"),
      currency: asString(d.currency, "EUR"),
      successUrl: asString(d.successUrl),
      cancelUrl: asString(d.cancelUrl),
      allowGooglePay: asBoolean(d.allowGooglePay, true),
      allowApplePay: asBoolean(d.allowApplePay, true),
      updatedAtMs:
        d.updatedAt instanceof Timestamp ? d.updatedAt.toMillis() : null,
      updatedByUid: asString(d.updatedByUid) || null,
    },
  };
});

// ─── adminUpdatePaymentSettings ───────────────────────────────────────────────

export const adminUpdatePaymentSettings = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const db = getDb();
  const update: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedByUid: adminUid,
  };

  if ("enabled" in data) update.enabled = asBoolean(data.enabled, false);
  if ("publishableKey" in data)
    update.publishableKey = asString(data.publishableKey).trim();
  if ("currency" in data)
    update.currency = asString(data.currency, "EUR").toUpperCase();
  if ("successUrl" in data)
    update.successUrl = asString(data.successUrl).trim();
  if ("cancelUrl" in data)
    update.cancelUrl = asString(data.cancelUrl).trim();
  if ("allowGooglePay" in data)
    update.allowGooglePay = asBoolean(data.allowGooglePay, true);
  if ("allowApplePay" in data)
    update.allowApplePay = asBoolean(data.allowApplePay, true);

  // Secret fields: only write if a real (non-masked) value is provided
  const newSk = asString(data.secretKey).trim();
  if (newSk && !newSk.startsWith("sk_••")) update.secretKey = newSk;

  const newWh = asString(data.webhookSecret).trim();
  if (newWh && !newWh.startsWith("whsec_••")) update.webhookSecret = newWh;

  await db.collection(SETTINGS.col).doc(SETTINGS.doc).set(update, { merge: true });

  void writeAuditLog({
    adminUid,
    category: "other",
    action: "UPDATE_PAYMENT_SETTINGS",
    summary: `Updated Stripe payment settings`,
    details: {
      enabled: update.enabled,
      currency: update.currency,
      changedKeys: Object.keys(update).filter(
        (k) => !["updatedAt", "updatedByUid"].includes(k)
      ),
    },
  });

  return { ok: true };
});

// ─── adminGetPaymentHistory ───────────────────────────────────────────────────

export const adminGetPaymentHistory = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const limitN =
    typeof data.limit === "number" ? Math.min(data.limit, 200) : 100;
  const statusFilter = asString(data.status);
  const uidFilter = asString(data.uid);

  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = db.collection("payments").orderBy("createdAt", "desc");
  if (statusFilter) query = query.where("status", "==", statusFilter);
  if (uidFilter) query = query.where("uid", "==", uidFilter);
  query = query.limit(limitN);

  const snap = await query.get();

  const items = snap.docs.map(
    (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
      const d = doc.data();
      return {
        id: doc.id,
        uid: d.uid ?? null,
        email: d.email ?? null,
        levelId: d.levelId ?? null,
        levelName: d.levelName ?? null,
        amount: typeof d.amount === "number" ? d.amount : 0,
        currency: asString(d.currency, "EUR"),
        paymentType: asString(d.paymentType, "one_time"),
        status: asString(d.status, "pending"),
        isRenewal: d.isRenewal === true,
        stripeSessionId: d.stripeSessionId ?? null,
        stripePaymentIntentId: d.stripePaymentIntentId ?? null,
        stripeSubscriptionId: d.stripeSubscriptionId ?? null,
        createdAtMs:
          d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : null,
        updatedAtMs:
          d.updatedAt instanceof Timestamp ? d.updatedAt.toMillis() : null,
      };
    }
  );

  // Compute simple stats from these results
  type PayItem = typeof items[number];
  const totalRevenue = items
    .filter((i: PayItem) => i.status === "completed")
    .reduce((sum: number, i: PayItem) => sum + i.amount, 0);

  const activeSubscriptions = new Set(
    items
      .filter((i: PayItem) => i.status === "completed" && i.paymentType === "recurring")
      .map((i: PayItem) => i.uid)
  ).size;

  return {
    ok: true,
    items,
    stats: {
      total: items.length,
      completed: items.filter((i: PayItem) => i.status === "completed").length,
      pending: items.filter((i: PayItem) => i.status === "pending").length,
      failed: items.filter((i: PayItem) => i.status === "failed").length,
      totalRevenue,
      activeSubscriptions,
      currency: items[0]?.currency ?? "EUR",
    },
  };
});

// ─── adminRefundPayment ───────────────────────────────────────────────────────
// Issues a refund via Stripe for a completed payment record.

// ─── adminGetRevolutSettings ──────────────────────────────────────────────────

const REVOLUT = { col: "payment_settings", doc: "revolut" };

export const adminGetRevolutSettings = onCall(async (request) => {
  requireAdmin(request);
  const db = getDb();
  const snap = await db.collection(REVOLUT.col).doc(REVOLUT.doc).get();
  const d = snap.data() ?? {};

  const sk = asString(d.secretKey);
  const wh = asString(d.webhookSecret);

  return {
    ok: true,
    settings: {
      enabled: asBoolean(d.enabled, false),
      sandboxMode: asBoolean(d.sandboxMode, true),
      secretKeyMasked: sk ? `sk_••••••••${sk.slice(-4)}` : "",
      webhookSecretMasked: wh ? `whsec_••••••••` : "",
      hasSecretKey: sk.length > 0,
      hasWebhookSecret: wh.length > 0,
      currency: asString(d.currency, "EUR"),
      successUrl: asString(d.successUrl),
      cancelUrl: asString(d.cancelUrl),
      updatedAtMs:
        d.updatedAt instanceof Timestamp ? d.updatedAt.toMillis() : null,
      updatedByUid: asString(d.updatedByUid) || null,
    },
  };
});

// ─── adminUpdateRevolutSettings ───────────────────────────────────────────────

export const adminUpdateRevolutSettings = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const db = getDb();
  const update: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedByUid: adminUid,
  };

  if ("enabled" in data)     update.enabled     = asBoolean(data.enabled, false);
  if ("sandboxMode" in data) update.sandboxMode  = asBoolean(data.sandboxMode, true);
  if ("currency" in data)    update.currency     = asString(data.currency, "EUR").toUpperCase();
  if ("successUrl" in data)  update.successUrl   = asString(data.successUrl).trim();
  if ("cancelUrl" in data)   update.cancelUrl    = asString(data.cancelUrl).trim();

  const newSk = asString(data.secretKey).trim();
  if (newSk && !newSk.includes("••")) update.secretKey = newSk;

  const newWh = asString(data.webhookSecret).trim();
  if (newWh && !newWh.includes("••")) update.webhookSecret = newWh;

  await db.collection(REVOLUT.col).doc(REVOLUT.doc).set(update, { merge: true });

  void writeAuditLog({
    adminUid,
    category: "other",
    action: "UPDATE_REVOLUT_SETTINGS",
    summary: `Updated Revolut payment settings`,
    details: {
      enabled: update.enabled,
      sandboxMode: update.sandboxMode,
      currency: update.currency,
      changedKeys: Object.keys(update).filter(
        (k) => !["updatedAt", "updatedByUid"].includes(k)
      ),
    },
  });

  return { ok: true };
});

// ─── adminRefundRevolutPayment ────────────────────────────────────────────────

export const adminRefundRevolutPayment = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const paymentId = asString(data.paymentId).trim();
  if (!paymentId) throw new HttpsError("invalid-argument", "paymentId is required.");

  const db = getDb();
  const paySnap = await db.collection("payments").doc(paymentId).get();
  if (!paySnap.exists) throw new HttpsError("not-found", "Payment record not found.");

  const payment = paySnap.data()!;
  if (payment.gateway !== "revolut") {
    throw new HttpsError("failed-precondition", "This payment is not a Revolut payment.");
  }
  if (payment.status !== "completed") {
    throw new HttpsError("failed-precondition", "Only completed payments can be refunded.");
  }

  const { loadRevolutSettings, refundRevolutOrder } = await import("./revolut/api.js");
  const settings = await loadRevolutSettings();
  if (!settings?.secretKey) {
    throw new HttpsError("failed-precondition", "Revolut is not configured.");
  }

  const orderId = asString(payment.revolutOrderId);
  if (!orderId) throw new HttpsError("failed-precondition", "No Revolut order ID found.");

  await refundRevolutOrder(settings, orderId);

  await db.collection("payments").doc(paymentId).set(
    { status: "refunded", updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  void writeAuditLog({
    adminUid,
    category: "other",
    action: "REVOLUT_REFUND_PAYMENT",
    targetId: payment.uid ?? null,
    summary: `Refunded Revolut payment ${paymentId} (${payment.amount} ${payment.currency})`,
    details: { paymentId, orderId, amount: payment.amount, currency: payment.currency },
  });

  return { ok: true, refunded: true };
});

// ─── adminRefundPayment ───────────────────────────────────────────────────────
// Issues a refund via Stripe for a completed payment record.

export const adminRefundPayment = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const paymentId = asString(data.paymentId).trim();

  if (!paymentId)
    throw new HttpsError("invalid-argument", "paymentId is required.");

  const db = getDb();
  const paymentSnap = await db.collection("payments").doc(paymentId).get();
  if (!paymentSnap.exists)
    throw new HttpsError("not-found", "Payment record not found.");

  const payment = paymentSnap.data()!;
  if (payment.status !== "completed")
    throw new HttpsError("failed-precondition", "Only completed payments can be refunded.");

  // Load Stripe
  const settingsSnap = await db.collection(SETTINGS.col).doc(SETTINGS.doc).get();
  const secretKey = asString(settingsSnap.data()?.secretKey);
  if (!secretKey)
    throw new HttpsError("failed-precondition", "Stripe is not configured.");

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(secretKey);

  const paymentIntentId = asString(payment.stripePaymentIntentId);
  if (!paymentIntentId)
    throw new HttpsError(
      "failed-precondition",
      "No payment intent found for this payment (subscription renewals cannot be refunded here)."
    );

  await stripe.refunds.create({ payment_intent: paymentIntentId });

  await db.collection("payments").doc(paymentId).set(
    { status: "refunded", updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  void writeAuditLog({
    adminUid,
    category: "other",
    action: "REFUND_PAYMENT",
    targetId: payment.uid ?? null,
    summary: `Refunded payment ${paymentId} (${payment.amount} ${payment.currency})`,
    details: { paymentId, amount: payment.amount, currency: payment.currency },
  });

  return { ok: true, refunded: true };
});

// ─── Shared Revolut API helpers ───────────────────────────────────────────────

const REVOLUT_WEBHOOK_ENDPOINT = "https://europe-west1-playtrapnow.cloudfunctions.net/revolutWebhook";
const REVOLUT_WEBHOOK_EVENTS   = ["ORDER_COMPLETED", "ORDER_PAYMENT_DECLINED", "ORDER_PAYMENT_FAILED"];

type RevolutWebhook = { id: string; url: string; events: string[]; signing_secret?: string };

function revolutBaseUrl(sandboxMode: boolean): string {
  return sandboxMode
    ? "https://sandbox-merchant.revolut.com/api/1.0"
    : "https://merchant.revolut.com/api/1.0";
}

function revolutAuthHint(status: number, sandboxMode: boolean): string {
  if (status === 401) {
    return sandboxMode
      ? "401 Unauthorized — your API key is a PRODUCTION key but Sandbox mode is enabled. Either disable Sandbox mode or use a sandbox API key (sk_sandbox_…)."
      : "401 Unauthorized — your API key may be invalid or expired. Please check your key in Revolut Business → Settings → APIs → Merchant API.";
  }
  return `HTTP ${status} error from Revolut API.`;
}

async function revolutFetch(url: string, key: string, opts?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
}

// ─── adminRegisterRevolutWebhook ──────────────────────────────────────────────

export const adminRegisterRevolutWebhook = onCall(async (request) => {
  const adminUid = requireAdmin(request);

  const { loadRevolutSettings } = await import("./revolut/api.js");
  const settings = await loadRevolutSettings();

  if (!settings?.secretKey) {
    throw new HttpsError("failed-precondition", "Revolut Secret Key is not configured. Save your API key first.");
  }

  const base = revolutBaseUrl(settings.sandboxMode);

  // List existing webhooks to avoid duplicates
  const listRes = await revolutFetch(`${base}/webhooks`, settings.secretKey);
  if (!listRes.ok) {
    throw new HttpsError("internal", revolutAuthHint(listRes.status, settings.sandboxMode));
  }

  const existing = await listRes.json() as RevolutWebhook[];
  const already = existing.find((w) => w.url === REVOLUT_WEBHOOK_ENDPOINT);

  if (already) {
    return {
      ok: true, alreadyRegistered: true,
      webhookId: already.id, url: already.url, events: already.events,
      message: "Webhook already registered with Revolut — no changes needed.",
    };
  }

  // Register new webhook
  const createRes = await revolutFetch(`${base}/webhooks`, settings.secretKey, {
    method: "POST",
    body: JSON.stringify({ url: REVOLUT_WEBHOOK_ENDPOINT, events: REVOLUT_WEBHOOK_EVENTS }),
  });
  if (!createRes.ok) {
    throw new HttpsError("internal", `Failed to create webhook: ${revolutAuthHint(createRes.status, settings.sandboxMode)}`);
  }

  const created = await createRes.json() as { id: string; url: string; signing_secret: string; events: string[] };

  // Auto-save signing secret to Firestore
  if (created.signing_secret) {
    await getDb().collection("payment_settings").doc("revolut").set(
      { webhookSecret: created.signing_secret, updatedAt: Timestamp.now(), updatedByUid: adminUid },
      { merge: true }
    );
  }

  void writeAuditLog({
    adminUid, category: "other", action: "REGISTER_REVOLUT_WEBHOOK",
    summary: `Registered Revolut webhook (id: ${created.id})`,
    details: { webhookId: created.id, url: created.url, events: created.events, sandboxMode: settings.sandboxMode },
  });

  return {
    ok: true, alreadyRegistered: false,
    webhookId: created.id, url: created.url, events: created.events,
    signingSecretSaved: !!created.signing_secret,
    message: "Webhook registered. Signing secret saved automatically.",
  };
});

// ─── adminCheckRevolutWebhooks ────────────────────────────────────────────────
// Lists all webhooks currently registered with Revolut and checks if ours is present.

export const adminCheckRevolutWebhooks = onCall(async (request) => {
  requireAdmin(request);

  const { loadRevolutSettings } = await import("./revolut/api.js");
  const settings = await loadRevolutSettings();

  if (!settings?.secretKey) {
    throw new HttpsError("failed-precondition", "Revolut Secret Key is not configured.");
  }

  const base = revolutBaseUrl(settings.sandboxMode);
  const listRes = await revolutFetch(`${base}/webhooks`, settings.secretKey);

  if (!listRes.ok) {
    throw new HttpsError("internal", revolutAuthHint(listRes.status, settings.sandboxMode));
  }

  const webhooks = await listRes.json() as RevolutWebhook[];
  const ours = webhooks.find((w) => w.url === REVOLUT_WEBHOOK_ENDPOINT);

  return {
    ok: true,
    sandboxMode: settings.sandboxMode,
    hasSecretKey: !!settings.secretKey,
    hasWebhookSecret: !!settings.webhookSecret,
    webhooks: webhooks.map((w) => ({
      id: w.id,
      url: w.url,
      events: w.events,
      isOurs: w.url === REVOLUT_WEBHOOK_ENDPOINT,
    })),
    ourWebhookRegistered: !!ours,
    ourWebhookId: ours?.id ?? null,
    ourWebhookEvents: ours?.events ?? [],
    signingSecretConfigured: !!settings.webhookSecret,
    environment: settings.sandboxMode ? "sandbox" : "production",
  };
});
