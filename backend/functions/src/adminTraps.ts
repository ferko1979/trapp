import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { writeAuditLog } from "./adminAuditLog";

type TrapStatus = "active" | "captured" | "disarmed" | "blown" | "used" | "inactive";

const ALLOWED_STATUSES: TrapStatus[] = [
  "active",
  "captured",
  "disarmed",
  "blown",
  "used",
  "inactive",
];

function asTrimmedString(value: unknown, fieldName: string, required = false): string | null {
  if (typeof value !== "string") {
    if (required) {
      throw new HttpsError("invalid-argument", `${fieldName} is required.`);
    }
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    if (required) {
      throw new HttpsError("invalid-argument", `${fieldName} is required.`);
    }
    return null;
  }

  return trimmed;
}

function asOptionalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeVisibility(value: unknown): "owner-only" | "public-after-reveal" {
  return value === "public-after-reveal" ? "public-after-reveal" : "owner-only";
}

function normalizeStatus(value: unknown): TrapStatus {
  if (typeof value === "string" && ALLOWED_STATUSES.includes(value as TrapStatus)) {
    return value as TrapStatus;
  }
  throw new HttpsError("invalid-argument", "invalid trap status.");
}

export const adminListTrapDefinitions = onCall(async (request) => {
  requireAdmin(request);

  const snap = await getDb()
    .collection("trap_definitions")
    .orderBy("name", "asc")
    .get();

  return {
    ok: true,
    items: snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })),
  };
});

export const adminCreateTrapDefinition = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;

  const id = asTrimmedString(data.id, "id", true)!;
  const name = asTrimmedString(data.name, "name", true)!;

  const parseLocaleMap = (v: unknown): Record<string, string> | null => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const result: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof k === "string" && k.length === 2 && typeof val === "string" && val.trim()) {
        result[k] = val.trim();
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  };

  await getDb()
    .collection("trap_definitions")
    .doc(id)
    .set(
      {
        name,
        description: asTrimmedString(data.description, "description"),
        ...(parseLocaleMap(data.names) ? { names: parseLocaleMap(data.names) } : {}),
        ...(parseLocaleMap(data.descriptions) ? { descriptions: parseLocaleMap(data.descriptions) } : {}),
        iconKey: asTrimmedString(data.iconKey, "iconKey") ?? "trap_default",
        imageUrl: asOptionalUrl(data.imageUrl),

        soundOnPlacedUrl: asOptionalUrl(data.soundOnPlacedUrl),
        soundOnCapturedUrl: asOptionalUrl(data.soundOnCapturedUrl),
        soundOnBlownUrl: asOptionalUrl(data.soundOnBlownUrl),
        soundOnDisarmedUrl: asOptionalUrl(data.soundOnDisarmedUrl),

        enabled: asBoolean(data.enabled, true),

        radiusMeters: asNumber(data.radiusMeters, 25),
        // disarmRadiusMeters must be > radiusMeters; enforced here and in getTrapDefinition
        disarmRadiusMeters: (() => {
          const r = asNumber(data.radiusMeters, 25);
          const dr = asNumber(data.disarmRadiusMeters, r + 1);
          return dr > r ? dr : r + 1;
        })(),

        disarmLeaveSeconds: Math.max(1, Math.round(asNumber(data.disarmLeaveSeconds, 15))),
        placementLeaveSeconds: Math.max(1, Math.round(asNumber(data.placementLeaveSeconds, 15))),

        placementHoldSeconds: asNumber(data.placementHoldSeconds, 3),
        revealHoldSeconds: asNumber(data.revealHoldSeconds, 2),
        disarmHoldSeconds: asNumber(data.disarmHoldSeconds, 4),

        effectKind:
          typeof data.effectKind === "string" && data.effectKind.trim()
            ? data.effectKind.trim()
            : "warning",
        effectValue: asNumber(data.effectValue, 1),

        ownerCanTrigger: asBoolean(data.ownerCanTrigger, true),
        visibility: normalizeVisibility(data.visibility),

        refillHours: asNumber(data.refillHours, 24),
        maxBagSlots: asNumber(data.maxBagSlots, 2),

        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return { ok: true, id };
});

export const adminUpdateTrapDefinition = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const id = asTrimmedString(data.id, "id", true)!;

  const updatePayload: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if ("name" in data) updatePayload.name = asTrimmedString(data.name, "name");
  if ("description" in data) updatePayload.description = asTrimmedString(data.description, "description");
  if ("iconKey" in data) updatePayload.iconKey = asTrimmedString(data.iconKey, "iconKey") ?? "trap_default";
  if ("imageUrl" in data) updatePayload.imageUrl = asOptionalUrl(data.imageUrl);

  if ("soundOnPlacedUrl" in data) updatePayload.soundOnPlacedUrl = asOptionalUrl(data.soundOnPlacedUrl);
  if ("soundOnCapturedUrl" in data) updatePayload.soundOnCapturedUrl = asOptionalUrl(data.soundOnCapturedUrl);
  if ("soundOnBlownUrl" in data) updatePayload.soundOnBlownUrl = asOptionalUrl(data.soundOnBlownUrl);
  if ("soundOnDisarmedUrl" in data) updatePayload.soundOnDisarmedUrl = asOptionalUrl(data.soundOnDisarmedUrl);

  if ("enabled" in data) updatePayload.enabled = asBoolean(data.enabled, true);
  if ("radiusMeters" in data || "disarmRadiusMeters" in data) {
    const r = asNumber(data.radiusMeters, 25);
    if ("radiusMeters" in data) updatePayload.radiusMeters = r;
    if ("disarmRadiusMeters" in data) {
      const dr = asNumber(data.disarmRadiusMeters, r + 1);
      updatePayload.disarmRadiusMeters = dr > r ? dr : r + 1;
    }
  }
  if ("disarmLeaveSeconds" in data) {
    updatePayload.disarmLeaveSeconds = Math.max(1, Math.round(asNumber(data.disarmLeaveSeconds, 15)));
  }
  if ("placementLeaveSeconds" in data) {
    updatePayload.placementLeaveSeconds = Math.max(1, Math.round(asNumber(data.placementLeaveSeconds, 15)));
  }
  if ("placementHoldSeconds" in data) {
    updatePayload.placementHoldSeconds = asNumber(data.placementHoldSeconds, 3);
  }
  if ("revealHoldSeconds" in data) {
    updatePayload.revealHoldSeconds = asNumber(data.revealHoldSeconds, 2);
  }
  if ("disarmHoldSeconds" in data) {
    updatePayload.disarmHoldSeconds = asNumber(data.disarmHoldSeconds, 4);
  }
  if ("effectKind" in data) {
    updatePayload.effectKind =
      typeof data.effectKind === "string" && data.effectKind.trim()
        ? data.effectKind.trim()
        : "warning";
  }
  if ("effectValue" in data) updatePayload.effectValue = asNumber(data.effectValue, 1);
  if ("ownerCanTrigger" in data) {
    updatePayload.ownerCanTrigger = asBoolean(data.ownerCanTrigger, true);
  }
  if ("visibility" in data) {
    updatePayload.visibility = normalizeVisibility(data.visibility);
  }
  if ("refillHours" in data) updatePayload.refillHours = asNumber(data.refillHours, 24);
  if ("maxBagSlots" in data) updatePayload.maxBagSlots = asNumber(data.maxBagSlots, 2);

  const parseLocaleMapU = (v: unknown): Record<string, string> | null => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const result: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof k === "string" && k.length === 2 && typeof val === "string" && val.trim()) {
        result[k] = val.trim();
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  };
  if ("names" in data) {
    const m = parseLocaleMapU(data.names);
    updatePayload.names = m !== null ? m : FieldValue.delete();
  }
  if ("descriptions" in data) {
    const m = parseLocaleMapU(data.descriptions);
    updatePayload.descriptions = m !== null ? m : FieldValue.delete();
  }

  await getDb().collection("trap_definitions").doc(id).set(updatePayload, { merge: true });

  return { ok: true, id };
});

export const adminDeleteTrapDefinition = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const id = asTrimmedString(data.id, "id", true)!;

  await getDb().collection("trap_definitions").doc(id).delete();

  return { ok: true, id };
});

const AI_KEYS_DOC = ["admin_config", "ai_keys"] as const;
const DEFAULT_LOCALES = ["en", "hu", "de", "hr", "ro", "sk"];
const DEFAULT_LOCALE_NAMES: Record<string, string> = {
  en: "English",
  hu: "Magyar (Hungarian)",
  de: "Deutsch (German)",
  hr: "Hrvatski (Croatian)",
  ro: "Română (Romanian)",
  sk: "Slovenčina (Slovak)",
};

/**
 * Translate a trap name and description into all supported locales using Claude.
 * Returns { ok, names: Record<locale, string>, descriptions: Record<locale, string> }.
 */
export const adminTranslateTrapTexts = onCall(
  { timeoutSeconds: 120 },
  async (request) => {
    requireAdmin(request);

    const data = (request.data ?? {}) as Record<string, unknown>;
    const name = typeof data.name === "string" ? data.name.trim() : "";
    const description = typeof data.description === "string" ? data.description.trim() : "";

    if (!name) throw new HttpsError("invalid-argument", "name is required.");

    const db = getDb();
    const keySnap = await db.collection(AI_KEYS_DOC[0]).doc(AI_KEYS_DOC[1]).get();
    const apiKey = keySnap.data()?.anthropicApiKey;
    if (!apiKey || typeof apiKey !== "string") {
      throw new HttpsError("failed-precondition", "Anthropic API key not configured in admin_config/ai_keys.");
    }

    const metaSnap = await db.collection("app_translations").doc("meta").get();
    const locales: string[] = metaSnap.exists
      ? ((metaSnap.data()?.supportedLocales as string[] | undefined) ?? DEFAULT_LOCALES)
      : DEFAULT_LOCALES;
    const localeNames: Record<string, string> = metaSnap.exists
      ? ((metaSnap.data()?.localeNames as Record<string, string> | undefined) ?? DEFAULT_LOCALE_NAMES)
      : DEFAULT_LOCALE_NAMES;

    const targetLocales = locales.filter((l) => l !== "en");

    const results = await Promise.all(
      targetLocales.map(async (locale) => {
        const langName = localeNames[locale] ?? locale;
        const input: Record<string, string> = { name };
        if (description) input.description = description;

        try {
          const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 512,
              messages: [{
                role: "user",
                content: `Translate these trap texts from English to ${langName} for a GPS outdoor game called "Trapp" where players set real-world traps to catch each other outdoors.

Return ONLY a valid JSON object with the same keys. No explanation, no markdown.

${JSON.stringify(input, null, 2)}`,
              }],
            }),
          });

          if (!resp.ok) return { locale, translatedName: name, translatedDesc: description };
          const result = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
          const text = result.content?.find((c) => c.type === "text")?.text ?? "";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) return { locale, translatedName: name, translatedDesc: description };
          const parsed = JSON.parse(jsonMatch[0]) as Record<string, string>;
          return {
            locale,
            translatedName: typeof parsed.name === "string" ? parsed.name : name,
            translatedDesc: typeof parsed.description === "string" ? parsed.description : description,
          };
        } catch {
          return { locale, translatedName: name, translatedDesc: description };
        }
      })
    );

    const names: Record<string, string> = { en: name };
    const descriptions: Record<string, string> = description ? { en: description } : {};
    for (const r of results) {
      names[r.locale] = r.translatedName;
      if (description) descriptions[r.locale] = r.translatedDesc;
    }

    return { ok: true, names, descriptions };
  }
);

export const adminListTraps = onCall(async (request) => {
  requireAdmin(request);

  const limitRaw = (request.data as Record<string, unknown> | undefined)?.limit;
  const limit = typeof limitRaw === "number" && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 100;

  const snap = await getDb()
    .collection("traps")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return {
    ok: true,
    items: snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })),
  };
});

export const adminUpdateTrapStatus = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const trapId = asTrimmedString(data.trapId, "trapId", true)!;
  const status = normalizeStatus(data.status);

  await getDb()
    .collection("traps")
    .doc(trapId)
    .set(
      {
        status,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return { ok: true, trapId, status };
});

export const adminDeleteTrap = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const trapId = asTrimmedString(data.trapId, "trapId", true)!;

  await getDb().collection("traps").doc(trapId).delete();

  return { ok: true, trapId };
});

export const adminGetTrapDetails = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const trapId = asTrimmedString(data.trapId, "trapId", true)!;

  const snap = await getDb().collection("traps").doc(trapId).get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Trap not found.");
  }

  return {
    ok: true,
    trap: {
      id: snap.id,
      ...snap.data(),
    },
  };
});

// ─── Activate a single placed trap ───────────────────────────────────────────

export const adminActivateTrap = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const trapId = asTrimmedString(data.trapId, "trapId", true)!;

  const db = getDb();
  const ref = db.collection("traps").doc(trapId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Trap not found.");

  await ref.set({ status: "active", updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  void writeAuditLog({
    adminUid,
    category: "traps",
    action: "ACTIVATE_TRAP",
    targetId: trapId,
    summary: `Activated trap ${trapId}`,
    details: { trapId, previousStatus: snap.data()?.status ?? null },
  });

  return { ok: true, trapId, status: "active" };
});

// ─── Deactivate a single placed trap ─────────────────────────────────────────

export const adminDeactivateTrap = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const trapId = asTrimmedString(data.trapId, "trapId", true)!;

  const db = getDb();
  const ref = db.collection("traps").doc(trapId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Trap not found.");

  await ref.set({ status: "inactive", updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  void writeAuditLog({
    adminUid,
    category: "traps",
    action: "DEACTIVATE_TRAP",
    targetId: trapId,
    summary: `Deactivated trap ${trapId}`,
    details: { trapId, previousStatus: snap.data()?.status ?? null },
  });

  return { ok: true, trapId, status: "inactive" };
});

// ─── Delete ALL placed traps (all players) ────────────────────────────────────

/**
 * Permanently deletes every document in the `traps` collection.
 * Requires the caller to pass { confirm: true } to prevent accidental use.
 * Processes in batches of 400 to stay under Firestore's 500-op batch limit.
 */
export const adminDeleteAllTraps = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  if (data.confirm !== true) {
    throw new HttpsError(
      "invalid-argument",
      "Pass { confirm: true } to confirm deleting ALL traps from all players."
    );
  }

  const db = getDb();
  const BATCH_SIZE = 400;
  let deleted = 0;

  // Page through the entire collection in chunks to avoid loading everything
  // into memory at once.
  let query = db.collection("traps").limit(BATCH_SIZE);
  let snap = await query.get();

  while (!snap.empty) {
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    deleted += snap.size;

    // Next page starts after the last document processed
    const last = snap.docs[snap.docs.length - 1];
    snap = await db.collection("traps").limit(BATCH_SIZE).startAfter(last).get();
  }

  void writeAuditLog({
    adminUid,
    category: "traps",
    action: "DELETE_ALL_TRAPS",
    targetId: "all",
    summary: `Deleted ALL ${deleted} placed trap(s) across all players`,
    details: { deleted },
  });

  return { ok: true, deleted };
});

// ─── Migrate trap definition timers to meaningful durations ──────────────────

/**
 * One-time migration: updates placementHoldSeconds and disarmHoldSeconds on
 * all trap_definitions documents that still have the old short defaults (≤ 10 s)
 * or on ALL definitions when { force: true } is passed.
 *
 * Timer logic by age group:
 *   adult-only  → placement 600 s (10 min), disarm 480 s (8 min)
 *   minor-only  → placement 300 s (5 min),  disarm 240 s (4 min)
 *   both/other  → placement 360 s (6 min),  disarm 300 s (5 min)
 */
export const adminUpdateTrapTimers = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const force = data.force === true;

  const db = getDb();
  const snap = await db.collection("trap_definitions").get();

  let updated = 0;
  const batch = db.batch();

  for (const doc of snap.docs) {
    const d = doc.data();
    const placement = typeof d.placementHoldSeconds === "number" ? d.placementHoldSeconds : 0;
    const disarm    = typeof d.disarmHoldSeconds    === "number" ? d.disarmHoldSeconds    : 0;

    // Skip if already reasonable and force not requested
    if (!force && placement > 10 && disarm > 10) continue;

    const ageGroups: string[] = Array.isArray(d.allowedAgeGroups) ? d.allowedAgeGroups : [];
    const adultOnly  = ageGroups.length > 0 && ageGroups.every((g) => g === "adult");
    const minorOnly  = ageGroups.length > 0 && ageGroups.every((g) => g === "minor");

    let newPlacement: number;
    let newDisarm: number;
    if (adultOnly) {
      newPlacement = 600;  // 10 min — adults have more patience; card saves 50%
      newDisarm    = 480;  // 8 min
    } else if (minorOnly) {
      newPlacement = 300;  // 5 min — keeps children engaged without frustration
      newDisarm    = 240;  // 4 min
    } else {
      newPlacement = 360;  // 6 min — mixed / unspecified
      newDisarm    = 300;  // 5 min
    }

    batch.update(doc.ref, {
      placementHoldSeconds: newPlacement,
      disarmHoldSeconds:    newDisarm,
    });
    updated++;
  }

  if (updated > 0) await batch.commit();

  void writeAuditLog({
    adminUid,
    category: "traps",
    action: "UPDATE_TRAP_TIMERS",
    targetId: "all",
    summary: `Updated trap timers on ${updated} definition(s) (force=${force})`,
    details: { updated, force },
  });

  return { ok: true, updated };
});