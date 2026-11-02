import { createHash } from "crypto";
import { androidpublisher, auth } from "@googleapis/androidpublisher";
import { logger } from "firebase-functions";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { getDb } from "./shared/firebase";
import { requireUser } from "./shared/appCheck";
import { writeAuditLog } from "./adminAuditLog";
import { durationDays } from "./revolut/payments";
import { DELETED_USER_MARKER } from "./shared/userDataCleanup";

/**
 * Google Play Billing for store installs (Play policy: digital goods sold in a
 * Play-distributed app must use Play Billing). Direct-APK installs keep using
 * Stripe / Revolut.
 *
 * Setup (Play Console):
 *  - create a product per package and put its ID into the package's
 *    "Google Play product ID" (subscription for recurring packages, one-time
 *    in-app product otherwise);
 *  - Users & permissions → invite this project's functions service account
 *    with "View financial data" + "Manage orders and subscriptions";
 *  - Monetization setup → Real-time developer notifications → topic
 *    projects/<project>/topics/play-billing-rtdn (grant
 *    google-play-developer-notifications@system.gserviceaccount.com Pub/Sub Publisher).
 */

const PACKAGE_NAME = "com.fairco.trap";
const RTDN_TOPIC = "play-billing-rtdn";

function publisher() {
  return androidpublisher({
    version: "v3",
    auth: new auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/androidpublisher"] }),
  });
}

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const ACTIVE_SUB_STATES = new Set([
  "SUBSCRIPTION_STATE_ACTIVE",
  "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
]);

// ─── verifyPlayPurchase ───────────────────────────────────────────────────────
// Called by the app right after a successful Play purchase (and on screen open
// for purchases that were pending). Verifies the token with Google, grants the
// package's membership and acknowledges the purchase. Idempotent per token.

export const verifyPlayPurchase = onCall(async (request) => {
  const uid = requireUser(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const packageId = typeof data.packageId === "string" ? data.packageId.trim() : "";
  const purchaseToken = typeof data.purchaseToken === "string" ? data.purchaseToken.trim() : "";
  if (!packageId || !purchaseToken) {
    throw new HttpsError("invalid-argument", "packageId and purchaseToken are required.");
  }

  const db = getDb();
  const pkgSnap = await db.collection("payment_packages").doc(packageId).get();
  if (!pkgSnap.exists) throw new HttpsError("not-found", "Package not found.");
  const pkg = pkgSnap.data()!;
  const productId = typeof pkg.playProductId === "string" ? pkg.playProductId.trim() : "";
  if (!productId) throw new HttpsError("failed-precondition", "Package is not sold on Google Play.");

  const purchaseRef = db.collection("play_purchases").doc(tokenKey(purchaseToken));
  const existing = await purchaseRef.get();
  if (existing.exists) {
    if (existing.data()?.uid !== uid) throw new HttpsError("permission-denied", "Purchase belongs to another account.");
    return { ok: true, alreadyProcessed: true };
  }

  const api = publisher();
  const isRecurring = pkg.isRecurring === true;
  let expiresAt: Date;
  let orderId: string | null = null;

  try {
    if (isRecurring) {
      const res = await api.purchases.subscriptionsv2.get({ packageName: PACKAGE_NAME, token: purchaseToken });
      const sub = res.data;
      const owner = sub.externalAccountIdentifiers?.obfuscatedExternalAccountId;
      if (owner && owner !== uid) throw new HttpsError("permission-denied", "Purchase belongs to another account.");
      if (!ACTIVE_SUB_STATES.has(sub.subscriptionState ?? "")) {
        throw new HttpsError("failed-precondition", `Subscription is not active (${sub.subscriptionState}).`);
      }
      const line = (sub.lineItems ?? []).find((l) => l.productId === productId);
      if (!line?.expiryTime) throw new HttpsError("failed-precondition", "Product does not match the package.");
      expiresAt = new Date(line.expiryTime);
      orderId = line.latestSuccessfulOrderId ?? null;
      if (sub.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
        await api.purchases.subscriptions.acknowledge({
          packageName: PACKAGE_NAME, subscriptionId: productId, token: purchaseToken,
        });
      }
    } else {
      const res = await api.purchases.products.get({ packageName: PACKAGE_NAME, productId, token: purchaseToken });
      const p = res.data;
      if (p.obfuscatedExternalAccountId && p.obfuscatedExternalAccountId !== uid) {
        throw new HttpsError("permission-denied", "Purchase belongs to another account.");
      }
      if (p.purchaseState !== 0) throw new HttpsError("failed-precondition", "Purchase is not completed.");
      expiresAt = new Date(Date.now() + durationDays(pkg.duration ?? "1m") * 86400000);
      orderId = p.orderId ?? null;
      // Consume so the same pass can be bought again after it runs out;
      // the token record above prevents a second grant.
      if (p.consumptionState !== 1) {
        await api.purchases.products.consume({ packageName: PACKAGE_NAME, productId, token: purchaseToken });
      }
    }
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("verifyPlayPurchase: Google Play API error", { uid, packageId, err });
    throw new HttpsError("unavailable", "Could not verify the purchase with Google Play. Try again later.");
  }

  const subRef = db.collection("subscriptions").doc();
  const now = Timestamp.now();
  const expiresTs = Timestamp.fromDate(expiresAt);
  const levelId = typeof pkg.levelId === "string" && pkg.levelId.trim() ? pkg.levelId.trim() : null;

  const batch = db.batch();
  batch.set(purchaseRef, {
    uid, packageId, productId, isRecurring, orderId,
    purchaseToken, subscriptionId: subRef.id,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(subRef, {
    uid,
    packageId,
    packageName: pkg.name ?? "",
    status: "active",
    trialStart: null,
    trialEnd: null,
    currentPeriodStart: now,
    currentPeriodEnd: expiresTs,
    cancelledAt: null,
    cancelAtPeriodEnd: false,
    gateway: "google_play",
    playProductId: productId,
    playOrderId: orderId,
    playTokenKey: purchaseRef.id,
    amount: pkg.price ?? 0,
    currency: pkg.currency ?? "EUR",
    isRecurring,
    isRenewal: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.collection("payments").doc(), {
    uid,
    packageId,
    packageName: pkg.name ?? "",
    amount: pkg.price ?? 0,
    currency: pkg.currency ?? "EUR",
    paymentType: isRecurring ? "recurring" : "one_time",
    status: "completed",
    gateway: "google_play",
    playOrderId: orderId,
    subscriptionId: subRef.id,
    isRenewal: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const userUpdate: Record<string, unknown> = {
    membership: "paid",
    membershipExpiresAt: expiresTs,
    lastPaymentAt: now,
    updatedAt: now,
  };
  if (levelId) userUpdate.levelId = levelId;
  batch.set(db.collection("users").doc(uid), userUpdate, { merge: true });
  await batch.commit();

  void writeAuditLog({
    adminUid: "google_play",
    category: "users",
    action: "PAYMENT_COMPLETED",
    targetId: uid,
    summary: `Google Play purchase — package "${pkg.name ?? packageId}", expires ${expiresAt.toISOString()}`,
    details: { uid, packageId, productId, orderId },
  });

  return { ok: true, membershipExpiresAt: expiresAt.getTime() };
});

// ─── playBillingRtdn ──────────────────────────────────────────────────────────
// Real-time developer notifications: renewals, cancellations, expiry, refunds.

export const playBillingRtdn = onMessagePublished(RTDN_TOPIC, async (event) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg = event.data.message.json as Record<string, any> | undefined;
  const note = msg?.subscriptionNotification as { notificationType?: number; purchaseToken?: string } | undefined;
  const voided = msg?.voidedPurchaseNotification as { purchaseToken?: string } | undefined;
  const token = note?.purchaseToken ?? voided?.purchaseToken;
  if (msg?.packageName !== PACKAGE_NAME || !token) return;

  const db = getDb();
  let purchaseSnap = await db.collection("play_purchases").doc(tokenKey(token)).get();

  // Refund / chargeback → revoke immediately.
  if (voided) {
    if (purchaseSnap.exists && purchaseSnap.data()?.uid !== DELETED_USER_MARKER) {
      await endMembership(db, purchaseSnap.data()!, "refunded");
    }
    return;
  }

  const res = await publisher().purchases.subscriptionsv2.get({ packageName: PACKAGE_NAME, token });
  const sub = res.data;

  // Upgrades / resubscribes issue a new token linked to the previous one.
  if (!purchaseSnap.exists && sub.linkedPurchaseToken) {
    const prev = await db.collection("play_purchases").doc(tokenKey(sub.linkedPurchaseToken)).get();
    if (prev.exists) {
      await db.collection("play_purchases").doc(tokenKey(token)).set({
        ...prev.data(), purchaseToken: token, linkedFrom: prev.id, createdAt: FieldValue.serverTimestamp(),
      });
      purchaseSnap = await db.collection("play_purchases").doc(tokenKey(token)).get();
    }
  }
  if (!purchaseSnap.exists) {
    // The app reports new purchases itself via verifyPlayPurchase.
    logger.info("playBillingRtdn: unknown token, ignored", { type: note?.notificationType });
    return;
  }

  const p = purchaseSnap.data()!;
  if (p.uid === DELETED_USER_MARKER) return; // account erased; nothing to update
  const line = (sub.lineItems ?? []).find((l) => l.productId === p.productId) ?? sub.lineItems?.[0];
  const expiry = line?.expiryTime ? Timestamp.fromDate(new Date(line.expiryTime)) : null;
  const state = sub.subscriptionState ?? "";
  const now = Timestamp.now();
  const subRef = db.collection("subscriptions").doc(p.subscriptionId);

  if (ACTIVE_SUB_STATES.has(state) && expiry) {
    await subRef.set({ status: "active", currentPeriodEnd: expiry, cancelAtPeriodEnd: false, updatedAt: now }, { merge: true });
    await db.collection("users").doc(p.uid).set({ membership: "paid", membershipExpiresAt: expiry, updatedAt: now }, { merge: true });
  } else if (state === "SUBSCRIPTION_STATE_CANCELED" && expiry) {
    // Auto-renew switched off; access runs until expiry.
    await subRef.set({ status: "cancelled", cancelAtPeriodEnd: true, cancelledAt: now, currentPeriodEnd: expiry, updatedAt: now }, { merge: true });
  } else if (state === "SUBSCRIPTION_STATE_ON_HOLD" || state === "SUBSCRIPTION_STATE_PAUSED" ||
             state === "SUBSCRIPTION_STATE_EXPIRED") {
    await endMembership(db, p, state === "SUBSCRIPTION_STATE_EXPIRED" ? "expired" : "on_hold");
  }
  logger.info("playBillingRtdn processed", { uid: p.uid, type: note?.notificationType, state });
});

async function endMembership(
  db: FirebaseFirestore.Firestore,
  p: FirebaseFirestore.DocumentData,
  status: string
): Promise<void> {
  const now = Timestamp.now();
  await db.collection("subscriptions").doc(p.subscriptionId).set({ status, updatedAt: now }, { merge: true });
  // Only drop the membership if no other active subscription is keeping it.
  const others = await db.collection("subscriptions")
    .where("uid", "==", p.uid).where("status", "in", ["active", "trialing"]).limit(1).get();
  if (others.empty) {
    await db.collection("users").doc(p.uid).set({ membership: "free", membershipExpiresAt: null, updatedAt: now }, { merge: true });
  }
}
