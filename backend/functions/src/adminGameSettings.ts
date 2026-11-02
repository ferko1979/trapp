import { FieldValue } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";

const DOC_PATH = ["game_settings", "global"] as const;

function getBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampRadiusMultiplier(value: unknown): number {
  const n = getNumber(value, 1);
  if (n <= 0) return 1;
  if (n > 10) return 10;
  return n;
}

function clampRadius(value: unknown, fallback: number): number {
  const n = getNumber(value, fallback);
  if (n <= 0) return fallback;
  return n;
}

function clampVersionCode(value: unknown, fallback: number): number {
  const n = getNumber(value, fallback);
  return n >= 1 ? Math.round(n) : fallback;
}

function clampFirstLoginCount(value: unknown): number {
  const n = getNumber(value, 10);
  if (n < 1) return 1;
  if (n > 100) return 100;
  return Math.round(n);
}

function clampFirstLoginRadius(value: unknown): number {
  const n = getNumber(value, 1000);
  if (n < 50) return 50;
  if (n > 50000) return 50000;
  return Math.round(n);
}

function clampFirstLoginMinDistance(value: unknown): number {
  const n = getNumber(value, 0);
  if (n < 0) return 0;
  if (n > 500) return 500;
  return Math.round(n);
}

function getFirstLoginTypeMode(value: unknown): string {
  if (value === "fixed") return "fixed";
  return "random";
}

function getFirstLoginTypeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function getFirstLoginTypeCounts(value: unknown): { trapTypeId: string; count: number }[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[])
    .filter((v): v is { trapTypeId: string; count: number } =>
      v !== null &&
      typeof v === "object" &&
      typeof (v as { trapTypeId?: unknown }).trapTypeId === "string" &&
      typeof (v as { count?: unknown }).count === "number"
    )
    .map((v) => ({
      trapTypeId: (v.trapTypeId as string).trim(),
      count: Math.max(0, Math.min(50, Math.round(v.count as number))),
    }))
    .filter((v) => v.trapTypeId.length > 0);
}

function clampFirstLoginSpacing(value: unknown): number {
  const n = getNumber(value, 300);
  if (n < 10) return 10;
  if (n > 5000) return 5000;
  return Math.round(n);
}

function clampFirstLoginExpiry(value: unknown): number {
  const n = getNumber(value, 30);
  if (n < 1) return 1;
  if (n > 365) return 365;
  return Math.round(n);
}

function clampAreaLimitRadius(value: unknown): number {
  const n = getNumber(value, 200);
  if (n < 10) return 10;
  if (n > 5000) return 5000;
  return Math.round(n);
}

function clampAreaTrapLimit(value: unknown): number {
  const n = getNumber(value, 2);
  if (n < 1) return 1;
  if (n > 20) return 20;
  return Math.round(n);
}

function clampRewardValue(value: unknown, fallback: number): number {
  const n = getNumber(value, fallback);
  if (n < 1) return 1;
  if (n > 999) return 999;
  return Math.round(n);
}

function clampMaxUses(value: unknown): number {
  const n = getNumber(value, 1);
  if (n < 1) return 1;
  if (n > 10) return 10;
  return Math.round(n);
}

function clampRefillRewardValue(value: unknown, fallback: number): number {
  const n = getNumber(value, fallback);
  if (n < 1) return 1;
  if (n > 9999) return 9999;
  return Math.round(n);
}

const VALID_REFILL_REDUCTION_TYPES = ["seconds", "minutes", "hours", "percent"] as const;

function getRefillReductionType(value: unknown): string {
  if (typeof value === "string" && VALID_REFILL_REDUCTION_TYPES.includes(value as any)) return value;
  return "minutes";
}

function getString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

const VALID_REDUCTION_TYPES = ["seconds", "minutes", "hours", "percent"] as const;

function getReductionType(value: unknown): string {
  if (typeof value === "string" && VALID_REDUCTION_TYPES.includes(value as any)) {
    return value;
  }
  return "seconds";
}

export const adminGetGameSettings = onCall(async (request) => {
  requireAdmin(request);

  const snap = await getDb()
    .collection(DOC_PATH[0])
    .doc(DOC_PATH[1])
    .get();

  const data = snap.data() ?? {};

  return {
    ok: true,
    settings: {
      activeGame: getBoolean(data.activeGame, true),
      maintenanceMode: getBoolean(data.maintenanceMode, false),
      allowSelfTrapTrigger: getBoolean(data.allowSelfTrapTrigger, false),
      defaultTrapRadiusMeters: clampRadius(data.defaultTrapRadiusMeters, 25),
      globalTrapRadiusMultiplier: clampRadiusMultiplier(data.globalTrapRadiusMultiplier),
      // Advertising — placement / disassembly
      bannerAdEnabled: getBoolean(data.bannerAdEnabled, true),
      interstitialAdEnabled: getBoolean(data.interstitialAdEnabled, true),
      rewardedAdEnabled: getBoolean(data.rewardedAdEnabled, true),
      rewardedAdReductionType: getReductionType(data.rewardedAdReductionType),
      rewardedAdReductionValue: clampRewardValue(data.rewardedAdReductionValue, 30),
      rewardedAdMaxUsesPerSession: clampMaxUses(data.rewardedAdMaxUsesPerSession),
      // Advertising — trap refill reward (separate reward segment)
      rewardedRefillAdEnabled: getBoolean(data.rewardedRefillAdEnabled, true),
      rewardedRefillAdReductionType: getRefillReductionType(data.rewardedRefillAdReductionType),
      rewardedRefillAdReductionValue: clampRefillRewardValue(data.rewardedRefillAdReductionValue, 30),
      rewardedRefillAdMaxUsesPerSession: clampMaxUses(data.rewardedRefillAdMaxUsesPerSession),
      // AdMob IDs
      admobAppId:                    getString(data.admobAppId,                    ""),
      admobBannerAdUnitId:           getString(data.admobBannerAdUnitId,           ""),
      admobInterstitialAdUnitId:     getString(data.admobInterstitialAdUnitId,     ""),
      admobRewardedAdUnitId:         getString(data.admobRewardedAdUnitId,         ""),
      admobRewardedInterstitialAdUnitId: getString(data.admobRewardedInterstitialAdUnitId, ""),
      // Trap spacing
      areaTrapLimitRadiusMeters: clampAreaLimitRadius(data.areaTrapLimitRadiusMeters),
      areaTrapLimit: clampAreaTrapLimit(data.areaTrapLimit),
      // Payments
      revolutPaymentEnabled: getBoolean(data.revolutPaymentEnabled, true),
      stripePaymentEnabled: getBoolean(data.stripePaymentEnabled, false),
      // Android app version control
      minAndroidVersionCode: clampVersionCode(data.minAndroidVersionCode, 1),
      latestAndroidVersionCode: clampVersionCode(data.latestAndroidVersionCode, 1),
      // First-login auto trap placement
      firstLoginTrapGenEnabled: getBoolean(data.firstLoginTrapGenEnabled, false),
      firstLoginTrapCount: clampFirstLoginCount(data.firstLoginTrapCount),
      firstLoginTrapRadiusMeters: clampFirstLoginRadius(data.firstLoginTrapRadiusMeters),
      firstLoginTrapMinDistanceMeters: clampFirstLoginMinDistance(data.firstLoginTrapMinDistanceMeters),
      firstLoginTrapMinSpacingMeters: clampFirstLoginSpacing(data.firstLoginTrapMinSpacingMeters),
      firstLoginTrapExpiryDays: clampFirstLoginExpiry(data.firstLoginTrapExpiryDays),
      firstLoginTrapTypeMode: getFirstLoginTypeMode(data.firstLoginTrapTypeMode),
      firstLoginTrapTypeIds: getFirstLoginTypeIds(data.firstLoginTrapTypeIds),
      firstLoginTrapTypeCounts: getFirstLoginTypeCounts(data.firstLoginTrapTypeCounts),
    },
  };
});

export const adminUpdateGameSettings = onCall(async (request) => {
  requireAdmin(request);

  const payload = (request.data ?? {}) as Record<string, unknown>;

  await getDb()
    .collection(DOC_PATH[0])
    .doc(DOC_PATH[1])
    .set(
      {
        activeGame: getBoolean(payload.activeGame, true),
        maintenanceMode: getBoolean(payload.maintenanceMode, false),
        allowSelfTrapTrigger: getBoolean(payload.allowSelfTrapTrigger, false),
        defaultTrapRadiusMeters: clampRadius(payload.defaultTrapRadiusMeters, 25),
        globalTrapRadiusMultiplier: clampRadiusMultiplier(payload.globalTrapRadiusMultiplier),
        // Advertising — placement / disassembly
        bannerAdEnabled: getBoolean(payload.bannerAdEnabled, true),
        interstitialAdEnabled: getBoolean(payload.interstitialAdEnabled, true),
        rewardedAdEnabled: getBoolean(payload.rewardedAdEnabled, true),
        rewardedAdReductionType: getReductionType(payload.rewardedAdReductionType),
        rewardedAdReductionValue: clampRewardValue(payload.rewardedAdReductionValue, 30),
        rewardedAdMaxUsesPerSession: clampMaxUses(payload.rewardedAdMaxUsesPerSession),
        // Advertising — trap refill reward
        rewardedRefillAdEnabled: getBoolean(payload.rewardedRefillAdEnabled, true),
        rewardedRefillAdReductionType: getRefillReductionType(payload.rewardedRefillAdReductionType),
        rewardedRefillAdReductionValue: clampRefillRewardValue(payload.rewardedRefillAdReductionValue, 30),
        rewardedRefillAdMaxUsesPerSession: clampMaxUses(payload.rewardedRefillAdMaxUsesPerSession),
        // AdMob IDs
        admobAppId:                        getString(payload.admobAppId,                    ""),
        admobBannerAdUnitId:               getString(payload.admobBannerAdUnitId,           ""),
        admobInterstitialAdUnitId:         getString(payload.admobInterstitialAdUnitId,     ""),
        admobRewardedAdUnitId:             getString(payload.admobRewardedAdUnitId,         ""),
        admobRewardedInterstitialAdUnitId: getString(payload.admobRewardedInterstitialAdUnitId, ""),
        // Trap spacing
        areaTrapLimitRadiusMeters: clampAreaLimitRadius(payload.areaTrapLimitRadiusMeters),
        areaTrapLimit: clampAreaTrapLimit(payload.areaTrapLimit),
        // Payments
        revolutPaymentEnabled: getBoolean(payload.revolutPaymentEnabled, true),
        stripePaymentEnabled: getBoolean(payload.stripePaymentEnabled, false),
        // Android app version control
        minAndroidVersionCode: clampVersionCode(payload.minAndroidVersionCode, 1),
        latestAndroidVersionCode: clampVersionCode(payload.latestAndroidVersionCode, 1),
        // First-login auto trap placement
        firstLoginTrapGenEnabled: getBoolean(payload.firstLoginTrapGenEnabled, false),
        firstLoginTrapCount: clampFirstLoginCount(payload.firstLoginTrapCount),
        firstLoginTrapRadiusMeters: clampFirstLoginRadius(payload.firstLoginTrapRadiusMeters),
        firstLoginTrapMinDistanceMeters: clampFirstLoginMinDistance(payload.firstLoginTrapMinDistanceMeters),
        firstLoginTrapMinSpacingMeters: clampFirstLoginSpacing(payload.firstLoginTrapMinSpacingMeters),
        firstLoginTrapExpiryDays: clampFirstLoginExpiry(payload.firstLoginTrapExpiryDays),
        firstLoginTrapTypeMode: getFirstLoginTypeMode(payload.firstLoginTrapTypeMode),
        firstLoginTrapTypeIds: getFirstLoginTypeIds(payload.firstLoginTrapTypeIds),
        firstLoginTrapTypeCounts: getFirstLoginTypeCounts(payload.firstLoginTrapTypeCounts),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return { ok: true };
});

export const getPublicGameSettings = onCall(async () => {
  const snap = await getDb()
    .collection(DOC_PATH[0])
    .doc(DOC_PATH[1])
    .get();

  const data = snap.data() ?? {};

  return {
    ok: true,
    settings: {
      activeGame: getBoolean(data.activeGame, true),
      maintenanceMode: getBoolean(data.maintenanceMode, false),
      allowSelfTrapTrigger: getBoolean(data.allowSelfTrapTrigger, false),
      defaultTrapRadiusMeters: clampRadius(data.defaultTrapRadiusMeters, 25),
      globalTrapRadiusMultiplier: clampRadiusMultiplier(data.globalTrapRadiusMultiplier),
      // Advertising — returned to app clients
      bannerAdEnabled: getBoolean(data.bannerAdEnabled, true),
      interstitialAdEnabled: getBoolean(data.interstitialAdEnabled, true),
      rewardedAdEnabled: getBoolean(data.rewardedAdEnabled, true),
      rewardedAdReductionType: getReductionType(data.rewardedAdReductionType),
      rewardedAdReductionValue: clampRewardValue(data.rewardedAdReductionValue, 30),
      rewardedAdMaxUsesPerSession: clampMaxUses(data.rewardedAdMaxUsesPerSession),
      // Trap refill reward
      rewardedRefillAdEnabled: getBoolean(data.rewardedRefillAdEnabled, true),
      rewardedRefillAdReductionType: getRefillReductionType(data.rewardedRefillAdReductionType),
      rewardedRefillAdReductionValue: clampRefillRewardValue(data.rewardedRefillAdReductionValue, 30),
      rewardedRefillAdMaxUsesPerSession: clampMaxUses(data.rewardedRefillAdMaxUsesPerSession),
      // AdMob IDs — returned so the app can hot-swap ad units without an update
      admobAppId:                        getString(data.admobAppId,                    ""),
      admobBannerAdUnitId:               getString(data.admobBannerAdUnitId,           ""),
      admobInterstitialAdUnitId:         getString(data.admobInterstitialAdUnitId,     ""),
      admobRewardedAdUnitId:             getString(data.admobRewardedAdUnitId,         ""),
      admobRewardedInterstitialAdUnitId: getString(data.admobRewardedInterstitialAdUnitId, ""),
      // Trap spacing
      areaTrapLimitRadiusMeters: clampAreaLimitRadius(data.areaTrapLimitRadiusMeters),
      areaTrapLimit: clampAreaTrapLimit(data.areaTrapLimit),
      // Payments — which gateways are enabled
      revolutPaymentEnabled: getBoolean(data.revolutPaymentEnabled, true),
      stripePaymentEnabled: getBoolean(data.stripePaymentEnabled, false),
      // Android app version control
      minAndroidVersionCode: clampVersionCode(data.minAndroidVersionCode, 1),
      latestAndroidVersionCode: clampVersionCode(data.latestAndroidVersionCode, 1),
    },
  };
});