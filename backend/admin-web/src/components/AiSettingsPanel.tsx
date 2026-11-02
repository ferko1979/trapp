import { useState, useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

export default function AiSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [masked, setMasked] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function loadStatus() {
    setLoading(true);
    try {
      const fn = httpsCallable<void, { configured: boolean; masked: string | null }>(
        functions,
        "adminCheckAiApiKey"
      );
      const res = await fn();
      setConfigured(res.data.configured);
      setMasked(res.data.masked);
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : "Failed to check key status.";
      setMsg(`Error: ${m}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadStatus(); }, []);

  async function handleSave() {
    if (!apiKeyInput.trim()) return;
    setSaving(true);
    setMsg("");
    try {
      const fn = httpsCallable(functions, "adminSetAiApiKey");
      await fn({ anthropicApiKey: apiKeyInput.trim() });
      setConfigured(true);
      setMasked(`sk-ant-...${apiKeyInput.trim().slice(-4)}`);
      setApiKeyInput("");
      setShowKey(false);
      setMsg("✓ Anthropic API key saved successfully.");
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : "Save failed.";
      setMsg(`Error: ${m}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 680 }}>

      {/* Status card */}
      <div style={{
        background: "#F4F7FB",
        border: `1px solid ${configured ? "#BFE8D2" : "#F3D9A8"}`,
        borderRadius: 12,
        padding: "20px 24px",
        display: "flex",
        alignItems: "center",
        gap: 18,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: "50%",
          background: configured ? "#E3F7EC" : "rgba(113,63,18,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "1.5rem", flexShrink: 0,
        }}>
          {loading ? "⏳" : configured ? "🤖" : "⚠️"}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "1rem", color: "#0D1F33", marginBottom: 4 }}>
            Claude (Anthropic) API
          </div>
          {loading ? (
            <div style={{ color: "#5F7491", fontSize: "0.875rem" }}>Checking status…</div>
          ) : configured ? (
            <div>
              <span style={{
                display: "inline-block", padding: "2px 10px", borderRadius: 20,
                background: "#E3F7EC", color: "#178A55",
                fontSize: "0.78rem", fontWeight: 600,
              }}>
                ✓ Configured
              </span>
              {masked && (
                <span style={{ marginLeft: 10, color: "#5F7491", fontSize: "0.8rem", fontFamily: "monospace" }}>
                  {masked}
                </span>
              )}
            </div>
          ) : (
            <div style={{
              display: "inline-block", padding: "2px 10px", borderRadius: 20,
              background: "rgba(113,63,18,0.4)", color: "#8A5A0B",
              fontSize: "0.78rem", fontWeight: 600,
            }}>
              Not configured — AI translation disabled
            </div>
          )}
        </div>
      </div>

      {/* Configure section */}
      <div style={{
        background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 12, overflow: "hidden",
      }}>
        <div style={{
          padding: "16px 24px", borderBottom: "1px solid #DCE4EE",
          fontWeight: 700, color: "#0D1F33", fontSize: "0.9rem",
        }}>
          {configured ? "Update API Key" : "Configure API Key"}
        </div>

        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ margin: 0, color: "#3C516C", fontSize: "0.875rem", lineHeight: 1.6 }}>
            The Anthropic API key enables AI-powered translation of app strings into all 6 supported
            languages via Claude. The key is stored server-side in Firebase and is never exposed to
            app clients.
          </p>

          <div>
            <label style={{
              display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#5F7491",
              textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8,
            }}>
              Anthropic API Key
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, position: "relative" }}>
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKeyInput}
                  onChange={(e) => { setApiKeyInput(e.target.value); setMsg(""); }}
                  placeholder="sk-ant-api03-…"
                  onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
                  style={{
                    width: "100%",
                    padding: "10px 42px 10px 14px",
                    background: "#F4F7FB",
                    border: "1px solid #DCE4EE",
                    borderRadius: 8,
                    color: "#0D1F33",
                    fontSize: "0.875rem",
                    fontFamily: "monospace",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "#0B6C86"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "#DCE4EE"; }}
                />
                <button
                  onClick={() => setShowKey((v) => !v)}
                  tabIndex={-1}
                  style={{
                    position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", color: "#5F7491",
                    cursor: "pointer", fontSize: "0.9rem", padding: "2px 4px",
                  }}
                  title={showKey ? "Hide key" : "Show key"}
                >
                  {showKey ? "🙈" : "👁️"}
                </button>
              </div>
              <button
                onClick={handleSave}
                disabled={saving || !apiKeyInput.trim()}
                style={{
                  padding: "10px 22px",
                  background: "#0B6C86",
                  border: "1px solid #0B6C86",
                  borderRadius: 8,
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "0.875rem",
                  cursor: saving || !apiKeyInput.trim() ? "not-allowed" : "pointer",
                  opacity: saving || !apiKeyInput.trim() ? 0.5 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                {saving ? "Saving…" : "Save Key"}
              </button>
            </div>
          </div>

          {msg && (
            <div style={{
              padding: "10px 14px", borderRadius: 8, fontSize: "0.875rem",
              background: msg.startsWith("Error") ? "#FDE7EA" : "#E3F7EC",
              border: `1px solid ${msg.startsWith("Error") ? "#F5C2C9" : "#BFE8D2"}`,
              color: msg.startsWith("Error") ? "#C8283B" : "#178A55",
            }}>
              {msg}
            </div>
          )}
        </div>
      </div>

      {/* How to get a key */}
      <div style={{
        background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 12,
        padding: "20px 24px",
      }}>
        <div style={{ fontWeight: 700, color: "#0D1F33", fontSize: "0.875rem", marginBottom: 12 }}>
          How to get an Anthropic API key
        </div>
        <ol style={{
          margin: 0, padding: "0 0 0 20px", color: "#3C516C",
          fontSize: "0.875rem", lineHeight: 2, display: "flex", flexDirection: "column", gap: 4,
        }}>
          <li>Go to <span style={{ color: "#0B6C86", fontFamily: "monospace" }}>console.anthropic.com</span></li>
          <li>Sign in or create an account</li>
          <li>Navigate to <strong style={{ color: "#0D1F33" }}>API Keys</strong> in the left sidebar</li>
          <li>Click <strong style={{ color: "#0D1F33" }}>Create Key</strong>, give it a name (e.g. "Trapp Admin")</li>
          <li>Copy the key (starts with <code style={{ color: "#6D3FC9" }}>sk-ant-api03-</code>) and paste it above</li>
        </ol>
        <div style={{
          marginTop: 14, padding: "10px 14px", background: "rgba(11,108,134,0.08)",
          border: "1px solid #DCE4EE", borderRadius: 8,
          color: "#5F7491", fontSize: "0.8rem", lineHeight: 1.6,
        }}>
          <strong style={{ color: "#3C516C" }}>Used for:</strong> AI translation in Admin Tools → App Translations.
          Claude translates your English app strings into Hungarian, German, Croatian, Romanian, and Slovak
          in batches. A full translation of ~300 strings costs roughly $0.05–0.10.
        </div>
      </div>

    </div>
  );
}
