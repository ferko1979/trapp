import { httpsCallable } from "firebase/functions";
import { useEffect, useRef, useState } from "react";
import { functions } from "../firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuditEntry = {
  id: string;
  timestampMs: number | null;
  adminUid: string | null;
  adminEmail: string | null;
  adminName: string | null;
  category: string;
  action: string;
  targetId: string | null;
  targetName: string | null;
  summary: string;
  details: Record<string, unknown>;
};

// ─── Category meta ────────────────────────────────────────────────────────────

const CATEGORIES: { value: string; label: string; icon: string; color: string }[] = [
  { value: "",                label: "All categories",   icon: "📋", color: "#5F7491" },
  { value: "auth",            label: "Auth",             icon: "🔐", color: "#6D3FC9" },
  { value: "users",           label: "Users",            icon: "👤", color: "#0B6C86" },
  { value: "game_settings",   label: "Game Settings",    icon: "🎮", color: "#8A5A0B" },
  { value: "general_settings",label: "General Settings", icon: "⚙️", color: "#3C516C" },
  { value: "levels",          label: "Levels",           icon: "🏅", color: "#178A55" },
  { value: "trap_definitions",label: "Trap Definitions", icon: "🪤", color: "#C2410C" },
  { value: "traps",           label: "Traps",            icon: "🎯", color: "#C2410C" },
  { value: "terms",           label: "Terms",            icon: "📜", color: "#0D1F33" },
  { value: "support",         label: "Support",          icon: "🎫", color: "#C8283B" },
  { value: "messaging",       label: "Messaging",        icon: "💬", color: "#0B6C86" },
  { value: "other",           label: "Other",            icon: "🔹", color: "#5F7491" },
];

const ACTION_VERB: Record<string, string> = {
  CREATE_USER: "Created user",
  UPDATE_USER_PROFILE: "Updated user profile",
  UPDATE_USER_STATUS: "Changed user status",
  SET_USER_LEVEL: "Changed user level",
  SET_USER_PASSWORD: "Reset password",
  DELETE_USER: "Deleted user",
  HARD_DELETE_USER: "Permanently erased user (deletion request)",
  SELF_DELETE_ACCOUNT: "Deleted own account (self-service)",
  GRANT_ADMIN: "Granted admin",
  REVOKE_ADMIN: "Revoked admin",
  UPDATE_ADMIN_PROFILE: "Updated admin profile",
  UPDATE_GAME_SETTINGS: "Updated game settings",
  UPDATE_GENERAL_SETTINGS: "Updated general settings",
  CREATE_LEVEL: "Created level",
  UPDATE_LEVEL: "Updated level",
  DELETE_LEVEL: "Deleted level",
  CREATE_TRAP_DEFINITION: "Created trap definition",
  UPDATE_TRAP_DEFINITION: "Updated trap definition",
  DELETE_TRAP_DEFINITION: "Deleted trap definition",
  UPDATE_TRAP_STATUS: "Changed trap status",
  DELETE_TRAP: "Deleted trap",
  UPDATE_TERMS: "Updated T&Cs",
  CREATE_SUPPORT_TICKET: "Opened ticket",
  REPLY_SUPPORT_TICKET: "Replied to ticket",
};

function catMeta(category: string) {
  return (
    CATEGORIES.find((c) => c.value === category) ??
    { value: category, label: category, icon: "🔹", color: "#5F7491" }
  );
}

function fmt(ms: number | null): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

// ─── Expandable details row ───────────────────────────────────────────────────

function DetailsModal({
  entry,
  onClose,
}: {
  entry: AuditEntry;
  onClose: () => void;
}) {
  const cat = catMeta(entry.category);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(11,22,38,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#F4F7FB",
          border: "1px solid #DCE4EE",
          borderRadius: 14,
          padding: 24,
          maxWidth: 680,
          width: "100%",
          maxHeight: "80vh",
          overflowY: "auto",
          display: "grid",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 700, fontSize: "1rem", color: "#0D1F33" }}>
            {cat.icon} {ACTION_VERB[entry.action] ?? entry.action}
          </div>
          <button onClick={onClose} style={{ padding: "4px 12px" }}>✕</button>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {[
            ["Timestamp", fmt(entry.timestampMs)],
            ["Category", `${cat.icon} ${cat.label}`],
            ["Action", entry.action],
            ["Admin UID", entry.adminUid ?? "—"],
            ["Admin Email", entry.adminEmail ?? "—"],
            ["Admin Name", entry.adminName ?? "—"],
            ["Target ID", entry.targetId ?? "—"],
            ["Target Name", entry.targetName ?? "—"],
            ["Summary", entry.summary],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: 12,
                borderBottom: "1px solid #DCE4EE",
                paddingBottom: 6,
                alignItems: "start",
              }}
            >
              <span style={{ color: "#5F7491", fontSize: "0.8rem", fontWeight: 600 }}>
                {label}
              </span>
              <span style={{ color: "#0D1F33", fontSize: "0.85rem", wordBreak: "break-all" }}>
                {value}
              </span>
            </div>
          ))}
        </div>

        {Object.keys(entry.details).length > 0 && (
          <div>
            <div style={{ fontWeight: 600, fontSize: "0.8rem", color: "#5F7491", marginBottom: 8 }}>
              Details
            </div>
            <pre
              style={{
                background: "#F4F7FB",
                border: "1px solid #DCE4EE",
                borderRadius: 8,
                padding: 14,
                fontSize: "0.78rem",
                color: "#3C516C",
                overflowX: "auto",
                margin: 0,
              }}
            >
              {JSON.stringify(entry.details, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function AdminAuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [adminFilter, setAdminFilter] = useState("");
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const adminInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable<unknown, { ok?: boolean; items?: AuditEntry[] }>(
        functions,
        "adminGetAuditLog"
      );
      const res = await fn({
        limit: 100,
        category: categoryFilter || undefined,
        adminUid: adminFilter.trim() || undefined,
      });
      setEntries(res.data.items ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load audit log.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter]);

  return (
    <div style={{ display: "grid", gap: 18, maxWidth: 1100 }}>
      {selected && (
        <DetailsModal entry={selected} onClose={() => setSelected(null)} />
      )}

      {/* Filter bar */}
      <div
        style={{
          background: "#F4F7FB",
          border: "1px solid #DCE4EE",
          borderRadius: 14,
          padding: "16px 20px",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "flex-end",
        }}
      >
        <div style={{ flex: "1 1 200px" }}>
          <label>Category</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: "1 1 240px" }}>
          <label>Admin UID (optional filter)</label>
          <input
            ref={adminInputRef}
            placeholder="Paste admin UID to filter…"
            value={adminFilter}
            onChange={(e) => setAdminFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void load()}
          />
        </div>

        <button
          className="btn-primary"
          onClick={() => void load()}
          disabled={loading}
          style={{ whiteSpace: "nowrap", flexShrink: 0 }}
        >
          {loading ? "⏳ Loading…" : "🔄 Refresh"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(220,38,38,0.1)",
            border: "1px solid rgba(220,38,38,0.3)",
            color: "#C8283B",
            fontSize: "0.875rem",
          }}
        >
          ⚠ {error}
        </div>
      )}

      {/* Stats row */}
      {!loading && entries.length > 0 && (
        <div style={{ fontSize: "0.8rem", color: "#5F7491" }}>
          Showing {entries.length} most recent entries
          {categoryFilter ? ` in category "${categoryFilter}"` : ""}
          {adminFilter ? ` by admin "${adminFilter}"` : ""}
        </div>
      )}

      {/* Log table */}
      <div
        style={{
          background: "#F4F7FB",
          border: "1px solid #DCE4EE",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#5F7491" }}>
            ⏳ Loading audit log…
          </div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#5F7491" }}>
            No log entries found{categoryFilter ? ` for "${categoryFilter}"` : ""}.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Admin</th>
                <th>Category</th>
                <th>Action</th>
                <th>Summary</th>
                <th>Target</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const cat = catMeta(entry.category);
                return (
                  <tr key={entry.id}>
                    <td style={{ whiteSpace: "nowrap", fontSize: "0.78rem", color: "#5F7491" }}>
                      {fmt(entry.timestampMs)}
                    </td>
                    <td style={{ fontSize: "0.78rem" }}>
                      <div style={{ color: "#0D1F33" }}>
                        {entry.adminEmail ?? entry.adminName ?? "—"}
                      </div>
                      {entry.adminUid && (
                        <div
                          style={{
                            fontSize: "0.68rem",
                            color: "#5F7491",
                            fontFamily: "monospace",
                            maxWidth: 140,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {entry.adminUid}
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "3px 8px",
                          borderRadius: 6,
                          background: `${cat.color}18`,
                          border: `1px solid ${cat.color}40`,
                          color: cat.color,
                          fontSize: "0.73rem",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {cat.icon} {cat.label}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.78rem", color: "#3C516C", fontFamily: "monospace" }}>
                      {entry.action}
                    </td>
                    <td style={{ fontSize: "0.8rem", color: "#26394F", maxWidth: 300 }}>
                      {entry.summary}
                    </td>
                    <td style={{ fontSize: "0.75rem", color: "#5F7491", maxWidth: 120 }}>
                      {entry.targetName ?? entry.targetId ?? "—"}
                    </td>
                    <td>
                      <button
                        style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                        onClick={() => setSelected(entry)}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
