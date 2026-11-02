import { HttpsError, onCall } from "firebase-functions/v2/https";
import { distanceBetween, geohashQueryBounds } from "geofire-common";
import { QueryDocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import { getDb } from "./shared/firebase";
import { requireUser as requireAuthUid } from "./shared/appCheck";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

// Privacy: strangers only see a ~110 m grid cell and a distance rounded to 50 m,
// players who haven't moved for 30 minutes drop off the list, and anyone can
// hide from strangers with users/{uid}.hideFromNearby. Friends see exact data.
const STALE_LOCATION_MS = 30 * 60 * 1000;
const COARSE_DECIMALS = 3;
const COARSE_DISTANCE_STEP = 50;

function coarse(value: number): number {
  const f = 10 ** COARSE_DECIMALS;
  return Math.round(value * f) / f;
}

function metersBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  return distanceBetween([aLat, aLng], [bLat, bLng]) * 1000;
}

async function getPlayerLocation(uid: string) {
  const db = getDb();
  const snap = await db.collection("player_locations").doc(uid).get();
  const data = snap.data();

  if (
    !data ||
    typeof data.lat !== "number" ||
    typeof data.lng !== "number" ||
    !Number.isFinite(data.lat) ||
    !Number.isFinite(data.lng)
  ) {
    throw new HttpsError("failed-precondition", "Player location not available.");
  }

  return {
    lat: data.lat as number,
    lng: data.lng as number,
  };
}

async function getAcceptedFriendIds(uid: string): Promise<Set<string>> {
  const db = getDb();

  const [aSnap, bSnap] = await Promise.all([
    db
      .collection("friend_links")
      .where("userA", "==", uid)
      .where("status", "==", "accepted")
      .get(),
    db
      .collection("friend_links")
      .where("userB", "==", uid)
      .where("status", "==", "accepted")
      .get(),
  ]);

  const ids = new Set<string>();

  aSnap.docs.forEach((doc) => {
    const data = doc.data() ?? {};
    const friendUid = asString(data.userB);
    if (friendUid) ids.add(friendUid);
  });

  bSnap.docs.forEach((doc) => {
    const data = doc.data() ?? {};
    const friendUid = asString(data.userA);
    if (friendUid) ids.add(friendUid);
  });

  return ids;
}

export const listNearbyUsers = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;

    const radiusMetersRaw = asNumber(data.radiusMeters, 1000);
    const radiusMeters = Math.min(Math.max(radiusMetersRaw, 50), 10000);

    const limitRaw = asNumber(data.limit, 25);
    const limit = Math.min(Math.max(Math.floor(limitRaw), 1), 100);

    const friendsOnly = asBoolean(data.friendsOnly, false);
    const search = asString(data.search).trim().toLowerCase();

    const db = getDb();
    const myLoc = await getPlayerLocation(uid);

    const friendIds = await getAcceptedFriendIds(uid);
    const freshAfter = Date.now() - STALE_LOCATION_MS;

    const bounds = geohashQueryBounds([myLoc.lat, myLoc.lng], radiusMeters);

    const candidateSnaps = await Promise.all(
      bounds.map(([start, end]) =>
        db
          .collection("player_locations")
          .orderBy("geohash")
          .startAt(start)
          .endAt(end)
          .get()
      )
    );

    const candidates = new Map<string, QueryDocumentSnapshot>();

    for (const snap of candidateSnaps) {
      for (const doc of snap.docs) {
        if (!candidates.has(doc.id)) {
          candidates.set(doc.id, doc);
        }
      }
    }

    const nearby: Array<{
      uid: string;
      lat: number;
      lng: number;
      distanceMeters: number;
    }> = [];

    for (const [otherUid, doc] of candidates) {
      if (otherUid === uid) continue;
      if (friendsOnly && !friendIds.has(otherUid)) continue;

      const loc = doc.data() ?? {};
      const updatedAt = loc.updatedAt instanceof Timestamp ? loc.updatedAt.toMillis() : 0;
      if (updatedAt < freshAfter) continue;

      const lat = asNumber(loc.lat, NaN);
      const lng = asNumber(loc.lng, NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const distanceMeters = metersBetween(myLoc.lat, myLoc.lng, lat, lng);
      if (distanceMeters > radiusMeters) continue;

      nearby.push({
        uid: otherUid,
        lat,
        lng,
        distanceMeters: Math.round(distanceMeters),
      });
    }

    nearby.sort((a, b) => a.distanceMeters - b.distanceMeters);

    // Over-fetch a little: hidden/inactive users are filtered after the profile read.
    const trimmed = nearby.slice(0, limit * 2);
    const userSnaps = await Promise.all(
      trimmed.map((item) => db.collection("users").doc(item.uid).get())
    );

    const items = trimmed
      .map((item, index) => {
        const userData = userSnaps[index].data() ?? {};
        const isFriend = friendIds.has(item.uid);
        const username = asString(userData.username);
        const displayName = asString(userData.displayName, "Anonymous");
        const firstName = asString(userData.firstName);
        const lastName = asString(userData.lastName);
        const role = asString(userData.role, "user");
        const status = asString(userData.status, "active");
        if (status !== "active") return null;
        if (!isFriend && userData.hideFromNearby === true) return null;
        const photoUrl = asString(userData.photoUrl);
        const primaryAllyGroupId = asString(userData.primaryAllyGroupId);

        const haystack = [
          username,
          displayName,
          isFriend ? firstName : "",
          isFriend ? lastName : "",
        ]
          .join(" ")
          .toLowerCase();

        if (search && !haystack.includes(search)) {
          return null;
        }

        return {
          uid: item.uid,
          username: username || null,
          displayName: displayName || "Anonymous",
          firstName: isFriend ? firstName || null : null,
          lastName: isFriend ? lastName || null : null,
          role,
          status,
          photoUrl: photoUrl || null,
          primaryAllyGroupId: primaryAllyGroupId || null,
          lat: isFriend ? item.lat : coarse(item.lat),
          lng: isFriend ? item.lng : coarse(item.lng),
          distanceMeters: isFriend
            ? item.distanceMeters
            : Math.max(COARSE_DISTANCE_STEP,
                Math.round(item.distanceMeters / COARSE_DISTANCE_STEP) * COARSE_DISTANCE_STEP),
          isFriend,
        };
      })
      .filter(Boolean)
      .slice(0, limit);

    return {
      ok: true,
      center: {
        lat: myLoc.lat,
        lng: myLoc.lng,
      },
      radiusMeters,
      friendsOnly,
      count: items.length,
      items,
    };
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});