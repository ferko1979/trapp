import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";
import { functions } from "../firebase";

type TermsResponse = {
  ok?: boolean;
  exists?: boolean;
  title?: string;
  version?: string;
  content?: string;
  isActive?: boolean;
  updatedAtEpochMs?: number | null;
  updatedByUid?: string | null;
  translations?: Record<string, { title: string; content: string }>;
};

type TranslateResponse = {
  ok?: boolean;
  translated?: string;
  targetLocale?: string;
};

const LOCALES: Array<{ code: string; label: string }> = [
  { code: "hu", label: "Hungarian" },
  { code: "de", label: "German" },
  { code: "hr", label: "Croatian" },
  { code: "ro", label: "Romanian" },
  { code: "sk", label: "Slovak" },
];

type Package = {
  id: string;
  name: string;
  description: string;
  duration: string;
  price: number;
  currency: string;
  trialDays: number;
  isActive: boolean;
  isRecurring: boolean;
};

function inputStyle(): React.CSSProperties {
  return { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #475569", background: "#0f172a", color: "white", boxSizing: "border-box" };
}

function sectionCardStyle(): React.CSSProperties {
  return { background: "#1e293b", padding: 20, borderRadius: 12, border: "1px solid #334155" };
}

function formatEpochMs(value?: number | null) {
  if (!value) return "-";
  try { return new Date(value).toLocaleString(); } catch { return "-"; }
}

function fmtDuration(d: string): string {
  const m: Record<string, string> = { "1d":"1 Day","7d":"7 Days","30d":"30 Days","1m":"1 Month","3m":"3 Months","6m":"6 Months","1y":"1 Year" };
  return m[d] ?? d;
}

function fmtMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-EU", { style: "currency", currency: currency || "EUR", minimumFractionDigits: 2 }).format(amount / 100);
}

// ─── Revision logic ───────────────────────────────────────────────────────────

function incrementRevision(current: string): string {
  // Handles: v1, v1.0, v1.2, v1.12, v2, etc.
  const match = current.trim().match(/^v?(\d+)(?:\.(\d+))?/i);
  if (!match) return `${current}-rev${Date.now()}`;
  const major = parseInt(match[1] ?? "1", 10);
  const minor = match[2] !== undefined ? parseInt(match[2], 10) + 1 : 1;
  return `v${major}.${minor}`;
}

// ─── T&C section generator from packages ─────────────────────────────────────

function generatePlanSection(packages: Package[]): string {
  const active = packages.filter((p) => p.isActive);
  if (active.length === 0) return "";

  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const lines: string[] = [];

  lines.push("## Subscription Plans & Pricing");
  lines.push("");
  lines.push(`The following premium plans are available as of ${today}. Prices are shown in the plan currency and may vary by region.`);
  lines.push("");

  active.forEach((pkg, i) => {
    lines.push(`${i + 1}. **${pkg.name}** — ${fmtMoney(pkg.price, pkg.currency)} / ${fmtDuration(pkg.duration)}`);
    if (pkg.description) lines.push(`   ${pkg.description}`);
    if (pkg.trialDays > 0) {
      lines.push(`   • Free trial: ${pkg.trialDays} days. No charge until the trial period ends. Cancel before the billing date to avoid any charge.`);
    }
    if (pkg.isRecurring) {
      lines.push(`   • This is a **recurring subscription**. It will automatically renew at the end of each ${fmtDuration(pkg.duration).toLowerCase()} period.`);
      lines.push(`   • You can cancel at any time from within the app. Cancellation takes effect at the end of the current billing period — you retain access until then.`);
    } else {
      lines.push(`   • One-time purchase. Access is granted for ${fmtDuration(pkg.duration).toLowerCase()} from the date of payment.`);
    }
    lines.push("");
  });

  lines.push("## Cancellation & Refunds");
  lines.push("");
  lines.push("You may cancel a recurring subscription at any time from within the Trap app (Profile → Subscription → Cancel). Cancellation stops future charges. No refund is issued for any remaining time in the current billing period.");
  lines.push("");
  lines.push("If you cancel a trial subscription before the trial period ends, you will not be charged.");
  lines.push("");
  lines.push("## Donations");
  lines.push("");
  lines.push("Optional one-time donations (€1, €5, €15, €30 or a custom amount) may be made from within the app to support development. Donations are voluntary and non-refundable.");

  return lines.join("\n");
}

// ─── Separator markers ─────────────────────────────────────────────────────────

const SECTION_START = "<!-- AUTO:PLANS -->";
const SECTION_END   = "<!-- /AUTO:PLANS -->";

function mergePlanSection(existingContent: string, newSection: string): string {
  const start = existingContent.indexOf(SECTION_START);
  const end   = existingContent.indexOf(SECTION_END);

  const block = `${SECTION_START}\n${newSection}\n${SECTION_END}`;

  if (start !== -1 && end !== -1) {
    return existingContent.slice(0, start) + block + existingContent.slice(end + SECTION_END.length);
  }
  // Append at end
  return existingContent.trimEnd() + "\n\n" + block;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TermsAndConditionsPanel() {
  const [title, setTitle] = useState("Terms & Conditions");
  const [version, setVersion] = useState("v1");
  const [content, setContent] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [updatedAtEpochMs, setUpdatedAtEpochMs] = useState<number | null>(null);
  const [updatedByUid, setUpdatedByUid] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Record<string, { title: string; content: string }>>({});
  const [translatingLocale, setTranslatingLocale] = useState<string | null>(null);
  const [translateAll, setTranslateAll] = useState(false);
  const [activeLocaleTab, setActiveLocaleTab] = useState<string>("en");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [preview, setPreview] = useState(false);

  async function loadTerms() {
    setLoading(true);
    setResult("");
    try {
      const fn = httpsCallable<unknown, TermsResponse>(functions, "adminGetTermsAndConditions");
      const res = await fn();
      const data = res.data;
      setTitle(data.title ?? "Terms & Conditions");
      setVersion(data.version ?? "v1");
      setContent(data.content ?? "");
      setIsActive(data.isActive !== false);
      setUpdatedAtEpochMs(data.updatedAtEpochMs ?? null);
      setUpdatedByUid(data.updatedByUid ?? null);
      if (data.translations) setTranslations(data.translations);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Failed to load terms.");
    } finally {
      setLoading(false);
    }
  }

  async function saveTerms() {
    setLoading(true);
    setResult("");
    try {
      const mergedTranslations = {
        ...translations,
        en: { title: title.trim(), content },
      };
      const fn = httpsCallable<{ title: string; version: string; content: string; isActive: boolean; translations: Record<string, { title: string; content: string }> }, TermsResponse>(functions, "adminUpdateTermsAndConditions");
      const res = await fn({ title: title.trim(), version: version.trim(), content, isActive, translations: mergedTranslations });
      const data = res.data;
      setUpdatedAtEpochMs(data.updatedAtEpochMs ?? null);
      setUpdatedByUid(data.updatedByUid ?? null);
      setResult(`✓ Saved as ${version}.`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Failed to save terms.");
    } finally {
      setLoading(false);
    }
  }

  async function translateLocale(locale: string): Promise<boolean> {
    setTranslatingLocale(locale);
    try {
      const fn = httpsCallable<{ text: string; targetLocale: string }, TranslateResponse>(functions, "adminTranslateTermsContent");
      const res = await fn({ text: content, targetLocale: locale });
      const translated = res.data.translated ?? "";
      if (!translated) return false;
      const localeMeta = LOCALES.find((l) => l.code === locale);
      setTranslations((prev) => ({
        ...prev,
        [locale]: { title: localeMeta?.label ? `${localeMeta.label} Terms & Conditions` : title, content: translated },
      }));
      return true;
    } catch {
      return false;
    } finally {
      setTranslatingLocale(null);
    }
  }

  async function translateAllLocales() {
    if (!content.trim()) {
      setResult("⚠ No English content to translate. Save the EN content first.");
      return;
    }
    setTranslateAll(true);
    setResult("");
    const failed: string[] = [];
    for (const loc of LOCALES) {
      const ok = await translateLocale(loc.code);
      if (!ok) failed.push(loc.label);
    }
    setTranslateAll(false);
    if (failed.length === 0) {
      setResult(`✓ All ${LOCALES.length} languages translated. Review each tab, then click Save.`);
    } else {
      setResult(`⚠ Done with errors. Failed: ${failed.join(", ")}. Others translated successfully.`);
    }
  }

  async function syncFromPlans() {
    setSyncing(true);
    setResult("");
    try {
      // Load current packages
      const fn = httpsCallable<unknown, { ok: boolean; packages: Package[] }>(functions, "adminListPaymentPackages");
      const res = await fn();
      const packages = res.data.packages;

      const planSection = generatePlanSection(packages);
      if (!planSection) {
        setResult("⚠ No active packages found. Create packages in Payment Packages first.");
        return;
      }

      const newContent = mergePlanSection(content, planSection);
      const newVersion = incrementRevision(version);

      setContent(newContent);
      setVersion(newVersion);
      setResult(`✓ Plan section generated for ${packages.filter((p) => p.isActive).length} active package(s). Revision bumped to ${newVersion}. Review and click Save when ready.`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Failed to sync from plans.");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => { void loadTerms(); }, []);

  return (
    <section style={sectionCardStyle()}>
      <h2 style={{ marginTop: 0 }}>Terms & Conditions</h2>

      <div style={{ display: "grid", gap: 16, maxWidth: 960 }}>

        {/* Auto-sync card */}
        <div style={{ background: "rgba(96,165,250,0.07)", border: "1px solid rgba(96,165,250,0.25)", borderRadius: 10, padding: "16px 18px" }}>
          <div style={{ fontWeight: 700, color: "#93c5fd", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
            <span>⚡</span> Auto-generate from Payment Plans
          </div>
          <p style={{ fontSize: "0.85rem", color: "#64748b", margin: "0 0 12px", lineHeight: 1.6 }}>
            Click the button below to pull your current active payment packages and automatically insert/update a <strong style={{ color: "#94a3b8" }}>Subscription Plans &amp; Pricing</strong> section into the T&amp;C content.
            The revision number will be incremented automatically. <strong style={{ color: "#94a3b8" }}>Review the changes, then click Save.</strong>
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="btn-primary"
              onClick={() => void syncFromPlans()}
              disabled={syncing || loading}
              style={{ background: "rgba(96,165,250,0.2)", border: "1px solid rgba(96,165,250,0.4)", color: "#93c5fd" }}
            >
              {syncing ? "⏳ Generating…" : "⚡ Generate from Plans"}
            </button>
            <button onClick={() => setPreview((p) => !p)}>
              {preview ? "✏️ Edit mode" : "👁 Preview"}
            </button>
            <span style={{ fontSize: "0.78rem", color: "#475569" }}>
              Existing content is preserved — only the plan section is replaced.
            </span>
          </div>
        </div>

        {/* Language tabs + translate */}
        <div style={{ background: "rgba(167,139,250,0.07)", border: "1px solid rgba(167,139,250,0.25)", borderRadius: 10, padding: "16px 18px" }}>
          <div style={{ fontWeight: 700, color: "#c4b5fd", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
            <span>🌐</span> Multi-language Translation
          </div>
          <p style={{ fontSize: "0.85rem", color: "#64748b", margin: "0 0 12px", lineHeight: 1.6 }}>
            Auto-translate the English content into all supported languages using Google Translate.
            <strong style={{ color: "#94a3b8" }}> English content must be saved first.</strong> Review each language tab after translating.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {/* EN tab */}
            <button
              onClick={() => setActiveLocaleTab("en")}
              style={{
                padding: "5px 14px", borderRadius: 20, fontSize: "0.82rem", cursor: "pointer",
                background: activeLocaleTab === "en" ? "#1565C0" : "#1e293b",
                border: activeLocaleTab === "en" ? "1px solid #42A5F5" : "1px solid #334155",
                color: activeLocaleTab === "en" ? "white" : "#94a3b8",
              }}
            >EN — English ✎</button>
            {LOCALES.map((loc) => {
              const hasContent = !!translations[loc.code]?.content;
              const isTranslating = translatingLocale === loc.code;
              return (
                <button
                  key={loc.code}
                  onClick={() => setActiveLocaleTab(loc.code)}
                  style={{
                    padding: "5px 14px", borderRadius: 20, fontSize: "0.82rem", cursor: "pointer",
                    background: activeLocaleTab === loc.code ? "#5b21b6" : "#1e293b",
                    border: activeLocaleTab === loc.code ? "1px solid #a78bfa" : "1px solid #334155",
                    color: activeLocaleTab === loc.code ? "white" : hasContent ? "#a78bfa" : "#475569",
                  }}
                >
                  {isTranslating ? "⏳" : hasContent ? "✓" : "○"} {loc.code.toUpperCase()} — {loc.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="btn-primary"
              onClick={() => void translateAllLocales()}
              disabled={translateAll || loading || translatingLocale !== null}
              style={{ background: "rgba(167,139,250,0.2)", border: "1px solid rgba(167,139,250,0.4)", color: "#c4b5fd" }}
            >
              {translateAll ? `⏳ Translating ${translatingLocale?.toUpperCase() ?? ""}…` : "🌐 Translate to All Languages"}
            </button>
            {LOCALES.map((loc) => (
              <button
                key={loc.code}
                onClick={() => void translateLocale(loc.code).then((ok) => ok && setResult(`✓ ${loc.label} translated. Review the tab, then click Save.`))}
                disabled={translateAll || translatingLocale !== null || loading}
                style={{ padding: "5px 12px", fontSize: "0.78rem", borderRadius: 8, background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", cursor: "pointer" }}
              >
                {translatingLocale === loc.code ? "⏳" : loc.code.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Title + Version */}
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 220px" }}>
          <div>
            <label style={{ fontSize: 12, opacity: 0.9, marginBottom: 4, display: "block" }}>Title</label>
            <input style={inputStyle()} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Terms & Conditions" />
          </div>
          <div>
            <label style={{ fontSize: 12, opacity: 0.9, marginBottom: 4, display: "block" }}>
              Version / Revision <span style={{ color: "#64748b", fontWeight: 400 }}>(auto-incremented on sync)</span>
            </label>
            <input style={inputStyle()} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v1" />
          </div>
        </div>

        {/* Content / Preview — EN or locale tab */}
        {activeLocaleTab === "en" ? (
          preview ? (
            <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: "18px 20px", minHeight: 400, maxHeight: 700, overflowY: "auto" }}>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "0.875rem", color: "#e2e8f0", lineHeight: 1.7, fontFamily: "inherit" }}>{content || <span style={{ color: "#475569" }}>No content yet.</span>}</pre>
            </div>
          ) : (
            <div>
              <label style={{ fontSize: 12, opacity: 0.9, marginBottom: 4, display: "block" }}>Content (English)</label>
              <textarea
                style={{ ...inputStyle(), minHeight: 480, resize: "vertical", fontFamily: "monospace", fontSize: "0.85rem", lineHeight: 1.6 }}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Paste the full legal text here… or use ⚡ Generate from Plans to auto-fill the pricing section."
              />
            </div>
          )
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={{ fontSize: 12, opacity: 0.9 }}>
                Content ({LOCALES.find((l) => l.code === activeLocaleTab)?.label ?? activeLocaleTab})
              </label>
              <button
                onClick={() => void translateLocale(activeLocaleTab).then((ok) => ok && setResult(`✓ ${activeLocaleTab.toUpperCase()} re-translated. Review and click Save.`))}
                disabled={translatingLocale !== null || loading}
                style={{ padding: "4px 10px", fontSize: "0.78rem", borderRadius: 8, background: "#1e293b", border: "1px solid rgba(167,139,250,0.4)", color: "#c4b5fd", cursor: "pointer" }}
              >
                {translatingLocale === activeLocaleTab ? "⏳ Translating…" : "🔄 Re-translate"}
              </button>
            </div>
            <textarea
              style={{ ...inputStyle(), minHeight: 480, resize: "vertical", fontFamily: "monospace", fontSize: "0.85rem", lineHeight: 1.6 }}
              value={translations[activeLocaleTab]?.content ?? ""}
              onChange={(e) => setTranslations((prev) => ({
                ...prev,
                [activeLocaleTab]: { title: prev[activeLocaleTab]?.title ?? title, content: e.target.value },
              }))}
              placeholder={`Translated content will appear here after clicking 🌐 Translate…`}
            />
          </div>
        )}

        {/* T&C active toggle */}
        <label style={{ display: "flex", gap: 8, alignItems: "center", background: "#0f172a", padding: 12, borderRadius: 8, border: "1px solid #334155" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span>T&amp;C is active and should be shown to users</span>
        </label>

        {/* Meta */}
        <div style={{ fontSize: 13, opacity: 0.8, color: "#64748b" }}>
          Last saved: {formatEpochMs(updatedAtEpochMs)} · By: {updatedByUid ?? "-"} · Revision: <strong style={{ color: "#93c5fd" }}>{version}</strong>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-primary" onClick={() => void saveTerms()} disabled={loading}>
            {loading ? "Saving…" : `Save as ${version}`}
          </button>
          <button onClick={() => void loadTerms()} disabled={loading}>Reload</button>
        </div>

        {result && (
          <div style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: result.startsWith("⚠") || result.toLowerCase().includes("failed") ? "rgba(239,68,68,0.1)" : "rgba(22,163,74,0.1)",
            border: `1px solid ${result.startsWith("⚠") || result.toLowerCase().includes("failed") ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
            color: result.startsWith("⚠") || result.toLowerCase().includes("failed") ? "#f87171" : "#4ade80",
            fontSize: "0.875rem",
            whiteSpace: "pre-wrap",
          }}>
            {result}
          </div>
        )}
      </div>
    </section>
  );
}
