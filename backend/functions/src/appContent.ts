import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { GoogleAuth } from "google-auth-library";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { writeAuditLog } from "./adminAuditLog";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function getTrimmedString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

const TERMS_DOC_PATH = {
  collection: "app_content",
  doc: "terms_and_conditions",
};

/** All locales supported by the app. */
const SUPPORTED_LOCALES = ["en", "hu", "de", "hr", "ro", "sk"] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

type LocaleEntry = {
  title: string;
  content: string;
};

/** Safe-read a locale entry from a raw Firestore value. */
function readLocaleEntry(value: unknown, defaultTitle: string): LocaleEntry {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return {
      title: asString(v.title, defaultTitle),
      content: asString(v.content),
    };
  }
  return { title: defaultTitle, content: "" };
}

const DEFAULT_TITLES: Record<Locale, string> = {
  en: "Terms & Conditions",
  hu: "Felhasználási feltételek",
  de: "Nutzungsbedingungen",
  hr: "Uvjeti i odredbe",
  ro: "Termeni și condiții",
  sk: "Podmienky používania",
};

// ─── Public endpoint ──────────────────────────────────────────────────────────

/**
 * Returns the T&C for the requested locale, falling back to English.
 * Called by the mobile app: { locale: "hu" }
 */
export const getTermsAndConditions = onCall(async (request) => {
  const db = getDb();
  const snap = await db
    .collection(TERMS_DOC_PATH.collection)
    .doc(TERMS_DOC_PATH.doc)
    .get();

  if (!snap.exists) {
    return {
      ok: true,
      exists: false,
      title: "Terms & Conditions",
      version: "v1",
      content: "",
      isActive: false,
    };
  }

  const data = snap.data() ?? {};

  // Determine locale — default to "en"
  const requestedLocale = asString(
    (request.data as Record<string, unknown> | undefined)?.locale
  ).toLowerCase() as Locale;
  const locale: Locale = SUPPORTED_LOCALES.includes(requestedLocale)
    ? requestedLocale
    : "en";

  // Try requested locale, fall back to English
  const translations =
    data.translations && typeof data.translations === "object"
      ? (data.translations as Record<string, unknown>)
      : {};

  const localeData = readLocaleEntry(
    translations[locale] ?? translations["en"],
    DEFAULT_TITLES[locale] ?? DEFAULT_TITLES.en
  );

  return {
    ok: true,
    exists: true,
    locale,
    title: localeData.title || asString(data.title, DEFAULT_TITLES.en),
    version: asString(data.version, "v1"),
    content: localeData.content || asString(data.content),
    isActive: data.isActive !== false,
    updatedAtEpochMs:
      typeof data.updatedAtEpochMs === "number" ? data.updatedAtEpochMs : null,
    updatedByUid: asString(data.updatedByUid) || null,
  };
});

// ─── Admin read ───────────────────────────────────────────────────────────────

export const adminGetTermsAndConditions = onCall(async (request) => {
  requireAdmin(request);

  const db = getDb();
  const snap = await db
    .collection(TERMS_DOC_PATH.collection)
    .doc(TERMS_DOC_PATH.doc)
    .get();

  if (!snap.exists) {
    // Return empty shells for every locale
    const emptyTranslations = Object.fromEntries(
      SUPPORTED_LOCALES.map((l) => [l, { title: DEFAULT_TITLES[l], content: "" }])
    );
    return {
      ok: true,
      exists: false,
      version: "v1",
      isActive: false,
      updatedAtEpochMs: null,
      updatedByUid: null,
      translations: emptyTranslations,
    };
  }

  const data = snap.data() ?? {};
  const raw =
    data.translations && typeof data.translations === "object"
      ? (data.translations as Record<string, unknown>)
      : {};

  // Build a complete translations map — fill any missing locales with defaults
  const translations = Object.fromEntries(
    SUPPORTED_LOCALES.map((l) => {
      const entry = readLocaleEntry(raw[l], DEFAULT_TITLES[l]);
      // Migrate: if English entry is empty, fall back to the old top-level content
      if (l === "en" && !entry.content) {
        entry.title = asString(data.title, DEFAULT_TITLES.en);
        entry.content = asString(data.content);
      }
      return [l, entry];
    })
  );

  return {
    ok: true,
    exists: true,
    // Top-level title + content (EN) so the admin panel textarea populates correctly
    title: translations.en.title,
    content: translations.en.content,
    version: asString(data.version, "v1"),
    isActive: data.isActive !== false,
    updatedAtEpochMs:
      typeof data.updatedAtEpochMs === "number" ? data.updatedAtEpochMs : null,
    updatedByUid: asString(data.updatedByUid) || null,
    translations,
  };
});

// ─── Admin write ──────────────────────────────────────────────────────────────

export const adminUpdateTermsAndConditions = onCall(async (request) => {
  const adminUid = requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;

  const version = getTrimmedString(data.version, "v1");
  const isActive = data.isActive !== false;

  if (!version) {
    throw new HttpsError("invalid-argument", "version is required.");
  }

  // Accept either a translations map OR the legacy flat { title, content } shape
  // that the admin panel sends when saving from the single-textarea editor.
  const rawTranslations =
    data.translations && typeof data.translations === "object"
      ? (data.translations as Record<string, unknown>)
      : {};

  const flatContent = getTrimmedString(data.content);
  const flatTitle   = getTrimmedString(data.title, DEFAULT_TITLES.en);

  const translations: Record<string, LocaleEntry> = {};
  for (const locale of SUPPORTED_LOCALES) {
    const entry = readLocaleEntry(rawTranslations[locale], DEFAULT_TITLES[locale]);
    translations[locale] = {
      title: entry.title || DEFAULT_TITLES[locale],
      content: entry.content,
    };
  }

  // If the panel sent a flat content field and the EN slot is still empty, use it.
  if (!translations.en.content && flatContent) {
    translations.en.content = flatContent;
    translations.en.title   = flatTitle;
  }

  // English content is required (it is the fallback for all other locales)
  if (!translations.en.content.trim()) {
    throw new HttpsError(
      "invalid-argument",
      "English (EN) content is required as it is the fallback for all locales."
    );
  }

  const db = getDb();
  const ref = db.collection(TERMS_DOC_PATH.collection).doc(TERMS_DOC_PATH.doc);
  const updatedAtEpochMs = Date.now();

  await ref.set(
    {
      // Keep top-level English fields for backward compatibility with older app versions
      title: translations.en.title,
      version,
      content: translations.en.content,
      isActive,
      translations,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtEpochMs,
      updatedByUid: request.auth?.uid ?? null,
    },
    { merge: true }
  );

  const localesFilled = Object.keys(translations)
    .filter((k) => translations[k].content.trim().length > 0)
    .join(", ");

  void writeAuditLog({
    adminUid,
    category: "terms",
    action: "UPDATE_TERMS",
    summary: `Updated Terms & Conditions (version: ${version}, active: ${isActive}, locales: ${localesFilled})`,
    details: { version, isActive, localesFilled },
  });

  return {
    ok: true,
    version,
    isActive,
    translations,
    updatedAtEpochMs,
    updatedByUid: request.auth?.uid ?? null,
  };
});

// ─── Admin translate ──────────────────────────────────────────────────────────

const LOCALE_BCP47: Record<string, string> = {
  en: "en", hu: "hu", de: "de", hr: "hr", ro: "ro", sk: "sk",
};

/**
 * Translates a block of text from English to the requested locale using
 * Cloud Translation API v2 (Basic).  The service account running this
 * function must have the roles/cloudtranslate.user IAM role, which is
 * already granted to App Engine / Cloud Run service accounts by default
 * in most Firebase projects.
 */
export const adminTranslateTermsContent = onCall(
  { timeoutSeconds: 60 },
  async (request) => {
    requireAdmin(request);

    const payload = (request.data ?? {}) as Record<string, unknown>;
    const text = asString(payload.text).trim();
    const targetLocale = asString(payload.targetLocale).toLowerCase();

    if (!text) {
      throw new HttpsError("invalid-argument", "text is required.");
    }
    if (!LOCALE_BCP47[targetLocale] || targetLocale === "en") {
      throw new HttpsError(
        "invalid-argument",
        `targetLocale must be one of: hu, de, hr, ro, sk`
      );
    }

    // Obtain a short-lived access token via Application Default Credentials
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-translation"],
    });
    const client = await auth.getClient();
    const tokenResult = await client.getAccessToken();
    const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;

    if (!token) {
      throw new HttpsError("internal", "Could not obtain translation access token.");
    }

    // Cloud Translation API v2 Basic
    const apiUrl = "https://translation.googleapis.com/language/translate/v2";
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: text,
        source: "en",
        target: LOCALE_BCP47[targetLocale],
        format: "text",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new HttpsError(
        "internal",
        `Translation API error ${response.status}: ${errorText}`
      );
    }

    const result = (await response.json()) as {
      data?: { translations?: Array<{ translatedText?: string }> };
    };

    const translated = result.data?.translations?.[0]?.translatedText ?? "";
    if (!translated) {
      throw new HttpsError("internal", "Translation API returned empty result.");
    }

    return { ok: true, translated, targetLocale };
  }
);
