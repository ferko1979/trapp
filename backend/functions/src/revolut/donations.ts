import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "../shared/firebase";
import { requireUser } from "../shared/appCheck";
import { requireAdmin } from "../shared/admin";
import { loadRevolutSettings, createRevolutOrder, buildCheckoutUrl } from "./api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

const SUGGESTED_AMOUNTS = [100, 500, 1500, 3000]; // in minor units: €1, €5, €15, €30
const MIN_DONATION = 50;   // €0.50 minimum
const MAX_DONATION = 100000; // €1000 maximum

// ─── createDonation ───────────────────────────────────────────────────────────
// Creates a Revolut one-time donation order and returns the checkout URL.

export const createDonation = onCall(async (request) => {
  const uid = requireUser(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const amount = typeof data.amount === "number" ? Math.round(data.amount) : 0;
  const currency = asStr(data.currency, "EUR").toUpperCase();
  const message = asStr(data.message).slice(0, 200).trim();

  if (amount < MIN_DONATION) {
    throw new HttpsError("invalid-argument", `Minimum donation is ${MIN_DONATION / 100} ${currency}.`);
  }
  if (amount > MAX_DONATION) {
    throw new HttpsError("invalid-argument", `Maximum donation is ${MAX_DONATION / 100} ${currency}.`);
  }

  const db = getDb();

  // Load user email
  const userSnap = await db.collection("users").doc(uid).get();
  const userEmail = asStr(userSnap.data()?.email);

  // Load Revolut settings
  const settings = await loadRevolutSettings();
  if (!settings?.enabled || !settings?.secretKey) {
    throw new HttpsError("failed-precondition", "Payment gateway is not configured.");
  }

  // Create donation record (pending)
  const donRef = db.collection("donations").doc();
  const donId = donRef.id;

  const order = await createRevolutOrder(settings, {
    amount,
    currency,
    extRef: `don_${donId}`,
    description: `Donation – Trap App${message ? `: ${message}` : ""}`,
    customerEmail: userEmail,
    successUrl: `${settings.successUrl || "https://playtrapnow.web.app/payment/success"}?type=donation&don=${donId}`,
    cancelUrl: settings.cancelUrl || "https://playtrapnow.web.app/payment/cancel",
  });

  await donRef.set({
    uid,
    email: userEmail,
    amount,
    currency,
    message,
    status: "pending",
    gateway: "revolut",
    revolutOrderId: order.id,
    revolutOrderToken: order.token,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Also log to payments collection for unified history
  await db.collection("payments").add({
    uid,
    email: userEmail,
    amount,
    currency,
    paymentType: "donation",
    status: "pending",
    gateway: "revolut",
    revolutOrderId: order.id,
    donationId: donId,
    isRenewal: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const checkoutUrl = buildCheckoutUrl(settings, order.token);

  return {
    ok: true,
    donationId: donId,
    orderId: order.id,
    checkoutUrl,
    suggestedAmounts: SUGGESTED_AMOUNTS,
  };
});

// ─── getSuggestedDonationAmounts ──────────────────────────────────────────────

export const getSuggestedDonationAmounts = onCall(async (request) => {
  requireUser(request);
  return {
    ok: true,
    amounts: SUGGESTED_AMOUNTS,
    currency: "EUR",
  };
});

// ─── adminGetDonations ────────────────────────────────────────────────────────

export const adminGetDonations = onCall(async (request) => {
  requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const limitN = typeof data.limit === "number" ? Math.min(data.limit, 200) : 100;

  const db = getDb();
  const snap = await db
    .collection("donations")
    .orderBy("createdAt", "desc")
    .limit(limitN)
    .get();

  const items = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      uid: d.uid ?? null,
      email: d.email ?? null,
      amount: d.amount ?? 0,
      currency: d.currency ?? "EUR",
      message: d.message ?? null,
      status: d.status ?? "pending",
      gateway: d.gateway ?? "revolut",
      revolutOrderId: d.revolutOrderId ?? null,
      createdAtMs: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : null,
    };
  });

  const total = items.reduce((s, i) => s + (i.status === "completed" ? i.amount : 0), 0);

  return {
    ok: true,
    items,
    stats: {
      total: items.length,
      completed: items.filter((i) => i.status === "completed").length,
      pending: items.filter((i) => i.status === "pending").length,
      totalAmount: total,
      currency: items[0]?.currency ?? "EUR",
    },
  };
});
