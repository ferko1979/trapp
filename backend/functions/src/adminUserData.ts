/**
 * adminUserData.ts
 *
 * Admin tools to inspect and clean up a specific user's game data:
 *   – View trap counts and score summary
 *   – Delete all traps placed by the user (all statuses)
 *   – Delete only active traps placed by the user
 *   – Reset in-game scores (captureCount, timesCaught, XP, level)
 */

import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { writeAuditLog } from "./adminAuditLog";
import { getUserTimeZone } from "./shared/user";
import { getDatePartsForTimezone } from "./shared/dates";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireString(v: unknown, field: string): string {
  if (typeof v !== "string" || !v.trim())
    throw new HttpsError("invalid-argument", `${field} is required.`);
  return v.trim();
}

/**
 * Resolves an arbitrary user identifier (UID, @username, or email) to a UID.
 *
 * Resolution order:
 *  1. If it contains "@"      → email lookup in `users` collection
 *  2. If it starts with "@"   → strip "@" and treat as username
 *  3. Try `usernames/{lower}` → username doc lookup
 *  4. Fall back to direct `users/{input}` → UID lookup
 */
async function resolveUid(input: string): Promise<string> {
  const db = getDb();
  const trimmed = input.trim();

  // ── Email lookup ──────────────────────────────────────────────────────────
  if (trimmed.includes("@")) {
    const emailLower = trimmed.toLowerCase();
    const snap = await db
      .collection("users")
      .where("email", "==", emailLower)
      .limit(1)
      .get();
    if (!snap.empty) return snap.docs[0].id;

    // Some accounts store email with original casing — try a second pass
    const snap2 = await db
      .collection("users")
      .where("email", "==", trimmed)
      .limit(1)
      .get();
    if (!snap2.empty) return snap2.docs[0].id;

    throw new HttpsError("not-found", `No user found with email "${trimmed}".`);
  }

  // ── Username lookup (strip leading @ if present) ──────────────────────────
  const candidate = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const usernameLower = candidate.toLowerCase();
  const usernameDoc = await db.collection("usernames").doc(usernameLower).get();
  if (usernameDoc.exists) {
    const uid = usernameDoc.data()?.uid;
    if (typeof uid === "string" && uid) return uid;
  }

  // ── Direct UID lookup (fallback) ──────────────────────────────────────────
  const userDoc = await db.collection("users").doc(candidate).get();
  if (userDoc.exists) return candidate;

  throw new HttpsError(
    "not-found",
    `No user found for "${trimmed}". Try a full UID, exact username, or email address.`
  );
}

// ─── Get user game data summary ───────────────────────────────────────────────

export const adminGetUserGameData = onCall(async (request) => {
  requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const query = requireString(data.query ?? data.uid, "query");

  const db = getDb();

  // Resolve whatever the admin typed → a Firestore UID
  const uid = await resolveUid(query);

  // Get today's daily state for this user
  const timeZone = await getUserTimeZone(uid);
  const { dateKey } = getDatePartsForTimezone(timeZone);
  const dailyRef = db.collection("daily_state").doc(`${uid}_${dateKey}`);

  const [userSnap, allTrapsSnap, dailySnap] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("traps").where("ownerUid", "==", uid).get(),
    dailyRef.get(),
  ]);

  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");

  const user = userSnap.data() ?? {};
  const daily = dailySnap.data() ?? {};

  const trapsByStatus: Record<string, number> = {};
  for (const doc of allTrapsSnap.docs) {
    const status = String(doc.data().status ?? "unknown");
    trapsByStatus[status] = (trapsByStatus[status] ?? 0) + 1;
  }

  return {
    ok: true,
    uid,
    displayName: user.displayName ?? null,
    username: user.username ?? null,
    // Scores
    xp:           typeof user.xp           === "number" ? user.xp           : 0,
    level:        typeof user.level        === "number" ? user.level        : 1,
    levelName:    typeof user.levelName    === "string" ? user.levelName    : "",
    captureCount: typeof user.captureCount === "number" ? user.captureCount : 0,
    timesCaught:  typeof user.timesCaught  === "number" ? user.timesCaught  : 0,
    // Today's placement quota
    trapsAvailable: typeof daily.trapsAvailable === "number" ? daily.trapsAvailable : 5,
    trapsUsed:      typeof daily.trapsUsed      === "number" ? daily.trapsUsed      : 0,
    dateKey,
    // Traps
    totalTraps: allTrapsSnap.size,
    trapsByStatus,
  };
});

// ─── Delete user traps ────────────────────────────────────────────────────────

/**
 * Deletes all traps owned by the user (or only active ones if activeOnly=true).
 * Processes in batches of 400 to stay under the Firestore 500-op batch limit.
 */
export const adminDeleteUserTraps = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const query      = requireString(data.query ?? data.uid, "query");
  const activeOnly = data.activeOnly === true;

  const db = getDb();

  const uid = await resolveUid(query);

  // Verify user exists
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");
  const displayName = userSnap.data()?.displayName ?? uid;

  // Build traps query
  let trapsQuery = db.collection("traps").where("ownerUid", "==", uid);
  if (activeOnly) trapsQuery = trapsQuery.where("status", "==", "active") as typeof trapsQuery;

  const trapsSnap = await trapsQuery.get();
  if (trapsSnap.empty) {
    return { ok: true, deleted: 0, message: "No traps found to delete." };
  }

  // Delete in batches of 400
  const BATCH_SIZE = 400;
  let deleted = 0;
  const docs = trapsSnap.docs;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);
    for (const doc of chunk) batch.delete(doc.ref);
    await batch.commit();
    deleted += chunk.length;
  }

  void writeAuditLog({
    adminUid,
    category: "users",
    action:   activeOnly ? "DELETE_USER_ACTIVE_TRAPS" : "DELETE_USER_ALL_TRAPS",
    targetId: uid,
    targetName: String(displayName),
    summary: `Deleted ${deleted} ${activeOnly ? "active " : ""}trap(s) for user "${displayName}" (${uid})`,
    details: { uid, activeOnly, deleted },
  });

  return { ok: true, deleted };
});

// ─── Reset user scores ────────────────────────────────────────────────────────

/**
 * Resets the user's in-game score fields to zero / starting values.
 * Does NOT delete traps or captures history.
 */
export const adminResetUserScores = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const query = requireString(data.query ?? data.uid, "query");

  const db = getDb();

  const uid = await resolveUid(query);

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");
  const displayName = userSnap.data()?.displayName ?? uid;

  // Snapshot current values for the audit log
  const before = {
    xp:           userSnap.data()?.xp           ?? 0,
    level:        userSnap.data()?.level        ?? 1,
    levelName:    userSnap.data()?.levelName    ?? "",
    captureCount: userSnap.data()?.captureCount ?? 0,
    timesCaught:  userSnap.data()?.timesCaught  ?? 0,
  };

  await db.collection("users").doc(uid).set(
    {
      xp:           0,
      level:        1,
      levelName:    "",
      captureCount: 0,
      timesCaught:  0,
      updatedAt:    FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  void writeAuditLog({
    adminUid,
    category: "users",
    action:   "RESET_USER_SCORES",
    targetId: uid,
    targetName: String(displayName),
    summary: `Reset scores for user "${displayName}" (${uid})`,
    details: { uid, before },
  });

  return { ok: true, uid, before };
});

// ─── Player location snapshot (admin map view) ────────────────────────────────

/**
 * Returns a point-in-time snapshot of all player locations for the admin map.
 * Capped at 500 entries. The caller polls this at a configurable interval —
 * there is no live Firestore subscription; results are consistent only at
 * the moment the call is made.
 */
export const adminGetPlayerLocations = onCall(async (request) => {
  requireAdmin(request);
  const db = getDb();

  const snap = await db.collection("player_locations").limit(500).get();
  if (snap.empty) return { ok: true, players: [] };

  // Batch-fetch user profiles to resolve username + ageGroup
  const userSnaps = await Promise.all(
    snap.docs.map((doc) => db.collection("users").doc(doc.id).get())
  );

  const players = snap.docs.map((doc, i) => {
    const d = doc.data();
    const u = userSnaps[i].data() ?? {};
    const lat = typeof d.lat === "number" ? d.lat : null;
    const lng = typeof d.lng === "number" ? d.lng : null;
    return {
      uid: doc.id,
      lat,
      lng,
      username: typeof u.username === "string" && u.username ? u.username : doc.id.slice(0, 8),
      ageGroup: typeof u.ageGroup === "string" ? u.ageGroup : "adult",
      updatedAtMs: d.updatedAt?.toMillis?.() ?? null,
    };
  }).filter((p) => p.lat !== null && p.lng !== null);

  return { ok: true, players };
});
