import { onCall } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";

function toDateKey(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const adminDashboardMetrics = onCall(async (request) => {
  requireAdmin(request);

  const db = getDb();
  const days = 30;
  const now = new Date();

  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i);
    keys.push(toDateKey(d));
  }

  const usersPerDay = new Map<string, number>(keys.map((k) => [k, 0]));
  const paymentsPerDay = new Map<string, number>(keys.map((k) => [k, 0]));
  const levelChangesPerDay = new Map<string, number>(keys.map((k) => [k, 0]));
  const trapsPlacedPerDay = new Map<string, number>(keys.map((k) => [k, 0]));
  const trapsCapturedPerDay = new Map<string, number>(keys.map((k) => [k, 0]));
  const trapsRevealedPerDay = new Map<string, number>(keys.map((k) => [k, 0]));
  const trapsDisarmedPerDay = new Map<string, number>(keys.map((k) => [k, 0]));

  const usersSnap = await db.collection("users").get();

  for (const doc of usersSnap.docs) {
    const createdAt = doc.data().createdAt?.toDate?.();
    if (!createdAt) continue;

    const key = toDateKey(createdAt);
    if (usersPerDay.has(key)) {
      usersPerDay.set(key, (usersPerDay.get(key) ?? 0) + 1);
    }
  }

  try {
    const paymentsSnap = await db.collection("payments").get();
    for (const doc of paymentsSnap.docs) {
      const createdAt = doc.data().createdAt?.toDate?.();
      if (!createdAt) continue;

      const key = toDateKey(createdAt);
      if (paymentsPerDay.has(key)) {
        paymentsPerDay.set(
          key,
          (paymentsPerDay.get(key) ?? 0) + Number(doc.data().amount ?? 0)
        );
      }
    }
  } catch {
    // leave as zero if payments collection does not exist yet
  }

  try {
    const levelChangesSnap = await db.collection("level_changes").get();
    for (const doc of levelChangesSnap.docs) {
      const createdAt = doc.data().createdAt?.toDate?.();
      if (!createdAt) continue;

      const key = toDateKey(createdAt);
      if (levelChangesPerDay.has(key)) {
        levelChangesPerDay.set(key, (levelChangesPerDay.get(key) ?? 0) + 1);
      }
    }
  } catch {
    // leave as zero if level_changes collection does not exist yet
  }

  try {
    const trapsSnap = await db.collection("traps").get();

    for (const doc of trapsSnap.docs) {
      const data = doc.data();

      const createdAt = data.createdAt?.toDate?.();
      if (createdAt) {
        const key = toDateKey(createdAt);
        if (trapsPlacedPerDay.has(key)) {
          trapsPlacedPerDay.set(key, (trapsPlacedPerDay.get(key) ?? 0) + 1);
        }
      }

      const capturedAt = data.capturedAt?.toDate?.();
      if (capturedAt) {
        const key = toDateKey(capturedAt);
        if (trapsCapturedPerDay.has(key)) {
          trapsCapturedPerDay.set(key, (trapsCapturedPerDay.get(key) ?? 0) + 1);
        }
      }

      const disarmedAt = data.disarmedAt?.toDate?.();
      if (disarmedAt) {
        const key = toDateKey(disarmedAt);
        if (trapsDisarmedPerDay.has(key)) {
          trapsDisarmedPerDay.set(key, (trapsDisarmedPerDay.get(key) ?? 0) + 1);
        }
      }

      const revealedTo = data.revealedTo;
      if (revealedTo && typeof revealedTo === "object") {
        for (const value of Object.values(revealedTo as Record<string, any>)) {
          const revealedAt = value?.revealedAt?.toDate?.();
          if (!revealedAt) continue;

          const key = toDateKey(revealedAt);
          if (trapsRevealedPerDay.has(key)) {
            trapsRevealedPerDay.set(key, (trapsRevealedPerDay.get(key) ?? 0) + 1);
          }
        }
      }
    }
  } catch {
    // leave as zero if traps collection does not exist yet
  }

  return {
    ok: true,
    usersPerDay: keys.map((date) => ({
      date,
      value: usersPerDay.get(date) ?? 0,
    })),
    paymentsPerDay: keys.map((date) => ({
      date,
      value: paymentsPerDay.get(date) ?? 0,
    })),
    levelChangesPerDay: keys.map((date) => ({
      date,
      value: levelChangesPerDay.get(date) ?? 0,
    })),
    trapsPlacedPerDay: keys.map((date) => ({
      date,
      value: trapsPlacedPerDay.get(date) ?? 0,
    })),
    trapsCapturedPerDay: keys.map((date) => ({
      date,
      value: trapsCapturedPerDay.get(date) ?? 0,
    })),
    trapsRevealedPerDay: keys.map((date) => ({
      date,
      value: trapsRevealedPerDay.get(date) ?? 0,
    })),
    trapsDisarmedPerDay: keys.map((date) => ({
      date,
      value: trapsDisarmedPerDay.get(date) ?? 0,
    })),
  };
});

// ─── Totals snapshot ──────────────────────────────────────────────────────────

export const adminDashboardTotals = onCall(async (request) => {
  requireAdmin(request);

  const db = getDb();

  // 30-day boundary
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const thirtyDaysAgoTs = Timestamp.fromDate(thirtyDaysAgo);

  // 7-day boundary
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  const sevenDaysAgoTs = Timestamp.fromDate(sevenDaysAgo);

  // Users
  const usersSnap = await db.collection("users").get();
  const totalUsers = usersSnap.size;
  let newUsers30d = 0;
  let newUsers7d = 0;
  for (const doc of usersSnap.docs) {
    const ca = doc.data().createdAt as Timestamp | undefined;
    if (ca && ca.toMillis() >= thirtyDaysAgoTs.toMillis()) newUsers30d++;
    if (ca && ca.toMillis() >= sevenDaysAgoTs.toMillis()) newUsers7d++;
  }

  // Traps
  let totalTraps = 0;
  let activeTraps = 0;
  let capturedTraps = 0;
  let disarmedTraps = 0;
  let trapsPlaced30d = 0;
  try {
    const trapsSnap = await db.collection("traps").get();
    totalTraps = trapsSnap.size;
    for (const doc of trapsSnap.docs) {
      const d = doc.data();
      const status = d.status as string | undefined;
      if (status === "active")   activeTraps++;
      if (status === "captured") capturedTraps++;
      if (status === "disarmed") disarmedTraps++;
      const ca = d.createdAt as Timestamp | undefined;
      if (ca && ca.toMillis() >= thirtyDaysAgoTs.toMillis()) trapsPlaced30d++;
    }
  } catch { /* collection may not exist */ }

  // Captures (from trap_captures collection if present, otherwise derived from traps)
  let totalCaptures = capturedTraps; // fallback
  try {
    const capturesSnap = await db.collection("trap_captures").get();
    totalCaptures = capturesSnap.size;
  } catch { /* use fallback */ }

  // Revenue
  let totalRevenue = 0;
  let revenue30d = 0;
  let revenueCount = 0;
  try {
    const paymentsSnap = await db.collection("payments").get();
    revenueCount = paymentsSnap.size;
    for (const doc of paymentsSnap.docs) {
      const d = doc.data();
      const amount = typeof d.amount === "number" ? d.amount : 0;
      totalRevenue += amount;
      const ca = d.createdAt as Timestamp | undefined;
      if (ca && ca.toMillis() >= thirtyDaysAgoTs.toMillis()) revenue30d += amount;
    }
  } catch { /* payments may not exist */ }

  return {
    ok: true,
    totalUsers,
    newUsers30d,
    newUsers7d,
    totalTraps,
    activeTraps,
    capturedTraps,
    disarmedTraps,
    trapsPlaced30d,
    totalCaptures,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    revenue30d: Math.round(revenue30d * 100) / 100,
    revenueCount,
  };
});