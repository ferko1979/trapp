import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";

// ── Meta document: app_translations/meta ─────────────────────────────────────
// Stores the list of supported locales + their display names.
// Falls back to defaults if the document doesn't exist yet.

const DEFAULT_LOCALES = ["en", "hu", "de", "hr", "ro", "sk"];
const DEFAULT_LOCALE_NAMES: Record<string, string> = {
  en: "English",
  hu: "Magyar (Hungarian)",
  de: "Deutsch (German)",
  hr: "Hrvatski (Croatian)",
  ro: "Română (Romanian)",
  sk: "Slovenčina (Slovak)",
};

const metaRef = () => getDb().collection("app_translations").doc("meta");
const AI_KEYS_DOC = ["admin_config", "ai_keys"] as const;

async function getLocalesMeta(): Promise<{ locales: string[]; names: Record<string, string> }> {
  const snap = await metaRef().get();
  if (snap.exists) {
    const d = snap.data() ?? {};
    return {
      locales: Array.isArray(d.supportedLocales) ? (d.supportedLocales as string[]) : DEFAULT_LOCALES,
      names:
        d.localeNames && typeof d.localeNames === "object"
          ? (d.localeNames as Record<string, string>)
          : DEFAULT_LOCALE_NAMES,
    };
  }
  return { locales: DEFAULT_LOCALES, names: { ...DEFAULT_LOCALE_NAMES } };
}

async function getAnthropicApiKey(): Promise<string> {
  const snap = await getDb().collection(AI_KEYS_DOC[0]).doc(AI_KEYS_DOC[1]).get();
  const key = snap.data()?.anthropicApiKey;
  if (!key || typeof key !== "string") {
    throw new HttpsError(
      "failed-precondition",
      "Anthropic API key is not configured. Go to Admin Tools → AI / API Keys and save your key."
    );
  }
  return key;
}

function parseAndroidXml(xmlText: string): Record<string, string> {
  const strings: Record<string, string> = {};
  const re = /<string name="([^"]+)">([\s\S]*?)<\/string>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xmlText)) !== null) {
    const key = m[1];
    const value = m[2]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"');
    strings[key] = value;
  }
  return strings;
}

// ── Language management ───────────────────────────────────────────────────────

export const adminGetSupportedLanguages = onCall(async (request) => {
  requireAdmin(request);
  const { locales, names } = await getLocalesMeta();
  return { ok: true, locales, names };
});

export const adminAddLanguage = onCall(async (request) => {
  requireAdmin(request);
  const payload = (request.data ?? {}) as Record<string, unknown>;
  const locale = typeof payload.locale === "string" ? payload.locale.trim().toLowerCase() : null;
  const languageName = typeof payload.languageName === "string" ? payload.languageName.trim() : locale;

  if (!locale || !/^[a-z]{2}(-[a-z]{2})?$/.test(locale)) {
    throw new HttpsError(
      "invalid-argument",
      "locale must be a valid 2-letter language code (e.g. 'fr', 'pt', 'zh-cn')."
    );
  }

  const { locales, names } = await getLocalesMeta();
  if (locales.includes(locale)) {
    throw new HttpsError("already-exists", `Locale '${locale}' is already in the list.`);
  }

  const newLocales = [...locales, locale];
  const newNames = { ...names, [locale]: languageName || locale };

  await metaRef().set(
    { supportedLocales: newLocales, localeNames: newNames, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  // Bootstrap an empty strings document so the locale appears in the panel
  await getDb()
    .collection("app_translations")
    .doc(locale)
    .set(
      { locale, strings: {}, updatedAt: FieldValue.serverTimestamp(), updatedAtEpochMs: Date.now() },
      { merge: true }
    );

  return { ok: true, locales: newLocales, names: newNames };
});

export const adminRemoveLanguage = onCall(async (request) => {
  requireAdmin(request);
  const payload = (request.data ?? {}) as Record<string, unknown>;
  const locale = typeof payload.locale === "string" ? payload.locale.trim() : null;

  if (!locale) throw new HttpsError("invalid-argument", "locale is required.");
  if (locale === "en") throw new HttpsError("invalid-argument", "Cannot remove the English source locale.");

  const { locales, names } = await getLocalesMeta();
  if (!locales.includes(locale)) throw new HttpsError("not-found", `Locale '${locale}' not found.`);

  const newLocales = locales.filter((l) => l !== locale);
  const newNames = { ...names };
  delete newNames[locale];

  await metaRef().set(
    { supportedLocales: newLocales, localeNames: newNames, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  return { ok: true, locales: newLocales, names: newNames };
});

// ── Admin: save / retrieve Anthropic API key ──────────────────────────────────

export const adminSetAiApiKey = onCall(async (request) => {
  requireAdmin(request);
  const payload = (request.data ?? {}) as Record<string, unknown>;
  const key = typeof payload.anthropicApiKey === "string" ? payload.anthropicApiKey.trim() : null;
  if (!key) throw new HttpsError("invalid-argument", "anthropicApiKey is required.");
  await getDb()
    .collection(AI_KEYS_DOC[0])
    .doc(AI_KEYS_DOC[1])
    .set({ anthropicApiKey: key, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true };
});

export const adminCheckAiApiKey = onCall(async (request) => {
  requireAdmin(request);
  const snap = await getDb().collection(AI_KEYS_DOC[0]).doc(AI_KEYS_DOC[1]).get();
  const key = snap.data()?.anthropicApiKey;
  const configured = !!(key && typeof key === "string" && key.length > 10);
  const masked = configured ? `sk-ant-...${(key as string).slice(-4)}` : null;
  return { ok: true, configured, masked };
});

// ── Public: mobile app polls for translation updates ──────────────────────────

export const getAppTranslations = onCall(async (request) => {
  const payload = (request.data ?? {}) as Record<string, unknown>;
  const requestedLocale =
    typeof payload.locale === "string" ? payload.locale.trim().toLowerCase() : "en";
  const cachedVersion =
    typeof payload.cachedVersion === "number" ? payload.cachedVersion : 0;

  const { locales } = await getLocalesMeta();
  const locale = locales.includes(requestedLocale) ? requestedLocale : "en";

  const snap = await getDb().collection("app_translations").doc(locale).get();
  if (!snap.exists) {
    return { ok: true, upToDate: true, locale, version: 0 };
  }

  const data = snap.data() ?? {};
  const serverVersion = typeof data.updatedAtEpochMs === "number" ? data.updatedAtEpochMs : 0;

  if (serverVersion <= cachedVersion) {
    return { ok: true, upToDate: true, locale, version: serverVersion };
  }

  return {
    ok: true,
    upToDate: false,
    locale,
    version: serverVersion,
    strings: (data.strings ?? {}) as Record<string, string>,
  };
});

// ── Admin: read all locales ───────────────────────────────────────────────────

export const adminGetAllTranslations = onCall(async (request) => {
  requireAdmin(request);

  const { locales, names } = await getLocalesMeta();
  const db = getDb();

  const snapshots = await Promise.all(
    locales.map((loc) => db.collection("app_translations").doc(loc).get().then((s) => ({ loc, s })))
  );

  const localesData: Record<
    string,
    { strings: Record<string, string>; updatedAtEpochMs: number; stringCount: number }
  > = {};

  for (const { loc, s } of snapshots) {
    if (s.exists) {
      const d = s.data() ?? {};
      const str = (d.strings ?? {}) as Record<string, string>;
      localesData[loc] = {
        strings: str,
        updatedAtEpochMs: typeof d.updatedAtEpochMs === "number" ? d.updatedAtEpochMs : 0,
        stringCount: Object.keys(str).length,
      };
    } else {
      localesData[loc] = { strings: {}, updatedAtEpochMs: 0, stringCount: 0 };
    }
  }

  return { ok: true, locales: localesData, localeNames: names, supportedLocales: locales };
});

// ── Admin: save strings for one locale ───────────────────────────────────────

export const adminUpdateAppTranslations = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const payload = (request.data ?? {}) as Record<string, unknown>;
  const locale = typeof payload.locale === "string" ? payload.locale.trim() : null;
  const strings =
    payload.strings && typeof payload.strings === "object"
      ? (payload.strings as Record<string, string>)
      : null;

  if (!locale) throw new HttpsError("invalid-argument", "locale is required.");
  if (!strings) throw new HttpsError("invalid-argument", "strings is required.");

  const { locales } = await getLocalesMeta();
  if (!locales.includes(locale)) {
    throw new HttpsError("invalid-argument", `locale must be one of: ${locales.join(", ")}`);
  }

  const updatedAtEpochMs = Date.now();
  await getDb().collection("app_translations").doc(locale).set({
    locale,
    strings,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtEpochMs,
    updatedByUid: adminUid,
  });

  return { ok: true, locale, updatedAtEpochMs, stringCount: Object.keys(strings).length };
});

// ── Admin: import from Android strings.xml ────────────────────────────────────

export const adminImportXmlTranslations = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const payload = (request.data ?? {}) as Record<string, unknown>;
  const locale = typeof payload.locale === "string" ? payload.locale.trim() : null;
  const xmlText = typeof payload.xmlText === "string" ? payload.xmlText : null;

  if (!locale) throw new HttpsError("invalid-argument", "locale is required.");
  if (!xmlText?.trim()) throw new HttpsError("invalid-argument", "xmlText is required.");

  const { locales } = await getLocalesMeta();
  if (!locales.includes(locale)) {
    throw new HttpsError("invalid-argument", `locale must be one of: ${locales.join(", ")}`);
  }

  const strings = parseAndroidXml(xmlText);
  const count = Object.keys(strings).length;
  if (count === 0) {
    throw new HttpsError(
      "invalid-argument",
      "No <string> elements found. Make sure to paste a valid Android strings.xml file."
    );
  }

  const updatedAtEpochMs = Date.now();
  await getDb().collection("app_translations").doc(locale).set({
    locale,
    strings,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtEpochMs,
    updatedByUid: adminUid,
  });

  return { ok: true, locale, updatedAtEpochMs, stringCount: count };
});

// ── Admin: AI translate via Claude (Anthropic) ────────────────────────────────

export const adminAiTranslateStrings = onCall(
  { timeoutSeconds: 300 },
  async (request) => {
    requireAdmin(request);

    const payload = (request.data ?? {}) as Record<string, unknown>;
    const targetLocale = typeof payload.targetLocale === "string" ? payload.targetLocale.trim() : null;
    const sourceStrings =
      payload.sourceStrings && typeof payload.sourceStrings === "object"
        ? (payload.sourceStrings as Record<string, string>)
        : null;
    const onlyMissing = payload.onlyMissing === true;

    if (!targetLocale) throw new HttpsError("invalid-argument", "targetLocale is required.");
    if (targetLocale === "en") throw new HttpsError("invalid-argument", "Cannot AI-translate into English — it is the source language.");

    const { locales, names } = await getLocalesMeta();
    if (!locales.includes(targetLocale)) {
      throw new HttpsError("invalid-argument", `targetLocale '${targetLocale}' is not a supported locale.`);
    }

    if (!sourceStrings || Object.keys(sourceStrings).length === 0) {
      throw new HttpsError("invalid-argument", "sourceStrings (English) is required.");
    }

    const apiKey = await getAnthropicApiKey();

    let keysToTranslate = Object.keys(sourceStrings);
    if (onlyMissing) {
      const currentSnap = await getDb().collection("app_translations").doc(targetLocale).get();
      const current = (currentSnap.data()?.strings ?? {}) as Record<string, string>;
      keysToTranslate = keysToTranslate.filter((k) => !current[k] || current[k].trim() === "");
    }

    if (keysToTranslate.length === 0) {
      return { ok: true, targetLocale, strings: {}, count: 0, message: "All strings already translated." };
    }

    const subset: Record<string, string> = {};
    for (const k of keysToTranslate) subset[k] = sourceStrings[k];

    const targetLanguage = names[targetLocale] || targetLocale;
    const CHUNK_SIZE = 80;
    const allKeys = Object.keys(subset);
    const translated: Record<string, string> = {};

    for (let i = 0; i < allKeys.length; i += CHUNK_SIZE) {
      const chunkKeys = allKeys.slice(i, i + CHUNK_SIZE);
      const chunk: Record<string, string> = {};
      for (const k of chunkKeys) chunk[k] = subset[k];

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          messages: [
            {
              role: "user",
              content: `Translate these Android app strings from English to ${targetLanguage}.

Context: "Trapp" is a real-world GPS trap game — players place hidden traps on a live map and catch other players outdoors in their neighbourhood.

STRICT rules:
- Return ONLY a valid JSON object, no explanation, no markdown, no code block
- JSON keys must be exactly identical to the input keys
- Keep format specifiers unchanged: %1$s  %1$d  %2$d  %3$s  etc.
- Keep escape sequences unchanged: \\n  \\'  &amp;  &lt;  &gt;
- Keep emoji unchanged
- Match capitalisation style: ALL CAPS text → translate then keep ALL CAPS

${JSON.stringify(chunk, null, 2)}`,
            },
          ],
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new HttpsError("internal", `Anthropic API error ${resp.status}: ${errText.slice(0, 300)}`);
      }

      const result = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = result.content?.find((c) => c.type === "text")?.text ?? "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new HttpsError("internal", "AI response contained no JSON object.");

      let parsed: Record<string, string>;
      try {
        parsed = JSON.parse(jsonMatch[0]) as Record<string, string>;
      } catch {
        throw new HttpsError("internal", "AI returned malformed JSON.");
      }

      for (const k of chunkKeys) {
        translated[k] = typeof parsed[k] === "string" ? parsed[k] : chunk[k];
      }
    }

    return { ok: true, targetLocale, strings: translated, count: Object.keys(translated).length };
  }
);
