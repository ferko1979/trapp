import { FieldValue, Transaction } from "firebase-admin/firestore";
import { normalizeTimeZone } from "./dates";
import { getDb } from "./firebase";

export async function getUserTimeZone(uid: string): Promise<string> {
  const db = getDb();
  const snap = await db.collection("users").doc(uid).get();
  return normalizeTimeZone(snap.data()?.timeZone, "Europe/Budapest");
}

export async function ensureUserDoc(
  uid: string,
  phoneNumber: string | null,
  email: string | null,
  displayName: string | null,
  platform: string,
  timeZone: string
) {
  const db = getDb();
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    await ref.set({
      membership: "free",
      firstName: null,
      lastName: null,
      displayName: displayName ?? phoneNumber ?? email ?? "Anonymous",
      phoneNumber,
      email,
      photoUrl: null,
      relationships: {},
      captureCount: 0,
      timesCaught: 0,
      timeZone,
      createdAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
      platforms: [platform],
      role: "user",
      activePenalty: null,
    });
    return;
  }

  const data = snap.data() ?? {};
  const platforms = Array.isArray(data.platforms) ? data.platforms : [];
  const updatedPlatforms = platforms.includes(platform)
    ? platforms
    : [...platforms, platform];

  await ref.set(
    {
      membership: typeof data.membership === "string" ? data.membership : "free",
      firstName: typeof data.firstName === "string" ? data.firstName : null,
      lastName: typeof data.lastName === "string" ? data.lastName : null,
      displayName:
        (typeof data.displayName === "string" && data.displayName.trim()) ||
        displayName ||
        phoneNumber ||
        email ||
        "Anonymous",
      phoneNumber: phoneNumber ?? data.phoneNumber ?? null,
      email: email ?? data.email ?? null,
      photoUrl: typeof data.photoUrl === "string" ? data.photoUrl : null,
      relationships:
        data.relationships && typeof data.relationships === "object"
          ? data.relationships
          : {},
      timeZone: normalizeTimeZone(data.timeZone, timeZone),
      lastSeenAt: FieldValue.serverTimestamp(),
      platforms: updatedPlatforms,
      captureCount: typeof data.captureCount === "number" ? data.captureCount : 0,
      timesCaught: typeof data.timesCaught === "number" ? data.timesCaught : 0,
      role: typeof data.role === "string" ? data.role : "user",
      activePenalty: data.activePenalty ?? null,
    },
    { merge: true }
  );
}

export async function ensureDailyState(
  tx: Transaction,
  uid: string,
  dateKey: string,
  timeZone: string
) {
  const db = getDb();
  const ref = db.collection("daily_state").doc(`${uid}_${dateKey}`);
  const snap = await tx.get(ref);

  if (!snap.exists) {
    tx.set(ref, {
      uid,
      dateKey,
      timeZone,
      trapsAvailable: 5,
      trapsUsed: 0,
      capturesToday: 0,
      penaltiesToday: 0,
      initializedAt: FieldValue.serverTimestamp(),
      lastUpdatedAt: FieldValue.serverTimestamp(),
    });

    return {
      ref,
      data: {
        trapsAvailable: 5,
        trapsUsed: 0,
        capturesToday: 0,
        penaltiesToday: 0,
      },
    };
  }

  return { ref, data: snap.data() ?? {} };
}
