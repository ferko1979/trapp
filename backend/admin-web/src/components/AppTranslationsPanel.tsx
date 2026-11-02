import { useState, useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

// ── Locale helpers ────────────────────────────────────────────────────────────

const KNOWN_FLAGS: Record<string, string> = {
  en: "🇬🇧", hu: "🇭🇺", de: "🇩🇪", hr: "🇭🇷", ro: "🇷🇴", sk: "🇸🇰",
  fr: "🇫🇷", es: "🇪🇸", it: "🇮🇹", pt: "🇵🇹", pl: "🇵🇱", cs: "🇨🇿",
  nl: "🇳🇱", sv: "🇸🇪", da: "🇩🇰", fi: "🇫🇮", nb: "🇳🇴", ru: "🇷🇺",
  uk: "🇺🇦", bg: "🇧🇬", el: "🇬🇷", tr: "🇹🇷", ar: "🇸🇦", zh: "🇨🇳",
  ja: "🇯🇵", ko: "🇰🇷", sl: "🇸🇮", sr: "🇷🇸", bs: "🇧🇦", mk: "🇲🇰",
  sq: "🇦🇱", lt: "🇱🇹", lv: "🇱🇻", et: "🇪🇪",
};

function localeFlag(locale: string) {
  return KNOWN_FLAGS[locale] ?? "🌐";
}

// ── Types ─────────────────────────────────────────────────────────────────────

type LocaleData = { strings: Record<string, string>; updatedAtEpochMs: number; stringCount: number };

// ── Component ─────────────────────────────────────────────────────────────────

export default function AppTranslationsPanel() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Dynamic locale list loaded from backend
  const [supportedLocales, setSupportedLocales] = useState<string[]>([]);
  const [localeNames, setLocaleNames] = useState<Record<string, string>>({});

  const [activeLocale, setActiveLocale] = useState("en");
  const [allStrings, setAllStrings] = useState<Record<string, Record<string, string>>>({});
  const [serverMeta, setServerMeta] = useState<Record<string, number>>({});

  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [translating, setTranslating] = useState(false);
  const [translateMsg, setTranslateMsg] = useState("");

  // Import XML
  const [showImport, setShowImport] = useState(false);
  const [importLocale, setImportLocale] = useState("en");
  const [importXml, setImportXml] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");

  // Add language
  const [showAddLang, setShowAddLang] = useState(false);
  const [newLocaleCode, setNewLocaleCode] = useState("");
  const [newLocaleName, setNewLocaleName] = useState("");
  const [addingLang, setAddingLang] = useState(false);
  const [addLangMsg, setAddLangMsg] = useState("");

  // Remove language
  const [removingLocale, setRemovingLocale] = useState<string | null>(null);

  const [filterMissing, setFilterMissing] = useState(false);

  // AI key (inline status only — full management in Admin Tools → AI / API Keys)
  const [apiKeyMasked, setApiKeyMasked] = useState<string | null>(null);
  const [showKeySection, setShowKeySection] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyMsg, setKeyMsg] = useState("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const fn = httpsCallable<void, {
        locales: Record<string, LocaleData>;
        localeNames: Record<string, string>;
        supportedLocales: string[];
      }>(functions, "adminGetAllTranslations");
      const res = await fn();

      const locales = res.data.locales;
      const names = res.data.localeNames;
      const locs = res.data.supportedLocales;

      setSupportedLocales(locs);
      setLocaleNames(names);

      const newStrings = Object.fromEntries(locs.map((l) => [l, { ...(locales[l]?.strings ?? {}) }]));
      const newMeta = Object.fromEntries(locs.map((l) => [l, locales[l]?.updatedAtEpochMs ?? 0]));
      setAllStrings(newStrings);
      setServerMeta(newMeta);

      if (!locs.includes(activeLocale)) setActiveLocale(locs[0] ?? "en");

      // Check API key status
      try {
        const keyFn = httpsCallable<void, { configured: boolean; masked: string | null }>(
          functions, "adminCheckAiApiKey"
        );
        const keyRes = await keyFn();
        setApiKeyMasked(keyRes.data.configured ? keyRes.data.masked : null);
      } catch { /* non-critical */ }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load translations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const enKeys = Object.keys(allStrings["en"] ?? {});

  const filteredKeys = enKeys.filter((k) => {
    if (filterMissing && activeLocale !== "en") {
      if (allStrings[activeLocale]?.[k]?.trim()) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        k.toLowerCase().includes(q) ||
        (allStrings[activeLocale]?.[k] ?? "").toLowerCase().includes(q) ||
        (allStrings["en"]?.[k] ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  function handleEdit(key: string, value: string) {
    setAllStrings((prev) => ({ ...prev, [activeLocale]: { ...prev[activeLocale], [key]: value } }));
    setSaveMsg("");
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg("");
    try {
      const fn = httpsCallable<unknown, { updatedAtEpochMs: number; stringCount: number }>(
        functions, "adminUpdateAppTranslations"
      );
      const res = await fn({ locale: activeLocale, strings: allStrings[activeLocale] });
      setServerMeta((prev) => ({ ...prev, [activeLocale]: res.data.updatedAtEpochMs }));
      setSaveMsg(`✓ ${localeNames[activeLocale] ?? activeLocale} saved — ${res.data.stringCount} strings`);
    } catch (e: unknown) {
      setSaveMsg(`Error: ${e instanceof Error ? e.message : "Save failed"}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleAiTranslate(onlyMissing: boolean) {
    setTranslating(true);
    const name = localeNames[activeLocale] ?? activeLocale.toUpperCase();
    setTranslateMsg(onlyMissing ? `Translating missing strings to ${name} via AI…` : `Retranslating all strings to ${name} via AI…`);
    try {
      const fn = httpsCallable<unknown, { strings: Record<string, string>; count: number; message?: string }>(
        functions, "adminAiTranslateStrings"
      );
      const res = await fn({ targetLocale: activeLocale, sourceStrings: allStrings["en"], onlyMissing });
      if (res.data.count === 0 && res.data.message) {
        setTranslateMsg(`✓ ${res.data.message}`);
        return;
      }
      setAllStrings((prev) => ({ ...prev, [activeLocale]: { ...prev[activeLocale], ...res.data.strings } }));
      setTranslateMsg(`✓ ${res.data.count} strings translated. Review below and click Save.`);
    } catch (e: unknown) {
      setTranslateMsg(`Error: ${e instanceof Error ? e.message : "Translation failed"}`);
    } finally {
      setTranslating(false);
    }
  }

  async function handleImport() {
    if (!importXml.trim()) return;
    setImporting(true);
    setImportMsg("");
    try {
      const fn = httpsCallable<unknown, { stringCount: number }>(functions, "adminImportXmlTranslations");
      const res = await fn({ locale: importLocale, xmlText: importXml });
      setImportMsg(`✓ Imported ${res.data.stringCount} strings into ${importLocale.toUpperCase()}.`);
      setImportXml("");
      await load();
    } catch (e: unknown) {
      setImportMsg(`Error: ${e instanceof Error ? e.message : "Import failed"}`);
    } finally {
      setImporting(false);
    }
  }

  async function handleAddLanguage() {
    if (!newLocaleCode.trim()) return;
    setAddingLang(true);
    setAddLangMsg("");
    try {
      const fn = httpsCallable<unknown, { locales: string[]; names: Record<string, string> }>(
        functions, "adminAddLanguage"
      );
      const res = await fn({ locale: newLocaleCode.trim().toLowerCase(), languageName: newLocaleName.trim() || newLocaleCode.trim() });
      setSupportedLocales(res.data.locales);
      setLocaleNames(res.data.names);
      setAllStrings((prev) => ({ ...prev, [newLocaleCode.trim().toLowerCase()]: {} }));
      setServerMeta((prev) => ({ ...prev, [newLocaleCode.trim().toLowerCase()]: 0 }));
      setAddLangMsg(`✓ Language '${newLocaleCode.trim()}' added.`);
      setNewLocaleCode("");
      setNewLocaleName("");
    } catch (e: unknown) {
      setAddLangMsg(`Error: ${e instanceof Error ? e.message : "Failed"}`);
    } finally {
      setAddingLang(false);
    }
  }

  async function handleRemoveLanguage(locale: string) {
    setRemovingLocale(locale);
    try {
      const fn = httpsCallable<unknown, { locales: string[]; names: Record<string, string> }>(
        functions, "adminRemoveLanguage"
      );
      const res = await fn({ locale });
      setSupportedLocales(res.data.locales);
      setLocaleNames(res.data.names);
      if (activeLocale === locale) setActiveLocale("en");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to remove language.");
    } finally {
      setRemovingLocale(null);
    }
  }

  async function handleSaveApiKey() {
    if (!apiKeyInput.trim()) return;
    setSavingKey(true);
    setKeyMsg("");
    try {
      await httpsCallable(functions, "adminSetAiApiKey")({ anthropicApiKey: apiKeyInput.trim() });
      setApiKeyMasked(`sk-ant-...${apiKeyInput.trim().slice(-4)}`);
      setApiKeyInput("");
      setKeyMsg("✓ API key saved.");
    } catch (e: unknown) {
      setKeyMsg(`Error: ${e instanceof Error ? e.message : "Failed"}`);
    } finally {
      setSavingKey(false);
    }
  }

  const missingCount = activeLocale !== "en"
    ? enKeys.filter((k) => !allStrings[activeLocale]?.[k]?.trim()).length
    : 0;

  function coverageColor(loc: string) {
    const enCount = enKeys.length;
    if (enCount === 0) return "#64748b";
    const filled = enKeys.filter((k) => allStrings[loc]?.[k]?.trim()).length;
    const pct = filled / enCount;
    return pct >= 1 ? "#22c55e" : pct > 0.5 ? "#f59e0b" : "#ef4444";
  }

  if (loading) return <div style={{ color: "#64748b", padding: 32 }}>Loading translations…</div>;
  if (err) return (
    <div style={{ color: "#fca5a5", padding: 32 }}>
      {err}
      <button onClick={load} style={{ marginLeft: 12, color: "#93c5fd", cursor: "pointer", background: "none", border: "none" }}>Retry</button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* Coverage overview + actions */}
      <div style={{
        background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 12,
        padding: "16px 20px", display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap",
      }}>
        <div style={{ flex: 1, display: "flex", gap: 20, flexWrap: "wrap" }}>
          {supportedLocales.map((loc) => {
            const enCount = enKeys.length;
            const filled = enCount > 0 ? enKeys.filter((k) => allStrings[loc]?.[k]?.trim()).length : 0;
            const pct = enCount > 0 ? Math.round((filled / enCount) * 100) : 0;
            return (
              <div key={loc} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: "0.7rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {localeFlag(loc)} {loc.toUpperCase()}
                </span>
                <span style={{ fontSize: "0.95rem", fontWeight: 700, color: coverageColor(loc) }}>{pct}%</span>
                <span style={{ fontSize: "0.68rem", color: "#475569" }}>
                  {filled}/{enCount}
                  {serverMeta[loc] > 0 && (
                    <span style={{ marginLeft: 4, color: "#334155" }}>
                      · {new Date(serverMeta[loc]).toLocaleDateString()}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => { setShowAddLang(true); setAddLangMsg(""); }} style={ghostBtn}>
            ➕ Add Language
          </button>
          <button onClick={() => setShowImport(true)} style={ghostBtn}>
            📥 Import XML
          </button>
          <button onClick={load} style={{ ...ghostBtn, color: "#64748b" }}>↻ Reload</button>
        </div>
      </div>

      {/* AI API key (inline, quick access) */}
      <div style={{
        background: "#0a1628", border: `1px solid ${apiKeyMasked ? "#14532d" : "#713f12"}`,
        borderRadius: 10, overflow: "hidden",
      }}>
        <button onClick={() => setShowKeySection((v) => !v)} style={{
          width: "100%", padding: "12px 16px", background: "transparent", border: "none",
          display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
        }}>
          <span style={{ fontSize: "1rem" }}>{apiKeyMasked ? "🤖" : "⚠️"}</span>
          <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#e2e8f0", flex: 1 }}>Claude AI Translation</span>
          <span style={{
            fontSize: "0.75rem", padding: "2px 8px", borderRadius: 10,
            background: apiKeyMasked ? "rgba(20,83,45,0.5)" : "rgba(113,63,18,0.4)",
            color: apiKeyMasked ? "#4ade80" : "#fde68a",
          }}>
            {apiKeyMasked ? `Configured · ${apiKeyMasked}` : "Not configured"}
          </span>
          <span style={{ color: "#475569", fontSize: "0.8rem" }}>{showKeySection ? "▲" : "▼"}</span>
        </button>
        {showKeySection && (
          <div style={{ padding: "0 16px 16px", borderTop: "1px solid #1e3a5f" }}>
            <p style={{ fontSize: "0.8rem", color: "#64748b", margin: "12px 0 10px", lineHeight: 1.5 }}>
              Get your key at <span style={{ color: "#93c5fd" }}>console.anthropic.com</span>. Full management in Admin Tools → AI / API Keys.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="password" placeholder="sk-ant-api03-…" value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)} style={monoInput} />
              <button onClick={handleSaveApiKey} disabled={savingKey || !apiKeyInput.trim()} style={primaryBtn}>
                {savingKey ? "Saving…" : "Save Key"}
              </button>
            </div>
            {keyMsg && <StatusMsg msg={keyMsg} />}
          </div>
        )}
      </div>

      {/* No English strings warning */}
      {enKeys.length === 0 && (
        <div style={{
          padding: "16px 20px", background: "#1c1200", border: "1px solid #713f12",
          borderRadius: 10, color: "#fde68a", fontSize: "0.875rem", lineHeight: 1.6,
        }}>
          <strong>No strings loaded yet.</strong> Click <strong>Import XML</strong> above and paste the contents of
          your Android <code>app/src/main/res/values/strings.xml</code> to seed the English source strings.
          Then use AI translate on each other language tab.
        </div>
      )}

      {/* Locale tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {supportedLocales.map((loc) => {
          const missing = loc !== "en" ? enKeys.filter((k) => !allStrings[loc]?.[k]?.trim()).length : 0;
          const active = activeLocale === loc;
          return (
            <div key={loc} style={{ position: "relative" }}>
              <button
                onClick={() => { setActiveLocale(loc); setSearch(""); setFilterMissing(false); setSaveMsg(""); setTranslateMsg(""); }}
                style={{
                  padding: "9px 18px",
                  background: active ? "#1d4ed8" : "#0a1628",
                  border: `1px solid ${active ? "#3b82f6" : "#1e3a5f"}`,
                  borderRadius: 9,
                  color: active ? "#fff" : "#94a3b8",
                  fontWeight: active ? 700 : 400,
                  cursor: "pointer", fontSize: "0.875rem",
                  display: "flex", alignItems: "center", gap: 6,
                  paddingRight: loc !== "en" ? "32px" : "18px",
                }}
              >
                <span>{localeFlag(loc)}</span>
                <span>{loc.toUpperCase()}</span>
                {missing > 0 && (
                  <span style={{
                    background: active ? "rgba(255,255,255,0.25)" : "#dc2626",
                    color: "#fff", borderRadius: 10, padding: "1px 6px",
                    fontSize: "0.68rem", fontWeight: 700, minWidth: 18, textAlign: "center",
                  }}>
                    {missing}
                  </span>
                )}
              </button>
              {loc !== "en" && (
                <button
                  onClick={() => {
                    if (window.confirm(`Remove '${loc.toUpperCase()}' (${localeNames[loc] ?? loc}) from supported languages?`)) {
                      void handleRemoveLanguage(loc);
                    }
                  }}
                  disabled={removingLocale === loc}
                  title={`Remove ${loc.toUpperCase()}`}
                  style={{
                    position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", color: "#475569", cursor: "pointer",
                    fontSize: "0.7rem", padding: "2px 3px", lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Active locale action bar */}
      <div style={{
        background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 10,
        padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}>
        <div>
          <span style={{ fontWeight: 600, color: "#e2e8f0" }}>
            {localeFlag(activeLocale)} {localeNames[activeLocale] ?? activeLocale.toUpperCase()}
          </span>
          <span style={{ marginLeft: 10, color: "#475569", fontSize: "0.8rem" }}>
            {Object.keys(allStrings[activeLocale] ?? {}).length} strings
            {missingCount > 0 && <span style={{ marginLeft: 8, color: "#f87171" }}>· {missingCount} missing</span>}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        {activeLocale !== "en" && enKeys.length > 0 && (
          <>
            <button onClick={() => handleAiTranslate(true)} disabled={translating || missingCount === 0}
              title="Only translates empty strings"
              style={{
                padding: "7px 13px", background: "#0c1a3d", border: "1px solid #1d4ed8",
                borderRadius: 7, color: translating ? "#475569" : "#93c5fd", fontSize: "0.8rem",
                cursor: translating || missingCount === 0 ? "not-allowed" : "pointer", opacity: missingCount === 0 ? 0.4 : 1,
              }}>
              {translating ? "⏳ Translating…" : `✨ AI Fill Missing (${missingCount})`}
            </button>
            <button onClick={() => handleAiTranslate(false)} disabled={translating}
              style={{
                padding: "7px 13px", background: "rgba(109,40,217,0.12)", border: "1px solid #6d28d9",
                borderRadius: 7, color: translating ? "#475569" : "#c4b5fd", fontSize: "0.8rem",
                cursor: translating ? "not-allowed" : "pointer",
              }}>
              {translating ? "⏳" : "✨ AI Retranslate All"}
            </button>
          </>
        )}
        <button onClick={handleSave} disabled={saving || enKeys.length === 0} style={{
          padding: "7px 18px", background: "#1d4ed8", border: "1px solid #3b82f6",
          borderRadius: 7, color: "#fff", fontWeight: 600, fontSize: "0.875rem",
          cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1,
        }}>
          {saving ? "Saving…" : `💾 Save ${activeLocale.toUpperCase()}`}
        </button>
      </div>

      {saveMsg && <StatusMsg msg={saveMsg} />}
      {translateMsg && <StatusMsg msg={translateMsg} blue />}

      {/* Search row */}
      {enKeys.length > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="text" placeholder="Search by key or value…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, padding: "9px 14px", background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 8, color: "#e2e8f0", fontSize: "0.875rem", outline: "none" }} />
          {activeLocale !== "en" && missingCount > 0 && (
            <button onClick={() => setFilterMissing((v) => !v)} style={{
              padding: "9px 14px",
              background: filterMissing ? "#3b0000" : "#0a1628",
              border: `1px solid ${filterMissing ? "#ef4444" : "#1e3a5f"}`,
              borderRadius: 8, color: filterMissing ? "#fca5a5" : "#64748b",
              fontSize: "0.8rem", cursor: "pointer", whiteSpace: "nowrap",
            }}>
              {filterMissing ? "✗ Missing only" : "Show missing only"}
            </button>
          )}
          <span style={{ color: "#334155", fontSize: "0.78rem", whiteSpace: "nowrap" }}>
            {filteredKeys.length} of {enKeys.length}
          </span>
        </div>
      )}

      {/* Strings table */}
      {enKeys.length > 0 && (
        <div style={{ background: "#060e1a", border: "1px solid #1e3a5f", borderRadius: 10, overflow: "auto", maxHeight: "calc(100vh - 420px)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ position: "sticky", top: 0, background: "#060e1a", zIndex: 10 }}>
                <th style={thStyle}>Key</th>
                {activeLocale !== "en" && <th style={thStyle}>English</th>}
                <th style={thStyle}>{localeNames[activeLocale] ?? activeLocale.toUpperCase()}</th>
              </tr>
            </thead>
            <tbody>
              {filteredKeys.length === 0 ? (
                <tr><td colSpan={activeLocale !== "en" ? 3 : 2} style={{ padding: 24, color: "#64748b", textAlign: "center" }}>
                  {search ? "No strings match your search." : filterMissing ? "No missing strings — all translated!" : ""}
                </td></tr>
              ) : (
                filteredKeys.map((key, i) => {
                  const value = allStrings[activeLocale]?.[key] ?? "";
                  const enValue = allStrings["en"]?.[key] ?? "";
                  const isEmpty = activeLocale !== "en" && !value.trim();
                  return (
                    <tr key={key} style={{ background: i % 2 === 0 ? "transparent" : "rgba(30,58,95,0.12)" }}>
                      <td style={keyTdStyle}><code style={{ fontSize: "0.72rem", color: "#475569", wordBreak: "break-all" }}>{key}</code></td>
                      {activeLocale !== "en" && (
                        <td style={{ ...valueTdStyle, color: "#64748b", fontSize: "0.78rem" }}>
                          {enValue || <span style={{ color: "#334155", fontStyle: "italic" }}>—</span>}
                        </td>
                      )}
                      <td style={cellTdStyle}>
                        <textarea value={value} onChange={(e) => handleEdit(key, e.target.value)}
                          rows={value.includes("\n") ? 3 : 1}
                          style={{
                            width: "100%", background: isEmpty ? "rgba(220,38,38,0.07)" : "rgba(30,58,95,0.2)",
                            border: `1px solid ${isEmpty ? "rgba(220,38,38,0.4)" : "transparent"}`,
                            borderRadius: 5, color: "#e2e8f0", fontSize: "0.8rem", padding: "5px 8px",
                            resize: "vertical", minHeight: 28, fontFamily: "inherit", outline: "none",
                            boxSizing: "border-box", transition: "border 0.1s, background 0.1s",
                          }}
                          onFocus={(e) => { e.currentTarget.style.border = "1px solid #3b82f6"; e.currentTarget.style.background = "rgba(29,78,216,0.15)"; }}
                          onBlur={(e) => {
                            const miss = activeLocale !== "en" && !e.currentTarget.value.trim();
                            e.currentTarget.style.border = `1px solid ${miss ? "rgba(220,38,38,0.4)" : "transparent"}`;
                            e.currentTarget.style.background = miss ? "rgba(220,38,38,0.07)" : "rgba(30,58,95,0.2)";
                          }} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Language modal */}
      {showAddLang && (
        <Modal onClose={() => { setShowAddLang(false); setAddLangMsg(""); setNewLocaleCode(""); setNewLocaleName(""); }}>
          <h3 style={{ margin: "0 0 4px", fontSize: "1rem", color: "#e2e8f0" }}>Add Language</h3>
          <p style={{ margin: "0 0 16px", fontSize: "0.8rem", color: "#64748b" }}>
            Enter the ISO 639-1 language code and display name. An empty strings document will be created for you to fill via AI or manual import.
          </p>
          <label style={labelStyle}>Language code (e.g. fr, pt, ja)</label>
          <input value={newLocaleCode} onChange={(e) => setNewLocaleCode(e.target.value.toLowerCase().replace(/[^a-z-]/g, ""))}
            placeholder="fr" maxLength={5} style={{ ...monoInput, marginBottom: 10 }} />
          <label style={labelStyle}>Display name (e.g. Français (French))</label>
          <input value={newLocaleName} onChange={(e) => setNewLocaleName(e.target.value)}
            placeholder="Français (French)" style={{ ...monoInput, marginBottom: 14, fontFamily: "inherit" }} />
          {addLangMsg && <div style={{ marginBottom: 12 }}><StatusMsg msg={addLangMsg} /></div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => { setShowAddLang(false); setAddLangMsg(""); }} style={cancelBtn}>Cancel</button>
            <button onClick={handleAddLanguage} disabled={addingLang || !newLocaleCode.trim()} style={primaryBtn}>
              {addingLang ? "Adding…" : "Add Language"}
            </button>
          </div>
        </Modal>
      )}

      {/* Import XML modal */}
      {showImport && (
        <Modal onClose={() => { setShowImport(false); setImportXml(""); setImportMsg(""); }}>
          <h3 style={{ margin: "0 0 4px", fontSize: "1rem", color: "#e2e8f0" }}>Import Android strings.xml</h3>
          <p style={{ margin: "0 0 12px", fontSize: "0.8rem", color: "#64748b" }}>
            Paste the content of <code>values/strings.xml</code> (English) or <code>values-hu/strings.xml</code> etc.
          </p>
          <label style={labelStyle}>Target locale</label>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 12 }}>
            {supportedLocales.map((loc) => (
              <button key={loc} onClick={() => setImportLocale(loc)} style={{
                padding: "5px 12px",
                background: importLocale === loc ? "#1d4ed8" : "#0a1628",
                border: `1px solid ${importLocale === loc ? "#3b82f6" : "#1e3a5f"}`,
                borderRadius: 6, color: importLocale === loc ? "#fff" : "#64748b", cursor: "pointer", fontSize: "0.8rem",
              }}>
                {localeFlag(loc)} {loc.toUpperCase()}
              </button>
            ))}
          </div>
          <textarea value={importXml} onChange={(e) => setImportXml(e.target.value)}
            placeholder={"<resources>\n    <string name=\"app_name\">Trapp</string>\n    ...\n</resources>"}
            style={{ ...monoInput, height: 200, resize: "vertical", display: "block", marginBottom: 12, lineHeight: 1.5 }} />
          {importMsg && <div style={{ marginBottom: 12 }}><StatusMsg msg={importMsg} /></div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => { setShowImport(false); setImportXml(""); setImportMsg(""); }} style={cancelBtn}>Cancel</button>
            <button onClick={handleImport} disabled={importing || !importXml.trim()} style={primaryBtn}>
              {importing ? "Importing…" : `Import into ${importLocale.toUpperCase()}`}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusMsg({ msg, blue }: { msg: string; blue?: boolean }) {
  const isErr = msg.startsWith("Error");
  return (
    <div style={{
      padding: "9px 14px", borderRadius: 8, fontSize: "0.875rem",
      background: isErr ? "#3b0000" : blue ? "#071428" : "#052e16",
      border: `1px solid ${isErr ? "#7f1d1d" : blue ? "#1d4ed8" : "#14532d"}`,
      color: isErr ? "#fca5a5" : blue ? "#93c5fd" : "#4ade80",
    }}>
      {msg}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
    }}>
      <div style={{
        background: "#0b1120", border: "1px solid #1e3a5f", borderRadius: 14,
        padding: 28, width: "92%", maxWidth: 520, maxHeight: "85vh",
        display: "flex", flexDirection: "column", gap: 0, overflow: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "9px 14px", textAlign: "left", fontSize: "0.68rem",
  fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
  color: "#475569", borderBottom: "1px solid #1e3a5f",
};
const keyTdStyle: React.CSSProperties = { padding: "7px 12px", verticalAlign: "top", borderBottom: "1px solid #0d1f35", width: "22%", minWidth: 120 };
const valueTdStyle: React.CSSProperties = { padding: "7px 12px", verticalAlign: "top", borderBottom: "1px solid #0d1f35", width: "30%" };
const cellTdStyle: React.CSSProperties = { padding: "5px 8px", borderBottom: "1px solid #0d1f35" };

const ghostBtn: React.CSSProperties = {
  padding: "7px 13px", background: "#0f1f35", border: "1px solid #1e3a5f",
  borderRadius: 7, color: "#93c5fd", fontSize: "0.8rem", cursor: "pointer",
};
const primaryBtn: React.CSSProperties = {
  padding: "8px 18px", background: "#1d4ed8", border: "1px solid #3b82f6",
  borderRadius: 7, color: "#fff", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer",
};
const cancelBtn: React.CSSProperties = {
  padding: "8px 18px", background: "transparent", border: "1px solid #1e3a5f",
  borderRadius: 7, color: "#64748b", cursor: "pointer", fontSize: "0.875rem",
};
const monoInput: React.CSSProperties = {
  width: "100%", padding: "8px 12px", background: "#060e1a", border: "1px solid #1e3a5f",
  borderRadius: 7, color: "#e2e8f0", fontSize: "0.875rem", outline: "none",
  fontFamily: "monospace", boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#64748b",
  textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6,
};
