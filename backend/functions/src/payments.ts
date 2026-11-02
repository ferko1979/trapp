// Stripe is imported dynamically inside functions to avoid ESM/CJS namespace issues
// with NodeNext module resolution. Types are defined locally where needed.
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { writeAuditLog } from "./adminAuditLog";
import { sendPurchaseEmailInternal } from "./adminEmailAutomation";
import { durationDays } from "./revolut/payments";

// ─── Shared helpers ───────────────────────────────────────────────────────────

type StripeSettings = {
  secretKey: string;
  webhookSecret: string;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  enabled: boolean;
};

export async function loadStripeSettings(): Promise<StripeSettings> {
  const snap = await getDb().collection("payment_settings").doc("stripe").get();
  const d = snap.data() ?? {};
  return {
    secretKey: typeof d.secretKey === "string" ? d.secretKey : "",
    webhookSecret: typeof d.webhookSecret === "string" ? d.webhookSecret : "",
    currency: typeof d.currency === "string" ? d.currency : "EUR",
    successUrl: typeof d.successUrl === "string" ? d.successUrl : "",
    cancelUrl: typeof d.cancelUrl === "string" ? d.cancelUrl : "",
    enabled: d.enabled === true,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function makeStripe(secretKey: string): Promise<any> {
  const { default: Stripe } = await import("stripe");
  return new Stripe(secretKey);
}

/**
 * Calculate when a membership expires.
 *
 * For subscriptions: billing interval + 3-day grace so Stripe has
 * time to retry before our safety-net sweep fires.
 * For one-time: use the level's configured length.
 */
export function calcMembershipExpiresAt(
  now: Date,
  paymentType: string,        // "one_time" | "recurring"
  billingInterval: string,    // "month" | "year"  (only for recurring)
  levelLengthType: string,    // "days" | "months" | "years"
  levelLengthValue: number    // numeric value of the above
): Date {
  const d = new Date(now);

  if (paymentType === "one_time") {
    if (levelLengthValue <= 0) {
      // 0 length = permanent — set 100 years in future
      d.setFullYear(d.getFullYear() + 100);
      return d;
    }
    if (levelLengthType === "days")   d.setDate(d.getDate() + levelLengthValue);
    else if (levelLengthType === "years") d.setFullYear(d.getFullYear() + levelLengthValue);
    else d.setMonth(d.getMonth() + levelLengthValue); // default: months
  } else {
    // Recurring subscription
    if (billingInterval === "year") {
      d.setFullYear(d.getFullYear() + 1);
    } else {
      d.setMonth(d.getMonth() + 1);
    }
    // 3-day grace period: gives Stripe time to retry before we sweep
    d.setDate(d.getDate() + 3);
  }

  return d;
}

// ─── getPaymentConfig (public — for mobile app) ───────────────────────────────

export const getPaymentConfig = onCall(async () => {
  const db = getDb();
  const snap = await db.collection("payment_settings").doc("stripe").get();
  const d = snap.data() ?? {};

  return {
    ok: true,
    enabled: d.enabled === true,
    publishableKey: typeof d.publishableKey === "string" ? d.publishableKey : "",
    currency: typeof d.currency === "string" ? d.currency : "EUR",
    allowGooglePay: d.allowGooglePay !== false,
    allowApplePay: d.allowApplePay !== false,
  };
});

// Only our own hosting origins (and the configured success page's origin) may be
// used as the post-payment redirect, so the checkout can't bounce users to a phishing page.
function safeReturnUrl(candidate: string, configuredSuccessUrl?: string): string {
  if (!candidate) return "";
  const allowed = new Set(["https://playtrapnow.web.app", "https://playtrapnow.firebaseapp.com"]);
  try {
    if (configuredSuccessUrl) allowed.add(new URL(configuredSuccessUrl).origin);
    return allowed.has(new URL(candidate).origin) ? candidate : "";
  } catch {
    return "";
  }
}

/** Stripe recurring price interval for a package duration code. */
function stripeRecurring(duration: string): { interval: "day" | "week" | "month" | "year"; interval_count: number } {
  switch (duration) {
    case "1d":  return { interval: "day",   interval_count: 1 };
    case "7d":  return { interval: "week",  interval_count: 1 };
    case "30d": return { interval: "day",   interval_count: 30 };
    case "3m":  return { interval: "month", interval_count: 3 };
    case "6m":  return { interval: "month", interval_count: 6 };
    case "1y":  return { interval: "year",  interval_count: 1 };
    default:    return { interval: "month", interval_count: 1 };
  }
}

// ─── createCheckoutSession ────────────────────────────────────────────────────

export const createCheckoutSession = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Authentication required.");

  const data = (request.data ?? {}) as Record<string, unknown>;
  const packageId    = typeof data.packageId    === "string" ? data.packageId.trim()    : "";
  const discountCode = typeof data.discountCode === "string" ? data.discountCode.trim() : "";
  let levelId        = typeof data.levelId      === "string" ? data.levelId.trim()      : "";
  let paymentType: "recurring" | "one_time" = data.paymentType === "recurring" ? "recurring" : "one_time";
  const returnUrl    = typeof data.returnUrl    === "string" ? data.returnUrl.trim()    : "";
  // billingInterval: "month" (default) or "year" — only meaningful for recurring
  let billingInterval: "month" | "year" =
    data.billingInterval === "year" ? "year" : "month";

  const db = getDb();

  // The mobile app buys a payment package (price, duration and level come
  // from the package); the legacy web flow passes a levelId directly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pkg: Record<string, any> | null = null;
  if (packageId) {
    const pkgSnap = await db.collection("payment_packages").doc(packageId).get();
    if (!pkgSnap.exists || pkgSnap.data()?.isActive !== true) {
      throw new HttpsError("not-found", "Package not found.");
    }
    pkg = pkgSnap.data()!;
    levelId = typeof pkg.levelId === "string" ? pkg.levelId.trim() : "";
    paymentType = pkg.isRecurring === true ? "recurring" : "one_time";
    billingInterval = pkg.duration === "1y" ? "year" : "month";
  }

  if (!levelId) throw new HttpsError("invalid-argument", "levelId is required.");

  // Fetch level data
  const levelSnap = await db.collection("user_levels").doc(levelId).get();
  if (!levelSnap.exists) throw new HttpsError("not-found", "Level not found.");
  const level = levelSnap.data()!;

  if (!level.active) throw new HttpsError("failed-precondition", "This level is not available.");

  let priceAmount = typeof level.priceAmount === "number" ? level.priceAmount : 0;
  let appliedDiscount: string | null = null;
  if (pkg) {
    // Package prices are stored in minor units.
    let minor: number = typeof pkg.price === "number" ? pkg.price : 0;
    if (discountCode && Array.isArray(pkg.discounts)) {
      const disc = pkg.discounts.find(
        (d: Record<string, unknown>) =>
          d.isActive &&
          String(d.code ?? "").toUpperCase() === discountCode.toUpperCase() &&
          (!(d.validUntil instanceof Timestamp) || d.validUntil.toMillis() > Date.now()) &&
          (typeof d.maxUses !== "number" || Number(d.usedCount ?? 0) < (d.maxUses as number))
      );
      if (disc) {
        const pct = typeof disc.discountPercent === "number" ? disc.discountPercent : 0;
        minor = Math.round(minor * (1 - pct / 100));
        appliedDiscount = String(disc.code);
      }
    }
    priceAmount = minor / 100;
  }
  if (priceAmount <= 0) {
    throw new HttpsError(
      "invalid-argument",
      "This is a free level and does not require payment."
    );
  }

  // Fetch Stripe settings
  const settings = await loadStripeSettings();
  if (!settings.enabled)
    throw new HttpsError("failed-precondition", "Payments are currently disabled.");
  if (!settings.secretKey)
    throw new HttpsError("failed-precondition", "Payment gateway is not configured.");

  // Fetch user
  const userSnap = await db.collection("users").doc(uid).get();
  const userEmail =
    typeof userSnap.data()?.email === "string"
      ? (userSnap.data()!.email as string)
      : undefined;

  const stripe = await makeStripe(settings.secretKey);
  const currency = (
    pkg && typeof pkg.currency === "string" ? pkg.currency
      : typeof level.priceCurrency === "string" ? level.priceCurrency : settings.currency
  ).toLowerCase();

  const isRecurring = paymentType === "recurring";

  // Level membership length (used for one-time expires calculation)
  const levelLengthType =
    typeof level.membershipLengthType === "string" ? level.membershipLengthType : "months";
  const levelLengthValue =
    typeof level.membershipLengthValue === "number" ? level.membershipLengthValue : 1;

  // Pre-calculate membershipExpiresAt so we can store it alongside the payment record
  const membershipExpiresAt = pkg
    ? new Date(Date.now() + (durationDays(pkg.duration ?? "1m") + (isRecurring ? 3 : 0)) * 86400000)
    : calcMembershipExpiresAt(
        new Date(),
        paymentType,
        billingInterval,
        levelLengthType,
        levelLengthValue
      );
  const recurring = pkg ? stripeRecurring(pkg.duration ?? "1m") : { interval: billingInterval, interval_count: 1 };

  // Create pending payment record first
  const paymentRef = db.collection("payments").doc();
  await paymentRef.set({
    uid,
    email: userEmail ?? null,
    levelId,
    levelName: typeof level.name === "string" ? level.name : levelId,
    packageId: packageId || null,
    discountCode: appliedDiscount,
    amount: priceAmount,
    currency,
    paymentType,
    billingInterval: isRecurring ? billingInterval : null,
    status: "pending",
    stripeSessionId: null,
    stripePaymentIntentId: null,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const successUrl =
    safeReturnUrl(returnUrl, settings.successUrl) ||
    settings.successUrl ||
    "https://playtrapnow.web.app/payment/success";
  const cancelUrl =
    settings.cancelUrl || "https://playtrapnow.web.app/payment/cancel";

  // Build Stripe Checkout session
  // Google Pay and Apple Pay are automatically included by Stripe Checkout
  // when payment_method_types includes 'card'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionParams: Record<string, any> = {
    line_items: [
      {
        quantity: 1,
        price_data: isRecurring
          ? {
              currency,
              product_data: {
                name: billingInterval === "year"
                  ? `${level.name ?? levelId} — Yearly Subscription`
                  : `${level.name ?? levelId} — Monthly Subscription`,
                description: billingInterval === "year"
                  ? `Auto-renews every 12 months. Cancel any time.`
                  : `Auto-renews every 30 days. Cancel any time.`,
              },
              unit_amount: Math.round(priceAmount * 100),
              recurring,
            }
          : {
              currency,
              product_data: {
                name: `${level.name ?? levelId} — One-time`,
                description: `One-time membership purchase`,
              },
              unit_amount: Math.round(priceAmount * 100),
            },
      },
    ],
    mode: isRecurring ? "subscription" : "payment",
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    payment_method_types: ["card"],
    metadata: {
      uid,
      levelId,
      paymentType,
      billingInterval,
      paymentRecordId: paymentRef.id,
      packageId,
      // Store pre-calculated expiry so webhook can use it without re-computing
      membershipExpiresAtMs: String(membershipExpiresAt.getTime()),
    },
  };

  if (userEmail) sessionParams.customer_email = userEmail;

  if (isRecurring) {
    sessionParams.subscription_data = {
      metadata: { uid, levelId, paymentRecordId: paymentRef.id, billingInterval },
    };
  } else {
    sessionParams.payment_intent_data = {
      metadata: { uid, levelId, paymentRecordId: paymentRef.id },
    };
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  // Store session ID on payment record
  await paymentRef.update({
    stripeSessionId: session.id,
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info("Checkout session created", {
    uid,
    levelId,
    paymentType,
    billingInterval,
    sessionId: session.id,
  });

  return {
    ok: true,
    sessionId: session.id,
    url: session.url,
    paymentRecordId: paymentRef.id,
  };
});

// ─── getUserPaymentHistory ────────────────────────────────────────────────────

export const getUserPaymentHistory = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Authentication required.");

  const db = getDb();
  const snap = await db
    .collection("payments")
    .where("uid", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  const items = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      levelId: d.levelId ?? null,
      levelName: d.levelName ?? null,
      amount: typeof d.amount === "number" ? d.amount : 0,
      currency: typeof d.currency === "string" ? d.currency : "EUR",
      paymentType: typeof d.paymentType === "string" ? d.paymentType : "one_time",
      billingInterval: d.billingInterval ?? null,
      status: typeof d.status === "string" ? d.status : "pending",
      isRenewal: d.isRenewal === true,
      createdAtMs:
        d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : null,
    };
  });

  return { ok: true, items };
});

// ─── cancelSubscription ───────────────────────────────────────────────────────

export const cancelSubscription = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Authentication required.");

  const db = getDb();
  const userSnap = await db.collection("users").doc(uid).get();
  const subscriptionId =
    typeof userSnap.data()?.stripeSubscriptionId === "string"
      ? (userSnap.data()!.stripeSubscriptionId as string)
      : null;

  if (!subscriptionId)
    throw new HttpsError("not-found", "No active subscription found.");

  const settings = await loadStripeSettings();
  if (!settings.secretKey)
    throw new HttpsError("failed-precondition", "Payment gateway not configured.");

  const stripe = await makeStripe(settings.secretKey);

  // Cancel at period end (user keeps access until period ends)
  await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });

  await db.collection("users").doc(uid).set(
    { subscriptionStatus: "cancelling", updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  return { ok: true, cancelledAtPeriodEnd: true };
});

// ─── stripeWebhook (HTTP endpoint) ───────────────────────────────────────────

export const stripeWebhook = onRequest(
  { region: "europe-west1" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const sig = req.headers["stripe-signature"];
    if (!sig || typeof sig !== "string") {
      res.status(400).send("Missing stripe-signature header");
      return;
    }

    const db = getDb();
    const settingsSnap = await db
      .collection("payment_settings")
      .doc("stripe")
      .get();
    const d = settingsSnap.data() ?? {};
    const secretKey     = typeof d.secretKey     === "string" ? d.secretKey     : "";
    const webhookSecret = typeof d.webhookSecret === "string" ? d.webhookSecret : "";

    if (!secretKey || !webhookSecret) {
      logger.error("stripeWebhook: Stripe not configured");
      res.status(500).send("Payment gateway not configured");
      return;
    }

    const stripe = await makeStripe(secretKey);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let event: any;
    try {
      const rawBody = (req as unknown as { rawBody: Buffer }).rawBody;
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      logger.error("Webhook signature verification failed", err);
      res.status(400).send(
        `Webhook Error: ${err instanceof Error ? err.message : "Unknown"}`
      );
      return;
    }

    logger.info("Stripe webhook received", { type: event.type, id: event.id });

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = event.data.object as Record<string, any>;
      switch (event.type) {
        case "checkout.session.completed":
          await handleCheckoutCompleted(db, obj);
          break;
        case "invoice.payment_succeeded":
          await handleInvoiceSucceeded(db, obj);
          break;
        case "customer.subscription.updated":
          await handleSubscriptionUpdated(db, obj);
          break;
        case "customer.subscription.deleted":
          await handleSubscriptionDeleted(db, obj);
          break;
        case "invoice.payment_failed":
          await handleInvoiceFailed(db, obj);
          break;
        default:
          logger.info(`Unhandled webhook event: ${event.type}`);
      }
    } catch (err) {
      logger.error(`Error handling webhook ${event.type}`, err);
      // Return 200 anyway — Stripe retries on non-2xx, causing loops
    }

    res.json({ received: true, type: event.type });
  }
);

// ─── Webhook handlers ─────────────────────────────────────────────────────────

async function handleCheckoutCompleted(
  db: FirebaseFirestore.Firestore,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: Record<string, any>
): Promise<void> {
  const meta = (session.metadata ?? {}) as Record<string, string>;
  const { uid, levelId, paymentType, billingInterval, paymentRecordId, membershipExpiresAtMs } = meta;

  if (!uid || !levelId) {
    logger.error("checkout.session.completed: missing metadata", { sessionId: session.id });
    return;
  }

  const isRecurring = paymentType === "recurring";
  const interval = billingInterval === "year" ? "year" : "month";

  // Use stored expiry from metadata if available; else recalculate
  let membershipExpiresAt: Date;
  if (membershipExpiresAtMs && !isNaN(Number(membershipExpiresAtMs))) {
    membershipExpiresAt = new Date(Number(membershipExpiresAtMs));
  } else {
    // Fallback: look up level and recalculate
    const levelSnap = await db.collection("user_levels").doc(levelId).get();
    const level = levelSnap.data() ?? {};
    membershipExpiresAt = calcMembershipExpiresAt(
      new Date(),
      paymentType,
      interval,
      typeof level.membershipLengthType === "string" ? level.membershipLengthType : "months",
      typeof level.membershipLengthValue === "number" ? level.membershipLengthValue : 1
    );
  }

  // Update payment record
  if (paymentRecordId) {
    await db.collection("payments").doc(paymentRecordId).set(
      {
        status: "completed",
        stripeSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
        stripeSubscriptionId:
          typeof session.subscription === "string" ? session.subscription : null,
        stripeCustomerId:
          typeof session.customer === "string" ? session.customer : null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  // Update user membership
  const userUpdate: Record<string, unknown> = {
    levelId,
    membership: "paid",
    paymentType,
    billingInterval: isRecurring ? interval : null,
    membershipExpiresAt: Timestamp.fromDate(membershipExpiresAt),
    lastPaymentAt: FieldValue.serverTimestamp(),
    lastPaymentSessionId: session.id,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (isRecurring && typeof session.subscription === "string") {
    userUpdate.stripeSubscriptionId = session.subscription;
    userUpdate.stripeCustomerId =
      typeof session.customer === "string" ? session.customer : null;
    userUpdate.subscriptionStatus = "active";
    userUpdate.pastDueSince = null; // clear any previous past_due
  }

  await db.collection("users").doc(uid).set(userUpdate, { merge: true });

  // Level change record
  await db.collection("level_changes").add({
    uid,
    toLevelId: levelId,
    createdAt: FieldValue.serverTimestamp(),
    source: "stripe_payment",
    stripeSessionId: session.id,
    paymentType,
    billingInterval: isRecurring ? interval : null,
    membershipExpiresAt: Timestamp.fromDate(membershipExpiresAt),
  });

  void writeAuditLog({
    adminUid: "stripe_webhook",
    category: "users",
    action: "PAYMENT_COMPLETED",
    targetId: uid,
    summary: `Payment completed — level "${levelId}" (${isRecurring ? `${interval}ly subscription` : "one-time"}), expires ${membershipExpiresAt.toISOString()}`,
    details: { uid, levelId, sessionId: session.id, paymentType, billingInterval: interval, membershipExpiresAt: membershipExpiresAt.toISOString() },
  });

  // Send purchase confirmation email (fire-and-forget)
  const amountTotal = typeof session.amount_total === "number" ? session.amount_total : null;
  const sessionCurrency = typeof session.currency === "string" ? session.currency.toUpperCase() : "EUR";
  void sendPurchaseEmailInternal({
    uid,
    packageName: levelId,
    amount: amountTotal,
    currency: sessionCurrency,
    transactionId: session.id,
    membershipExpiresAt,
  }).catch((e) => logger.warn("sendPurchaseEmailInternal (stripe) failed", e));

  logger.info("checkout.session.completed: user level updated", { uid, levelId, membershipExpiresAt });
}

async function handleInvoiceSucceeded(
  db: FirebaseFirestore.Firestore,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoice: Record<string, any>
): Promise<void> {
  const subscriptionId =
    typeof invoice.subscription === "string" ? invoice.subscription : null;
  if (!subscriptionId) return;

  // Skip first invoice — already handled by checkout.session.completed
  if (invoice.billing_reason === "subscription_create") return;

  const userSnap = await db
    .collection("users")
    .where("stripeSubscriptionId", "==", subscriptionId)
    .limit(1)
    .get();

  if (userSnap.empty) {
    logger.warn("invoice.payment_succeeded: no user found", { subscriptionId });
    return;
  }

  const uid         = userSnap.docs[0].id;
  const userData    = userSnap.docs[0].data();
  const levelId     = typeof userData.levelId === "string" ? userData.levelId : "free";
  const billingInterval: "month" | "year" =
    userData.billingInterval === "year" ? "year" : "month";

  const amount   = typeof invoice.amount_paid === "number" ? invoice.amount_paid / 100 : 0;
  const currency = typeof invoice.currency    === "string" ? invoice.currency.toUpperCase() : "EUR";

  // Recalculate expiry from now
  // Prefer the billed period's end (packages may renew every 3/6 months);
  // the same 3-day grace as at checkout.
  const periodEnd = Number(invoice.lines?.data?.[0]?.period?.end ?? 0);
  const newExpiresAt = periodEnd > 0
    ? new Date((periodEnd + 3 * 86400) * 1000)
    : calcMembershipExpiresAt(new Date(), "recurring", billingInterval, "months", 1);

  // Create renewal payment record
  await db.collection("payments").add({
    uid,
    email: invoice.customer_email ?? null,
    levelId,
    levelName: null,
    amount,
    currency,
    paymentType: "recurring",
    billingInterval,
    status: "completed",
    isRenewal: true,
    stripeSessionId: null,
    stripePaymentIntentId:
      typeof invoice.payment_intent === "string" ? invoice.payment_intent : null,
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId:
      typeof invoice.customer === "string" ? invoice.customer : null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection("users").doc(uid).set(
    {
      membership: "paid",
      subscriptionStatus: "active",
      lastPaymentAt: FieldValue.serverTimestamp(),
      membershipExpiresAt: Timestamp.fromDate(newExpiresAt),
      pastDueSince: null, // clear any previous past_due state
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  logger.info("Subscription renewed", { uid, subscriptionId, levelId, newExpiresAt });
}

async function handleSubscriptionUpdated(
  db: FirebaseFirestore.Firestore,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscription: Record<string, any>
): Promise<void> {
  const subId = subscription.id as string;
  if (!subId) return;

  const userSnap = await db
    .collection("users")
    .where("stripeSubscriptionId", "==", subId)
    .limit(1)
    .get();

  if (userSnap.empty) {
    logger.warn("customer.subscription.updated: no user found", { subId });
    return;
  }

  const uid = userSnap.docs[0].id;

  // Map Stripe subscription status to our internal status
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
  const newStatus = statusMap[subscription.status as string] ?? subscription.status;

  // current_period_end is a Unix timestamp (seconds)
  const periodEndMs =
    typeof subscription.current_period_end === "number"
      ? subscription.current_period_end * 1000
      : null;

  const update: Record<string, unknown> = {
    subscriptionStatus: newStatus,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (periodEndMs) {
    // Store period end + 3-day grace as the authoritative expiry
    const periodEnd = new Date(periodEndMs + 3 * 24 * 60 * 60 * 1000);
    update.membershipExpiresAt   = Timestamp.fromDate(periodEnd);
    update.subscriptionCurrentPeriodEnd = Timestamp.fromDate(new Date(periodEndMs));
  }

  // If subscription is being cancelled at period end, reflect that
  if (subscription.cancel_at_period_end) {
    update.subscriptionStatus = "cancelling";
  }

  // If subscription is fully cancelled, downgrade immediately
  if (newStatus === "cancelled") {
    update.levelId    = "free";
    update.membership = "free";
    update.stripeSubscriptionId = null;

    await db.collection("level_changes").add({
      uid,
      toLevelId: "free",
      createdAt: FieldValue.serverTimestamp(),
      source: "stripe_subscription_cancelled_via_update",
      stripeSubscriptionId: subId,
    });
  }

  await db.collection("users").doc(uid).set(update, { merge: true });

  logger.info("Subscription updated", { uid, subId, newStatus, periodEndMs });
}

async function handleSubscriptionDeleted(
  db: FirebaseFirestore.Firestore,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscription: Record<string, any>
): Promise<void> {
  const subId = subscription.id as string;

  const userSnap = await db
    .collection("users")
    .where("stripeSubscriptionId", "==", subId)
    .limit(1)
    .get();

  if (userSnap.empty) {
    logger.warn("customer.subscription.deleted: no user found", { subId });
    return;
  }

  const uid = userSnap.docs[0].id;

  await db.collection("users").doc(uid).set(
    {
      levelId: "free",
      membership: "free",
      subscriptionStatus: "cancelled",
      stripeSubscriptionId: null,
      membershipExpiresAt: FieldValue.serverTimestamp(), // expired now
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await db.collection("level_changes").add({
    uid,
    toLevelId: "free",
    createdAt: FieldValue.serverTimestamp(),
    source: "stripe_subscription_deleted",
    stripeSubscriptionId: subId,
  });

  void writeAuditLog({
    adminUid: "stripe_webhook",
    category: "users",
    action: "SUBSCRIPTION_CANCELLED",
    targetId: uid,
    summary: `Subscription deleted by Stripe — user downgraded to free`,
    details: { uid, subscriptionId: subId },
  });

  logger.info("Subscription deleted: user downgraded to free", { uid, subId });
}

async function handleInvoiceFailed(
  db: FirebaseFirestore.Firestore,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoice: Record<string, any>
): Promise<void> {
  const subId =
    typeof invoice.subscription === "string" ? invoice.subscription : null;
  if (!subId) return;

  const userSnap = await db
    .collection("users")
    .where("stripeSubscriptionId", "==", subId)
    .limit(1)
    .get();

  if (userSnap.empty) return;

  const uid      = userSnap.docs[0].id;
  const userData = userSnap.docs[0].data();

  // Mark past_due; only set pastDueSince on first failure
  const pastDueSince =
    userData.subscriptionStatus === "past_due" && userData.pastDueSince
      ? userData.pastDueSince  // keep original timestamp
      : FieldValue.serverTimestamp(); // first time going past_due

  await db.collection("users").doc(uid).set(
    {
      subscriptionStatus: "past_due",
      pastDueSince,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Record a failed payment entry
  const amount   = typeof invoice.amount_due === "number" ? invoice.amount_due / 100 : 0;
  const currency = typeof invoice.currency === "string" ? invoice.currency.toUpperCase() : "EUR";

  await db.collection("payments").add({
    uid,
    email: invoice.customer_email ?? null,
    levelId: userData.levelId ?? null,
    levelName: null,
    amount,
    currency,
    paymentType: "recurring",
    billingInterval: userData.billingInterval ?? "month",
    status: "failed",
    isRenewal: true,
    stripeSessionId: null,
    stripePaymentIntentId:
      typeof invoice.payment_intent === "string" ? invoice.payment_intent : null,
    stripeSubscriptionId: subId,
    stripeCustomerId:
      typeof invoice.customer === "string" ? invoice.customer : null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.warn("Subscription payment failed — marked past_due", { uid, subId });
}
