/**
 * claimAdReward.ts
 *
 * Called by the mobile app AFTER the user successfully watches a complete
 * rewarded ad during a trap placement session.
 *
 * Flow:
 *   1. App starts placement → trap_placement_sessions/{sessionId} created
 *   2. App shows "Watch an ad to reduce timer" prompt (NOT auto-play)
 *   3. User taps → ad plays
 *   4. Ad finishes (full view) → app calls claimAdReward({ sessionId })
 *   5. Backend validates limits, computes discount, updates session
 *   6. App gets { discountSeconds, newRequiredHoldSeconds } → updates timer
 *   7. App shows congratulation message
 *
 * If the user closes the ad early, the app must NOT call claimAdReward.
 *
 * Security note:
 *   By default (game_settings/global.requireSsv unset or true) only the
 *   signature-checked AdMob Server-Side Verification callback (`adMobSsvWebhook`)
 *   grants the reward; claimAdReward then just returns the session's current
 *   timer so the app can refresh after the ad closes. The app must pass
 *   ServerSideVerificationOptions customData = "<sessionId>:<uid>".
 *   Setting requireSsv: false re-enables the old client-trust grant (testing only).
 */

import { verify } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { getDb } from "./shared/firebase";
import { requireUser } from "./shared/appCheck";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface AdRewardSettings {
  rewardedAdEnabled: boolean;
  rewardedAdReductionType: string;   // "seconds" | "minutes" | "hours" | "percent"
  rewardedAdReductionValue: number;
  rewardedAdMaxUsesPerSession: number;
  requireSsv: boolean;
}

async function loadAdRewardSettings(): Promise<AdRewardSettings> {
  const snap = await getDb().collection("game_settings").doc("global").get();
  const d = snap.data() ?? {};
  return {
    rewardedAdEnabled:          Boolean(d.rewardedAdEnabled          ?? true),
    rewardedAdReductionType:    String( d.rewardedAdReductionType    ?? "seconds"),
    rewardedAdReductionValue:   Number( d.rewardedAdReductionValue   ?? 30),
    rewardedAdMaxUsesPerSession:Number( d.rewardedAdMaxUsesPerSession ?? 1),
    requireSsv:                 d.requireSsv !== false,
  };
}

/**
 * Convert the configured reward to a number of seconds to deduct.
 * For "percent", the deduction is calculated from requiredHoldSeconds.
 */
function rewardToSeconds(
  settings: AdRewardSettings,
  requiredHoldSeconds: number
): number {
  const v = settings.rewardedAdReductionValue;
  switch (settings.rewardedAdReductionType) {
    case "percent":  return Math.round(requiredHoldSeconds * (v / 100));
    case "minutes":  return Math.round(v * 60);
    case "hours":    return Math.round(v * 3600);
    case "seconds":
    default:         return Math.round(v);
  }
}

// ─── claimAdReward (client-trust) ─────────────────────────────────────────────

export const claimAdReward = onCall(async (request) => {
  const uid = requireUser(request);

  const data      = (request.data ?? {}) as Record<string, unknown>;
  const sessionId = typeof data.sessionId === "string" && data.sessionId.trim()
    ? data.sessionId.trim()
    : null;

  if (!sessionId) {
    throw new HttpsError("invalid-argument", "sessionId is required.");
  }

  const db         = getDb();
  const settings   = await loadAdRewardSettings();

  if (!settings.rewardedAdEnabled) {
    throw new HttpsError("failed-precondition", "Rewarded ads are currently disabled.");
  }

  // ── Load placement session ────────────────────────────────────────────────

  const sessionRef  = db.collection("trap_placement_sessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();

  if (!sessionSnap.exists) {
    throw new HttpsError("not-found", "Placement session not found.");
  }

  const session = sessionSnap.data() ?? {};

  if (session.uid !== uid) {
    throw new HttpsError("permission-denied", "This session does not belong to you.");
  }

  if (session.status === "completed") {
    throw new HttpsError("failed-precondition", "Placement already completed — reward not applicable.");
  }

  const currentUses = typeof session.adRewardUses === "number" ? session.adRewardUses : 0;
  const maxUses     = settings.rewardedAdMaxUsesPerSession;

  // ── SSV mode: the reward is granted by adMobSsvWebhook, never by the client ──

  if (settings.requireSsv) {
    return {
      ok:                     true,
      verifiedBy:             "ssv",
      discountSeconds:        0,
      newRequiredHoldSeconds: Number(session.requiredHoldSeconds ?? 0),
      usesRemaining:          maxUses > 0 ? Math.max(0, maxUses - currentUses) : -1,
      reductionType:          settings.rewardedAdReductionType,
      reductionValue:         settings.rewardedAdReductionValue,
    };
  }

  // ── Enforce per-session use limit ─────────────────────────────────────────

  if (maxUses > 0 && currentUses >= maxUses) {
    throw new HttpsError(
      "resource-exhausted",
      `You have already used all ${maxUses} ad reward(s) for this placement session.`
    );
  }

  // ── Compute discount ──────────────────────────────────────────────────────

  const requiredHoldSeconds = Number(session.requiredHoldSeconds ?? 0);
  const progressSeconds     = Number(session.progressSeconds     ?? 0);
  const remainingSeconds    = Math.max(0, requiredHoldSeconds - progressSeconds);

  if (remainingSeconds <= 0) {
    throw new HttpsError("failed-precondition", "Timer already at zero.");
  }

  let discountSeconds = rewardToSeconds(settings, requiredHoldSeconds);

  // Clamp: can't cut more than what's remaining
  if (discountSeconds > remainingSeconds) discountSeconds = remainingSeconds;
  // Must be at least 1 second
  if (discountSeconds < 1) discountSeconds = 1;

  const newRequiredHoldSeconds = Math.max(progressSeconds, requiredHoldSeconds - discountSeconds);

  // ── Write atomically ──────────────────────────────────────────────────────

  await sessionRef.update({
    requiredHoldSeconds: newRequiredHoldSeconds,
    adRewardUses:        FieldValue.increment(1),
    lastAdRewardAt:      FieldValue.serverTimestamp(),
  });

  const usesRemaining = maxUses > 0 ? maxUses - (currentUses + 1) : -1; // -1 = unlimited

  logger.info("claimAdReward: reward granted", {
    uid, sessionId, discountSeconds, newRequiredHoldSeconds, usesRemaining,
  });

  return {
    ok:                    true,
    discountSeconds,
    newRequiredHoldSeconds,
    usesRemaining,          // -1 means no limit configured
    reductionType:         settings.rewardedAdReductionType,
    reductionValue:        settings.rewardedAdReductionValue,
  };
});

// ─── AdMob SSV signature ──────────────────────────────────────────────────────
//
// AdMob signs everything before "&signature=" with ECDSA/SHA-256; the public
// keys are published at VERIFIER_KEYS_URL and rotate occasionally.

const VERIFIER_KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";
const KEY_CACHE_MS      = 12 * 60 * 60 * 1000;

let cachedKeys: Map<string, string> | null = null;
let cachedKeysAt = 0;

async function loadVerifierKeys(forceRefresh: boolean): Promise<Map<string, string>> {
  if (cachedKeys && !forceRefresh && Date.now() - cachedKeysAt < KEY_CACHE_MS) {
    return cachedKeys;
  }
  const res = await fetch(VERIFIER_KEYS_URL);
  if (!res.ok) throw new Error(`verifier keys HTTP ${res.status}`);
  const body = (await res.json()) as { keys?: Array<{ keyId: number | string; pem: string }> };
  cachedKeys = new Map((body.keys ?? []).map((k) => [String(k.keyId), k.pem]));
  cachedKeysAt = Date.now();
  return cachedKeys;
}

async function verifySsvSignature(rawQuery: string): Promise<boolean> {
  const sigIndex = rawQuery.indexOf("&signature=");
  if (sigIndex < 0) return false;

  const message = rawQuery.substring(0, sigIndex);
  const params  = new URLSearchParams(rawQuery.substring(sigIndex + 1));
  const sig     = params.get("signature");
  const keyId   = params.get("key_id");
  if (!sig || !keyId) return false;

  let pem = (await loadVerifierKeys(false)).get(keyId);
  if (!pem) pem = (await loadVerifierKeys(true)).get(keyId);
  if (!pem) return false;

  return verify(
    "sha256",
    Buffer.from(message, "utf-8"),
    { key: pem, dsaEncoding: "der" },
    Buffer.from(sig, "base64url")
  );
}

// ─── AdMob SSV webhook ───────────────────────────────────────────────────────
//
// Enable Server-Side Verification in AdMob console:
//   AdMob → Ad units → Rewarded → SSV settings → Callback URL:
//   https://adMobSsvWebhook-<hash>-ew.a.run.app
//
// AdMob will POST (GET) to this URL with:
//   ?ad_network=...&ad_unit=...&custom_data=<sessionId>:<uid>
//   &reward_amount=1&reward_item=...&transaction_id=...
//   &user_id=<uid>&timestamp=...&signature=...&key_id=...
//
// Set custom_data in the app as: `${sessionId}:${uid}` when requesting the ad.
// ─────────────────────────────────────────────────────────────────────────────

export const adMobSsvWebhook = onRequest({ cors: false }, async (req, res) => {
  const q = req.query as Record<string, string>;

  // AdMob always uses GET for SSV callbacks
  if (req.method !== "GET") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const rawQuery = req.originalUrl.split("?")[1] ?? "";
  let signatureOk = false;
  try {
    signatureOk = await verifySsvSignature(rawQuery);
  } catch (err) {
    logger.error("adMobSsvWebhook: could not verify signature", err);
    res.status(500).send("Verification unavailable"); // AdMob retries
    return;
  }
  if (!signatureOk) {
    logger.error("adMobSsvWebhook: invalid signature");
    res.status(401).send("Invalid signature");
    return;
  }

  const transactionId = q.transaction_id ?? "";
  const customData    = q.custom_data    ?? "";   // expected format: "sessionId:uid"
  const rewardAmount  = Number(q.reward_amount ?? 0);

  if (!transactionId || !customData || rewardAmount < 1) {
    res.status(400).send("Bad Request");
    return;
  }

  // Parse custom_data
  const parts = customData.split(":");
  if (parts.length < 2) {
    res.status(400).send("Invalid custom_data format. Expected 'sessionId:uid'.");
    return;
  }
  const [sessionId, uid] = parts;

  const db = getDb();

  // ── Idempotency: reject replayed transactions ─────────────────────────────
  const txRef  = db.collection("ad_ssv_transactions").doc(transactionId);
  const txSnap = await txRef.get();

  if (txSnap.exists) {
    // Already processed — respond 200 so AdMob doesn't retry
    logger.warn("adMobSsvWebhook: duplicate transaction", { transactionId });
    res.status(200).send("OK");
    return;
  }

  // ── Load settings & session ───────────────────────────────────────────────

  const settings    = await loadAdRewardSettings();
  const sessionRef  = db.collection("trap_placement_sessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();

  if (!sessionSnap.exists || sessionSnap.data()?.uid !== uid) {
    logger.error("adMobSsvWebhook: invalid session", { sessionId, uid });
    res.status(200).send("OK"); // still 200 to prevent AdMob retries
    return;
  }

  const session         = sessionSnap.data() ?? {};
  const currentUses     = Number(session.adRewardUses     ?? 0);
  const maxUses         = settings.rewardedAdMaxUsesPerSession;
  const requiredHold    = Number(session.requiredHoldSeconds ?? 0);
  const progress        = Number(session.progressSeconds     ?? 0);
  const remaining       = Math.max(0, requiredHold - progress);

  if (maxUses > 0 && currentUses >= maxUses) {
    logger.warn("adMobSsvWebhook: max uses exceeded", { sessionId, uid });
    res.status(200).send("OK");
    return;
  }

  let discountSeconds = rewardToSeconds(settings, requiredHold);
  if (discountSeconds > remaining)  discountSeconds = remaining;
  if (discountSeconds < 1)          discountSeconds = 1;

  const newRequired = Math.max(progress, requiredHold - discountSeconds);

  // ── Atomic write ──────────────────────────────────────────────────────────

  // create() fails if a concurrent retry already recorded this transaction.
  const batch = db.batch();
  batch.create(txRef, {
    sessionId, uid, transactionId,
    discountSeconds,
    processedAt: FieldValue.serverTimestamp(),
  });
  batch.update(sessionRef, {
    requiredHoldSeconds: newRequired,
    adRewardUses:        FieldValue.increment(1),
    lastAdRewardAt:      FieldValue.serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    logger.warn("adMobSsvWebhook: transaction already recorded", { transactionId, err });
    res.status(200).send("OK");
    return;
  }

  logger.info("adMobSsvWebhook: reward granted via SSV", {
    uid, sessionId, transactionId, discountSeconds,
  });

  res.status(200).send("OK");
});
