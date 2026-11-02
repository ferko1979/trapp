import { HttpsError } from "firebase-functions/v2/https";

export function assertFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpsError("invalid-argument", `${name} must be a finite number.`);
  }
  return value;
}

export function assertLatLng(lat: unknown, lng: unknown) {
  const parsedLat = assertFiniteNumber(lat, "lat");
  const parsedLng = assertFiniteNumber(lng, "lng");

  if (parsedLat < -90 || parsedLat > 90) {
    throw new HttpsError("invalid-argument", "lat must be between -90 and 90.");
  }
  if (parsedLng < -180 || parsedLng > 180) {
    throw new HttpsError("invalid-argument", "lng must be between -180 and 180.");
  }

  return { lat: parsedLat, lng: parsedLng };
}

export function normalizeOptionalTrimmedString(
  value: unknown,
  maxLen = 120
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}
