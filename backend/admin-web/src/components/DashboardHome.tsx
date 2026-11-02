import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { functions } from "../firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

type Totals = {
  totalUsers?: number;
  newUsers7d?: number;
  newUsers30d?: number;
  totalTraps?: number;
  activeTraps?: number;
  capturedTraps?: number;
  disarmedTraps?: number;
  trapsPlaced30d?: number;
  totalCaptures?: number;
  totalRevenue?: number;
  revenue30d?: number;
  revenueCount?: number;
};

type SupportStats = {
  open?: number;
  waitingAdmin?: number;
  waitingUser?: number;
  answered?: number;
  closed?: number;
  total?: number;
  needsAttention?: number;
  unreadByAdmin?: number;
};

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  sub,
  accent,
  alert,
}: {
  icon: string;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  alert?: boolean;
}) {
  return (
    <div
      style={{
        background: "#F4F7FB",
        border: `1px solid ${alert ? "rgba(239,68,68,0.4)" : "#DCE4EE"}`,
        borderRadius: 14,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        boxShadow: alert ? "0 0 0 1px rgba(239,68,68,0.15)" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "1.2rem" }}>{icon}</span>
        {sub && (
          <span style={{ fontSize: "0.72rem", color: "#5F7491", fontWeight: 500 }}>{sub}</span>
        )}
      </div>
      <div
        style={{
          fontSize: "1.9rem",
          fontWeight: 900,
          color: alert ? "#C8283B" : (accent ?? "#0D1F33"),
          lineHeight: 1,
          letterSpacing: "-0.5px",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: "0.78rem", color: "#5F7491", fontWeight: 500 }}>
        {label}
      </div>
    </div>
  );
}

// ─── Support status row ────────────────────────────────────────────────────────

const SUPPORT_ROWS = [
  { key: "open" as const,        label: "Open",             icon: "🆕", color: "#8A5A0B", bg: "rgba(251,191,36,0.10)",  urgent: true  },
  { key: "waitingAdmin" as const, label: "Awaiting Reply",  icon: "⏳", color: "#C2410C", bg: "rgba(249,115,22,0.10)",  urgent: true  },
  { key: "waitingUser" as const,  label: "Waiting on User", icon: "💬", color: "#0B6C86", bg: "rgba(96,165,250,0.08)",  urgent: false },
  { key: "answered" as const,     label: "Answered",        icon: "✅", color: "#178A55", bg: "rgba(52,211,153,0.08)",  urgent: false },
  { key: "closed" as const,       label: "Closed",          icon: "🔒", color: "#5F7491", bg: "rgba(71,85,105,0.12)",   urgent: false },
];

export default function DashboardHome({ user }: { user: User }) {
  const [totals, setTotals]           = useState<Totals | null>(null);
  const [support, setSupport]         = useState<SupportStats | null>(null);
  const [totalsErr, setTotalsErr]     = useState("");
  const [supportErr, setSupportErr]   = useState("");
  const [totalsLoading, setTotalsLoading]   = useState(true);
  const [supportLoading, setSupportLoading] = useState(true);

  async function loadTotals() {
    setTotalsLoading(true);
    setTotalsErr("");
    try {
      const res = await httpsCallable<void, Totals>(functions, "adminDashboardTotals")();
      setTotals(res.data);
    } catch (e: any) {
      setTotalsErr(e?.message ?? "Could not load totals.");
    } finally {
      setTotalsLoading(false);
    }
  }

  async function loadSupport() {
    setSupportLoading(true);
    setSupportErr("");
    setSupport(null);
    try {
      const res = await httpsCallable<void, SupportStats>(functions, "adminGetSupportStats")();
      setSupport(res.data);
    } catch (e: any) {
      setSupportErr(e?.message ?? "Could not load support stats.");
    } finally {
      setSupportLoading(false);
    }
  }

  useEffect(() => {
    void loadTotals();
    void loadSupport();
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div style={{ display: "grid", gap: 24 }}>

      {/* Welcome bar */}
      <div
        style={{
          background: "linear-gradient(135deg, #F4F7FB 0%, #F4F7FB 100%)",
          border: "1px solid #DCE4EE",
          borderRadius: 14,
          padding: "20px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#0D1F33" }}>
            {greeting} 👋
          </div>
          <div style={{ fontSize: "0.85rem", color: "#5F7491", marginTop: 3 }}>
            {user.email ?? user.uid} · {new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </div>
        </div>
        <button
          onClick={() => { void loadTotals(); void loadSupport(); }}
          disabled={totalsLoading || supportLoading}
          style={{ flexShrink: 0 }}
        >
          {(totalsLoading || supportLoading) ? "⏳ Loading…" : "🔄 Refresh"}
        </button>
      </div>

      {/* KPI grid */}
      {totalsErr ? (
        <div style={{ color: "#C8283B", fontSize: "0.875rem" }}>⚠ {totalsErr}</div>
      ) : (
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          }}
        >
          <KpiCard
            icon="👥"
            label="Total Users"
            value={totals?.totalUsers ?? (totalsLoading ? "…" : "—")}
            sub={totals ? `+${totals.newUsers7d ?? 0} this week` : undefined}
            accent="#0B6C86"
          />
          <KpiCard
            icon="📈"
            label="New Users (30d)"
            value={totals?.newUsers30d ?? (totalsLoading ? "…" : "—")}
            accent="#178A55"
          />
          <KpiCard
            icon="🪤"
            label="Active Traps"
            value={totals?.activeTraps ?? (totalsLoading ? "…" : "—")}
            sub={totals ? `${totals.totalTraps ?? 0} total placed` : undefined}
            accent="#8A5A0B"
          />
          <KpiCard
            icon="🎯"
            label="Total Captures"
            value={totals?.totalCaptures ?? (totalsLoading ? "…" : "—")}
            accent="#6D3FC9"
          />
          <KpiCard
            icon="🔒"
            label="Disarmed Traps"
            value={totals?.disarmedTraps ?? (totalsLoading ? "…" : "—")}
            accent="#3C516C"
          />
          <KpiCard
            icon="💰"
            label="Revenue (30d)"
            value={totals ? `€${totals.revenue30d ?? 0}` : (totalsLoading ? "…" : "—")}
            sub={totals ? `€${totals.totalRevenue ?? 0} total` : undefined}
            accent="#178A55"
          />
        </div>
      )}

      {/* Support tickets breakdown */}
      <div
        style={{
          background: "#F4F7FB",
          border: "1px solid #DCE4EE",
          borderRadius: 14,
          padding: "20px 22px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: "1rem", color: "#0D1F33" }}>
              🎫 Support Tickets
            </div>
            <div style={{ fontSize: "0.78rem", color: "#5F7491", marginTop: 2 }}>
              {support
                ? `${support.total ?? 0} total · ${support.needsAttention ?? 0} need attention · ${support.unreadByAdmin ?? 0} unread`
                : supportLoading ? "Loading…" : supportErr}
            </div>
          </div>
          {support && (support.needsAttention ?? 0) > 0 && (
            <div
              style={{
                background: "rgba(239,68,68,0.15)",
                border: "1px solid rgba(239,68,68,0.35)",
                borderRadius: 8,
                padding: "6px 14px",
                color: "#C8283B",
                fontWeight: 700,
                fontSize: "0.875rem",
              }}
            >
              ⚠ {support.needsAttention} need reply
            </div>
          )}
        </div>

        {supportErr ? (
          <div style={{ color: "#C8283B", fontSize: "0.875rem" }}>⚠ {supportErr}</div>
        ) : supportLoading ? (
          <div style={{ color: "#5F7491", fontSize: "0.875rem" }}>Loading…</div>
        ) : support && (support.total ?? 0) === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "28px 0",
              color: "#5F7491",
              fontSize: "0.9rem",
            }}
          >
            <div style={{ fontSize: "2rem", marginBottom: 8 }}>✅</div>
            No open support tickets
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            }}
          >
            {SUPPORT_ROWS.map(({ key, label, icon, color, bg, urgent }) => {
              const count = (support?.[key] ?? 0) as number;
              return (
                <div
                  key={key}
                  style={{
                    background: count > 0 ? bg : "#F4F7FB",
                    border: count > 0 && urgent
                      ? `1px solid ${color}55`
                      : "1px solid #DCE4EE",
                    borderRadius: 10,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: "1.05rem", opacity: count > 0 ? 1 : 0.4 }}>{icon}</span>
                  <div>
                    <div
                      style={{
                        fontSize: "1.4rem",
                        fontWeight: 900,
                        color: count > 0 ? color : "#DCE4EE",
                        lineHeight: 1,
                      }}
                    >
                      {count}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "#5F7491", marginTop: 2 }}>
                      {label}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Trap activity breakdown */}
      {totals && (
        <div
          style={{
            background: "#F4F7FB",
            border: "1px solid #DCE4EE",
            borderRadius: 14,
            padding: "20px 22px",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: "1rem", color: "#0D1F33", marginBottom: 14 }}>
            🪤 Trap Activity Overview
          </div>
          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            }}
          >
            {[
              { label: "Total Placed",       value: totals.totalTraps ?? 0,     color: "#0B6C86" },
              { label: "Placed (30d)",        value: totals.trapsPlaced30d ?? 0, color: "#178A55" },
              { label: "Active Now",          value: totals.activeTraps ?? 0,    color: "#8A5A0B" },
              { label: "Captured",            value: totals.capturedTraps ?? 0,  color: "#C2410C" },
              { label: "Disarmed",            value: totals.disarmedTraps ?? 0,  color: "#3C516C" },
              { label: "Total Captures",      value: totals.totalCaptures ?? 0,  color: "#6D3FC9" },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                style={{
                  background: "#F4F7FB",
                  border: "1px solid #DCE4EE",
                  borderRadius: 10,
                  padding: "12px 14px",
                }}
              >
                <div style={{ fontSize: "1.5rem", fontWeight: 800, color, lineHeight: 1 }}>
                  {value}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#5F7491", marginTop: 4 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
