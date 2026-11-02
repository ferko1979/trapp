import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { writeAuditLog } from "./adminAuditLog";

type MembershipLengthType = "days" | "months" | "years";

function getTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getOptionalString(value: unknown): string | null {
  const trimmed = getTrimmedString(value);
  return trimmed || null;
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeMembershipLengthType(value: unknown): MembershipLengthType {
  return ["days", "months", "years"].includes(String(value))
    ? (value as MembershipLengthType)
    : "months";
}

export const adminListLevels = onCall(async (request) => {
  requireAdmin(request);

  const snap = await getDb()
    .collection("user_levels")
    .orderBy("name", "asc")
    .get();

  return {
    ok: true,
    items: snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })),
  };
});

export const adminCreateLevel = onCall(async (request) => {
  const adminUid = requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const id = getTrimmedString(data.id);
  const name = getTrimmedString(data.name);

  if (!id) {
    throw new HttpsError("invalid-argument", "id is required.");
  }

  if (!name) {
    throw new HttpsError("invalid-argument", "name is required.");
  }

  await getDb()
    .collection("user_levels")
    .doc(id)
    .set(
      {
        name,
        active: getBoolean(data.active, true),
        priceAmount: getNumber(data.priceAmount, 0),
        priceCurrency: getTrimmedString(data.priceCurrency) || "EUR",
        membershipLengthType: normalizeMembershipLengthType(data.membershipLengthType),
        membershipLengthValue: getNumber(data.membershipLengthValue, 1),
        dailyTrapAllowance: getNumber(data.dailyTrapAllowance, 5),
        bagWeightCapacity: getNumber(data.bagWeightCapacity, 5),
        placementReductionPercent: getNumber(data.placementReductionPercent, 0),
        disarmReductionPercent: getNumber(data.disarmReductionPercent, 0),
        refillReductionPercent: getNumber(data.refillReductionPercent, 0),
        // How far the player can zoom out on the map to see traps.
        // mapVisibilityRadiusMeters: radius in metres (admin-friendly).
        //   Backend converts this to a Google Maps minZoomPreference value.
        // mapMinZoom: explicit zoom override (takes precedence over radius).
        //   Omit to let the backend derive zoom from the radius.
        mapVisibilityRadiusMeters: getNumber(data.mapVisibilityRadiusMeters, 2000),
        ...(typeof data.mapMinZoom === "number" && Number.isFinite(data.mapMinZoom as number)
          ? { mapMinZoom: data.mapMinZoom as number }
          : {}),
        rangeMultiplier: getNumber(data.rangeMultiplier, 1),
        leaveMultiplier: getNumber(data.leaveMultiplier, 1),
        disableBannerAd: getBoolean(data.disableBannerAd, false),
        disableInterstitialAd: getBoolean(data.disableInterstitialAd, false),
        disableRewardedAd: getBoolean(data.disableRewardedAd, false),
        description: getOptionalString(data.description),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  void writeAuditLog({
    adminUid,
    category: "levels",
    action: "CREATE_LEVEL",
    targetId: id,
    targetName: name,
    summary: `Created membership level "${name}" (${id})`,
    details: { id, data },
  });

  return { ok: true, id };
});

export const adminUpdateLevel = onCall(async (request) => {
  const adminUid = requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const id = getTrimmedString(data.id);

  if (!id) {
    throw new HttpsError("invalid-argument", "id is required.");
  }

  const updatePayload: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if ("name" in data) updatePayload.name = getTrimmedString(data.name);
  if ("active" in data) updatePayload.active = getBoolean(data.active, true);
  if ("priceAmount" in data) updatePayload.priceAmount = getNumber(data.priceAmount, 0);
  if ("priceCurrency" in data) {
    updatePayload.priceCurrency = getTrimmedString(data.priceCurrency) || "EUR";
  }
  if ("membershipLengthType" in data) {
    updatePayload.membershipLengthType = normalizeMembershipLengthType(
      data.membershipLengthType
    );
  }
  if ("membershipLengthValue" in data) {
    updatePayload.membershipLengthValue = getNumber(data.membershipLengthValue, 1);
  }
  if ("dailyTrapAllowance" in data) {
    updatePayload.dailyTrapAllowance = getNumber(data.dailyTrapAllowance, 5);
  }
  if ("bagWeightCapacity" in data) {
    updatePayload.bagWeightCapacity = getNumber(data.bagWeightCapacity, 5);
  }
  if ("placementReductionPercent" in data) {
    updatePayload.placementReductionPercent = getNumber(
      data.placementReductionPercent,
      0
    );
  }
  if ("disarmReductionPercent" in data) {
    updatePayload.disarmReductionPercent = getNumber(data.disarmReductionPercent, 0);
  }
  if ("refillReductionPercent" in data) {
    updatePayload.refillReductionPercent = getNumber(data.refillReductionPercent, 0);
  }
  if ("mapVisibilityRadiusMeters" in data) {
    updatePayload.mapVisibilityRadiusMeters = getNumber(data.mapVisibilityRadiusMeters, 2000);
  }
  if ("mapMinZoom" in data) {
    // Allow null to clear the override (falls back to mapVisibilityRadiusMeters conversion)
    updatePayload.mapMinZoom = typeof data.mapMinZoom === "number" && Number.isFinite(data.mapMinZoom)
      ? data.mapMinZoom
      : null;
  }
  if ("description" in data) {
    updatePayload.description = getOptionalString(data.description);
  }
  if ("rangeMultiplier" in data)        updatePayload.rangeMultiplier        = getNumber(data.rangeMultiplier, 1);
  if ("leaveMultiplier" in data)        updatePayload.leaveMultiplier        = getNumber(data.leaveMultiplier, 1);
  if ("disableBannerAd" in data)       updatePayload.disableBannerAd       = getBoolean(data.disableBannerAd, false);
  if ("disableInterstitialAd" in data) updatePayload.disableInterstitialAd = getBoolean(data.disableInterstitialAd, false);
  if ("disableRewardedAd" in data)     updatePayload.disableRewardedAd     = getBoolean(data.disableRewardedAd, false);

  await getDb().collection("user_levels").doc(id).set(updatePayload, { merge: true });

  void writeAuditLog({
    adminUid,
    category: "levels",
    action: "UPDATE_LEVEL",
    targetId: id,
    targetName: typeof updatePayload.name === "string" ? updatePayload.name : id,
    summary: `Updated membership level "${id}"`,
    details: { id, updatePayload },
  });

  return { ok: true, id };
});

export const adminDeleteLevel = onCall(async (request) => {
  const adminUid = requireAdmin(request);

  const id = getTrimmedString((request.data as Record<string, unknown> | undefined)?.id);

  if (!id) {
    throw new HttpsError("invalid-argument", "id is required.");
  }

  await getDb().collection("user_levels").doc(id).delete();

  void writeAuditLog({
    adminUid,
    category: "levels",
    action: "DELETE_LEVEL",
    targetId: id,
    summary: `Deleted membership level "${id}"`,
    details: { id },
  });

  return { ok: true, id };
});

export const seedDefaultLevels = onCall(async (request) => {
  requireAdmin(request);

  const db = getDb();
  const now = FieldValue.serverTimestamp();

  const defaults = [
    {
      id: "free",
      name: "Free",
      description: "Basic gameplay with ads. No commitment required.",
      active: true,
      priceAmount: 0,
      priceCurrency: "EUR",
      membershipLengthType: "months",
      membershipLengthValue: 0,
      dailyTrapAllowance: 2,
      bagWeightCapacity: 4,
      placementReductionPercent: 0,
      disarmReductionPercent: 0,
      refillReductionPercent: 0,
      mapVisibilityRadiusMeters: 200,
      rangeMultiplier: 1,
      leaveMultiplier: 1,
      disableBannerAd: false,
      disableInterstitialAd: false,
      disableRewardedAd: false,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "silver",
      name: "SILVER",
      description: "Entry tier. Banner ads removed. Slightly larger bag and faster actions.",
      active: true,
      priceAmount: 249,
      priceCurrency: "EUR",
      membershipLengthType: "months",
      membershipLengthValue: 1,
      dailyTrapAllowance: 3,
      bagWeightCapacity: 6,
      placementReductionPercent: 8,
      disarmReductionPercent: 8,
      refillReductionPercent: 8,
      mapVisibilityRadiusMeters: 500,
      disableBannerAd: true,
      disableInterstitialAd: false,
      disableRewardedAd: false,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "gold",
      name: "GOLD",
      description: "Most popular. Banner and interstitial ads removed. Better bag and speed.",
      active: true,
      priceAmount: 499,
      priceCurrency: "EUR",
      membershipLengthType: "months",
      membershipLengthValue: 1,
      dailyTrapAllowance: 5,
      bagWeightCapacity: 10,
      placementReductionPercent: 16,
      disarmReductionPercent: 16,
      refillReductionPercent: 16,
      mapVisibilityRadiusMeters: 1000,
      disableBannerAd: true,
      disableInterstitialAd: true,
      disableRewardedAd: false,
      sortOrder: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "pro",
      name: "PRO",
      description: "Competitive edge. All regular ads removed. Larger range and allowance.",
      active: true,
      priceAmount: 799,
      priceCurrency: "EUR",
      membershipLengthType: "months",
      membershipLengthValue: 1,
      dailyTrapAllowance: 8,
      bagWeightCapacity: 14,
      placementReductionPercent: 25,
      disarmReductionPercent: 25,
      refillReductionPercent: 25,
      mapVisibilityRadiusMeters: 1700,
      disableBannerAd: true,
      disableInterstitialAd: true,
      disableRewardedAd: true,
      sortOrder: 3,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "elite",
      name: "ELITE",
      description: "Top-tier performance. All ads removed, extended range and daily allowance.",
      active: true,
      priceAmount: 1199,
      priceCurrency: "EUR",
      membershipLengthType: "months",
      membershipLengthValue: 1,
      dailyTrapAllowance: 13,
      bagWeightCapacity: 18,
      placementReductionPercent: 33,
      disarmReductionPercent: 33,
      refillReductionPercent: 33,
      mapVisibilityRadiusMeters: 2700,
      disableBannerAd: true,
      disableInterstitialAd: true,
      disableRewardedAd: true,
      sortOrder: 4,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "diamond",
      name: "DIAMOND",
      description: "Maximum power. Best bag, range, and fastest actions. No ads.",
      active: true,
      priceAmount: 1799,
      priceCurrency: "EUR",
      membershipLengthType: "months",
      membershipLengthValue: 1,
      dailyTrapAllowance: 20,
      bagWeightCapacity: 25,
      placementReductionPercent: 40,
      disarmReductionPercent: 40,
      refillReductionPercent: 40,
      mapVisibilityRadiusMeters: 5000,
      disableBannerAd: true,
      disableInterstitialAd: true,
      disableRewardedAd: true,
      sortOrder: 5,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const batch = db.batch();

  for (const level of defaults) {
    const { id, ...payload } = level;
    batch.set(db.collection("user_levels").doc(id), payload, { merge: true });
  }

  await batch.commit();

  return {
    ok: true,
    seeded: defaults.map((level) => level.id),
  };
});