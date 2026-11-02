import { useState, useEffect, useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

// ── Types ────────────────────────────────────────────────────────────────────

type TemplateSummary = {
  id: string;
  name: string;
  subject: string;
  type: string;
  locale: string;
  updatedAt: number | null;
};

type TemplateDetail = TemplateSummary & {
  bodyHtml: string;
  bodyText: string;
  variables: string[];
  createdAt: number | null;
};

type TranslateResult = {
  locale: string;
  status: "created" | "updated" | "error";
  error?: string;
};

// ── Constants ────────────────────────────────────────────────────────────────

const SYSTEM_TYPES = [
  { key: "system_password_reset", label: "Password Reset" },
  { key: "system_email_verification", label: "Email Verification" },
  { key: "system_welcome", label: "Welcome Email" },
  { key: "system_purchase", label: "Purchase Confirmation" },
  { key: "system_inactive", label: "We Miss You (Legacy)" },
  { key: "system_reg_unverified_1d", label: "Not Verified: 1-Day Reminder" },
  { key: "system_reg_unverified_3d", label: "Not Verified: 3-Day Reminder" },
  { key: "system_reg_unverified_7d", label: "Not Verified: 7-Day Final Notice" },
  { key: "system_inactive_1d", label: "Inactive: Day 1 Nudge" },
  { key: "system_inactive_3d", label: "Inactive: Day 3 Comeback" },
  { key: "system_inactive_7d", label: "Inactive: Day 7 Re-engagement" },
] as const;

const LOCALES = ["en", "hu", "sk", "ro", "de", "hr", "he"] as const;

const LOCALE_FLAGS: Record<string, string> = {
  en: "🇬🇧", hu: "🇭🇺", sk: "🇸🇰", ro: "🇷🇴", de: "🇩🇪", hr: "🇭🇷", he: "🇮🇱",
};

const TEMPLATE_TYPES = [
  { value: "newsletter", label: "Newsletter" },
  { value: "system_password_reset", label: "System — Password Reset" },
  { value: "system_email_verification", label: "System — Email Verification" },
  { value: "system_welcome", label: "System — Welcome" },
  { value: "system_purchase", label: "System — Purchase Confirmation" },
  { value: "system_inactive", label: "System — We Miss You (Legacy)" },
  { value: "system_reg_unverified_1d", label: "System — Not Verified: 1-Day" },
  { value: "system_reg_unverified_3d", label: "System — Not Verified: 3-Day" },
  { value: "system_reg_unverified_7d", label: "System — Not Verified: 7-Day" },
  { value: "system_inactive_1d", label: "System — Inactive: Day 1" },
  { value: "system_inactive_3d", label: "System — Inactive: Day 3" },
  { value: "system_inactive_7d", label: "System — Inactive: Day 7" },
  { value: "transactional", label: "Transactional" },
  { value: "custom", label: "Custom" },
] as const;

// ── Shared styles ─────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "#F4F7FB",
  border: "1px solid #DCE4EE",
  borderRadius: 12,
  overflow: "hidden",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  background: "#F4F7FB",
  border: "1px solid #DCE4EE",
  borderRadius: 8,
  color: "#0D1F33",
  fontSize: "0.875rem",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.73rem",
  fontWeight: 600,
  color: "#5F7491",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  marginBottom: 6,
};

const btn = (primary?: boolean, danger?: boolean): React.CSSProperties => ({
  padding: "8px 16px",
  background: danger ? "#F5C2C9" : primary ? "#0B6C86" : "transparent",
  border: `1px solid ${danger ? "#C8283B" : primary ? "#0B6C86" : "#DCE4EE"}`,
  borderRadius: 7,
  color: danger ? "#C8283B" : primary ? "#fff" : "#3C516C",
  fontWeight: 600,
  fontSize: "0.8rem",
  cursor: "pointer",
});

// ── Main component ────────────────────────────────────────────────────────────

type Tab = "system" | "custom" | "automation" | "gateway";

export default function EmailTemplatesPanel() {
  const [tab, setTab] = useState<Tab>("system");
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<TemplateDetail | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const fn = httpsCallable<void, { ok: boolean; templates: TemplateSummary[] }>(
        functions, "adminListEmailTemplates"
      );
      const res = await fn();
      setTemplates(res.data.templates);
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : "Failed to load templates"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  async function openEditor(id: string) {
    const fn = httpsCallable<{ id: string }, { ok: boolean; template: TemplateDetail }>(
      functions, "adminGetEmailTemplate"
    );
    const res = await fn({ id });
    setEditing(res.data.template);
  }

  if (editing) {
    return (
      <EditorView
        initial={editing}
        onSaved={() => { setEditing(null); void loadTemplates(); }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  const systemTemplates = templates.filter((t) => t.type.startsWith("system_"));
  const customTemplates = templates.filter((t) => !t.type.startsWith("system_"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {([["system", "⚙️ System Templates"], ["custom", "📄 Custom / Newsletter"], ["automation", "🤖 Automation"], ["gateway", "📡 Email Gateway"]] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...btn(tab === t),
              padding: "10px 20px",
              borderRadius: 8,
              fontSize: "0.875rem",
              background: tab === t ? "#0B6C86" : "transparent",
              color: tab === t ? "#fff" : "#5F7491",
            }}
          >
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => void loadTemplates()} style={btn()}>↻ Refresh</button>
        {tab === "custom" && (
          <button
            onClick={() =>
              setEditing({
                id: "", name: "", subject: "", bodyHtml: "", bodyText: "",
                type: "newsletter", locale: "en", variables: [],
                createdAt: null, updatedAt: null,
              })
            }
            style={btn(true)}
          >
            + New Template
          </button>
        )}
      </div>

      {msg && (
        <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: "0.875rem", background: "#FDE7EA", border: "1px solid #F5C2C9", color: "#C8283B" }}>
          {msg}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#5F7491", padding: 20 }}>Loading templates…</div>
      ) : tab === "system" ? (
        <SystemTab
          systemTemplates={systemTemplates}
          onEdit={openEditor}
          onRefresh={loadTemplates}
          setMsg={setMsg}
        />
      ) : tab === "automation" ? (
        <AutomationTab setMsg={setMsg} />
      ) : tab === "gateway" ? (
        <GatewayTab setMsg={setMsg} />
      ) : (
        <CustomTab
          templates={customTemplates}
          onEdit={openEditor}
          onRefresh={loadTemplates}
          setMsg={setMsg}
        />
      )}
    </div>
  );
}

// ── System Tab ────────────────────────────────────────────────────────────────

function SystemTab({
  systemTemplates,
  onEdit,
  onRefresh,
  setMsg,
}: {
  systemTemplates: TemplateSummary[];
  onEdit: (id: string) => Promise<void>;
  onRefresh: () => void;
  setMsg: (m: string) => void;
}) {
  const [seeding, setSeeding] = useState(false);
  const [translating, setTranslating] = useState<string | null>(null);
  const [translateResults, setTranslateResults] = useState<TranslateResult[] | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState<string | null>(null);

  async function seedDefaults(overwrite = false) {
    setSeeding(true);
    setMsg("");
    try {
      const fn = httpsCallable<{ overwrite: boolean }, { ok: boolean; seeded: string[]; skipped: string[] }>(
        functions, "adminSeedSystemTemplates"
      );
      const res = await fn({ overwrite });
      const { seeded, skipped } = res.data;
      setMsg(`Seeded: ${seeded.join(", ") || "none"} — Skipped (already exist): ${skipped.join(", ") || "none"}`);
      onRefresh();
    } catch (e: unknown) {
      setMsg(`Seed error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSeeding(false);
    }
  }

  async function aiTranslate(type: string) {
    const source = systemTemplates.find((t) => t.type === type && t.locale === "en");
    if (!source) {
      setMsg(`No English (en) template for "${type}". Seed defaults first.`);
      return;
    }
    setTranslating(type);
    setTranslateResults(null);
    setMsg("");
    try {
      const fn = httpsCallable<
        { id: string; targetLocales: string[] },
        { ok: boolean; results: TranslateResult[] }
      >(functions, "adminAiTranslateEmailTemplate");
      const res = await fn({ id: source.id, targetLocales: ["hu", "sk", "ro", "de", "hr", "he"] });
      setTranslateResults(res.data.results);
      onRefresh();
    } catch (e: unknown) {
      setMsg(`AI translate error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTranslating(null);
    }
  }

  async function sendTest(templateId: string) {
    if (!testEmail) { setMsg("Enter a test email address first."); return; }
    setSendingTest(templateId);
    setMsg("");
    try {
      const fn = httpsCallable<{ templateId: string; toEmail: string }, { ok: boolean }>(
        functions, "adminSendTestEmail"
      );
      await fn({ templateId, toEmail: testEmail });
      setMsg(`Test email sent to ${testEmail}`);
    } catch (e: unknown) {
      setMsg(`Send test error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSendingTest(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Tools card */}
      <div style={card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #DCE4EE", fontWeight: 700, color: "#0D1F33", fontSize: "0.9rem" }}>
          ⚙️ System Template Tools
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ color: "#3C516C", fontSize: "0.875rem", margin: 0, lineHeight: 1.7 }}>
            System templates replace Firebase's built-in emails. The Android app calls{" "}
            <code style={{ color: "#6D3FC9" }}>sendPasswordResetCustom</code> which picks the
            user's locale and falls back to English. Seed English defaults first, then AI-translate.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => void seedDefaults(false)} disabled={seeding} style={btn(true)}>
              {seeding ? "⏳ Seeding…" : "🌱 Seed English Defaults"}
            </button>
            <button onClick={() => void seedDefaults(true)} disabled={seeding} style={btn()}>
              {seeding ? "⏳…" : "♻️ Overwrite + Reseed"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="test@example.com"
              style={{ ...inputStyle, flex: 1, maxWidth: 280 }}
            />
            <span style={{ color: "#5F7491", fontSize: "0.8rem" }}>← test email address</span>
          </div>
        </div>
      </div>

      {/* AI translate results */}
      {translateResults && (
        <div style={{ ...card }}>
          <div style={{ padding: "12px 20px", borderBottom: "1px solid #DCE4EE", fontWeight: 700, color: "#0D1F33", fontSize: "0.85rem" }}>
            AI Translation Results
          </div>
          <div style={{ padding: "12px 20px", display: "flex", gap: 10, flexWrap: "wrap" }}>
            {translateResults.map((r) => (
              <div key={r.locale} style={{
                padding: "6px 12px", borderRadius: 6, fontSize: "0.8rem",
                background: r.status === "error" ? "#FDE7EA" : "#E3F7EC",
                border: `1px solid ${r.status === "error" ? "#F5C2C9" : "#BFE8D2"}`,
                color: r.status === "error" ? "#C8283B" : "#178A55",
              }}>
                {LOCALE_FLAGS[r.locale]} {r.locale.toUpperCase()} — {r.status}
                {r.error ? `: ${r.error}` : ""}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-type grid */}
      {SYSTEM_TYPES.map(({ key, label }) => {
        const typeTemplates = systemTemplates.filter((t) => t.type === key);
        const localeMap = Object.fromEntries(typeTemplates.map((t) => [t.locale, t]));
        const hasEn = !!localeMap["en"];

        return (
          <div key={key} style={card}>
            <div style={{
              padding: "14px 20px", borderBottom: "1px solid #DCE4EE",
              display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8,
            }}>
              <div>
                <div style={{ fontWeight: 700, color: "#0D1F33", fontSize: "0.9rem" }}>{label}</div>
                <div style={{ color: "#5F7491", fontSize: "0.75rem", marginTop: 2 }}>
                  type: <code style={{ color: "#6D3FC9" }}>{key}</code>
                </div>
              </div>
              {hasEn && (
                <button
                  onClick={() => void aiTranslate(key)}
                  disabled={translating === key}
                  style={btn()}
                >
                  {translating === key ? "⏳ Translating…" : "🤖 AI Translate All"}
                </button>
              )}
            </div>

            <div style={{ padding: "16px 20px" }}>
              {typeTemplates.length === 0 ? (
                <div style={{ color: "#5F7491", fontSize: "0.875rem" }}>
                  No templates yet — click <strong style={{ color: "#0D1F33" }}>Seed English Defaults</strong>.
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {LOCALES.map((locale) => {
                    const t = localeMap[locale];
                    return (
                      <div
                        key={locale}
                        style={{
                          minWidth: 130, flex: "1 1 130px", maxWidth: 160,
                          background: t ? "#F4F7FB" : "#F4F7FB",
                          border: `1px solid ${t ? "#DCE4EE" : "#F4F7FB"}`,
                          borderRadius: 8, padding: "12px 14px",
                          display: "flex", flexDirection: "column", gap: 8,
                        }}
                      >
                        <div style={{ fontSize: "1.4rem" }}>{LOCALE_FLAGS[locale]}</div>
                        <div style={{ fontWeight: 700, color: t ? "#0D1F33" : "#DCE4EE", fontSize: "0.85rem" }}>
                          {locale.toUpperCase()}
                        </div>
                        {t ? (
                          <>
                            <div style={{ color: "#5F7491", fontSize: "0.72rem", lineHeight: 1.4 }}>
                              {t.subject.length > 40 ? t.subject.slice(0, 40) + "…" : t.subject}
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <button
                                onClick={() => void onEdit(t.id)}
                                style={{ ...btn(true), padding: "5px 10px", fontSize: "0.75rem" }}
                              >
                                ✏️ Edit
                              </button>
                              <button
                                onClick={() => void sendTest(t.id)}
                                disabled={sendingTest === t.id}
                                style={{ ...btn(), padding: "5px 10px", fontSize: "0.75rem" }}
                              >
                                {sendingTest === t.id ? "⏳…" : "📧 Test"}
                              </button>
                            </div>
                          </>
                        ) : (
                          <div style={{ color: "#DCE4EE", fontSize: "0.75rem" }}>missing</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Custom Tab ────────────────────────────────────────────────────────────────

function CustomTab({
  templates,
  onEdit,
  onRefresh,
  setMsg,
}: {
  templates: TemplateSummary[];
  onEdit: (id: string) => Promise<void>;
  onRefresh: () => void;
  setMsg: (m: string) => void;
}) {
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function deleteTemplate(id: string, name: string) {
    if (!window.confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      const fn = httpsCallable<{ id: string }, { ok: boolean }>(functions, "adminDeleteEmailTemplate");
      await fn({ id });
      onRefresh();
    } catch (e: unknown) {
      setMsg(`Delete error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeleting(null);
    }
  }

  async function sendTest(templateId: string) {
    if (!testEmail) { setMsg("Enter a test email address first."); return; }
    setSendingTest(templateId);
    setMsg("");
    try {
      const fn = httpsCallable<{ templateId: string; toEmail: string }, { ok: boolean }>(
        functions, "adminSendTestEmail"
      );
      await fn({ templateId, toEmail: testEmail });
      setMsg(`Test email sent to ${testEmail}`);
    } catch (e: unknown) {
      setMsg(`Send test error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSendingTest(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="email"
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
          placeholder="test@example.com"
          style={{ ...inputStyle, flex: 1, maxWidth: 280 }}
        />
        <span style={{ color: "#5F7491", fontSize: "0.8rem" }}>← email for test sends</span>
      </div>

      {templates.length === 0 ? (
        <div style={{ ...card, padding: "24px 20px", color: "#5F7491", fontSize: "0.875rem" }}>
          No custom templates yet. Click <strong style={{ color: "#0D1F33" }}>+ New Template</strong> above.
        </div>
      ) : (
        <div style={card}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #DCE4EE" }}>
                {["Name", "Type", "Locale", "Subject", "Updated", "Actions"].map((h) => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", color: "#5F7491", fontSize: "0.73rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {templates.map((t, i) => (
                <tr key={t.id} style={{ borderBottom: i < templates.length - 1 ? "1px solid #F4F7FB" : "none" }}>
                  <td style={{ padding: "12px 16px", color: "#0D1F33", fontWeight: 600, fontSize: "0.875rem" }}>{t.name}</td>
                  <td style={{ padding: "12px 16px", color: "#3C516C", fontSize: "0.8rem" }}>{t.type}</td>
                  <td style={{ padding: "12px 16px", fontSize: "1rem" }}>{LOCALE_FLAGS[t.locale] ?? "🌐"} {t.locale}</td>
                  <td style={{ padding: "12px 16px", color: "#5F7491", fontSize: "0.8rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.subject}
                  </td>
                  <td style={{ padding: "12px 16px", color: "#5F7491", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                    {t.updatedAt ? new Date(t.updatedAt).toLocaleDateString() : "—"}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => void onEdit(t.id)} style={{ ...btn(true), padding: "5px 10px", fontSize: "0.75rem" }}>✏️ Edit</button>
                      <button
                        onClick={() => void sendTest(t.id)}
                        disabled={sendingTest === t.id}
                        style={{ ...btn(), padding: "5px 10px", fontSize: "0.75rem" }}
                      >
                        {sendingTest === t.id ? "⏳…" : "📧 Test"}
                      </button>
                      <button
                        onClick={() => void deleteTemplate(t.id, t.name)}
                        disabled={deleting === t.id}
                        style={{ ...btn(false, true), padding: "5px 10px", fontSize: "0.75rem" }}
                      >
                        {deleting === t.id ? "⏳…" : "🗑"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Editor View ───────────────────────────────────────────────────────────────

function EditorView({
  initial,
  onSaved,
  onCancel,
}: {
  initial: TemplateDetail;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [subject, setSubject] = useState(initial.subject);
  const [bodyHtml, setBodyHtml] = useState(initial.bodyHtml);
  const [bodyText, setBodyText] = useState(initial.bodyText);
  const [type, setType] = useState(initial.type || "newsletter");
  const [locale, setLocale] = useState(initial.locale || "en");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [savedId, setSavedId] = useState<string | null>(initial.id || null);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  const VARS = ["{{name}}", "{{username}}", "{{resetLink}}", "{{verificationLink}}"];

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      const fn = httpsCallable<
        { id?: string; name: string; subject: string; bodyHtml: string; bodyText: string; type: string; locale: string; variables: string[] },
        { ok: boolean; id: string }
      >(functions, "adminSaveEmailTemplate");
      const res = await fn({
        ...(savedId ? { id: savedId } : {}),
        name, subject, bodyHtml, bodyText, type, locale,
        variables: VARS.filter((v) => bodyHtml.includes(v) || subject.includes(v)),
      });
      setSavedId(res.data.id);
      setMsg("✅ Saved");
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : "Save failed"}`);
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!testEmail) { setMsg("Enter a test email address."); return; }
    if (!savedId) { setMsg("Save the template first."); return; }
    setSendingTest(true);
    setMsg("");
    try {
      const fn = httpsCallable<{ templateId: string; toEmail: string }, { ok: boolean }>(
        functions, "adminSendTestEmail"
      );
      await fn({ templateId: savedId, toEmail: testEmail });
      setMsg(`Test email sent to ${testEmail}`);
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : "Send failed"}`);
    } finally {
      setSendingTest(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 860 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onCancel} style={btn()}>← Back</button>
        <h2 style={{ margin: 0, color: "#0D1F33", fontSize: "1.1rem", fontWeight: 700 }}>
          {savedId && initial.id ? "Edit Template" : "New Template"}
        </h2>
      </div>

      <div style={card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #DCE4EE", fontWeight: 700, color: "#0D1F33", fontSize: "0.875rem" }}>Template Settings</div>
        <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="e.g. Password Reset — English" />
          </div>
          <div>
            <label style={labelStyle}>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} style={inputStyle}>
              {TEMPLATE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Locale</label>
            <select value={locale} onChange={(e) => setLocale(e.target.value)} style={inputStyle}>
              {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_FLAGS[l]} {l.toUpperCase()}</option>)}
            </select>
          </div>
        </div>
        <div style={{ padding: "0 20px 16px" }}>
          <label style={labelStyle}>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle} placeholder="Email subject line" />
        </div>
      </div>

      <div style={card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #DCE4EE", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, color: "#0D1F33", fontSize: "0.875rem" }}>HTML Body</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {VARS.map((v) => (
              <button
                key={v}
                onClick={() => setBodyHtml((prev) => prev + v)}
                style={{ ...btn(), padding: "3px 8px", fontSize: "0.72rem", color: "#6D3FC9", borderColor: "#EFE8FB" }}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: "14px 20px" }}>
          <textarea
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            rows={18}
            style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.78rem", resize: "vertical" }}
          />
        </div>
      </div>

      <div style={card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #DCE4EE", fontWeight: 700, color: "#0D1F33", fontSize: "0.875rem" }}>Plain Text Body</div>
        <div style={{ padding: "14px 20px" }}>
          <textarea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            rows={6}
            style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.78rem", resize: "vertical" }}
            placeholder="Fallback plain-text version (optional but recommended)"
          />
        </div>
      </div>

      <div style={card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #DCE4EE", fontWeight: 700, color: "#0D1F33", fontSize: "0.875rem" }}>Send & Save</div>
        <div style={{ padding: "16px 20px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => void save()} disabled={saving} style={btn(true)}>
            {saving ? "⏳ Saving…" : "💾 Save"}
          </button>
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="test@example.com"
            style={{ ...inputStyle, flex: 1, maxWidth: 240 }}
          />
          <button onClick={() => void sendTest()} disabled={sendingTest || !savedId} style={btn()}>
            {sendingTest ? "⏳ Sending…" : "📧 Send Test"}
          </button>
          <button onClick={onSaved} style={btn()}>← Done</button>
        </div>
        {msg && (
          <div style={{
            margin: "0 20px 16px", padding: "10px 14px", borderRadius: 8, fontSize: "0.875rem",
            background: msg.startsWith("Error") ? "#FDE7EA" : "#E3F7EC",
            border: `1px solid ${msg.startsWith("Error") ? "#F5C2C9" : "#BFE8D2"}`,
            color: msg.startsWith("Error") ? "#C8283B" : "#178A55",
          }}>
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Automation Tab ────────────────────────────────────────────────────────────

type AutomationSettings = {
  emailProvider: "smtp" | "ses";
  // SMTP (Firestore-stored, falls back to env vars)
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string; // "***" when set in Firestore, "***" masked when from env
  smtpFromEmail: string;
  smtpFromName: string;
  smtpSource?: "firestore" | "env" | "none"; // where values currently come from
  // SES
  sesRegion: string;
  sesAccessKeyId: string;
  sesSecretAccessKey: string;
  sesFromEmail: string;
  sesFromName: string;
  purchaseEmailEnabled: boolean;
  regReminderEnabled: boolean;
  regReminder1dEnabled: boolean;
  regReminder3dEnabled: boolean;
  regReminder7dEnabled: boolean;
  regReminderMaxPerRun: number;
  inactivityEnabled: boolean;
  inactivity1dEnabled: boolean;
  inactivity3dEnabled: boolean;
  inactivity7dEnabled: boolean;
  inactivityMaxPerRun: number;
  inactivityDays: number;
  lastRunAt: number | null;
  lastRunSent: number;
  lastRunFailed: number;
  lastInactivityRunAt: number | null;
  lastInactivityRunSent: number;
  lastInactivityRunFailed: number;
};

type StageBreakdown = { "1d": number; "3d": number; "7d": number };

type TriggerResult = {
  ok: boolean;
  dryRun: boolean;
  sent: number;
  failed: number;
  skipped: number;
  total: number;
  registration?: { sent: number; failed: number; skipped: number; breakdown: StageBreakdown };
  inactivity?: { sent: number; failed: number; skipped: number; breakdown: StageBreakdown };
};

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        style={{ width: 16, height: 16, accentColor: "#0B6C86" }}
      />
      <span style={{ color: "#0D1F33", fontSize: "0.875rem" }}>
        {checked ? "✅" : "⬜"} {label}
      </span>
    </label>
  );
}

function AutomationTab({ setMsg }: { setMsg: (m: string) => void }) {
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<TriggerResult | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const fn = httpsCallable<void, { ok: boolean; settings: AutomationSettings }>(
        functions, "adminGetEmailAutomationSettings"
      );
      const res = await fn();
      setSettings(res.data.settings);
    } catch (e: unknown) {
      setMsg(`Error loading settings: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [setMsg]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  async function save(patch: Partial<AutomationSettings & { sesSecretAccessKey?: string }>) {
    setSaving(true);
    try {
      const fn = httpsCallable<Record<string, unknown>, { ok: boolean }>(
        functions, "adminUpdateEmailAutomationSettings"
      );
      await fn(patch as Record<string, unknown>);
      await loadSettings();
    } catch (e: unknown) {
      setMsg(`Save error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function trigger(dryRun: boolean) {
    setTriggering(true);
    setTriggerResult(null);
    try {
      const fn = httpsCallable<{ dryRun: boolean }, TriggerResult>(
        functions, "adminTriggerInactivityEmails"
      );
      const res = await fn({ dryRun });
      setTriggerResult(res.data);
      if (!dryRun) await loadSettings();
    } catch (e: unknown) {
      setMsg(`Trigger error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTriggering(false);
    }
  }

  if (loading) return <div style={{ color: "#5F7491", padding: 20 }}>Loading…</div>;

  const s = settings!;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 760 }}>

      {/* Purchase email */}
      <div style={card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #DCE4EE", fontWeight: 700, color: "#0D1F33", fontSize: "0.9rem" }}>
          🧾 Purchase Confirmation Emails
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ color: "#3C516C", fontSize: "0.875rem", margin: 0, lineHeight: 1.6 }}>
            Sent after every successful Revolut / Stripe payment. Uses the <strong style={{ color: "#0D1F33" }}>Purchase Confirmation</strong> template.
          </p>
          <Toggle
            checked={s.purchaseEmailEnabled}
            onChange={(v) => void save({ purchaseEmailEnabled: v })}
            disabled={saving}
            label="Send purchase confirmation emails"
          />
        </div>
      </div>

      {/* Registration reminders */}
      <div style={card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #DCE4EE", fontWeight: 700, color: "#0D1F33", fontSize: "0.9rem" }}>
          📧 Registration Reminders (Unverified Accounts)
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ color: "#3C516C", fontSize: "0.875rem", margin: 0, lineHeight: 1.6 }}>
            Sent to users who signed up but haven't verified their email. Each stage fires once per user (one-time). Each email includes a fresh verification link.
          </p>
          <Toggle
            checked={s.regReminderEnabled}
            onChange={(v) => void save({ regReminderEnabled: v })}
            disabled={saving}
            label="Enable registration reminders (master toggle)"
          />
          {s.regReminderEnabled && (
            <div style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 10, borderLeft: "2px solid #DCE4EE" }}>
              <Toggle checked={s.regReminder1dEnabled} onChange={(v) => void save({ regReminder1dEnabled: v })} disabled={saving} label={'1-day reminder — "Don\'t forget to verify"'} />
              <Toggle checked={s.regReminder3dEnabled} onChange={(v) => void save({ regReminder3dEnabled: v })} disabled={saving} label={'3-day reminder — "Still waiting on your verification"'} />
              <Toggle checked={s.regReminder7dEnabled} onChange={(v) => void save({ regReminder7dEnabled: v })} disabled={saving} label={'7-day final notice — "Last chance to activate"'} />
              <div style={{ marginTop: 4 }}>
                <label style={labelStyle}>Max per run</label>
                <MaxInput value={s.regReminderMaxPerRun} onSave={(v) => void save({ regReminderMaxPerRun: v })} saving={saving} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Inactivity emails */}
      <div style={card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #DCE4EE", fontWeight: 700, color: "#0D1F33", fontSize: "0.9rem" }}>
          😴 Inactivity Emails (Multi-Stage)
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ color: "#3C516C", fontSize: "0.875rem", margin: 0, lineHeight: 1.6 }}>
            Runs daily at 09:00 Budapest time. Sends to verified users who haven't opened the app. Each stage fires once per inactivity window — if the user returns and goes inactive again, the cycle restarts. Each run sends the highest pending stage per user.
          </p>
          <Toggle
            checked={s.inactivityEnabled}
            onChange={(v) => void save({ inactivityEnabled: v })}
            disabled={saving}
            label="Enable inactivity emails (master toggle)"
          />
          {s.inactivityEnabled && (
            <div style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 10, borderLeft: "2px solid #DCE4EE" }}>
              <Toggle checked={s.inactivity1dEnabled} onChange={(v) => void save({ inactivity1dEnabled: v })} disabled={saving} label={'Day 1 — "Your traps are calling"'} />
              <Toggle checked={s.inactivity3dEnabled} onChange={(v) => void save({ inactivity3dEnabled: v })} disabled={saving} label={'Day 3 — "3 days without traps?"'} />
              <Toggle checked={s.inactivity7dEnabled} onChange={(v) => void save({ inactivity7dEnabled: v })} disabled={saving} label={'Day 7 — "A whole week, we miss you!"'} />
              <div style={{ marginTop: 4 }}>
                <label style={labelStyle}>Max per run</label>
                <MaxInput value={s.inactivityMaxPerRun} onSave={(v) => void save({ inactivityMaxPerRun: v })} saving={saving} />
              </div>
            </div>
          )}

          {s.lastRunAt && (
            <div style={{
              padding: "10px 14px", background: "#F4F7FB", border: "1px solid #DCE4EE",
              borderRadius: 8, fontSize: "0.8rem", color: "#3C516C",
              display: "flex", gap: 20, flexWrap: "wrap",
            }}>
              <span>Last run: <strong style={{ color: "#0D1F33" }}>{new Date(s.lastRunAt).toLocaleString()}</strong></span>
              <span>Sent: <strong style={{ color: "#178A55" }}>{s.lastRunSent}</strong></span>
              <span>Failed: <strong style={{ color: s.lastRunFailed > 0 ? "#C8283B" : "#5F7491" }}>{s.lastRunFailed}</strong></span>
            </div>
          )}
        </div>
      </div>

      {/* Manual trigger */}
      <div style={card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #DCE4EE", fontWeight: 700, color: "#0D1F33", fontSize: "0.9rem" }}>
          🚀 Manual Trigger
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ color: "#3C516C", fontSize: "0.875rem", margin: 0, lineHeight: 1.6 }}>
            Manually run all automation emails (registration reminders + inactivity) using the current settings above.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => void trigger(true)} disabled={triggering} style={btn()}>
              {triggering ? "⏳ Running…" : "🔍 Dry Run (count only)"}
            </button>
            <button
              onClick={() => {
                if (!window.confirm("Send automation emails now to qualifying users? This cannot be undone.")) return;
                void trigger(false);
              }}
              disabled={triggering}
              style={btn(true)}
            >
              {triggering ? "⏳ Sending…" : "📤 Send Now"}
            </button>
          </div>

          {triggerResult && (
            <div style={{
              padding: "14px 16px", borderRadius: 8, fontSize: "0.875rem",
              background: triggerResult.dryRun ? "#F4F7FB" : "#E3F7EC",
              border: `1px solid ${triggerResult.dryRun ? "#DCE4EE" : "#BFE8D2"}`,
              display: "flex", flexDirection: "column", gap: 10,
            }}>
              <div style={{ fontWeight: 700, color: "#0D1F33" }}>
                {triggerResult.dryRun ? "🔍 Dry Run Result" : "✅ Send Complete"}
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", color: "#3C516C" }}>
                <span>Total {triggerResult.dryRun ? "would send" : "sent"}: <strong style={{ color: "#178A55" }}>{triggerResult.sent}</strong></span>
                <span>Skipped: <strong style={{ color: "#5F7491" }}>{triggerResult.skipped}</strong></span>
                {!triggerResult.dryRun && <span>Failed: <strong style={{ color: triggerResult.failed > 0 ? "#C8283B" : "#5F7491" }}>{triggerResult.failed}</strong></span>}
              </div>
              {triggerResult.registration && (
                <div style={{ fontSize: "0.8rem", color: "#5F7491" }}>
                  📧 Registration reminders — sent: {triggerResult.registration.sent}
                  {triggerResult.registration.breakdown && ` (1d: ${triggerResult.registration.breakdown["1d"]}, 3d: ${triggerResult.registration.breakdown["3d"]}, 7d: ${triggerResult.registration.breakdown["7d"]})`}
                </div>
              )}
              {triggerResult.inactivity && (
                <div style={{ fontSize: "0.8rem", color: "#5F7491" }}>
                  😴 Inactivity emails — sent: {triggerResult.inactivity.sent}
                  {triggerResult.inactivity.breakdown && ` (1d: ${triggerResult.inactivity.breakdown["1d"]}, 3d: ${triggerResult.inactivity.breakdown["3d"]}, 7d: ${triggerResult.inactivity.breakdown["7d"]})`}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Gateway Tab ───────────────────────────────────────────────────────────────

function GatewayTab({ setMsg }: { setMsg: (m: string) => void }) {
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sesSecret, setSesSecret] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const fn = httpsCallable<void, { ok: boolean; settings: AutomationSettings }>(
        functions, "adminGetEmailAutomationSettings"
      );
      const res = await fn();
      setSettings(res.data.settings);
    } catch (e: unknown) {
      setMsg(`Error loading settings: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [setMsg]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  async function save(patch: Partial<AutomationSettings & { sesSecretAccessKey?: string }>) {
    setSaving(true);
    try {
      const fn = httpsCallable<Record<string, unknown>, { ok: boolean }>(
        functions, "adminUpdateEmailAutomationSettings"
      );
      await fn(patch as Record<string, unknown>);
      await loadSettings();
    } catch (e: unknown) {
      setMsg(`Save error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ color: "#5F7491", padding: 20 }}>Loading…</div>;

  const s = settings!;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 760 }}>

      {/* Provider selector */}
      <div style={card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #DCE4EE", fontWeight: 700, color: "#0D1F33", fontSize: "0.9rem" }}>
          📡 Email Sending Provider
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ color: "#3C516C", fontSize: "0.875rem", margin: 0, lineHeight: 1.6 }}>
            Choose your outbound email provider. <strong style={{ color: "#0D1F33" }}>SMTP</strong> uses environment variables set on the server (no hourly limits depends on your SMTP provider). <strong style={{ color: "#0D1F33" }}>AWS SES</strong> has no hourly limits and scales to high volume — credentials are stored securely in Firestore.
          </p>
          <div style={{ display: "flex", gap: 16 }}>
            {(["smtp", "ses"] as const).map((p) => (
              <label key={p} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="radio"
                  name="emailProvider"
                  value={p}
                  checked={s.emailProvider === p}
                  onChange={() => void save({ emailProvider: p })}
                  style={{ accentColor: "#0B6C86" }}
                />
                <span style={{ color: "#0D1F33", fontWeight: 600 }}>{p === "ses" ? "AWS SES" : "SMTP"}</span>
              </label>
            ))}
          </div>

          {s.emailProvider === "smtp" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Source banner */}
              {s.smtpSource === "env" && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderRadius: 8, background: "#E3F7EC", border: "1px solid #BFE8D2", fontSize: "0.8rem", color: "#178A55" }}>
                  <span style={{ fontSize: "1rem", flexShrink: 0 }}>ℹ️</span>
                  <span>Values shown below are currently read from <strong>server environment variables</strong> (<code style={{ color: "#178A55" }}>SMTP_*</code>). Fill in and save any field here to override it with a Firestore-stored value instead — or leave as-is to keep using the env vars.</span>
                </div>
              )}
              {s.smtpSource === "firestore" && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderRadius: 8, background: "#F4F7FB", border: "1px solid #0B6C86", fontSize: "0.8rem", color: "#0B6C86" }}>
                  <span style={{ fontSize: "1rem", flexShrink: 0 }}>✅</span>
                  <span>SMTP settings are stored in <strong>Firestore</strong> and override any server environment variables.</span>
                </div>
              )}
              {s.smtpSource === "none" && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderRadius: 8, background: "#FDE7EA", border: "1px solid #F5C2C9", fontSize: "0.8rem", color: "#C8283B" }}>
                  <span style={{ fontSize: "1rem", flexShrink: 0 }}>⚠️</span>
                  <span>No SMTP configuration detected. Fill in the fields below to set up email sending, or set <code style={{ color: "#C8283B" }}>SMTP_HOST</code> as a server environment variable.</span>
                </div>
              )}
              <p style={{ color: "#3C516C", fontSize: "0.875rem", margin: 0, lineHeight: 1.6 }}>
                Enter your SMTP credentials below — they are stored securely in Firestore and override the server environment variables. Leave <strong style={{ color: "#0D1F33" }}>Host</strong> blank to fall back to the <code style={{ color: "#0B6C86" }}>SMTP_*</code> env vars instead.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10 }}>
                <div>
                  <label style={labelStyle}>SMTP Host</label>
                  <input
                    defaultValue={s.smtpHost}
                    onBlur={(e) => { if (e.target.value !== s.smtpHost) void save({ smtpHost: e.target.value }); }}
                    style={inputStyle}
                    placeholder="smtp.gmail.com  /  mail.example.com"
                  />
                </div>
                <div>
                  <label style={labelStyle}>Port</label>
                  <input
                    type="number"
                    defaultValue={s.smtpPort || 587}
                    onBlur={(e) => { const v = Number(e.target.value); if (v !== s.smtpPort) void save({ smtpPort: v }); }}
                    style={inputStyle}
                    placeholder="587"
                  />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={labelStyle}>Username / Login</label>
                  <input
                    defaultValue={s.smtpUser}
                    onBlur={(e) => { if (e.target.value !== s.smtpUser) void save({ smtpUser: e.target.value }); }}
                    style={inputStyle}
                    placeholder="you@example.com"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label style={labelStyle}>From Email</label>
                  <input
                    defaultValue={s.smtpFromEmail}
                    onBlur={(e) => { if (e.target.value !== s.smtpFromEmail) void save({ smtpFromEmail: e.target.value }); }}
                    style={inputStyle}
                    placeholder="noreply@playtrapnow.com"
                  />
                </div>
                <div>
                  <label style={labelStyle}>From Name</label>
                  <input
                    defaultValue={s.smtpFromName || "PlayTrap"}
                    onBlur={(e) => { if (e.target.value !== s.smtpFromName) void save({ smtpFromName: e.target.value }); }}
                    style={inputStyle}
                    placeholder="PlayTrap"
                  />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={s.smtpSecure}
                      onChange={(e) => void save({ smtpSecure: e.target.checked })}
                      style={{ accentColor: "#0B6C86", width: 16, height: 16 }}
                    />
                    <span style={{ color: "#0D1F33", fontSize: "0.875rem" }}>Use TLS (port 465)</span>
                  </label>
                </div>
              </div>
              <div>
                <label style={labelStyle}>
                  Password {s.smtpPass === "***" ? "(already set — enter new to change)" : ""}
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="password"
                    value={smtpPassword}
                    onChange={(e) => setSmtpPassword(e.target.value)}
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder={s.smtpPass === "***" ? "●●●●●●●● (set)" : "Enter SMTP password or app password"}
                    autoComplete="new-password"
                  />
                  <button
                    onClick={() => { if (smtpPassword) { void save({ smtpPass: smtpPassword }); setSmtpPassword(""); } }}
                    disabled={!smtpPassword || saving}
                    style={{ ...btn(true), padding: "7px 14px", fontSize: "0.8rem", whiteSpace: "nowrap" }}
                  >
                    Save Password
                  </button>
                </div>
              </div>
              <div style={{ background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 8, padding: "12px 14px", fontSize: "0.8rem", color: "#3C516C", lineHeight: 1.7 }}>
                <strong style={{ color: "#0D1F33", display: "block", marginBottom: 4 }}>Common SMTP providers:</strong>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
                  <span>Gmail: <code style={{ color: "#0B6C86" }}>smtp.gmail.com</code> port <code style={{ color: "#0B6C86" }}>587</code></span>
                  <span>Outlook: <code style={{ color: "#0B6C86" }}>smtp.office365.com</code> port <code style={{ color: "#0B6C86" }}>587</code></span>
                  <span>SendGrid: <code style={{ color: "#0B6C86" }}>smtp.sendgrid.net</code> port <code style={{ color: "#0B6C86" }}>587</code></span>
                  <span>Mailgun: <code style={{ color: "#0B6C86" }}>smtp.mailgun.org</code> port <code style={{ color: "#0B6C86" }}>587</code></span>
                  <span>Brevo: <code style={{ color: "#0B6C86" }}>smtp-relay.brevo.com</code> port <code style={{ color: "#0B6C86" }}>587</code></span>
                  <span>Postmark: <code style={{ color: "#0B6C86" }}>smtp.postmarkapp.com</code> port <code style={{ color: "#0B6C86" }}>587</code></span>
                </div>
              </div>
            </div>
          )}

          {s.emailProvider === "ses" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
              <div>
                <label style={labelStyle}>AWS Region</label>
                <input
                  defaultValue={s.sesRegion || "eu-west-1"}
                  onBlur={(e) => { if (e.target.value !== s.sesRegion) void save({ sesRegion: e.target.value }); }}
                  style={inputStyle}
                  placeholder="eu-west-1"
                />
              </div>
              <div>
                <label style={labelStyle}>From Email</label>
                <input
                  defaultValue={s.sesFromEmail}
                  onBlur={(e) => { if (e.target.value !== s.sesFromEmail) void save({ sesFromEmail: e.target.value }); }}
                  style={inputStyle}
                  placeholder="noreply@playtrapnow.com"
                />
              </div>
              <div>
                <label style={labelStyle}>Access Key ID</label>
                <input
                  defaultValue={s.sesAccessKeyId}
                  onBlur={(e) => { if (e.target.value !== s.sesAccessKeyId) void save({ sesAccessKeyId: e.target.value }); }}
                  style={inputStyle}
                  placeholder="AKIAIOSFODNN7EXAMPLE"
                />
              </div>
              <div>
                <label style={labelStyle}>From Name</label>
                <input
                  defaultValue={s.sesFromName || "PlayTrap"}
                  onBlur={(e) => { if (e.target.value !== s.sesFromName) void save({ sesFromName: e.target.value }); }}
                  style={inputStyle}
                  placeholder="PlayTrap"
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>
                  Secret Access Key {s.sesSecretAccessKey === "***" ? "(already set — enter new to change)" : ""}
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="password"
                    value={sesSecret}
                    onChange={(e) => setSesSecret(e.target.value)}
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder={s.sesSecretAccessKey === "***" ? "●●●●●●●● (set)" : "Enter secret access key"}
                  />
                  <button
                    onClick={() => { if (sesSecret) { void save({ sesSecretAccessKey: sesSecret }); setSesSecret(""); } }}
                    disabled={!sesSecret || saving}
                    style={{ ...btn(true), padding: "7px 14px", fontSize: "0.8rem", whiteSpace: "nowrap" }}
                  >
                    Save Key
                  </button>
                </div>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 8, padding: "12px 14px", fontSize: "0.8rem", color: "#3C516C", lineHeight: 1.6 }}>
                  <strong style={{ color: "#0D1F33", display: "block", marginBottom: 4 }}>SES setup checklist:</strong>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
                    <li>Verify your "From" domain or email in AWS SES console</li>
                    <li>Create an IAM user with <code style={{ color: "#0B6C86" }}>ses:SendRawEmail</code> permission</li>
                    <li>If your account is in SES sandbox, request production access for unlimited sending</li>
                    <li>Use region closest to your users (e.g. <code style={{ color: "#0B6C86" }}>eu-west-1</code> for Europe)</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SMTP env vars help (always shown as reference) */}
      {s.emailProvider === "ses" && (
        <div style={card}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #DCE4EE", fontWeight: 700, color: "#0D1F33", fontSize: "0.9rem" }}>
            ℹ️ About SMTP Fallback
          </div>
          <div style={{ padding: "16px 20px", fontSize: "0.875rem", color: "#3C516C", lineHeight: 1.7 }}>
            Password reset and email verification links always use the SMTP env vars as a fallback (for security, those links bypass Firestore config). Make sure <code style={{ color: "#0B6C86" }}>SMTP_*</code> env vars are set even when using SES for automation emails.
          </div>
        </div>
      )}

    </div>
  );
}

function MaxInput({ value, onSave, saving }: { value: number; onSave: (v: number) => void; saving: boolean }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input
        type="number" min={1} max={1000} value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        style={{ ...inputStyle, width: 80 }}
      />
      <button
        onClick={() => onSave(local)}
        disabled={saving || local === value}
        style={{ ...btn(true), padding: "7px 14px", fontSize: "0.8rem" }}
      >
        Save
      </button>
      <span style={{ color: "#5F7491", fontSize: "0.75rem" }}>Currently: {value}</span>
    </div>
  );
}
