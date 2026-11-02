import { FieldValue, Timestamp } from "firebase-admin/firestore";
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

async function getUserDoc(uid: string) {
  const db = getDb();
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "User not found.");
  }
  return { ref: snap.ref, data: snap.data() ?? {} };
}

export const getUserMiniProfile = onCall(async (request) => {
  try {
    requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;

    const uid = asString(data.uid).trim();
    const username = asString(data.username).trim();

    const db = getDb();

    let targetUid = uid;

    if (!targetUid && username) {
      const usernameSnap = await db
        .collection("usernames")
        .doc(usernameToLower(username))
        .get();

      if (!usernameSnap.exists) {
        throw new HttpsError("not-found", "User not found.");
      }

      targetUid = asString(usernameSnap.data()?.uid);
    }

    if (!targetUid) {
      throw new HttpsError("invalid-argument", "uid or username is required.");
    }

    const { data: user } = await getUserDoc(targetUid);

    return {
      ok: true,
      profile: {
        uid: targetUid,
        name: asString(user.name, "User"),
        username: asString(user.username),
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
    logger.error("getUserMiniProfile crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const listFriendRequestsDetailed = onCall(async (request) => {
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

    const incoming = await Promise.all(
      incomingSnap.docs.map(async (doc) => {
        const row = doc.data();
        const fromUid = asString(row.fromUid);
        const { data: fromUser } = await getUserDoc(fromUid);

        return {
          id: doc.id,
          fromUid,
          fromUsername: asString(fromUser.username),
          fromName: asString(fromUser.name, "User"),
          createdAtEpochMs: getTimestampMillis(row.createdAt),
        };
      })
    );

    const outgoing = await Promise.all(
      outgoingSnap.docs.map(async (doc) => {
        const row = doc.data();
        const toUid = asString(row.toUid);
        const { data: toUser } = await getUserDoc(toUid);

        return {
          id: doc.id,
          toUid,
          toUsername: asString(toUser.username),
          toName: asString(toUser.name, "User"),
          createdAtEpochMs: getTimestampMillis(row.createdAt),
        };
      })
    );

    return {
      ok: true,
      incoming,
      outgoing,
    };
  } catch (error) {
    logger.error("listFriendRequestsDetailed crashed", error);
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
      throw new HttpsError(
        "invalid-argument",
        "action must be accept or decline."
      );
    }

    const db = getDb();
    const requestRef = db.collection("friend_requests").doc(requestId);

    await db.runTransaction(async (tx) => {
      const requestSnap = await tx.get(requestRef);
      const row = requestSnap.data();

      if (!row) {
        throw new HttpsError("not-found", "Friend request not found.");
      }

      const fromUid = asString(row.fromUid);
      const toUid = asString(row.toUid);
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

      const fromUserSnap = await tx.get(db.collection("users").doc(fromUid));
      const toUserSnap = await tx.get(db.collection("users").doc(toUid));

      const fromUser = fromUserSnap.data() ?? {};
      const toUser = toUserSnap.data() ?? {};

      tx.set(
        db.collection("users").doc(fromUid).collection("friends").doc(toUid),
        {
          uid: toUid,
          username: asString(toUser.username),
          name: asString(toUser.name, "User"),
          createdAt: FieldValue.serverTimestamp(),
        }
      );

      tx.set(
        db.collection("users").doc(toUid).collection("friends").doc(fromUid),
        {
          uid: fromUid,
          username: asString(fromUser.username),
          name: asString(fromUser.name, "User"),
          createdAt: FieldValue.serverTimestamp(),
        }
      );

      tx.set(
        requestRef,
        {
          status: "accepted",
          updatedAt: FieldValue.serverTimestamp(),
          acceptedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    return { ok: true, action };
  } catch (error) {
    logger.error("respondToFriendRequest crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const listMyFriendsDetailed = onCall(async (request) => {
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
        createdAtEpochMs: getTimestampMillis(row.createdAt),
      };
    });

    return { ok: true, items };
  } catch (error) {
    logger.error("listMyFriendsDetailed crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const getFriendshipStatusByUsername = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
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
      throw new HttpsError("not-found", "User not found.");
    }

    const targetUid = asString(usernameSnap.data()?.uid);
    if (!targetUid) {
      throw new HttpsError("not-found", "User not found.");
    }

    if (targetUid === uid) {
      return { ok: true, status: "self", targetUid };
    }

    const friendSnap = await db
      .collection("users")
      .doc(uid)
      .collection("friends")
      .doc(targetUid)
      .get();

    if (friendSnap.exists) {
      return { ok: true, status: "friends", targetUid };
    }

    const requestId = [uid, targetUid].sort().join("__");
    const requestSnap = await db.collection("friend_requests").doc(requestId).get();
    const requestData = requestSnap.data();

    if (!requestData) {
      return { ok: true, status: "none", targetUid };
    }

    const status = asString(requestData.status);
    const fromUid = asString(requestData.fromUid);
    const toUid = asString(requestData.toUid);

    if (status === "pending" && fromUid === uid && toUid === targetUid) {
      return { ok: true, status: "outgoing_pending", targetUid };
    }

    if (status === "pending" && fromUid === targetUid && toUid === uid) {
      return { ok: true, status: "incoming_pending", targetUid };
    }

    return { ok: true, status, targetUid };
  } catch (error) {
    logger.error("getFriendshipStatusByUsername crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

/**
 * Lookup a user by username or UID ("identifier"), and return their basic
 * profile plus the friendship status between the caller and that user.
 * Used by the Android "Add Friend by identifier" feature.
 */
export const findUserByIdentifier = onCall(async (request) => {
  try {
    const callerUid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const identifier = asString(data.identifier).trim();

    if (!identifier) {
      throw new HttpsError("invalid-argument", "identifier is required.");
    }

    const db = getDb();
    let targetUid: string | null = null;
    let userData: Record<string, unknown> | null = null;

    // 1. Email lookup (identifier contains "@")
    if (identifier.includes("@")) {
      const emailLower = identifier.toLowerCase();
      const emailSnap = await db
        .collection("users")
        .where("email", "==", emailLower)
        .limit(1)
        .get();
      if (!emailSnap.empty) {
        targetUid = emailSnap.docs[0].id;
        userData = (emailSnap.docs[0].data() ?? {}) as Record<string, unknown>;
      } else {
        // Some accounts store email with original casing — second pass
        const emailSnap2 = await db
          .collection("users")
          .where("email", "==", identifier)
          .limit(1)
          .get();
        if (!emailSnap2.empty) {
          targetUid = emailSnap2.docs[0].id;
          userData = (emailSnap2.docs[0].data() ?? {}) as Record<string, unknown>;
        }
      }
    }

    // 2. Try username lookup (strip leading @ if present)
    if (!targetUid) {
      const candidate = identifier.startsWith("@") ? identifier.slice(1) : identifier;
      const usernameSnap = await db
        .collection("usernames")
        .doc(usernameToLower(candidate))
        .get();

      if (usernameSnap.exists) {
        targetUid = asString(usernameSnap.data()?.uid);
      }
    }

    // 3. Fallback: try direct UID lookup
    if (!targetUid) {
      const userSnap = await db.collection("users").doc(identifier).get();
      if (userSnap.exists) {
        targetUid = identifier;
        userData = (userSnap.data() ?? {}) as Record<string, unknown>;
      }
    }

    if (!targetUid) {
      return { ok: true, found: false, reason: "not_found" };
    }

    // Fetch user doc if not already loaded
    if (!userData) {
      const userSnap = await db.collection("users").doc(targetUid).get();
      if (!userSnap.exists) {
        return { ok: true, found: false, reason: "not_found" };
      }
      userData = (userSnap.data() ?? {}) as Record<string, unknown>;
    }

    // 3. Determine friendship status
    let friendshipStatus = "none";

    if (targetUid === callerUid) {
      friendshipStatus = "self";
    } else {
      const friendSnap = await db
        .collection("users")
        .doc(callerUid)
        .collection("friends")
        .doc(targetUid)
        .get();

      if (friendSnap.exists) {
        friendshipStatus = "friends";
      } else {
        const requestId = [callerUid, targetUid].sort().join("__");
        const requestSnap = await db
          .collection("friend_requests")
          .doc(requestId)
          .get();
        const reqData = requestSnap.data();

        if (reqData && asString(reqData.status) === "pending") {
          const fromUid = asString(reqData.fromUid);
          friendshipStatus =
            fromUid === callerUid ? "outgoing_pending" : "incoming_pending";
        }
      }
    }

    return {
      ok: true,
      found: true,
      user: {
        uid: targetUid,
        username: asString(userData.username),
        name: asString(userData.displayName || userData.name, "User"),
      },
      friendshipStatus,
    };
  } catch (error) {
    logger.error("findUserByIdentifier crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});