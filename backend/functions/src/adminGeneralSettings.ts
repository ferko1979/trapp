import { FieldValue } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";

const DOC_PATH = ["general_settings", "global"] as const;

function getNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export const adminGetGeneralSettings = onCall(async (request) => {
  requireAdmin(request);

  const snap = await getDb().collection(DOC_PATH[0]).doc(DOC_PATH[1]).get();
  const data = snap.data() ?? {};

  return {
    ok: true,
    settings: {
      defaultBagWeightCapacity: getNumber(
        data.defaultBagWeightCapacity,
        5
      ),
      defaultRefillHours: getNumber(
        data.defaultRefillHours,
        24
      ),
    },
  };
});

export const adminUpdateGeneralSettings = onCall(async (request) => {
  requireAdmin(request);

  const payload = (request.data ?? {}) as Record<string, unknown>;

  await getDb()
    .collection(DOC_PATH[0])
    .doc(DOC_PATH[1])
    .set(
      {
        defaultBagWeightCapacity: getNumber(
          payload.defaultBagWeightCapacity,
          5
        ),
        defaultRefillHours: getNumber(
          payload.defaultRefillHours,
          24
        ),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return { ok: true };
});