/**
 * Awards content — per-locale milestone descriptions and card-type UI copy.
 *
 * Stored in:  app_content/awards_content
 * Structure:
 *   milestones: Array<{ day, emoji, rewards, translations: { en/hu/de/hr/ro/sk: { name, description } } }>
 *   cardTypes:  Array<{ id, emoji, valueDisplay, translations: { en/…: { name, unitLabel, heroTitle,
 *                       heroSubtitle, tipText, readyLabel, usedLabel } } }>
 *
 * The document falls back to built-in defaults when it doesn't exist yet,
 * so the app works out-of-the-box before the admin ever touches the panel.
 */

import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { GoogleAuth } from "google-auth-library";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { writeAuditLog } from "./adminAuditLog";

const SUPPORTED_LOCALES = ["en", "hu", "de", "hr", "ro", "sk"] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

const DOC = { collection: "app_content", doc: "awards_content" };

// ── Types ─────────────────────────────────────────────────────────────────────

interface MilestoneTranslation {
  name: string;
  description: string;
}

interface CardTypeTranslation {
  name: string;
  unitLabel: string;
  heroTitle: string;
  heroSubtitle: string;
  tipText: string;
  readyLabel: string;
  usedLabel: string;
}

interface MilestoneEntry {
  day: number;
  emoji: string;
  rewards: { cards: number; xp: number; bagRefills: number; freezeCards?: number };
  translations: Partial<Record<Locale, MilestoneTranslation>>;
}

interface CardTypeEntry {
  id: string;
  emoji: string;
  valueDisplay: string;
  translations: Partial<Record<Locale, CardTypeTranslation>>;
}

// ── Seed defaults (used when doc doesn't exist yet) ───────────────────────────

const DEFAULT_MILESTONES: MilestoneEntry[] = [
  { day: 1,  emoji: "🎁", rewards: { cards: 3,  xp: 0,    bagRefills: 0,  freezeCards: 0 }, translations: { en: { name: "First Login Bonus",  description: "3 Time Deduction Cards" } } },
  { day: 2,  emoji: "🃏", rewards: { cards: 2,  xp: 0,    bagRefills: 5,  freezeCards: 0 }, translations: { en: { name: "Day 2 Streak",        description: "2 Cards + 5 Bag refills" } } },
  { day: 3,  emoji: "⭐", rewards: { cards: 3,  xp: 50,   bagRefills: 0,  freezeCards: 0 }, translations: { en: { name: "Day 3 Streak",        description: "3 Cards + 50 XP" } } },
  { day: 5,  emoji: "🔥", rewards: { cards: 5,  xp: 0,    bagRefills: 0,  freezeCards: 0 }, translations: { en: { name: "5-Day Streak",        description: "5 Cards" } } },
  { day: 7,  emoji: "💎", rewards: { cards: 7,  xp: 100,  bagRefills: 10, freezeCards: 1 }, translations: { en: { name: "Week Warrior",        description: "7 Cards + 100 XP + 10 Bag + 1 Freeze" } } },
  { day: 10, emoji: "🏅", rewards: { cards: 5,  xp: 50,   bagRefills: 0,  freezeCards: 0 }, translations: { en: { name: "Day 10 Streak",       description: "5 Cards + 50 XP" } } },
  { day: 14, emoji: "🥇", rewards: { cards: 10, xp: 200,  bagRefills: 0,  freezeCards: 2 }, translations: { en: { name: "Dedicated Hunter",    description: "10 Cards + 200 XP + 2 Freeze" } } },
  { day: 21, emoji: "🏆", rewards: { cards: 10, xp: 0,    bagRefills: 20, freezeCards: 1 }, translations: { en: { name: "21-Day Champion",     description: "10 Cards + 20 Bag + 1 Freeze" } } },
  { day: 30, emoji: "👑", rewards: { cards: 15, xp: 500,  bagRefills: 30, freezeCards: 3 }, translations: { en: { name: "Trap Legend",         description: "15 Cards + 500 XP + 30 Bag + 3 Freeze" } } },
  { day: 60, emoji: "⚔️", rewards: { cards: 20, xp: 1000, bagRefills: 0,  freezeCards: 2 }, translations: { en: { name: "60-Day Immortal",     description: "20 Cards + 1000 XP + 2 Freeze" } } },
  { day: 90, emoji: "🌟", rewards: { cards: 30, xp: 2000, bagRefills: 50, freezeCards: 5 }, translations: { en: { name: "90-Day God",          description: "30 Cards + 2000 XP + 50 Bag + 5 Freeze" } } },
];

const DEFAULT_CARD_TYPES: CardTypeEntry[] = [
  {
    id: "card_time_deduction_5min",
    emoji: "⏱️",
    valueDisplay: "−5",
    translations: {
      en: {
        name: "Time Deduction",
        unitLabel: "min",
        heroTitle: "Time Deduction Cards",
        heroSubtitle: "Each card removes 5 min from your wait timer",
        tipText: "Cards are applied automatically during trap placement — tap the card icon in the trap bag.",
        readyLabel: "READY",
        usedLabel: "USED",
      },
    },
  },
  {
    id: "card_streak_freeze",
    emoji: "🧊",
    valueDisplay: "1",
    translations: {
      en: {
        name: "Streak Freeze",
        unitLabel: "day",
        heroTitle: "Streak Freeze Cards",
        heroSubtitle: "Protects your login streak when you miss exactly 1 day",
        tipText: "Used automatically the next time you open the app after missing a day — no action needed.",
        readyLabel: "READY",
        usedLabel: "USED",
      },
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveLocale(raw: unknown): Locale {
  const l = String(raw ?? "").toLowerCase() as Locale;
  return SUPPORTED_LOCALES.includes(l) ? l : "en";
}

function resolveMilestone(entry: MilestoneEntry, locale: Locale): MilestoneTranslation {
  const t = entry.translations ?? {};
  return t[locale] ?? t["en"] ?? { name: `Day ${entry.day}`, description: "" };
}

function resolveCardType(entry: CardTypeEntry, locale: Locale): CardTypeTranslation {
  const t = entry.translations ?? {};
  return t[locale] ?? t["en"] ?? {
    name: "Card",
    unitLabel: "min",
    heroTitle: "Cards",
    heroSubtitle: "",
    tipText: "",
    readyLabel: "READY",
    usedLabel: "USED",
  };
}

function getRaw(snap: FirebaseFirestore.DocumentSnapshot): { milestones: MilestoneEntry[]; cardTypes: CardTypeEntry[] } {
  if (!snap.exists) return { milestones: DEFAULT_MILESTONES, cardTypes: DEFAULT_CARD_TYPES };
  const d = snap.data() ?? {};
  return {
    milestones: Array.isArray(d.milestones) ? d.milestones : DEFAULT_MILESTONES,
    cardTypes: Array.isArray(d.cardTypes) ? d.cardTypes : DEFAULT_CARD_TYPES,
  };
}

// ── Public endpoint ───────────────────────────────────────────────────────────

/**
 * Returns locale-resolved content for the Awards screen.
 * Called by the mobile app with { locale: "hu" }.
 * Falls back to built-in English defaults if the Firestore doc doesn't exist.
 */
export const getAwardsContent = onCall(async (request) => {
  const db = getDb();
  const snap = await db.collection(DOC.collection).doc(DOC.doc).get();
  const locale = resolveLocale((request.data as Record<string, unknown>)?.locale);
  const { milestones, cardTypes } = getRaw(snap);

  return {
    ok: true,
    locale,
    version: (snap.exists ? (snap.data() ?? {})["version"] as number | undefined : undefined) ?? 0,
    milestones: milestones.map((m) => {
      const t = resolveMilestone(m, locale);
      return {
        day: m.day,
        emoji: m.emoji,
        rewards: {
          cards:       (m.rewards?.cards       ?? 0),
          xp:          (m.rewards?.xp          ?? 0),
          bagRefills:  (m.rewards?.bagRefills  ?? 0),
          freezeCards: (m.rewards?.freezeCards ?? 0),
        },
        name: t.name,
        description: t.description,
      };
    }),
    cardTypes: cardTypes.map((ct) => ({
      id: ct.id,
      emoji: ct.emoji,
      valueDisplay: ct.valueDisplay,
      ...resolveCardType(ct, locale),
    })),
  };
});

// ── Admin read ────────────────────────────────────────────────────────────────

export const adminGetAwardsContent = onCall(async (request) => {
  requireAdmin(request);
  const db = getDb();
  const snap = await db.collection(DOC.collection).doc(DOC.doc).get();
  const { milestones, cardTypes } = getRaw(snap);
  const d = snap.exists ? (snap.data() ?? {}) : {};
  return {
    ok: true,
    exists: snap.exists,
    version: (d["version"] as number | undefined) ?? 0,
    updatedAtEpochMs: (d["updatedAtEpochMs"] as number | undefined) ?? null,
    updatedByUid: (d["updatedByUid"] as string | undefined) ?? null,
    milestones,
    cardTypes,
  };
});

// ── Admin write ───────────────────────────────────────────────────────────────

export const adminUpdateAwardsContent = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const payload = (request.data ?? {}) as Record<string, unknown>;

  if (!Array.isArray(payload.milestones))
    throw new HttpsError("invalid-argument", "milestones array is required.");
  if (!Array.isArray(payload.cardTypes))
    throw new HttpsError("invalid-argument", "cardTypes array is required.");

  const db = getDb();
  const updatedAtEpochMs = Date.now();

  await db.collection(DOC.collection).doc(DOC.doc).set(
    {
      milestones: payload.milestones,
      cardTypes: payload.cardTypes,
      version: updatedAtEpochMs,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtEpochMs,
      updatedByUid: adminUid,
    },
    { merge: true }
  );

  void writeAuditLog({
    adminUid,
    category: "awards",
    action: "UPDATE_AWARDS_CONTENT",
    summary: `Updated awards content — ${(payload.milestones as unknown[]).length} milestones, ${(payload.cardTypes as unknown[]).length} card types`,
    details: {
      milestoneCount: (payload.milestones as unknown[]).length,
      cardTypeCount: (payload.cardTypes as unknown[]).length,
    },
  });

  return { ok: true, version: updatedAtEpochMs };
});

// ── Admin auto-translate ──────────────────────────────────────────────────────

const LOCALE_BCP47: Record<string, string> = {
  en: "en", hu: "hu", de: "de", hr: "hr", ro: "ro", sk: "sk",
};

/**
 * Auto-translates all English milestone and card-type strings into
 * the requested target locale using Cloud Translation API v2.
 * Requires roles/cloudtranslate.user on the service account.
 */
export const adminTranslateAwardsContent = onCall(
  { timeoutSeconds: 120 },
  async (request) => {
    requireAdmin(request);
    const payload = (request.data ?? {}) as Record<string, unknown>;
    const targetLocale = String(payload.targetLocale ?? "").toLowerCase();

    if (!LOCALE_BCP47[targetLocale] || targetLocale === "en")
      throw new HttpsError("invalid-argument", "targetLocale must be one of: hu, de, hr, ro, sk");

    const db = getDb();
    const snap = await db.collection(DOC.collection).doc(DOC.doc).get();
    const { milestones, cardTypes } = getRaw(snap);

    // Collect all English strings in order
    const queue: string[] = [];
    milestones.forEach((m) => {
      const en = m.translations?.["en"];
      queue.push(en?.name ?? `Day ${m.day}`, en?.description ?? "");
    });
    cardTypes.forEach((ct) => {
      const en = ct.translations?.["en"];
      queue.push(
        en?.name ?? "",
        en?.unitLabel ?? "min",
        en?.heroTitle ?? "",
        en?.heroSubtitle ?? "",
        en?.tipText ?? "",
        en?.readyLabel ?? "READY",
        en?.usedLabel ?? "USED"
      );
    });

    // Batch translate
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-translation"] });
    const client = await auth.getClient();
    const tokenResult = await client.getAccessToken();
    const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;
    if (!token) throw new HttpsError("internal", "Could not obtain translation access token.");

    const res = await fetch("https://translation.googleapis.com/language/translate/v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ q: queue, source: "en", target: LOCALE_BCP47[targetLocale], format: "text" }),
    });
    if (!res.ok) throw new HttpsError("internal", `Translation API error ${res.status}`);

    const json = (await res.json()) as { data?: { translations?: Array<{ translatedText?: string }> } };
    const out = json.data?.translations?.map((t) => t.translatedText ?? "") ?? [];

    // Map back to entries
    let idx = 0;
    const updatedMilestones = milestones.map((m) => ({
      ...m,
      translations: {
        ...m.translations,
        [targetLocale]: {
          name: out[idx++] ?? m.translations?.["en"]?.name ?? "",
          description: out[idx++] ?? m.translations?.["en"]?.description ?? "",
        } satisfies MilestoneTranslation,
      },
    }));
    const updatedCardTypes = cardTypes.map((ct) => ({
      ...ct,
      translations: {
        ...ct.translations,
        [targetLocale]: {
          name:         out[idx++] ?? "",
          unitLabel:    out[idx++] ?? "min",
          heroTitle:    out[idx++] ?? "",
          heroSubtitle: out[idx++] ?? "",
          tipText:      out[idx++] ?? "",
          readyLabel:   out[idx++] ?? "READY",
          usedLabel:    out[idx++] ?? "USED",
        } satisfies CardTypeTranslation,
      },
    }));

    const updatedAtEpochMs = Date.now();
    await db.collection(DOC.collection).doc(DOC.doc).set(
      { milestones: updatedMilestones, cardTypes: updatedCardTypes, version: updatedAtEpochMs, updatedAtEpochMs },
      { merge: true }
    );

    return { ok: true, targetLocale, translatedCount: queue.length };
  }
);
