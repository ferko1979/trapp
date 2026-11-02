import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireUser as requireAuthUid } from "./shared/appCheck";

export type PublicUserInfo = {
  uid: string;
  name: string;
  username: string;
  usernameLower: string;
  email: string;
  isAdmin: boolean;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeUsername(value: string): string {
  return value.trim();
}

function usernameToLower(value: string): string {
  return normalizeUsername(value).toLowerCase();
}

function validateUsername(username: string) {
  if (!/^[a-zA-Z0-9._-]{3,24}$/.test(username)) {
    throw new HttpsError(
      "invalid-argument",
      "Username must be 3-24 chars and use letters, numbers, dot, underscore, or dash."
    );
  }
}

function conversationIdFor(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join("__");
}

function getOtherUsername(params: {
  myUsername: string;
  memberUsernames: string[];
  kind: string;
  supportTicketNo?: string;
}): string {
  const { myUsername, memberUsernames, kind, supportTicketNo } = params;

  if (kind === "support") {
    return supportTicketNo ? `Support · ${supportTicketNo}` : "Support";
  }

  const filtered = memberUsernames.filter(Boolean);

  if (filtered.length === 0) return "";
  if (filtered.length === 1) return filtered[0];
  return filtered.find((x) => x !== myUsername) ?? filtered[0];
}

export async function getUserPublic(uid: string): Promise<PublicUserInfo> {
  const db = getDb();
  const snap = await db.collection("users").doc(uid).get();
  const data = snap.data() ?? {};

  return {
    uid,
    name: asString(data.name, "User"),
    username: asString(data.username),
    usernameLower: asString(data.usernameLower),
    email: asString(data.email),
    isAdmin:
      data.isAdmin === true ||
      data.admin === true ||
      asString(data.role) === "admin",
  };
}

export async function assertAdmin(uid: string): Promise<PublicUserInfo> {
  const user = await getUserPublic(uid);
  if (!user.isAdmin) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  return user;
}

export async function appendConversationMessage(params: {
  senderUid: string;
  recipientUid: string;
  text: string;
  senderUsername?: string;
  conversationKind?: "direct" | "support";
  supportTicketId?: string | null;
  supportTicketNo?: string | null;
  meta?: Record<string, unknown>;
}) {
  const {
    senderUid,
    recipientUid,
    text,
    senderUsername,
    conversationKind = "direct",
    supportTicketId = null,
    supportTicketNo = null,
    meta = {},
  } = params;

  if (!text.trim()) {
    throw new HttpsError("invalid-argument", "message is required.");
  }

  const db = getDb();
  const sender = await getUserPublic(senderUid);
  const recipient = await getUserPublic(recipientUid);

  const conversationId =
    conversationKind === "support" && supportTicketId
      ? `support__${supportTicketId}`
      : conversationIdFor(senderUid, recipientUid);

  const conversationRef = db.collection("direct_conversations").doc(conversationId);
  const messageRef = conversationRef.collection("messages").doc();

  await db.runTransaction(async (tx) => {
    const conversationSnap = await tx.get(conversationRef);
    const now = FieldValue.serverTimestamp();

    const conversationBase = {
      memberUids: [senderUid, recipientUid].sort(),
      memberUsernameLowers: [sender.usernameLower, recipient.usernameLower]
        .filter(Boolean)
        .sort(),
      memberUsernames: [sender.username, recipient.username].filter(Boolean).sort(),
      kind: conversationKind,
      supportTicketId,
      supportTicketNo,
      updatedAt: now,
      lastMessageAt: now,
      lastMessageText: text.slice(0, 200),
      lastMessageSenderUid: senderUid,
      unreadBy: {
        [senderUid]: false,
        [recipientUid]: true,
      },
    };

    if (!conversationSnap.exists) {
      tx.set(conversationRef, {
        ...conversationBase,
        createdAt: now,
      });
    } else {
      tx.set(conversationRef, conversationBase, { merge: true });
    }

    tx.set(messageRef, {
      senderUid,
      senderUsername: senderUsername ?? sender.username ?? "",
      text,
      createdAt: now,
      kind: conversationKind,
      supportTicketId,
      supportTicketNo,
      ...meta,
    });
  });

  return { conversationId };
}

export const setMyUsername = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const username = normalizeUsername(asString(data.username));
    const usernameLower = usernameToLower(username);

    validateUsername(username);

    const db = getDb();
    const usernameRef = db.collection("usernames").doc(usernameLower);
    const userRef = db.collection("users").doc(uid);

    await db.runTransaction(async (tx) => {
      const existingUsernameSnap = await tx.get(usernameRef);
      if (existingUsernameSnap.exists) {
        const ownerUid = asString(existingUsernameSnap.data()?.uid);
        if (ownerUid !== uid) {
          throw new HttpsError("already-exists", "Username is already taken.");
        }
      }

      const userSnap = await tx.get(userRef);
      const user = userSnap.data() ?? {};
      const oldUsernameLower = asString(user.usernameLower);

      if (oldUsernameLower && oldUsernameLower !== usernameLower) {
        tx.delete(db.collection("usernames").doc(oldUsernameLower));
      }

      tx.set(
        usernameRef,
        {
          uid,
          username,
          usernameLower,
          createdAt: existingUsernameSnap.exists
            ? existingUsernameSnap.data()?.createdAt ?? FieldValue.serverTimestamp()
            : FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(
        userRef,
        {
          username,
          usernameLower,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    return {
      ok: true,
      username,
      usernameLower,
    };
  } catch (error) {
    logger.error("setMyUsername crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const getMyMessagingProfile = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const user = await getUserPublic(uid);
    return { ok: true, profile: user };
  } catch (error) {
    logger.error("getMyMessagingProfile crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const sendDirectMessageByUsername = onCall(async (request) => {
  try {
    const senderUid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const username = normalizeUsername(asString(data.username));
    const usernameLower = usernameToLower(username);
    const text = asString(data.message).trim();

    if (!username) {
      throw new HttpsError("invalid-argument", "username is required.");
    }
    if (!text) {
      throw new HttpsError("invalid-argument", "message is required.");
    }
    if (text.length > 5000) {
      throw new HttpsError("invalid-argument", "message is too long.");
    }

    const db = getDb();
    const usernameSnap = await db.collection("usernames").doc(usernameLower).get();

    if (!usernameSnap.exists) {
      throw new HttpsError("not-found", "Username not found.");
    }

    const recipientUid = asString(usernameSnap.data()?.uid);
    if (!recipientUid) {
      throw new HttpsError("not-found", "Recipient not found.");
    }
    if (recipientUid === senderUid) {
      throw new HttpsError("failed-precondition", "Cannot message yourself.");
    }

    const result = await appendConversationMessage({
      senderUid,
      recipientUid,
      text,
      conversationKind: "direct",
    });

    const recipient = await getUserPublic(recipientUid);

    return {
      ok: true,
      conversationId: result.conversationId,
      recipientUid,
      recipientUsername: recipient.username,
    };
  } catch (error) {
    logger.error("sendDirectMessageByUsername crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const sendDirectMessageToUid = onCall(async (request) => {
  try {
    const senderUid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const recipientUid = asString(data.recipientUid).trim();
    const text = asString(data.message).trim();

    if (!recipientUid) {
      throw new HttpsError("invalid-argument", "recipientUid is required.");
    }
    if (!text) {
      throw new HttpsError("invalid-argument", "message is required.");
    }
    if (recipientUid === senderUid) {
      throw new HttpsError("failed-precondition", "Cannot message yourself.");
    }

    const recipient = await getUserPublic(recipientUid);
    if (!recipient.uid) {
      throw new HttpsError("not-found", "Recipient not found.");
    }

    const result = await appendConversationMessage({
      senderUid,
      recipientUid,
      text,
      conversationKind: "direct",
    });

    return {
      ok: true,
      conversationId: result.conversationId,
      recipientUid,
      recipientUsername: recipient.username,
    };
  } catch (error) {
    logger.error("sendDirectMessageToUid crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const searchUsersByUsername = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const queryText = usernameToLower(asString(data.query).trim());

    if (!queryText || queryText.length < 2) {
      return { ok: true, items: [] };
    }

    const db = getDb();
    const end = `${queryText}\uf8ff`;

    const snap = await db
      .collection("usernames")
      .orderBy("usernameLower")
      .startAt(queryText)
      .endAt(end)
      .limit(15)
      .get();

    const items = await Promise.all(
      snap.docs.map(async (doc) => {
        const row = doc.data();
        const foundUid = asString(row.uid);
        if (!foundUid || foundUid === uid) return null;

        const user = await getUserPublic(foundUid);
        return {
          uid: user.uid,
          username: user.username,
          name: user.name,
        };
      })
    );

    return {
      ok: true,
      items: items.filter((item): item is NonNullable<typeof item> => item !== null),
    };
  } catch (error) {
    logger.error("searchUsersByUsername crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const sendFriendRequestByUsername = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const username = normalizeUsername(asString(data.username));
    const usernameLower = usernameToLower(username);

    if (!username) {
      throw new HttpsError("invalid-argument", "username is required.");
    }

    const db = getDb();
    const usernameSnap = await db.collection("usernames").doc(usernameLower).get();

    if (!usernameSnap.exists) {
      throw new HttpsError("not-found", "Username not found.");
    }

    const targetUid = asString(usernameSnap.data()?.uid);
    if (!targetUid) {
      throw new HttpsError("not-found", "User not found.");
    }
    if (targetUid === uid) {
      throw new HttpsError("failed-precondition", "Cannot friend yourself.");
    }

    const existingFriendSnap = await db
      .collection("users")
      .doc(uid)
      .collection("friends")
      .doc(targetUid)
      .get();

    if (existingFriendSnap.exists) {
      throw new HttpsError("already-exists", "Already friends.");
    }

    const requestId = [uid, targetUid].sort().join("__");
    const requestRef = db.collection("friend_requests").doc(requestId);

    await requestRef.set(
      {
        fromUid: uid,
        toUid: targetUid,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true, targetUid };
  } catch (error) {
    logger.error("sendFriendRequestByUsername crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const listMyConversations = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const db = getDb();
    const myUser = await getUserPublic(uid);

    const snap = await db
      .collection("direct_conversations")
      .where("memberUids", "array-contains", uid)
      .orderBy("lastMessageAt", "desc")
      .get();

    const items = snap.docs.map((doc) => {
      const row = doc.data();
      const memberUids = Array.isArray(row.memberUids) ? row.memberUids : [];
      const memberUsernames = Array.isArray(row.memberUsernames)
        ? row.memberUsernames
        : [];

      const kind = asString(row.kind, "direct");
      const supportTicketNo = asString(row.supportTicketNo);
      const otherUid = memberUids.find((x) => x !== uid) ?? "";
      const otherUsername = getOtherUsername({
        myUsername: myUser.username,
        memberUsernames,
        kind,
        supportTicketNo,
      });

      return {
        id: doc.id,
        kind,
        supportTicketId: asString(row.supportTicketId),
        supportTicketNo,
        memberUids,
        memberUsernames,
        otherUid,
        otherUsername,
        lastMessageText: asString(row.lastMessageText),
        lastMessageSenderUid: asString(row.lastMessageSenderUid),
        unread: asBoolean(row.unreadBy?.[uid]),
        lastMessageAtEpochMs:
          row.lastMessageAt instanceof Timestamp ? row.lastMessageAt.toMillis() : null,
      };
    });

    return { ok: true, items };
  } catch (error) {
    logger.error("listMyConversations crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const getConversationThread = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const conversationId = asString(data.conversationId).trim();

    if (!conversationId) {
      throw new HttpsError("invalid-argument", "conversationId is required.");
    }

    const db = getDb();
    const conversationRef = db.collection("direct_conversations").doc(conversationId);
    const conversationSnap = await conversationRef.get();
    const conversation = conversationSnap.data();

    if (!conversation) {
      throw new HttpsError("not-found", "Conversation not found.");
    }

    const memberUids = Array.isArray(conversation.memberUids)
      ? conversation.memberUids
      : [];

    if (!memberUids.includes(uid)) {
      throw new HttpsError("permission-denied", "Not your conversation.");
    }

    const messagesSnap = await conversationRef
      .collection("messages")
      .orderBy("createdAt", "asc")
      .get();

    const messages = messagesSnap.docs.map((doc) => {
      const row = doc.data();
      return {
        id: doc.id,
        senderUid: asString(row.senderUid),
        senderUsername: asString(row.senderUsername),
        text: asString(row.text),
        kind: asString(row.kind, "direct"),
        supportTicketId: asString(row.supportTicketId),
        supportTicketNo: asString(row.supportTicketNo),
        createdAtEpochMs:
          row.createdAt instanceof Timestamp ? row.createdAt.toMillis() : null,
      };
    });

    await conversationRef.set(
      {
        unreadBy: {
          ...(conversation.unreadBy ?? {}),
          [uid]: false,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      ok: true,
      conversation: {
        id: conversationId,
        kind: asString(conversation.kind, "direct"),
        supportTicketId: asString(conversation.supportTicketId),
        supportTicketNo: asString(conversation.supportTicketNo),
        memberUids,
        memberUsernames: Array.isArray(conversation.memberUsernames)
          ? conversation.memberUsernames
          : [],
      },
      messages,
    };
  } catch (error) {
    logger.error("getConversationThread crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});