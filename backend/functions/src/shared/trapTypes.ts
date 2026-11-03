import { HttpsError } from "firebase-functions/v2/https";
import { cachedDocData } from "./cache";

export type TrapEffectKind =
  | "laughter"
  | "timeout"
  | "warning"
  | "slowdown"
  | "penalty";

export type TrapAgeGroup = "minor" | "adult";

export interface TrapDefinition {
  id: string;
  name: string;
  /** Per-locale name overrides: { "en": "Prank Trap", "hu": "Tréfa Csapda", ... } */
  names?: Record<string, string>;
  /** Per-locale description overrides */
  descriptions?: Record<string, string>;
  iconKey: string;
  soundKey?: string;
  emoji?: string;
  imageUrl?: string;
  enabled: boolean;
  radiusMeters: number;
  /** Max distance from trap centre within which reveal/disarm is allowed. Must be > radiusMeters. */
  disarmRadiusMeters: number;
  /** Consecutive seconds the player may be out of disarm range before the session is cancelled. */
  disarmLeaveSeconds: number;
  /** Consecutive seconds the player may be out of placement range before the session is cancelled. */
  placementLeaveSeconds: number;
  placementHoldSeconds: number;
  revealHoldSeconds: number;
  disarmHoldSeconds: number;
  effectKind: TrapEffectKind;
  effectValue: number;
  ownerCanTrigger: boolean;
  visibility: "owner-only" | "public-after-reveal";
  refillHours?: number;
  expiryHours?: number;
  maxBagSlots?: number;
  weight?: number;
  allowedAgeGroups?: TrapAgeGroup[];
}

const ALLOWED_EFFECT_KINDS: TrapEffectKind[] = [
  "laughter",
  "timeout",
  "warning",
  "slowdown",
  "penalty",
];

const ALLOWED_AGE_GROUPS: TrapAgeGroup[] = ["minor", "adult"];

function normalizeAllowedAgeGroups(value: unknown): TrapAgeGroup[] {
  if (!Array.isArray(value)) {
    return ["minor", "adult"];
  }

  const items = value.filter(
    (x): x is TrapAgeGroup =>
      typeof x === "string" &&
      ALLOWED_AGE_GROUPS.includes(x as TrapAgeGroup)
  );

  if (items.length === 0) {
    return ["minor", "adult"];
  }

  return Array.from(new Set(items));
}

export function assertTrapDefinitionShape(
  id: string,
  data: FirebaseFirestore.DocumentData | undefined
): TrapDefinition {
  if (!data) {
    throw new HttpsError("not-found", `Trap definition ${id} not found.`);
  }

  const effectKind =
    typeof data.effectKind === "string" &&
    ALLOWED_EFFECT_KINDS.includes(data.effectKind as TrapEffectKind)
      ? (data.effectKind as TrapEffectKind)
      : "warning";

  const toLocaleMap = (v: unknown): Record<string, string> | undefined => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
    const result: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof k === "string" && typeof val === "string") result[k] = val;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  };

  return {
    id,
    name:         typeof data.name     === "string" ? data.name     : id,
    names:        toLocaleMap(data.names),
    descriptions: toLocaleMap(data.descriptions),
    iconKey:  typeof data.iconKey  === "string" ? data.iconKey  : "trap_default",
    soundKey: typeof data.soundKey === "string" ? data.soundKey : undefined,
    emoji:    typeof data.emoji    === "string" ? data.emoji    : undefined,
    imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : undefined,
    enabled: data.enabled !== false,
    ...((): { radiusMeters: number; disarmRadiusMeters: number } => {
      const r = typeof data.radiusMeters === "number" && data.radiusMeters > 0
        ? data.radiusMeters : 25;
      const dr = typeof data.disarmRadiusMeters === "number" && data.disarmRadiusMeters > r
        ? data.disarmRadiusMeters : r + 1;
      return { radiusMeters: r, disarmRadiusMeters: dr };
    })(),
    disarmLeaveSeconds:
      typeof data.disarmLeaveSeconds === "number" && data.disarmLeaveSeconds >= 1
        ? Math.round(data.disarmLeaveSeconds) : 15,
    placementLeaveSeconds:
      typeof data.placementLeaveSeconds === "number" && data.placementLeaveSeconds >= 1
        ? Math.round(data.placementLeaveSeconds) : 15,
    placementHoldSeconds:
      typeof data.placementHoldSeconds === "number" && data.placementHoldSeconds > 0
        ? data.placementHoldSeconds
        : 300,
    revealHoldSeconds:
      typeof data.revealHoldSeconds === "number" && data.revealHoldSeconds > 0
        ? data.revealHoldSeconds
        : 2,
    disarmHoldSeconds:
      typeof data.disarmHoldSeconds === "number" && data.disarmHoldSeconds > 0
        ? data.disarmHoldSeconds
        : 240,
    effectKind,
    effectValue:
      typeof data.effectValue === "number" && data.effectValue >= 0
        ? data.effectValue
        : 1,
    ownerCanTrigger:
      typeof data.ownerCanTrigger === "boolean" ? data.ownerCanTrigger : true,
    visibility:
      data.visibility === "public-after-reveal"
        ? "public-after-reveal"
        : "owner-only",
    refillHours:
      typeof data.refillHours === "number" && data.refillHours > 0
        ? data.refillHours
        : 24,
    expiryHours:
      typeof data.expiryHours === "number" && data.expiryHours > 0
        ? data.expiryHours
        : 48,
    maxBagSlots:
      typeof data.maxBagSlots === "number" && data.maxBagSlots >= 0
        ? data.maxBagSlots
        : 2,
    weight:
      typeof data.weight === "number" && data.weight > 0
        ? data.weight
        : 1,
    allowedAgeGroups: normalizeAllowedAgeGroups(data.allowedAgeGroups),
  };
}

export async function getTrapDefinition(trapTypeId: string): Promise<TrapDefinition> {
  const def = assertTrapDefinitionShape(trapTypeId, await cachedDocData("trap_definitions", trapTypeId));

  if (!def.enabled) {
    throw new HttpsError(
      "failed-precondition",
      `Trap type ${trapTypeId} is disabled.`
    );
  }

  return def;
}