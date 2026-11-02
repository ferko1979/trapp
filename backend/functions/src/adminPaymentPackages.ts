import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { writeAuditLog } from "./adminAuditLog";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function asNum(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}
function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

const VALID_DURATIONS = ["1d", "7d", "30d", "1m", "3m", "6m", "1y"];
const VALID_CURRENCIES = ["EUR", "USD", "GBP", "HUF", "CZK", "PLN", "RON", "HRK"];

// ─── adminListPaymentPackages ─────────────────────────────────────────────────

export const adminListPaymentPackages = onCall(async (request) => {
  requireAdmin(request);
  const db = getDb();
  const snap = await db.collection("payment_packages").orderBy("sortOrder", "asc").get();

  const packages = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      name: d.name ?? "",
      description: d.description ?? "",
      duration: d.duration ?? "1m",
      price: d.price ?? 0,
      currency: d.currency ?? "EUR",
      trialDays: d.trialDays ?? 0,
      isActive: d.isActive ?? false,
      isRecurring: d.isRecurring ?? false,
      sortOrder: d.sortOrder ?? 99,
      discounts: Array.isArray(d.discounts) ? d.discounts : [],
        // Which user_levels doc is granted when this package is purchased
      levelId: typeof d.levelId === "string" ? d.levelId : "",
      // Per-package ad disable flags (each independently toggleable)
      disableBannerAd: d.disableBannerAd === true,
      disableInterstitialAd: d.disableInterstitialAd === true,
      disableRewardedAd: d.disableRewardedAd === true,
      createdAtMs: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : null,
      updatedAtMs: d.updatedAt instanceof Timestamp ? d.updatedAt.toMillis() : null,
    };
  });

  return { ok: true, packages };
});

// ─── adminCreatePaymentPackage ────────────────────────────────────────────────

export const adminCreatePaymentPackage = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const name = asStr(data.name).trim();
  if (!name) throw new HttpsError("invalid-argument", "name is required.");

  const duration = asStr(data.duration, "1m");
  if (!VALID_DURATIONS.includes(duration)) {
    throw new HttpsError("invalid-argument", `Invalid duration. Must be one of: ${VALID_DURATIONS.join(", ")}`);
  }

  const currency = asStr(data.currency, "EUR").toUpperCase();
  if (!VALID_CURRENCIES.includes(currency)) {
    throw new HttpsError("invalid-argument", `Unsupported currency: ${currency}`);
  }

  const db = getDb();
  const ref = db.collection("payment_packages").doc();
  await ref.set({
    name,
    description: asStr(data.description),
    duration,
    price: asNum(data.price, 0),
    currency,
    trialDays: Math.max(0, asNum(data.trialDays, 0)),
    isActive: asBool(data.isActive, false),
    isRecurring: asBool(data.isRecurring, false),
    sortOrder: asNum(data.sortOrder, 99),
    levelId: asStr(data.levelId, "").trim(),
    disableBannerAd: asBool(data.disableBannerAd, false),
    disableInterstitialAd: asBool(data.disableInterstitialAd, false),
    disableRewardedAd: asBool(data.disableRewardedAd, false),
    discounts: [],
    createdByUid: adminUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  void writeAuditLog({
    adminUid,
    category: "other",
    action: "CREATE_PAYMENT_PACKAGE",
    targetId: ref.id,
    summary: `Created payment package: ${name}`,
    details: { packageId: ref.id, name, duration, price: data.price, currency },
  });

  return { ok: true, id: ref.id };
});

// ─── adminUpdatePaymentPackage ────────────────────────────────────────────────

export const adminUpdatePaymentPackage = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const packageId = asStr(data.id).trim();
  if (!packageId) throw new HttpsError("invalid-argument", "id is required.");

  const db = getDb();
  const ref = db.collection("payment_packages").doc(packageId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Package not found.");

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

  if ("name" in data)        update.name        = asStr(data.name).trim();
  if ("description" in data) update.description = asStr(data.description);
  if ("price" in data)       update.price       = asNum(data.price, 0);
  if ("trialDays" in data)   update.trialDays   = Math.max(0, asNum(data.trialDays, 0));
  if ("isActive" in data)    update.isActive    = asBool(data.isActive, false);
  if ("isRecurring" in data) update.isRecurring = asBool(data.isRecurring, false);
  if ("sortOrder" in data)   update.sortOrder   = asNum(data.sortOrder, 99);

  if ("duration" in data) {
    const dur = asStr(data.duration, "1m");
    if (!VALID_DURATIONS.includes(dur)) throw new HttpsError("invalid-argument", "Invalid duration.");
    update.duration = dur;
  }
  if ("currency" in data) {
    const cur = asStr(data.currency, "EUR").toUpperCase();
    if (!VALID_CURRENCIES.includes(cur)) throw new HttpsError("invalid-argument", `Unsupported currency: ${cur}`);
    update.currency = cur;
  }
  if ("levelId" in data)                update.levelId                = asStr(data.levelId, "").trim();
  if ("disableBannerAd" in data)        update.disableBannerAd        = asBool(data.disableBannerAd, false);
  if ("disableInterstitialAd" in data)  update.disableInterstitialAd  = asBool(data.disableInterstitialAd, false);
  if ("disableRewardedAd" in data)      update.disableRewardedAd      = asBool(data.disableRewardedAd, false);

  await ref.set(update, { merge: true });

  void writeAuditLog({
    adminUid,
    category: "other",
    action: "UPDATE_PAYMENT_PACKAGE",
    targetId: packageId,
    summary: `Updated payment package ${packageId}`,
    details: { packageId, changedKeys: Object.keys(update) },
  });

  return { ok: true };
});

// ─── adminDeletePaymentPackage ────────────────────────────────────────────────

export const adminDeletePaymentPackage = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const packageId = asStr(data.id).trim();
  if (!packageId) throw new HttpsError("invalid-argument", "id is required.");

  const db = getDb();
  const ref = db.collection("payment_packages").doc(packageId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Package not found.");

  await ref.delete();

  void writeAuditLog({
    adminUid,
    category: "other",
    action: "DELETE_PAYMENT_PACKAGE",
    targetId: packageId,
    summary: `Deleted payment package ${packageId}`,
    details: { packageId },
  });

  return { ok: true };
});

// ─── adminAddDiscount ─────────────────────────────────────────────────────────

export const adminAddDiscount = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const packageId = asStr(data.packageId).trim();
  const code = asStr(data.code).trim().toUpperCase();
  const discountPercent = asNum(data.discountPercent, 0);

  if (!packageId) throw new HttpsError("invalid-argument", "packageId is required.");
  if (!code) throw new HttpsError("invalid-argument", "code is required.");
  if (discountPercent <= 0 || discountPercent > 100) {
    throw new HttpsError("invalid-argument", "discountPercent must be between 1 and 100.");
  }

  const db = getDb();
  const ref = db.collection("payment_packages").doc(packageId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Package not found.");

  const pkg = snap.data()!;
  const existing: unknown[] = Array.isArray(pkg.discounts) ? pkg.discounts : [];

  if (existing.some((d) => asStr((d as Record<string, unknown>).code).toUpperCase() === code)) {
    throw new HttpsError("already-exists", `Discount code '${code}' already exists on this package.`);
  }

  let validUntil: Timestamp | null = null;
  if (data.validUntil && typeof data.validUntil === "number") {
    validUntil = Timestamp.fromMillis(data.validUntil);
  }

  const newDiscount = {
    code,
    discountPercent,
    validUntil,
    maxUses: typeof data.maxUses === "number" ? data.maxUses : null,
    usedCount: 0,
    isActive: true,
    createdByUid: adminUid,
    createdAt: Timestamp.now(),
  };

  await ref.set({ discounts: [...existing, newDiscount], updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  void writeAuditLog({
    adminUid,
    category: "other",
    action: "ADD_DISCOUNT_CODE",
    targetId: packageId,
    summary: `Added discount code '${code}' (${discountPercent}% off) to package ${packageId}`,
    details: { packageId, code, discountPercent },
  });

  return { ok: true };
});

// ─── adminRemoveDiscount ──────────────────────────────────────────────────────

export const adminRemoveDiscount = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const packageId = asStr(data.packageId).trim();
  const code = asStr(data.code).trim().toUpperCase();

  if (!packageId || !code) throw new HttpsError("invalid-argument", "packageId and code are required.");

  const db = getDb();
  const ref = db.collection("payment_packages").doc(packageId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Package not found.");

  const pkg = snap.data()!;
  const filtered = (Array.isArray(pkg.discounts) ? pkg.discounts : []).filter(
    (d: Record<string, unknown>) => asStr(d.code).toUpperCase() !== code
  );

  await ref.set({ discounts: filtered, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  void writeAuditLog({
    adminUid,
    category: "other",
    action: "REMOVE_DISCOUNT_CODE",
    targetId: packageId,
    summary: `Removed discount code '${code}' from package ${packageId}`,
    details: { packageId, code },
  });

  return { ok: true };
});

// ─── adminListSubscriptions ───────────────────────────────────────────────────

export const adminListSubscriptions = onCall(async (request) => {
  requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const limitN = typeof data.limit === "number" ? Math.min(data.limit, 200) : 100;
  const statusFilter = asStr(data.status);
  const uidFilter = asStr(data.uid);

  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = db.collection("subscriptions").orderBy("createdAt", "desc");
  if (statusFilter) query = query.where("status", "==", statusFilter);
  if (uidFilter) query = query.where("uid", "==", uidFilter);
  query = query.limit(limitN);

  const snap = await query.get();
  const subscriptions = snap.docs.map((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
    const d = doc.data();
    return {
      id: doc.id,
      uid: d.uid ?? null,
      packageId: d.packageId ?? null,
      packageName: d.packageName ?? null,
      status: d.status ?? "unknown",
      trialEnd: d.trialEnd instanceof Timestamp ? d.trialEnd.toMillis() : null,
      currentPeriodStart: d.currentPeriodStart instanceof Timestamp ? d.currentPeriodStart.toMillis() : null,
      currentPeriodEnd: d.currentPeriodEnd instanceof Timestamp ? d.currentPeriodEnd.toMillis() : null,
      cancelledAt: d.cancelledAt instanceof Timestamp ? d.cancelledAt.toMillis() : null,
      cancelAtPeriodEnd: d.cancelAtPeriodEnd ?? false,
      gateway: d.gateway ?? "revolut",
      revolutOrderId: d.revolutOrderId ?? null,
      amount: d.amount ?? 0,
      currency: d.currency ?? "EUR",
      discountCode: d.discountCode ?? null,
      createdAtMs: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : null,
    };
  });

  return { ok: true, subscriptions };
});

// ─── adminCancelSubscription ──────────────────────────────────────────────────

export const adminCancelSubscription = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const subscriptionId = asStr(data.subscriptionId).trim();
  if (!subscriptionId) throw new HttpsError("invalid-argument", "subscriptionId is required.");

  const db = getDb();
  const subRef = db.collection("subscriptions").doc(subscriptionId);
  const subSnap = await subRef.get();
  if (!subSnap.exists) throw new HttpsError("not-found", "Subscription not found.");

  const sub = subSnap.data()!;
  const now = Timestamp.now();

  await subRef.set({ status: "cancelled", cancelledAt: now, updatedAt: now }, { merge: true });

  // Revoke membership
  if (sub.uid) {
    await db.collection("users").doc(sub.uid).set(
      { membership: "free", membershipExpiresAt: null, updatedAt: now },
      { merge: true }
    );
  }

  void writeAuditLog({
    adminUid,
    category: "other",
    action: "ADMIN_CANCEL_SUBSCRIPTION",
    targetId: sub.uid ?? subscriptionId,
    summary: `Admin cancelled subscription ${subscriptionId} for user ${sub.uid ?? "unknown"}`,
    details: { subscriptionId, uid: sub.uid, packageId: sub.packageId },
  });

  return { ok: true };
});
