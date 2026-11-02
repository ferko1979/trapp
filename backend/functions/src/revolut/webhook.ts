import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { getDb } from "../shared/firebase";
import { loadRevolutSettings, verifyRevolutWebhook } from "./api";
import { sendPurchaseEmailInternal } from "../adminEmailAutomation";

// ─── revolutWebhook ───────────────────────────────────────────────────────────
// HTTP endpoint registered in the Revolut Merchant dashboard.
// Revolut sends order state change events here.

export const revolutWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const rawBody: string =
    typeof req.rawBody === "string"
      ? req.rawBody
      : (req.rawBody as Buffer | undefined)?.toString("utf-8") ?? JSON.stringify(req.body);

  const signature = req.headers["revolut-signature"] as string | undefined;

  // Load settings to get webhook secret
  const settings = await loadRevolutSettings();
  if (!settings?.webhookSecret) {
    logger.warn("revolutWebhook: no webhook secret configured, skipping verification");
  } else if (!signature || !verifyRevolutWebhook(rawBody, signature, settings.webhookSecret)) {
    logger.error("revolutWebhook: signature verification failed");
    res.status(400).send("Invalid signature");
    return;
  }

  let event: Record<string, unknown>;
  try {
    event = typeof req.body === "object" ? req.body : JSON.parse(rawBody);
  } catch {
    res.status(400).send("Invalid JSON");
    return;
  }

  const eventType = event.event as string | undefined;
  const orderId = event.order_id as string | undefined;
  const extRef = event.merchant_order_ext_ref as string | undefined;

  logger.info("revolutWebhook event", { eventType, orderId, extRef });

  try {
    switch (eventType) {
      case "ORDER_COMPLETED":
        if (extRef?.startsWith("don_")) {
          await handleDonationCompleted(orderId, extRef);
        } else {
          await handleOrderCompleted(orderId, extRef);
        }
        break;
      case "ORDER_PAYMENT_FAILED":
        if (extRef?.startsWith("don_")) {
          await handleDonationFailed(orderId, extRef);
        } else {
          await handleOrderFailed(orderId, extRef);
        }
        break;
      default:
        logger.info(`revolutWebhook: unhandled event type ${eventType}`);
    }
  } catch (err) {
    logger.error("revolutWebhook: handler error", err);
    res.status(500).send("Internal error");
    return;
  }

  res.status(200).send("ok");
});

// ─── handleOrderCompleted ─────────────────────────────────────────────────────

async function handleOrderCompleted(
  orderId: string | undefined,
  extRef: string | undefined
): Promise<void> {
  if (!orderId) return;

  const db = getDb();

  // Find subscription by orderId
  let subSnap = extRef?.startsWith("sub_")
    ? await db.collection("subscriptions").doc(extRef.replace("sub_", "")).get()
    : null;

  if (!subSnap?.exists) {
    // Fallback: query by revolutOrderId
    const q = await db
      .collection("subscriptions")
      .where("revolutOrderId", "==", orderId)
      .limit(1)
      .get();
    subSnap = q.empty ? null : q.docs[0];
  }

  if (!subSnap?.exists) {
    logger.warn("revolutWebhook: no subscription found for order", { orderId, extRef });
    return;
  }

  const sub = subSnap.data()!;
  const uid: string = sub.uid;
  const now = Timestamp.now();
  const periodEnd: Timestamp = sub.currentPeriodEnd instanceof Timestamp
    ? sub.currentPeriodEnd
    : Timestamp.fromDate(new Date(Date.now() + 30 * 86400000));

  // Activate subscription
  await subSnap.ref.set(
    {
      status: "active",
      revolutOrderId: orderId,
      updatedAt: now,
    },
    { merge: true }
  );

  // Resolve the levelId from the purchased package so zoom and other
  // membership-level restrictions are applied correctly.
  const packageId = sub.packageId as string | undefined;
  let levelId: string | null = null;
  if (packageId) {
    const pkgSnap = await db.collection("payment_packages").doc(packageId).get();
    const pkgLevelId = pkgSnap.exists ? (pkgSnap.data()?.levelId as string | undefined) : undefined;
    if (pkgLevelId && pkgLevelId.trim()) levelId = pkgLevelId.trim();
  }

  // Grant membership to user (and upgrade their level if the package has one)
  const userUpdate: Record<string, unknown> = {
    membership: "paid",
    membershipExpiresAt: periodEnd,
    lastPaymentAt: now,
  };
  if (levelId) userUpdate.levelId = levelId;

  await db.collection("users").doc(uid).set(userUpdate, { merge: true });

  // Update payment log
  const paySnap = await db
    .collection("payments")
    .where("subscriptionId", "==", subSnap.id)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (!paySnap.empty) {
    await paySnap.docs[0].ref.set(
      { status: "completed", revolutOrderId: orderId, updatedAt: now },
      { merge: true }
    );
  } else {
    // Create a payment record if it doesn't exist yet
    await db.collection("payments").add({
      uid,
      packageId: sub.packageId ?? null,
      packageName: sub.packageName ?? null,
      amount: sub.amount ?? 0,
      currency: sub.currency ?? "EUR",
      paymentType: sub.isRecurring ? "recurring" : "one_time",
      status: "completed",
      gateway: "revolut",
      revolutOrderId: orderId,
      subscriptionId: subSnap.id,
      isRenewal: sub.isRenewal ?? false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  // Send purchase confirmation email (fire-and-forget — never block the webhook)
  void sendPurchaseEmailInternal({
    uid,
    packageName: sub.packageName ?? null,
    amount: typeof sub.amount === "number" ? Math.round(sub.amount * 100) : null,
    currency: sub.currency ?? "EUR",
    transactionId: orderId ?? null,
    membershipExpiresAt: periodEnd.toDate(),
  }).catch((e) => logger.warn("sendPurchaseEmailInternal failed", e));

  logger.info("revolutWebhook: subscription activated", { uid, subscriptionId: subSnap.id });
}

// ─── handleOrderFailed ────────────────────────────────────────────────────────

async function handleOrderFailed(
  orderId: string | undefined,
  extRef: string | undefined
): Promise<void> {
  if (!orderId) return;

  const db = getDb();

  let subSnap = extRef?.startsWith("sub_")
    ? await db.collection("subscriptions").doc(extRef.replace("sub_", "")).get()
    : null;

  if (!subSnap?.exists) {
    const q = await db
      .collection("subscriptions")
      .where("revolutOrderId", "==", orderId)
      .limit(1)
      .get();
    subSnap = q.empty ? null : q.docs[0];
  }

  if (!subSnap?.exists) return;

  const now = Timestamp.now();
  await subSnap.ref.set({ status: "payment_failed", updatedAt: now }, { merge: true });

  // Update payment log
  const paySnap = await db
    .collection("payments")
    .where("subscriptionId", "==", subSnap.id)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (!paySnap.empty) {
    await paySnap.docs[0].ref.set({ status: "failed", updatedAt: now }, { merge: true });
  }

  logger.info("revolutWebhook: order failed", { orderId, subscriptionId: subSnap.id });
}

// ─── handleDonationCompleted ──────────────────────────────────────────────────

async function handleDonationCompleted(
  orderId: string | undefined,
  extRef: string | undefined
): Promise<void> {
  if (!orderId || !extRef) return;
  const donId = extRef.replace("don_", "");
  const db = getDb();
  const now = Timestamp.now();

  await db.collection("donations").doc(donId).set(
    { status: "completed", revolutOrderId: orderId, updatedAt: now },
    { merge: true }
  );

  // Update unified payment log
  const paySnap = await db
    .collection("payments")
    .where("donationId", "==", donId)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!paySnap.empty) {
    await paySnap.docs[0].ref.set({ status: "completed", updatedAt: now }, { merge: true });
  }

  logger.info("revolutWebhook: donation completed", { donId, orderId });
}

// ─── handleDonationFailed ─────────────────────────────────────────────────────

async function handleDonationFailed(
  orderId: string | undefined,
  extRef: string | undefined
): Promise<void> {
  if (!orderId || !extRef) return;
  const donId = extRef.replace("don_", "");
  const db = getDb();
  const now = Timestamp.now();

  await db.collection("donations").doc(donId).set(
    { status: "failed", revolutOrderId: orderId, updatedAt: now },
    { merge: true }
  );

  const paySnap = await db
    .collection("payments")
    .where("donationId", "==", donId)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!paySnap.empty) {
    await paySnap.docs[0].ref.set({ status: "failed", updatedAt: now }, { merge: true });
  }

  logger.info("revolutWebhook: donation failed", { donId, orderId });
}
