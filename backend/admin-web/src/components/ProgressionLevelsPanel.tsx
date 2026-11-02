import { useState, useEffect, useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProgressionLevel {
  id: string;
  levelNumber: number;
  name: string;
  minXP: number;
  badgeKey: string;
  description: string;
  active: boolean;
}

// ─── XP earning reference shown in the panel ──────────────────────────────────

const XP_SOURCES = [
  { action: "Capture another player (step on your trap)",  xp: "+50 XP" },
  { action: "Disarm an opponent's trap",                   xp: "+20 XP" },
  { action: "Place a trap successfully",                   xp: "+10 XP" },
  { action: "Daily first-login bonus",                     xp: "+10 XP" },
  { action: "Being caught by a trap (participation)",      xp:  "+5 XP" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function xpLabel(xp: number): string {
  if (xp === 0) return "0 XP (starting rank)";
  if (xp >= 1_000) return `${(xp / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k XP`;
  return `${xp.toLocaleString()} XP`;
}

// Rough estimate of days to reach a level for an active player (~200 XP/day)
function daysEstimate(minXP: number): string {
  if (minXP === 0) return "Day 1";
  const d = Math.round(minXP / 200);
  if (d < 7)  return `~${d} day${d === 1 ? "" : "s"}`;
  if (d < 30) return `~${Math.round(d / 7)} week${Math.round(d / 7) === 1 ? "" : "s"}`;
  if (d < 365) return `~${Math.round(d / 30)} month${Math.round(d / 30) === 1 ? "" : "s"}`;
  return `~${(d / 365).toFixed(1)} years`;
}

const RANK_BADGE: Record<number, string> = {
  1: "🪖", 2: "🪖", 3: "⭐", 4: "⭐⭐",
  5: "🎖️", 6: "🎖️", 7: "🏅", 8: "🏅",
  9: "🎗️", 10: "🎗️", 11: "🏆", 12: "👑",
};

// ─── Empty form state ─────────────────────────────────────────────────────────

const EMPTY_FORM: Omit<ProgressionLevel, "id"> = {
  levelNumber: 1,
  name: "",
  minXP: 0,
  badgeKey: "",
  description: "",
  active: true,
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProgressionLevelsPanel() {
  const [levels, setLevels]       = useState<ProgressionLevel[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [seeding, setSeeding]     = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState<string | null>(null);

  // Modal state
  const [modal, setModal] = useState<{
    mode: "create" | "edit";
    form: Omit<ProgressionLevel, "id"> & { id?: string };
  } | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fn  = httpsCallable(functions, "adminListProgressionLevels");
      const res = (await fn({})) as { data: { ok: boolean; items: ProgressionLevel[] } };
      setLevels(res.data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load levels");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── Seed ──────────────────────────────────────────────────────────────────
  async function handleSeed() {
    if (!confirm("Seed all 12 default military ranks? Existing levels will be merged (not deleted).")) return;
    setSeeding(true);
    setSeedResult(null);
    try {
      const fn  = httpsCallable(functions, "seedDefaultProgressionLevels");
      const res = (await fn({})) as { data: { ok: boolean; levels: { level: number; name: string; minXP: number }[] } };
      const names = res.data.levels.map((l) => `Lv.${l.level} ${l.name}`).join(", ");
      setSeedResult(`✅ Seeded: ${names}`);
      await load();
    } catch (e) {
      setSeedResult(`❌ ${e instanceof Error ? e.message : "Seed failed"}`);
    } finally {
      setSeeding(false);
    }
  }

  // ── Save (create / update) ────────────────────────────────────────────────
  async function handleSave() {
    if (!modal) return;
    setSaving(true);
    try {
      if (modal.mode === "create") {
        const fn = httpsCallable(functions, "adminCreateProgressionLevel");
        await fn(modal.form);
      } else {
        const fn = httpsCallable(functions, "adminUpdateProgressionLevel");
        await fn(modal.form);   // modal.form already contains `id` from the level doc
      }
      setModal(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      const fn = httpsCallable(functions, "adminDeleteProgressionLevel");
      await fn({ id });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: "#F4F7FB",
    border: "1px solid #DCE4EE",
    borderRadius: 10,
    padding: "20px 24px",
    marginBottom: 20,
  };

  const th: React.CSSProperties = {
    padding: "8px 12px",
    textAlign: "left",
    color: "#3C516C",
    fontWeight: 600,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    borderBottom: "1px solid #DCE4EE",
  };

  const td: React.CSSProperties = {
    padding: "10px 12px",
    borderBottom: "1px solid #F4F7FB",
    verticalAlign: "middle",
  };

  const btn = (variant: "primary" | "danger" | "ghost" | "seed"): React.CSSProperties => ({
    padding: "6px 14px",
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    background:
      variant === "primary" ? "#0B6C86"
      : variant === "danger"  ? "#F5C2C9"
      : variant === "seed"    ? "#BFE8D2"
      : "transparent",
    color:
      variant === "ghost" ? "#5F7491" : "#0D1F33",
    borderColor: variant === "ghost" ? "#DCE4EE" : "transparent",
    outline: variant === "ghost" ? "1px solid #DCE4EE" : "none",
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 16px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, color: "#0D1F33", fontSize: 22 }}>🪖 Player Levels</h2>
          <p style={{ margin: "4px 0 0", color: "#3C516C", fontSize: 14 }}>
            XP-based progression ranks — separate from payment membership tiers.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            style={btn("seed")}
            onClick={() => void handleSeed()}
            disabled={seeding}
          >
            {seeding ? "Seeding…" : "🌱 Seed Default Ranks"}
          </button>
          <button
            style={btn("primary")}
            onClick={() => setModal({ mode: "create", form: { ...EMPTY_FORM } })}
          >
            + Add Level
          </button>
        </div>
      </div>

      {seedResult && (
        <div style={{ ...card, background: "#E3F7EC", borderColor: "#178A55", marginBottom: 16, fontSize: 13 }}>
          {seedResult}
        </div>
      )}

      {/* XP Earnings Reference */}
      <div style={card}>
        <p style={{ margin: "0 0 12px", color: "#0B6C86", fontWeight: 700, fontSize: 13 }}>
          💡 XP Earnings Reference
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px" }}>
          {XP_SOURCES.map((s) => (
            <div key={s.action} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <span style={{
                background: "#DCE4EE",
                color: "#0B6C86",
                padding: "2px 8px",
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 12,
                whiteSpace: "nowrap",
              }}>{s.xp}</span>
              <span style={{ color: "#3C516C" }}>{s.action}</span>
            </div>
          ))}
        </div>
        <p style={{ margin: "10px 0 0", color: "#5F7491", fontSize: 12 }}>
          Active player ≈ 150–250 XP/day · Casual player ≈ 20–50 XP/day
        </p>
      </div>

      {/* Levels Table */}
      {loading ? (
        <p style={{ color: "#3C516C" }}>Loading…</p>
      ) : error ? (
        <div style={{ ...card, borderColor: "#F5C2C9", color: "#C8283B" }}>⚠ {error}</div>
      ) : levels.length === 0 ? (
        <div style={card}>
          <p style={{ color: "#3C516C", margin: 0 }}>
            No levels found. Click <strong>Seed Default Ranks</strong> to populate the 12 military-inspired ranks.
          </p>
        </div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={th}>Rank</th>
                <th style={th}>Min XP</th>
                <th style={th}>Est. time (active)</th>
                <th style={th}>Description</th>
                <th style={th}>Active</th>
                <th style={{ ...th, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((lvl) => (
                <tr key={lvl.id} style={{ background: lvl.active ? "transparent" : "#F4F7FB" }}>
                  <td style={{ ...td, width: 40 }}>
                    <span style={{
                      display: "inline-block",
                      width: 28, height: 28,
                      borderRadius: "50%",
                      background: "#DCE4EE",
                      color: "#0B6C86",
                      textAlign: "center",
                      lineHeight: "28px",
                      fontSize: 12,
                      fontWeight: 700,
                    }}>{lvl.levelNumber}</span>
                  </td>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 18 }}>{RANK_BADGE[lvl.levelNumber] ?? "⭐"}</span>
                      <div>
                        <div style={{ color: "#0D1F33", fontWeight: 600, fontSize: 14 }}>{lvl.name}</div>
                        <div style={{ color: "#5F7491", fontSize: 11 }}>{lvl.badgeKey}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ ...td, color: "#8A5A0B", fontWeight: 700, fontSize: 13 }}>
                    {xpLabel(lvl.minXP)}
                  </td>
                  <td style={{ ...td, color: "#3C516C", fontSize: 13 }}>
                    {daysEstimate(lvl.minXP)}
                  </td>
                  <td style={{ ...td, color: "#3C516C", fontSize: 13, maxWidth: 220 }}>
                    {lvl.description || <span style={{ color: "#5F7491" }}>—</span>}
                  </td>
                  <td style={td}>
                    <span style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      background: lvl.active ? "#E3F7EC" : "#FFF6E8",
                      color:      lvl.active ? "#178A55" : "#5F7491",
                    }}>
                      {lvl.active ? "Active" : "Hidden"}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button
                        style={btn("ghost")}
                        onClick={() => setModal({
                          mode: "edit",
                          form: { ...lvl },
                        })}
                      >
                        Edit
                      </button>
                      <button
                        style={btn("danger")}
                        disabled={deleting === lvl.id}
                        onClick={() => void handleDelete(lvl.id, lvl.name)}
                      >
                        {deleting === lvl.id ? "…" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(11,22,38,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{
            background: "#F4F7FB",
            border: "1px solid #DCE4EE",
            borderRadius: 12,
            padding: 28,
            width: "100%",
            maxWidth: 480,
          }}>
            <h3 style={{ margin: "0 0 20px", color: "#0D1F33" }}>
              {modal.mode === "create" ? "➕ Add Progression Level" : `✏️ Edit — ${modal.form.name}`}
            </h3>

            {(
              [
                { label: "Level Number", key: "levelNumber" as const, type: "number" as const, disabled: modal.mode === "edit" },
                { label: "Rank Name",    key: "name"        as const, type: "text"   as const, disabled: false },
                { label: "Min XP",       key: "minXP"       as const, type: "number" as const, disabled: false },
                { label: "Badge Key",    key: "badgeKey"    as const, type: "text"   as const, disabled: false },
                { label: "Description",  key: "description" as const, type: "text"   as const, disabled: false },
              ]
            ).map(({ label, key, type, disabled }) => (
              <div key={key} style={{ marginBottom: 14 }}>
                <label style={{ display: "block", color: "#3C516C", fontSize: 12, marginBottom: 4 }}>
                  {label}
                </label>
                <input
                  type={type}
                  disabled={disabled}
                  value={modal.form[key] as string | number}
                  onChange={(e) => setModal((prev) => prev ? ({
                    ...prev,
                    form: {
                      ...prev.form,
                      [key]: type === "number" ? Number(e.target.value) : e.target.value,
                    },
                  }) : null)}
                  style={{
                    width: "100%",
                    background: disabled ? "#F4F7FB" : "#F4F7FB",
                    border: "1px solid #DCE4EE",
                    borderRadius: 6,
                    color: disabled ? "#5F7491" : "#0D1F33",
                    padding: "8px 10px",
                    fontSize: 14,
                    boxSizing: "border-box",
                    cursor: disabled ? "not-allowed" : "text",
                  }}
                />
              </div>
            ))}

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "#3C516C", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={modal.form.active}
                  onChange={(e) => setModal((prev) => prev ? ({
                    ...prev,
                    form: { ...prev.form, active: e.target.checked },
                  }) : null)}
                />
                Active (visible in-app)
              </label>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={btn("ghost")} onClick={() => setModal(null)}>Cancel</button>
              <button style={btn("primary")} onClick={() => void handleSave()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
