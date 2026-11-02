import { HttpsError, onCall } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";

type CaptureType = "enemy" | "self" | "ally";

type TrapDefinitionRecord = {
  id: string;
  name?: string | null;
  scoreValue?: number | null;
  weight?: number | null;
};

type RankedUserRow = {
  uid: string;
  username: string | null;
  displayName: string | null;
  email: string | null;
  role: string | null;
  status: string | null;
  levelId: string | null;

  placedTrapCount: number;
  activeTrapCount: number;
  capturedTrapCount: number;
  disarmedTrapCount: number;

  captureCount: number;
  capturePoints: number;

  enemyCaptures: number;
  selfCaptures: number;
  allyCaptures: number;

  timesCaughtTotal: number;
  timesCaughtByEnemy: number;
  timesCaughtBySelf: number;
  timesCaughtByAlly: number;

  averagePointsPerCapture: number;
  combinedScore: number;

  rankByPlaced: number | null;
  rankByCaptureCount: number | null;
  rankByCapturePoints: number | null;
  rankByCombinedScore: number | null;
};

type SortBy =
  | "placed"
  | "captures"
  | "points"
  | "combined";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
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

function normalizeSortBy(value: unknown): SortBy {
  const v = asString(value).trim().toLowerCase();
  if (v === "placed") return "placed";
  if (v === "captures") return "captures";
  if (v === "points") return "points";
  if (v === "combined") return "combined";
  return "points";
}

function normalizeCaptureType(value: unknown): CaptureType {
  const v = asString(value).trim().toLowerCase();
  if (v === "self") return "self";
  if (v === "ally") return "ally";
  return "enemy";
}

function safeDivide(a: number, b: number): number {
  if (!b) return 0;
  return a / b;
}

function compareStringsNullable(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "");
}

function sortRows(rows: RankedUserRow[], sortBy: SortBy): RankedUserRow[] {
  const sorted = [...rows];

  sorted.sort((a, b) => {
    switch (sortBy) {
      case "placed":
        if (b.placedTrapCount !== a.placedTrapCount) {
          return b.placedTrapCount - a.placedTrapCount;
        }
        if (b.capturePoints !== a.capturePoints) {
          return b.capturePoints - a.capturePoints;
        }
        return compareStringsNullable(a.displayName, b.displayName);

      case "captures":
        if (b.captureCount !== a.captureCount) {
          return b.captureCount - a.captureCount;
        }
        if (b.capturePoints !== a.capturePoints) {
          return b.capturePoints - a.capturePoints;
        }
        return compareStringsNullable(a.displayName, b.displayName);

      case "combined":
        if (b.combinedScore !== a.combinedScore) {
          return b.combinedScore - a.combinedScore;
        }
        if (b.capturePoints !== a.capturePoints) {
          return b.capturePoints - a.capturePoints;
        }
        return compareStringsNullable(a.displayName, b.displayName);

      case "points":
      default:
        if (b.capturePoints !== a.capturePoints) {
          return b.capturePoints - a.capturePoints;
        }
        if (b.captureCount !== a.captureCount) {
          return b.captureCount - a.captureCount;
        }
        return compareStringsNullable(a.displayName, b.displayName);
    }
  });

  return sorted;
}

function assignRanks(
  rows: RankedUserRow[],
  field:
    | "placedTrapCount"
    | "captureCount"
    | "capturePoints"
    | "combinedScore",
  rankField:
    | "rankByPlaced"
    | "rankByCaptureCount"
    | "rankByCapturePoints"
    | "rankByCombinedScore"
) {
  const sorted = [...rows].sort((a, b) => {
    if (b[field] !== a[field]) return b[field] - a[field];
    return compareStringsNullable(a.displayName, b.displayName);
  });

  sorted.forEach((row, index) => {
    row[rankField] = index + 1;
  });
}

async function loadTrapDefinitionScoreMap(): Promise<Map<string, number>> {
  const db = getDb();
  const snap = await db.collection("trap_definitions").get();
  const map = new Map<string, number>();

  snap.docs.forEach((doc) => {
    const data = doc.data() as TrapDefinitionRecord;
    const scoreValue = asNumber(data.scoreValue, NaN);
    const weight = asNumber(data.weight, NaN);

    if (Number.isFinite(scoreValue)) {
      map.set(doc.id, scoreValue);
    } else if (Number.isFinite(weight)) {
      map.set(doc.id, weight);
    } else {
      map.set(doc.id, 1);
    }
  });

  return map;
}

function getCaptureScoreValue(
  captureData: Record<string, unknown>,
  trapScoreMap: Map<string, number>
): number {
  const explicitScore = asNumber(captureData.scoreValue, NaN);
  if (Number.isFinite(explicitScore)) return explicitScore;

  const trapTypeId = asString(captureData.trapTypeId);
  if (trapTypeId && trapScoreMap.has(trapTypeId)) {
    return trapScoreMap.get(trapTypeId) ?? 1;
  }

  return 1;
}

export const adminGetTrapResultsLeaderboard = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const sortBy = normalizeSortBy(data.sortBy);
  const limitRaw = asNumber(data.limit, 100);
  const limit = Math.min(Math.max(1, Math.floor(limitRaw)), 1000);
  const includeInactive = asBoolean(data.includeInactive, true);

  const db = getDb();
  const trapScoreMap = await loadTrapDefinitionScoreMap();

  const [usersSnap, trapsSnap, capturesSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("traps").get(),
    db.collection("captures").get(),
  ]);

  const rowsByUid = new Map<string, RankedUserRow>();

  usersSnap.docs.forEach((doc) => {
    const user = doc.data() as Record<string, unknown>;
    const uid = doc.id;
    const row: RankedUserRow = {
      uid,
      username: asNullableString(user.username),
      displayName: asNullableString(user.displayName),
      email: asNullableString(user.email),
      role: asNullableString(user.role),
      status: asNullableString(user.status),
      levelId: asNullableString(user.levelId),

      placedTrapCount: 0,
      activeTrapCount: 0,
      capturedTrapCount: 0,
      disarmedTrapCount: 0,

      captureCount: 0,
      capturePoints: 0,

      enemyCaptures: 0,
      selfCaptures: 0,
      allyCaptures: 0,

      timesCaughtTotal: 0,
      timesCaughtByEnemy: 0,
      timesCaughtBySelf: 0,
      timesCaughtByAlly: 0,

      averagePointsPerCapture: 0,
      combinedScore: 0,

      rankByPlaced: null,
      rankByCaptureCount: null,
      rankByCapturePoints: null,
      rankByCombinedScore: null,
    };

    rowsByUid.set(uid, row);
  });

  trapsSnap.docs.forEach((doc) => {
    const trap = doc.data() as Record<string, unknown>;
    const ownerUid = asString(trap.ownerUid);
    if (!ownerUid) return;

    if (!rowsByUid.has(ownerUid)) {
      rowsByUid.set(ownerUid, {
        uid: ownerUid,
        username: null,
        displayName: null,
        email: null,
        role: null,
        status: null,
        levelId: null,

        placedTrapCount: 0,
        activeTrapCount: 0,
        capturedTrapCount: 0,
        disarmedTrapCount: 0,

        captureCount: 0,
        capturePoints: 0,

        enemyCaptures: 0,
        selfCaptures: 0,
        allyCaptures: 0,

        timesCaughtTotal: 0,
        timesCaughtByEnemy: 0,
        timesCaughtBySelf: 0,
        timesCaughtByAlly: 0,

        averagePointsPerCapture: 0,
        combinedScore: 0,

        rankByPlaced: null,
        rankByCaptureCount: null,
        rankByCapturePoints: null,
        rankByCombinedScore: null,
      });
    }

    const row = rowsByUid.get(ownerUid)!;
    row.placedTrapCount += 1;

    const status = asString(trap.status);
    if (status === "active") row.activeTrapCount += 1;
    else if (status === "captured") row.capturedTrapCount += 1;
    else if (status === "disarmed") row.disarmedTrapCount += 1;
  });

  capturesSnap.docs.forEach((doc) => {
    const capture = doc.data() as Record<string, unknown>;
    const ownerUid = asString(capture.ownerUid);
    const capturedUserId = asString(capture.capturedUserId);
    const captureType = normalizeCaptureType(capture.captureType);
    const scoringCapture =
      "scoringCapture" in capture
        ? asBoolean(capture.scoringCapture)
        : captureType === "enemy";

    const scoreValue = getCaptureScoreValue(capture, trapScoreMap);

    if (ownerUid) {
      if (!rowsByUid.has(ownerUid)) {
        rowsByUid.set(ownerUid, {
          uid: ownerUid,
          username: null,
          displayName: null,
          email: null,
          role: null,
          status: null,
          levelId: null,

          placedTrapCount: 0,
          activeTrapCount: 0,
          capturedTrapCount: 0,
          disarmedTrapCount: 0,

          captureCount: 0,
          capturePoints: 0,

          enemyCaptures: 0,
          selfCaptures: 0,
          allyCaptures: 0,

          timesCaughtTotal: 0,
          timesCaughtByEnemy: 0,
          timesCaughtBySelf: 0,
          timesCaughtByAlly: 0,

          averagePointsPerCapture: 0,
          combinedScore: 0,

          rankByPlaced: null,
          rankByCaptureCount: null,
          rankByCapturePoints: null,
          rankByCombinedScore: null,
        });
      }

      const ownerRow = rowsByUid.get(ownerUid)!;

      if (captureType === "enemy") ownerRow.enemyCaptures += 1;
      else if (captureType === "self") ownerRow.selfCaptures += 1;
      else if (captureType === "ally") ownerRow.allyCaptures += 1;

      if (scoringCapture) {
        ownerRow.captureCount += 1;
        ownerRow.capturePoints += scoreValue;
      }
    }

    if (capturedUserId) {
      if (!rowsByUid.has(capturedUserId)) {
        rowsByUid.set(capturedUserId, {
          uid: capturedUserId,
          username: null,
          displayName: null,
          email: null,
          role: null,
          status: null,
          levelId: null,

          placedTrapCount: 0,
          activeTrapCount: 0,
          capturedTrapCount: 0,
          disarmedTrapCount: 0,

          captureCount: 0,
          capturePoints: 0,

          enemyCaptures: 0,
          selfCaptures: 0,
          allyCaptures: 0,

          timesCaughtTotal: 0,
          timesCaughtByEnemy: 0,
          timesCaughtBySelf: 0,
          timesCaughtByAlly: 0,

          averagePointsPerCapture: 0,
          combinedScore: 0,

          rankByPlaced: null,
          rankByCaptureCount: null,
          rankByCapturePoints: null,
          rankByCombinedScore: null,
        });
      }

      const victimRow = rowsByUid.get(capturedUserId)!;
      victimRow.timesCaughtTotal += 1;

      if (captureType === "enemy") victimRow.timesCaughtByEnemy += 1;
      else if (captureType === "self") victimRow.timesCaughtBySelf += 1;
      else if (captureType === "ally") victimRow.timesCaughtByAlly += 1;
    }
  });

  let rows = Array.from(rowsByUid.values()).map((row) => {
    row.averagePointsPerCapture = Number(
      safeDivide(row.capturePoints, row.captureCount).toFixed(2)
    );
    row.combinedScore = row.capturePoints + row.placedTrapCount;
    return row;
  });

  if (!includeInactive) {
    rows = rows.filter((row) => row.status !== "inactive");
  }

  assignRanks(rows, "placedTrapCount", "rankByPlaced");
  assignRanks(rows, "captureCount", "rankByCaptureCount");
  assignRanks(rows, "capturePoints", "rankByCapturePoints");
  assignRanks(rows, "combinedScore", "rankByCombinedScore");

  const rankedRows = sortRows(rows, sortBy).slice(0, limit);

  return {
    ok: true,
    sortBy,
    totalUsers: rows.length,
    generatedAtEpochMs: Date.now(),
    items: rankedRows,
  };
});

export const getPublicTrapResultsLeaderboard = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const sortBy = normalizeSortBy(data.sortBy);
  const limitRaw = asNumber(data.limit, 100);
  const limit = Math.min(Math.max(1, Math.floor(limitRaw)), 200);

  const db = getDb();
  const trapScoreMap = await loadTrapDefinitionScoreMap();

  const [usersSnap, trapsSnap, capturesSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("traps").get(),
    db.collection("captures").get(),
  ]);

  const rowsByUid = new Map<string, RankedUserRow>();

  usersSnap.docs.forEach((doc) => {
    const user = doc.data() as Record<string, unknown>;
    const uid = doc.id;

    rowsByUid.set(uid, {
      uid,
      username: asNullableString(user.username),
      displayName: asNullableString(user.displayName),
      email: null,
      role: null,
      status: asNullableString(user.status),
      levelId: null,

      placedTrapCount: 0,
      activeTrapCount: 0,
      capturedTrapCount: 0,
      disarmedTrapCount: 0,

      captureCount: 0,
      capturePoints: 0,

      enemyCaptures: 0,
      selfCaptures: 0,
      allyCaptures: 0,

      timesCaughtTotal: 0,
      timesCaughtByEnemy: 0,
      timesCaughtBySelf: 0,
      timesCaughtByAlly: 0,

      averagePointsPerCapture: 0,
      combinedScore: 0,

      rankByPlaced: null,
      rankByCaptureCount: null,
      rankByCapturePoints: null,
      rankByCombinedScore: null,
    });
  });

  trapsSnap.docs.forEach((doc) => {
    const trap = doc.data() as Record<string, unknown>;
    const ownerUid = asString(trap.ownerUid);
    if (!ownerUid || !rowsByUid.has(ownerUid)) return;

    const row = rowsByUid.get(ownerUid)!;
    row.placedTrapCount += 1;

    const status = asString(trap.status);
    if (status === "active") row.activeTrapCount += 1;
    else if (status === "captured") row.capturedTrapCount += 1;
    else if (status === "disarmed") row.disarmedTrapCount += 1;
  });

  capturesSnap.docs.forEach((doc) => {
    const capture = doc.data() as Record<string, unknown>;
    const ownerUid = asString(capture.ownerUid);
    if (!ownerUid || !rowsByUid.has(ownerUid)) return;

    const captureType = normalizeCaptureType(capture.captureType);
    const scoringCapture =
      "scoringCapture" in capture
        ? asBoolean(capture.scoringCapture)
        : captureType === "enemy";

    const scoreValue = getCaptureScoreValue(capture, trapScoreMap);
    const row = rowsByUid.get(ownerUid)!;

    if (captureType === "enemy") row.enemyCaptures += 1;
    else if (captureType === "self") row.selfCaptures += 1;
    else if (captureType === "ally") row.allyCaptures += 1;

    if (scoringCapture) {
      row.captureCount += 1;
      row.capturePoints += scoreValue;
    }
  });

  let rows = Array.from(rowsByUid.values())
    .filter((row) => row.status !== "inactive")
    .map((row) => {
      row.averagePointsPerCapture = Number(
        safeDivide(row.capturePoints, row.captureCount).toFixed(2)
      );
      row.combinedScore = row.capturePoints + row.placedTrapCount;
      return row;
    });

  assignRanks(rows, "placedTrapCount", "rankByPlaced");
  assignRanks(rows, "captureCount", "rankByCaptureCount");
  assignRanks(rows, "capturePoints", "rankByCapturePoints");
  assignRanks(rows, "combinedScore", "rankByCombinedScore");

  const rankedRows = sortRows(rows, sortBy)
    .slice(0, limit)
    .map((row) => ({
      uid: row.uid,
      username: row.username,
      displayName: row.displayName,
      placedTrapCount: row.placedTrapCount,
      captureCount: row.captureCount,
      capturePoints: row.capturePoints,
      averagePointsPerCapture: row.averagePointsPerCapture,
      rankByPlaced: row.rankByPlaced,
      rankByCaptureCount: row.rankByCaptureCount,
      rankByCapturePoints: row.rankByCapturePoints,
      rankByCombinedScore: row.rankByCombinedScore,
    }));

  return {
    ok: true,
    sortBy,
    totalUsers: rows.length,
    generatedAtEpochMs: Date.now(),
    items: rankedRows,
  };
});