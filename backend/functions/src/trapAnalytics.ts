import { Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { requireUser as requireAuthUid } from "./shared/appCheck";

type TrapScope = "mine" | "allies" | "individual" | "all";
type CaptureType = "enemy" | "self" | "ally";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

async function getPrimaryAllyGroupId(uid: string): Promise<string | null> {
  const db = getDb();
  const snap = await db.collection("users").doc(uid).get();
  const data = snap.data() ?? {};
  const groupId = asString(data.primaryAllyGroupId);
  return groupId || null;
}

function deriveCaptureType(data: Record<string, unknown>): CaptureType {
  const explicit = asString(data.captureType);
  if (explicit === "enemy" || explicit === "self" || explicit === "ally") {
    return explicit;
  }

  const ownerUid = asString(data.ownerUid);
  const capturedUserId = asString(data.capturedUserId);

  if (ownerUid && capturedUserId && ownerUid === capturedUserId) {
    return "self";
  }

  const ownerGroupId = asString(data.ownerPrimaryAllyGroupId);
  const capturedGroupId = asString(data.capturedPrimaryAllyGroupId);

  if (ownerGroupId && capturedGroupId && ownerGroupId === capturedGroupId) {
    return "ally";
  }

  return "enemy";
}

function normalizeTrapScope(value: unknown, fallback: TrapScope = "mine"): TrapScope {
  const v = asString(value);
  if (v === "mine" || v === "allies" || v === "individual" || v === "all") return v;
  return fallback;
}

function summarizeCountsBy<T extends string>(items: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of items) {
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

async function loadTrapsForScope(params: {
  viewerUid: string;
  scope: TrapScope;
  ownerUid?: string;
  status?: string;
  limit?: number;
}) {
  const db = getDb();
  const { viewerUid, scope, ownerUid, status, limit = 1000 } = params;
  const viewerGroupId = await getPrimaryAllyGroupId(viewerUid);

  const snap = await db.collection("traps").limit(Math.min(limit, 2000)).get();

  return snap.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        ownerUid: asString(data.ownerUid),
        ownerPrimaryAllyGroupId: asString(data.ownerPrimaryAllyGroupId),
        ownerScope: asString(data.ownerScope),
        trapTypeId: asString(data.trapTypeId),
        iconKey: asString(data.iconKey),
        status: asString(data.status),
        lat: asNumber(data.lat),
        lng: asNumber(data.lng),
        dateKey: asString(data.dateKey),
        createdAtEpochMs: getTimestampMillis(data.createdAt),
        capturedAtEpochMs: getTimestampMillis(data.capturedAt),
        disarmedAtEpochMs: getTimestampMillis(data.disarmedAt),
        capturedUserId: asString(data.capturedUserId),
        capturedUsername: asString(data.capturedUsername),
        captureDistanceMeters: asNumber(data.captureDistanceMeters, 0),
        disarmedBy: asString(data.disarmedBy),
        effectKind: asString(data.effectKind),
        effectValue: asNumber(data.effectValue),
        generatedBy: asString(data.generatedBy),
        generatorLocation: asString(data.generatorLocation),
      };
    })
    .filter((item) => {
      if (ownerUid && item.ownerUid !== ownerUid) return false;
      if (status && item.status !== status) return false;

      switch (scope) {
        case "mine":
          return item.ownerUid === viewerUid;
        case "allies":
          return !!viewerGroupId && item.ownerPrimaryAllyGroupId === viewerGroupId;
        case "individual":
          return !item.ownerPrimaryAllyGroupId;
        case "all":
          return true;
        default:
          return false;
      }
    });
}

async function loadCapturesForScope(params: {
  viewerUid: string;
  scope: TrapScope;
  ownerUid?: string;
  capturedUserId?: string;
  type?: CaptureType | "";
  limit?: number;
}) {
  const db = getDb();
  const { viewerUid, scope, ownerUid, capturedUserId, type, limit = 1000 } = params;
  const viewerGroupId = await getPrimaryAllyGroupId(viewerUid);

  const snap = await db.collection("captures").limit(Math.min(limit, 2000)).get();

  return snap.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const captureType = deriveCaptureType(data);

      return {
        id: doc.id,
        trapId: asString(data.trapId),
        ownerUid: asString(data.ownerUid),
        ownerUsername: asString(data.ownerUsername),
        ownerPrimaryAllyGroupId: asString(data.ownerPrimaryAllyGroupId),
        ownerScope: asString(data.ownerScope),
        capturedUserId: asString(data.capturedUserId),
        capturedUsername: asString(data.capturedUsername),
        capturedPrimaryAllyGroupId: asString(data.capturedPrimaryAllyGroupId),
        trapTypeId: asString(data.trapTypeId),
        iconKey: asString(data.iconKey),
        effectKind: asString(data.effectKind),
        effectValue: asNumber(data.effectValue),
        captureDistanceMeters: asNumber(data.captureDistanceMeters, 0),
        dateKey: asString(data.dateKey),
        capturedAtEpochMs: getTimestampMillis(data.capturedAt),
        captureType,
        scoringCapture:
          "scoringCapture" in data
            ? asBoolean(data.scoringCapture)
            : captureType === "enemy",
        isSelfTrigger:
          "isSelfTrigger" in data
            ? asBoolean(data.isSelfTrigger)
            : captureType === "self",
        isAllyTrigger:
          "isAllyTrigger" in data
            ? asBoolean(data.isAllyTrigger)
            : captureType === "ally",
      };
    })
    .filter((item) => {
      if (ownerUid && item.ownerUid !== ownerUid) return false;
      if (capturedUserId && item.capturedUserId !== capturedUserId) return false;
      if (type && item.captureType !== type) return false;

      switch (scope) {
        case "mine":
          return item.ownerUid === viewerUid || item.capturedUserId === viewerUid;
        case "allies":
          return !!viewerGroupId && item.ownerPrimaryAllyGroupId === viewerGroupId;
        case "individual":
          return !item.ownerPrimaryAllyGroupId;
        case "all":
          return true;
        default:
          return false;
      }
    });
}

function buildTrapSummary(traps: Array<Record<string, unknown>>) {
  const byStatus = summarizeCountsBy(traps.map((x) => asString(x.status, "unknown")));
  const byType = summarizeCountsBy(traps.map((x) => asString(x.trapTypeId, "unknown")));

  return {
    total: traps.length,
    active: byStatus.active ?? 0,
    captured: byStatus.captured ?? 0,
    disarmed: byStatus.disarmed ?? 0,
    otherStatuses: Object.fromEntries(
      Object.entries(byStatus).filter(([k]) => !["active", "captured", "disarmed"].includes(k))
    ),
    byType,
  };
}

function buildSourceSummary(traps: Array<Record<string, unknown>>) {
  const system = traps.filter((t) => asString(t.generatedBy) === "admin");
  const user   = traps.filter((t) => asString(t.generatedBy) !== "admin");

  const summarize = (subset: Array<Record<string, unknown>>) => {
    const byStatus = summarizeCountsBy(subset.map((x) => asString(x.status, "unknown")));
    const byType   = summarizeCountsBy(subset.map((x) => asString(x.trapTypeId, "unknown")));
    const byLocation: Record<string, number> = {};
    for (const t of subset) {
      const loc = asString(t.generatorLocation);
      if (loc) byLocation[loc] = (byLocation[loc] ?? 0) + 1;
    }
    return {
      total:    subset.length,
      active:   byStatus.active   ?? 0,
      captured: byStatus.captured ?? 0,
      disarmed: byStatus.disarmed ?? 0,
      byType,
      byLocation,
    };
  };

  return { system: summarize(system), user: summarize(user) };
}

function buildCaptureSummary(captures: Array<Record<string, unknown>>) {
  const byType = summarizeCountsBy(captures.map((x) => asString(x.captureType, "enemy")));
  const byTrapType = summarizeCountsBy(captures.map((x) => asString(x.trapTypeId, "unknown")));
  const scoringCaptures = captures.filter((x) => asBoolean(x.scoringCapture, false)).length;

  return {
    total: captures.length,
    scoringCaptures,
    enemy: byType.enemy ?? 0,
    self: byType.self ?? 0,
    ally: byType.ally ?? 0,
    byTrapType,
  };
}

export const getMyTrapStatisticsBundle = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const scope = normalizeTrapScope(data.scope, "mine");
  const limit = Math.min(asNumber(data.limit, 250), 1000);

  const traps = await loadTrapsForScope({
    viewerUid: uid,
    scope,
    ownerUid: scope === "mine" ? uid : undefined,
    limit,
  });

  const captures = await loadCapturesForScope({
    viewerUid: uid,
    scope,
    limit,
  });

  return {
    ok: true,
    scope,
    trapsSummary: buildTrapSummary(traps),
    capturesSummary: buildCaptureSummary(captures),
    recentTraps: traps
      .sort((a, b) => asNumber(b.createdAtEpochMs) - asNumber(a.createdAtEpochMs))
      .slice(0, 50),
    recentCaptures: captures
      .sort((a, b) => asNumber(b.capturedAtEpochMs) - asNumber(a.capturedAtEpochMs))
      .slice(0, 50),
  };
});

export const getMyPlacedTrapsDetailed = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const scope = normalizeTrapScope(data.scope, "mine");
  const status = asString(data.status);
  const limit = Math.min(asNumber(data.limit, 250), 1000);

  const traps = await loadTrapsForScope({
    viewerUid: uid,
    scope,
    status: status || undefined,
    limit,
  });

  return {
    ok: true,
    scope,
    items: traps.sort((a, b) => asNumber(b.createdAtEpochMs) - asNumber(a.createdAtEpochMs)),
    summary: buildTrapSummary(traps),
  };
});

export const getMyCaptureHistoryDetailed = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const scope = normalizeTrapScope(data.scope, "mine");
  const type = asString(data.captureType) as CaptureType | "";
  const limit = Math.min(asNumber(data.limit, 250), 1000);

  const captures = await loadCapturesForScope({
    viewerUid: uid,
    scope,
    type: type || "",
    limit,
  });

  return {
    ok: true,
    scope,
    items: captures.sort((a, b) => asNumber(b.capturedAtEpochMs) - asNumber(a.capturedAtEpochMs)),
    summary: buildCaptureSummary(captures),
  };
});

export const adminGetTrapStatisticsOverview = onCall(async (request) => {
  requireAdmin(request);

  const traps = await loadTrapsForScope({
    viewerUid: request.auth?.uid ?? "",
    scope: "all",
    limit: 2000,
  });

  const captures = await loadCapturesForScope({
    viewerUid: request.auth?.uid ?? "",
    scope: "all",
    limit: 2000,
  });

  return {
    ok: true,
    trapsSummary: buildTrapSummary(traps),
    sourceSummary: buildSourceSummary(traps),
    capturesSummary: buildCaptureSummary(captures),
    recentTraps: traps
      .sort((a, b) => asNumber(b.createdAtEpochMs) - asNumber(a.createdAtEpochMs))
      .slice(0, 100),
    recentCaptures: captures
      .sort((a, b) => asNumber(b.capturedAtEpochMs) - asNumber(a.capturedAtEpochMs))
      .slice(0, 100),
  };
});

export const adminSearchTrapRecords = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const scope = normalizeTrapScope(data.scope, "all");
  const ownerUid = asString(data.ownerUid);
  const capturedUserId = asString(data.capturedUserId);
  const trapStatus = asString(data.trapStatus);
  const captureType = asString(data.captureType) as CaptureType | "";
  const limit = Math.min(asNumber(data.limit, 500), 2000);

  const traps = await loadTrapsForScope({
    viewerUid: request.auth?.uid ?? "",
    scope,
    ownerUid: ownerUid || undefined,
    status: trapStatus || undefined,
    limit,
  });

  const captures = await loadCapturesForScope({
    viewerUid: request.auth?.uid ?? "",
    scope,
    ownerUid: ownerUid || undefined,
    capturedUserId: capturedUserId || undefined,
    type: captureType || "",
    limit,
  });

  return {
    ok: true,
    scope,
    traps,
    captures,
    trapsSummary: buildTrapSummary(traps),
    capturesSummary: buildCaptureSummary(captures),
  };
});

export const adminGetUserTrapStatistics = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = asString(data.uid);

  if (!uid) {
    throw new HttpsError("invalid-argument", "uid is required.");
  }

  const traps = await loadTrapsForScope({
    viewerUid: uid,
    scope: "mine",
    ownerUid: uid,
    limit: 2000,
  });

  const ownedCaptures = await loadCapturesForScope({
    viewerUid: uid,
    scope: "all",
    ownerUid: uid,
    limit: 2000,
  });

  const sufferedCaptures = await loadCapturesForScope({
    viewerUid: uid,
    scope: "all",
    capturedUserId: uid,
    limit: 2000,
  });

  return {
    ok: true,
    uid,
    placedTrapsSummary: buildTrapSummary(traps),
    capturesAsOwnerSummary: buildCaptureSummary(ownedCaptures),
    capturesAsVictimSummary: buildCaptureSummary(sufferedCaptures),
    recentPlacedTraps: traps
      .sort((a, b) => asNumber(b.createdAtEpochMs) - asNumber(a.createdAtEpochMs))
      .slice(0, 100),
    recentCapturesAsOwner: ownedCaptures
      .sort((a, b) => asNumber(b.capturedAtEpochMs) - asNumber(a.capturedAtEpochMs))
      .slice(0, 100),
    recentCapturesAsVictim: sufferedCaptures
      .sort((a, b) => asNumber(b.capturedAtEpochMs) - asNumber(a.capturedAtEpochMs))
      .slice(0, 100),
  };
});