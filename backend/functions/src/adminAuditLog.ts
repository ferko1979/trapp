import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuditCategory =
  | "auth"
  | "game_settings"
  | "general_settings"
  | "levels"
  | "trap_definitions"
  | "traps"
  | "users"
  | "terms"
  | "awards"
  | "content"
  | "support"
  | "messaging"
  | "other";

const COLLECTION = "admin_audit_log";

// ─── Write helper ─────────────────────────────────────────────────────────────
// Fire-and-forget: callers should NOT await this or let it block the response.

export async function writeAuditLog(params: {
  adminUid: string;
  adminEmail?: string | null;
  adminName?: string | null;
  category: AuditCategory;
  action: string;
  targetId?: string | null;
  targetName?: string | null;
  summary: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = getDb();
    await db.collection(COLLECTION).add({
      timestamp: FieldValue.serverTimestamp(),
      adminUid: params.adminUid,
      adminEmail: params.adminEmail ?? null,
      adminName: params.adminName ?? null,
      category: params.category,
      action: params.action,
      targetId: params.targetId ?? null,
      targetName: params.targetName ?? null,
      summary: params.summary,
      details: params.details ?? {},
    });
  } catch (e) {
    // Never block the caller — just log the failure
    logger.error("writeAuditLog failed", e);
  }
}

// ─── adminGetAuditLog ─────────────────────────────────────────────────────────

export const adminGetAuditLog = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const limitN =
    typeof data.limit === "number" ? Math.min(Math.max(data.limit, 1), 200) : 100;
  const category = typeof data.category === "string" ? data.category.trim() : "";
  const adminUidFilter =
    typeof data.adminUid === "string" ? data.adminUid.trim() : "";
  const afterMs = typeof data.afterMs === "number" ? data.afterMs : null;
  const beforeMs = typeof data.beforeMs === "number" ? data.beforeMs : null;

  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = db.collection(COLLECTION).orderBy("timestamp", "desc");

  if (category) query = query.where("category", "==", category);
  if (adminUidFilter) query = query.where("adminUid", "==", adminUidFilter);
  if (afterMs)
    query = query.where("timestamp", ">=", Timestamp.fromMillis(afterMs));
  if (beforeMs)
    query = query.where("timestamp", "<=", Timestamp.fromMillis(beforeMs));

  query = query.limit(limitN);

  const snap = await query.get();

  const items = snap.docs.map((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
    const d = doc.data();
    return {
      id: doc.id,
      timestampMs:
        d.timestamp instanceof Timestamp ? d.timestamp.toMillis() : null,
      adminUid: d.adminUid ?? null,
      adminEmail: d.adminEmail ?? null,
      adminName: d.adminName ?? null,
      category: d.category ?? "other",
      action: d.action ?? "",
      targetId: d.targetId ?? null,
      targetName: d.targetName ?? null,
      summary: d.summary ?? "",
      details: d.details ?? {},
    };
  });

  return { ok: true, items, count: items.length };
});

// ─── adminGetMyAdminProfile ───────────────────────────────────────────────────

export const adminGetMyAdminProfile = onCall(async (request) => {
  const uid = requireAdmin(request);
  const db = getDb();
  const snap = await db.collection("users").doc(uid).get();
  const d = snap.data() ?? {};

  // Also fetch last 10 own actions from audit log
  const logSnap = await db
    .collection(COLLECTION)
    .where("adminUid", "==", uid)
    .orderBy("timestamp", "desc")
    .limit(10)
    .get();

  const recentActions = logSnap.docs.map((doc) => {
    const a = doc.data();
    return {
      id: doc.id,
      timestampMs:
        a.timestamp instanceof Timestamp ? a.timestamp.toMillis() : null,
      category: a.category ?? "other",
      action: a.action ?? "",
      summary: a.summary ?? "",
    };
  });

  return {
    ok: true,
    uid,
    email: d.email ?? null,
    displayName: d.displayName ?? null,
    username: d.username ?? null,
    firstName: d.firstName ?? null,
    lastName: d.lastName ?? null,
    role: d.role ?? null,
    createdAtMs:
      d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : null,
    lastSeenAtMs:
      d.lastSeenAt instanceof Timestamp ? d.lastSeenAt.toMillis() : null,
    recentActions,
  };
});

// ─── adminUpdateMyAdminProfile ────────────────────────────────────────────────

export const adminUpdateMyAdminProfile = onCall(async (request) => {
  const uid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const update: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  const changes: string[] = [];

  if (typeof data.displayName === "string") {
    update.displayName = data.displayName.trim();
    changes.push(`displayName → "${update.displayName}"`);
  }
  if (typeof data.firstName === "string") {
    update.firstName = data.firstName.trim();
    changes.push(`firstName → "${update.firstName}"`);
  }
  if (typeof data.lastName === "string") {
    update.lastName = data.lastName.trim();
    changes.push(`lastName → "${update.lastName}"`);
  }

  if (changes.length === 0) {
    throw new HttpsError("invalid-argument", "No fields to update.");
  }

  const db = getDb();

  // Fetch current email for audit log
  let adminEmail: string | null = null;
  try {
    const authUser = await getAuth().getUser(uid);
    adminEmail = authUser.email ?? null;
  } catch (_) {
    // non-fatal
  }

  await db.collection("users").doc(uid).set(update, { merge: true });

  void writeAuditLog({
    adminUid: uid,
    adminEmail,
    category: "auth",
    action: "UPDATE_ADMIN_PROFILE",
    summary: `Admin updated own profile: ${changes.join(", ")}`,
    details: { changes },
  });

  return { ok: true };
});
