/**
 * Admin functions for the Awards & Cards system.
 *
 * award_definitions/{id} — admin-editable definitions shown in the Awards panel.
 * user_inventories/{uid} — read-only from admin (view user cards, stats).
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RewardItem {
  type: "card_time_deduction" | "xp_bonus" | "bag_refill";
  quantity: number;
}

export interface AwardDefinition {
  id: string;
  name: string;
  description: string;
  iconEmoji: string;
  trigger: "day1_login" | "day1_hourly" | "daily_streak";
  triggerValue: number; // hour (1–8) for day1_hourly; streak day for daily_streak; 1 for day1_login
  rewards: RewardItem[];
  active: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

// ── Seed data ─────────────────────────────────────────────────────────────────

const DEFAULT_AWARDS: Omit<AwardDefinition, "id" | "createdAt" | "updatedAt">[] = [
  // Day 1 login bonus
  {
    name: "First Login Bonus",
    description: "Welcome to Trap! Here are 3 time-deduction cards to get you started.",
    iconEmoji: "🎉",
    trigger: "day1_login",
    triggerValue: 1,
    rewards: [{ type: "card_time_deduction", quantity: 3 }],
    active: true,
    sortOrder: 1,
  },

  // Day 1 hourly awards
  { name: "Hour 1 Explorer",      description: "You've been playing for 1 hour on your first day!",  iconEmoji: "⏰", trigger: "day1_hourly", triggerValue: 1, rewards: [{ type: "card_time_deduction", quantity: 1 }], active: true, sortOrder: 10 },
  { name: "Hour 2 Hunter",        description: "2 hours in — you're hooked! Keep it up.",           iconEmoji: "⏰", trigger: "day1_hourly", triggerValue: 2, rewards: [{ type: "card_time_deduction", quantity: 1 }], active: true, sortOrder: 11 },
  { name: "Hour 3 Trapper",       description: "3 hours of trapping — a natural!",                  iconEmoji: "⏰", trigger: "day1_hourly", triggerValue: 3, rewards: [{ type: "card_time_deduction", quantity: 2 }], active: true, sortOrder: 12 },
  { name: "Hour 4 Predator",      description: "4 hours in — your rivals should be worried.",       iconEmoji: "⏰", trigger: "day1_hourly", triggerValue: 4, rewards: [{ type: "card_time_deduction", quantity: 2 }], active: true, sortOrder: 13 },
  { name: "Hour 5 Strategist",    description: "5 hours played — master of the map!",              iconEmoji: "⏰", trigger: "day1_hourly", triggerValue: 5, rewards: [{ type: "card_time_deduction", quantity: 1 }, { type: "bag_refill", quantity: 5 }], active: true, sortOrder: 14 },
  { name: "Hour 6 Veteran",       description: "6 hours on day 1 — true dedication!",              iconEmoji: "⏰", trigger: "day1_hourly", triggerValue: 6, rewards: [{ type: "card_time_deduction", quantity: 1 }], active: true, sortOrder: 15 },
  { name: "Hour 7 Elite",         description: "7 hours of Trap? You're unstoppable.",              iconEmoji: "⏰", trigger: "day1_hourly", triggerValue: 7, rewards: [{ type: "card_time_deduction", quantity: 2 }], active: true, sortOrder: 16 },
  { name: "Hour 8 Legend",        description: "8 hours on day 1 — you are a Trap Legend already!",iconEmoji: "⏰", trigger: "day1_hourly", triggerValue: 8, rewards: [{ type: "card_time_deduction", quantity: 2 }], active: true, sortOrder: 17 },

  // Daily streak rewards
  { name: "Day 2 Streak",         description: "2 days in a row! Your rivals won't know what hit them.", iconEmoji: "🔥", trigger: "daily_streak", triggerValue: 2,  rewards: [{ type: "card_time_deduction", quantity: 2 }, { type: "bag_refill", quantity: 5 }],       active: true, sortOrder: 20 },
  { name: "Day 3 Streak",         description: "3-day streak! You're becoming a regular.",            iconEmoji: "🔥", trigger: "daily_streak", triggerValue: 3,  rewards: [{ type: "card_time_deduction", quantity: 3 }, { type: "xp_bonus", quantity: 50 }],        active: true, sortOrder: 21 },
  { name: "Day 4 Streak",         description: "4 days straight — impressive consistency!",           iconEmoji: "🔥", trigger: "daily_streak", triggerValue: 4,  rewards: [{ type: "card_time_deduction", quantity: 1 }],                                          active: true, sortOrder: 22 },
  { name: "5-Day Streak",         description: "5 days! You are a serial trapper.",                   iconEmoji: "⚡", trigger: "daily_streak", triggerValue: 5,  rewards: [{ type: "card_time_deduction", quantity: 5 }],                                          active: true, sortOrder: 23 },
  { name: "Day 6 Streak",         description: "Almost a full week — keep the streak going!",         iconEmoji: "🔥", trigger: "daily_streak", triggerValue: 6,  rewards: [{ type: "card_time_deduction", quantity: 1 }],                                          active: true, sortOrder: 24 },
  { name: "Week Warrior",         description: "7-day streak — a full week of domination!",           iconEmoji: "🏆", trigger: "daily_streak", triggerValue: 7,  rewards: [{ type: "card_time_deduction", quantity: 7 }, { type: "xp_bonus", quantity: 100 }, { type: "bag_refill", quantity: 10 }], active: true, sortOrder: 25 },
  { name: "Day 10 Streak",        description: "Double digits — you're part of the elite.",           iconEmoji: "💥", trigger: "daily_streak", triggerValue: 10, rewards: [{ type: "card_time_deduction", quantity: 5 }, { type: "xp_bonus", quantity: 50 }],        active: true, sortOrder: 26 },
  { name: "Dedicated Hunter",     description: "14-day streak — two full weeks of trapping!",         iconEmoji: "🎯", trigger: "daily_streak", triggerValue: 14, rewards: [{ type: "card_time_deduction", quantity: 10 }, { type: "xp_bonus", quantity: 200 }],       active: true, sortOrder: 27 },
  { name: "21-Day Champion",      description: "3 weeks straight — you're in another league.",        iconEmoji: "🦅", trigger: "daily_streak", triggerValue: 21, rewards: [{ type: "card_time_deduction", quantity: 10 }, { type: "bag_refill", quantity: 20 }],       active: true, sortOrder: 28 },
  { name: "Trap Legend",          description: "30-day streak — one month of consecutive play!",      iconEmoji: "👑", trigger: "daily_streak", triggerValue: 30, rewards: [{ type: "card_time_deduction", quantity: 15 }, { type: "xp_bonus", quantity: 500 }, { type: "bag_refill", quantity: 30 }], active: true, sortOrder: 29 },
  { name: "60-Day Immortal",      description: "60 days straight — you ARE Trap.",                    iconEmoji: "⚔️", trigger: "daily_streak", triggerValue: 60, rewards: [{ type: "card_time_deduction", quantity: 20 }, { type: "xp_bonus", quantity: 1000 }],      active: true, sortOrder: 30 },
  { name: "90-Day God",           description: "90-day streak — unprecedented dedication!",           iconEmoji: "🌟", trigger: "daily_streak", triggerValue: 90, rewards: [{ type: "card_time_deduction", quantity: 30 }, { type: "xp_bonus", quantity: 2000 }, { type: "bag_refill", quantity: 50 }], active: true, sortOrder: 31 },
];

// ── Admin functions ───────────────────────────────────────────────────────────

export const adminListAwardDefinitions = onCall(async (req) => {
  requireAdmin(req);
  const db = getDb();
  const snap = await db.collection("award_definitions").orderBy("sortOrder").get();
  const awards = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { ok: true, awards };
});

export const adminCreateAwardDefinition = onCall(async (req) => {
  requireAdmin(req);
  const db = getDb();
  const data = req.data as Omit<AwardDefinition, "id" | "createdAt" | "updatedAt">;
  const now = Date.now();
  const ref = await db.collection("award_definitions").add({ ...data, createdAt: now, updatedAt: now });
  return { ok: true, id: ref.id };
});

export const adminUpdateAwardDefinition = onCall(async (req) => {
  requireAdmin(req);
  const db = getDb();
  const { id, ...patch } = req.data as Partial<AwardDefinition> & { id: string };
  if (!id) throw new HttpsError("invalid-argument", "id required.");
  await db.collection("award_definitions").doc(id).update({ ...patch, updatedAt: Date.now() });
  return { ok: true };
});

export const adminDeleteAwardDefinition = onCall(async (req) => {
  requireAdmin(req);
  const db = getDb();
  const { id } = req.data as { id: string };
  if (!id) throw new HttpsError("invalid-argument", "id required.");
  await db.collection("award_definitions").doc(id).delete();
  return { ok: true };
});

export const adminSeedDefaultAwards = onCall(async (req) => {
  requireAdmin(req);
  const db = getDb();
  const now = Date.now();
  const batch = db.batch();
  let seeded = 0;

  for (const def of DEFAULT_AWARDS) {
    const existing = await db.collection("award_definitions")
      .where("trigger", "==", def.trigger)
      .where("triggerValue", "==", def.triggerValue)
      .limit(1).get();
    if (existing.empty) {
      const ref = db.collection("award_definitions").doc();
      batch.set(ref, { ...def, createdAt: now, updatedAt: now });
      seeded++;
    }
  }

  await batch.commit();
  return { ok: true, seeded };
});

export const adminGetUserInventory = onCall(async (req) => {
  requireAdmin(req);
  const db = getDb();
  const { uid } = req.data as { uid: string };
  if (!uid) throw new HttpsError("invalid-argument", "uid required.");

  const [invSnap, userSnap] = await Promise.all([
    db.collection("user_inventories").doc(uid).get(),
    db.collection("users").doc(uid).get(),
  ]);

  const inv  = invSnap.data()  ?? {};
  const user = userSnap.data() ?? {};
  const cards = (inv.cards ?? []) as Array<Record<string, unknown>>;

  return {
    ok: true,
    uid,
    unusedCards:      cards.filter((c) => !c.usedAt),
    usedCards:        cards.filter((c) => !!c.usedAt),
    totalCardsEarned: inv.totalCardsEarned ?? 0,
    totalCardsUsed:   inv.totalCardsUsed   ?? 0,
    loginStreak:      user.loginStreak     ?? 0,
    longestStreak:    user.longestStreak   ?? 0,
    totalDaysPlayed:  user.totalDaysPlayed ?? 0,
    lastLoginDate:    user.lastLoginDate   ?? null,
  };
});

/** Admin-level card grant (give cards to any user manually) */
export const adminGrantCards = onCall(async (req) => {
  requireAdmin(req);
  const db = getDb();
  const { uid, quantity, reason } = req.data as { uid: string; quantity: number; reason?: string };
  if (!uid) throw new HttpsError("invalid-argument", "uid required.");
  if (!quantity || quantity < 1 || quantity > 100) throw new HttpsError("invalid-argument", "quantity must be 1–100.");

  const now = Timestamp.now();
  const cards = Array.from({ length: quantity }, (_, i) => ({
    id: `admin_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
    type: "card_time_deduction_5min",
    earnedAt: now,
    earnedFrom: reason ?? "admin_grant",
    usedAt: null,
  }));

  const ref = db.collection("user_inventories").doc(uid);
  await ref.set(
    {
      cards: FieldValue.arrayUnion(...cards),
      totalCardsEarned: FieldValue.increment(quantity),
      updatedAt: now,
    },
    { merge: true }
  );

  return { ok: true, granted: quantity };
});
