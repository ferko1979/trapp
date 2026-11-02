import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireUser as requireAuthUid } from "./shared/appCheck";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
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

export const getMyTrapStats = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const db = getDb();

    const userSnap = await db.collection("users").doc(uid).get();
    const user = userSnap.data() ?? {};

    return {
      ok: true,
      stats: {
        captureCount:
          typeof user.captureCount === "number" ? user.captureCount : 0,
        timesCaught:
          typeof user.timesCaught === "number" ? user.timesCaught : 0,
        lastCapturedUserId: asString(user.lastCapturedUserId),
        lastCapturedUsername: asString(user.lastCapturedUsername),
        lastTrappedByUid: asString(user.lastTrappedByUid),
        lastTrappedByUsername: asString(user.lastTrappedByUsername),
        lastCapturedAtEpochMs: getTimestampMillis(user.lastCapturedAt),
        lastTrappedAtEpochMs: getTimestampMillis(user.lastTrappedAt),
      },
    };
  } catch (error) {
    logger.error("getMyTrapStats crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const listMyCaptures = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const db = getDb();

    const snap = await db
      .collection("captures")
      .where("ownerUid", "==", uid)
      .orderBy("capturedAt", "desc")
      .limit(100)
      .get();

    const items = snap.docs.map((doc) => {
      const row = doc.data();
      return {
        id: doc.id,
        trapId: asString(row.trapId),
        trapTypeId: asString(row.trapTypeId),
        iconKey: asString(row.iconKey),
        effectKind: asString(row.effectKind),
        effectValue:
          typeof row.effectValue === "number" ? row.effectValue : null,
        capturedUserId: asString(row.capturedUserId),
        capturedUsername: asString(row.capturedUsername),
        ownerUsername: asString(row.ownerUsername),
        captureDistanceMeters:
          typeof row.captureDistanceMeters === "number"
            ? row.captureDistanceMeters
            : null,
        lat: typeof row.lat === "number" ? row.lat : null,
        lng: typeof row.lng === "number" ? row.lng : null,
        dateKey: asString(row.dateKey),
        capturedAtEpochMs: getTimestampMillis(row.capturedAt),
      };
    });

    return { ok: true, items };
  } catch (error) {
    logger.error("listMyCaptures crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const listPlayersWhoCapturedMe = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const db = getDb();

    const snap = await db
      .collection("captures")
      .where("capturedUserId", "==", uid)
      .orderBy("capturedAt", "desc")
      .limit(100)
      .get();

    const items = snap.docs.map((doc) => {
      const row = doc.data();
      return {
        id: doc.id,
        trapId: asString(row.trapId),
        trapTypeId: asString(row.trapTypeId),
        iconKey: asString(row.iconKey),
        effectKind: asString(row.effectKind),
        effectValue:
          typeof row.effectValue === "number" ? row.effectValue : null,
        ownerUid: asString(row.ownerUid),
        ownerUsername: asString(row.ownerUsername),
        capturedUsername: asString(row.capturedUsername),
        captureDistanceMeters:
          typeof row.captureDistanceMeters === "number"
            ? row.captureDistanceMeters
            : null,
        lat: typeof row.lat === "number" ? row.lat : null,
        lng: typeof row.lng === "number" ? row.lng : null,
        dateKey: asString(row.dateKey),
        capturedAtEpochMs: getTimestampMillis(row.capturedAt),
      };
    });

    return { ok: true, items };
  } catch (error) {
    logger.error("listPlayersWhoCapturedMe crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const getTrapCaptureDetails = onCall(async (request) => {
  try {
    requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const captureId = asString(data.captureId).trim();

    if (!captureId) {
      throw new HttpsError("invalid-argument", "captureId is required.");
    }

    const db = getDb();
    const snap = await db.collection("captures").doc(captureId).get();
    const row = snap.data();

    if (!row) {
      throw new HttpsError("not-found", "Capture not found.");
    }

    return {
      ok: true,
      capture: {
        id: snap.id,
        trapId: asString(row.trapId),
        trapTypeId: asString(row.trapTypeId),
        iconKey: asString(row.iconKey),
        effectKind: asString(row.effectKind),
        effectValue:
          typeof row.effectValue === "number" ? row.effectValue : null,
        ownerUid: asString(row.ownerUid),
        ownerUsername: asString(row.ownerUsername),
        capturedUserId: asString(row.capturedUserId),
        capturedUsername: asString(row.capturedUsername),
        captureDistanceMeters:
          typeof row.captureDistanceMeters === "number"
            ? row.captureDistanceMeters
            : null,
        lat: typeof row.lat === "number" ? row.lat : null,
        lng: typeof row.lng === "number" ? row.lng : null,
        dateKey: asString(row.dateKey),
        capturedAtEpochMs: getTimestampMillis(row.capturedAt),
      },
    };
  } catch (error) {
    logger.error("getTrapCaptureDetails crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});