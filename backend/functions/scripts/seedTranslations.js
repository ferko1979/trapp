/**
 * One-shot seed script: imports all Android strings.xml files into Firestore.
 * Run from the functions/ directory:
 *   node scripts/seedTranslations.js
 */

const admin = require("firebase-admin");
const path  = require("path");
const fs    = require("fs");

// ── Init ──────────────────────────────────────────────────────────────────────
const serviceAccount = require(path.resolve(__dirname, "../../serviceAccountKey.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: "playtrapnow",
});

const db = admin.firestore();

// ── XML parser (mirrors the Cloud Function logic) ─────────────────────────────
function parseAndroidXml(xmlText) {
  const strings = {};
  const re = /<string name="([^"]+)">([\s\S]*?)<\/string>/g;
  let m;
  while ((m = re.exec(xmlText)) !== null) {
    const key   = m[1];
    const value = m[2]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g,  "<")
      .replace(/&gt;/g,  ">")
      .replace(/&apos;/g,"'")
      .replace(/&quot;/g,'"')
      .replace(/\\n/g,   "\n")
      .replace(/\\'/g,   "'")
      .replace(/\\"/g,   '"');
    strings[key] = value;
  }
  return strings;
}

// ── Locale → file path map ───────────────────────────────────────────────────
const RES_DIR = "C:/Users/ferko/AndroidStudioProjects/Trap/app/src/main/res";

const LOCALES = [
  { locale: "en", file: `${RES_DIR}/values/strings.xml` },
  { locale: "hu", file: `${RES_DIR}/values-hu/strings.xml` },
  { locale: "de", file: `${RES_DIR}/values-de/strings.xml` },
  { locale: "hr", file: `${RES_DIR}/values-hr/strings.xml` },
  { locale: "ro", file: `${RES_DIR}/values-ro/strings.xml` },
  { locale: "sk", file: `${RES_DIR}/values-sk/strings.xml` },
];

// ── Seed ──────────────────────────────────────────────────────────────────────
async function seed() {
  const now = Date.now();

  for (const { locale, file } of LOCALES) {
    const xmlText = fs.readFileSync(file, "utf8");
    const strings = parseAndroidXml(xmlText);
    const count   = Object.keys(strings).length;
    console.log(`[${locale}] Parsed ${count} strings from ${file}`);

    await db.collection("app_translations").doc(locale).set({
      locale,
      strings,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtEpochMs: now,
      updatedByUid: "seed-script",
    });
    console.log(`  ✓ Written app_translations/${locale}`);
  }

  // Ensure meta doc exists
  const metaRef  = db.collection("app_translations").doc("meta");
  const metaSnap = await metaRef.get();
  if (!metaSnap.exists) {
    await metaRef.set({
      supportedLocales: ["en", "hu", "de", "hr", "ro", "sk"],
      localeNames: {
        en: "English",
        hu: "Magyar (Hungarian)",
        de: "Deutsch (German)",
        hr: "Hrvatski (Croatian)",
        ro: "Română (Romanian)",
        sk: "Slovenčina (Slovak)",
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("✓ Created app_translations/meta with default locales");
  } else {
    console.log("  app_translations/meta already exists — skipped");
  }

  console.log("\nDone! All locales imported. Open Admin Panel → App Translations to verify.");
  process.exit(0);
}

seed().catch((err) => { console.error(err); process.exit(1); });
