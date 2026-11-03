import {
  FieldValue,
  QueryDocumentSnapshot,
  Timestamp,
} from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  distanceBetween,
  geohashForLocation,
  geohashQueryBounds,
} from "geofire-common";

import { getDatePartsForTimezone } from "../shared/dates";
import { cachedDocData, cachedEnabledTrapDefinitions } from "../shared/cache";
import { getDb } from "../shared/firebase";
import { getTrapDefinition } from "../shared/trapTypes";
import { ensureDailyState, getUserTimeZone } from "../shared/user";
import { assertLatLng } from "../shared/validators";
import { requireUser as requireAuthUid } from "../shared/appCheck";
import { requireAdmin } from "../shared/admin";

const PLACEMENT_MAX_DISTANCE_METERS = 100;
const ACTIVE_TRAP_SEARCH_RADIUS_METERS = 250;

type AgeGroup = "minor" | "adult";

type TrapDefinitionRecord = {
  id: string;
  name?: string;
  names?: Record<string, string>;
  descriptions?: Record<string, string>;
  iconKey?: string;
  emoji?: string;
  imageUrl?: string;
  soundKey?: string;
  enabled?: boolean;
  radiusMeters?: number;
  placementHoldSeconds?: number;
  revealHoldSeconds?: number;
  disarmHoldSeconds?: number;
  effectKind?: string;
  effectValue?: number;
  ownerCanTrigger?: boolean;
  visibility?: string;
  refillHours?: number;
  maxBagSlots?: number;
  weight?: number;
  allowedAgeGroups?: AgeGroup[];
};

type InventoryItem = Record<string, unknown> & {
  id: string;
  uid?: string;
  trapTypeId?: string;
  bagCount?: number;
  maxBagSlots?: number;
  refillHours?: number;
  weight?: number;
  lastRefillAt?: unknown;
};

type LevelModifiers = {
  placementReductionPercent: number;
  revealReductionPercent: number;
  disarmReductionPercent: number;
  refillReductionPercent: number;
  rangeMultiplier: number;
  leaveMultiplier: number;
};

type RefillInfo = {
  effectiveRefillHours: number;
  nextRefillAtEpochMs: number | null;
  secondsUntilNextRefill: number | null;
  canRefillNow: boolean;
  blockedBySlots: boolean;
  blockedByWeight: boolean;
};

/** Extract the best-match ISO 639-1 language code from the Accept-Language header. */
function getPreferredLanguage(request: {
  rawRequest?: { headers?: Record<string, string | string[] | undefined> };
}): string {
  const header =
    (request.rawRequest?.headers?.["accept-language"] as string | undefined) ??
    "";
  // e.g. "hu-HU,hu;q=0.9,en-US;q=0.8,en;q=0.7"  →  "hu"
  const lang = header.split(",")[0].split("-")[0].trim().toLowerCase();
  return lang || "en";
}

/** Pick the best localized string from a names/descriptions map, falling back to "en". */
function pickLocalized(
  map: Record<string, string> | undefined,
  lang: string,
  fallback = ""
): string {
  if (!map) return fallback;
  return map[lang] ?? map["en"] ?? fallback;
}

/**
 * Read the `strings` map from app_translations/{lang} so trap names/descriptions
 * managed in the admin translation UI take priority over embedded Firestore maps.
 * Falls back to English when the requested locale document is missing.
 */
async function getAppTranslationStrings(lang: string): Promise<Record<string, string>> {
  try {
    const doc = await cachedDocData("app_translations", lang);
    if (doc) return (doc.strings ?? {}) as Record<string, string>;
    if (lang !== "en") {
      const enDoc = await cachedDocData("app_translations", "en");
      return (enDoc?.strings ?? {}) as Record<string, string>;
    }
  } catch {
    // Non-fatal — fall through to embedded maps
  }
  return {};
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Fire-and-forget FCM push to a user. Reads their `fcmToken` from `users/{uid}`,
 * sends the message, and swallows all errors so the caller is never blocked.
 */
async function pushToUser(
  db: FirebaseFirestore.Firestore,
  uid: string,
  title: string,
  body: string,
  data: Record<string, string> = {}
): Promise<void> {
  try {
    const snap = await db.collection("users").doc(uid).get();
    const token = asString(snap.data()?.fcmToken);
    if (!token) return;
    await getMessaging().send({
      token,
      notification: { title, body },
      android: { priority: "high" },
      data,
    });
  } catch (err) {
    logger.warn("pushToUser failed (non-fatal)", { uid, err });
  }
}

function getTimestampMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (
    value &&
    typeof (value as { toMillis?: () => number }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

function getInventoryDocId(uid: string, trapTypeId: string): string {
  return `${uid}__${trapTypeId}`;
}

function normalizeMaxBagSlots(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 2;
}

function normalizeRefillHours(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 24;
}

function normalizeWeight(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 1;
}

function clampPercent(value: unknown): number {
  const n = asNumber(value, 0);
  if (n < 0) return 0;
  if (n > 95) return 95;
  return n;
}

function applyPercentReductionToSeconds(
  baseSeconds: number,
  percent: number
): number {
  if (percent <= 0) return Math.max(1, Math.ceil(baseSeconds));
  const reduced = baseSeconds * (1 - percent / 100);
  return Math.max(1, Math.ceil(reduced));
}

function applyPercentReductionToHours(
  baseHours: number,
  percent: number
): number {
  if (percent <= 0) return baseHours;
  const reduced = baseHours * (1 - percent / 100);
  return Math.max(0.01, reduced);
}

function normalizeAllowedAgeGroups(value: unknown): AgeGroup[] {
  if (!Array.isArray(value)) return ["minor", "adult"];
  const result = value.filter(
    (x): x is AgeGroup => x === "minor" || x === "adult"
  );
  return result.length > 0 ? result : ["minor", "adult"];
}

function getAgeFromBirthDate(birthDate: string, now = new Date()): number {
  const [year, month, day] = birthDate.split("-").map(Number);
  let age = now.getUTCFullYear() - year;
  const currentMonth = now.getUTCMonth() + 1;
  const currentDay = now.getUTCDate();
  if (currentMonth < month || (currentMonth === month && currentDay < day)) {
    age -= 1;
  }
  return age;
}

function getAgeGroupFromAge(age: number): AgeGroup {
  return age >= 18 ? "adult" : "minor";
}

async function getUserAgeGroup(uid: string): Promise<AgeGroup> {
  const db = getDb();
  const userSnap = await db.collection("users").doc(uid).get();
  const user = userSnap.data() ?? {};
  const storedAgeGroup = asString(user.ageGroup);
  if (storedAgeGroup === "adult" || storedAgeGroup === "minor") {
    return storedAgeGroup;
  }

  const birthDate = asString(user.birthDate);
  if (birthDate) {
    const age = getAgeFromBirthDate(birthDate);
    return getAgeGroupFromAge(age);
  }

  return "adult";
}

async function getPlayerLocation(uid: string) {
  const db = getDb();
  const snap = await db.collection("player_locations").doc(uid).get();
  const data = snap.data();
  if (
    !data ||
    typeof data.lat !== "number" ||
    typeof data.lng !== "number" ||
    !Number.isFinite(data.lat) ||
    !Number.isFinite(data.lng)
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Player location not available."
    );
  }
  return { lat: data.lat as number, lng: data.lng as number };
}

function metersBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  return distanceBetween([aLat, aLng], [bLat, bLng]) * 1000;
}

function clampMultiplier(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 1;
  if (n < 0.5) return 0.5;
  if (n > 5) return 5;
  return n;
}

async function getUserLevelModifiers(uid: string): Promise<LevelModifiers> {
  const db = getDb();
  const userSnap = await db.collection("users").doc(uid).get();
  const userData = userSnap.data() ?? {};
  const levelId = asString(userData.levelId, "free");

  if (!levelId) {
    return {
      placementReductionPercent: 0,
      revealReductionPercent: 0,
      disarmReductionPercent: 0,
      refillReductionPercent: 0,
      rangeMultiplier: 1,
      leaveMultiplier: 1,
    };
  }

  const levelRecord = (await cachedDocData("user_levels", levelId)) ?? {};

  const disarmReductionPercent = clampPercent(
    levelRecord.disarmReductionPercent
  );
  const revealReductionPercent =
    "revealReductionPercent" in levelRecord
      ? clampPercent(levelRecord.revealReductionPercent)
      : disarmReductionPercent;

  return {
    placementReductionPercent: clampPercent(
      levelRecord.placementReductionPercent
    ),
    revealReductionPercent,
    disarmReductionPercent,
    refillReductionPercent: clampPercent(levelRecord.refillReductionPercent),
    rangeMultiplier: clampMultiplier(levelRecord.rangeMultiplier),
    leaveMultiplier: clampMultiplier(levelRecord.leaveMultiplier),
  };
}

async function getUserBagWeightCapacity(uid: string): Promise<number> {
  const db = getDb();
  const userSnap = await db.collection("users").doc(uid).get();
  const userData = userSnap.data() ?? {};

  if (
    typeof userData.bagWeightCapacity === "number" &&
    Number.isFinite(userData.bagWeightCapacity)
  ) {
    return userData.bagWeightCapacity;
  }

  const levelId = asString(userData.levelId, "free");
  if (levelId) {
    const levelData = (await cachedDocData("user_levels", levelId)) ?? {};
    if (
      typeof levelData.bagWeightCapacity === "number" &&
      Number.isFinite(levelData.bagWeightCapacity)
    ) {
      return levelData.bagWeightCapacity;
    }
    if (
      typeof levelData.bagSize === "number" &&
      Number.isFinite(levelData.bagSize)
    ) {
      return levelData.bagSize;
    }
  }

  const generalSettings = (await cachedDocData("general_settings", "global")) ?? {};
  if (
    typeof generalSettings.defaultBagWeightCapacity === "number" &&
    Number.isFinite(generalSettings.defaultBagWeightCapacity)
  ) {
    return generalSettings.defaultBagWeightCapacity;
  }
  if (
    typeof generalSettings.defaultBagSize === "number" &&
    Number.isFinite(generalSettings.defaultBagSize)
  ) {
    return generalSettings.defaultBagSize;
  }

  return 5;
}

async function getAllowSelfTrapTrigger(): Promise<boolean> {
  const data = (await cachedDocData("game_settings", "global")) ?? {};
  return typeof data.allowSelfTrapTrigger === "boolean"
    ? data.allowSelfTrapTrigger
    : false;
}

/** Own traps never fire on their owner (unless self-trigger testing is on), so the owner may
 *  disassemble them while standing inside the capture zone — e.g. right after placing one. */
async function captureZoneApplies(trapOwnerUid: unknown, uid: string): Promise<boolean> {
  if (trapOwnerUid !== uid) return true;
  return getAllowSelfTrapTrigger();
}

async function listEnabledTrapDefinitions(
  ageGroup?: AgeGroup
): Promise<TrapDefinitionRecord[]> {
  const docs = await cachedEnabledTrapDefinitions();

  return docs
    .map(
      (doc) =>
        ({
          id: doc.id,
          ...doc.data,
        }) as TrapDefinitionRecord
    )
    .filter((trapDef) => {
      const allowed = normalizeAllowedAgeGroups(trapDef.allowedAgeGroups);
      return ageGroup ? allowed.includes(ageGroup) : true;
    })
    .sort((a, b) => asString(a.name).localeCompare(asString(b.name)));
}

async function ensureUserTrapInventory(uid: string) {
  const db = getDb();
  const ageGroup = await getUserAgeGroup(uid);
  const trapDefs = await listEnabledTrapDefinitions(ageGroup);
  const batch = db.batch();

  for (const trapDef of trapDefs) {
    const ref = db
      .collection("user_trap_inventory")
      .doc(getInventoryDocId(uid, trapDef.id));
    const snap = await ref.get();

    if (!snap.exists) {
      const maxBagSlots = normalizeMaxBagSlots(trapDef.maxBagSlots);
      const refillHours = normalizeRefillHours(trapDef.refillHours);
      const weight = normalizeWeight(trapDef.weight);

      batch.set(
        ref,
        {
          uid,
          trapTypeId: trapDef.id,
          bagCount: 0,
          maxBagSlots,
          refillHours,
          weight,
          lastRefillAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  await batch.commit();
}

async function getUserTrapInventoryItems(uid: string): Promise<InventoryItem[]> {
  const db = getDb();
  const snap = await db
    .collection("user_trap_inventory")
    .where("uid", "==", uid)
    .get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Record<string, unknown>),
  })) as InventoryItem[];
}

async function getUserTrapInventoryMap(uid: string) {
  const items = await getUserTrapInventoryItems(uid);
  const map = new Map<string, InventoryItem>();
  for (const item of items) {
    const trapTypeId = asString(item.trapTypeId);
    if (trapTypeId) {
      map.set(trapTypeId, item);
    }
  }
  return map;
}

function getCurrentInventoryWeight(
  items: InventoryItem[],
  trapDefMap: Map<string, TrapDefinitionRecord>
): number {
  let totalWeight = 0;
  for (const item of items) {
    const trapTypeId = asString(item.trapTypeId);
    const trapDef = trapDefMap.get(trapTypeId);
    const weight = normalizeWeight(trapDef?.weight ?? item.weight);
    const bagCount = asNumber(item.bagCount, 0);
    totalWeight += weight * bagCount;
  }
  return totalWeight;
}

function getNextRefillInfo(params: {
  item: InventoryItem;
  trapDef?: TrapDefinitionRecord;
  bagWeightCapacity: number;
  currentTotalWeight: number;
  refillReductionPercent: number;
}): RefillInfo {
  const {
    item,
    trapDef,
    bagWeightCapacity,
    currentTotalWeight,
    refillReductionPercent,
  } = params;

  const maxBagSlots = normalizeMaxBagSlots(
    trapDef?.maxBagSlots ?? item.maxBagSlots
  );
  const currentBagCount = asNumber(item.bagCount, 0);
  const weight = normalizeWeight(trapDef?.weight ?? item.weight);
  const baseRefillHours = normalizeRefillHours(
    trapDef?.refillHours ?? item.refillHours
  );
  const effectiveRefillHours = applyPercentReductionToHours(
    baseRefillHours,
    refillReductionPercent
  );
  const blockedBySlots = currentBagCount >= maxBagSlots;
  const blockedByWeight = currentTotalWeight + weight > bagWeightCapacity;
  const nowMillis = Date.now();
  const lastRefillMillis = getTimestampMillis(item.lastRefillAt) ?? nowMillis;
  const refillIntervalMillis = effectiveRefillHours * 60 * 60 * 1000;

  if (blockedBySlots || blockedByWeight) {
    return {
      effectiveRefillHours,
      nextRefillAtEpochMs: null,
      secondsUntilNextRefill: null,
      canRefillNow: false,
      blockedBySlots,
      blockedByWeight,
    };
  }

  const nextRefillAtEpochMs = Math.ceil(lastRefillMillis + refillIntervalMillis);
  const secondsUntilNextRefill = Math.max(
    0,
    Math.ceil((nextRefillAtEpochMs - nowMillis) / 1000)
  );

  return {
    effectiveRefillHours,
    nextRefillAtEpochMs,
    secondsUntilNextRefill,
    canRefillNow: secondsUntilNextRefill <= 0,
    blockedBySlots,
    blockedByWeight,
  };
}

async function normalizeInventoryToWeightLimit(uid: string) {
  const db = getDb();
  const ageGroup = await getUserAgeGroup(uid);
  const trapDefs = await listEnabledTrapDefinitions(ageGroup);
  const trapDefMap = new Map(trapDefs.map((d) => [d.id, d] as const));
  const bagWeightCapacity = await getUserBagWeightCapacity(uid);
  const items = await getUserTrapInventoryItems(uid);

  let currentWeight = getCurrentInventoryWeight(items, trapDefMap);
  if (currentWeight <= bagWeightCapacity) {
    return;
  }

  const batch = db.batch();
  const sortable = [...items].sort((a, b) => {
    const aWeight = normalizeWeight(
      trapDefMap.get(asString(a.trapTypeId))?.weight ?? a.weight
    );
    const bWeight = normalizeWeight(
      trapDefMap.get(asString(b.trapTypeId))?.weight ?? b.weight
    );
    if (bWeight !== aWeight) return bWeight - aWeight;
    return asString(a.trapTypeId).localeCompare(asString(b.trapTypeId));
  });

  for (const item of sortable) {
    if (currentWeight <= bagWeightCapacity) break;

    const trapTypeId = asString(item.trapTypeId);
    const docRef = db.collection("user_trap_inventory").doc(item.id);
    const weight = normalizeWeight(trapDefMap.get(trapTypeId)?.weight ?? item.weight);
    let bagCount = asNumber(item.bagCount, 0);
    if (bagCount <= 0) continue;

    const overweight = currentWeight - bagWeightCapacity;
    const unitsToRemove = Math.min(bagCount, Math.ceil(overweight / weight));
    if (unitsToRemove <= 0) continue;

    bagCount -= unitsToRemove;
    currentWeight -= unitsToRemove * weight;

    batch.set(
      docRef,
      {
        bagCount,
        weight,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  await batch.commit();
}

async function applyTrapRefills(uid: string) {
  const db = getDb();
  await ensureUserTrapInventory(uid);
  await normalizeInventoryToWeightLimit(uid);

  const ageGroup = await getUserAgeGroup(uid);
  const trapDefs = await listEnabledTrapDefinitions(ageGroup);
  const trapDefMap = new Map(trapDefs.map((d) => [d.id, d] as const));
  const modifiers = await getUserLevelModifiers(uid);

  const snap = await db
    .collection("user_trap_inventory")
    .where("uid", "==", uid)
    .get();
  const items = snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Record<string, unknown>),
  })) as InventoryItem[];

  const batch = db.batch();
  const nowMillis = Date.now();
  const bagWeightCapacity = await getUserBagWeightCapacity(uid);
  let currentTotalWeight = getCurrentInventoryWeight(items, trapDefMap);

  for (const item of items) {
    const docRef = db.collection("user_trap_inventory").doc(item.id);
    const trapTypeId = asString(item.trapTypeId);
    const trapDef = trapDefMap.get(trapTypeId);
    if (!trapDef) continue;

    const maxBagSlots = normalizeMaxBagSlots(
      trapDef.maxBagSlots ?? item.maxBagSlots
    );
    const baseRefillHours = normalizeRefillHours(
      trapDef.refillHours ?? item.refillHours
    );
    const effectiveRefillHours = applyPercentReductionToHours(
      baseRefillHours,
      modifiers.refillReductionPercent
    );
    const weight = normalizeWeight(trapDef.weight ?? item.weight);
    const currentBagCount = asNumber(item.bagCount, 0);
    const lastRefillMillis = getTimestampMillis(item.lastRefillAt) ?? nowMillis;
    const refillIntervalMillis = effectiveRefillHours * 60 * 60 * 1000;

    const patch: Record<string, unknown> = {
      maxBagSlots,
      refillHours: baseRefillHours,
      weight,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (currentBagCount < maxBagSlots && refillIntervalMillis > 0) {
      const elapsedMillis = nowMillis - lastRefillMillis;
      const refillUnitsByTime = Math.floor(elapsedMillis / refillIntervalMillis);

      if (refillUnitsByTime > 0) {
        const capacityLeftBySlots = maxBagSlots - currentBagCount;
        const capacityLeftByWeight = Math.max(
          0,
          Math.floor((bagWeightCapacity - currentTotalWeight) / weight)
        );
        const appliedUnits = Math.min(
          refillUnitsByTime,
          capacityLeftBySlots,
          capacityLeftByWeight
        );

        if (appliedUnits > 0) {
          const newBagCount = currentBagCount + appliedUnits;
          const newLastRefillMillis =
            lastRefillMillis + appliedUnits * refillIntervalMillis;
          patch.bagCount = newBagCount;
          patch.lastRefillAt = Timestamp.fromMillis(newLastRefillMillis);
          currentTotalWeight += appliedUnits * weight;
        }
      }
    }

    batch.set(docRef, patch, { merge: true });
  }

  await batch.commit();
  await normalizeInventoryToWeightLimit(uid);
}

export const listTrapDefinitions = onCall(async (request) => {
  const uid = request.auth?.uid ?? null;
  const userAgeGroup = uid ? await getUserAgeGroup(uid) : null;
  const trapDefs = await listEnabledTrapDefinitions(userAgeGroup ?? undefined);
  // Prefer explicit lang from Android/web client; fall back to Accept-Language header.
  const dataLang = asString((request.data as Record<string, unknown>)?.lang, "").trim().toLowerCase();
  const lang = dataLang || getPreferredLanguage(request);

  let inventoryMap = new Map<string, InventoryItem>();
  let bagWeightCapacity: number | null = null;
  let currentBagWeight = 0;
  let modifiers: LevelModifiers = {
    placementReductionPercent: 0,
    revealReductionPercent: 0,
    disarmReductionPercent: 0,
    refillReductionPercent: 0,
    rangeMultiplier: 1,
    leaveMultiplier: 1,
  };

  if (uid) {
    await ensureUserTrapInventory(uid);
    await applyTrapRefills(uid);
    await normalizeInventoryToWeightLimit(uid);
    inventoryMap = await getUserTrapInventoryMap(uid);
    bagWeightCapacity = await getUserBagWeightCapacity(uid);
    modifiers = await getUserLevelModifiers(uid);
    const inventoryItems = Array.from(inventoryMap.values());
    const trapDefMap = new Map(trapDefs.map((d) => [d.id, d] as const));
    currentBagWeight = getCurrentInventoryWeight(inventoryItems, trapDefMap);
  }

  const items = trapDefs.map((trapDef) => {
    const inventory = inventoryMap.get(trapDef.id);
    const placementBase = asNumber(trapDef.placementHoldSeconds, 3);
    const revealBase = asNumber(trapDef.revealHoldSeconds, 2);
    const disarmBase = asNumber(trapDef.disarmHoldSeconds, 4);

    const refillInfo: RefillInfo =
      uid && inventory && bagWeightCapacity !== null
        ? getNextRefillInfo({
            item: inventory,
            trapDef,
            bagWeightCapacity,
            currentTotalWeight: currentBagWeight,
            refillReductionPercent: modifiers.refillReductionPercent,
          })
        : {
            effectiveRefillHours: normalizeRefillHours(trapDef.refillHours),
            nextRefillAtEpochMs: null,
            secondsUntilNextRefill: null,
            canRefillNow: false,
            blockedBySlots: false,
            blockedByWeight: false,
          };

    return {
      ...trapDef,
      allowedAgeGroups: normalizeAllowedAgeGroups(trapDef.allowedAgeGroups),
      weight: normalizeWeight(trapDef.weight),
      bagCount:
        typeof inventory?.bagCount === "number" ? inventory.bagCount : undefined,
      maxBagSlots:
        typeof inventory?.maxBagSlots === "number"
          ? inventory.maxBagSlots
          : trapDef.maxBagSlots,
      refillHours:
        typeof inventory?.refillHours === "number"
          ? inventory.refillHours
          : trapDef.refillHours,
      effectivePlacementHoldSeconds: uid
        ? applyPercentReductionToSeconds(
            placementBase,
            modifiers.placementReductionPercent
          )
        : placementBase,
      effectiveRevealHoldSeconds: uid
        ? applyPercentReductionToSeconds(
            revealBase,
            modifiers.revealReductionPercent
          )
        : revealBase,
      effectiveDisarmHoldSeconds: uid
        ? applyPercentReductionToSeconds(
            disarmBase,
            modifiers.disarmReductionPercent
          )
        : disarmBase,
      ...refillInfo,
      localizedName: pickLocalized(
        trapDef.names,
        lang,
        asString(trapDef.name, "Unknown Trap")
      ),
      localizedDescription: pickLocalized(trapDef.descriptions, lang, ""),
    };
  });

  return {
    ok: true,
    trapDefinitions: items,
    items,
    bagWeightCapacity,
    currentBagWeight,
    ageGroup: userAgeGroup,
  };
});

export const getMyTrapInventory = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    await ensureUserTrapInventory(uid);
    await applyTrapRefills(uid);
    await normalizeInventoryToWeightLimit(uid);

    // Prefer explicit lang from Android/web client; fall back to Accept-Language header.
    const dataLang = asString((request.data as Record<string, unknown>)?.lang, "").trim().toLowerCase();
    const lang = dataLang || getPreferredLanguage(request);

    const ageGroup = await getUserAgeGroup(uid);
    const items = await getUserTrapInventoryItems(uid);

    // Fetch trap definitions and admin-managed translations in parallel
    const [trapDefs, appStrings] = await Promise.all([
      listEnabledTrapDefinitions(ageGroup),
      getAppTranslationStrings(lang),
    ]);
    const trapDefMap = new Map(trapDefs.map((d) => [d.id, d] as const));
    const bagWeightCapacity = await getUserBagWeightCapacity(uid);
    const currentBagWeight = getCurrentInventoryWeight(items, trapDefMap);
    const modifiers = await getUserLevelModifiers(uid);

    const enrichedItems = items
      .filter((item) => trapDefMap.has(asString(item.trapTypeId)))
      .map((item) => {
        const trapDef = trapDefMap.get(asString(item.trapTypeId));
        const weight = normalizeWeight(trapDef?.weight ?? item.weight);
        const refillInfo = getNextRefillInfo({
          item,
          trapDef,
          bagWeightCapacity,
          currentTotalWeight: currentBagWeight,
          refillReductionPercent: modifiers.refillReductionPercent,
        });

        const trapId = asString(item.trapTypeId);
        // Admin-managed app_translations keys take priority; fall back to embedded maps
        const localizedName =
          appStrings[`trap_${trapId}_name`] ||
          pickLocalized(trapDef?.names, lang, asString(trapDef?.name, "Unknown Trap"));
        const localizedDescription =
          appStrings[`trap_${trapId}_desc`] ||
          pickLocalized(trapDef?.descriptions, lang, "");

        return {
          ...item,
          weight,
          allowedAgeGroups: normalizeAllowedAgeGroups(trapDef?.allowedAgeGroups),
          ...refillInfo,
          // Display fields from trap definition
          trapTypeId: asString(item.trapTypeId),
          iconKey: asString(trapDef?.iconKey, "default"),
          effectKind: asString(trapDef?.effectKind, "none"),
          effectValue: trapDef?.effectValue ?? null,
          imageUrl: trapDef?.imageUrl ?? null,
          soundKey: trapDef?.soundKey ?? null,
          localizedName,
          localizedDescription,
        };
      });

    // Resolve mapMinZoom from the user's level so the Android client
    // enforces the correct map zoom restriction for this subscription tier.
    const db2 = getDb();
    const userSnap2 = await db2.collection("users").doc(uid).get();
    const userData2 = userSnap2.data() ?? {};
    const levelId2 = asString(userData2.levelId, "free");
    let mapMinZoom = 10;
    let mapVisibilityRadiusMeters = 2000;
    if (levelId2) {
      const ld = (await cachedDocData("user_levels", levelId2)) ?? {};
      if (typeof ld.mapVisibilityRadiusMeters === "number") {
        mapVisibilityRadiusMeters = ld.mapVisibilityRadiusMeters;
      }
      if (typeof ld.mapMinZoom === "number" && Number.isFinite(ld.mapMinZoom)) {
        // Explicit override wins
        mapMinZoom = ld.mapMinZoom;
      } else {
        // Derive minZoom from the visibility radius.
        // At zoom 10, a typical phone shows ~10 km radius.
        // Each additional zoom level halves the visible radius.
        // z = 10 + log2(10_000 / radiusMeters)
        const derived = 10 + Math.log2(10_000 / mapVisibilityRadiusMeters);
        mapMinZoom = Math.max(5, Math.min(18, Math.round(derived)));
      }
    }

    return {
      ok: true,
      items: enrichedItems,
      bagWeightCapacity,
      currentBagWeight,
      ageGroup,
      mapMinZoom,
      mapVisibilityRadiusMeters,
    };
  } catch (error) {
    logger.error("getMyTrapInventory crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const getMyActiveTraps = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const db = getDb();
    const snap = await db
      .collection("traps")
      .where("ownerUid", "==", uid)
      .where("status", "==", "active")
      .get();

    const items = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        trapTypeId: asString(data.trapTypeId),
        iconKey: asString(data.iconKey),
        status: asString(data.status),
        lat: asNumber(data.lat),
        lng: asNumber(data.lng),
        createdAtEpochMs: getTimestampMillis(data.createdAt),
      };
    });

    return { ok: true, items };
  } catch (error) {
    logger.error("getMyActiveTraps crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const dropTrapFromBag = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const trapTypeId =
      typeof data.trapTypeId === "string"
        ? data.trapTypeId.trim()
        : typeof data.trapId === "string"
        ? data.trapId.trim()
        : "";
    const amount =
      typeof data.amount === "number" && data.amount > 0
        ? Math.floor(data.amount)
        : 1;

    if (!trapTypeId) {
      throw new HttpsError("invalid-argument", "trapTypeId is required.");
    }

    const db = getDb();
    const ref = db
      .collection("user_trap_inventory")
      .doc(getInventoryDocId(uid, trapTypeId));

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.data();
      if (!current) {
        throw new HttpsError("not-found", "Inventory entry not found.");
      }

      const bagCount = asNumber(current.bagCount, 0);
      const nextCount = Math.max(0, bagCount - amount);

      tx.set(
        ref,
        {
          bagCount: nextCount,
          lastRefillAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    return { ok: true, trapTypeId, amountDropped: amount };
  } catch (error) {
    logger.error("dropTrapFromBag crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const seedTrapDefinitions = onCall(async (request) => {
  // Overwrites the whole trap catalogue — admin panel only.
  requireAdmin(request);

  const db = getDb();
  const defs = [
    // ── Adult traps ──────────────────────────────────────
    {
      id: "fun_laughter",
      name: "Prank Trap",
      iconKey: "trap_fun_laughter",
      emoji: "😈",
      soundKey: "prank_zone",
      enabled: true,
      radiusMeters: 20,
      disarmRadiusMeters: 50,
      placementHoldSeconds: 60,    // 1 minute to place
      revealHoldSeconds: 3,
      disarmHoldSeconds: 45,       // 45 seconds to disarm
      effectKind: "laughter",
      effectValue: 1,
      ownerCanTrigger: true,
      visibility: "public-after-reveal",
      refillHours: 24,
      maxBagSlots: 2,
      weight: 1,
      allowedAgeGroups: ["adult"],
    },
    {
      id: "timeout_small",
      name: "Shadow Snare Trap",
      iconKey: "trap_timeout_small",
      emoji: "🪤",
      soundKey: "shadow_snare",
      enabled: true,
      radiusMeters: 25,
      disarmRadiusMeters: 50,
      placementHoldSeconds: 180,   // 3 minutes to place
      revealHoldSeconds: 3,
      disarmHoldSeconds: 150,      // 2 min 30 sec to disarm
      effectKind: "timeout",
      effectValue: 900,            // 15-minute freeze
      ownerCanTrigger: true,
      visibility: "public-after-reveal",
      refillHours: 24,
      maxBagSlots: 1,
      weight: 1,
      allowedAgeGroups: ["adult"],
    },
    {
      id: "timeout_major",
      name: "Iron Cage Trap",
      iconKey: "trap_timeout_major",
      emoji: "⛓️",
      soundKey: "iron_cage",
      enabled: true,
      radiusMeters: 30,
      disarmRadiusMeters: 50,
      placementHoldSeconds: 600,   // 10 minutes to place
      revealHoldSeconds: 5,
      disarmHoldSeconds: 480,      // 8 minutes to disarm
      effectKind: "timeout",
      effectValue: 10800,          // 3-hour freeze
      ownerCanTrigger: true,
      visibility: "public-after-reveal",
      refillHours: 48,
      maxBagSlots: 1,
      weight: 2,
      allowedAgeGroups: ["adult"],
    },
    // ── Kids traps (same timings as adult counterparts, age-separated) ──
    {
      id: "silly_spider",
      name: "Silly Spider Trap",
      iconKey: "trap_silly_spider",
      emoji: "🕷️",
      soundKey: "silly_spider",
      enabled: true,
      radiusMeters: 15,
      disarmRadiusMeters: 50,
      placementHoldSeconds: 60,    // mirrors Prank Trap timing
      revealHoldSeconds: 2,
      disarmHoldSeconds: 45,
      effectKind: "laughter",
      effectValue: 1,
      ownerCanTrigger: true,
      visibility: "public-after-reveal",
      refillHours: 24,
      maxBagSlots: 2,
      weight: 1,
      allowedAgeGroups: ["minor"],
    },
    {
      id: "bubble_trap",
      name: "Bubble Trap",
      iconKey: "trap_bubble_trap",
      emoji: "🫧",
      soundKey: "bubble_trap",
      enabled: true,
      radiusMeters: 18,
      disarmRadiusMeters: 50,
      placementHoldSeconds: 180,   // mirrors Shadow Snare Trap timing
      revealHoldSeconds: 2,
      disarmHoldSeconds: 150,
      effectKind: "timeout",
      effectValue: 30,             // 30-second freeze (kid-friendly)
      ownerCanTrigger: true,
      visibility: "public-after-reveal",
      refillHours: 24,
      maxBagSlots: 2,
      weight: 1,
      allowedAgeGroups: ["minor"],
    },
    {
      id: "rainbow_freeze",
      name: "Rainbow Freeze Trap",
      iconKey: "trap_rainbow_freeze",
      emoji: "🌈",
      soundKey: "rainbow_freeze",
      enabled: true,
      radiusMeters: 20,
      disarmRadiusMeters: 50,
      placementHoldSeconds: 600,   // mirrors Iron Cage Trap timing
      revealHoldSeconds: 3,
      disarmHoldSeconds: 480,
      effectKind: "timeout",
      effectValue: 45,             // 45-second freeze (kid-friendly)
      ownerCanTrigger: true,
      visibility: "public-after-reveal",
      refillHours: 24,
      maxBagSlots: 1,
      weight: 1,
      allowedAgeGroups: ["minor"],
    },
  ] as const;

  const batch = db.batch();
  for (const def of defs) {
    batch.set(db.collection("trap_definitions").doc(def.id), def, {
      merge: true,
    });
  }
  await batch.commit();

  return { ok: true, seeded: defs.length };
});

export const startTrapPlacement = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const { lat, lng } = assertLatLng(data.lat, data.lng);
    const trapTypeId =
      typeof data.trapTypeId === "string" ? data.trapTypeId.trim() : "";

    if (!trapTypeId) {
      throw new HttpsError("invalid-argument", "trapTypeId is required.");
    }

    const playerLoc = await getPlayerLocation(uid);
    const distanceFromPlayer = metersBetween(lat, lng, playerLoc.lat, playerLoc.lng);
    if (distanceFromPlayer > PLACEMENT_MAX_DISTANCE_METERS) {
      const excess = Math.round(distanceFromPlayer - PLACEMENT_MAX_DISTANCE_METERS);
      throw new HttpsError(
        "failed-precondition",
        `Trap placement point is too far away. You are ${excess} m too far (max ${PLACEMENT_MAX_DISTANCE_METERS} m).`
      );
    }

    // #17 — Area rate-limiting: configurable max traps within configurable radius
    const db0 = getDb();
    const [areaSettings, ownActiveSnap] = await Promise.all([
      cachedDocData("game_settings", "global"),
      db0.collection("traps")
        .where("ownerUid", "==", uid)
        .where("status", "==", "active")
        .get(),
    ]);
    const areaSettingsData = areaSettings ?? {};
    const AREA_LIMIT_RADIUS_METERS =
      typeof areaSettingsData.areaTrapLimitRadiusMeters === "number" &&
      Number.isFinite(areaSettingsData.areaTrapLimitRadiusMeters) &&
      areaSettingsData.areaTrapLimitRadiusMeters >= 10
        ? Math.round(areaSettingsData.areaTrapLimitRadiusMeters)
        : 200;
    const AREA_TRAP_LIMIT =
      typeof areaSettingsData.areaTrapLimit === "number" &&
      Number.isFinite(areaSettingsData.areaTrapLimit) &&
      areaSettingsData.areaTrapLimit >= 1
        ? Math.round(areaSettingsData.areaTrapLimit)
        : 2;
    const nearbyOwn = ownActiveSnap.docs.filter((doc) => {
      const tLat = doc.data().lat;
      const tLng = doc.data().lng;
      return (
        typeof tLat === "number" &&
        typeof tLng === "number" &&
        metersBetween(lat, lng, tLat, tLng) <= AREA_LIMIT_RADIUS_METERS
      );
    });
    if (nearbyOwn.length >= AREA_TRAP_LIMIT) {
      throw new HttpsError(
        "failed-precondition",
        `You already have ${nearbyOwn.length} trap(s) within ${AREA_LIMIT_RADIUS_METERS}m here. Space your traps out more!`
      );
    }

    const trapDef = await getTrapDefinition(trapTypeId);
    const userAgeGroup = await getUserAgeGroup(uid);
    const allowedAgeGroups = normalizeAllowedAgeGroups(trapDef.allowedAgeGroups);
    if (!allowedAgeGroups.includes(userAgeGroup)) {
      throw new HttpsError(
        "permission-denied",
        "This trap is not available for your age group."
      );
    }

    const modifiers = await getUserLevelModifiers(uid);
    const requiredHoldSeconds = applyPercentReductionToSeconds(
      asNumber(trapDef.placementHoldSeconds, 3),
      modifiers.placementReductionPercent
    );

    await ensureUserTrapInventory(uid);
    await applyTrapRefills(uid);
    await normalizeInventoryToWeightLimit(uid);

    const db = getDb();
    const inventoryRef = db
      .collection("user_trap_inventory")
      .doc(getInventoryDocId(uid, trapDef.id));
    const inventorySnap = await inventoryRef.get();
    const inventory = inventorySnap.data() ?? {};
    const bagCount =
      typeof inventory.bagCount === "number" && Number.isFinite(inventory.bagCount)
        ? inventory.bagCount
        : 0;

    if (bagCount <= 0) {
      throw new HttpsError(
        "failed-precondition",
        "No trap of this type available in bag."
      );
    }

    const timeZone = await getUserTimeZone(uid);
    const { dateKey } = getDatePartsForTimezone(timeZone);
    const sessionRef = db.collection("trap_placement_sessions").doc();

    await db.runTransaction(async (tx) => {
      const { data: daily } = await ensureDailyState(tx, uid, dateKey, timeZone);
      const trapsAvailable =
        typeof daily.trapsAvailable === "number" ? daily.trapsAvailable : 5;
      const trapsUsed = typeof daily.trapsUsed === "number" ? daily.trapsUsed : 0;
      if (trapsAvailable <= 0) {
        const reason =
          trapsUsed === 0
            ? "Your daily trap quota was reduced by a game penalty (being caught). Try again tomorrow or ask an admin to reset your quota."
            : `No more placements available today. You have used all ${trapsUsed} of your daily traps.`;
        throw new HttpsError("failed-precondition", reason);
      }

      tx.set(sessionRef, {
        uid,
        trapTypeId: trapDef.id,
        lat,
        lng,
        geohash: geohashForLocation([lat, lng]),
        requiredHoldSeconds,
        progressSeconds: 0,
        status: "in_progress",
        iconKey: trapDef.iconKey,
        effectKind: trapDef.effectKind,
        effectValue: trapDef.effectValue,
        radiusMeters: trapDef.radiusMeters,
        disarmRadiusMeters: trapDef.disarmRadiusMeters,
        placementLeaveSeconds: Math.max(1, Math.round(asNumber(trapDef.placementLeaveSeconds, 15) * modifiers.leaveMultiplier)),
        visibility: trapDef.visibility,
        ownerCanTrigger: trapDef.ownerCanTrigger,
        allowedAgeGroups: normalizeAllowedAgeGroups(trapDef.allowedAgeGroups),
        expiryHours: trapDef.expiryHours ?? 48,
        dateKey,
        startedAt: FieldValue.serverTimestamp(),
        lastTapAt: null,
      });
    });

    return {
      ok: true,
      sessionId: sessionRef.id,
      trapTypeId: trapDef.id,
      requiredHoldSeconds,
      placementLeaveSeconds: Math.max(1, Math.round(asNumber(trapDef.placementLeaveSeconds, 15) * modifiers.leaveMultiplier)),
      iconKey: trapDef.iconKey,
      bagCount,
      ageGroup: userAgeGroup,
      allowedAgeGroups,
    };
  } catch (error) {
    logger.error("startTrapPlacement crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const tapTrapPlacement = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const sessionId = typeof data.sessionId === "string" ? data.sessionId.trim() : "";
    const incrementSeconds =
      typeof data.incrementSeconds === "number" &&
      data.incrementSeconds > 0 &&
      data.incrementSeconds <= 5
        ? data.incrementSeconds
        : 1;

    if (!sessionId) {
      throw new HttpsError("invalid-argument", "sessionId is required.");
    }

    const db = getDb();
    const sessionRef = db.collection("trap_placement_sessions").doc(sessionId);
    let placedTrapId: string | null = null;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(sessionRef);
      const session = snap.data();
      if (!session) {
        throw new HttpsError("not-found", "Placement session not found.");
      }
      if (session.uid !== uid) {
        throw new HttpsError("permission-denied", "Not your placement session.");
      }
      if (session.status !== "in_progress") return;

      // Re-check player distance to placement spot every tap so the 5-second out-of-range
      // cancel has server enforcement (same pattern as tapTrapDisarm).
      const sessionLat = asNumber(session.lat, 0);
      const sessionLng = asNumber(session.lng, 0);
      if (sessionLat !== 0 || sessionLng !== 0) {
        const placPlayerLoc = await getPlayerLocation(uid);
        const placDist = metersBetween(placPlayerLoc.lat, placPlayerLoc.lng, sessionLat, sessionLng);
        if (placDist > PLACEMENT_MAX_DISTANCE_METERS) {
          const needed = Math.ceil(placDist - PLACEMENT_MAX_DISTANCE_METERS);
          throw new HttpsError(
            "failed-precondition",
            `closer:${needed}:${Math.round(placDist)}:${PLACEMENT_MAX_DISTANCE_METERS}`
          );
        }
      }

      const nextProgress =
        (typeof session.progressSeconds === "number" ? session.progressSeconds : 0) +
        incrementSeconds;
      const requiredHoldSeconds =
        typeof session.requiredHoldSeconds === "number"
          ? session.requiredHoldSeconds
          : 3;

      if (nextProgress < requiredHoldSeconds) {
        tx.update(sessionRef, {
          progressSeconds: nextProgress,
          lastTapAt: FieldValue.serverTimestamp(),
        });
        return;
      }

      const trapTypeId = String(session.trapTypeId ?? "");
      const inventoryRef = db
        .collection("user_trap_inventory")
        .doc(getInventoryDocId(uid, trapTypeId));
      const inventorySnap = await tx.get(inventoryRef);
      const inventory = inventorySnap.data() ?? {};
      const bagCount =
        typeof inventory.bagCount === "number" && Number.isFinite(inventory.bagCount)
          ? inventory.bagCount
          : 0;

      if (bagCount <= 0) {
        throw new HttpsError(
          "failed-precondition",
          "No trap of this type available in bag."
        );
      }

      const timeZone = await getUserTimeZone(uid);
      const { dateKey } = getDatePartsForTimezone(timeZone);
      const { ref: dailyRef, data: daily } = await ensureDailyState(
        tx,
        uid,
        dateKey,
        timeZone
      );
      const trapsAvailable =
        typeof daily.trapsAvailable === "number" ? daily.trapsAvailable : 5;
      const trapsUsed = typeof daily.trapsUsed === "number" ? daily.trapsUsed : 0;

      if (trapsAvailable <= 0) {
        const reason =
          trapsUsed === 0
            ? "Your daily trap quota was reduced by a game penalty (being caught). Try again tomorrow or ask an admin to reset your quota."
            : `No more placements available today. You have used all ${trapsUsed} of your daily traps.`;
        throw new HttpsError("failed-precondition", reason);
      }

      const trapRef = db.collection("traps").doc();
      placedTrapId = trapRef.id;

      const expiryHours =
        typeof session.expiryHours === "number" && session.expiryHours > 0
          ? session.expiryHours
          : 48;
      const expiresAt = Timestamp.fromMillis(Date.now() + expiryHours * 3_600_000);

      tx.set(trapRef, {
        ownerUid: uid,
        trapTypeId: session.trapTypeId,
        iconKey: session.iconKey,
        effectKind: session.effectKind,
        effectValue: session.effectValue,
        radiusMeters: session.radiusMeters,
        disarmRadiusMeters: session.disarmRadiusMeters,
        visibility: session.visibility,
        ownerCanTrigger: session.ownerCanTrigger,
        allowedAgeGroups: Array.isArray(session.allowedAgeGroups)
          ? session.allowedAgeGroups
          : ["minor", "adult"],
        status: "active",
        lat: session.lat,
        lng: session.lng,
        geohash: session.geohash,
        dateKey: session.dateKey,
        expiresAt,
        createdAt: FieldValue.serverTimestamp(),
        revealedTo: {
          [uid]: {
            progressSeconds: requiredHoldSeconds,
            done: true,
            revealedAt: FieldValue.serverTimestamp(),
          },
        },
        capturedUserId: null,
        capturedAt: null,
        captureDistanceMeters: null,
        disarmedBy: null,
        disarmedAt: null,
      });

      tx.update(sessionRef, {
        progressSeconds: nextProgress,
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        trapId: trapRef.id,
        lastTapAt: FieldValue.serverTimestamp(),
      });

      const nextBagCount = Math.max(0, bagCount - 1);

      tx.set(
        inventoryRef,
        {
          uid,
          trapTypeId,
          bagCount: nextBagCount,
          lastRefillAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(
        dailyRef,
        {
          trapsAvailable: trapsAvailable - 1,
          trapsUsed: trapsUsed + 1,
          lastUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    return { ok: true, completed: !!placedTrapId, trapId: placedTrapId };
  } catch (error) {
    logger.error("tapTrapPlacement crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const updatePlayerLocation = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const { lat, lng } = assertLatLng(data.lat, data.lng);

    const db = getDb();
    const locationRef = db.collection("player_locations").doc(uid);
    const geohash = geohashForLocation([lat, lng]);
    const timeZone = await getUserTimeZone(uid);
    const { dateKey } = getDatePartsForTimezone(timeZone);
    const [allowSelfTrapTrigger, playerAgeGroup, userSnap] = await Promise.all([
      getAllowSelfTrapTrigger(),
      getUserAgeGroup(uid),
      db.collection("users").doc(uid).get(),
    ]);

    // #7 — Safe-zone / home-base immunity
    const homeBase = userSnap.data()?.homeBase;
    if (
      homeBase &&
      typeof homeBase.lat === "number" &&
      typeof homeBase.lng === "number"
    ) {
      const homeRadius =
        typeof homeBase.radiusMeters === "number" ? homeBase.radiusMeters : 100;
      if (metersBetween(lat, lng, homeBase.lat, homeBase.lng) <= homeRadius) {
        // Player is inside their safe zone — update location but skip all trap checks
        await locationRef.set(
          { uid, lat, lng, geohash, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
        return { captured: false, dateKey, nearbyTraps: [], inSafeZone: true };
      }
    }

    await locationRef.set(
      {
        uid,
        lat,
        lng,
        geohash,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Use the player's level visibility radius for trap scanning — premium players
    // can detect (and walk toward) traps from further away.
    const levelId = asString((userSnap.data() ?? {}).levelId, "free");
    let trapSearchRadiusMeters = ACTIVE_TRAP_SEARCH_RADIUS_METERS;
    let playerRangeMultiplier = 1;
    let playerLeaveMultiplier = 1;
    if (levelId) {
      const ld = (await cachedDocData("user_levels", levelId)) ?? {};
      if (typeof ld.mapVisibilityRadiusMeters === "number" && ld.mapVisibilityRadiusMeters > 0) {
        // Allow up to 5 km; never less than the hard minimum so captures always work.
        trapSearchRadiusMeters = Math.min(
          Math.max(ld.mapVisibilityRadiusMeters, ACTIVE_TRAP_SEARCH_RADIUS_METERS),
          5000
        );
      }
      playerRangeMultiplier = clampMultiplier(ld.rangeMultiplier);
      playerLeaveMultiplier = clampMultiplier(ld.leaveMultiplier);
    }

    const bounds = geohashQueryBounds([lat, lng], trapSearchRadiusMeters);
    const candidateSnaps = await Promise.all(
      bounds.map(([start, end]) =>
        db
          .collection("traps")
          .where("status", "==", "active")
          .orderBy("geohash")
          .startAt(start)
          .endAt(end)
          .get()
      )
    );

    const candidates = new Map<string, QueryDocumentSnapshot>();
    for (const snap of candidateSnaps) {
      for (const doc of snap.docs) {
        if (!candidates.has(doc.id)) candidates.set(doc.id, doc);
      }
    }

    // Traps within 250m but outside capture radius are "nearby" — warn the player.
    const nearbyTraps: Array<{
      trapId: string; trapTypeId: string; iconKey: string;
      distanceMeters: number; radiusMeters: number; disarmRadiusMeters: number;
      disarmLeaveSeconds: number; placementLeaveSeconds: number;
      lat: number; lng: number;
    }> = [];

    for (const [, doc] of candidates) {
      const trap = doc.data();
      if (trap.ownerUid === uid && !allowSelfTrapTrigger) continue;
      if (trap.status !== "active") continue;

      const distanceMeters = metersBetween(lat, lng, trap.lat, trap.lng);
      const trapRadius = typeof trap.radiusMeters === "number" ? trap.radiusMeters : 25;

      // Fetch trap definition for scoreValue (weight) and age-group isolation.
      // Fetched here (before the radius branch) so it applies to both capture and nearby.
      const candidateTrapTypeId = typeof trap.trapTypeId === "string" ? trap.trapTypeId : "";
      const candidateTrapDef = candidateTrapTypeId
        ? await getTrapDefinition(candidateTrapTypeId)
        : undefined;

      // Age-group isolation: adults cannot be captured by kids' traps and vice-versa.
      if (candidateTrapDef) {
        const trapGroups = normalizeAllowedAgeGroups(candidateTrapDef.allowedAgeGroups);
        if (!trapGroups.includes(playerAgeGroup)) continue;
      }

      if (distanceMeters > trapRadius) {
        // Player is within the search zone but outside the capture radius → nearby warning.
        // The search zone can reach 5 km for high levels (and geohash cells overshoot it),
        // but a danger alert only makes sense within the base 250 m.
        if (distanceMeters > ACTIVE_TRAP_SEARCH_RADIUS_METERS) continue;
        const disarmRad = typeof trap.disarmRadiusMeters === "number" && trap.disarmRadiusMeters > trapRadius
          ? trap.disarmRadiusMeters
          : trapRadius + 1;
        nearbyTraps.push({
          trapId: doc.id,
          trapTypeId: candidateTrapTypeId,
          iconKey: asString(candidateTrapDef?.iconKey ?? trap.iconKey, ""),
          distanceMeters: Math.round(distanceMeters),
          radiusMeters: trapRadius,
          disarmRadiusMeters: Math.round(disarmRad * playerRangeMultiplier),
          disarmLeaveSeconds: Math.max(1, Math.round((candidateTrapDef?.disarmLeaveSeconds ?? 15) * playerLeaveMultiplier)),
          placementLeaveSeconds: Math.max(1, Math.round((candidateTrapDef?.placementLeaveSeconds ?? 15) * playerLeaveMultiplier)),
          lat: typeof trap.lat === "number" ? trap.lat : 0,
          lng: typeof trap.lng === "number" ? trap.lng : 0,
        });
        continue;
      }

      const captureScoreValue = normalizeWeight(candidateTrapDef?.weight);

      let captureSummary: Record<string, unknown> | null = null;

      await db.runTransaction(async (tx) => {
        const trapRef = doc.ref;
        const trapSnap = await tx.get(trapRef);
        const trapLive = trapSnap.data();
        if (!trapLive || trapLive.status !== "active") return;
        if (trapLive.ownerUid === uid && !allowSelfTrapTrigger) return;

        const ownerUid = String(trapLive.ownerUid);
        const ownerRef = db.collection("users").doc(ownerUid);
        const capturedUserRef = db.collection("users").doc(uid);

        // getUserTimeZone uses db.get() (not tx.get()), safe to call anytime
        const ownerTimeZone = await getUserTimeZone(ownerUid);
        const capturedTimeZone = await getUserTimeZone(uid);
        const { dateKey: ownerDateKey } = getDatePartsForTimezone(ownerTimeZone);
        const { dateKey: capturedDateKey } = getDatePartsForTimezone(capturedTimeZone);

        // Build daily state refs directly so we can read them all BEFORE any writes
        const ownerDailyRef = db.collection("daily_state").doc(`${ownerUid}_${ownerDateKey}`);
        const capturedDailyRef = db.collection("daily_state").doc(`${uid}_${capturedDateKey}`);

        // ── ALL tx reads before any tx writes (Firestore transaction rule) ──
        // #10 — check ally immunity: if captive is friends with the trap owner, skip capture
        const friendRef = db
          .collection("users").doc(uid)
          .collection("friends").doc(ownerUid);

        const [ownerDailySnap, capturedDailySnap, ownerSnap, capturedSnap, friendSnap] =
          await Promise.all([
            tx.get(ownerDailyRef),
            tx.get(capturedDailyRef),
            tx.get(ownerRef),
            tx.get(capturedUserRef),
            tx.get(friendRef),
          ]);

        // Allies are immune — don't trigger each other's traps
        if (friendSnap.exists) return;

        const ownerData = ownerSnap.data() ?? {};
        const capturedData = capturedSnap.data() ?? {};
        const ownerDaily = ownerDailySnap.exists
          ? (ownerDailySnap.data() ?? {})
          : { trapsAvailable: 5, trapsUsed: 0, capturesToday: 0, penaltiesToday: 0 };
        const capturedDaily = capturedDailySnap.exists
          ? (capturedDailySnap.data() ?? {})
          : { trapsAvailable: 5, trapsUsed: 0, capturesToday: 0, penaltiesToday: 0 };

        // ── Initialise daily-state docs if they are new (writes come after all reads) ──
        if (!ownerDailySnap.exists) {
          tx.set(ownerDailyRef, {
            uid: ownerUid, dateKey: ownerDateKey, timeZone: ownerTimeZone,
            trapsAvailable: 5, trapsUsed: 0, capturesToday: 0, penaltiesToday: 0,
            initializedAt: FieldValue.serverTimestamp(),
            lastUpdatedAt: FieldValue.serverTimestamp(),
          });
        }
        if (!capturedDailySnap.exists) {
          tx.set(capturedDailyRef, {
            uid, dateKey: capturedDateKey, timeZone: capturedTimeZone,
            trapsAvailable: 5, trapsUsed: 0, capturesToday: 0, penaltiesToday: 0,
            initializedAt: FieldValue.serverTimestamp(),
            lastUpdatedAt: FieldValue.serverTimestamp(),
          });
        }
        const ownerUsername =
          typeof ownerData.username === "string" ? ownerData.username : "";
        const capturedUsername =
          typeof capturedData.username === "string" ? capturedData.username : "";
        const ownerCaptureCount =
          typeof ownerData.captureCount === "number" ? ownerData.captureCount : 0;
        const timesCaught =
          typeof capturedData.timesCaught === "number" ? capturedData.timesCaught : 0;
        const ownerCapturesToday =
          typeof ownerDaily.capturesToday === "number"
            ? ownerDaily.capturesToday
            : 0;
        const capturedPenalties =
          typeof capturedDaily.penaltiesToday === "number"
            ? capturedDaily.penaltiesToday
            : 0;
        const roundedDistance = Math.round(distanceMeters * 100) / 100;
        const captureRef = db.collection("captures").doc();

        tx.update(trapRef, {
          status: "captured",
          capturedUserId: uid,
          capturedUsername,
          capturedAt: FieldValue.serverTimestamp(),
          captureDistanceMeters: roundedDistance,
        });

        tx.set(captureRef, {
          trapId: trapRef.id,
          ownerUid,
          ownerUsername,
          capturedUserId: uid,
          capturedUsername,
          capturedAt: FieldValue.serverTimestamp(),
          dateKey,
          trapTypeId: trapLive.trapTypeId,
          iconKey: trapLive.iconKey ?? null,
          effectKind: trapLive.effectKind,
          effectValue: trapLive.effectValue,
          captureDistanceMeters: roundedDistance,
          lat: trapLive.lat,
          lng: trapLive.lng,
          scoreValue: captureScoreValue,
          scoringCapture: true,
        });

        tx.set(
          ownerDailyRef,
          {
            capturesToday: ownerCapturesToday + 1,
            lastUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        tx.set(
          capturedDailyRef,
          {
            trapsAvailable: Math.max(
              0,
              (typeof capturedDaily.trapsAvailable === "number"
                ? capturedDaily.trapsAvailable
                : 5) - 5
            ),
            penaltiesToday: capturedPenalties + 1,
            lastUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        tx.set(
          ownerRef,
          {
            captureCount: ownerCaptureCount + 1,
            xp: FieldValue.increment(captureScoreValue),
            lastSeenAt: FieldValue.serverTimestamp(),
            lastCapturedUserId: uid,
            lastCapturedUsername: capturedUsername,
            lastCapturedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        const effectValue =
          typeof trapLive.effectValue === "number" ? trapLive.effectValue : 1;
        let activePenalty: Record<string, unknown>;

        switch (trapLive.effectKind) {
          case "timeout":
            activePenalty = {
              kind: "timeout",
              untilEpochMs: Date.now() + effectValue * 1000,
              sourceTrapId: trapRef.id,
            };
            break;
          case "laughter":
            activePenalty = {
              kind: "laughter",
              untilEpochMs: Date.now() + 5000,
              sourceTrapId: trapRef.id,
            };
            break;
          case "slowdown":
            activePenalty = {
              kind: "slowdown",
              value: effectValue,
              untilEpochMs: Date.now() + 60000,
              sourceTrapId: trapRef.id,
            };
            break;
          case "penalty":
            activePenalty = {
              kind: "penalty",
              value: effectValue,
              untilEpochMs: Date.now() + 60000,
              sourceTrapId: trapRef.id,
            };
            break;
          default:
            activePenalty = {
              kind: "warning",
              untilEpochMs: Date.now() + 10000,
              sourceTrapId: trapRef.id,
            };
            break;
        }

        tx.set(
          capturedUserRef,
          {
            timesCaught: timesCaught + 1,
            lastSeenAt: FieldValue.serverTimestamp(),
            activePenalty,
            lastTrappedByUid: ownerUid,
            lastTrappedByUsername: ownerUsername,
            lastTrappedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        captureSummary = {
          captured: true,
          trapId: trapRef.id,
          trapTypeId: trapLive.trapTypeId,
          iconKey:   asString(candidateTrapDef?.iconKey,   trapLive.iconKey   ?? ""),
          soundKey:  asString(candidateTrapDef?.soundKey,  "")  || null,
          emoji:     asString(candidateTrapDef?.emoji,     "")  || null,
          imageUrl:  asString(candidateTrapDef?.imageUrl,  "")  || null,
          effectKind: trapLive.effectKind,
          effectValue,
          distanceMeters: roundedDistance,
          dateKey,
          ownerUid,
          ownerUsername,
          capturedUserId: uid,
          capturedUsername,
        };
      });

      if (captureSummary) {
        const cs = captureSummary as Record<string, unknown>;

        // #1 — notify the trap owner (include trap details for in-app celebration overlay)
        void pushToUser(
          db,
          asString(cs["ownerUid"]),
          "🎉 Your trap caught someone!",
          `@${asString(cs["capturedUsername"])} walked into your trap!`,
          {
            type:             "trap_captured",
            trapTypeId:       asString(cs["trapTypeId"]),
            iconKey:          asString(cs["iconKey"]),
            soundKey:         asString(cs["soundKey"] ?? ""),
            emoji:            asString(cs["emoji"] ?? ""),
            imageUrl:         asString(cs["imageUrl"] ?? ""),
            effectKind:       asString(cs["effectKind"]),
            effectValue:      String(cs["effectValue"] ?? 0),
            capturedUsername: asString(cs["capturedUsername"]),
          }
        );

        // #6 — notify the captured player so the overlay shows even when
        // the location polling service is killed or slow (FCM as fallback)
        void pushToUser(
          db,
          asString(cs["capturedUserId"]),
          "🪤 You've been trapped!",
          `@${asString(cs["ownerUsername"])} caught you. Check your app!`,
          {
            type:          "trap_captured_you",
            trapTypeId:    asString(cs["trapTypeId"]),
            iconKey:       asString(cs["iconKey"]),
            soundKey:      asString(cs["soundKey"] ?? ""),
            emoji:         asString(cs["emoji"] ?? ""),
            imageUrl:      asString(cs["imageUrl"] ?? ""),
            effectKind:    asString(cs["effectKind"]),
            effectValue:   String(cs["effectValue"] ?? 0),
            ownerUid:      asString(cs["ownerUid"]),
            ownerUsername: asString(cs["ownerUsername"]),
          }
        );

        return captureSummary;
      }
    }

    return { captured: false, dateKey, nearbyTraps };
  } catch (error) {
    logger.error("updatePlayerLocation crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const revealNearbyTrap = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const trapId = typeof data.trapId === "string" ? data.trapId.trim() : "";
    const incrementSeconds =
      typeof data.incrementSeconds === "number" &&
      data.incrementSeconds > 0 &&
      data.incrementSeconds <= 5
        ? data.incrementSeconds
        : 1;

    if (!trapId) {
      throw new HttpsError("invalid-argument", "trapId is required.");
    }

    const db = getDb();
    const trapRef = db.collection("traps").doc(trapId);
    const modifiers = await getUserLevelModifiers(uid);
    let response: Record<string, unknown> = { ok: true, revealed: false };

    await db.runTransaction(async (tx) => {
      const trapSnap = await tx.get(trapRef);
      const trap = trapSnap.data();
      if (!trap || trap.status !== "active") {
        throw new HttpsError("not-found", "Trap not found or inactive.");
      }

      const trapDef = await getTrapDefinition(String(trap.trapTypeId));
      const disarmRadiusMeters = Math.round(trapDef.disarmRadiusMeters * modifiers.rangeMultiplier);
      const trapRadius = typeof trap.radiusMeters === "number" ? trap.radiusMeters : 25;

      const playerLoc = await getPlayerLocation(uid);
      const distanceMeters = metersBetween(playerLoc.lat, playerLoc.lng, trap.lat, trap.lng);

      // Stepped inside capture zone during reveal → fire trap immediately
      if (distanceMeters <= trapRadius && await captureZoneApplies(trap.ownerUid, uid)) {
        throw new HttpsError(
          "failed-precondition",
          `inside-trap-zone:${trapRadius}`
        );
      }
      if (distanceMeters > disarmRadiusMeters) {
        const needed = Math.ceil(distanceMeters - disarmRadiusMeters);
        throw new HttpsError(
          "failed-precondition",
          `closer:${needed}:${Math.round(distanceMeters)}:${disarmRadiusMeters}`
        );
      }

      // Age-group isolation: prevent cross-age reveal attempts.
      const revealerAgeGroup = await getUserAgeGroup(uid);
      const trapGroups = normalizeAllowedAgeGroups(trapDef.allowedAgeGroups);
      if (!trapGroups.includes(revealerAgeGroup)) {
        throw new HttpsError(
          "permission-denied",
          "This trap belongs to a different age group."
        );
      }

      const effectiveRevealHoldSeconds = applyPercentReductionToSeconds(
        asNumber(trapDef.revealHoldSeconds, 2),
        modifiers.revealReductionPercent
      );

      const progressPath = `revealedTo.${uid}.progressSeconds`;
      const donePath = `revealedTo.${uid}.done`;
      const atPath = `revealedTo.${uid}.revealedAt`;
      const revealedTo =
        trap.revealedTo && typeof trap.revealedTo === "object"
          ? trap.revealedTo
          : {};
      const currentEntry =
        revealedTo[uid] && typeof revealedTo[uid] === "object"
          ? revealedTo[uid]
          : {};
      const currentProgress =
        typeof currentEntry.progressSeconds === "number"
          ? currentEntry.progressSeconds
          : 0;
      const nextProgress = currentProgress + incrementSeconds;

      if (nextProgress < effectiveRevealHoldSeconds) {
        tx.update(trapRef, { [progressPath]: nextProgress });
        response = {
          ok: true,
          revealed: false,
          progressSeconds: nextProgress,
          requiredHoldSeconds: effectiveRevealHoldSeconds,
          disarmLeaveSeconds: Math.max(1, Math.round(asNumber(trapDef.disarmLeaveSeconds, 15) * modifiers.leaveMultiplier)),
        };
        return;
      }

      tx.update(trapRef, {
        [progressPath]: nextProgress,
        [donePath]: true,
        [atPath]: FieldValue.serverTimestamp(),
      });

      response = {
        ok: true,
        revealed: true,
        trapId,
        trapTypeId: trap.trapTypeId,
        iconKey: trap.iconKey,
        effectKind: trap.effectKind,
        effectValue: trap.effectValue,
        disarmHoldSeconds: applyPercentReductionToSeconds(
          asNumber(trapDef.disarmHoldSeconds, 4),
          modifiers.disarmReductionPercent
        ),
      };
    });

    return response;
  } catch (error) {
    logger.error("revealNearbyTrap crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const startTrapDisarm = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const trapId = typeof data.trapId === "string" ? data.trapId.trim() : "";

    if (!trapId) {
      throw new HttpsError("invalid-argument", "trapId is required.");
    }

    const db = getDb();
    const trapSnap = await db.collection("traps").doc(trapId).get();
    const trap = trapSnap.data();
    if (!trap || trap.status !== "active") {
      throw new HttpsError("not-found", "Trap not found or inactive.");
    }

    const revealedTo =
      trap.revealedTo && typeof trap.revealedTo === "object" ? trap.revealedTo : {};
    const revealEntry =
      revealedTo[uid] && typeof revealedTo[uid] === "object"
        ? revealedTo[uid]
        : null;
    if (!revealEntry || revealEntry.done !== true) {
      throw new HttpsError("failed-precondition", "Reveal the trap first.");
    }

    const [trapDef, modifiers, disarmerAgeGroup, playerLoc] = await Promise.all([
      getTrapDefinition(String(trap.trapTypeId)),
      getUserLevelModifiers(uid),
      getUserAgeGroup(uid),
      getPlayerLocation(uid),
    ]);

    const trapRadius = typeof trap.radiusMeters === "number" ? trap.radiusMeters : 25;
    const disarmRadiusMeters = Math.round(trapDef.disarmRadiusMeters * modifiers.rangeMultiplier);
    const distanceMeters = metersBetween(playerLoc.lat, playerLoc.lng, trap.lat, trap.lng);

    // Stepped inside the capture zone → this counts as being trapped
    if (distanceMeters <= trapRadius && await captureZoneApplies(trap.ownerUid, uid)) {
      throw new HttpsError(
        "failed-precondition",
        `inside-trap-zone:${trapRadius}`
      );
    }
    if (distanceMeters > disarmRadiusMeters) {
      const needed = Math.ceil(distanceMeters - disarmRadiusMeters);
      throw new HttpsError(
        "failed-precondition",
        `closer:${needed}:${Math.round(distanceMeters)}:${disarmRadiusMeters}`
      );
    }

    // Age-group isolation: prevent cross-age disarm attempts.
    const disarmTrapGroups = normalizeAllowedAgeGroups(trapDef.allowedAgeGroups);
    if (!disarmTrapGroups.includes(disarmerAgeGroup)) {
      throw new HttpsError(
        "permission-denied",
        "This trap belongs to a different age group."
      );
    }

    const requiredHoldSeconds = applyPercentReductionToSeconds(
      asNumber(trapDef.disarmHoldSeconds, 4),
      modifiers.disarmReductionPercent
    );

    const sessionRef = db.collection("trap_disarm_sessions").doc();
    await sessionRef.set({
      trapId,
      uid,
      requiredHoldSeconds,
      progressSeconds: 0,
      status: "in_progress",
      // Store geometry so tapTrapDisarm can re-check range each tap
      trapLat: asNumber(trap.lat, 0),
      trapLng: asNumber(trap.lng, 0),
      trapRadiusMeters: trapRadius,
      disarmRadiusMeters,
      disarmLeaveSeconds: Math.max(1, Math.round(asNumber(trapDef.disarmLeaveSeconds, 15) * modifiers.leaveMultiplier)),
      startedAt: FieldValue.serverTimestamp(),
      lastTapAt: null,
    });

    return {
      ok: true,
      sessionId: sessionRef.id,
      trapId,
      requiredHoldSeconds,
      disarmLeaveSeconds: Math.max(1, Math.round(asNumber(trapDef.disarmLeaveSeconds, 15) * modifiers.leaveMultiplier)),
    };
  } catch (error) {
    logger.error("startTrapDisarm crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const tapTrapDisarm = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const sessionId = typeof data.sessionId === "string" ? data.sessionId.trim() : "";
    const incrementSeconds =
      typeof data.incrementSeconds === "number" &&
      data.incrementSeconds > 0 &&
      data.incrementSeconds <= 5
        ? data.incrementSeconds
        : 1;

    if (!sessionId) {
      throw new HttpsError("invalid-argument", "sessionId is required.");
    }

    const db = getDb();
    const sessionRef = db.collection("trap_disarm_sessions").doc(sessionId);
    let disarmedTrapId: string | null = null;
    let disarmedTrapOwnerUid = "";

    await db.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      const session = sessionSnap.data();
      if (!session) {
        throw new HttpsError("not-found", "Disarm session not found.");
      }
      if (session.uid !== uid) {
        throw new HttpsError("permission-denied", "Not your disarm session.");
      }
      if (session.status !== "in_progress") return;

      const trapRef = db.collection("traps").doc(String(session.trapId));
      const trapSnap = await tx.get(trapRef);
      const trap = trapSnap.data();
      if (!trap || trap.status !== "active") {
        tx.update(sessionRef, {
          status: "aborted",
          abortedAt: FieldValue.serverTimestamp(),
        });
        return;
      }

      const revealedTo =
        trap.revealedTo && typeof trap.revealedTo === "object"
          ? trap.revealedTo
          : {};
      const revealEntry =
        revealedTo[uid] && typeof revealedTo[uid] === "object"
          ? revealedTo[uid]
          : null;
      if (!revealEntry || revealEntry.done !== true) {
        throw new HttpsError("failed-precondition", "Reveal the trap first.");
      }

      // Re-check player distance every tap — gives the 5-second out-of-range cancel its
      // server-side enforcement. GPS drift causes at most one transient "closer" error per
      // tick; the client counts 5 consecutive errors before cancelling, which absorbs drift.
      const sessionDisarmRadius = typeof session.disarmRadiusMeters === "number"
        ? session.disarmRadiusMeters : 50;
      const sessionTrapRadius = typeof session.trapRadiusMeters === "number"
        ? session.trapRadiusMeters : 25;
      const sessionTrapLat = asNumber(session.trapLat, 0);
      const sessionTrapLng = asNumber(session.trapLng, 0);

      if (sessionTrapLat !== 0 || sessionTrapLng !== 0) {
        const tapPlayerLoc = await getPlayerLocation(uid);
        const tapDist = metersBetween(tapPlayerLoc.lat, tapPlayerLoc.lng, sessionTrapLat, sessionTrapLng);

        // Entered capture zone while disarming → trap fires
        if (tapDist <= sessionTrapRadius && await captureZoneApplies(trap.ownerUid, uid)) {
          tx.update(sessionRef, { status: "aborted", abortedAt: FieldValue.serverTimestamp() });
          throw new HttpsError("failed-precondition", `inside-trap-zone:${sessionTrapRadius}`);
        }
        // Left disarm zone
        if (tapDist > sessionDisarmRadius) {
          const needed = Math.ceil(tapDist - sessionDisarmRadius);
          throw new HttpsError(
            "failed-precondition",
            `closer:${needed}:${Math.round(tapDist)}:${sessionDisarmRadius}`
          );
        }
      }

      // Read inventory BEFORE any writes — Firestore requires all reads before writes.
      const disarmedTrapTypeId = asString(trap.trapTypeId);
      let disarmerInvRef: FirebaseFirestore.DocumentReference | null = null;
      let disarmerInvData: FirebaseFirestore.DocumentData | null = null;
      if (disarmedTrapTypeId) {
        disarmerInvRef = db
          .collection("user_trap_inventory")
          .doc(getInventoryDocId(uid, disarmedTrapTypeId));
        const disarmerInvSnap = await tx.get(disarmerInvRef);
        disarmerInvData = disarmerInvSnap.data() ?? {};
      }

      const nextProgress =
        (typeof session.progressSeconds === "number" ? session.progressSeconds : 0) +
        incrementSeconds;
      const requiredHoldSeconds =
        typeof session.requiredHoldSeconds === "number"
          ? session.requiredHoldSeconds
          : 4;

      if (nextProgress < requiredHoldSeconds) {
        tx.update(sessionRef, {
          progressSeconds: nextProgress,
          lastTapAt: FieldValue.serverTimestamp(),
        });
        return;
      }

      tx.update(trapRef, {
        status: "disarmed",
        disarmedBy: uid,
        disarmedAt: FieldValue.serverTimestamp(),
      });
      tx.update(sessionRef, {
        progressSeconds: nextProgress,
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        lastTapAt: FieldValue.serverTimestamp(),
      });

      // Add the disarmed trap to the disarmer's bag if not at max capacity
      if (disarmerInvRef && disarmerInvData !== null) {
        const currentCount =
          typeof disarmerInvData.bagCount === "number" ? disarmerInvData.bagCount : 0;
        const maxSlots = normalizeMaxBagSlots(disarmerInvData.maxBagSlots);
        if (currentCount < maxSlots) {
          tx.set(
            disarmerInvRef,
            {
              uid,
              trapTypeId: disarmedTrapTypeId,
              bagCount: currentCount + 1,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }

      disarmedTrapId = trapRef.id;
      disarmedTrapOwnerUid = asString(trap.ownerUid);
    });

    if (disarmedTrapId && disarmedTrapOwnerUid && disarmedTrapOwnerUid !== uid && disarmedTrapOwnerUid !== "system") {
      // #2 — notify the trap owner that their trap was disarmed (non-blocking)
      const disarmerSnap = await db.collection("users").doc(uid).get();
      const disarmerUsername = asString(disarmerSnap.data()?.username, "someone");
      void pushToUser(
        db,
        disarmedTrapOwnerUid,
        "🛠 Trap disarmed!",
        `@${disarmerUsername} found and disarmed your trap.`,
        { type: "trap_disarmed" }
      );
    }

    return { ok: true, disarmed: !!disarmedTrapId, trapId: disarmedTrapId };
  } catch (error) {
    logger.error("tapTrapDisarm crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const disarmAndCollectTrap = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const trapId = typeof data.trapId === "string" ? data.trapId.trim() : "";

    if (!trapId) {
      throw new HttpsError("invalid-argument", "trapId is required.");
    }

    const db = getDb();
    const trapSnap = await db.collection("traps").doc(trapId).get();
    const trap = trapSnap.data();

    if (!trap) {
      throw new HttpsError("not-found", "Trap not found.");
    }
    if (trap.disarmedBy !== uid) {
      throw new HttpsError("permission-denied", "You did not disarm this trap.");
    }

    const trapTypeId = asString(trap.trapTypeId);

    let trapName = "Trap";
    let iconKey = asString(trap.iconKey, "default");

    try {
      const trapDef = await getTrapDefinition(trapTypeId);
      iconKey = asString(trapDef.iconKey, iconKey);
      trapName = asString(trapDef.name, "Trap");
    } catch {
      // Non-fatal: use fallback values if definition is missing
    }

    return { ok: true, trapId, trapTypeId, trapName, iconKey };
  } catch (error) {
    logger.error("disarmAndCollectTrap crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error instanceof Error ? error.message : "Unknown error");
  }
});

export const resetDailyState = onSchedule(
  {
    schedule: "5 0 * * *",
    timeZone: "Europe/Budapest",
  },
  async () => {
    return;
  }
);

/**
 * Runs hourly. Marks any active trap whose `expiresAt` has passed as "expired"
 * and sends the owner an FCM push so they know the slot is now free.
 */
export const expireOldTraps = onSchedule(
  {
    schedule: "every 60 minutes",
    region: "europe-west1",
  },
  async () => {
    const db = getDb();
    const now = Timestamp.now();

    const snap = await db
      .collection("traps")
      .where("status", "==", "active")
      .where("expiresAt", "<=", now)
      .get();

    if (snap.empty) return;

    const batch = db.batch();
    const ownerNotifications: Array<{ uid: string }> = [];

    for (const doc of snap.docs) {
      batch.update(doc.ref, {
        status: "expired",
        expiredAt: FieldValue.serverTimestamp(),
      });
      const ownerUid = asString(doc.data().ownerUid);
      if (ownerUid) ownerNotifications.push({ uid: ownerUid });
    }

    await batch.commit();
    logger.info(`expireOldTraps: expired ${snap.size} trap(s)`);

    // Notify owners (fire-and-forget, non-fatal)
    await Promise.allSettled(
      ownerNotifications.map(({ uid }) =>
        pushToUser(
          db,
          uid,
          "⏰ Trap expired",
          "One of your traps has been automatically removed. Place a new one!",
          { type: "trap_expired" }
        )
      )
    );
  }
);

/** #7 — Player sets their home-base safe zone at their current physical location. */
export const setHomeBase = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const { lat, lng } = assertLatLng(data.lat, data.lng);
    const radiusMeters = 100; // fixed radius — prevents abuse

    const db = getDb();
    const playerLoc = await getPlayerLocation(uid);
    const distFromPlayer = metersBetween(lat, lng, playerLoc.lat, playerLoc.lng);

    if (distFromPlayer > 200) {
      throw new HttpsError(
        "failed-precondition",
        `You must be within 200m of your chosen home base. You are ${Math.round(distFromPlayer)}m away.`
      );
    }

    await db.collection("users").doc(uid).update({
      homeBase: { lat, lng, radiusMeters },
    });

    return { ok: true, lat, lng, radiusMeters };
  } catch (error) {
    logger.error("setHomeBase crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error instanceof Error ? error.message : "Unknown error");
  }
});

/** #7 — Player removes their home-base safe zone. */
export const removeHomeBase = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const db = getDb();
    await db.collection("users").doc(uid).update({ homeBase: FieldValue.delete() });
    return { ok: true };
  } catch (error) {
    logger.error("removeHomeBase crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error instanceof Error ? error.message : "Unknown error");
  }
});

// ─── Refill ad reward ─────────────────────────────────────────────────────────

/**
 * Shifts a trap type's lastRefillAt back in time by [incrementSeconds], which
 * makes the next refill arrive sooner by exactly that amount.
 *
 * The global per-session cap is enforced client-side (same pattern as placement
 * / disassembly rewards).  The backend just applies the time shift.
 */
export const applyRefillAdReward = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const trapTypeId = typeof data.trapTypeId === "string" ? data.trapTypeId.trim() : "";
  const incrementSeconds =
    typeof data.incrementSeconds === "number" && data.incrementSeconds > 0
      ? Math.round(data.incrementSeconds)
      : 0;

  if (!trapTypeId) throw new HttpsError("invalid-argument", "trapTypeId is required.");
  if (incrementSeconds <= 0) throw new HttpsError("invalid-argument", "incrementSeconds must be > 0.");

  const db = getDb();
  const docId = getInventoryDocId(uid, trapTypeId);
  const ref = db.collection("user_trap_inventory").doc(docId);
  const snap = await ref.get();

  if (!snap.exists) throw new HttpsError("not-found", "Trap inventory item not found.");

  const item = snap.data()!;
  const lastRefillAt = item.lastRefillAt;
  const nowMs = Date.now();

  let lastRefillMs: number;
  if (
    lastRefillAt &&
    typeof (lastRefillAt as { toMillis?: () => number }).toMillis === "function"
  ) {
    lastRefillMs = (lastRefillAt as { toMillis: () => number }).toMillis();
  } else {
    lastRefillMs = nowMs;
  }

  // Shift lastRefillAt backwards so the next refill arrives sooner
  const newLastRefillMs = lastRefillMs - incrementSeconds * 1_000;

  await ref.update({
    lastRefillAt: Timestamp.fromMillis(newLastRefillMs),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Return the new countdown so the client can update its UI immediately
  const refillHours = normalizeRefillHours(item.refillHours);
  const refillIntervalMs = refillHours * 60 * 60 * 1_000;
  const nextRefillMs = newLastRefillMs + refillIntervalMs;
  const secondsUntilNextRefill = Math.max(0, Math.ceil((nextRefillMs - nowMs) / 1_000));

  return { ok: true, secondsUntilNextRefill };
});