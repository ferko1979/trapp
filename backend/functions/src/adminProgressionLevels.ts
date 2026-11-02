/**
 * adminProgressionLevels.ts
 *
 * CRUD + seeding for XP-based player progression levels.
 * These are the in-game ranks a player earns through XP (score, captures, etc.)
 * and are completely separate from membership/payment tiers (user_levels).
 *
 * Firestore collection: player_progression_levels
 * Document structure:
 *   levelNumber : number   — 1-based, unique rank number (1 = Recruit)
 *   name        : string   — display name (e.g. "Sergeant")
 *   minXP       : number   — XP needed to reach this level
 *   badgeKey    : string   — asset key for the badge image (e.g. "badge_sergeant")
 *   description : string   — short flavour text shown in-app
 *   active      : boolean  — hidden from app when false
 *   createdAt   : Timestamp
 *   updatedAt   : Timestamp
 *
 * The Android app reads this collection in GameActivity.loadProgressionLevels()
 * and GameActivity.loadProgressionLevels() → player_progression_levels ordered
 * by levelNumber.
 */

import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { writeAuditLog } from "./adminAuditLog";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function optStr(v: unknown): string | null {
  const s = trim(v);
  return s || null;
}

function getNum(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function getBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

// ─── List ─────────────────────────────────────────────────────────────────────

export const adminListProgressionLevels = onCall(async (request) => {
  requireAdmin(request);

  const snap = await getDb()
    .collection("player_progression_levels")
    .orderBy("levelNumber", "asc")
    .get();

  return {
    ok: true,
    items: snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id:          doc.id,
        levelNumber: d.levelNumber,
        name:        d.name,
        minXP:       d.minXP,
        badgeKey:    d.badgeKey,
        description: d.description,
        active:      d.active,
        // Serialize Timestamps to ISO strings (Firestore Timestamps are not plain JSON)
        createdAt:   d.createdAt?.toDate?.()?.toISOString?.() ?? null,
        updatedAt:   d.updatedAt?.toDate?.()?.toISOString?.() ?? null,
      };
    }),
  };
});

// ─── Create ───────────────────────────────────────────────────────────────────

export const adminCreateProgressionLevel = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const levelNumber = getNum(data.levelNumber, 0);
  const name        = trim(data.name);
  const minXP       = getNum(data.minXP, 0);

  if (levelNumber < 1)
    throw new HttpsError("invalid-argument", "levelNumber must be ≥ 1.");
  if (!name)
    throw new HttpsError("invalid-argument", "name is required.");

  const db      = getDb();
  const docId   = `level_${levelNumber}`;
  const existing = await db.collection("player_progression_levels").doc(docId).get();
  if (existing.exists)
    throw new HttpsError("already-exists", `Level ${levelNumber} already exists.`);

  await db.collection("player_progression_levels").doc(docId).set({
    levelNumber,
    name,
    minXP,
    badgeKey:    optStr(data.badgeKey)    ?? `badge_level_${levelNumber}`,
    description: optStr(data.description) ?? "",
    active:      getBool(data.active, true),
    createdAt:   FieldValue.serverTimestamp(),
    updatedAt:   FieldValue.serverTimestamp(),
  });

  void writeAuditLog({
    adminUid,
    category: "levels",
    action:   "CREATE_PROGRESSION_LEVEL",
    targetId: docId,
    targetName: `${name} (Lv. ${levelNumber})`,
    summary:  `Created progression level ${levelNumber} "${name}" (min ${minXP} XP)`,
    details:  { levelNumber, name, minXP },
  });

  return { ok: true, id: docId };
});

// ─── Update ───────────────────────────────────────────────────────────────────

export const adminUpdateProgressionLevel = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const id = trim(data.id);
  if (!id) throw new HttpsError("invalid-argument", "id is required.");

  const db    = getDb();
  const snap  = await db.collection("player_progression_levels").doc(id).get();
  if (!snap.exists)
    throw new HttpsError("not-found", `Progression level "${id}" not found.`);

  const update: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if ("name"        in data) update.name        = trim(data.name);
  if ("minXP"       in data) update.minXP       = getNum(data.minXP, 0);
  if ("badgeKey"    in data) update.badgeKey     = optStr(data.badgeKey);
  if ("description" in data) update.description  = optStr(data.description) ?? "";
  if ("active"      in data) update.active       = getBool(data.active, true);

  await db.collection("player_progression_levels").doc(id).set(update, { merge: true });

  void writeAuditLog({
    adminUid,
    category: "levels",
    action:   "UPDATE_PROGRESSION_LEVEL",
    targetId: id,
    summary:  `Updated progression level "${id}"`,
    details:  { id, update },
  });

  return { ok: true, id };
});

// ─── Delete ───────────────────────────────────────────────────────────────────

export const adminDeleteProgressionLevel = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const id = trim((request.data as Record<string, unknown> | undefined)?.id);
  if (!id) throw new HttpsError("invalid-argument", "id is required.");

  await getDb().collection("player_progression_levels").doc(id).delete();

  void writeAuditLog({
    adminUid,
    category: "levels",
    action:   "DELETE_PROGRESSION_LEVEL",
    targetId: id,
    summary:  `Deleted progression level "${id}"`,
    details:  { id },
  });

  return { ok: true, id };
});

// ─── Seed ─────────────────────────────────────────────────────────────────────

/**
 * Seeds the default 12 military-inspired progression levels.
 *
 * XP earning reference (approximate):
 *  +50 XP  capturing another player's trap
 *  +20 XP  disarming a trap
 *  +10 XP  placing a trap successfully
 *  +10 XP  daily first-login bonus
 *  + 5 XP  being caught (participation)
 *
 * A very active player earns ~150–250 XP/day.
 * A casual player earns ~20–50 XP/day.
 *
 * Level thresholds are designed so:
 *  Lv. 1–4   reachable in days to weeks (keeps beginners engaged)
 *  Lv. 5–8   months of regular play
 *  Lv. 9–12  long-term milestones for dedicated players
 */
export const seedDefaultProgressionLevels = onCall(async (request) => {
  requireAdmin(request);

  const db  = getDb();
  const now = FieldValue.serverTimestamp();

  // prettier-ignore
  const levels = [
    { levelNumber:  1, name: "Recruit",          minXP:       0, description: "Just joined the field. Every expert started here.",            badgeKey: "badge_recruit"         },
    { levelNumber:  2, name: "Private",           minXP:     100, description: "You've taken your first steps. Keep setting those traps.",      badgeKey: "badge_private"         },
    { levelNumber:  3, name: "Lance Corporal",    minXP:     300, description: "Showing promise. Your trap-setting skills are improving.",       badgeKey: "badge_lance_corporal"  },
    { levelNumber:  4, name: "Corporal",          minXP:     750, description: "A reliable field operative. Others are starting to notice.",     badgeKey: "badge_corporal"        },
    { levelNumber:  5, name: "Sergeant",          minXP:   1_500, description: "Seasoned and strategic. You lead by example.",                  badgeKey: "badge_sergeant"        },
    { levelNumber:  6, name: "Staff Sergeant",    minXP:   3_000, description: "Tactical expertise earned through countless engagements.",       badgeKey: "badge_staff_sergeant"  },
    { levelNumber:  7, name: "Warrant Officer",   minXP:   6_000, description: "A specialist others turn to when the mission gets tough.",       badgeKey: "badge_warrant_officer" },
    { levelNumber:  8, name: "Lieutenant",        minXP:  12_000, description: "Commanding the map. Your presence is felt before you arrive.",   badgeKey: "badge_lieutenant"      },
    { levelNumber:  9, name: "Captain",           minXP:  25_000, description: "A veteran of hundreds of captures. Few can match your record.",  badgeKey: "badge_captain"         },
    { levelNumber: 10, name: "Major",             minXP:  50_000, description: "Elite status. You've mastered the art of the trap.",             badgeKey: "badge_major"           },
    { levelNumber: 11, name: "Colonel",           minXP: 100_000, description: "A legend in the field. Your tactics are studied by others.",     badgeKey: "badge_colonel"         },
    { levelNumber: 12, name: "General",           minXP: 250_000, description: "Supreme commander. You are the trap. Few have walked this path.", badgeKey: "badge_general"        },
  ];

  const batch = db.batch();
  for (const lvl of levels) {
    const ref = db.collection("player_progression_levels").doc(`level_${lvl.levelNumber}`);
    batch.set(
      ref,
      { ...lvl, active: true, createdAt: now, updatedAt: now },
      { merge: true }
    );
  }
  await batch.commit();

  return {
    ok:     true,
    seeded: levels.map((l) => `level_${l.levelNumber}`),
    levels: levels.map((l) => ({
      level: l.levelNumber,
      name:  l.name,
      minXP: l.minXP,
    })),
  };
});
