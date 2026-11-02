import { getAuth } from "firebase-admin/auth";
import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";

async function requireAdmin(request: CallableRequest<unknown>) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const isAdmin = request.auth?.token?.admin === true;
  if (!isAdmin) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }

  return uid;
}

export const setUserAdmin = onCall(async (request) => {
  await requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = typeof data.uid === "string" ? data.uid.trim() : "";
  const admin = data.admin === true;

  if (!uid) {
    throw new HttpsError("invalid-argument", "uid is required.");
  }

  const auth = getAuth();
  const user = await auth.getUser(uid);
  const existingClaims = user.customClaims ?? {};

  await auth.setCustomUserClaims(uid, {
    ...existingClaims,
    admin,
  });

  await getDb().collection("users").doc(uid).set(
    {
      role: admin ? "admin" : "user",
    },
    { merge: true }
  );

  return { ok: true, uid, admin };
});
