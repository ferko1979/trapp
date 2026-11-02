import { Timestamp } from "firebase-admin/firestore";

/* ------------------ BASIC CASTERS ------------------ */

export function asString(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}

export function asNullableString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

export function asNumber(v: unknown, d = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

export function asNullableNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function asBoolean(v: unknown, d = false): boolean {
  return typeof v === "boolean" ? v : d;
}

/* ------------------ TIMESTAMP ------------------ */

export function getTimestampMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();

  if (
    value &&
    typeof (value as { toMillis?: () => number }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }

  return null;
}

/* ------------------ SAFE OBJECT ------------------ */

export function asObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  return {};
}

/* ------------------ MAP HELPERS ------------------ */

export function numberMapIncrement(
  map: Record<string, number>,
  key: string,
  by = 1
) {
  map[key] = (map[key] ?? 0) + by;
}

/* ------------------ ARRAY HELPERS ------------------ */

export function safeArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}