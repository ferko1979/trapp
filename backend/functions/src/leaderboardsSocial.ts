import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { getDb } from "./shared/firebase";
import { requireUser as requireAuth } from "./shared/appCheck";

function sortLeaderboard(items: Array<Record<string, unknown>>) {
  return items.sort((a, b) => {
    const aXp = Number(a.xp ?? 0);
    const bXp = Number(b.xp ?? 0);
    if (bXp !== aXp) return bXp - aXp;

    const aCaptures = Number(a.captureCount ?? 0);
    const bCaptures = Number(b.captureCount ?? 0);
    if (bCaptures !== aCaptures) return bCaptures - aCaptures;

    const aName = String(a.displayName ?? "");
    const bName = String(b.displayName ?? "");
    return aName.localeCompare(bName);
  });
}

export const getFriendsLeaderboard = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = getDb();

  const acceptedA = await db
    .collection("friend_links")
    .where("userA", "==", uid)
    .where("status", "==", "accepted")
    .get();

  const acceptedB = await db
    .collection("friend_links")
    .where("userB", "==", uid)
    .where("status", "==", "accepted")
    .get();

  const ids = new Set<string>([uid]);
  acceptedA.docs.forEach((d) => ids.add(String(d.data().userB)));
  acceptedB.docs.forEach((d) => ids.add(String(d.data().userA)));

  const users = await Promise.all(
    Array.from(ids).map(async (id) => {
      const snap = await db.collection("users").doc(id).get();
      return {
        uid: id,
        displayName: snap.data()?.displayName ?? "Anonymous",
        captureCount: snap.data()?.captureCount ?? 0,
        timesCaught: snap.data()?.timesCaught ?? 0,
        xp: snap.data()?.xp ?? 0,
        isMe: id === uid,
      };
    })
  );

  const sorted = sortLeaderboard(users);
  return {
    ok: true,
    hasFriends: ids.size > 1,
    top: sorted.map((item, index) => ({
      rank: index + 1,
      ...item,
    })),
  };
});

export const getAllyGroupLeaderboard = onCall(async (request) => {
  const uid = requireAuth(request);
  const groupId =
    typeof request.data?.groupId === "string" ? request.data.groupId.trim() : "";

  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId is required.");
  }

  const db = getDb();
  const myMembership = await db.collection("ally_group_members").doc(`${groupId}__${uid}`).get();
  if (!myMembership.exists || String(myMembership.data()?.status ?? "") !== "active") {
    throw new HttpsError("permission-denied", "You are not an active member of this group.");
  }

  const membersSnap = await db
    .collection("ally_group_members")
    .where("groupId", "==", groupId)
    .where("status", "==", "active")
    .get();

  const users = await Promise.all(
    membersSnap.docs.map(async (doc) => {
      const memberUid = String(doc.data().uid);
      const snap = await db.collection("users").doc(memberUid).get();
      return {
        uid: memberUid,
        displayName: snap.data()?.displayName ?? "Anonymous",
        captureCount: snap.data()?.captureCount ?? 0,
        timesCaught: snap.data()?.timesCaught ?? 0,
        xp: snap.data()?.xp ?? 0,
        isMe: memberUid === uid,
      };
    })
  );

  const sorted = sortLeaderboard(users);
  return {
    ok: true,
    groupId,
    top: sorted.map((item, index) => ({
      rank: index + 1,
      ...item,
    })),
  };
});

export const getMyRankSummary = onCall(async (request) => {
  try {
    const uid = requireAuth(request);
    const db = getDb();

    // Global rank from cached leaderboard
    const globalSnap = await db.collection("leaderboard").doc("global").get();
    const globalTop = (globalSnap.data()?.top ?? []) as Array<Record<string, unknown>>;
    const globalEntry = globalTop.find((e) => String(e.uid) === uid);
    const globalRank = globalEntry ? Number(globalEntry.rank) : null;
    const globalTotal = globalTop.length;

    // Friends rank
    const [acceptedA, acceptedB] = await Promise.all([
      db.collection("friend_links").where("userA", "==", uid).where("status", "==", "accepted").get(),
      db.collection("friend_links").where("userB", "==", uid).where("status", "==", "accepted").get(),
    ]);
    const friendIds = new Set<string>();
    acceptedA.docs.forEach((d) => friendIds.add(String(d.data().userB)));
    acceptedB.docs.forEach((d) => friendIds.add(String(d.data().userA)));
    const hasFriends = friendIds.size > 0;

    let friendsRank: number | null = null;
    let friendsTotal: number | null = null;
    if (hasFriends) {
      const allIds = Array.from(new Set([uid, ...friendIds]));
      const friendUsers = await Promise.all(
        allIds.map(async (id) => {
          const snap = await db.collection("users").doc(id).get();
          return { uid: id, xp: Number(snap.data()?.xp ?? 0) };
        })
      );
      friendUsers.sort((a, b) => b.xp - a.xp);
      const friendIdx = friendUsers.findIndex((u) => u.uid === uid);
      if (friendIdx >= 0) {
        let rank = friendIdx + 1;
        for (let i = friendIdx - 1; i >= 0; i--) {
          if (friendUsers[i].xp === friendUsers[friendIdx].xp) rank = i + 1;
          else break;
        }
        friendsRank = rank;
      }
      friendsTotal = friendUsers.length;
    }

    // User data + alliance rank
    const userSnap = await db.collection("users").doc(uid).get();
    const xp = Number(userSnap.data()?.xp ?? 0);
    const captureCount = Number(userSnap.data()?.captureCount ?? 0);
    const primaryAllyGroupId = String(userSnap.data()?.primaryAllyGroupId ?? "");

    let allyRank: number | null = null;
    let allyTotal: number | null = null;
    let allyGroupName: string | null = null;

    if (primaryAllyGroupId) {
      const [groupSnap, membersSnap] = await Promise.all([
        db.collection("ally_groups").doc(primaryAllyGroupId).get(),
        db.collection("ally_group_members")
          .where("groupId", "==", primaryAllyGroupId)
          .where("status", "==", "active")
          .get(),
      ]);
      allyGroupName = String(groupSnap.data()?.name ?? primaryAllyGroupId);
      const memberIds = membersSnap.docs.map((d) => String(d.data().uid)).filter(Boolean);
      if (memberIds.length > 1) {
        const allyUsers = await Promise.all(
          memberIds.map(async (id) => {
            const snap = await db.collection("users").doc(id).get();
            return { uid: id, xp: Number(snap.data()?.xp ?? 0) };
          })
        );
        allyUsers.sort((a, b) => b.xp - a.xp);
        const allyIdx = allyUsers.findIndex((u) => u.uid === uid);
        if (allyIdx >= 0) {
          let rank = allyIdx + 1;
          for (let i = allyIdx - 1; i >= 0; i--) {
            if (allyUsers[i].xp === allyUsers[allyIdx].xp) rank = i + 1;
            else break;
          }
          allyRank = rank;
        }
        allyTotal = memberIds.length;
      }
    }

    return {
      ok: true,
      globalRank,
      globalTotal,
      hasFriends,
      friendsRank,
      friendsTotal,
      allyGroupName,
      allyRank,
      allyTotal,
      xp,
      captureCount,
    };
  } catch (error) {
    logger.error("getMyRankSummary crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error instanceof Error ? error.message : "Unknown error");
  }
});