/**
 * adminRecalculatePoints.ts
 *
 * Admin tool to rebuild a user's score fields from their raw history:
 *   – captureCount   (scoring captures they made)
 *   – timesCaught    (times they were caught)
 *   – xp             (sum of scoreValue for each scoring capture)
 *   – level / levelName (resolved from player_progression_levels)
 *
 * Two modes:
 *   adminRecalculateUserPoints({ uid })   → single user
 *   adminRecalculateUserPoints({})        → all users (efficient bulk scan)
 */

import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { writeAuditLog } from "./adminAuditLog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProgressionLevel {
  levelNumber: number;
  name: string;
  minXP: number;
}

export interface RecalcStats {
  xp: number;
  captureCount: number;
  timesCaught: number;
  trapsPlaced: number;
  disarmedTraps: number;
  capturedTraps: number;
  activeTraps: number;
  level: number;
  levelName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A capture is "scoring" (gives XP + increments captureCount) when:
 *   - scoringCapture === true (explicit), OR
 *   - scoringCapture is absent AND captureType is NOT "self" or "ally"
 *     (legacy captures before ally system were always scoring)
 */
function isScoringCapture(data: Record<string, unknown>): boolean {
  if (data.scoringCapture === true)  return true;
  if (data.scoringCapture === false) return false;
  const t = data.captureType as string | undefined;
  return t !== "self" && t !== "ally";
}

/** Load all active progression levels sorted by minXP descending. */
async function loadProgressionLevels(): Promise<ProgressionLevel[]> {
  const db = getDb();
  // Fetch all levels without compound filter (avoids composite index requirement),
  // then filter active and sort in memory.
  const snap = await db.collection("player_progression_levels").get();
  return snap.docs
    .map((d) => ({
      levelNumber: Number(d.data().levelNumber ?? 1),
      name:        String(d.data().name        ?? "Recruit"),
      minXP:       Number(d.data().minXP       ?? 0),
      active:      d.data().active !== false, // default true if field missing
    }))
    .filter((l) => l.active)
    .sort((a, b) => b.minXP - a.minXP); // descending minXP
}

/** Find the highest level whose minXP ≤ xp. */
function resolveLevel(
  xp: number,
  levels: ProgressionLevel[]
): { level: number; levelName: string } {
  // levels sorted desc by minXP — first match wins
  for (const l of levels) {
    if (xp >= l.minXP) return { level: l.levelNumber, levelName: l.name };
  }
  const lowest = levels[levels.length - 1];
  return lowest
    ? { level: lowest.levelNumber, levelName: lowest.name }
    : { level: 1, levelName: "Recruit" };
}

/**
 * Compute full stats for a single user by querying their captures + traps.
 * Used for single-user recalculation (3 parallel reads).
 */
async function computeStatsForUser(
  uid: string,
  levels: ProgressionLevel[]
): Promise<RecalcStats> {
  const db = getDb();

  const [capturesOwner, capturesCaught, trapsSnap] = await Promise.all([
    db.collection("captures").where("ownerUid",      "==", uid).get(),
    db.collection("captures").where("capturedUserId","==", uid).get(),
    db.collection("traps")   .where("ownerUid",      "==", uid).get(),
  ]);

  let xp           = 0;
  let captureCount = 0;
  for (const doc of capturesOwner.docs) {
    const d = doc.data() as Record<string, unknown>;
    if (isScoringCapture(d)) {
      captureCount++;
      xp += typeof d.scoreValue === "number" ? d.scoreValue : 1;
    }
  }

  const timesCaught = capturesCaught.size;

  let trapsPlaced   = trapsSnap.size;
  let disarmedTraps = 0;
  let capturedTraps = 0;
  let activeTraps   = 0;
  for (const doc of trapsSnap.docs) {
    const status = String(doc.data().status ?? "");
    if      (status === "disarmed") disarmedTraps++;
    else if (status === "captured") capturedTraps++;
    else if (status === "active")   activeTraps++;
  }

  const { level, levelName } = resolveLevel(xp, levels);
  return { xp, captureCount, timesCaught, trapsPlaced, disarmedTraps, capturedTraps, activeTraps, level, levelName };
}

// ─── Cloud Function ───────────────────────────────────────────────────────────

export const adminRecalculateUserPoints = onCall(
  { timeoutSeconds: 540 }, // up to 9 min for full-base recalc
  async (request) => {
    const adminUid = requireAdmin(request);
    const data     = (request.data ?? {}) as Record<string, unknown>;
    const targetUid =
      typeof data.uid === "string" && data.uid.trim()
        ? data.uid.trim()
        : null;

    const db     = getDb();
    const levels = await loadProgressionLevels();

    // ── Single-user mode ──────────────────────────────────────────────────────
    if (targetUid) {
      const userSnap = await db.collection("users").doc(targetUid).get();
      if (!userSnap.exists)
        throw new HttpsError("not-found", `User "${targetUid}" not found.`);

      const ud          = userSnap.data() ?? {};
      const displayName = String(ud.displayName ?? targetUid);

      const before = {
        xp:           Number(ud.xp           ?? 0),
        captureCount: Number(ud.captureCount ?? 0),
        timesCaught:  Number(ud.timesCaught  ?? 0),
        level:        Number(ud.level        ?? 1),
        levelName:    String(ud.levelName    ?? ""),
      };

      const stats = await computeStatsForUser(targetUid, levels);

      await db.collection("users").doc(targetUid).set(
        {
          xp:                      stats.xp,
          captureCount:            stats.captureCount,
          timesCaught:             stats.timesCaught,
          level:                   stats.level,
          levelName:               stats.levelName,
          pointsRecalculatedAt:    FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      void writeAuditLog({
        adminUid,
        category:   "users",
        action:     "RECALCULATE_USER_POINTS",
        targetId:   targetUid,
        targetName: displayName,
        summary: `Recalculated points for "${displayName}" (${targetUid}): XP ${before.xp} → ${stats.xp}, level ${before.level} → ${stats.level}`,
        details: { before, after: stats },
      });

      return { ok: true, recalculated: 1, uid: targetUid, displayName, before, after: stats };
    }

    // ── All-users bulk mode ───────────────────────────────────────────────────
    // Scan the three collections once, aggregate in memory, then batch-write.
    logger.info("adminRecalculateAllPoints: starting full collection scans");

    const [allCapturesSnap, allTrapsSnap, allUsersSnap] = await Promise.all([
      db.collection("captures").get(),
      db.collection("traps").get(),
      db.collection("users").get(),
    ]);

    // Aggregate captures
    const xpMap:           Record<string, number> = {};
    const captureCountMap: Record<string, number> = {};
    const timesCaughtMap:  Record<string, number> = {};

    for (const doc of allCapturesSnap.docs) {
      const d      = doc.data() as Record<string, unknown>;
      const owner  = String(d.ownerUid       ?? "");
      const victim = String(d.capturedUserId ?? "");

      if (owner && isScoringCapture(d)) {
        captureCountMap[owner] = (captureCountMap[owner] ?? 0) + 1;
        const sv = typeof d.scoreValue === "number" ? d.scoreValue : 1;
        xpMap[owner] = (xpMap[owner] ?? 0) + sv;
      }
      if (victim) {
        timesCaughtMap[victim] = (timesCaughtMap[victim] ?? 0) + 1;
      }
    }

    // Aggregate traps
    const trapsPlacedMap:   Record<string, number> = {};
    const disarmedTrapsMap: Record<string, number> = {};
    const capturedTrapsMap: Record<string, number> = {};

    for (const doc of allTrapsSnap.docs) {
      const d      = doc.data() as Record<string, unknown>;
      const owner  = String(d.ownerUid ?? "");
      if (!owner) continue;
      trapsPlacedMap[owner]   = (trapsPlacedMap[owner]   ?? 0) + 1;
      const status = String(d.status ?? "");
      if      (status === "disarmed") disarmedTrapsMap[owner] = (disarmedTrapsMap[owner] ?? 0) + 1;
      else if (status === "captured") capturedTrapsMap[owner] = (capturedTrapsMap[owner] ?? 0) + 1;
    }

    // Batch-update all users (max 400 ops per Firestore batch)
    const BATCH_SIZE = 400;
    const userDocs   = allUsersSnap.docs;
    let updated      = 0;

    for (let i = 0; i < userDocs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = userDocs.slice(i, i + BATCH_SIZE);

      for (const userDoc of chunk) {
        const uid = userDoc.id;
        const xp  = xpMap[uid] ?? 0;
        const { level, levelName } = resolveLevel(xp, levels);

        batch.set(
          userDoc.ref,
          {
            xp,
            captureCount:         captureCountMap[uid] ?? 0,
            timesCaught:          timesCaughtMap[uid]  ?? 0,
            level,
            levelName,
            pointsRecalculatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        updated++;
      }

      await batch.commit();
      logger.info(`adminRecalculateAllPoints: committed batch ${i / BATCH_SIZE + 1}`, { updated });
    }

    void writeAuditLog({
      adminUid,
      category:   "users",
      action:     "RECALCULATE_ALL_POINTS",
      targetId:   "ALL",
      targetName: "All Users",
      summary:    `Recalculated points for all ${updated} users from capture + trap history`,
      details: {
        usersUpdated:   updated,
        captureRecords: allCapturesSnap.size,
        trapRecords:    allTrapsSnap.size,
      },
    });

    logger.info("adminRecalculateAllPoints: complete", { updated });
    return { ok: true, recalculated: updated };
  }
);
