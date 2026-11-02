import { FieldValue, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getDb } from "./shared/firebase";
import { requireUser as requireAuth } from "./shared/appCheck";

export const refreshLeaderboard = onSchedule(
  {
    schedule: "every 10 minutes",
    timeZone: "Europe/Budapest",
  },
  async () => {
    const db = getDb();
    // Fetch top 200 by captureCount (existing index), then re-sort by xp in memory.
    // This avoids needing a new composite index while ensuring the real top 50 by xp appear.
    const snapshot = await db
      .collection("users")
      .orderBy("captureCount", "desc")
      .limit(200)
      .get();

    const sorted = snapshot.docs
      .map((doc: QueryDocumentSnapshot) => ({
        uid: doc.id,
        displayName: doc.data().displayName ?? "Anonymous",
        photoUrl: doc.data().photoUrl ?? null,
        captureCount: doc.data().captureCount ?? 0,
        timesCaught: doc.data().timesCaught ?? 0,
        xp: doc.data().xp ?? 0,
      }))
      .sort((a, b) => {
        if (b.xp !== a.xp) return b.xp - a.xp;
        if (b.captureCount !== a.captureCount) return b.captureCount - a.captureCount;
        return a.displayName.localeCompare(b.displayName);
      })
      .slice(0, 50);

    const top = sorted.map((item, index) => ({ rank: index + 1, ...item }));

    await db.collection("leaderboard").doc("global").set({
      top,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
);

/**
 * getGlobalLeaderboard — callable function that returns the top 50 players by XP.
 * Runs server-side (admin SDK) so it bypasses Firestore client security rules.
 * The app calls this instead of querying the users collection directly.
 */
export const getGlobalLeaderboard = onCall(async (request) => {
  requireAuth(request);
  const db = getDb();

  // Fetch top 200 by captureCount (existing index), re-sort by xp in memory.
  const snapshot = await db
    .collection("users")
    .orderBy("captureCount", "desc")
    .limit(200)
    .get();

  const sorted = snapshot.docs
    .map((doc: QueryDocumentSnapshot) => ({
      uid: doc.id,
      displayName: doc.data().displayName ?? "Anonymous",
      captureCount: Number(doc.data().captureCount ?? 0),
      xp: Number(doc.data().xp ?? 0),
    }))
    .filter((u) => u.captureCount > 0 || u.xp > 0)
    .sort((a, b) => {
      if (b.xp !== a.xp) return b.xp - a.xp;
      return b.captureCount - a.captureCount;
    })
    .slice(0, 50);

  return {
    ok: true,
    top: sorted.map((item, index) => ({ rank: index + 1, ...item })),
  };
});
