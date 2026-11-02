import { getAdminAuth } from "./shared/firebase";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { refillUserInventoryToMaximum } from "./shared/inventory";
import { getUserTimeZone } from "./shared/user";
import { getDatePartsForTimezone } from "./shared/dates";
import { logger } from "firebase-functions";
import { getAuth } from "firebase-admin/auth";
import { writeAuditLog } from "./adminAuditLog";


type UserStatus = "active" | "inactive" | "suspended";
type UserRole = "user" | "admin";
type AgeGroup = "minor" | "adult";
type Gender = "male" | "female" | "other" | "prefer_not_to_say";

const ALLOWED_STATUSES: UserStatus[] = ["active", "inactive", "suspended"];
const ALLOWED_PAGE_SIZES = [25, 50, 100, 250, 500];

function getTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidStatus(value: string): value is UserStatus {
  return ALLOWED_STATUSES.includes(value as UserStatus);
}

function isValidRole(value: string): value is UserRole {
  return value === "user" || value === "admin";
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeGender(value: unknown): Gender {
  const v = asString(value).trim().toLowerCase();
  if (v === "male") return "male";
  if (v === "female") return "female";
  if (v === "other") return "other";
  if (v === "prefer_not_to_say") return "prefer_not_to_say";
  return "prefer_not_to_say";
}

function normalizeUsername(value: unknown): string {
  return asString(value).trim();
}

function usernameToLower(username: string): string {
  return username.trim().toLowerCase();
}

function validateUsername(username: string) {
  if (!/^[a-zA-Z0-9._-]{3,24}$/.test(username)) {
    throw new HttpsError(
      "invalid-argument",
      "Username must be 3-24 chars and use letters, numbers, dot, underscore, or dash."
    );
  }
}

function parseBirthDate(value: unknown): string {
  const birthDate = asString(value).trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    throw new HttpsError(
      "invalid-argument",
      "birthDate must be in YYYY-MM-DD format."
    );
  }

  const date = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpsError("invalid-argument", "Invalid birthDate.");
  }

  return birthDate;
}

function getAgeFromBirthDate(birthDate: string, now = new Date()): number {
  const [year, month, day] = birthDate.split("-").map(Number);
  let age = now.getUTCFullYear() - year;

  const currentMonth = now.getUTCMonth() + 1;
  const currentDay = now.getUTCDate();

  if (currentMonth < month || (currentMonth === month && currentDay < day)) {
    age -= 1;
  }

  return age;
}

function getAgeGroupFromAge(age: number): AgeGroup {
  return age >= 18 ? "adult" : "minor";
}

function getBirthProfile(input: { birthDate: unknown; gender: unknown }) {
  const birthDate = parseBirthDate(input.birthDate);
  const age = getAgeFromBirthDate(birthDate);

  if (age < 0 || age > 120) {
    throw new HttpsError("invalid-argument", "Invalid age derived from birthDate.");
  }

  return {
    birthDate,
    age,
    ageGroup: getAgeGroupFromAge(age),
    gender: normalizeGender(input.gender),
  };
}

function getRequestIp(request: unknown): string | null {
  const rawRequest = (
    request as {
      rawRequest?: { ip?: unknown; headers?: Record<string, unknown> };
    }
  )?.rawRequest;

  const forwardedFor = rawRequest?.headers?.["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  const ip = rawRequest?.ip;
  return typeof ip === "string" && ip.trim() ? ip.trim() : null;
}

type TrapCountsByType = Record<string, number>;

async function ensureUsernameAvailable(
  usernameLower: string,
  ignoreUid?: string
) {
  const db = getDb();
  const usernameDoc = await db.collection("usernames").doc(usernameLower).get();

  if (!usernameDoc.exists) return;

  const currentUid = asString(usernameDoc.data()?.uid);
  if (ignoreUid && currentUid === ignoreUid) return;

  throw new HttpsError("already-exists", "Username is already taken.");
}

async function reserveUsername(params: {
  uid: string;
  username: string;
  usernameLower: string;
}) {
  const db = getDb();
  const { uid, username, usernameLower } = params;

  await db.collection("usernames").doc(usernameLower).set({
    uid,
    username,
    usernameLower,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function getGlobalRankMap() {
  const db = getDb();
  const snap = await db
    .collection("users")
    .orderBy("captureCount", "desc")
    .orderBy("displayName", "asc")
    .limit(5000)
    .get();

  const rankMap = new Map<string, number>();
  snap.docs.forEach((doc, index) => {
    rankMap.set(doc.id, index + 1);
  });
  return rankMap;
}

async function getAcceptedFriendIds(uid: string): Promise<string[]> {
  const db = getDb();

  const aSnap = await db
    .collection("friend_links")
    .where("userA", "==", uid)
    .where("status", "==", "accepted")
    .get();

  const bSnap = await db
    .collection("friend_links")
    .where("userB", "==", uid)
    .where("status", "==", "accepted")
    .get();

  const ids = new Set<string>();
  aSnap.docs.forEach((doc) => ids.add(asString(doc.data().userB)));
  bSnap.docs.forEach((doc) => ids.add(asString(doc.data().userA)));

  return Array.from(ids).filter(Boolean);
}

async function getFriendsRank(uid: string): Promise<number | null> {
  const db = getDb();
  const friendIds = await getAcceptedFriendIds(uid);
  const relevantIds = Array.from(new Set([uid, ...friendIds]));

  if (relevantIds.length <= 1) {
    return null;
  }

  const users = await Promise.all(
    relevantIds.map(async (id) => {
      const snap = await db.collection("users").doc(id).get();
      const data = snap.data() ?? {};
      return {
        uid: id,
        captureCount: asNumber(data.captureCount),
        displayName: asString(data.displayName, "Anonymous"),
      };
    })
  );

  users.sort((a, b) => {
    if (b.captureCount !== a.captureCount) return b.captureCount - a.captureCount;
    return a.displayName.localeCompare(b.displayName);
  });

  const index = users.findIndex((u) => u.uid === uid);
  return index >= 0 ? index + 1 : null;
}

async function getAlliesRank(uid: string): Promise<number | null> {
  const db = getDb();
  const userSnap = await db.collection("users").doc(uid).get();
  const primaryAllyGroupId = asString(userSnap.data()?.primaryAllyGroupId);

  if (!primaryAllyGroupId) {
    return null;
  }

  const membersSnap = await db
    .collection("ally_group_members")
    .where("groupId", "==", primaryAllyGroupId)
    .where("status", "==", "active")
    .get();

  const memberIds = membersSnap.docs
    .map((doc) => asString(doc.data().uid))
    .filter(Boolean);

  if (memberIds.length <= 1) {
    return null;
  }

  const users = await Promise.all(
    memberIds.map(async (id) => {
      const snap = await db.collection("users").doc(id).get();
      const data = snap.data() ?? {};
      return {
        uid: id,
        captureCount: asNumber(data.captureCount),
        displayName: asString(data.displayName, "Anonymous"),
      };
    })
  );

  users.sort((a, b) => {
    if (b.captureCount !== a.captureCount) return b.captureCount - a.captureCount;
    return a.displayName.localeCompare(b.displayName);
  });

  const index = users.findIndex((u) => u.uid === uid);
  return index >= 0 ? index + 1 : null;
}

async function getUserTrapStats(uid: string) {
  const db = getDb();

  const allTrapsSnap = await db.collection("traps").where("ownerUid", "==", uid).get();

  let activeTrapCount = 0;
  let placedTrapCountTotal = 0;
  const placedTrapCountsByType: TrapCountsByType = {};

  allTrapsSnap.docs.forEach((doc) => {
    const data = doc.data();
    const trapTypeId = asString(data.trapTypeId, "unknown");
    const status = asString(data.status);

    placedTrapCountTotal += 1;
    placedTrapCountsByType[trapTypeId] =
      (placedTrapCountsByType[trapTypeId] ?? 0) + 1;

    if (status === "active") {
      activeTrapCount += 1;
    }
  });

  const inventorySnap = await db
    .collection("user_trap_inventory")
    .where("uid", "==", uid)
    .get();

  let bagSize = 0;
  let bagAvailableTotal = 0;
  const bagAvailableByType: TrapCountsByType = {};

  inventorySnap.docs.forEach((doc) => {
    const data = doc.data();
    const trapTypeId = asString(data.trapTypeId, "unknown");
    const bagCount = asNumber(data.bagCount);
    const maxBagSlots = asNumber(data.maxBagSlots);

    bagAvailableTotal += bagCount;
    bagSize += maxBagSlots;
    bagAvailableByType[trapTypeId] = bagCount;
  });

  return {
    activeTrapCount,
    placedTrapCountTotal,
    placedTrapCountsByType,
    bagSize,
    bagAvailableTotal,
    bagAvailableByType,
  };
}

export const adminListUsers = onCall(async (request) => {
  requireAdmin(request);

  const limitRaw = (request.data as Record<string, unknown> | undefined)?.limit;
  const limit =
    typeof limitRaw === "number" && limitRaw > 0 && limitRaw <= 200
      ? Math.floor(limitRaw)
      : 100;

  const snap = await getDb()
    .collection("users")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return {
    ok: true,
    users: snap.docs.map((doc) => ({
      uid: doc.id,
      ...doc.data(),
    })),
  };
});

export const adminSearchUsers = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;

  const pageRaw = data.page;
  const page =
    typeof pageRaw === "number" && Number.isFinite(pageRaw) && pageRaw > 0
      ? Math.floor(pageRaw)
      : 1;

  const pageSizeRaw = data.pageSize;
  const pageSizeCandidate =
    typeof pageSizeRaw === "number" && Number.isFinite(pageSizeRaw)
      ? Math.floor(pageSizeRaw)
      : 25;
  const pageSize = ALLOWED_PAGE_SIZES.includes(pageSizeCandidate)
    ? pageSizeCandidate
    : 25;

  const search = getTrimmedString(data.search).toLowerCase();
  const role = getTrimmedString(data.role);
  const status = getTrimmedString(data.status);
  const levelId = getTrimmedString(data.levelId);

  const snap = await getDb()
    .collection("users")
    .orderBy("createdAt", "desc")
    .limit(2000)
    .get();

  let users = snap.docs.map((doc) => ({
    uid: doc.id,
    ...doc.data(),
  }));

  if (search) {
    users = users.filter((user: any) => {
      const displayName = String(user.displayName ?? "").toLowerCase();
      const firstName = String(user.firstName ?? "").toLowerCase();
      const lastName = String(user.lastName ?? "").toLowerCase();
      const username = String(user.username ?? "").toLowerCase();
      const email = String(user.email ?? "").toLowerCase();

      return (
        displayName.includes(search) ||
        firstName.includes(search) ||
        lastName.includes(search) ||
        username.includes(search) ||
        email.includes(search)
      );
    });
  }

  if (role && isValidRole(role)) {
    users = users.filter((user: any) => String(user.role ?? "user") === role);
  }

  if (status && isValidStatus(status)) {
    users = users.filter((user: any) => String(user.status ?? "active") === status);
  }

  if (levelId) {
    users = users.filter((user: any) => String(user.levelId ?? "free") === levelId);
  }

  const total = users.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageItems = users.slice(start, start + pageSize);

  const globalRankMap = await getGlobalRankMap();

  const enrichedItems = await Promise.all(
    pageItems.map(async (user: any) => {
      const uid = String(user.uid);

      const trapStats = await getUserTrapStats(uid);
      const friendsRank = await getFriendsRank(uid);
      const alliesRank = await getAlliesRank(uid);

      return {
        ...user,
        globalRank: globalRankMap.get(uid) ?? null,
        friendsRank,
        alliesRank,
        activeTrapCount: trapStats.activeTrapCount,
        placedTrapCountTotal: trapStats.placedTrapCountTotal,
        placedTrapCountsByType: trapStats.placedTrapCountsByType,
        bagSize: trapStats.bagSize,
        bagAvailableTotal: trapStats.bagAvailableTotal,
        bagAvailableByType: trapStats.bagAvailableByType,
      };
    })
  );

  return {
    ok: true,
    items: enrichedItems,
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
});

export const adminCreateUser = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;

  const email = getTrimmedString(data.email);
  const username = normalizeUsername(data.username);
  const usernameLower = usernameToLower(username);
  const password = typeof data.password === "string" ? data.password : "";
  const displayName = getTrimmedString(data.displayName);
  const firstName = getTrimmedString(data.firstName);
  const lastName = getTrimmedString(data.lastName);
  const levelId = getTrimmedString(data.levelId) || "free";
  const status = getTrimmedString(data.status) || "active";
  const role = getTrimmedString(data.role) || "user";

  const acceptedTerms = data.acceptedTerms === true;
  const acceptedTermsVersion = getTrimmedString(data.acceptedTermsVersion) || "v1";
  const sendVerificationEmail = data.sendVerificationEmail !== false;

  const birthProfile = getBirthProfile({
    birthDate: data.birthDate,
    gender: data.gender,
  });

  if (!email) {
    throw new HttpsError("invalid-argument", "email is required.");
  }

  if (!username) {
    throw new HttpsError("invalid-argument", "username is required.");
  }

  validateUsername(username);

  if (!password || password.length < 6) {
    throw new HttpsError(
      "invalid-argument",
      "password must be at least 6 characters."
    );
  }

  if (!acceptedTerms) {
    throw new HttpsError("invalid-argument", "acceptedTerms must be true.");
  }

  if (!isValidStatus(status)) {
    throw new HttpsError(
      "invalid-argument",
      "status must be active, inactive, or suspended."
    );
  }

  if (!isValidRole(role)) {
    throw new HttpsError("invalid-argument", "role must be user or admin.");
  }

  await ensureUsernameAvailable(usernameLower);

  const auth = getAdminAuth();

  const userRecord = await auth.createUser({
    email,
    password,
    displayName: displayName || username || undefined,
    emailVerified: false,
  });

  if (role === "admin") {
    const existingClaims = userRecord.customClaims ?? {};
    await auth.setCustomUserClaims(userRecord.uid, {
      ...existingClaims,
      admin: true,
    });
  }

  let verificationLink: string | null = null;
  let verificationTriggeredAtEpochMs: number | null = null;

  if (sendVerificationEmail) {
    verificationLink = await auth.generateEmailVerificationLink(email);
    verificationTriggeredAtEpochMs = Date.now();
  }

  await reserveUsername({
    uid: userRecord.uid,
    username,
    usernameLower,
  });

  const verificationTriggeredIp = getRequestIp(request);

  await getDb()
    .collection("users")
    .doc(userRecord.uid)
    .set(
      {
        email,
        username,
        usernameLower,
        displayName: displayName || username || email,
        firstName: firstName || null,
        lastName: lastName || null,
        membership: levelId === "free" ? "free" : "paid",
        photoUrl: null,
        relationships: {},
        captureCount: 0,
        timesCaught: 0,
        timeZone: "Europe/Budapest",
        platforms: ["admin-created"],
        role,
        levelId,
        status,
        membershipStatus: "active",
        membershipStartAt: FieldValue.serverTimestamp(),
        membershipEndAt: null,
        activePenalty: null,

        acceptedTerms: true,
        acceptedTermsVersion,
        acceptedTermsAtEpochMs: Date.now(),

        emailVerified: false,
        emailVerifiedAtEpochMs: null,
        verificationTriggeredAtEpochMs,
        verificationTriggeredIp,
        verificationLinkGenerated: !!verificationLink,

        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),

        ...birthProfile,
      },
      { merge: true }
    );

  return {
    ok: true,
    uid: userRecord.uid,
    username,
    email,
    emailVerified: false,
    verificationTriggeredAtEpochMs,
    verificationTriggeredIp,
    verificationLink,
  };
});

export const adminResendVerificationEmail = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = getTrimmedString(data.uid);

  if (!uid) {
    throw new HttpsError("invalid-argument", "uid is required.");
  }

  const auth = getAdminAuth();
  const db = getDb();

  const userRecord = await auth.getUser(uid);

  if (!userRecord.email) {
    throw new HttpsError("failed-precondition", "User has no email address.");
  }

  if (userRecord.emailVerified) {
    await db.collection("users").doc(uid).set(
      {
        emailVerified: true,
        emailVerifiedAtEpochMs: Date.now(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      ok: true,
      uid,
      email: userRecord.email,
      alreadyVerified: true,
      emailVerified: true,
    };
  }

  const verificationLink = await auth.generateEmailVerificationLink(userRecord.email);
  const verificationTriggeredAtEpochMs = Date.now();
  const verificationTriggeredIp = getRequestIp(request);

  await db.collection("users").doc(uid).set(
    {
      emailVerified: false,
      verificationTriggeredAtEpochMs,
      verificationTriggeredIp,
      verificationLinkGenerated: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    ok: true,
    uid,
    email: userRecord.email,
    emailVerified: false,
    verificationTriggeredAtEpochMs,
    verificationTriggeredIp,
    verificationLink,
  };
});

export const adminSyncEmailVerificationStatus = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = getTrimmedString(data.uid);

  if (!uid) {
    throw new HttpsError("invalid-argument", "uid is required.");
  }

  const auth = getAdminAuth();
  const db = getDb();

  const userRecord = await auth.getUser(uid);
  const isVerified = userRecord.emailVerified === true;

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  const userData = userSnap.data() ?? {};

  const patch: Record<string, unknown> = {
    emailVerified: isVerified,
    updatedAt: FieldValue.serverTimestamp(),
  };

  const wasAlreadyRecorded = typeof userData.emailVerifiedAtEpochMs === "number";

  if (isVerified && !wasAlreadyRecorded) {
    patch.emailVerifiedAtEpochMs = Date.now();
  }

  await userRef.set(patch, { merge: true });

  const adminUid = request.auth?.uid ?? "unknown";
  const adminEmail =
    typeof request.auth?.token?.email === "string" ? request.auth.token.email : null;

  if (isVerified && !wasAlreadyRecorded) {
    void writeAuditLog({
      adminUid,
      adminEmail,
      adminName: null,
      category: "users",
      action: "EMAIL_VERIFIED_SYNCED",
      targetId: uid,
      targetName: userRecord.email ?? null,
      summary: `Admin synced email verification for ${userRecord.email ?? uid} — marked verified`,
      details: { emailVerifiedAtEpochMs: patch.emailVerifiedAtEpochMs as number },
    });
  }

  return {
    ok: true,
    uid,
    email: userRecord.email ?? null,
    emailVerified: isVerified,
    emailVerifiedAtEpochMs:
      isVerified
        ? wasAlreadyRecorded
          ? userData.emailVerifiedAtEpochMs
          : (patch.emailVerifiedAtEpochMs as number)
        : null,
  };
});

export const adminUpdateUsername = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = getTrimmedString(data.uid);
  const username = normalizeUsername(data.username);
  const usernameLower = usernameToLower(username);

  if (!uid) {
    throw new HttpsError("invalid-argument", "uid is required.");
  }

  if (!username) {
    throw new HttpsError("invalid-argument", "username is required.");
  }

  validateUsername(username);

  const db = getDb();
  const userRef = db.collection("users").doc(uid);

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const user = userSnap.data();

    if (!user) {
      throw new HttpsError("not-found", "User not found.");
    }

    const oldUsernameLower = asString(user.usernameLower);
    const oldUsername = asString(user.username);

    const newUsernameRef = db.collection("usernames").doc(usernameLower);
    const newUsernameSnap = await tx.get(newUsernameRef);

    if (newUsernameSnap.exists) {
      const ownerUid = asString(newUsernameSnap.data()?.uid);
      if (ownerUid !== uid) {
        throw new HttpsError("already-exists", "Username is already taken.");
      }
    }

    if (oldUsernameLower && oldUsernameLower !== usernameLower) {
      tx.delete(db.collection("usernames").doc(oldUsernameLower));
    }

    tx.set(
      newUsernameRef,
      {
        uid,
        username,
        usernameLower,
        createdAt: newUsernameSnap.exists
          ? newUsernameSnap.data()?.createdAt ?? FieldValue.serverTimestamp()
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
        usernameUpdatedByAdminAt: FieldValue.serverTimestamp(),
        previousUsername: oldUsername || null,
      },
      { merge: true }
    );
  });

  return {
    ok: true,
    uid,
    username,
    usernameLower,
  };
});
export const adminUpdateUserProfile = onCall(async (request) => {
  requireAdmin(request);

  try {
    const data = (request.data ?? {}) as Record<string, unknown>;
    const uid = getTrimmedString(data.uid);

    if (!uid) {
      throw new HttpsError("invalid-argument", "uid is required.");
    }

    const displayName = getTrimmedString(data.displayName);
    const firstName = getTrimmedString(data.firstName);
    const lastName = getTrimmedString(data.lastName);
    const role = getTrimmedString(data.role) || "user";
    const status = getTrimmedString(data.status) || "active";
    const levelId = getTrimmedString(data.levelId) || "free";

    const acceptedTerms =
      typeof data.acceptedTerms === "boolean" ? data.acceptedTerms : null;

    const acceptedTermsAtEpochMs =
      typeof data.acceptedTermsAtEpochMs === "number" &&
      Number.isFinite(data.acceptedTermsAtEpochMs)
        ? data.acceptedTermsAtEpochMs
        : null;

    const emailVerified =
      typeof data.emailVerified === "boolean" ? data.emailVerified : null;

    const emailVerifiedAtEpochMs =
      typeof data.emailVerifiedAtEpochMs === "number" &&
      Number.isFinite(data.emailVerifiedAtEpochMs)
        ? data.emailVerifiedAtEpochMs
        : null;

    if (!isValidRole(role)) {
      throw new HttpsError("invalid-argument", "role must be user or admin.");
    }

    if (!isValidStatus(status)) {
      throw new HttpsError(
        "invalid-argument",
        "status must be active, inactive, or suspended."
      );
    }

    const birthProfile = getBirthProfile({
      birthDate: data.birthDate,
      gender: data.gender,
    });

    const db = getDb();
    const auth = getAdminAuth();
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User not found.");
    }

    const currentUserData = userSnap.data() ?? {};
    const previousRole = asString(currentUserData.role, "user");
    const previousLevelId = asString(currentUserData.levelId, "free");

    const resolvedDisplayName =
      displayName ||
      firstName ||
      asString(currentUserData.username) ||
      asString(currentUserData.email) ||
      "Anonymous";

    const updatePayload: Record<string, unknown> = {
      displayName: resolvedDisplayName,
      firstName: firstName || null,
      lastName: lastName || null,
      role,
      status,
      levelId,
      membership: levelId === "free" ? "free" : "paid",
      updatedAt: FieldValue.serverTimestamp(),
      profileUpdatedByAdminAt: FieldValue.serverTimestamp(),
      profileUpdatedByUid: request.auth?.uid ?? null,
      birthDate: birthProfile.birthDate,
      age: birthProfile.age,
      ageGroup: birthProfile.ageGroup,
      gender: birthProfile.gender,
    };

    if (acceptedTerms !== null) {
      updatePayload.acceptedTerms = acceptedTerms;
      updatePayload.acceptedTermsAtEpochMs = acceptedTerms
        ? acceptedTermsAtEpochMs ?? Date.now()
        : null;
    }

    if (emailVerified !== null) {
      updatePayload.emailVerified = emailVerified;
      updatePayload.emailVerifiedAtEpochMs = emailVerified
        ? emailVerifiedAtEpochMs ?? Date.now()
        : null;
    }

    await userRef.set(updatePayload, { merge: true });

    const warnings: string[] = [];

    try {
      const authUpdate: {
        displayName?: string;
        emailVerified?: boolean;
      } = {
        displayName: resolvedDisplayName || undefined,
      };

      if (emailVerified !== null) {
        authUpdate.emailVerified = emailVerified;
      }

      await auth.updateUser(uid, authUpdate);
    } catch (error) {
      logger.error("adminUpdateUserProfile auth.updateUser failed", { uid, error });
      warnings.push(
        error instanceof Error
          ? `Auth profile sync failed: ${error.message}`
          : "Auth profile sync failed."
      );
    }

    try {
      const authUser = await auth.getUser(uid);
      const existingClaims = authUser.customClaims ?? {};
      const shouldBeAdmin = role === "admin";

      if ((existingClaims.admin === true) !== shouldBeAdmin || previousRole !== role) {
        await auth.setCustomUserClaims(uid, {
          ...existingClaims,
          admin: shouldBeAdmin,
        });
      }
    } catch (error) {
      logger.error("adminUpdateUserProfile custom claims sync failed", { uid, error });
      warnings.push(
        error instanceof Error
          ? `Admin claims sync failed: ${error.message}`
          : "Admin claims sync failed."
      );
    }

    let refillResult:
      | {
          bagSize: number;
          dailyTrapAllowance: number;
        }
      | null = null;

    if (previousLevelId !== levelId) {
      try {
        await db.collection("level_changes").add({
          uid,
          fromLevelId: previousLevelId,
          toLevelId: levelId,
          createdAt: FieldValue.serverTimestamp(),
          changedBy: request.auth?.uid ?? null,
          source: "adminUpdateUserProfile",
        });

        refillResult = await refillUserInventoryToMaximum(uid);
      } catch (error) {
        logger.error("adminUpdateUserProfile level/refill sync failed", { uid, error });
        warnings.push(
          error instanceof Error
            ? `Level refill sync failed: ${error.message}`
            : "Level refill sync failed."
        );
      }
    }

    const updatedSnap = await userRef.get();

    return {
      ok: true,
      uid,
      role,
      status,
      levelId,
      displayName: resolvedDisplayName,
      savedBirthProfile: birthProfile,
      profile: updatedSnap.data() ?? null,
      awardedImmediately: !!refillResult,
      bagSize: refillResult?.bagSize ?? null,
      dailyTrapAllowance: refillResult?.dailyTrapAllowance ?? null,
      warnings,
    };
  } catch (error) {
    logger.error("adminUpdateUserProfile crashed", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown internal error"
    );
  }
});
export const adminSetUserPassword = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = getTrimmedString(data.uid);
  const newPassword = getTrimmedString(data.newPassword);

  if (!uid) {
    throw new HttpsError("invalid-argument", "uid is required.");
  }

  if (!newPassword || newPassword.length < 6) {
    throw new HttpsError(
      "invalid-argument",
      "newPassword must be at least 6 characters."
    );
  }

  const auth = getAdminAuth();
  const db = getDb();

  await auth.updateUser(uid, {
    password: newPassword,
  });

  await db.collection("users").doc(uid).set(
    {
      passwordUpdatedByAdminAt: FieldValue.serverTimestamp(),
      passwordUpdatedByUid: request.auth?.uid ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    ok: true,
    uid,
    passwordUpdated: true,
  };
});

export const adminUpdateUserStatus = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = getTrimmedString(data.uid);
  const status = getTrimmedString(data.status);

  if (!uid) {
    throw new HttpsError("invalid-argument", "uid is required.");
  }

  if (!isValidStatus(status)) {
    throw new HttpsError(
      "invalid-argument",
      "status must be active, inactive, or suspended."
    );
  }

  await getDb()
    .collection("users")
    .doc(uid)
    .set(
      {
        status,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return { ok: true, uid, status };
});

export const adminSetUserLevel = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = getTrimmedString(data.uid);
  const levelId = getTrimmedString(data.levelId);

  if (!uid) {
    throw new HttpsError("invalid-argument", "uid is required.");
  }

  if (!levelId) {
    throw new HttpsError("invalid-argument", "levelId is required.");
  }

  const db = getDb();
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User not found.");
  }

  const currentLevelId = String(userSnap.data()?.levelId ?? "free");

  await userRef.set(
    {
      levelId,
      membership: levelId === "free" ? "free" : "paid",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await db.collection("level_changes").add({
    uid,
    fromLevelId: currentLevelId,
    toLevelId: levelId,
    createdAt: FieldValue.serverTimestamp(),
    changedBy: request.auth?.uid ?? null,
  });

  const refillResult = await refillUserInventoryToMaximum(uid);

  return {
    ok: true,
    uid,
    levelId,
    awardedImmediately: true,
    bagSize: refillResult.bagSize,
    dailyTrapAllowance: refillResult.dailyTrapAllowance,
  };
});

export const adminDeleteUser = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = getTrimmedString(data.uid);

  if (!uid) {
    throw new HttpsError("invalid-argument", "uid is required.");
  }

  await getDb()
    .collection("users")
    .doc(uid)
    .set(
      {
        status: "inactive",
        deletedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return { ok: true, uid, softDeleted: true };
});

export const adminResetUserTrapAvailability = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const uid = getTrimmedString(data.uid);

  if (!uid) {
    throw new HttpsError("invalid-argument", "uid is required.");
  }

  const refillResult = await refillUserInventoryToMaximum(uid);

  // Also reset today's daily placement quota so penalties/depletion are cleared
  const db = getDb();
  const timeZone = await getUserTimeZone(uid);
  const { dateKey } = getDatePartsForTimezone(timeZone);
  const dailyRef = db.collection("daily_state").doc(`${uid}_${dateKey}`);
  await dailyRef.set(
    {
      trapsAvailable: 5,
      trapsUsed:      0,
      lastUpdatedAt:  FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    ok: true,
    uid,
    reset: true,
    awardedImmediately: true,
    bagSize: refillResult.bagSize,
    dailyTrapAllowance: refillResult.dailyTrapAllowance,
    dailyQuotaReset: true,
  };
});


export const adminBackfillAuthUsersToFirestore = onCall(async (request) => {
  try {
    const caller = request.auth;
    if (!caller?.token?.admin) {
      throw new HttpsError("permission-denied", "Admin only");
    }

    const db = getDb();
    const auth = getAuth();

    let nextPageToken: string | undefined;
    let created = 0;
    let skipped = 0;

    do {
      const result = await auth.listUsers(1000, nextPageToken);

      for (const user of result.users) {
        const uid = user.uid;
        const userRef = db.collection("users").doc(uid);
        const snap = await userRef.get();

        if (snap.exists) {
          skipped++;
          continue;
        }

        await userRef.set({
          uid,
          email: user.email ?? null,
          displayName: user.displayName ?? user.email ?? "User",
          role: "user",
          status: "active",
          levelId: "free",

          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),

          // important defaults
          firstName: null,
          lastName: null,
          birthDate: null,
          age: null,
          ageGroup: null,
          gender: "prefer_not_to_say",

          acceptedTerms: false,
        });

        created++;
      }

      nextPageToken = result.pageToken;
    } while (nextPageToken);

    return {
      ok: true,
      created,
      skipped,
    };
  } catch (error) {
    console.error("adminBackfillAuthUsersToFirestore failed", error);

    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});