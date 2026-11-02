import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";
import { functions } from "../firebase";

// ─── Shared helpers ──────────────────────────────────────────────────────────

function fmt(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function fmtMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-EU", {
    style: "currency",
    currency: currency || "EUR",
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

function fmtDuration(d: string): string {
  switch (d) {
    case "1d":  return "1 Day";
    case "7d":  return "7 Days";
    case "30d": return "30 Days";
    case "1m":  return "1 Month";
    case "3m":  return "3 Months";
    case "6m":  return "6 Months";
    case "1y":  return "1 Year";
    default:    return d;
  }
}

const STATUS_COLOR: Record<string, string> = {
  completed: "#22c55e",
  pending:   "#f59e0b",
  failed:    "#ef4444",
  refunded:  "#a78bfa",
};

const SUB_STATUS_COLOR: Record<string, string> = {
  active:          "#22c55e",
  trialing:        "#60a5fa",
  pending_payment: "#f59e0b",
  cancelled:       "#f87171",
  expired:         "#94a3b8",
  payment_failed:  "#ef4444",
};

const STRIPE_WEBHOOK_URL = "https://europe-west1-playtrapnow.cloudfunctions.net/stripeWebhook";
const REVOLUT_WEBHOOK_URL = "https://europe-west1-playtrapnow.cloudfunctions.net/revolutWebhook";

// ─── Shared sub-components ───────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: string; color?: string }) {
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 12, padding: "16px 20px" }}>
      <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: color ?? "#f1f5f9" }}>{value}</div>
      {sub && <div style={{ fontSize: "0.75rem", color: "#475569", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Card({ children, title, icon }: { children: React.ReactNode; title?: string; icon?: string }) {
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 14, padding: 22, display: "grid", gap: 16 }}>
      {title && (
        <div style={{ fontWeight: 700, fontSize: "1rem", color: "#f1f5f9", display: "flex", alignItems: "center", gap: 8 }}>
          {icon && <span>{icon}</span>}
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function Msg({ text, error }: { text: string; error: boolean }) {
  if (!text) return null;
  return (
    <span style={{ fontSize: "0.875rem", color: error ? "#f87171" : "#4ade80" }}>
      {error ? "⚠ " : "✓ "}{text}
    </span>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

type PaymentSettings = {
  enabled: boolean; publishableKey: string; secretKeyMasked: string; webhookSecretMasked: string;
  hasSecretKey: boolean; hasWebhookSecret: boolean; isTestMode: boolean; currency: string;
  successUrl: string; cancelUrl: string; allowGooglePay: boolean; allowApplePay: boolean;
  updatedAtMs: number | null; updatedByUid: string | null;
};

type RevolutSettings = {
  enabled: boolean; sandboxMode: boolean; secretKeyMasked: string; webhookSecretMasked: string;
  hasSecretKey: boolean; hasWebhookSecret: boolean; currency: string;
  successUrl: string; cancelUrl: string; updatedAtMs: number | null; updatedByUid: string | null;
};

type PaymentItem = {
  id: string; uid: string | null; email: string | null; levelId: string | null;
  levelName: string | null; packageId?: string | null; packageName?: string | null;
  amount: number; currency: string; paymentType: string; status: string; isRenewal: boolean;
  gateway?: string; stripeSessionId: string | null; stripePaymentIntentId: string | null;
  stripeSubscriptionId: string | null; revolutOrderId?: string | null;
  createdAtMs: number | null; updatedAtMs: number | null;
};

type PaymentStats = { total: number; completed: number; pending: number; failed: number; totalRevenue: number; activeSubscriptions: number; currency: string };

type Discount = { code: string; discountPercent: number; validUntil: number | null; maxUses: number | null; usedCount: number; isActive: boolean };
type Package = { id: string; name: string; description: string; duration: string; price: number; currency: string; trialDays: number; isActive: boolean; isRecurring: boolean; sortOrder: number; discounts: Discount[]; createdAtMs: number | null; updatedAtMs: number | null };
type Subscription = { id: string; uid: string | null; packageId: string | null; packageName: string | null; status: string; trialEnd: number | null; currentPeriodStart: number | null; currentPeriodEnd: number | null; cancelledAt: number | null; cancelAtPeriodEnd: boolean; gateway: string; revolutOrderId: string | null; amount: number; currency: string; discountCode: string | null; createdAtMs: number | null };

type RevokedUser = { uid: string; email: string | null; levelId: string; reason: "expired" | "past_due_14d"; membershipExpiresAt: string | null };
type VerifyResult = { ok: boolean; checkedAt: string; checked: number; active: number; revoked: number; errors: number; revokedUsers: RevokedUser[] };
type SyncStatus = {
  ok: boolean; uid: string; syncNote: string; synced: boolean; wasDowngraded?: boolean;
  firestoreStatus: { membership: string | null; levelId: string | null; paymentType: string | null; billingInterval: string | null; subscriptionStatus: string | null; membershipExpiresAt: number | null; subscriptionCurrentPeriodEnd: number | null; pastDueSince: number | null; stripeSubscriptionId: string | null; stripeCustomerId: string | null };
  stripeStatus: { id: string; status: string; currentPeriodEnd: number | null; currentPeriodStart: number | null; cancelAtPeriodEnd: boolean; cancelAt: number | null; interval: string | null } | null;
};

// ─── TAB: Stripe Settings ────────────────────────────────────────────────────

function StripeSettingsTab() {
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(false);

  function set(key: string, value: unknown) { setForm((p) => ({ ...p, [key]: value })); }

  async function load() {
    setLoading(true); setMsg(""); setErr(false);
    try {
      const fn = httpsCallable<unknown, { ok: boolean; settings: PaymentSettings }>(functions, "adminGetPaymentSettings");
      const res = await fn();
      const s = res.data.settings;
      setSettings(s);
      setForm({ enabled: s.enabled, publishableKey: s.publishableKey, secretKey: s.secretKeyMasked, webhookSecret: s.webhookSecretMasked, currency: s.currency || "EUR", successUrl: s.successUrl, cancelUrl: s.cancelUrl, allowGooglePay: s.allowGooglePay, allowApplePay: s.allowApplePay });
    } catch (e) { setErr(true); setMsg(e instanceof Error ? e.message : "Failed to load"); } finally { setLoading(false); }
  }

  async function save() {
    setLoading(true); setMsg(""); setErr(false);
    try {
      const fn = httpsCallable<Record<string, unknown>, { ok: boolean }>(functions, "adminUpdatePaymentSettings");
      await fn(form); setMsg("Saved successfully."); void load();
    } catch (e) { setErr(true); setMsg(e instanceof Error ? e.message : "Save failed."); } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  const f = form;

  return (
    <>
      {settings && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderRadius: 10, background: settings.enabled ? "rgba(22,163,74,0.1)" : "rgba(100,116,139,0.1)", border: `1px solid ${settings.enabled ? "rgba(34,197,94,0.25)" : "#1e3a5f"}` }}>
          <span style={{ fontSize: "1.2rem" }}>{settings.enabled ? "✅" : "⏸"}</span>
          <div>
            <div style={{ fontWeight: 600, color: settings.enabled ? "#4ade80" : "#94a3b8" }}>Stripe {settings.enabled ? "enabled" : "disabled"}</div>
            <div style={{ fontSize: "0.78rem", color: "#64748b" }}>{settings.isTestMode ? "🔬 Test mode" : settings.hasSecretKey ? "🔴 Live mode" : "No key configured"}{settings.updatedAtMs ? ` · Saved ${fmt(settings.updatedAtMs)}` : ""}</div>
          </div>
        </div>
      )}
      <Card title="Stripe API Keys" icon="🔑">
        {[
          { key: "publishableKey", label: "Publishable Key", placeholder: "pk_live_… or pk_test_…", type: "text" },
          { key: "secretKey", label: "Secret Key (masked after save)", placeholder: "sk_live_… or sk_test_…", type: "password" },
          { key: "webhookSecret", label: "Webhook Signing Secret", placeholder: "whsec_…", type: "password" },
        ].map(({ key, label, placeholder, type }) => (
          <label key={key}>
            <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#94a3b8" }}>{label}</span>
            <input value={String(f[key] ?? "")} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} type={type} autoComplete="off" style={{ fontFamily: "monospace", fontSize: "0.85rem" }} />
          </label>
        ))}
        <div style={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 8, padding: "12px 16px" }}>
          <div style={{ fontSize: "0.78rem", color: "#64748b", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Webhook Endpoint URL</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <code style={{ flex: 1, fontSize: "0.82rem", color: "#93c5fd", wordBreak: "break-all" }}>{STRIPE_WEBHOOK_URL}</code>
            <button onClick={() => void navigator.clipboard.writeText(STRIPE_WEBHOOK_URL)} style={{ fontSize: "0.75rem", padding: "4px 10px" }}>📋 Copy</button>
          </div>
        </div>
      </Card>
      <Card title="Configuration" icon="⚙️">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <label>
            <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#94a3b8" }}>Currency</span>
            <select value={String(f.currency ?? "EUR")} onChange={(e) => set("currency", e.target.value)} style={{ width: "100%" }}>
              {["EUR","USD","GBP","HUF","HRK","RON","CZK","PLN"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={Boolean(f.enabled)} onChange={(e) => set("enabled", e.target.checked)} />
              <span style={{ fontSize: "0.875rem" }}>Enable payments</span>
            </label>
          </div>
        </div>
        {[
          { key: "successUrl", label: "Success URL", placeholder: "https://yourapp.com/payment/success" },
          { key: "cancelUrl",  label: "Cancel URL",  placeholder: "https://yourapp.com/payment/cancel" },
        ].map(({ key, label, placeholder }) => (
          <label key={key}>
            <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#94a3b8" }}>{label}</span>
            <input value={String(f[key] ?? "")} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} />
          </label>
        ))}
      </Card>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button className="btn-primary" onClick={() => void save()} disabled={loading}>{loading ? "Saving…" : "Save Settings"}</button>
        <button onClick={() => void load()} disabled={loading}>Reload</button>
        <Msg text={msg} error={err} />
      </div>
    </>
  );
}

// ─── TAB: Revolut Settings ───────────────────────────────────────────────────

function RevolutSettingsTab() {
  const [settings, setSettings] = useState<RevolutSettings | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(false);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookMsg, setWebhookMsg] = useState(""); const [webhookErr, setWebhookErr] = useState(false);
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkResult, setCheckResult] = useState<null | {
    ourWebhookRegistered: boolean; ourWebhookId: string | null; ourWebhookEvents: string[];
    signingSecretConfigured: boolean; environment: string; sandboxMode: boolean;
    webhooks: { id: string; url: string; events: string[]; isOurs: boolean }[];
  }>(null);

  function set(key: string, value: unknown) { setForm((p) => ({ ...p, [key]: value })); }

  async function registerWebhook() {
    setWebhookLoading(true); setWebhookMsg(""); setWebhookErr(false);
    try {
      const fn = httpsCallable<unknown, { ok: boolean; alreadyRegistered: boolean; webhookId: string; message: string; signingSecretSaved?: boolean }>(functions, "adminRegisterRevolutWebhook");
      const res = await fn();
      const d = res.data;
      setWebhookMsg(d.alreadyRegistered
        ? `✓ Already registered (ID: ${d.webhookId}). No changes needed.`
        : `✓ ${d.message} ID: ${d.webhookId}${d.signingSecretSaved ? " · Signing secret auto-saved." : ""}`
      );
      void load();
      void checkWebhook();
    } catch (e) { setWebhookErr(true); setWebhookMsg(e instanceof Error ? e.message : "Registration failed."); }
    finally { setWebhookLoading(false); }
  }

  async function checkWebhook() {
    setCheckLoading(true);
    try {
      const fn = httpsCallable<unknown, typeof checkResult>(functions, "adminCheckRevolutWebhooks");
      const res = await fn();
      setCheckResult(res.data);
    } catch (e) {
      setCheckResult(null);
      setWebhookErr(true);
      setWebhookMsg(e instanceof Error ? e.message : "Check failed.");
    } finally { setCheckLoading(false); }
  }

  async function load() {
    setLoading(true); setMsg(""); setErr(false);
    try {
      const fn = httpsCallable<unknown, { ok: boolean; settings: RevolutSettings }>(functions, "adminGetRevolutSettings");
      const res = await fn();
      const s = res.data.settings;
      setSettings(s);
      setForm({ enabled: s.enabled, sandboxMode: s.sandboxMode, secretKey: s.secretKeyMasked, webhookSecret: s.webhookSecretMasked, currency: s.currency || "EUR", successUrl: s.successUrl, cancelUrl: s.cancelUrl });
    } catch (e) { setErr(true); setMsg(e instanceof Error ? e.message : "Failed to load"); } finally { setLoading(false); }
  }

  async function save() {
    setLoading(true); setMsg(""); setErr(false);
    try {
      const fn = httpsCallable<Record<string, unknown>, { ok: boolean }>(functions, "adminUpdateRevolutSettings");
      await fn(form); setMsg("Saved successfully."); void load();
    } catch (e) { setErr(true); setMsg(e instanceof Error ? e.message : "Save failed."); } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  const f = form;

  return (
    <>
      {settings && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderRadius: 10, background: settings.enabled ? "rgba(22,163,74,0.1)" : "rgba(100,116,139,0.1)", border: `1px solid ${settings.enabled ? "rgba(34,197,94,0.25)" : "#1e3a5f"}` }}>
          <span style={{ fontSize: "1.4rem" }}>🔄</span>
          <div>
            <div style={{ fontWeight: 600, color: settings.enabled ? "#4ade80" : "#94a3b8" }}>Revolut {settings.enabled ? "enabled" : "disabled"}</div>
            <div style={{ fontSize: "0.78rem", color: "#64748b" }}>
              {settings.sandboxMode ? "🔬 Sandbox mode" : "🔴 Production mode"}
              {settings.updatedAtMs ? ` · Saved ${fmt(settings.updatedAtMs)}` : ""}
            </div>
          </div>
        </div>
      )}

      <Card title="Revolut Merchant API Keys" icon="🔑">
        <div style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 8, padding: "12px 14px", fontSize: "0.8rem", color: "#fbbf24", lineHeight: 1.6 }}>
          <strong>Setup:</strong> Go to Revolut Business → Merchant API → API Keys to get your secret key.
          Register the webhook URL below in <em>Revolut Merchant → Webhooks</em> and listen for <code>ORDER_COMPLETED</code> and <code>ORDER_PAYMENT_FAILED</code> events.
        </div>
        {[
          { key: "secretKey", label: "Secret API Key (masked after save)", placeholder: "sk_live_… or sk_sandbox_…", type: "password" },
          { key: "webhookSecret", label: "Webhook Signing Secret", placeholder: "whsec_…", type: "password" },
        ].map(({ key, label, placeholder, type }) => (
          <label key={key}>
            <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#94a3b8" }}>{label}</span>
            <input value={String(f[key] ?? "")} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} type={type} autoComplete="off" style={{ fontFamily: "monospace", fontSize: "0.85rem" }} />
          </label>
        ))}
        {/* Webhook endpoint + register + verify */}
        <div style={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 10, padding: "14px 16px", display: "grid", gap: 12 }}>
          {/* URL row */}
          <div>
            <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Webhook Endpoint URL</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <code style={{ flex: 1, fontSize: "0.8rem", color: "#93c5fd", wordBreak: "break-all" }}>{REVOLUT_WEBHOOK_URL}</code>
              <button onClick={() => void navigator.clipboard.writeText(REVOLUT_WEBHOOK_URL)} style={{ fontSize: "0.72rem", padding: "3px 9px", flexShrink: 0 }}>📋 Copy</button>
            </div>
          </div>

          {/* Environment hint */}
          <div style={{ fontSize: "0.75rem", color: "#64748b", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 7, padding: "8px 12px", lineHeight: 1.6 }}>
            ⚠️ <strong style={{ color: "#fbbf24" }}>Key must match environment:</strong> Production keys (<code>sk_live_…</code> or <code>sk_A…</code>) → uncheck Sandbox. Sandbox keys (<code>sk_sandbox_…</code>) → keep Sandbox checked.
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={() => void registerWebhook()}
              disabled={webhookLoading || checkLoading}
              style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(96,165,250,0.4)", background: "rgba(96,165,250,0.12)", color: "#93c5fd", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}
            >
              {webhookLoading ? "⏳ Registering…" : "🔗 Register Webhook"}
            </button>
            <button
              onClick={() => void checkWebhook()}
              disabled={checkLoading || webhookLoading}
              style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(167,139,250,0.4)", background: "rgba(167,139,250,0.1)", color: "#c4b5fd", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}
            >
              {checkLoading ? "⏳ Checking…" : "🔍 Verify Webhook Status"}
            </button>
          </div>

          {webhookMsg && (
            <div style={{ fontSize: "0.78rem", padding: "8px 12px", borderRadius: 7, background: webhookErr ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)", border: `1px solid ${webhookErr ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`, color: webhookErr ? "#f87171" : "#4ade80" }}>
              {webhookMsg}
            </div>
          )}

          {/* Verification result panel */}
          {checkResult && (
            <div style={{ background: "#060f1c", border: "1px solid #1e3a5f", borderRadius: 8, padding: "12px 14px", display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "#f1f5f9" }}>Webhook Status — {checkResult.environment.toUpperCase()}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { label: "Webhook Registered", ok: checkResult.ourWebhookRegistered, yes: `✓ Yes (ID: ${checkResult.ourWebhookId?.slice(0, 8)}…)`, no: "✗ Not registered" },
                  { label: "Signing Secret Saved", ok: checkResult.signingSecretConfigured, yes: "✓ Saved in Firestore", no: "✗ Missing — register webhook to auto-save" },
                ].map(({ label, ok, yes, no }) => (
                  <div key={label} style={{ background: ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)", border: `1px solid ${ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`, borderRadius: 7, padding: "8px 12px" }}>
                    <div style={{ fontSize: "0.7rem", color: "#64748b", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: "0.82rem", fontWeight: 600, color: ok ? "#4ade80" : "#f87171" }}>{ok ? yes : no}</div>
                  </div>
                ))}
              </div>
              {checkResult.ourWebhookRegistered && checkResult.ourWebhookEvents.length > 0 && (
                <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                  <strong style={{ color: "#94a3b8" }}>Listening for events: </strong>
                  {checkResult.ourWebhookEvents.join(", ")}
                </div>
              )}
              {checkResult.webhooks.length > 1 && (
                <div style={{ fontSize: "0.72rem", color: "#475569" }}>
                  {checkResult.webhooks.length} total webhook(s) registered with Revolut for this account.
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="Configuration" icon="⚙️">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <label>
            <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#94a3b8" }}>Currency</span>
            <select value={String(f.currency ?? "EUR")} onChange={(e) => set("currency", e.target.value)} style={{ width: "100%" }}>
              {["EUR","USD","GBP","HUF","CZK","PLN","RON","HRK"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, justifyContent: "flex-end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={Boolean(f.enabled)} onChange={(e) => set("enabled", e.target.checked)} />
              <span style={{ fontSize: "0.875rem" }}>Enable Revolut payments</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={Boolean(f.sandboxMode)} onChange={(e) => set("sandboxMode", e.target.checked)} />
              <span style={{ fontSize: "0.875rem" }}>Sandbox mode (test)</span>
            </label>
          </div>
        </div>
        {[
          { key: "successUrl", label: "Success URL", placeholder: "https://playtrapnow.web.app/payment/success" },
          { key: "cancelUrl",  label: "Cancel URL",  placeholder: "https://playtrapnow.web.app/payment/cancel" },
        ].map(({ key, label, placeholder }) => (
          <label key={key}>
            <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#94a3b8" }}>{label}</span>
            <input value={String(f[key] ?? "")} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} />
          </label>
        ))}
      </Card>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button className="btn-primary" onClick={() => void save()} disabled={loading}>{loading ? "Saving…" : "Save Settings"}</button>
        <button onClick={() => void load()} disabled={loading}>Reload</button>
        <Msg text={msg} error={err} />
      </div>
    </>
  );
}

// ─── TAB: Payment Packages ───────────────────────────────────────────────────

const DURATIONS = ["1d","7d","30d","1m","3m","6m","1y"];
const CURRENCIES = ["EUR","USD","GBP","HUF","CZK","PLN","RON","HRK"];

const EMPTY_PKG = (): Omit<Package, "id" | "createdAtMs" | "updatedAtMs"> => ({
  name: "", description: "", duration: "1m", price: 0, currency: "EUR",
  trialDays: 0, isActive: false, isRecurring: false, sortOrder: 99, discounts: [],
});

function PackagesTab() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(false);
  const [editing, setEditing] = useState<(Package | Omit<Package, "id" | "createdAtMs" | "updatedAtMs">) | null>(null);
  const [isNew, setIsNew] = useState(false);

  // Discount form
  const [discPkgId, setDiscPkgId] = useState<string | null>(null);
  const [discForm, setDiscForm] = useState({ code: "", discountPercent: 10, validUntil: "", maxUses: "" });
  const [discMsg, setDiscMsg] = useState(""); const [discErr, setDiscErr] = useState(false);

  async function load() {
    setLoading(true); setMsg(""); setErr(false);
    try {
      const fn = httpsCallable<unknown, { ok: boolean; packages: Package[] }>(functions, "adminListPaymentPackages");
      const res = await fn();
      setPackages(res.data.packages);
    } catch (e) { setErr(true); setMsg(e instanceof Error ? e.message : "Failed to load"); } finally { setLoading(false); }
  }

  async function save() {
    if (!editing) return;
    setLoading(true); setMsg(""); setErr(false);
    try {
      if (isNew) {
        const fn = httpsCallable<unknown, { ok: boolean }>(functions, "adminCreatePaymentPackage");
        await fn(editing);
        setMsg("Package created.");
      } else {
        const fn = httpsCallable<unknown, { ok: boolean }>(functions, "adminUpdatePaymentPackage");
        await fn(editing);
        setMsg("Package updated.");
      }
      setEditing(null); void load();
    } catch (e) { setErr(true); setMsg(e instanceof Error ? e.message : "Save failed."); } finally { setLoading(false); }
  }

  async function del(id: string, name: string) {
    if (!window.confirm(`Delete package "${name}"? This cannot be undone.`)) return;
    setLoading(true);
    try {
      const fn = httpsCallable<unknown, { ok: boolean }>(functions, "adminDeletePaymentPackage");
      await fn({ id }); void load();
    } catch (e) { alert(e instanceof Error ? e.message : "Delete failed."); } finally { setLoading(false); }
  }

  async function addDiscount(pkgId: string) {
    setDiscMsg(""); setDiscErr(false);
    try {
      const fn = httpsCallable<unknown, { ok: boolean }>(functions, "adminAddDiscount");
      await fn({ packageId: pkgId, code: discForm.code, discountPercent: discForm.discountPercent, validUntil: discForm.validUntil ? new Date(discForm.validUntil).getTime() : null, maxUses: discForm.maxUses ? Number(discForm.maxUses) : null });
      setDiscMsg("Discount added."); setDiscForm({ code: "", discountPercent: 10, validUntil: "", maxUses: "" }); void load();
    } catch (e) { setDiscErr(true); setDiscMsg(e instanceof Error ? e.message : "Failed."); }
  }

  async function removeDiscount(pkgId: string, code: string) {
    if (!window.confirm(`Remove discount code "${code}"?`)) return;
    try {
      const fn = httpsCallable<unknown, { ok: boolean }>(functions, "adminRemoveDiscount");
      await fn({ packageId: pkgId, code }); void load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed."); }
  }

  useEffect(() => { void load(); }, []);

  type EditablePackage = Omit<Package, "id" | "createdAtMs" | "updatedAtMs"> & { id?: string };
  const e = editing as EditablePackage | null;
  function setE(k: string, v: unknown) { setEditing((p) => p ? { ...p, [k]: v } : p); }

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn-primary" onClick={() => { setIsNew(true); setEditing(EMPTY_PKG()); }}>+ New Package</button>
        <button onClick={() => void load()} disabled={loading}>🔄 Refresh</button>
        <Msg text={msg} error={err} />
      </div>

      {/* Edit / create form */}
      {editing && (
        <Card title={isNew ? "Create Package" : "Edit Package"} icon="📦">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <label>
              <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#94a3b8" }}>Name *</span>
              <input value={e?.name ?? ""} onChange={(ev) => setE("name", ev.target.value)} placeholder="Monthly Premium" />
            </label>
            <label>
              <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#94a3b8" }}>Duration</span>
              <select value={e?.duration ?? "1m"} onChange={(ev) => setE("duration", ev.target.value)} style={{ width: "100%" }}>
                {DURATIONS.map((d) => <option key={d} value={d}>{fmtDuration(d)}</option>)}
              </select>
            </label>
            <label>
              <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#94a3b8" }}>Price (minor units — e.g. 999 = €9.99)</span>
              <input type="number" value={e?.price ?? 0} onChange={(ev) => setE("price", Number(ev.target.value))} min={0} />
            </label>
            <label>
              <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#94a3b8" }}>Currency</span>
              <select value={e?.currency ?? "EUR"} onChange={(ev) => setE("currency", ev.target.value)} style={{ width: "100%" }}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>
              <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#94a3b8" }}>Trial Days (0 = no trial)</span>
              <input type="number" value={e?.trialDays ?? 0} onChange={(ev) => setE("trialDays", Number(ev.target.value))} min={0} />
            </label>
            <label>
              <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#94a3b8" }}>Sort Order</span>
              <input type="number" value={e?.sortOrder ?? 99} onChange={(ev) => setE("sortOrder", Number(ev.target.value))} min={0} />
            </label>
          </div>
          <label>
            <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#94a3b8" }}>Description</span>
            <input value={e?.description ?? ""} onChange={(ev) => setE("description", ev.target.value)} placeholder="Unlimited access for 1 month" />
          </label>
          <div style={{ display: "flex", gap: 20 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={Boolean(e?.isActive)} onChange={(ev) => setE("isActive", ev.target.checked)} />
              <span style={{ fontSize: "0.875rem" }}>Active (visible to users)</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={Boolean(e?.isRecurring)} onChange={(ev) => setE("isRecurring", ev.target.checked)} />
              <span style={{ fontSize: "0.875rem" }}>Recurring subscription</span>
            </label>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-primary" onClick={() => void save()} disabled={loading}>{loading ? "Saving…" : "Save"}</button>
            <button onClick={() => { setEditing(null); setMsg(""); setErr(false); }}>Cancel</button>
          </div>
        </Card>
      )}

      {/* Package list */}
      {packages.length === 0 && !loading && (
        <div style={{ padding: "32px", textAlign: "center", color: "#475569", background: "#0f172a", borderRadius: 14, border: "1px solid #1e3a5f" }}>
          No packages yet. Create your first payment package above.
        </div>
      )}
      {packages.map((pkg) => (
        <div key={pkg.id} style={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 14, padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontWeight: 700, fontSize: "1rem", color: "#f1f5f9" }}>{pkg.name}</span>
                <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: 999, background: pkg.isActive ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)", color: pkg.isActive ? "#4ade80" : "#64748b", fontWeight: 600 }}>
                  {pkg.isActive ? "Active" : "Inactive"}
                </span>
                {pkg.isRecurring && <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: 999, background: "rgba(167,139,250,0.15)", color: "#a78bfa", fontWeight: 600 }}>🔄 Recurring</span>}
                {pkg.trialDays > 0 && <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: 999, background: "rgba(96,165,250,0.15)", color: "#60a5fa", fontWeight: 600 }}>{pkg.trialDays}d trial</span>}
              </div>
              <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: 3 }}>
                {fmtDuration(pkg.duration)} · {fmtMoney(pkg.price, pkg.currency)} · Sort: {pkg.sortOrder}
                {pkg.description ? ` · ${pkg.description}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setIsNew(false); setEditing({ ...pkg }); setMsg(""); setErr(false); }} style={{ fontSize: "0.8rem", padding: "5px 12px" }}>✏️ Edit</button>
              <button onClick={() => void del(pkg.id, pkg.name)} style={{ fontSize: "0.8rem", padding: "5px 12px", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)", color: "#fca5a5", borderRadius: 6, cursor: "pointer" }}>🗑 Delete</button>
            </div>
          </div>

          {/* Discounts */}
          <div style={{ borderTop: "1px solid #1a2e45", paddingTop: 12 }}>
            <div style={{ fontSize: "0.8rem", color: "#94a3b8", fontWeight: 600, marginBottom: 8 }}>🏷 Discount Codes ({pkg.discounts.length})</div>
            {pkg.discounts.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                {pkg.discounts.map((d) => (
                  <div key={d.code} style={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 8, padding: "6px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                    <code style={{ fontSize: "0.8rem", color: "#f59e0b" }}>{d.code}</code>
                    <span style={{ fontSize: "0.75rem", color: "#4ade80" }}>-{d.discountPercent}%</span>
                    {d.maxUses && <span style={{ fontSize: "0.72rem", color: "#64748b" }}>{d.usedCount}/{d.maxUses} uses</span>}
                    {d.validUntil && <span style={{ fontSize: "0.72rem", color: "#64748b" }}>until {new Date(d.validUntil).toLocaleDateString()}</span>}
                    <button onClick={() => void removeDiscount(pkg.id, d.code)} style={{ fontSize: "0.7rem", padding: "2px 6px", background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.3)", color: "#fca5a5", borderRadius: 4, cursor: "pointer" }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {discPkgId === pkg.id ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: 3 }}>Code</div>
                  <input value={discForm.code} onChange={(ev) => setDiscForm((p) => ({ ...p, code: ev.target.value.toUpperCase() }))} placeholder="PROMO10" style={{ width: 100 }} />
                </div>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: 3 }}>Discount %</div>
                  <input type="number" value={discForm.discountPercent} onChange={(ev) => setDiscForm((p) => ({ ...p, discountPercent: Number(ev.target.value) }))} min={1} max={100} style={{ width: 70 }} />
                </div>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: 3 }}>Valid until (optional)</div>
                  <input type="date" value={discForm.validUntil} onChange={(ev) => setDiscForm((p) => ({ ...p, validUntil: ev.target.value }))} style={{ width: 130 }} />
                </div>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: 3 }}>Max uses (optional)</div>
                  <input type="number" value={discForm.maxUses} onChange={(ev) => setDiscForm((p) => ({ ...p, maxUses: ev.target.value }))} placeholder="∞" style={{ width: 80 }} />
                </div>
                <button className="btn-primary" onClick={() => void addDiscount(pkg.id)} style={{ fontSize: "0.8rem" }}>Add</button>
                <button onClick={() => setDiscPkgId(null)} style={{ fontSize: "0.8rem" }}>Cancel</button>
                {discMsg && <Msg text={discMsg} error={discErr} />}
              </div>
            ) : (
              <button onClick={() => { setDiscPkgId(pkg.id); setDiscMsg(""); setDiscErr(false); }} style={{ fontSize: "0.78rem", padding: "4px 10px" }}>+ Add Discount Code</button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

// ─── TAB: Subscriptions ──────────────────────────────────────────────────────

function SubscriptionsTab() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [uidFilter, setUidFilter] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const fn = httpsCallable<unknown, { ok: boolean; subscriptions: Subscription[] }>(functions, "adminListSubscriptions");
      const res = await fn({ limit: 100, status: statusFilter || undefined, uid: uidFilter.trim() || undefined });
      setSubs(res.data.subscriptions);
    } catch (e) { alert(e instanceof Error ? e.message : "Failed to load"); } finally { setLoading(false); }
  }

  async function cancel(id: string) {
    if (!window.confirm("Cancel this subscription and revoke user membership?")) return;
    setCancelling(id);
    try {
      const fn = httpsCallable<unknown, { ok: boolean }>(functions, "adminCancelSubscription");
      await fn({ subscriptionId: id }); void load();
    } catch (e) { alert(e instanceof Error ? e.message : "Cancel failed."); } finally { setCancelling(null); }
  }

  useEffect(() => { void load(); }, [statusFilter]);

  const active = subs.filter((s) => s.status === "active").length;
  const trials = subs.filter((s) => s.status === "trialing").length;

  return (
    <>
      {subs.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
          <StatCard label="Total" value={subs.length} />
          <StatCard label="Active" value={active} color="#22c55e" />
          <StatCard label="Trialing" value={trials} color="#60a5fa" />
          <StatCard label="Cancelled" value={subs.filter((s) => s.status === "cancelled").length} color="#f87171" />
        </div>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 180 }}>
          <option value="">All statuses</option>
          {["active","trialing","pending_payment","cancelled","expired","payment_failed"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input value={uidFilter} onChange={(e) => setUidFilter(e.target.value)} placeholder="Filter by UID…" style={{ width: 220, fontFamily: "monospace", fontSize: "0.82rem" }} onKeyDown={(e) => { if (e.key === "Enter") void load(); }} />
        <button onClick={() => void load()} disabled={loading}>🔄 {loading ? "Loading…" : "Refresh"}</button>
      </div>
      <div style={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
            <thead>
              <tr style={{ background: "#0a1628" }}>
                {["Created","User UID","Package","Duration","Status","Gateway Order","Actions"].map((h) => (
                  <th key={h} style={{ padding: "12px 14px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap", borderBottom: "1px solid #1e3a5f" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subs.length === 0 && (
                <tr><td colSpan={7} style={{ padding: "32px 14px", textAlign: "center", color: "#475569" }}>{loading ? "Loading…" : "No subscriptions found."}</td></tr>
              )}
              {subs.map((sub, idx) => (
                <tr key={sub.id} style={{ background: idx % 2 === 0 ? "transparent" : "rgba(15,23,42,0.5)" }}>
                  <td style={{ padding: "10px 14px", color: "#94a3b8", whiteSpace: "nowrap", verticalAlign: "top" }}>{fmt(sub.createdAtMs)}</td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    <div style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "#64748b" }}>{sub.uid?.slice(0, 16) ?? "—"}…</div>
                  </td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    <div style={{ color: "#e2e8f0" }}>{sub.packageName ?? sub.packageId ?? "—"}</div>
                    <div style={{ fontSize: "0.75rem", color: "#475569" }}>{fmtMoney(sub.amount, sub.currency)}</div>
                    {sub.discountCode && <div style={{ fontSize: "0.72rem", color: "#f59e0b" }}>Code: {sub.discountCode}</div>}
                  </td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                    {sub.currentPeriodEnd ? (
                      <>
                        <div style={{ color: "#94a3b8", fontSize: "0.8rem" }}>Until {new Date(sub.currentPeriodEnd).toLocaleDateString()}</div>
                        {sub.trialEnd && <div style={{ color: "#60a5fa", fontSize: "0.75rem" }}>Trial ends {new Date(sub.trialEnd).toLocaleDateString()}</div>}
                        {sub.cancelAtPeriodEnd && <div style={{ color: "#f87171", fontSize: "0.72rem" }}>⚠ Cancels at period end</div>}
                      </>
                    ) : "—"}
                  </td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    <span style={{ fontSize: "0.73rem", fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: `${SUB_STATUS_COLOR[sub.status] ?? "#94a3b8"}20`, color: SUB_STATUS_COLOR[sub.status] ?? "#94a3b8", textTransform: "capitalize" }}>
                      {sub.status.replace("_", " ")}
                    </span>
                    <div style={{ fontSize: "0.72rem", color: "#475569", marginTop: 3 }}>{sub.gateway}</div>
                  </td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    {sub.revolutOrderId && (
                      <div style={{ fontSize: "0.72rem", fontFamily: "monospace", color: "#475569" }} title={sub.revolutOrderId}>{sub.revolutOrderId.slice(0, 16)}…</div>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    {["active","trialing","pending_payment"].includes(sub.status) && (
                      <button onClick={() => void cancel(sub.id)} disabled={cancelling === sub.id} style={{ fontSize: "0.75rem", padding: "4px 10px", background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.3)", color: "#fca5a5", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap" }}>
                        {cancelling === sub.id ? "Cancelling…" : "🚫 Cancel"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ─── TAB: Payment History ────────────────────────────────────────────────────

function PaymentHistoryTab() {
  const [items, setItems] = useState<PaymentItem[]>([]);
  const [stats, setStats] = useState<PaymentStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [refundingId, setRefundingId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setMsg(""); setErr(false);
    try {
      const fn = httpsCallable<unknown, { ok: boolean; items: PaymentItem[]; stats: PaymentStats }>(functions, "adminGetPaymentHistory");
      const res = await fn({ limit: 100, status: statusFilter || undefined });
      setItems(res.data.items); setStats(res.data.stats);
    } catch (e) { setErr(true); setMsg(e instanceof Error ? e.message : "Failed."); } finally { setLoading(false); }
  }

  async function refund(item: PaymentItem) {
    if (!window.confirm("Issue a full refund for this payment?")) return;
    setRefundingId(item.id);
    try {
      const fnName = item.gateway === "revolut" ? "adminRefundRevolutPayment" : "adminRefundPayment";
      const fn = httpsCallable<{ paymentId: string }, { ok: boolean }>(functions, fnName);
      await fn({ paymentId: item.id }); void load();
    } catch (e) { alert(e instanceof Error ? e.message : "Refund failed."); } finally { setRefundingId(null); }
  }

  useEffect(() => { void load(); }, [statusFilter]);

  return (
    <>
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Completed" value={stats.completed} color="#22c55e" />
          <StatCard label="Pending" value={stats.pending} color="#f59e0b" />
          <StatCard label="Failed" value={stats.failed} color="#ef4444" />
          <StatCard label="Revenue" value={fmtMoney(stats.totalRevenue, stats.currency)} color="#60a5fa" sub="completed only" />
          <StatCard label="Active Subs" value={stats.activeSubscriptions} color="#a78bfa" sub="unique subscribers" />
        </div>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 180 }}>
          <option value="">All statuses</option>
          {["completed","pending","failed","refunded"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "🔄 Refresh"}</button>
        {msg && <Msg text={msg} error={err} />}
      </div>
      <div style={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
            <thead>
              <tr style={{ background: "#0a1628" }}>
                {["Date","User","Package / Level","Amount","Gateway","Type","Status","Actions"].map((h) => (
                  <th key={h} style={{ padding: "12px 14px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap", borderBottom: "1px solid #1e3a5f" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={8} style={{ padding: "32px 14px", textAlign: "center", color: "#475569" }}>{loading ? "Loading…" : "No payments found."}</td></tr>
              )}
              {items.map((item, idx) => (
                <tr key={item.id} style={{ background: idx % 2 === 0 ? "transparent" : "rgba(15,23,42,0.5)" }}>
                  <td style={{ padding: "10px 14px", color: "#94a3b8", whiteSpace: "nowrap", verticalAlign: "top" }}>{fmt(item.createdAtMs)}</td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    <div style={{ color: "#e2e8f0", fontSize: "0.82rem" }}>{item.email ?? "—"}</div>
                    <div style={{ color: "#475569", fontSize: "0.75rem", fontFamily: "monospace" }}>{item.uid ?? ""}</div>
                  </td>
                  <td style={{ padding: "10px 14px", color: "#94a3b8", verticalAlign: "top" }}>
                    {item.packageName ?? item.levelName ?? item.packageId ?? item.levelId ?? "—"}
                  </td>
                  <td style={{ padding: "10px 14px", fontWeight: 600, color: "#f1f5f9", verticalAlign: "top", whiteSpace: "nowrap" }}>{fmtMoney(item.amount, item.currency)}</td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    <span style={{ fontSize: "0.73rem", fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: item.gateway === "revolut" ? "rgba(96,165,250,0.15)" : "rgba(167,139,250,0.15)", color: item.gateway === "revolut" ? "#60a5fa" : "#a78bfa" }}>
                      {item.gateway === "revolut" ? "🔄 Revolut" : "🟣 Stripe"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    <span style={{ fontSize: "0.73rem", fontWeight: 600, padding: "3px 8px", borderRadius: 999, background: item.paymentType === "recurring" ? "rgba(167,139,250,0.15)" : "rgba(96,165,250,0.13)", color: item.paymentType === "recurring" ? "#a78bfa" : "#60a5fa", whiteSpace: "nowrap" }}>
                      {item.isRenewal ? "🔄 Renewal" : item.paymentType === "recurring" ? "📅 Subscription" : "1× One-time"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    <span style={{ fontSize: "0.73rem", fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: `${STATUS_COLOR[item.status] ?? "#94a3b8"}20`, color: STATUS_COLOR[item.status] ?? "#94a3b8", textTransform: "capitalize" }}>
                      {item.status}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    {item.status === "completed" && (item.stripePaymentIntentId || item.revolutOrderId) && (
                      <button onClick={() => void refund(item)} disabled={refundingId === item.id} style={{ fontSize: "0.75rem", padding: "4px 10px", background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.3)", color: "#fca5a5", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap" }}>
                        {refundingId === item.id ? "Refunding…" : "💸 Refund"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {items.length > 0 && <div style={{ fontSize: "0.75rem", color: "#374151" }}>Showing up to 100 most recent payments.</div>}
    </>
  );
}

// ─── TAB: Verification ───────────────────────────────────────────────────────

function VerificationTab() {
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState(""); const [verifyErr, setVerifyErr] = useState(false);
  const [syncUid, setSyncUid] = useState("");
  const [syncResult, setSyncResult] = useState<SyncStatus | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);

  async function runVerify() {
    setVerifyLoading(true); setVerifyMsg(""); setVerifyErr(false); setVerifyResult(null);
    try {
      const fn = httpsCallable<unknown, VerifyResult>(functions, "adminVerifyMemberships");
      const res = await fn();
      setVerifyResult(res.data);
      setVerifyMsg(`Check complete — ${res.data.checked} users checked, ${res.data.revoked} revoked.`);
    } catch (e) { setVerifyErr(true); setVerifyMsg(e instanceof Error ? e.message : "Verification failed."); } finally { setVerifyLoading(false); }
  }

  async function runSync() {
    if (!syncUid.trim()) return;
    setSyncLoading(true); setSyncResult(null);
    try {
      const fn = httpsCallable<{ uid: string }, SyncStatus>(functions, "adminSyncUserMembership");
      const res = await fn({ uid: syncUid.trim() });
      setSyncResult(res.data);
    } catch (e) {
      setSyncResult({ ok: false, uid: syncUid, synced: false, syncNote: e instanceof Error ? e.message : "Unknown error", firestoreStatus: { membership: null, levelId: null, paymentType: null, billingInterval: null, subscriptionStatus: null, membershipExpiresAt: null, subscriptionCurrentPeriodEnd: null, pastDueSince: null, stripeSubscriptionId: null, stripeCustomerId: null }, stripeStatus: null });
    } finally { setSyncLoading(false); }
  }

  return (
    <>
      <Card>
        <div style={{ fontWeight: 700, fontSize: "1rem", color: "#f1f5f9", marginBottom: 10 }}>🔍 Membership Verification</div>
        <p style={{ fontSize: "0.875rem", color: "#64748b", lineHeight: 1.7, margin: 0 }}>
          The <strong style={{ color: "#94a3b8" }}>daily scheduled sweep</strong> runs automatically and revokes memberships where <code style={{ color: "#93c5fd", fontSize: "0.82rem" }}>membershipExpiresAt</code> has passed.
          Use <strong style={{ color: "#94a3b8" }}>Run Check Now</strong> to trigger it immediately.
        </p>
      </Card>
      <Card>
        <div style={{ fontWeight: 700, fontSize: "1rem", color: "#f1f5f9", marginBottom: 14 }}>▶ Run Membership Check Now</div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
          <button className="btn-primary" onClick={() => void runVerify()} disabled={verifyLoading}>{verifyLoading ? "⏳ Running…" : "🔍 Run Check"}</button>
          {verifyMsg && <Msg text={verifyMsg} error={verifyErr} />}
        </div>
        {verifyResult && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, marginBottom: 16 }}>
              {[["Checked", verifyResult.checked, "#94a3b8"], ["Active", verifyResult.active, "#4ade80"], ["Revoked", verifyResult.revoked, "#f87171"], ["Errors", verifyResult.errors, "#f59e0b"]].map(([label, value, color]) => (
                <div key={label as string} style={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 10, padding: "12px 16px" }}>
                  <div style={{ fontSize: "0.72rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: "1.4rem", fontWeight: 700, color: color as string }}>{value as number}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: "0.72rem", color: "#475569", marginBottom: 10 }}>Checked at: {new Date(verifyResult.checkedAt).toLocaleString()}</div>
            {verifyResult.revokedUsers.length === 0 ? (
              <div style={{ fontSize: "0.875rem", color: "#4ade80", padding: 12, background: "rgba(22,163,74,0.08)", borderRadius: 8, border: "1px solid rgba(34,197,94,0.2)" }}>✓ No expired memberships found.</div>
            ) : (
              <div style={{ fontSize: "0.82rem", color: "#f87171", marginBottom: 8 }}>{verifyResult.revokedUsers.length} revoked user(s)</div>
            )}
          </>
        )}
      </Card>
      <Card>
        <div style={{ fontWeight: 700, fontSize: "1rem", color: "#f1f5f9", marginBottom: 14 }}>🔗 Sync Individual User from Stripe</div>
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <input value={syncUid} onChange={(e) => setSyncUid(e.target.value)} placeholder="User UID" style={{ flex: 1, fontFamily: "monospace", fontSize: "0.85rem" }} onKeyDown={(e) => { if (e.key === "Enter") void runSync(); }} />
          <button className="btn-primary" onClick={() => void runSync()} disabled={syncLoading || !syncUid.trim()} style={{ whiteSpace: "nowrap" }}>{syncLoading ? "Syncing…" : "🔗 Sync"}</button>
        </div>
        {syncResult && (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: syncResult.ok ? "rgba(22,163,74,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${syncResult.ok ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`, fontSize: "0.875rem", color: syncResult.ok ? "#4ade80" : "#f87171" }}>
            {syncResult.ok ? "✓ " : "✗ "}{syncResult.syncNote}
          </div>
        )}
      </Card>
    </>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

type Tab = "stripe" | "revolut" | "packages" | "subscriptions" | "history" | "verify";

const TABS: { key: Tab; label: string }[] = [
  { key: "stripe",        label: "🟣 Stripe" },
  { key: "revolut",       label: "🔄 Revolut" },
  { key: "packages",      label: "📦 Packages" },
  { key: "subscriptions", label: "📋 Subscriptions" },
  { key: "history",       label: "📊 History" },
  { key: "verify",        label: "🔍 Verify" },
];

export default function PaymentOptionsPanel() {
  const [tab, setTab] = useState<Tab>("revolut");

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 1100 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, background: "#0f172a", borderRadius: 10, padding: 4, border: "1px solid #1e3a5f", width: "fit-content", flexWrap: "wrap" }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "8px 18px",
              borderRadius: 7,
              border: "none",
              background: tab === key ? "#1d4ed8" : "transparent",
              color: tab === key ? "#fff" : "#94a3b8",
              fontWeight: tab === key ? 600 : 400,
              fontSize: "0.875rem",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "stripe"        && <StripeSettingsTab />}
      {tab === "revolut"       && <RevolutSettingsTab />}
      {tab === "packages"      && <PackagesTab />}
      {tab === "subscriptions" && <SubscriptionsTab />}
      {tab === "history"       && <PaymentHistoryTab />}
      {tab === "verify"        && <VerificationTab />}
    </div>
  );
}
