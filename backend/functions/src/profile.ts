import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { normalizeTimeZone } from "./shared/dates";
import { getDb } from "./shared/firebase";
import { normalizeRelationship } from "./shared/relationships";
import { normalizeOptionalTrimmedString } from "./shared/validators";
import { requireAppCheck } from "./shared/appCheck";

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

export const updateProfile = onCall(async (request) => {
  try {
    requireAppCheck(request);
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Authentication required.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const firstName = normalizeOptionalTrimmedString(data.firstName, 60);
    const lastName = normalizeOptionalTrimmedString(data.lastName, 60);
    const displayName = normalizeOptionalTrimmedString(data.displayName, 120);
    const photoUrl = normalizeOptionalTrimmedString(data.photoUrl, 500);
    const timeZone = normalizeTimeZone(data.timeZone, "Europe/Budapest");

    const db = getDb();
    const userRef = db.collection("users").doc(uid);
    const currentSnap = await userRef.get();
    const current = currentSnap.data() ?? {};

    const birthProfile = getBirthProfile({
      birthDate: "birthDate" in data ? data.birthDate : current.birthDate,
      gender: "gender" in data ? data.gender : current.gender,
    });

    await userRef.set(
      {
        firstName,
        lastName,
        displayName,
        photoUrl,
        timeZone,
        membership: "free",
        lastSeenAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...birthProfile,
      },
      { merge: true }
    );

    return { ok: true };
  } catch (error) {
    logger.error("updateProfile crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error instanceof Error ? error.message : "Unknown error");
  }
});

export const setRelationship = onCall(async (request) => {
  try {
    requireAppCheck(request);
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Authentication required.");

    const data = (request.data ?? {}) as Record<string, unknown>;
    const otherUid =
      typeof data.otherUid === "string" ? data.otherUid.trim() : "";

    if (!otherUid) {
      throw new HttpsError("invalid-argument", "otherUid is required.");
    }
    if (otherUid === uid) {
      throw new HttpsError("invalid-argument", "Cannot set relationship to self.");
    }

    const relationship = normalizeRelationship(data.relationship);

    await getDb().collection("users").doc(uid).update({
      [`relationships.${otherUid}`]: relationship,
      lastSeenAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, otherUid, relationship };
  } catch (error) {
    logger.error("setRelationship crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error instanceof Error ? error.message : "Unknown error");
  }
});