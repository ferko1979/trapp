import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "../shared/firebase";
import { requireUser } from "../shared/appCheck";
import {
  loadRevolutSettings,
  createRevolutOrder,
  buildCheckoutUrl,
} from "./api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function durationDays(d: string): number {
  switch (d) {
    case "1d":  return 1;
    case "7d":  return 7;
    case "30d": return 30;
    case "1m":  return 30;
    case "3m":  return 90;
    case "6m":  return 180;
    case "1y":  return 365;
    default:    return 30;
  }
}

// ─── getAvailablePackages ─────────────────────────────────────────────────────
// Returns active payment packages for display in the app.

export const getAvailablePackages = onCall(async (request) => {
  requireUser(request);
  const db = getDb();
  const snap = await db
    .collection("payment_packages")
    .where("isActive", "==", true)
    .orderBy("sortOrder", "asc")
    .get();

  // Collect unique levelIds to batch-fetch level details
  const levelIds = new Set<string>();
  for (const doc of snap.docs) {
    const lid = doc.data().levelId;
    if (typeof lid === "string" && lid && lid !== "admin") levelIds.add(lid);
  }

  const levelMap: Record<string, Record<string, unknown>> = {};
  if (levelIds.size > 0) {
    const levelSnaps = await Promise.all(
      [...levelIds].map((lid) => db.collection("user_levels").doc(lid).get())
    );
    for (const ls of levelSnaps) {
      if (ls.exists) levelMap[ls.id] = ls.data() as Record<string, unknown>;
    }
  }

  const packages = snap.docs
    .map((doc) => {
      const d = doc.data();
      const levelId = typeof d.levelId === "string" ? d.levelId : "";

      // Skip packages linked to admin level — not purchaseable
      if (levelId === "admin") return null;

      const level = levelMap[levelId] ?? {};
      const discounts: Array<{
        code: string;
        discountPercent: number;
        validUntil: number | null;
      }> = [];
      if (Array.isArray(d.discounts)) {
        for (const disc of d.discounts) {
          if (!disc.isActive) continue;
          if (disc.validUntil instanceof Timestamp && disc.validUntil.toMillis() < Date.now()) continue;
          discounts.push({
            code: disc.code,
            discountPercent: disc.discountPercent ?? 0,
            validUntil: disc.validUntil instanceof Timestamp ? disc.validUntil.toMillis() : null,
          });
        }
      }
      return {
        id: doc.id,
        name: d.name ?? "",
        description: d.description ?? "",
        duration: d.duration ?? "1m",
        durationDays: durationDays(d.duration ?? "1m"),
        price: d.price ?? 0,
        currency: d.currency ?? "EUR",
        trialDays: d.trialDays ?? 0,
        isRecurring: d.isRecurring ?? false,
        playProductId: typeof d.playProductId === "string" ? d.playProductId : "",
        discounts,
        sortOrder: d.sortOrder ?? 99,
        // Level benefit details
        levelId,
        levelName: typeof level.name === "string" ? level.name : "",
        levelBagKg: typeof level.bagWeightCapacity === "number" ? level.bagWeightCapacity : 0,
        levelDailyTraps: typeof level.dailyTrapAllowance === "number" ? level.dailyTrapAllowance : 0,
        levelRadiusMeters: typeof level.mapVisibilityRadiusMeters === "number" ? level.mapVisibilityRadiusMeters : 0,
        levelSpeedPercent: typeof level.placementReductionPercent === "number" ? level.placementReductionPercent : 0,
        levelDisableBanner: level.disableBannerAd === true,
        levelDisableInterstitial: level.disableInterstitialAd === true,
        levelDisableRewarded: level.disableRewardedAd === true,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return { ok: true, packages };
});

// ─── getMySubscription ────────────────────────────────────────────────────────
// Returns the current user's active or most recent subscription.

export const getMySubscription = onCall(async (request) => {
  const uid = requireUser(request);
  const db = getDb();

  // Find the most recent non-expired subscription
  const snap = await db
    .collection("subscriptions")
    .where("uid", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(5)
    .get();

  if (snap.empty) return { ok: true, subscription: null };

  const now = Date.now();
  let active = snap.docs.find((doc) => {
    const d = doc.data();
    const status: string = d.status ?? "";
    if (status === "active" || status === "trialing") return true;
    if (status === "cancelled" && d.currentPeriodEnd instanceof Timestamp) {
      return d.currentPeriodEnd.toMillis() > now;
    }
    return false;
  });

  if (!active) active = snap.docs[0];

  const d = active.data();
  const packageId = d.packageId ?? null;

  // Fetch package-level ad disable flags
  let disableBannerAd = false;
  let disableInterstitialAd = false;
  let disableRewardedAd = false;
  if (packageId) {
    try {
      const pkgSnap = await db.collection("payment_packages").doc(packageId).get();
      if (pkgSnap.exists) {
        const pkg = pkgSnap.data()!;
        disableBannerAd       = pkg.disableBannerAd       === true;
        disableInterstitialAd = pkg.disableInterstitialAd === true;
        disableRewardedAd     = pkg.disableRewardedAd     === true;
      }
    } catch (_) { /* non-fatal */ }
  }

  return {
    ok: true,
    subscription: {
      id: active.id,
      packageId,
      packageName: d.packageName ?? null,
      status: d.status ?? "expired",
      trialEnd: d.trialEnd instanceof Timestamp ? d.trialEnd.toMillis() : null,
      currentPeriodStart: d.currentPeriodStart instanceof Timestamp ? d.currentPeriodStart.toMillis() : null,
      currentPeriodEnd: d.currentPeriodEnd instanceof Timestamp ? d.currentPeriodEnd.toMillis() : null,
      cancelledAt: d.cancelledAt instanceof Timestamp ? d.cancelledAt.toMillis() : null,
      cancelAtPeriodEnd: d.cancelAtPeriodEnd ?? false,
      amount: d.amount ?? 0,
      currency: d.currency ?? "EUR",
      gateway: d.gateway ?? "revolut",
      playProductId: d.playProductId ?? null,
      // Per-package ad settings for this subscriber
      disableBannerAd,
      disableInterstitialAd,
      disableRewardedAd,
    },
  };
});

// ─── createRevolutCheckout ────────────────────────────────────────────────────
// Creates a Revolut payment order for a package and returns the checkout URL.

export const createRevolutCheckout = onCall(async (request) => {
  const uid = requireUser(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const packageId = asStr(data.packageId).trim();
  const discountCode = asStr(data.discountCode).trim();

  if (!packageId) throw new HttpsError("invalid-argument", "packageId is required.");

  const db = getDb();

  // Load package
  const pkgSnap = await db.collection("payment_packages").doc(packageId).get();
  if (!pkgSnap.exists) throw new HttpsError("not-found", "Package not found.");
  const pkg = pkgSnap.data()!;
  if (!pkg.isActive) throw new HttpsError("failed-precondition", "Package is not available.");

  // Load user email
  const userSnap = await db.collection("users").doc(uid).get();
  const userEmail = asStr(userSnap.data()?.email);

  // Load Revolut settings
  const settings = await loadRevolutSettings();
  if (!settings || !settings.enabled || !settings.secretKey) {
    throw new HttpsError("failed-precondition", "Payment gateway is not configured.");
  }

  // Compute price with discount
  let price: number = pkg.price ?? 0;
  const currency: string = pkg.currency ?? settings.currency ?? "EUR";
  let appliedDiscount: string | null = null;

  if (discountCode && Array.isArray(pkg.discounts)) {
    const disc = pkg.discounts.find(
      (d: Record<string, unknown>) =>
        d.isActive &&
        asStr(d.code).toUpperCase() === discountCode.toUpperCase() &&
        (!(d.validUntil instanceof Timestamp) || d.validUntil.toMillis() > Date.now()) &&
        (typeof d.maxUses !== "number" || Number(d.usedCount ?? 0) < (d.maxUses as number))
    );
    if (disc) {
      const pct = typeof disc.discountPercent === "number" ? disc.discountPercent : 0;
      price = Math.round(price * (1 - pct / 100));
      appliedDiscount = asStr(disc.code);
    }
  }

  // Check for trial eligibility: if user has never had a subscription for this package
  const hasPriorSnap = await db
    .collection("subscriptions")
    .where("uid", "==", uid)
    .where("packageId", "==", packageId)
    .limit(1)
    .get();
  const trialDays: number = hasPriorSnap.empty ? (pkg.trialDays ?? 0) : 0;

  // Create subscription record in Firestore (pending)
  const now = new Date();
  const trialEnd = trialDays > 0
    ? new Date(now.getTime() + trialDays * 86400000)
    : null;
  const periodStart = trialEnd ?? now;
  const periodEnd = new Date(periodStart.getTime() + durationDays(pkg.duration ?? "1m") * 86400000);

  const subRef = db.collection("subscriptions").doc();
  const subId = subRef.id;

  // If trial, activate immediately without payment
  if (trialDays > 0) {
    await subRef.set({
      uid,
      packageId,
      packageName: pkg.name ?? "",
      status: "trialing",
      trialStart: Timestamp.fromDate(now),
      trialEnd: Timestamp.fromDate(trialEnd!),
      currentPeriodStart: Timestamp.fromDate(periodStart),
      currentPeriodEnd: Timestamp.fromDate(periodEnd),
      cancelledAt: null,
      cancelAtPeriodEnd: false,
      gateway: "revolut",
      revolutOrderId: null,
      amount: price,
      currency,
      discountCode: appliedDiscount,
      isRenewal: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Grant membership immediately for trial
    await db.collection("users").doc(uid).set(
      {
        membership: "trial",
        membershipExpiresAt: Timestamp.fromDate(periodEnd),
        lastPaymentAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      ok: true,
      isTrial: true,
      trialDays,
      subscriptionId: subId,
      checkoutUrl: null,
    };
  }

  // Paid package: create Revolut order
  const extRef = `sub_${subId}`;
  const successUrl = `${settings.successUrl || "https://playtrapnow.web.app/payment/success"}?order_id={ORDER_ID}&sub=${subId}`;
  const cancelUrl = settings.cancelUrl || "https://playtrapnow.web.app/payment/cancel";

  const order = await createRevolutOrder(settings, {
    amount: price,
    currency,
    extRef,
    description: `${pkg.name ?? "Subscription"} – Trap App`,
    customerEmail: userEmail,
    successUrl,
    cancelUrl,
  });

  // Save pending subscription
  await subRef.set({
    uid,
    packageId,
    packageName: pkg.name ?? "",
    status: "pending_payment",
    trialStart: null,
    trialEnd: null,
    currentPeriodStart: Timestamp.fromDate(periodStart),
    currentPeriodEnd: Timestamp.fromDate(periodEnd),
    cancelledAt: null,
    cancelAtPeriodEnd: false,
    gateway: "revolut",
    revolutOrderId: order.id,
    revolutOrderToken: order.token,
    amount: price,
    currency,
    discountCode: appliedDiscount,
    isRenewal: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Also log to payments collection for unified history
  await db.collection("payments").add({
    uid,
    email: userEmail,
    packageId,
    packageName: pkg.name ?? "",
    amount: price,
    currency,
    paymentType: pkg.isRecurring ? "recurring" : "one_time",
    status: "pending",
    gateway: "revolut",
    revolutOrderId: order.id,
    subscriptionId: subId,
    discountCode: appliedDiscount,
    isRenewal: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Increment discount usage
  if (appliedDiscount && Array.isArray(pkg.discounts)) {
    const updatedDiscounts = pkg.discounts.map((d: Record<string, unknown>) =>
      asStr(d.code).toUpperCase() === appliedDiscount!.toUpperCase()
        ? { ...d, usedCount: ((d.usedCount as number) ?? 0) + 1 }
        : d
    );
    await db.collection("payment_packages").doc(packageId).update({ discounts: updatedDiscounts });
  }

  const checkoutUrl = buildCheckoutUrl(settings, order.token);

  return {
    ok: true,
    isTrial: false,
    trialDays: 0,
    subscriptionId: subId,
    orderId: order.id,
    checkoutUrl,
  };
});

// ─── cancelMySubscription ─────────────────────────────────────────────────────

export const cancelMySubscription = onCall(async (request) => {
  const uid = requireUser(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const subscriptionId = asStr(data.subscriptionId).trim();

  if (!subscriptionId) throw new HttpsError("invalid-argument", "subscriptionId is required.");

  const db = getDb();
  const subRef = db.collection("subscriptions").doc(subscriptionId);
  const subSnap = await subRef.get();

  if (!subSnap.exists) throw new HttpsError("not-found", "Subscription not found.");
  const sub = subSnap.data()!;
  if (sub.uid !== uid) throw new HttpsError("permission-denied", "Access denied.");

  if (sub.gateway === "google_play") {
    // Play subscriptions can only be cancelled in the Play Store app.
    throw new HttpsError("failed-precondition", "Cancel this subscription in Google Play.");
  }

  const validStatuses = ["active", "trialing", "pending_payment"];
  if (!validStatuses.includes(sub.status)) {
    throw new HttpsError("failed-precondition", "Subscription is not active.");
  }

  const now = Timestamp.now();
  const periodEnd = sub.currentPeriodEnd instanceof Timestamp ? sub.currentPeriodEnd : now;
  const isPastPeriodEnd = periodEnd.toMillis() <= now.toMillis();

  if (isPastPeriodEnd) {
    // Cancel immediately
    await subRef.set(
      { status: "cancelled", cancelledAt: now, cancelAtPeriodEnd: false, updatedAt: now },
      { merge: true }
    );
    await db.collection("users").doc(uid).set(
      { membership: "free", membershipExpiresAt: null, updatedAt: now },
      { merge: true }
    );
  } else {
    // Cancel at period end — keep active until then
    await subRef.set(
      { cancelAtPeriodEnd: true, cancelledAt: now, updatedAt: now },
      { merge: true }
    );
  }

  return {
    ok: true,
    cancelledImmediately: isPastPeriodEnd,
    accessUntil: isPastPeriodEnd ? null : periodEnd.toMillis(),
  };
});
