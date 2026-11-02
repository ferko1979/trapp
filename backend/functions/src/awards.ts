/**
 * Awards & Cards system
 *
 * Card types:
 *   card_time_deduction_5min — subtracts 5 min from trap deploy/disarm timers (one-time use, manual)
 *   card_streak_freeze        — protects the streak when exactly 1 login day is missed (auto-consumed on next login)
 *
 * Triggers:
 *   day1_login      — fires once on the very first login day, gives 3 time cards
 *   day1_hourly     — fires each hour the user has the app open on day 1 (up to 8 h)
 *   daily_streak    — fires on each consecutive day login; escalating rewards
 *
 * Streak reward schedule (time cards / freeze cards per streak day):
 *   Day 1  : 3 time cards
 *   Day 2  : 2 time + 5 bag
 *   Day 3  : 3 time + 50 XP
 *   Day 5  : 5 time
 *   Day 7  : 7 time + 100 XP + 10 bag + 1 freeze
 *   Day 10 : 5 time + 50 XP
 *   Day 14 : 10 time + 200 XP + 2 freeze
 *   Day 21 : 10 time + 20 bag + 1 freeze
 *   Day 30 : 15 time + 500 XP + 30 bag + 3 freeze
 *   Day 60 : 20 time + 1000 XP + 2 freeze
 *   Day 90 : 30 time + 2000 XP + 50 bag + 5 freeze
 *   other  : 1 time card / day (base)
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireAppCheck } from "./shared/appCheck";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CardType = "card_time_deduction_5min" | "card_streak_freeze";

export interface Card {
  id: string;
  type: CardType;
  earnedAt: Timestamp;
  earnedFrom: string;
  usedAt: Timestamp | null;
}

export interface UserInventory {
  cards: Card[];
  totalCardsEarned: number;
  totalCardsUsed: number;
  updatedAt: Timestamp;
}

export interface AwardResult {
  trigger: string;
  cardsGranted: number;
  freezeCardsGranted: number;
  xpGranted: number;
  bagRefillGranted: number;
  label: string;
  iconEmoji: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(dateA: string, dateB: string): number {
  return Math.round(
    (new Date(dateB).getTime() - new Date(dateA).getTime()) / 86_400_000
  );
}

/** Issue N cards of the given type to a user's inventory. */
async function issueCards(
  db: FirebaseFirestore.Firestore,
  uid: string,
  quantity: number,
  earnedFrom: string,
  cardType: CardType = "card_time_deduction_5min"
): Promise<Card[]> {
  const now = Timestamp.now();
  const cards: Card[] = Array.from({ length: quantity }, (_, i) => ({
    id: `${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
    type: cardType,
    earnedAt: now,
    earnedFrom,
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

  return cards;
}

/** Map streak day → award details (time cards + freeze cards + extras). */
function streakAwardForDay(day: number): {
  cards: number;
  freezeCards: number;
  xp: number;
  bagRefill: number;
  label: string;
  iconEmoji: string;
} {
  const base = { xp: 0, bagRefill: 0, freezeCards: 0 };
  if (day === 1)  return { ...base, cards: 3,                                    label: "First Login Bonus",  iconEmoji: "🎉" };
  if (day === 2)  return { ...base, cards: 2,  bagRefill: 5,                     label: "2-Day Streak",       iconEmoji: "🔥" };
  if (day === 3)  return { ...base, cards: 3,  xp: 50,                           label: "3-Day Streak",       iconEmoji: "🔥" };
  if (day === 5)  return { ...base, cards: 5,                                    label: "5-Day Streak",       iconEmoji: "⚡" };
  if (day === 7)  return { cards: 7,  xp: 100, bagRefill: 10, freezeCards: 1,    label: "Week Warrior",       iconEmoji: "🏆" };
  if (day === 10) return { ...base, cards: 5,  xp: 50,                           label: "10-Day Streak",      iconEmoji: "💥" };
  if (day === 14) return { ...base, cards: 10, xp: 200,       freezeCards: 2,    label: "Dedicated Hunter",   iconEmoji: "🎯" };
  if (day === 21) return { ...base, cards: 10, bagRefill: 20, freezeCards: 1,    label: "21-Day Streak",      iconEmoji: "🦅" };
  if (day === 30) return { cards: 15, xp: 500, bagRefill: 30, freezeCards: 3,    label: "Trap Legend",        iconEmoji: "👑" };
  if (day === 60) return { ...base, cards: 20, xp: 1000,      freezeCards: 2,    label: "60-Day Immortal",    iconEmoji: "⚔️" };
  if (day === 90) return { cards: 30, xp: 2000, bagRefill: 50, freezeCards: 5,   label: "90-Day God",         iconEmoji: "🌟" };
  if (day % 30 === 0) return { ...base, cards: 15,                               label: `${day}-Day Legend`,  iconEmoji: "👑" };
  if (day % 7  === 0) return { ...base, cards: 7,                                label: `${day}-Day Streak`,  iconEmoji: "🏆" };
  return { ...base, cards: 1,                                                     label: `Day ${day} Streak`,  iconEmoji: "🔥" };
}

/** Hourly award for day 1 (hours 1–8). */
function hourlyDay1Award(hour: number): { cards: number; label: string; iconEmoji: string } | null {
  if (hour < 1 || hour > 8) return null;
  const cards = hour <= 2 ? 1 : hour <= 4 ? 2 : hour <= 6 ? 1 : 2;
  return { cards, label: `Day 1 – Hour ${hour} Bonus`, iconEmoji: "⏰" };
}

async function applyBagRefillUnits(
  db: FirebaseFirestore.Firestore,
  uid: string,
  units: number
): Promise<void> {
  if (units <= 0) return;

  const invSnap = await db.collection("user_trap_inventory").where("uid", "==", uid).get();
  if (invSnap.empty) return;

  const depleted = invSnap.docs
    .map((d) => ({ ref: d.ref, data: d.data() }))
    .filter(({ data }) => {
      const count = typeof data.bagCount === "number" ? data.bagCount : 0;
      const max   = typeof data.maxBagSlots === "number" ? data.maxBagSlots : 2;
      return count < max;
    })
    .sort((a, b) => ((a.data.bagCount as number) ?? 0) - ((b.data.bagCount as number) ?? 0));

  if (depleted.length === 0) return;

  const batch = db.batch();
  let remaining = units;

  for (const { ref, data } of depleted) {
    if (remaining <= 0) break;
    const current = typeof data.bagCount === "number" ? data.bagCount : 0;
    const max     = typeof data.maxBagSlots === "number" ? data.maxBagSlots : 2;
    const add     = Math.min(remaining, max - current);
    if (add > 0) {
      batch.update(ref, { bagCount: current + add, updatedAt: FieldValue.serverTimestamp() });
      remaining -= add;
    }
  }

  await batch.commit();
}

// ── Cloud Functions ───────────────────────────────────────────────────────────

/**
 * Called on every app open (foreground).
 *
 * Streak freeze logic:
 *   - If exactly 1 day was missed and the user has an unused card_streak_freeze,
 *     the card is automatically consumed and the streak continues.
 *   - If 2+ days were missed the streak resets regardless of freeze cards.
 */
export const claimLoginReward = onCall(async (req) => {
  requireAppCheck(req);
  if (!req.auth) throw new HttpsError("unauthenticated", "Login required.");

  const uid = req.auth.uid;
  const db  = getDb();
  const today = todayDateString();

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");

  const u = userSnap.data()!;
  const lastLoginDate: string    = u.lastLoginDate    ?? "";
  const loginStreak: number      = u.loginStreak       ?? 0;
  const longestStreak: number    = u.longestStreak     ?? 0;
  const totalDaysPlayed: number  = u.totalDaysPlayed   ?? 0;
  const firstLoginDate: string   = u.firstLoginDate    ?? "";
  const streakRewardsGiven: number[] = u.streakRewardsGiven ?? [];

  const awardsGranted: AwardResult[] = [];

  if (lastLoginDate === today) {
    const invSnap = await db.collection("user_inventories").doc(uid).get();
    const inv = invSnap.data() as UserInventory | undefined;
    return {
      ok: true,
      alreadyClaimed: true,
      loginStreak,
      longestStreak,
      totalDaysPlayed,
      totalCards: (inv?.cards ?? []).filter((c) => !c.usedAt).length,
      awardsGranted: [],
      streakFrozen: false,
    };
  }

  // ── Determine new streak ───────────────────────────────────────────────────
  const isFirstEver = !lastLoginDate;
  let newStreak: number;
  let streakFrozen = false;
  let frozenCardId: string | null = null;

  if (isFirstEver) {
    newStreak = 1;
  } else {
    const daysMissed = daysBetween(lastLoginDate, today) - 1; // 0 = consecutive

    if (daysMissed === 0) {
      // Consecutive login
      newStreak = loginStreak + 1;
    } else if (daysMissed === 1) {
      // Exactly 1 day missed — check for freeze card
      const invSnap = await db.collection("user_inventories").doc(uid).get();
      const inv = invSnap.data() as UserInventory | undefined;
      const allCards: Card[] = inv?.cards ?? [];
      const freezeCard = allCards.find((c) => c.type === "card_streak_freeze" && !c.usedAt);

      if (freezeCard) {
        // Consume the freeze card in-place (preserve array order)
        const updatedCards = allCards.map((c) =>
          c.id === freezeCard.id ? { ...c, usedAt: Timestamp.now() } : c
        );
        await db.collection("user_inventories").doc(uid).update({
          cards: updatedCards,
          totalCardsUsed: FieldValue.increment(1),
          updatedAt: Timestamp.now(),
        });
        newStreak = loginStreak + 1;
        streakFrozen = true;
        frozenCardId = freezeCard.id;
      } else {
        newStreak = 1;
      }
    } else {
      // 2+ days missed — freeze cards cannot help
      newStreak = 1;
    }
  }

  const newLongest = Math.max(longestStreak, newStreak);
  const newTotal   = totalDaysPlayed + 1;
  const isDay1     = isFirstEver || !firstLoginDate;

  // ── Grant streak award ─────────────────────────────────────────────────────
  if (!streakRewardsGiven.includes(newStreak)) {
    const award = streakAwardForDay(newStreak);
    const promises: Promise<unknown>[] = [];

    if (award.cards > 0)
      promises.push(issueCards(db, uid, award.cards, `streak_day_${newStreak}`, "card_time_deduction_5min"));
    if (award.freezeCards > 0)
      promises.push(issueCards(db, uid, award.freezeCards, `streak_day_${newStreak}`, "card_streak_freeze"));
    if (award.xp > 0)
      promises.push(userRef.update({ xp: FieldValue.increment(award.xp) }));
    if (award.bagRefill > 0)
      promises.push(applyBagRefillUnits(db, uid, award.bagRefill));

    await Promise.all(promises);

    awardsGranted.push({
      trigger: `streak_day_${newStreak}`,
      cardsGranted: award.cards,
      freezeCardsGranted: award.freezeCards,
      xpGranted: award.xp,
      bagRefillGranted: award.bagRefill,
      label: award.label,
      iconEmoji: award.iconEmoji,
    });
  }

  // ── Persist ────────────────────────────────────────────────────────────────
  await userRef.update({
    lastLoginDate: today,
    loginStreak: newStreak,
    longestStreak: newLongest,
    totalDaysPlayed: newTotal,
    firstLoginDate: firstLoginDate || today,
    streakRewardsGiven: FieldValue.arrayUnion(newStreak),
    ...(isDay1 ? { day1StartTime: Timestamp.now(), hourlyAwardsGiven: [] } : {}),
  });

  const invSnap = await db.collection("user_inventories").doc(uid).get();
  const inv = invSnap.data() as UserInventory | undefined;

  return {
    ok: true,
    alreadyClaimed: false,
    loginStreak: newStreak,
    longestStreak: newLongest,
    totalDaysPlayed: newTotal,
    isDay1: !!isDay1,
    totalCards: (inv?.cards ?? []).filter((c) => !c.usedAt).length,
    awardsGranted,
    streakFrozen,
    frozenCardId,
  };
});

/** Called from the app every hour while on day 1. */
export const claimHourlyDay1Reward = onCall(async (req) => {
  requireAppCheck(req);
  if (!req.auth) throw new HttpsError("unauthenticated", "Login required.");

  const uid  = req.auth.uid;
  const hour = Number((req.data as { hour: number }).hour);
  if (!hour || hour < 1 || hour > 8) throw new HttpsError("invalid-argument", "hour must be 1–8.");

  const db      = getDb();
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");

  const u = userSnap.data()!;
  const today = todayDateString();
  const firstLoginDate: string    = u.firstLoginDate ?? "";
  const hourlyAwardsGiven: number[] = u.hourlyAwardsGiven ?? [];

  if (firstLoginDate !== today)
    throw new HttpsError("failed-precondition", "Hourly awards are only available on your first play day.");
  if (hourlyAwardsGiven.includes(hour))
    return { ok: true, alreadyClaimed: true, hour };

  const award = hourlyDay1Award(hour);
  if (!award) throw new HttpsError("invalid-argument", "No award for this hour.");

  await issueCards(db, uid, award.cards, `day1_hour_${hour}`, "card_time_deduction_5min");
  await userRef.update({ hourlyAwardsGiven: FieldValue.arrayUnion(hour) });

  return {
    ok: true,
    alreadyClaimed: false,
    hour,
    cardsGranted: award.cards,
    label: award.label,
    iconEmoji: award.iconEmoji,
  };
});

/**
 * Use a time-deduction card manually.
 * Freeze cards are consumed automatically by claimLoginReward, not here.
 */
export const useCard = onCall(async (req) => {
  requireAppCheck(req);
  if (!req.auth) throw new HttpsError("unauthenticated", "Login required.");

  const uid    = req.auth.uid;
  const data   = req.data as { cardId: string; context?: string };
  const cardId = data.cardId;
  if (!cardId) throw new HttpsError("invalid-argument", "cardId required.");

  const db  = getDb();
  const ref = db.collection("user_inventories").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "No inventory found.");

  const inv = snap.data() as UserInventory;
  const cards: Card[] = inv.cards ?? [];
  const cardIndex = cards.findIndex(
    (c) => c.id === cardId && c.type === "card_time_deduction_5min" && !c.usedAt
  );
  if (cardIndex === -1)
    throw new HttpsError("not-found", "Time-deduction card not found or already used.");

  const updatedCards = cards.map((c, i) =>
    i === cardIndex ? { ...c, usedAt: Timestamp.now() } : c
  );

  await ref.update({
    cards: updatedCards,
    totalCardsUsed: FieldValue.increment(1),
    updatedAt: Timestamp.now(),
  });

  return {
    ok: true,
    minutesDeducted: 5,
    cardId,
    context: data.context ?? "unknown",
  };
});

/** Returns the user's full inventory: all cards (both types), streak info. */
export const getUserInventory = onCall(async (req) => {
  requireAppCheck(req);
  if (!req.auth) throw new HttpsError("unauthenticated", "Login required.");

  const uid = req.auth.uid;
  const db  = getDb();

  const [invSnap, userSnap] = await Promise.all([
    db.collection("user_inventories").doc(uid).get(),
    db.collection("users").doc(uid).get(),
  ]);

  const inv  = (invSnap.data()  ?? {}) as Partial<UserInventory>;
  const user = (userSnap.data() ?? {}) as Record<string, unknown>;

  const allCards: Card[] = inv.cards ?? [];
  const unusedCards = allCards.filter((c) => !c.usedAt);
  const usedCards   = allCards.filter((c) =>  !!c.usedAt);

  return {
    ok: true,
    unusedCards,
    usedCards,
    totalCardsEarned: inv.totalCardsEarned ?? 0,
    totalCardsUsed:   inv.totalCardsUsed   ?? 0,
    loginStreak:      user.loginStreak     ?? 0,
    longestStreak:    user.longestStreak   ?? 0,
    totalDaysPlayed:  user.totalDaysPlayed ?? 0,
    lastLoginDate:    user.lastLoginDate   ?? null,
    hourlyAwardsGiven: user.hourlyAwardsGiven ?? [],
  };
});
