import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./firebase";

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getMembershipDefaults(levelData: Record<string, unknown> | undefined | null) {
  return {
    bagSize: asNumber(levelData?.bagSize, 5),
    dailyTrapAllowance: asNumber(levelData?.dailyTrapAllowance, 5),
  };
}

export async function refillUserInventoryToMaximum(uid: string) {
  const db = getDb();

  const userSnap = await db.collection("users").doc(uid).get();
  const userData = userSnap.data() ?? {};
  const levelId =
    typeof userData.levelId === "string" && userData.levelId.trim()
      ? userData.levelId.trim()
      : "free";

  const levelSnap = await db.collection("user_levels").doc(levelId).get();
  const levelData = levelSnap.data() ?? null;
  const membershipDefaults = getMembershipDefaults(levelData);

  const trapDefsSnap = await db
    .collection("trap_definitions")
    .where("enabled", "==", true)
    .get();

  const batch = db.batch();

  for (const doc of trapDefsSnap.docs) {
    const trapData = doc.data();
    const trapTypeId = doc.id;

    const trapMaxSlots = asNumber(trapData.maxBagSlots, 2);
    const refillHours = asNumber(trapData.refillHours, 24);

    const inventoryRef = db
      .collection("user_trap_inventory")
      .doc(`${uid}__${trapTypeId}`);

    batch.set(
      inventoryRef,
      {
        uid,
        trapTypeId,
        bagCount: trapMaxSlots,
        maxBagSlots: trapMaxSlots,
        refillHours,
        updatedAt: FieldValue.serverTimestamp(),
        lastRefillAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  const dailyStateSnap = await db
    .collection("daily_state")
    .where("uid", "==", uid)
    .get();

  for (const doc of dailyStateSnap.docs) {
    batch.set(
      doc.ref,
      {
        trapsAvailable: membershipDefaults.dailyTrapAllowance,
        trapsUsed: 0,
        updatedAt: FieldValue.serverTimestamp(),
        lastUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  batch.set(
    db.collection("users").doc(uid),
    {
      bagSize: membershipDefaults.bagSize,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();

  return {
    bagSize: membershipDefaults.bagSize,
    dailyTrapAllowance: membershipDefaults.dailyTrapAllowance,
  };
}