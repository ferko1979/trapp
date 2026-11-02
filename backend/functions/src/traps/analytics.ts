import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "../shared/firebase";
import { requireAdmin } from "../shared/admin";
import { requireUser as requireAuthUid } from "../shared/appCheck";

type TrapCountsByType = Record<string, number>;
type CaptureType = "enemy" | "self" | "ally";

type TrapRow = {
  id: string;
  ownerUid: string;
  trapTypeId: string;
  iconKey: string | null;
  status: string;
  lat: number | null;
  lng: number | null;
  dateKey: string | null;
  createdAtEpochMs: number | null;
  capturedAtEpochMs: number | null;
  disarmedAtEpochMs: number | null;
  capturedUserId: string | null;
  capturedUsername: string | null;
  captureDistanceMeters: number | null;
  disarmedBy: string | null;
  effectKind: string | null;
  effectValue: number | null;
  ownerScope: string | null;
  ownerPrimaryAllyGroupId: string | null;
  generatedBy: string | null;
  generatorLocation: string | null;
};

type CaptureRow = {
  id: string;
  trapId: string | null;
  ownerUid: string;
  ownerUsername: string | null;
  ownerPrimaryAllyGroupId: string | null;
  ownerScope: string | null;
  capturedUserId: string | null;
  capturedUsername: string | null;
  capturedPrimaryAllyGroupId: string | null;
  trapTypeId: string | null;
  iconKey: string | null;
  effectKind: string | null;
  effectValue: number | null;
  captureDistanceMeters: number | null;
  lat: number | null;
  lng: number | null;
  dateKey: string | null;
  capturedAtEpochMs: number | null;
  captureType: CaptureType;
  scoringCapture: boolean;
  isSelfTrigger: boolean;
  isAllyTrigger: boolean;
  scoreValue: number;
};

type TrapSummary = {
  total: number;
  active: number;
  captured: number;
  disarmed: number;
  otherStatuses: Record<string, number>;
  byType: TrapCountsByType;
};

type CaptureSummary = {
  total: number;
  scoringCaptures: number;
  enemy: number;
  self: number;
  ally: number;
  byTrapType: TrapCountsByType;
  pointsTotal: number;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
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

function normalizeCaptureType(value: unknown, ownerUid?: string, capturedUid?: string): CaptureType {
  const v = asString(value).trim().toLowerCase();
  if (v === "self" || v === "ally" || v === "enemy") return v as CaptureType;
  if (ownerUid && capturedUid && ownerUid === capturedUid) return "self";
  return "enemy";
}

function numberMapIncrement(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

function emptyTrapSummary(): TrapSummary {
  return {
    total: 0,
    active: 0,
    captured: 0,
    disarmed: 0,
    otherStatuses: {},
    byType: {},
  };
}

function emptyCaptureSummary(): CaptureSummary {
  return {
    total: 0,
    scoringCaptures: 0,
    enemy: 0,
    self: 0,
    ally: 0,
    byTrapType: {},
    pointsTotal: 0,
  };
}

function summarizeTraps(traps: TrapRow[]): TrapSummary {
  const summary = emptyTrapSummary();

  for (const trap of traps) {
    summary.total += 1;

    if (trap.status === "active") summary.active += 1;
    else if (trap.status === "captured") summary.captured += 1;
    else if (trap.status === "disarmed") summary.disarmed += 1;
    else numberMapIncrement(summary.otherStatuses, trap.status || "unknown");

    numberMapIncrement(summary.byType, trap.trapTypeId || "unknown");
  }

  return summary;
}

function summarizeCaptures(captures: CaptureRow[]): CaptureSummary {
  const summary = emptyCaptureSummary();

  for (const capture of captures) {
    summary.total += 1;

    if (capture.captureType === "enemy") summary.enemy += 1;
    else if (capture.captureType === "self") summary.self += 1;
    else if (capture.captureType === "ally") summary.ally += 1;

    if (capture.scoringCapture) {
      summary.scoringCaptures += 1;
      summary.pointsTotal += capture.scoreValue;
    }

    numberMapIncrement(summary.byTrapType, capture.trapTypeId || "unknown");
  }

  return summary;
}

async function loadTrapScoreMap(): Promise<Map<string, number>> {
  const db = getDb();
  const snap = await db.collection("trap_definitions").get();
  const scoreMap = new Map<string, number>();

  snap.docs.forEach((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const trapTypeId = doc.id;
    const scoreValue = asNumber(data.scoreValue, NaN);
    const weight = asNumber(data.weight, NaN);

    if (Number.isFinite(scoreValue)) {
      scoreMap.set(trapTypeId, scoreValue);
    } else if (Number.isFinite(weight)) {
      scoreMap.set(trapTypeId, weight);
    } else {
      scoreMap.set(trapTypeId, 1);
    }
  });

  return scoreMap;
}

function normalizeTrapDoc(id: string, data: Record<string, unknown>): TrapRow {
  return {
    id,
    ownerUid: asString(data.ownerUid),
    trapTypeId: asString(data.trapTypeId),
    iconKey: asNullableString(data.iconKey),
    status: asString(data.status),
    lat: asNullableNumber(data.lat),
    lng: asNullableNumber(data.lng),
    dateKey: asNullableString(data.dateKey),
    createdAtEpochMs: getTimestampMillis(data.createdAt),
    capturedAtEpochMs: getTimestampMillis(data.capturedAt),
    disarmedAtEpochMs: getTimestampMillis(data.disarmedAt),
    capturedUserId: asNullableString(data.capturedUserId),
    capturedUsername: asNullableString(data.capturedUsername),
    captureDistanceMeters: asNullableNumber(data.captureDistanceMeters),
    disarmedBy: asNullableString(data.disarmedBy),
    effectKind: asNullableString(data.effectKind),
    effectValue: asNullableNumber(data.effectValue),
    ownerScope: asNullableString(data.ownerScope),
    ownerPrimaryAllyGroupId: asNullableString(data.ownerPrimaryAllyGroupId),
    generatedBy: asNullableString(data.generatedBy),
    generatorLocation: asNullableString(data.generatorLocation),
  };
}

function buildSourceSummary(traps: TrapRow[]) {
  const system = traps.filter((t) => t.generatedBy === "admin");
  const user   = traps.filter((t) => t.generatedBy !== "admin");

  function bucket(subset: TrapRow[]) {
    const byType: Record<string, number> = {};
    const byLocation: Record<string, number> = {};
    let active = 0, captured = 0, disarmed = 0;
    for (const t of subset) {
      if (t.status === "active")   active++;
      else if (t.status === "captured") captured++;
      else if (t.status === "disarmed") disarmed++;
      numberMapIncrement(byType, t.trapTypeId || "unknown");
      if (t.generatorLocation) numberMapIncrement(byLocation, t.generatorLocation);
    }
    return { total: subset.length, active, captured, disarmed, byType, byLocation };
  }

  return { system: bucket(system), user: bucket(user) };
}

function normalizeCaptureDoc(
  id: string,
  data: Record<string, unknown>,
  trapScoreMap: Map<string, number>
): CaptureRow {
  const ownerUid = asString(data.ownerUid);
  const capturedUserId = asNullableString(data.capturedUserId);
  const trapTypeId = asNullableString(data.trapTypeId);
  const captureType = normalizeCaptureType(data.captureType, ownerUid, capturedUserId ?? undefined);
  const scoringCapture =
    "scoringCapture" in data
      ? asBoolean(data.scoringCapture)
      : captureType === "enemy";

  const explicitScore = asNumber(data.scoreValue, NaN);
  const fallbackScore =
    trapTypeId && trapScoreMap.has(trapTypeId)
      ? trapScoreMap.get(trapTypeId) ?? 1
      : 1;

  return {
    id,
    trapId: asNullableString(data.trapId),
    ownerUid,
    ownerUsername: asNullableString(data.ownerUsername),
    ownerPrimaryAllyGroupId: asNullableString(data.ownerPrimaryAllyGroupId),
    ownerScope: asNullableString(data.ownerScope),
    capturedUserId,
    capturedUsername: asNullableString(data.capturedUsername),
    capturedPrimaryAllyGroupId: asNullableString(data.capturedPrimaryAllyGroupId),
    trapTypeId,
    iconKey: asNullableString(data.iconKey),
    effectKind: asNullableString(data.effectKind),
    effectValue: asNullableNumber(data.effectValue),
    captureDistanceMeters: asNullableNumber(data.captureDistanceMeters),
    lat: asNullableNumber(data.lat),
    lng: asNullableNumber(data.lng),
    dateKey: asNullableString(data.dateKey),
    capturedAtEpochMs: getTimestampMillis(data.capturedAt),
    captureType,
    scoringCapture,
    isSelfTrigger:
      "isSelfTrigger" in data
        ? asBoolean(data.isSelfTrigger)
        : captureType === "self",
    isAllyTrigger:
      "isAllyTrigger" in data
        ? asBoolean(data.isAllyTrigger)
        : captureType === "ally",
    scoreValue: Number.isFinite(explicitScore) ? explicitScore : fallbackScore,
  };
}

export const getMyTrapStatisticsBundle = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const db = getDb();
    const trapScoreMap = await loadTrapScoreMap();

    const [trapsSnap, capturesAsOwnerSnap, capturesAsVictimSnap] = await Promise.all([
      db.collection("traps").where("ownerUid", "==", uid).get(),
      db.collection("captures").where("ownerUid", "==", uid).get(),
      db.collection("captures").where("capturedUserId", "==", uid).get(),
    ]);

    const placedTraps = trapsSnap.docs.map((doc) =>
      normalizeTrapDoc(doc.id, doc.data() as Record<string, unknown>)
    );

    const capturesAsOwner = capturesAsOwnerSnap.docs.map((doc) =>
      normalizeCaptureDoc(doc.id, doc.data() as Record<string, unknown>, trapScoreMap)
    );

    const capturesAsVictim = capturesAsVictimSnap.docs.map((doc) =>
      normalizeCaptureDoc(doc.id, doc.data() as Record<string, unknown>, trapScoreMap)
    );

    return {
      ok: true,
      uid,
      placedTrapsSummary: summarizeTraps(placedTraps),
      capturesAsOwnerSummary: summarizeCaptures(capturesAsOwner),
      capturesAsVictimSummary: summarizeCaptures(capturesAsVictim),
      recentPlacedTraps: placedTraps
        .sort((a, b) => (b.createdAtEpochMs ?? 0) - (a.createdAtEpochMs ?? 0))
        .slice(0, 25),
      recentCapturesAsOwner: capturesAsOwner
        .sort((a, b) => (b.capturedAtEpochMs ?? 0) - (a.capturedAtEpochMs ?? 0))
        .slice(0, 25),
      recentCapturesAsVictim: capturesAsVictim
        .sort((a, b) => (b.capturedAtEpochMs ?? 0) - (a.capturedAtEpochMs ?? 0))
        .slice(0, 25),
    };
  } catch (error) {
    logger.error("getMyTrapStatisticsBundle crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const getMyPlacedTrapsDetailed = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const db = getDb();

    const snap = await db
      .collection("traps")
      .where("ownerUid", "==", uid)
      .get();

    const items = snap.docs
      .map((doc) => normalizeTrapDoc(doc.id, doc.data() as Record<string, unknown>))
      .sort((a, b) => (b.createdAtEpochMs ?? 0) - (a.createdAtEpochMs ?? 0));

    return {
      ok: true,
      uid,
      summary: summarizeTraps(items),
      items,
    };
  } catch (error) {
    logger.error("getMyPlacedTrapsDetailed crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const getMyCaptureHistoryDetailed = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const db = getDb();
    const trapScoreMap = await loadTrapScoreMap();

    const [capturesAsOwnerSnap, capturesAsVictimSnap] = await Promise.all([
      db.collection("captures").where("ownerUid", "==", uid).get(),
      db.collection("captures").where("capturedUserId", "==", uid).get(),
    ]);

    const capturesAsOwner = capturesAsOwnerSnap.docs
      .map((doc) =>
        normalizeCaptureDoc(
          doc.id,
          doc.data() as Record<string, unknown>,
          trapScoreMap
        )
      )
      .sort((a, b) => (b.capturedAtEpochMs ?? 0) - (a.capturedAtEpochMs ?? 0));

    const capturesAsVictim = capturesAsVictimSnap.docs
      .map((doc) =>
        normalizeCaptureDoc(
          doc.id,
          doc.data() as Record<string, unknown>,
          trapScoreMap
        )
      )
      .sort((a, b) => (b.capturedAtEpochMs ?? 0) - (a.capturedAtEpochMs ?? 0));

    return {
      ok: true,
      uid,
      capturesAsOwnerSummary: summarizeCaptures(capturesAsOwner),
      capturesAsVictimSummary: summarizeCaptures(capturesAsVictim),
      capturesAsOwner,
      capturesAsVictim,
    };
  } catch (error) {
    logger.error("getMyCaptureHistoryDetailed crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const adminGetTrapStatisticsOverview = onCall(async (request) => {
  try {
    requireAdmin(request);
    const db = getDb();
    const trapScoreMap = await loadTrapScoreMap();

    const [trapsSnap, capturesSnap] = await Promise.all([
      db.collection("traps").get(),
      db.collection("captures").get(),
    ]);

    const traps = trapsSnap.docs.map((doc) =>
      normalizeTrapDoc(doc.id, doc.data() as Record<string, unknown>)
    );

    const captures = capturesSnap.docs.map((doc) =>
      normalizeCaptureDoc(doc.id, doc.data() as Record<string, unknown>, trapScoreMap)
    );

    return {
      ok: true,
      trapsSummary: summarizeTraps(traps),
      sourceSummary: buildSourceSummary(traps),
      capturesSummary: summarizeCaptures(captures),
      recentTraps: traps
        .sort((a, b) => (b.createdAtEpochMs ?? 0) - (a.createdAtEpochMs ?? 0))
        .slice(0, 25),
      recentCaptures: captures
        .sort((a, b) => (b.capturedAtEpochMs ?? 0) - (a.capturedAtEpochMs ?? 0))
        .slice(0, 25),
    };
  } catch (error) {
    logger.error("adminGetTrapStatisticsOverview crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const adminSearchTrapRecords = onCall(async (request) => {
  try {
    requireAdmin(request);
    const db = getDb();
    const trapScoreMap = await loadTrapScoreMap();

    const data = (request.data ?? {}) as Record<string, unknown>;
    const scope = asString(data.scope, "all").trim().toLowerCase();
    const ownerUid = asString(data.ownerUid).trim();
    const capturedUserId = asString(data.capturedUserId).trim();
    const trapStatus = asString(data.trapStatus).trim().toLowerCase();
    const captureTypeFilter = asString(data.captureType).trim().toLowerCase();
    const limitRaw = asNumber(data.limit, 200);
    const limit = Math.min(Math.max(1, Math.floor(limitRaw)), 1000);

    const [trapsSnap, capturesSnap] = await Promise.all([
      db.collection("traps").get(),
      db.collection("captures").get(),
    ]);

    let traps = trapsSnap.docs.map((doc) =>
      normalizeTrapDoc(doc.id, doc.data() as Record<string, unknown>)
    );

    let captures = capturesSnap.docs.map((doc) =>
      normalizeCaptureDoc(doc.id, doc.data() as Record<string, unknown>, trapScoreMap)
    );

    if (scope && scope !== "all") {
      traps = traps.filter((row) => (row.ownerScope ?? "individual") === scope);
      captures = captures.filter((row) => (row.ownerScope ?? "individual") === scope);
    }

    if (ownerUid) {
      traps = traps.filter((row) => row.ownerUid === ownerUid);
      captures = captures.filter((row) => row.ownerUid === ownerUid);
    }

    if (capturedUserId) {
      traps = traps.filter((row) => row.capturedUserId === capturedUserId);
      captures = captures.filter((row) => row.capturedUserId === capturedUserId);
    }

    if (trapStatus) {
      traps = traps.filter((row) => row.status === trapStatus);
    }

    if (captureTypeFilter) {
      captures = captures.filter((row) => row.captureType === captureTypeFilter);
    }

    traps = traps
      .sort((a, b) => (b.createdAtEpochMs ?? 0) - (a.createdAtEpochMs ?? 0))
      .slice(0, limit);

    captures = captures
      .sort((a, b) => (b.capturedAtEpochMs ?? 0) - (a.capturedAtEpochMs ?? 0))
      .slice(0, limit);

    return {
      ok: true,
      scope,
      traps,
      captures,
      trapsSummary: summarizeTraps(traps),
      capturesSummary: summarizeCaptures(captures),
    };
  } catch (error) {
    logger.error("adminSearchTrapRecords crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const adminGetUserTrapStatistics = onCall(async (request) => {
  try {
    requireAdmin(request);
    const db = getDb();
    const trapScoreMap = await loadTrapScoreMap();

    const data = (request.data ?? {}) as Record<string, unknown>;
    const uid = asString(data.uid).trim();

    if (!uid) {
      throw new HttpsError("invalid-argument", "uid is required.");
    }

    const [trapsSnap, capturesAsOwnerSnap, capturesAsVictimSnap] = await Promise.all([
      db.collection("traps").where("ownerUid", "==", uid).get(),
      db.collection("captures").where("ownerUid", "==", uid).get(),
      db.collection("captures").where("capturedUserId", "==", uid).get(),
    ]);

    const placedTraps = trapsSnap.docs.map((doc) =>
      normalizeTrapDoc(doc.id, doc.data() as Record<string, unknown>)
    );

    const capturesAsOwner = capturesAsOwnerSnap.docs.map((doc) =>
      normalizeCaptureDoc(doc.id, doc.data() as Record<string, unknown>, trapScoreMap)
    );

    const capturesAsVictim = capturesAsVictimSnap.docs.map((doc) =>
      normalizeCaptureDoc(doc.id, doc.data() as Record<string, unknown>, trapScoreMap)
    );

    return {
      ok: true,
      uid,
      placedTrapsSummary: summarizeTraps(placedTraps),
      capturesAsOwnerSummary: summarizeCaptures(capturesAsOwner),
      capturesAsVictimSummary: summarizeCaptures(capturesAsVictim),
      recentPlacedTraps: placedTraps
        .sort((a, b) => (b.createdAtEpochMs ?? 0) - (a.createdAtEpochMs ?? 0))
        .slice(0, 50),
      recentCapturesAsOwner: capturesAsOwner
        .sort((a, b) => (b.capturedAtEpochMs ?? 0) - (a.capturedAtEpochMs ?? 0))
        .slice(0, 50),
      recentCapturesAsVictim: capturesAsVictim
        .sort((a, b) => (b.capturedAtEpochMs ?? 0) - (a.capturedAtEpochMs ?? 0))
        .slice(0, 50),
    };
  } catch (error) {
    logger.error("adminGetUserTrapStatistics crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});