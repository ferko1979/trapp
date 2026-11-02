/**
 * userDataCleanup.ts
 *
 * Shared helpers for erasing a user's data (GDPR erasure / Google Play
 * account-deletion requirement). Used by:
 *   – deleteMyAccount        (self-service, from the app)
 *   – adminDeleteUser        (with { hard: true }, for e-mailed requests)
 *   – adminDeleteUserTraps   (batched trap delete)
 *
 * Policy:
 *   – Personal data and game data owned by the user is DELETED.
 *   – Records that must be kept for accounting (payments, donations,
 *     subscriptions, membership level changes) and records shared with other
 *     players (captures, other players' traps) are ANONYMISED: the uid is
 *     replaced by DELETED_USER_MARKER and name/e-mail fields are cleared.
 *
 * Every step is query-based and tolerant of missing documents, so a partially
 * failed run can simply be repeated.
 */

import {
  DocumentData,
  DocumentReference,
  FieldPath,
  FieldValue,
  Query,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { getAdminAuth, getDb } from "./firebase";
import { loadStripeSettings, makeStripe } from "../payments";

export const DELETED_USER_MARKER = "deleted-user";

const BATCH_SIZE = 400;

/** Personal fields cleared on retained (anonymised) accounting records. */
const PII_KEYS = new Set([
  "email",
  "customerEmail",
  "userEmail",
  "name",
  "displayName",
  "username",
  "userName",
  "usernameLower",
  "firstName",
  "lastName",
  "fullName",
  "customerName",
  "phone",
  "phoneNumber",
  "address",
  "billingAddress",
  "billingName",
  "photoUrl",
]);

export type UserPurgeSummary = Record<string, number>;

// ─── Generic batch helpers ────────────────────────────────────────────────────

/** Deletes the given document refs in batches of 400 (Firestore limit is 500). */
export async function deleteRefsInBatches(refs: DocumentReference[]): Promise<number> {
  const db = getDb();
  let deleted = 0;
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = refs.slice(i, i + BATCH_SIZE);
    for (const ref of chunk) batch.delete(ref);
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

/** Runs a query and deletes every matching document (no subcollections). */
export async function deleteQueryInBatches(query: Query): Promise<number> {
  const snap = await query.get();
  if (snap.empty) return 0;
  return deleteRefsInBatches(snap.docs.map((d) => d.ref));
}

async function updateInBatches(
  updates: Array<{ ref: DocumentReference; data: Record<string, unknown> }>
): Promise<number> {
  const db = getDb();
  let done = 0;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = updates.slice(i, i + BATCH_SIZE);
    for (const u of chunk) batch.set(u.ref, u.data, { merge: true });
    await batch.commit();
    done += chunk.length;
  }
  return done;
}

/** Collects the distinct docs of several queries (queries may overlap). */
async function collectDocs(queries: Query[]): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const snaps = await Promise.all(queries.map((q) => q.get()));
  const byPath = new Map<string, QueryDocumentSnapshot<DocumentData>>();
  for (const snap of snaps) {
    for (const doc of snap.docs) byPath.set(doc.ref.path, doc);
  }
  return [...byPath.values()];
}

/** Recursively deletes each document (with all subcollections). */
async function recursiveDeleteDocs(refs: DocumentReference[]): Promise<number> {
  const db = getDb();
  for (const ref of refs) {
    await db.recursiveDelete(ref);
  }
  return refs.length;
}

// ─── Anonymisation ────────────────────────────────────────────────────────────

/**
 * Anonymises a retained accounting record: every field whose value equals the
 * uid becomes DELETED_USER_MARKER and every known personal field is cleared.
 * Amounts, currencies, dates, provider transaction ids and statuses are kept.
 */
function buildRecordAnonymisation(
  data: DocumentData,
  uid: string
): Record<string, unknown> {
  const update: Record<string, unknown> = {
    anonymised: true,
    anonymisedAt: FieldValue.serverTimestamp(),
  };
  for (const [key, value] of Object.entries(data)) {
    if (value === uid) update[key] = DELETED_USER_MARKER;
    else if (PII_KEYS.has(key) && value != null) update[key] = null;
  }
  return update;
}

async function anonymiseRecords(queries: Query[], uid: string): Promise<number> {
  const docs = await collectDocs(queries);
  return updateInBatches(
    docs.map((doc) => ({ ref: doc.ref, data: buildRecordAnonymisation(doc.data(), uid) }))
  );
}

/**
 * Anonymises the user's side of a shared record (e.g. a capture between two
 * players): `uidField` → marker, `clearFields` → null. The other player's
 * fields are left untouched.
 */
async function anonymiseSharedRecords(
  collection: string,
  uid: string,
  uidField: string,
  clearFields: string[]
): Promise<number> {
  const snap = await getDb().collection(collection).where(uidField, "==", uid).get();
  if (snap.empty) return 0;
  return updateInBatches(
    snap.docs.map((doc) => {
      const data: Record<string, unknown> = {
        [uidField]: DELETED_USER_MARKER,
        anonymisedAt: FieldValue.serverTimestamp(),
      };
      for (const f of clearFields) data[f] = null;
      return { ref: doc.ref, data };
    })
  );
}

// ─── Domain-specific steps ────────────────────────────────────────────────────

/** Cancels an active Stripe subscription immediately (best effort). */
async function cancelStripeSubscription(subscriptionId: string): Promise<boolean> {
  const { secretKey } = await loadStripeSettings();
  if (!secretKey) return false;
  const stripe = await makeStripe(secretKey);
  await stripe.subscriptions.cancel(subscriptionId);
  return true;
}

/** Marks the user's still-running internal (Revolut) subscriptions as cancelled. */
async function cancelInternalSubscriptions(uid: string): Promise<number> {
  const snap = await getDb().collection("subscriptions").where("uid", "==", uid).get();
  const running = snap.docs.filter((d) =>
    ["active", "trialing", "pending_payment", "past_due", "payment_failed"].includes(
      String(d.data().status ?? "")
    )
  );
  return updateInBatches(
    running.map((d) => ({
      ref: d.ref,
      data: {
        status: "cancelled",
        cancelAtPeriodEnd: false,
        cancelledAt: FieldValue.serverTimestamp(),
        cancelReason: "account_deleted",
        updatedAt: FieldValue.serverTimestamp(),
      },
    }))
  );
}

/** Removes the user from both generations of ally groups. */
async function removeFromAllyGroups(uid: string): Promise<number> {
  const db = getDb();
  let touched = 0;

  // ── V2: ally_group_members/{groupId}__{uid} + ally_groups.leaderUid ────────
  const memberships = await db.collection("ally_group_members").where("uid", "==", uid).get();
  const leaderGroups = await db.collection("ally_groups").where("leaderUid", "==", uid).get();

  touched += await deleteRefsInBatches(memberships.docs.map((d) => d.ref));

  for (const groupDoc of leaderGroups.docs) {
    const groupId = groupDoc.id;
    const remaining = await db
      .collection("ally_group_members")
      .where("groupId", "==", groupId)
      .where("status", "==", "active")
      .get();

    if (remaining.empty) {
      // Last member gone → dissolve the group and everything hanging off it.
      await deleteQueryInBatches(db.collection("ally_group_members").where("groupId", "==", groupId));
      await deleteQueryInBatches(db.collection("ally_group_roles").where("groupId", "==", groupId));
      await deleteQueryInBatches(db.collection("enemy_relations").where("sourceId", "==", groupId));
      await deleteQueryInBatches(db.collection("enemy_relations").where("targetId", "==", groupId));
      await db.recursiveDelete(groupDoc.ref);
    } else {
      // Hand leadership to the longest-standing remaining member.
      const next = [...remaining.docs].sort((a, b) => {
        const ta = a.data().joinedAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
        const tb = b.data().joinedAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
        return ta - tb;
      })[0];
      const newLeaderUid = String(next.data().uid ?? "");
      const batch = db.batch();
      batch.set(next.ref, {
        isLeader: true,
        roleId: `${groupId}__leader`,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(groupDoc.ref, {
        leaderUid: newLeaderUid,
        createdByUid: groupDoc.data().createdByUid === uid ? DELETED_USER_MARKER : groupDoc.data().createdByUid ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (newLeaderUid) {
        batch.set(db.collection("users").doc(newLeaderUid), {
          primaryAllyGroupId: groupId,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();
    }
    touched++;
  }

  // ── V1: ally_groups/{id}/members/{uid} + ally_groups.ownerUid ─────────────
  const groups = await db.collection("ally_groups").get();
  for (const groupDoc of groups.docs) {
    const memberRef = groupDoc.ref.collection("members").doc(uid);
    const memberSnap = await memberRef.get();
    const isOwner = groupDoc.data().ownerUid === uid;
    if (!memberSnap.exists && !isOwner) continue;
    if (!groupDoc.data().ownerUid) {
      // V2 group that merely had a legacy members doc.
      if (memberSnap.exists) await memberRef.delete();
      touched++;
      continue;
    }

    if (memberSnap.exists) await memberRef.delete();
    const others = await groupDoc.ref.collection("members").limit(1).get();
    if (others.empty) {
      await db.recursiveDelete(groupDoc.ref);
    } else {
      const update: Record<string, unknown> = {
        membersCount: FieldValue.increment(memberSnap.exists ? -1 : 0),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (isOwner) update.ownerUid = others.docs[0].id;
      await groupDoc.ref.set(update, { merge: true });
    }
    touched++;
  }

  touched += await deleteQueryInBatches(db.collection("ally_group_invites").where("invitedUid", "==", uid));
  touched += await deleteQueryInBatches(db.collection("ally_group_invites").where("invitedByUid", "==", uid));

  return touched;
}

/** Deletes friend links in every direction the codebase uses. */
async function removeFriendships(uid: string): Promise<number> {
  const db = getDb();
  let n = 0;

  // users/{other}/friends/{uid} mirrors of the user's own friend list
  const myFriends = await db.collection("users").doc(uid).collection("friends").get();
  n += await deleteRefsInBatches(
    myFriends.docs.map((d) => db.collection("users").doc(d.id).collection("friends").doc(uid))
  );

  // One-sided leftovers (needs a collection-group index on friends.uid; optional)
  try {
    const stray = await db.collectionGroup("friends").where("uid", "==", uid).get();
    n += await deleteRefsInBatches(stray.docs.map((d) => d.ref));
  } catch (e) {
    logger.warn("userDataCleanup: friends collection-group sweep skipped", e);
  }

  const queries: Query[] = [
    db.collection("friend_requests").where("fromUid", "==", uid),
    db.collection("friend_requests").where("toUid", "==", uid),
    db.collection("friend_links").where("userA", "==", uid),
    db.collection("friend_links").where("userB", "==", uid),
    db.collection("friendships").where("uid1", "==", uid),
    db.collection("friendships").where("uid2", "==", uid),
    db.collection("referral_claims").where("inviterUid", "==", uid),
    db.collection("referral_claims").where("newUserUid", "==", uid),
  ];
  const docs = await collectDocs(queries);
  n += await deleteRefsInBatches(docs.map((d) => d.ref));
  return n;
}

/** Deletes support tickets (with messages/attachments); returns attachment storage paths. */
async function deleteSupportTickets(uid: string): Promise<{ count: number; paths: string[] }> {
  const db = getDb();
  const tickets = await collectDocs([
    db.collection("support_tickets").where("uid", "==", uid),
    db.collection("support_tickets").where("createdByUid", "==", uid),
  ]);
  const paths: string[] = [];
  for (const t of tickets) {
    const messages = await t.ref.collection("messages").get();
    for (const m of messages.docs) {
      const atts = await m.ref.collection("attachments").get();
      for (const a of atts.docs) {
        const p = a.data().path;
        if (typeof p === "string" && p.trim()) paths.push(p.trim());
      }
    }
  }
  await recursiveDeleteDocs(tickets.map((t) => t.ref));
  return { count: tickets.length, paths };
}

/** Removes the user from the cached global leaderboard document. */
async function removeFromLeaderboard(uid: string): Promise<number> {
  const ref = getDb().collection("leaderboard").doc("global");
  const snap = await ref.get();
  const top = snap.data()?.top;
  if (!Array.isArray(top)) return 0;
  const filtered = top.filter((row) => row?.uid !== uid);
  if (filtered.length === top.length) return 0;
  await ref.set(
    { top: filtered.map((row, i) => ({ ...row, rank: i + 1 })) },
    { merge: true }
  );
  return 1;
}

/** Extracts a Storage object path from a Firebase Storage download URL. */
function storagePathFromUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = url.match(/\/o\/([^?]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

async function deleteStorageFiles(uid: string, extraPaths: string[]): Promise<number> {
  let bucket;
  try {
    bucket = getStorage().bucket();
  } catch (e) {
    logger.warn("userDataCleanup: no default Storage bucket", e);
    return 0;
  }
  let n = 0;
  for (const prefix of [`profile_images/${uid}/`, `support_attachments/${uid}/`]) {
    try {
      const [files] = await bucket.getFiles({ prefix });
      await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true })));
      n += files.length;
    } catch (e) {
      logger.warn(`userDataCleanup: storage prefix ${prefix} cleanup failed`, e);
    }
  }
  for (const path of [...new Set(extraPaths)]) {
    try {
      await bucket.file(path).delete({ ignoreNotFound: true });
      n++;
    } catch (e) {
      logger.warn(`userDataCleanup: storage file ${path} delete failed`, e);
    }
  }
  return n;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Erases (or anonymises, where retention is required) all data of `uid`.
 * Does NOT delete the Firebase Auth user — call deleteAuthUser() last.
 */
export async function purgeUserData(uid: string): Promise<UserPurgeSummary> {
  const db = getDb();
  const summary: UserPurgeSummary = {};

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  const user = userSnap.data() ?? {};

  let email = typeof user.email === "string" ? user.email : "";
  if (!email) {
    try {
      email = (await getAdminAuth().getUser(uid)).email ?? "";
    } catch {
      /* auth user already gone */
    }
  }

  const step = async (name: string, fn: () => Promise<number>) => {
    try {
      summary[name] = await fn();
    } catch (e) {
      logger.error(`userDataCleanup: step "${name}" failed`, { uid, error: e });
      throw e;
    }
  };

  // 1. Stop billing first, so nothing renews for a deleted account.
  const stripeSubId = typeof user.stripeSubscriptionId === "string" ? user.stripeSubscriptionId : "";
  if (stripeSubId) {
    try {
      summary.stripeSubscriptionCancelled = (await cancelStripeSubscription(stripeSubId)) ? 1 : 0;
    } catch (e) {
      // Already cancelled / unknown id — don't block the erasure.
      logger.warn("userDataCleanup: Stripe cancel failed", { uid, stripeSubId, error: e });
      summary.stripeSubscriptionCancelled = 0;
    }
  }
  await step("subscriptionsCancelled", () => cancelInternalSubscriptions(uid));

  // 2. Anonymise records kept for accounting / fraud prevention.
  await step("paymentsAnonymised", () =>
    anonymiseRecords([db.collection("payments").where("uid", "==", uid)], uid));
  await step("donationsAnonymised", () =>
    anonymiseRecords([db.collection("donations").where("uid", "==", uid)], uid));
  await step("subscriptionsAnonymised", () =>
    anonymiseRecords([db.collection("subscriptions").where("uid", "==", uid)], uid));
  await step("levelChangesAnonymised", () =>
    anonymiseRecords([db.collection("level_changes").where("uid", "==", uid)], uid));
  await step("adTransactionsAnonymised", () =>
    anonymiseRecords([db.collection("ad_ssv_transactions").where("uid", "==", uid)], uid));
  await step("playPurchasesAnonymised", () =>
    anonymiseRecords([db.collection("play_purchases").where("uid", "==", uid)], uid));

  // 3. Anonymise the user's side of records shared with other players.
  const capFields = ["lat", "lng"];
  await step("capturesAsOwnerAnonymised", () =>
    anonymiseSharedRecords("captures", uid, "ownerUid", ["ownerUsername", ...capFields]));
  await step("capturesAsVictimAnonymised", () =>
    anonymiseSharedRecords("captures", uid, "capturedUserId", ["capturedUsername", ...capFields]));
  await step("trapCapturesAsOwnerAnonymised", () =>
    anonymiseSharedRecords("trap_captures", uid, "ownerUid", ["ownerUsername", ...capFields]));
  await step("trapCapturesAsVictimAnonymised", () =>
    anonymiseSharedRecords("trap_captures", uid, "capturedUserId", ["capturedUsername", ...capFields]));
  await step("othersTrapsAnonymised", () =>
    anonymiseSharedRecords("traps", uid, "capturedUserId", ["capturedUsername"]));
  await step("enemyRelationsCreatorAnonymised", () =>
    anonymiseSharedRecords("enemy_relations", uid, "createdByUid", []));

  // 4. Delete game data owned by the user.
  await step("trapsDeleted", () =>
    deleteQueryInBatches(db.collection("traps").where("ownerUid", "==", uid)));
  await step("placementSessionsDeleted", () =>
    deleteQueryInBatches(db.collection("trap_placement_sessions").where("uid", "==", uid)));
  await step("disarmSessionsDeleted", () =>
    deleteQueryInBatches(db.collection("trap_disarm_sessions").where("uid", "==", uid)));
  await step("dailyStateDeleted", async () => {
    // Doc ids are `${uid}_${dateKey}`; some docs lack a uid field, so match both.
    const docs = await collectDocs([
      db.collection("daily_state").where("uid", "==", uid),
      db.collection("daily_state")
        .where(FieldPath.documentId(), ">=", `${uid}_`)
        .where(FieldPath.documentId(), "<", `${uid}_\uf8ff`),
    ]);
    return deleteRefsInBatches(docs.map((d) => d.ref));
  });
  await step("trapInventoryDeleted", () =>
    deleteQueryInBatches(db.collection("user_trap_inventory").where("uid", "==", uid)));
  await step("awardInventoryDeleted", async () => {
    await db.collection("user_inventories").doc(uid).delete();
    return 1;
  });
  await step("playerLocationDeleted", async () => {
    await db.collection("player_locations").doc(uid).delete();
    return 1;
  });
  await step("enemyRelationsDeleted", async () => {
    const docs = await collectDocs([
      db.collection("enemy_relations").where("sourceId", "==", uid),
      db.collection("enemy_relations").where("targetId", "==", uid),
    ]);
    return deleteRefsInBatches(docs.map((d) => d.ref));
  });
  await step("leaderboardEntriesRemoved", () => removeFromLeaderboard(uid));

  // 5. Social graph, groups, messaging, support.
  await step("friendLinksDeleted", () => removeFriendships(uid));
  await step("allyGroupsUpdated", () => removeFromAllyGroups(uid));
  await step("conversationsDeleted", async () => {
    const docs = await collectDocs([
      db.collection("direct_conversations").where("memberUids", "array-contains", uid),
      db.collection("conversations").where("participants", "array-contains", uid),
      db.collection("conversations").where("participantUids", "array-contains", uid),
    ]);
    return recursiveDeleteDocs(docs.map((d) => d.ref));
  });
  let attachmentPaths: string[] = [];
  await step("supportTicketsDeleted", async () => {
    const res = await deleteSupportTickets(uid);
    attachmentPaths = res.paths;
    return res.count;
  });

  // 6. Username reservation, rate-limit markers.
  await step("usernamesReleased", async () => {
    const refs = (await db.collection("usernames").where("uid", "==", uid).get()).docs.map((d) => d.ref);
    const lower = typeof user.usernameLower === "string" ? user.usernameLower : "";
    if (lower) {
      const s = await db.collection("usernames").doc(lower).get();
      if (s.exists && s.data()?.uid === uid && !refs.some((r) => r.id === lower)) refs.push(s.ref);
    }
    return deleteRefsInBatches(refs);
  });
  await step("rateLimitsDeleted", async () => {
    const refs = [db.collection("_rate_limits").doc(`email_verify_${uid}`)];
    if (email) {
      const norm = email.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
      refs.push(db.collection("_rate_limits").doc(`pw_reset_${norm}`));
    }
    return deleteRefsInBatches(refs);
  });

  // 7. Storage: avatar + support attachments.
  const photoPath = storagePathFromUrl(user.photoUrl);
  await step("storageFilesDeleted", () =>
    deleteStorageFiles(uid, [...attachmentPaths, ...(photoPath && photoPath.includes(uid) ? [photoPath] : [])]));

  // 8. The profile document itself (incl. friends subcollection, FCM token).
  await step("userDocDeleted", async () => {
    await db.recursiveDelete(userRef);
    return userSnap.exists ? 1 : 0;
  });

  return summary;
}

/** Deletes the Firebase Auth user; tolerates an already-deleted account. */
export async function deleteAuthUser(uid: string): Promise<boolean> {
  try {
    await getAdminAuth().deleteUser(uid);
    return true;
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "";
    if (code === "auth/user-not-found") return false;
    throw e;
  }
}
