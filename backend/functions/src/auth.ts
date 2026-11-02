import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { FieldValue } from "firebase-admin/firestore";
import { getDatePartsForTimezone, normalizeTimeZone } from "./shared/dates";
import { getDb } from "./shared/firebase";
import { refillUserInventoryToMaximum } from "./shared/inventory";
import { ensureDailyState, ensureUserDoc } from "./shared/user";
import { requireAppCheck } from "./shared/appCheck";
import { requireAdmin } from "./shared/admin";
import { writeAuditLog } from "./adminAuditLog";

type AgeGroup = "minor" | "adult";
type Gender = "male" | "female" | "other" | "prefer_not_to_say";

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
  const raw = asString(value).trim();

  if (!raw) {
    throw new HttpsError("invalid-argument", "birthDate is required.");
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
      throw new HttpsError("invalid-argument", "Invalid birthDate.");
    }
    return raw;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpsError(
      "invalid-argument",
      "birthDate must be a valid date. Preferred format: YYYY-MM-DD."
    );
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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

export const debugAuth = onCall(async (request) => {
  requireAdmin(request);
  return {
    ok: true,
    hasAuth: !!request.auth,
    uid: request.auth?.uid ?? null,
    tokenEmail:
      typeof request.auth?.token?.email === "string"
        ? request.auth.token.email
        : null,
    tokenPhone:
      typeof request.auth?.token?.phone_number === "string"
        ? request.auth.token.phone_number
        : null,
    tokenAdmin: request.auth?.token?.admin === true,
    data: request.data ?? null,
  };
});

export const checkUsernameAvailability = onCall(async (request) => {
  try {
    const data = (request.data ?? {}) as Record<string, unknown>;
    const username = normalizeUsername(data.username);

    if (!username) {
      throw new HttpsError("invalid-argument", "username is required.");
    }

    validateUsername(username);

    const usernameLower = usernameToLower(username);
    const db = getDb();
    const snap = await db.collection("usernames").doc(usernameLower).get();

    return {
      ok: true,
      username,
      usernameLower,
      available: !snap.exists,
    };
  } catch (error) {
    logger.error("checkUsernameAvailability crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown internal error"
    );
  }
});

// Called by the app immediately after sendEmailVerification() succeeds.
// Records the timestamp and client IP so the admin panel shows "Triggered at".
export const recordVerificationSent = onCall(async (request) => {
  try {
    requireAppCheck(request);
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const rawRequest = (
      request as { rawRequest?: { ip?: unknown; headers?: Record<string, unknown> } }
    ).rawRequest;
    const fwd = rawRequest?.headers?.["x-forwarded-for"];
    const ip: string | null =
      typeof fwd === "string" && fwd.trim()
        ? fwd.split(",")[0].trim()
        : typeof rawRequest?.ip === "string" && rawRequest.ip.trim()
          ? rawRequest.ip.trim()
          : null;

    const now = Date.now();
    const db = getDb();
    await db.collection("users").doc(uid).set(
      {
        verificationTriggeredAtEpochMs: now,
        verificationTriggeredIp: ip,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true, verificationTriggeredAtEpochMs: now };
  } catch (error) {
    logger.error("recordVerificationSent crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown internal error"
    );
  }
});

// Called by the app on startup whenever the user's token shows emailVerified=true.
// Records the verification timestamp in Firestore the first time it is detected,
// then writes an audit log entry. Safe to call repeatedly — no-ops if already set.
export const syncMyEmailVerification = onCall(async (request) => {
  try {
    requireAppCheck(request);
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const tokenVerified = request.auth?.token?.email_verified === true;
    if (!tokenVerified) {
      return { ok: true, verified: false, recorded: false };
    }

    const email =
      typeof request.auth?.token?.email === "string"
        ? request.auth.token.email
        : null;

    const db = getDb();
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.data() ?? {};

    if (typeof userData.emailVerifiedAtEpochMs === "number") {
      return { ok: true, verified: true, recorded: false };
    }

    const now = Date.now();
    await userRef.set(
      {
        emailVerified: true,
        emailVerifiedAtEpochMs: now,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    void writeAuditLog({
      adminUid: "SYSTEM",
      adminEmail: null,
      adminName: "System",
      category: "users",
      action: "EMAIL_VERIFIED",
      targetId: uid,
      targetName: email,
      summary: `User verified their email address${email ? ` (${email})` : ""}`,
      details: { emailVerifiedAtEpochMs: now, uid },
    });

    return { ok: true, verified: true, recorded: true };
  } catch (error) {
    logger.error("syncMyEmailVerification crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown internal error"
    );
  }
});

export const bootstrapProfile = onCall(async (request) => {
  try {
    requireAppCheck(request);
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const data = (request.data ?? {}) as Record<string, unknown>;
    const platform = typeof data.platform === "string" ? data.platform : "unknown";
    const requestedTimeZone = normalizeTimeZone(data.timeZone, "Europe/Budapest");

    const username = normalizeUsername(data.username);
    const usernameLower = usernameToLower(username);
    const displayNameInput = asString(data.displayName).trim();
    const firstName = asString(data.firstName).trim();
    const lastName = asString(data.lastName).trim();
    const acceptedTerms = data.acceptedTerms === true;
    const acceptedTermsVersion = asString(data.acceptedTermsVersion, "v1").trim() || "v1";

    if (!username) {
      throw new HttpsError("invalid-argument", "username is required.");
    }

    validateUsername(username);

    if (!acceptedTerms) {
      throw new HttpsError("invalid-argument", "acceptedTerms must be true.");
    }

    const birthProfile = getBirthProfile({
      birthDate: data.birthDate,
      gender: data.gender,
    });

    await ensureUserDoc(
      uid,
      typeof request.auth?.token?.phone_number === "string"
        ? request.auth.token.phone_number
        : null,
      typeof request.auth?.token?.email === "string"
        ? request.auth.token.email
        : null,
      typeof request.auth?.token?.name === "string"
        ? request.auth.token.name
        : null,
      platform,
      requestedTimeZone
    );

    const db = getDb();
    const userRef = db.collection("users").doc(uid);
    const usernameRef = db.collection("usernames").doc(usernameLower);

    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const usernameSnap = await tx.get(usernameRef);

      if (usernameSnap.exists) {
        const ownerUid = asString(usernameSnap.data()?.uid);
        if (ownerUid && ownerUid !== uid) {
          throw new HttpsError("already-exists", "Username is already taken.");
        }
      }

      const existing = userSnap.data() ?? {};
      const tokenEmail =
        typeof request.auth?.token?.email === "string"
          ? request.auth.token.email
          : null;

      const resolvedDisplayName =
        displayNameInput ||
        firstName ||
        asString(existing.displayName) ||
        username ||
        tokenEmail ||
        "Anonymous";

      tx.set(
        usernameRef,
        {
          uid,
          username,
          usernameLower,
          createdAt: usernameSnap.exists
            ? usernameSnap.data()?.createdAt ?? FieldValue.serverTimestamp()
            : FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(
        userRef,
        {
          email: tokenEmail,
          phoneNumber:
            typeof request.auth?.token?.phone_number === "string"
              ? request.auth.token.phone_number
              : null,
          username,
          usernameLower,
          displayName: resolvedDisplayName,
          firstName: firstName || null,
          lastName: lastName || null,

          role: asString(existing.role, "user") || "user",
          status: asString(existing.status, "active") || "active",
          levelId: asString(existing.levelId, "free") || "free",
          membership:
            asString(existing.levelId, "free") === "free" ? "free" : "paid",
          membershipStatus: asString(existing.membershipStatus, "active") || "active",

          relationships: existing.relationships ?? {},
          captureCount:
            typeof existing.captureCount === "number" ? existing.captureCount : 0,
          timesCaught:
            typeof existing.timesCaught === "number" ? existing.timesCaught : 0,
          photoUrl: existing.photoUrl ?? null,
          activePenalty: existing.activePenalty ?? null,

          timeZone: requestedTimeZone,
          platforms: Array.isArray(existing.platforms)
            ? Array.from(new Set([...existing.platforms, platform]))
            : [platform],

          acceptedTerms: true,
          acceptedTermsVersion,
          acceptedTermsAtEpochMs:
            typeof existing.acceptedTermsAtEpochMs === "number"
              ? existing.acceptedTermsAtEpochMs
              : Date.now(),

          emailVerified: request.auth?.token?.email_verified === true,
          emailVerifiedAtEpochMs:
            request.auth?.token?.email_verified === true
              ? typeof existing.emailVerifiedAtEpochMs === "number"
                ? existing.emailVerifiedAtEpochMs
                : Date.now()
              : existing.emailVerifiedAtEpochMs ?? null,

          ...birthProfile,

          createdAt: existing.createdAt ?? FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          lastSeenAt: FieldValue.serverTimestamp(),
          registrationCompletedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    const { dateKey } = getDatePartsForTimezone(requestedTimeZone);

    await db.runTransaction(async (tx) => {
      await ensureDailyState(tx, uid, dateKey, requestedTimeZone);
    });

    const refillResult = await refillUserInventoryToMaximum(uid);

    const userSnap = await db.collection("users").doc(uid).get();
    const dailySnap = await db.collection("daily_state").doc(`${uid}_${dateKey}`).get();
    const inventorySnap = await db
      .collection("user_trap_inventory")
      .where("uid", "==", uid)
      .get();

    return {
      ok: true,
      uid,
      dateKey,
      awardedImmediately: true,
      bagSize: refillResult.bagSize,
      dailyTrapAllowance: refillResult.dailyTrapAllowance,
      profile: userSnap.data() ?? null,
      dailyState: dailySnap.data() ?? null,
      bag: inventorySnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
    };
  } catch (error) {
    logger.error("bootstrapProfile crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown internal error"
    );
  }
});