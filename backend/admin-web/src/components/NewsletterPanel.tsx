import { useState, useEffect, useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

type TemplateSummary = {
  id: string;
  name: string;
  subject: string;
  type: string;
  locale: string;
  updatedAt: number | null;
};

type SendResult = {
  ok: boolean;
  sent: number;
  failed: number;
  total: number;
};

const SEGMENTS = [
  { value: "verified", label: "Verified users only", desc: "All users with a verified email address" },
  { value: "all", label: "All users", desc: "Every user in the database (including unverified)" },
] as const;

export default function NewsletterPanel() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [segment, setSegment] = useState<"verified" | "all">("verified");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [msg, setMsg] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const fn = httpsCallable<void, { ok: boolean; templates: TemplateSummary[] }>(
        functions, "adminListEmailTemplates"
      );
      const res = await fn();
      const newsletter = res.data.templates.filter((t) => t.type === "newsletter" || t.type === "custom");
      setTemplates(newsletter);
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : "Failed to load templates"}`);
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  async function sendNewsletter() {
    if (!selectedTemplate) return;
    setSending(true);
    setResult(null);
    setMsg("");
    setConfirmOpen(false);
    try {
      const fn = httpsCallable<{ templateId: string; segment: string }, SendResult>(
        functions, "adminSendNewsletter"
      );
      const res = await fn({ templateId: selectedTemplate, segment });
      setResult(res.data);
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : "Send failed"}`);
    } finally {
      setSending(false);
    }
  }

  const chosenTemplate = templates.find((t) => t.id === selectedTemplate);
  const chosenSegment = SEGMENTS.find((s) => s.value === segment);

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
    marginBottom: 8,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 720 }}>

      {/* How it works */}
      <div style={{ ...card }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #DCE4EE", fontWeight: 700, color: "#0D1F33", fontSize: "0.9rem" }}>
          📰 Send Newsletter
        </div>
        <div style={{ padding: "16px 20px", color: "#3C516C", fontSize: "0.875rem", lineHeight: 1.7 }}>
          <p style={{ margin: 0 }}>
            Compose your newsletter in <strong style={{ color: "#0D1F33" }}>Email Templates</strong>, then
            select it here and choose which users to send it to. The email is sent via your configured
            SMTP server and personalizes <code style={{ color: "#6D3FC9" }}>{"{{name}}"}</code> and{" "}
            <code style={{ color: "#6D3FC9" }}>{"{{username}}"}</code> for each recipient.
          </p>
        </div>
      </div>

      {/* Compose form */}
      <div style={card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #DCE4EE", fontWeight: 700, color: "#0D1F33", fontSize: "0.9rem" }}>
          Configure Send
        </div>
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Template picker */}
          <div>
            <label style={labelStyle}>Email Template</label>
            {loadingTemplates ? (
              <div style={{ color: "#5F7491", fontSize: "0.875rem" }}>Loading templates…</div>
            ) : templates.length === 0 ? (
              <div style={{
                padding: "12px 14px",
                background: "rgba(113,63,18,0.15)",
                border: "1px solid #F3D9A8",
                borderRadius: 8,
                color: "#8A5A0B",
                fontSize: "0.875rem",
              }}>
                No newsletter templates found. Go to <strong>Email Templates</strong> and create one
                with type set to <em>newsletter</em>.
              </div>
            ) : (
              <select
                style={inputStyle}
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
              >
                <option value="">— Select a template —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.locale})
                  </option>
                ))}
              </select>
            )}

            {chosenTemplate && (
              <div style={{
                marginTop: 10,
                padding: "10px 14px",
                background: "#F4F7FB",
                border: "1px solid #DCE4EE",
                borderRadius: 8,
                fontSize: "0.8rem",
                color: "#3C516C",
              }}>
                <strong style={{ color: "#26394F" }}>Subject:</strong> {chosenTemplate.subject}
              </div>
            )}
          </div>

          {/* Segment picker */}
          <div>
            <label style={labelStyle}>Recipient Segment</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {SEGMENTS.map((s) => (
                <label
                  key={s.value}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "12px 14px",
                    background: segment === s.value ? "rgba(11,108,134,0.12)" : "#F4F7FB",
                    border: `1px solid ${segment === s.value ? "#0B6C86" : "#DCE4EE"}`,
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="segment"
                    value={s.value}
                    checked={segment === s.value}
                    onChange={() => setSegment(s.value)}
                    style={{ marginTop: 2, accentColor: "#0B6C86" }}
                  />
                  <div>
                    <div style={{ color: "#0D1F33", fontWeight: 600, fontSize: "0.875rem" }}>{s.label}</div>
                    <div style={{ color: "#5F7491", fontSize: "0.8rem", marginTop: 2 }}>{s.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Warning for "all" */}
          {segment === "all" && (
            <div style={{
              padding: "10px 14px",
              background: "rgba(113,63,18,0.2)",
              border: "1px solid #F3D9A8",
              borderRadius: 8,
              color: "#8A5A0B",
              fontSize: "0.825rem",
            }}>
              ⚠️ <strong>All users</strong> includes accounts that haven't verified their email.
              Use <strong>Verified users only</strong> to avoid bounced emails in most cases.
            </div>
          )}

          {/* Send button */}
          <button
            disabled={!selectedTemplate || sending || templates.length === 0}
            onClick={() => setConfirmOpen(true)}
            style={{
              padding: "12px 28px",
              background: !selectedTemplate || sending ? "#F4F7FB" : "#0B6C86",
              border: `1px solid ${!selectedTemplate || sending ? "#DCE4EE" : "#0B6C86"}`,
              borderRadius: 8,
              color: !selectedTemplate || sending ? "#5F7491" : "#fff",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: !selectedTemplate || sending ? "not-allowed" : "pointer",
              alignSelf: "flex-start",
            }}
          >
            {sending ? "⏳ Sending…" : "📤 Send Newsletter"}
          </button>

          {msg && (
            <div style={{
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: "0.875rem",
              background: msg.startsWith("Error") ? "#FDE7EA" : "#E3F7EC",
              border: `1px solid ${msg.startsWith("Error") ? "#F5C2C9" : "#BFE8D2"}`,
              color: msg.startsWith("Error") ? "#C8283B" : "#178A55",
            }}>
              {msg}
            </div>
          )}
        </div>
      </div>

      {/* Result card */}
      {result && (
        <div style={{
          ...card,
          border: `1px solid ${result.failed > 0 ? "#F3D9A8" : "#BFE8D2"}`,
        }}>
          <div style={{ padding: "14px 20px", borderBottom: `1px solid ${result.failed > 0 ? "#F3D9A8" : "#BFE8D2"}`, fontWeight: 700, color: "#0D1F33", fontSize: "0.9rem" }}>
            {result.failed > 0 ? "⚠️ " : "✅ "}Send Complete
          </div>
          <div style={{ padding: "20px", display: "flex", gap: 20, flexWrap: "wrap" }}>
            {[
              { label: "Total Users", value: result.total, color: "#3C516C" },
              { label: "Sent", value: result.sent, color: "#178A55" },
              { label: "Failed", value: result.failed, color: result.failed > 0 ? "#C8283B" : "#3C516C" },
            ].map((s) => (
              <div key={s.label} style={{
                textAlign: "center",
                flex: 1,
                minWidth: 100,
                background: "#F4F7FB",
                border: "1px solid #DCE4EE",
                borderRadius: 10,
                padding: "16px 12px",
              }}>
                <div style={{ fontSize: "2rem", fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ color: "#5F7491", fontSize: "0.8rem", marginTop: 4, fontWeight: 600 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      {confirmOpen && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(11,22,38,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{
            background: "#F4F7FB",
            border: "1px solid #DCE4EE",
            borderRadius: 14,
            padding: "28px 32px",
            maxWidth: 440,
            width: "90%",
          }}>
            <div style={{ fontWeight: 800, color: "#0D1F33", fontSize: "1.1rem", marginBottom: 12 }}>
              Confirm Newsletter Send
            </div>
            <p style={{ color: "#3C516C", fontSize: "0.9rem", lineHeight: 1.6, margin: "0 0 20px" }}>
              You are about to send <strong style={{ color: "#0D1F33" }}>{chosenTemplate?.name}</strong> to
              {" "}<strong style={{ color: "#0D1F33" }}>{chosenSegment?.label}</strong>.
              <br /><br />
              This action <strong style={{ color: "#C8283B" }}>cannot be undone</strong>. Each recipient
              receives an individual email. Continue?
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setConfirmOpen(false)}
                style={{
                  padding: "9px 20px",
                  background: "none",
                  border: "1px solid #DCE4EE",
                  borderRadius: 8,
                  color: "#3C516C",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void sendNewsletter()}
                style={{
                  padding: "9px 20px",
                  background: "#0B6C86",
                  border: "1px solid #0B6C86",
                  borderRadius: 8,
                  color: "#fff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Yes, Send Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
