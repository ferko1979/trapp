/**
 * membershipGuard.ts
 *
 * Scheduled and on-demand functions that verify membership status and revoke
 * access when payment lapses.
 *
 * Flow:
 *  1. Stripe webhooks (payments.ts) handle real-time events.
 *  2. This module acts as a safety net: runs daily and when manually triggered
 *     by an admin, sweeping all "paid" users and downgrading expired ones.
 *  3. adminSyncUserMembership lets admins pull live status from Stripe for a
 *     specific user and reconcile any discrepancies.
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { writeAuditLog } from "./adminAuditLog";

// ─── Grace periods ────────────────────────────────────────────────────────────

/** Days after membershipExpiresAt before we hard-revoke. */
const EXPIRY_HARD_REVOKE_GRACE_DAYS = 0;   // no additional grace beyond what's in the date

/** Days in past_due state before we force-revoke (Stripe normally fires
 *  customer.subscription.deleted itself, but this is a safety net). */
const PAST_DUE_FORCE_REVOKE_DAYS = 14;

// ─── Internal check ───────────────────────────────────────────────────────────

type RevokedEntry = {
  uid: string;
  email: string | null;
  levelId: string;
  reason: "expired" | "past_due_14d";
  membershipExpiresAt: string | null;
};

type CheckResult = {
  checkedAt: string;
  checked: number;
  active: number;
  revoked: number;
  revokedUsers: RevokedEntry[];
  errors: number;
};

export async function checkExpiredMembershipsImpl(): Promise<CheckResult> {
  const db  = getDb();
  const now = new Date();

  const result: CheckResult = {
    checkedAt: now.toISOString(),
    checked:   0,
    active:    0,
    revoked:   0,
    revokedUsers: [],
    errors:    0,
  };

  // Only users with a paid membership
  const snap = await db.collection("users").where("membership", "==", "paid").get();

  // Process in batches of 200 (each revocation = 2 writes; 200*2=400 < 500 limit)
  const BATCH_SIZE = 200;
  let batchOps: FirebaseFirestore.WriteBatch = db.batch();
  let opsInBatch = 0;

  async function flushBatch() {
    if (opsInBatch > 0) {
      await batchOps.commit();
      batchOps = db.batch();
      opsInBatch = 0;
    }
  }

  for (const doc of snap.docs) {
    const user = doc.data();
    const uid  = doc.id;
    result.checked++;

    try {
      // ── Determine if this user should be revoked ─────────────────────────

      const expiresAt: Date | null =
        user.membershipExpiresAt instanceof Timestamp
          ? user.membershipExpiresAt.toDate()
          : null;

      const pastDueSince: Date | null =
        user.pastDueSince instanceof Timestamp
          ? user.pastDueSince.toDate()
          : null;

      const cutoff = new Date(
        now.getTime() - EXPIRY_HARD_REVOKE_GRACE_DAYS * 24 * 60 * 60 * 1000
      );
      const pastDueCutoff = new Date(
        now.getTime() - PAST_DUE_FORCE_REVOKE_DAYS * 24 * 60 * 60 * 1000
      );

      // Condition 1: membershipExpiresAt is in the past
      const isExpired = expiresAt !== null && expiresAt < cutoff;

      // Condition 2: has been past_due for > 14 days (Stripe safety net)
      const isPastDueTooLong =
        user.subscriptionStatus === "past_due" &&
        pastDueSince !== null &&
        pastDueSince < pastDueCutoff;

      if (!isExpired && !isPastDueTooLong) {
        result.active++;
        continue;
      }

      const reason: RevokedEntry["reason"] = isExpired ? "expired" : "past_due_14d";

      // ── Revoke membership ────────────────────────────────────────────────

      batchOps.set(
        doc.ref,
        {
          levelId:            "free",
          membership:         "free",
          subscriptionStatus: user.subscriptionStatus ? "cancelled" : null,
          updatedAt:          FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      opsInBatch++;

      const changeRef = db.collection("level_changes").doc();
      batchOps.set(changeRef, {
        uid,
        toLevelId:   "free",
        createdAt:   FieldValue.serverTimestamp(),
        source:      "membership_guard",
        reason,
        previousLevelId: user.levelId ?? null,
        membershipExpiresAt: expiresAt ? Timestamp.fromDate(expiresAt) : null,
      });
      opsInBatch++;

      if (opsInBatch >= BATCH_SIZE * 2) await flushBatch();

      result.revoked++;
      result.revokedUsers.push({
        uid,
        email:                user.email ?? null,
        levelId:              user.levelId ?? "unknown",
        reason,
        membershipExpiresAt:  expiresAt ? expiresAt.toISOString() : null,
      });
    } catch (err) {
      logger.error("membershipGuard: error processing user", { uid, err });
      result.errors++;
    }
  }

  await flushBatch();

  // Audit log revocations
  for (const entry of result.revokedUsers) {
    void writeAuditLog({
      adminUid: "system_membership_guard",
      category: "users",
      action:   "MEMBERSHIP_REVOKED",
      targetId: entry.uid,
      summary:  `Membership revoked (${entry.reason}) — downgraded to free`,
      details:  entry,
    });
  }

  return result;
}

// ─── Scheduled daily check ────────────────────────────────────────────────────

export const scheduledMembershipCheck = onSchedule(
  {
    schedule: "every 24 hours",
    region:   "europe-west1",
    timeoutSeconds: 540,
  },
  async () => {
    logger.info("scheduledMembershipCheck: starting");
    const result = await checkExpiredMembershipsImpl();
    logger.info("scheduledMembershipCheck: complete", {
      checked: result.checked,
      revoked: result.revoked,
      errors:  result.errors,
    });
  }
);

// ─── adminVerifyMemberships — manual trigger + report ─────────────────────────

export const adminVerifyMemberships = onCall(async (request) => {
  requireAdmin(request);

  const result = await checkExpiredMembershipsImpl();

  return {
    ok:           true,
    checkedAt:    result.checkedAt,
    checked:      result.checked,
    active:       result.active,
    revoked:      result.revoked,
    errors:       result.errors,
    revokedUsers: result.revokedUsers,
  };
});

// ─── adminSyncUserMembership — reconcile one user against Stripe ──────────────

export const adminSyncUserMembership = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid  = typeof data.uid === "string" ? data.uid.trim() : "";

  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");

  const db = getDb();
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");

  const user           = userSnap.data()!;
  const subscriptionId = typeof user.stripeSubscriptionId === "string"
    ? user.stripeSubscriptionId : null;

  const firestoreStatus = {
    membership:          user.membership          ?? null,
    levelId:             user.levelId             ?? null,
    paymentType:         user.paymentType         ?? null,
    billingInterval:     user.billingInterval     ?? null,
    subscriptionStatus:  user.subscriptionStatus  ?? null,
    membershipExpiresAt: user.membershipExpiresAt instanceof Timestamp
      ? user.membershipExpiresAt.toMillis() : null,
    subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd instanceof Timestamp
      ? user.subscriptionCurrentPeriodEnd.toMillis() : null,
    pastDueSince: user.pastDueSince instanceof Timestamp
      ? user.pastDueSince.toMillis() : null,
    stripeSubscriptionId: user.stripeSubscriptionId ?? null,
    stripeCustomerId:     user.stripeCustomerId     ?? null,
  };

  // No subscription → return Firestore snapshot only
  if (!subscriptionId) {
    return {
      ok: true,
      uid,
      firestoreStatus,
      stripeStatus:  null,
      synced:        false,
      syncNote:      user.paymentType === "one_time"
        ? "One-time purchase — no Stripe subscription to sync"
        : "No stripeSubscriptionId found on user",
    };
  }

  // Load Stripe settings
  const settingsSnap = await db.collection("payment_settings").doc("stripe").get();
  const secretKey = typeof settingsSnap.data()?.secretKey === "string"
    ? (settingsSnap.data()!.secretKey as string) : "";

  if (!secretKey) {
    return {
      ok:             false,
      uid,
      firestoreStatus,
      stripeStatus:   null,
      synced:         false,
      syncNote:       "Stripe secret key not configured",
    };
  }

  // Query Stripe
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(secretKey);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sub: any;
  try {
    sub = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    return {
      ok:             false,
      uid,
      firestoreStatus,
      stripeStatus:   null,
      synced:         false,
      syncNote:       `Stripe API error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const stripeStatus = {
    id:                sub.id,
    status:            sub.status,
    currentPeriodEnd:  sub.current_period_end  ? sub.current_period_end * 1000  : null,
    currentPeriodStart: sub.current_period_start ? sub.current_period_start * 1000 : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    cancelAt:          sub.cancel_at ? sub.cancel_at * 1000 : null,
    interval:          sub.items?.data?.[0]?.price?.recurring?.interval ?? null,
  };

  // ── Reconcile Firestore with Stripe ──────────────────────────────────────

  const statusMap: Record<string, string> = {
    active:             "active",
    past_due:           "past_due",
    canceled:           "cancelled",
    unpaid:             "past_due",
    incomplete:         "incomplete",
    incomplete_expired: "cancelled",
    trialing:           "active",
    paused:             "paused",
  };
  const reconciledStatus = statusMap[sub.status] ?? sub.status;

  const update: Record<string, unknown> = {
    subscriptionStatus: reconciledStatus,
    updatedAt:          FieldValue.serverTimestamp(),
  };

  if (sub.current_period_end) {
    const periodEndMs  = sub.current_period_end * 1000;
    const gracePeriodMs = 3 * 24 * 60 * 60 * 1000;
    update.subscriptionCurrentPeriodEnd = Timestamp.fromDate(new Date(periodEndMs));
    update.membershipExpiresAt          = Timestamp.fromDate(new Date(periodEndMs + gracePeriodMs));
  }

  if (sub.cancel_at_period_end) {
    update.subscriptionStatus = "cancelling";
  }

  // Downgrade if Stripe says subscription is dead
  const isTerminated = ["canceled", "incomplete_expired"].includes(sub.status);
  if (isTerminated && user.membership === "paid") {
    update.levelId     = "free";
    update.membership  = "free";
    update.stripeSubscriptionId = null;

    await db.collection("level_changes").add({
      uid,
      toLevelId:   "free",
      createdAt:   FieldValue.serverTimestamp(),
      source:      "admin_sync_stripe",
      reason:      `stripe_status_${sub.status}`,
      stripeSubscriptionId: subscriptionId,
    });
  }

  await db.collection("users").doc(uid).set(update, { merge: true });

  void writeAuditLog({
    adminUid,
    category: "users",
    action:   "SYNC_STRIPE_MEMBERSHIP",
    targetId: uid,
    summary:  `Admin synced Stripe subscription — status: ${reconciledStatus}${isTerminated ? " → downgraded to free" : ""}`,
    details:  { uid, stripeStatus, update: { ...update, updatedAt: "serverTimestamp" } },
  });

  return {
    ok:             true,
    uid,
    firestoreStatus,
    stripeStatus,
    synced:         true,
    syncNote:       isTerminated
      ? `Subscription is ${sub.status} in Stripe — user downgraded to free`
      : `Synced OK — status: ${reconciledStatus}`,
    wasDowngraded:  isTerminated,
  };
});
