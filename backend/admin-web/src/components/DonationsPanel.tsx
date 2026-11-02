import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";
import { functions } from "../firebase";

type DonationItem = {
  id: string;
  uid: string | null;
  email: string | null;
  amount: number;
  currency: string;
  message: string | null;
  status: string;
  gateway: string;
  revolutOrderId: string | null;
  createdAtMs: number | null;
};

type DonationStats = {
  total: number;
  completed: number;
  pending: number;
  totalAmount: number;
  currency: string;
};

function fmt(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function fmtMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-EU", { style: "currency", currency: currency || "EUR", minimumFractionDigits: 2 }).format(amount / 100);
}

const STATUS_COLOR: Record<string, string> = {
  completed: "#22c55e", pending: "#f59e0b", failed: "#ef4444",
};

export default function DonationsPanel() {
  const [items, setItems] = useState<DonationItem[]>([]);
  const [stats, setStats] = useState<DonationStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(false);

  async function load() {
    setLoading(true); setMsg(""); setErr(false);
    try {
      const fn = httpsCallable<unknown, { ok: boolean; items: DonationItem[]; stats: DonationStats }>(functions, "adminGetDonations");
      const res = await fn({ limit: 200 });
      setItems(res.data.items);
      setStats(res.data.stats);
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to load donations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 1000 }}>
      {/* Stats */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
          {[
            { label: "Total Donations", value: stats.total, color: "#94a3b8" },
            { label: "Completed",       value: stats.completed, color: "#22c55e" },
            { label: "Pending",         value: stats.pending, color: "#f59e0b" },
            { label: "Total Raised",    value: fmtMoney(stats.totalAmount, stats.currency), color: "#60a5fa" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Info */}
      <div style={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 14, padding: 18 }}>
        <div style={{ fontWeight: 700, color: "#f1f5f9", marginBottom: 8 }}>🎁 About Donations</div>
        <p style={{ fontSize: "0.875rem", color: "#64748b", lineHeight: 1.7, margin: 0 }}>
          Users can donate <strong style={{ color: "#94a3b8" }}>€1, €5, €15, €30</strong> or a custom amount from the app (Profile → Support the App).
          Donations are one-time Revolut payments. Suggested amounts can be updated in the Revolut API client.
          Each donation is logged here and in the unified Payment History.
        </p>
      </div>

      {/* Refresh + message */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={() => void load()} disabled={loading}>🔄 {loading ? "Loading…" : "Refresh"}</button>
        {msg && <span style={{ fontSize: "0.875rem", color: err ? "#f87171" : "#4ade80" }}>{err ? "⚠ " : "✓ "}{msg}</span>}
      </div>

      {/* Table */}
      <div style={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
            <thead>
              <tr style={{ background: "#0a1628" }}>
                {["Date", "User", "Amount", "Status", "Message", "Order ID"].map((h) => (
                  <th key={h} style={{ padding: "12px 14px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap", borderBottom: "1px solid #1e3a5f" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={6} style={{ padding: "32px 14px", textAlign: "center", color: "#475569" }}>{loading ? "Loading…" : "No donations yet."}</td></tr>
              )}
              {items.map((item, idx) => (
                <tr key={item.id} style={{ background: idx % 2 === 0 ? "transparent" : "rgba(15,23,42,0.5)" }}>
                  <td style={{ padding: "10px 14px", color: "#94a3b8", whiteSpace: "nowrap", verticalAlign: "top" }}>{fmt(item.createdAtMs)}</td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    <div style={{ fontSize: "0.82rem", color: "#e2e8f0" }}>{item.email ?? "—"}</div>
                    <div style={{ fontSize: "0.75rem", color: "#475569", fontFamily: "monospace" }}>{item.uid?.slice(0, 12) ?? ""}…</div>
                  </td>
                  <td style={{ padding: "10px 14px", fontWeight: 700, color: "#f1f5f9", whiteSpace: "nowrap", verticalAlign: "top" }}>
                    {fmtMoney(item.amount, item.currency)}
                  </td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    <span style={{ fontSize: "0.73rem", fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: `${STATUS_COLOR[item.status] ?? "#94a3b8"}20`, color: STATUS_COLOR[item.status] ?? "#94a3b8", textTransform: "capitalize" }}>
                      {item.status}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", color: "#64748b", fontSize: "0.82rem", verticalAlign: "top", maxWidth: 200 }}>
                    {item.message ?? <span style={{ color: "#374151" }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    {item.revolutOrderId && (
                      <div style={{ fontSize: "0.72rem", fontFamily: "monospace", color: "#475569" }} title={item.revolutOrderId}>
                        {item.revolutOrderId.slice(0, 16)}…
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
