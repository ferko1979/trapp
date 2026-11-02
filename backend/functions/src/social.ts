import { FieldValue, Timestamp } from "firebase-admin/firestore";
import * as crypto from "crypto";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireUser as requireAuthUid } from "./shared/appCheck";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function usernameToLower(value: string): string {
  return value.trim().toLowerCase();
}

async function getUserDoc(uid: string) {
  const db = getDb();
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "User not found.");
  }
  return { ref: snap.ref, data: snap.data() ?? {} };
}

function friendRequestIdFor(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join("__");
}

async function addFriendsBothWays(params: {
  uidA: string;
  uidB: string;
}) {
  const { uidA, uidB } = params;
  const db = getDb();

  await db.runTransaction(async (tx) => {
    const userASnap = await tx.get(db.collection("users").doc(uidA));
    const userBSnap = await tx.get(db.collection("users").doc(uidB));

    const userA = userASnap.data() ?? {};
    const userB = userBSnap.data() ?? {};

    tx.set(
      db.collection("users").doc(uidA).collection("friends").doc(uidB),
      {
        uid: uidB,
        username: asString(userB.username),
        name: asString(userB.name, "User"),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      db.collection("users").doc(uidB).collection("friends").doc(uidA),
      {
        uid: uidA,
        username: asString(userA.username),
        name: asString(userA.name, "User"),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

export const sendFriendRequest = onCall(async (request) => {
  try {
    const fromUid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const toUid = asString(data.toUid).trim();

    if (!toUid) {
      throw new HttpsError("invalid-argument", "toUid is required.");
    }
    if (toUid === fromUid) {
      throw new HttpsError("failed-precondition", "Cannot friend yourself.");
    }

    const db = getDb();

    const existingFriend = await db
      .collection("users")
      .doc(fromUid)
      .collection("friends")
      .doc(toUid)
      .get();

    if (existingFriend.exists) {
      throw new HttpsError("already-exists", "Already friends.");
    }

    await getUserDoc(toUid);

    const requestId = friendRequestIdFor(fromUid, toUid);
    const requestRef = db.collection("friend_requests").doc(requestId);

    await requestRef.set(
      {
        fromUid,
        toUid,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true, requestId, toUid };
  } catch (error) {
    logger.error("sendFriendRequest crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const sendFriendRequestByUsername = onCall(async (request) => {
  try {
    const fromUid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const username = asString(data.username).trim();

    if (!username) {
      throw new HttpsError("invalid-argument", "username is required.");
    }

    const db = getDb();
    const usernameSnap = await db
      .collection("usernames")
      .doc(usernameToLower(username))
      .get();

    if (!usernameSnap.exists) {
      throw new HttpsError("not-found", "Username not found.");
    }

    const toUid = asString(usernameSnap.data()?.uid);
    if (!toUid) {
      throw new HttpsError("not-found", "User not found.");
    }
    if (toUid === fromUid) {
      throw new HttpsError("failed-precondition", "Cannot friend yourself.");
    }

    const existingFriend = await db
      .collection("users")
      .doc(fromUid)
      .collection("friends")
      .doc(toUid)
      .get();

    if (existingFriend.exists) {
      throw new HttpsError("already-exists", "Already friends.");
    }

    const requestId = friendRequestIdFor(fromUid, toUid);
    const requestRef = db.collection("friend_requests").doc(requestId);

    await requestRef.set(
      {
        fromUid,
        toUid,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true, requestId, toUid };
  } catch (error) {
    logger.error("sendFriendRequestByUsername crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const acceptFriendRequest = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;

    const requestId = asString(data.requestId).trim();
    if (!requestId) {
      throw new HttpsError("invalid-argument", "requestId is required.");
    }

    const db = getDb();
    const requestRef = db.collection("friend_requests").doc(requestId);

    let fromUid = "";
    let toUid = "";

    await db.runTransaction(async (tx) => {
      const requestSnap = await tx.get(requestRef);
      const row = requestSnap.data();

      if (!row) {
        throw new HttpsError("not-found", "Friend request not found.");
      }

      fromUid = asString(row.fromUid);
      toUid = asString(row.toUid);
      const status = asString(row.status);

      if (toUid !== uid) {
        throw new HttpsError("permission-denied", "Not your friend request.");
      }
      if (status !== "pending") {
        throw new HttpsError("failed-precondition", "Request already handled.");
      }

      tx.set(
        requestRef,
        {
          status: "accepted",
          acceptedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    await addFriendsBothWays({ uidA: fromUid, uidB: toUid });

    return { ok: true, fromUid, toUid };
  } catch (error) {
    logger.error("acceptFriendRequest crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const respondToFriendRequest = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const requestId = asString(data.requestId).trim();
    const action = asString(data.action).trim(); // accept | decline

    if (!requestId) {
      throw new HttpsError("invalid-argument", "requestId is required.");
    }
    if (action !== "accept" && action !== "decline") {
      throw new HttpsError("invalid-argument", "action must be accept or decline.");
    }

    const db = getDb();
    const requestRef = db.collection("friend_requests").doc(requestId);

    let fromUid = "";
    let toUid = "";

    await db.runTransaction(async (tx) => {
      const requestSnap = await tx.get(requestRef);
      const row = requestSnap.data();

      if (!row) {
        throw new HttpsError("not-found", "Friend request not found.");
      }

      fromUid = asString(row.fromUid);
      toUid = asString(row.toUid);
      const status = asString(row.status);

      if (toUid !== uid) {
        throw new HttpsError("permission-denied", "Not your friend request.");
      }
      if (status !== "pending") {
        throw new HttpsError("failed-precondition", "Request already handled.");
      }

      if (action === "decline") {
        tx.set(
          requestRef,
          {
            status: "declined",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        return;
      }

      tx.set(
        requestRef,
        {
          status: "accepted",
          acceptedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    if (action === "accept") {
      await addFriendsBothWays({ uidA: fromUid, uidB: toUid });
    }

    return { ok: true, action, fromUid, toUid };
  } catch (error) {
    logger.error("respondToFriendRequest crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const removeFriend = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const friendUid = asString(data.friendUid).trim();

    if (!friendUid) {
      throw new HttpsError("invalid-argument", "friendUid is required.");
    }

    const db = getDb();

    await Promise.all([
      db.collection("users").doc(uid).collection("friends").doc(friendUid).delete(),
      db.collection("users").doc(friendUid).collection("friends").doc(uid).delete(),
    ]);

    return { ok: true, friendUid };
  } catch (error) {
    logger.error("removeFriend crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const listFriends = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const db = getDb();

    const snap = await db
      .collection("users")
      .doc(uid)
      .collection("friends")
      .orderBy("createdAt", "desc")
      .get();

    const items = snap.docs.map((doc) => {
      const row = doc.data();
      return {
        uid: asString(row.uid),
        username: asString(row.username),
        name: asString(row.name, "User"),
        createdAtEpochMs:
          row.createdAt instanceof Timestamp ? row.createdAt.toMillis() : null,
      };
    });

    return { ok: true, items };
  } catch (error) {
    logger.error("listFriends crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const listFriendRequests = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const db = getDb();

    const incomingSnap = await db
      .collection("friend_requests")
      .where("toUid", "==", uid)
      .where("status", "==", "pending")
      .orderBy("createdAt", "desc")
      .get();

    const outgoingSnap = await db
      .collection("friend_requests")
      .where("fromUid", "==", uid)
      .where("status", "==", "pending")
      .orderBy("createdAt", "desc")
      .get();

    const incoming = incomingSnap.docs.map((doc) => {
      const row = doc.data();
      return {
        id: doc.id,
        fromUid: asString(row.fromUid),
        toUid: asString(row.toUid),
        status: asString(row.status),
        createdAtEpochMs:
          row.createdAt instanceof Timestamp ? row.createdAt.toMillis() : null,
      };
    });

    const outgoing = outgoingSnap.docs.map((doc) => {
      const row = doc.data();
      return {
        id: doc.id,
        fromUid: asString(row.fromUid),
        toUid: asString(row.toUid),
        status: asString(row.status),
        createdAtEpochMs:
          row.createdAt instanceof Timestamp ? row.createdAt.toMillis() : null,
      };
    });

    return { ok: true, incoming, outgoing };
  } catch (error) {
    logger.error("listFriendRequests crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

/**
 * Ally groups
 */

export const createAllyGroup = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const name = asString(data.name).trim();

    if (!name) {
      throw new HttpsError("invalid-argument", "name is required.");
    }

    const db = getDb();
    const groupRef = db.collection("ally_groups").doc();

    await groupRef.set({
      name,
      ownerUid: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      membersCount: 1,
    });

    await groupRef.collection("members").doc(uid).set({
      uid,
      role: "owner",
      createdAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, groupId: groupRef.id };
  } catch (error) {
    logger.error("createAllyGroup crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const inviteToAllyGroup = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const groupId = asString(data.groupId).trim();
    const invitedUid = asString(data.invitedUid).trim();

    if (!groupId || !invitedUid) {
      throw new HttpsError("invalid-argument", "groupId and invitedUid are required.");
    }

    const db = getDb();
    const memberSnap = await db
      .collection("ally_groups")
      .doc(groupId)
      .collection("members")
      .doc(uid)
      .get();

    if (!memberSnap.exists) {
      throw new HttpsError("permission-denied", "Not a member of this ally group.");
    }

    const inviteId = `${groupId}__${invitedUid}`;
    await db.collection("ally_group_invites").doc(inviteId).set(
      {
        groupId,
        invitedUid,
        invitedByUid: uid,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true, inviteId };
  } catch (error) {
    logger.error("inviteToAllyGroup crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const acceptAllyGroupInvite = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const inviteId = asString(data.inviteId).trim();

    if (!inviteId) {
      throw new HttpsError("invalid-argument", "inviteId is required.");
    }

    const db = getDb();
    const inviteRef = db.collection("ally_group_invites").doc(inviteId);

    await db.runTransaction(async (tx) => {
      const inviteSnap = await tx.get(inviteRef);
      const invite = inviteSnap.data();

      if (!invite) {
        throw new HttpsError("not-found", "Invite not found.");
      }
      if (asString(invite.invitedUid) !== uid) {
        throw new HttpsError("permission-denied", "Not your invite.");
      }
      if (asString(invite.status) !== "pending") {
        throw new HttpsError("failed-precondition", "Invite already handled.");
      }

      const groupId = asString(invite.groupId);
      const groupRef = db.collection("ally_groups").doc(groupId);
      const groupSnap = await tx.get(groupRef);
      const group = groupSnap.data() ?? {};
      const membersCount =
        typeof group.membersCount === "number" ? group.membersCount : 0;

      tx.set(
        groupRef.collection("members").doc(uid),
        {
          uid,
          role: "member",
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(
        groupRef,
        {
          membersCount: membersCount + 1,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(
        inviteRef,
        {
          status: "accepted",
          acceptedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("acceptAllyGroupInvite crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const leaveAllyGroup = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const groupId = asString(data.groupId).trim();

    if (!groupId) {
      throw new HttpsError("invalid-argument", "groupId is required.");
    }

    const db = getDb();
    const groupRef = db.collection("ally_groups").doc(groupId);
    const memberRef = groupRef.collection("members").doc(uid);

    await db.runTransaction(async (tx) => {
      const groupSnap = await tx.get(groupRef);
      const memberSnap = await tx.get(memberRef);

      if (!groupSnap.exists || !memberSnap.exists) {
        throw new HttpsError("not-found", "Group membership not found.");
      }

      const group = groupSnap.data() ?? {};
      const membersCount =
        typeof group.membersCount === "number" ? group.membersCount : 1;

      tx.delete(memberRef);
      tx.set(
        groupRef,
        {
          membersCount: Math.max(0, membersCount - 1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    return { ok: true, groupId };
  } catch (error) {
    logger.error("leaveAllyGroup crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const listMyAllyGroups = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const db = getDb();

    const groupsSnap = await db.collection("ally_groups").get();

    const memberships = await Promise.all(
      groupsSnap.docs.map(async (doc) => {
        const memberSnap = await doc.ref.collection("members").doc(uid).get();
        if (!memberSnap.exists) return null;

        const row = doc.data();
        return {
          id: doc.id,
          name: asString(row.name),
          ownerUid: asString(row.ownerUid),
          membersCount:
            typeof row.membersCount === "number" ? row.membersCount : 0,
          createdAtEpochMs:
            row.createdAt instanceof Timestamp ? row.createdAt.toMillis() : null,
        };
      })
    );

    return {
      ok: true,
      items: memberships.filter(Boolean),
    };
  } catch (error) {
    logger.error("listMyAllyGroups crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const listAllyGroupMembers = onCall(async (request) => {
  try {
    requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const groupId = asString(data.groupId).trim();

    if (!groupId) {
      throw new HttpsError("invalid-argument", "groupId is required.");
    }

    const db = getDb();
    const snap = await db
      .collection("ally_groups")
      .doc(groupId)
      .collection("members")
      .orderBy("createdAt", "asc")
      .get();

    const items = await Promise.all(
      snap.docs.map(async (doc) => {
        const row = doc.data();
        const memberUid = asString(row.uid);
        const user = await getUserDoc(memberUid);

        return {
          uid: memberUid,
          role: asString(row.role),
          username: asString(user.data.username),
          name: asString(user.data.name, "User"),
          createdAtEpochMs:
            row.createdAt instanceof Timestamp ? row.createdAt.toMillis() : null,
        };
      })
    );

    return { ok: true, items };
  } catch (error) {
    logger.error("listAllyGroupMembers crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

// ── Invite link messages by language ─────────────────────────────────────────

const INVITE_MESSAGES: Record<string, { full: string; short: string }> = {
  en: {
    full: "Hey! I'm playing TRAPP — place traps and catch your friends on a real map! Come join me! {url}",
    short: "Join me on TRAPP! {url}",
  },
  hu: {
    full: "Szia! Játszom a TRAPP-ot — helyezz el csapdákat és fogd el barátaidat az igazi térképen! Csatlakozz hozzám! {url}",
    short: "Csatlakozz a TRAPP-hoz! {url}",
  },
  de: {
    full: "Hey! Ich spiele TRAPP — platziere Fallen und fange deine Freunde auf einer echten Karte! Mach mit! {url}",
    short: "Komm zu TRAPP! {url}",
  },
  sk: {
    full: "Ahoj! Hrám TRAPP — umiestňuj pasce a chytaj priateľov na skutočnej mape! Pridaj sa! {url}",
    short: "Pridaj sa na TRAPP! {url}",
  },
  ro: {
    full: "Salut! Joc TRAPP — pune capcane și prinde-ți prietenii pe o hartă reală! Vino cu mine! {url}",
    short: "Alătură-te pe TRAPP! {url}",
  },
  hr: {
    full: "Hej! Igram TRAPP — postavljaj zamke i uhvati prijatelje na pravoj karti! Pridruži mi se! {url}",
    short: "Pridruži se na TRAPP! {url}",
  },
};

const BASE_INVITE_URL = "https://playtrapnow.web.app/invite";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.fairco.trap";
const APP_STORE_URL = "https://apps.apple.com/app/trapp/id0000000000"; // placeholder

// ── generateInviteLink ────────────────────────────────────────────────────────

/**
 * Generates a personalised invite link with a referral code.
 * The invitee's registration will auto-add the inviter as a friend when
 * they call claimReferral() after signing up.
 */
export const generateInviteLink = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const lang = typeof data.lang === "string"
      ? data.lang.toLowerCase().slice(0, 2)
      : "en";

    const db = getDb();
    const userSnap = await db.collection("users").doc(uid).get();
    const user = userSnap.data() ?? {};
    const displayName = asString(user.displayName ?? user.username, "A friend");

    // Generate or reuse an existing referral code for this user
    let code = asString(user.referralCode);
    if (!code) {
      code = crypto.randomBytes(6).toString("base64url").slice(0, 8);
      await db.collection("users").doc(uid).update({ referralCode: code });
    }

    const inviteUrl = `${BASE_INVITE_URL}?ref=${code}&from=${encodeURIComponent(displayName)}`;
    const msgs = INVITE_MESSAGES[lang] ?? INVITE_MESSAGES["en"];

    return {
      ok: true,
      referralCode: code,
      inviteUrl,
      androidPlayStoreUrl: PLAY_STORE_URL,
      iosAppStoreUrl: APP_STORE_URL,
      universalUrl: inviteUrl,
      inviteMessage: msgs.full.replace("{url}", inviteUrl),
      inviteMessageShort: msgs.short.replace("{url}", inviteUrl),
      senderName: displayName,
    };
  } catch (error) {
    logger.error("generateInviteLink crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error instanceof Error ? error.message : "Unknown error");
  }
});

// ── getInviteConfig (legacy wrapper kept for backward compat) ─────────────────

export const getInviteConfig = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const lang = typeof data.lang === "string"
      ? data.lang.toLowerCase().slice(0, 2)
      : "en";

    const db = getDb();
    const userSnap = await db.collection("users").doc(uid).get();
    const user = userSnap.data() ?? {};
    const displayName = asString(user.displayName ?? user.username, "A friend");

    let code = asString(user.referralCode);
    if (!code) {
      code = crypto.randomBytes(6).toString("base64url").slice(0, 8);
      await db.collection("users").doc(uid).update({ referralCode: code });
    }

    const inviteUrl = `${BASE_INVITE_URL}?ref=${code}&from=${encodeURIComponent(displayName)}`;
    const msgs = INVITE_MESSAGES[lang] ?? INVITE_MESSAGES["en"];

    return {
      ok: true,
      referralCode: code,
      androidPlayStoreUrl: PLAY_STORE_URL,
      iosAppStoreUrl: APP_STORE_URL,
      universalUrl: inviteUrl,
      inviteMessage: msgs.full.replace("{url}", inviteUrl),
      inviteMessageShort: msgs.short.replace("{url}", inviteUrl),
    };
  } catch (error) {
    logger.error("getInviteConfig crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error instanceof Error ? error.message : "Unknown error");
  }
});

// ── claimReferral ─────────────────────────────────────────────────────────────

/**
 * Called right after the new user registers (with their own auth token).
 * Looks up the referral code owner and auto-creates a mutual friendship.
 */
export const claimReferral = onCall(async (request) => {
  try {
    const newUserUid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const code = typeof data.referralCode === "string" ? data.referralCode.trim() : "";
    if (!code) throw new HttpsError("invalid-argument", "referralCode is required.");

    const db = getDb();

    // Find the inviter by referral code
    const snap = await db.collection("users").where("referralCode", "==", code).limit(1).get();
    if (snap.empty) {
      logger.warn("claimReferral: unknown code", { code, newUserUid });
      return { ok: true, claimed: false, reason: "code_not_found" };
    }
    const inviterDoc = snap.docs[0];
    const inviterUid = inviterDoc.id;

    if (inviterUid === newUserUid) {
      return { ok: true, claimed: false, reason: "self_referral" };
    }

    // Check not already friends
    const existingFriendSnap = await db
      .collection("users").doc(newUserUid)
      .collection("friends").doc(inviterUid)
      .get();
    if (existingFriendSnap.exists) {
      return { ok: true, claimed: false, reason: "already_friends" };
    }

    // Auto-add mutual friendship
    await addFriendsBothWays({ uidA: inviterUid, uidB: newUserUid });

    // Track referral claim
    await db.collection("referral_claims").add({
      inviterUid,
      newUserUid,
      code,
      claimedAt: FieldValue.serverTimestamp(),
    });

    logger.info("claimReferral: success", { inviterUid, newUserUid, code });
    return { ok: true, claimed: true, inviterUid };
  } catch (error) {
    logger.error("claimReferral crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error instanceof Error ? error.message : "Unknown error");
  }
});