import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecalcStats {
  xp: number;
  captureCount: number;
  timesCaught: number;
  trapsPlaced: number;
  disarmedTraps: number;
  capturedTraps: number;
  activeTraps: number;
  level: number;
  levelName: string;
}

interface SingleResult {
  ok: boolean;
  recalculated: number;
  uid: string;
  displayName: string;
  before: Partial<RecalcStats>;
  after: RecalcStats;
}

interface BulkResult {
  ok: boolean;
  recalculated: number;
}

// ─── Stat diff row ────────────────────────────────────────────────────────────

function DiffRow({
  label,
  before,
  after,
  highlight,
}: {
  label: string;
  before: number | string | undefined;
  after: number | string | undefined;
  highlight?: boolean;
}) {
  const changed = String(before) !== String(after);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 8,
        padding: "8px 12px",
        background: highlight
          ? "rgba(11,108,134,0.07)"
          : changed
          ? "rgba(52,211,153,0.06)"
          : "transparent",
        borderRadius: 7,
        borderLeft: changed ? "2px solid #178A55" : "2px solid transparent",
        fontSize: "0.85rem",
      }}
    >
      <span style={{ color: "#3C516C" }}>{label}</span>
      <span style={{ color: changed ? "#C8283B" : "#5F7491", textDecoration: changed ? "line-through" : "none" }}>
        {before ?? "—"}
      </span>
      <span style={{ color: changed ? "#178A55" : "#5F7491", fontWeight: changed ? 700 : 400 }}>
        {after ?? "—"}
      </span>
    </div>
  );
}

function StatCard({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div
      style={{
        background: "#F4F7FB",
        border: "1px solid #DCE4EE",
        borderRadius: 10,
        padding: "12px 16px",
        minWidth: 100,
      }}
    >
      <div style={{ fontSize: "1.55rem", fontWeight: 900, color: color ?? "#0D1F33", lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: "0.73rem", color: "#5F7491", marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: "0.68rem", color: "#DCE4EE", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function RecalculatePointsPanel() {
  const [mode, setMode] = useState<"single" | "bulk">("single");

  // Single-user state
  const [query, setQuery]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [result, setResult]     = useState<SingleResult | null>(null);

  // Bulk state
  const [bulkConfirm, setBulkConfirm]   = useState(false);
  const [bulkLoading, setBulkLoading]   = useState(false);
  const [bulkError, setBulkError]       = useState("");
  const [bulkResult, setBulkResult]     = useState<BulkResult | null>(null);

  // ── Single user ────────────────────────────────────────────────────────────

  async function handleSingleRecalc() {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const fn = httpsCallable<{ uid: string }, SingleResult>(
        functions,
        "adminRecalculateUserPoints"
      );
      const res = await fn({ uid: query.trim() });
      setResult(res.data);
    } catch (e: any) {
      setError(e?.message ?? "Recalculation failed.");
    } finally {
      setLoading(false);
    }
  }

  // ── Bulk ───────────────────────────────────────────────────────────────────

  async function handleBulkRecalc() {
    setBulkLoading(true);
    setBulkError("");
    setBulkResult(null);
    try {
      const fn = httpsCallable<Record<string, never>, BulkResult>(
        functions,
        "adminRecalculateUserPoints"
      );
      const res = await fn({});
      setBulkResult(res.data);
      setBulkConfirm(false);
    } catch (e: any) {
      setBulkError(e?.message ?? "Bulk recalculation failed.");
    } finally {
      setBulkLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 22px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "0.875rem",
    background: active ? "#0B6C86" : "transparent",
    color: active ? "#fff" : "#5F7491",
    transition: "background 0.15s, color 0.15s",
  });

  return (
    <div style={{ display: "grid", gap: 22, maxWidth: 780 }}>

      {/* Header */}
      <div
        style={{
          background: "#F4F7FB",
          border: "1px solid #DCE4EE",
          borderRadius: 14,
          padding: "20px 24px",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "#0D1F33", marginBottom: 6 }}>
          🔄 Recalculate User Points
        </div>
        <div style={{ fontSize: "0.83rem", color: "#5F7491", lineHeight: 1.6 }}>
          Rebuilds each user's <strong style={{ color: "#3C516C" }}>XP</strong>,{" "}
          <strong style={{ color: "#3C516C" }}>captureCount</strong>,{" "}
          <strong style={{ color: "#3C516C" }}>timesCaught</strong> and{" "}
          <strong style={{ color: "#3C516C" }}>level</strong> from raw capture and trap history.
          Use this to fix scores after data corrections or rule changes.
        </div>

        {/* Mode tabs */}
        <div
          style={{
            display: "flex",
            gap: 4,
            marginTop: 16,
            background: "#F4F7FB",
            border: "1px solid #DCE4EE",
            borderRadius: 10,
            padding: 4,
            width: "fit-content",
          }}
        >
          <button style={tabStyle(mode === "single")} onClick={() => setMode("single")}>
            👤 Single User
          </button>
          <button style={tabStyle(mode === "bulk")} onClick={() => setMode("bulk")}>
            👥 All Users
          </button>
        </div>
      </div>

      {/* ── Single user panel ── */}
      {mode === "single" && (
        <div
          style={{
            background: "#F4F7FB",
            border: "1px solid #DCE4EE",
            borderRadius: 14,
            padding: "20px 24px",
            display: "grid",
            gap: 18,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#0D1F33" }}>
            Recalculate for a Specific User
          </div>

          {/* Input row */}
          <div style={{ display: "flex", gap: 10 }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSingleRecalc(); }}
              placeholder="UID, @username, or email"
              style={{
                flex: 1,
                background: "#F4F7FB",
                border: "1px solid #DCE4EE",
                borderRadius: 8,
                padding: "10px 14px",
                color: "#0D1F33",
                fontSize: "0.9rem",
                outline: "none",
              }}
            />
            <button
              onClick={() => void handleSingleRecalc()}
              disabled={loading || !query.trim()}
              style={{
                padding: "10px 22px",
                background: loading || !query.trim() ? "#DCE4EE" : "#0B6C86",
                border: "none",
                borderRadius: 8,
                color: "#fff",
                fontWeight: 600,
                fontSize: "0.875rem",
                cursor: loading || !query.trim() ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {loading ? "⏳ Calculating…" : "🔄 Recalculate"}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 8,
                padding: "10px 14px",
                color: "#C8283B",
                fontSize: "0.875rem",
              }}
            >
              ⚠ {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <div style={{ display: "grid", gap: 14 }}>
              {/* User header */}
              <div
                style={{
                  background: "rgba(52,211,153,0.08)",
                  border: "1px solid rgba(52,211,153,0.25)",
                  borderRadius: 10,
                  padding: "12px 16px",
                }}
              >
                <div style={{ fontWeight: 700, color: "#178A55", fontSize: "0.9rem" }}>
                  ✅ Recalculation complete
                </div>
                <div style={{ color: "#5F7491", fontSize: "0.8rem", marginTop: 3 }}>
                  {result.displayName} · {result.uid}
                </div>
              </div>

              {/* After stats grid */}
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                }}
              >
                <StatCard label="XP"             value={result.after.xp}           color="#6D3FC9" />
                <StatCard label="Level"          value={`${result.after.level} — ${result.after.levelName}`} color="#8A5A0B" />
                <StatCard label="Captures Made"  value={result.after.captureCount}  color="#178A55" />
                <StatCard label="Times Caught"   value={result.after.timesCaught}   color="#C8283B" />
                <StatCard label="Traps Placed"   value={result.after.trapsPlaced}   color="#0B6C86" />
                <StatCard label="Traps Disarmed" value={result.after.disarmedTraps} color="#3C516C" />
              </div>

              {/* Before / After diff */}
              <div
                style={{
                  background: "#F4F7FB",
                  border: "1px solid #DCE4EE",
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 8,
                    padding: "8px 12px",
                    background: "#F4F7FB",
                    borderBottom: "1px solid #DCE4EE",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    color: "#5F7491",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }}
                >
                  <span>Field</span>
                  <span>Before</span>
                  <span>After</span>
                </div>
                <div style={{ padding: "6px 0" }}>
                  <DiffRow label="XP"           before={result.before.xp}           after={result.after.xp}           highlight />
                  <DiffRow label="Level"        before={result.before.level}        after={result.after.level} />
                  <DiffRow label="Level Name"   before={result.before.levelName}    after={result.after.levelName} />
                  <DiffRow label="Captures"     before={result.before.captureCount} after={result.after.captureCount} />
                  <DiffRow label="Times Caught" before={result.before.timesCaught}  after={result.after.timesCaught} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── All users panel ── */}
      {mode === "bulk" && (
        <div
          style={{
            background: "#F4F7FB",
            border: "1px solid #DCE4EE",
            borderRadius: 14,
            padding: "20px 24px",
            display: "grid",
            gap: 18,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#0D1F33" }}>
            Recalculate for All Users
          </div>

          {/* Warning box */}
          <div
            style={{
              background: "rgba(251,191,36,0.08)",
              border: "1px solid rgba(251,191,36,0.3)",
              borderRadius: 10,
              padding: "14px 16px",
              display: "grid",
              gap: 6,
            }}
          >
            <div style={{ fontWeight: 700, color: "#8A5A0B", fontSize: "0.875rem" }}>
              ⚠ This operation affects every user
            </div>
            <div style={{ color: "#F3D9A8", fontSize: "0.83rem", lineHeight: 1.6 }}>
              XP, captureCount, timesCaught and level will be <strong>overwritten</strong> for
              all users by scanning the entire capture and trap history.
              The operation may take up to a minute for large datasets.
            </div>
            <ul style={{ color: "#F3D9A8", fontSize: "0.8rem", margin: "4px 0 0 16px", lineHeight: 1.7 }}>
              <li>Each scoring capture contributes its <code>scoreValue</code> to XP</li>
              <li>Self-captures and ally captures are excluded from scoring</li>
              <li>Level is resolved from the active progression level thresholds</li>
              <li>An audit log entry will be written</li>
            </ul>
          </div>

          {/* Confirm + run */}
          {!bulkResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  color: "#3C516C",
                }}
              >
                <input
                  type="checkbox"
                  checked={bulkConfirm}
                  onChange={(e) => setBulkConfirm(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "#C8283B", cursor: "pointer" }}
                />
                I understand this will overwrite scores for all users
              </label>

              <button
                disabled={!bulkConfirm || bulkLoading}
                onClick={() => void handleBulkRecalc()}
                style={{
                  padding: "11px 28px",
                  width: "fit-content",
                  background:
                    !bulkConfirm || bulkLoading
                      ? "#DCE4EE"
                      : "#C8283B",
                  border: "1px solid #C8283B",
                  borderRadius: 9,
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "0.9rem",
                  cursor: !bulkConfirm || bulkLoading ? "not-allowed" : "pointer",
                }}
              >
                {bulkLoading ? "⏳ Running — please wait…" : "🔄 Recalculate All Users"}
              </button>

              {bulkLoading && (
                <div style={{ fontSize: "0.8rem", color: "#5F7491" }}>
                  Scanning capture and trap history for all users. This may take 30–60 seconds…
                </div>
              )}
            </div>
          )}

          {/* Bulk error */}
          {bulkError && (
            <div
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 8,
                padding: "10px 14px",
                color: "#C8283B",
                fontSize: "0.875rem",
              }}
            >
              ⚠ {bulkError}
            </div>
          )}

          {/* Bulk result */}
          {bulkResult && (
            <div style={{ display: "grid", gap: 14 }}>
              <div
                style={{
                  background: "rgba(52,211,153,0.08)",
                  border: "1px solid rgba(52,211,153,0.25)",
                  borderRadius: 10,
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                <div style={{ fontSize: "2rem" }}>✅</div>
                <div>
                  <div style={{ fontWeight: 700, color: "#178A55", fontSize: "1rem" }}>
                    Recalculation complete
                  </div>
                  <div style={{ color: "#5F7491", fontSize: "0.85rem", marginTop: 3 }}>
                    <strong style={{ color: "#0D1F33" }}>{bulkResult.recalculated}</strong> users
                    updated from capture + trap history
                  </div>
                </div>
              </div>
              <button
                onClick={() => { setBulkResult(null); setBulkConfirm(false); }}
                style={{
                  padding: "9px 20px",
                  width: "fit-content",
                  background: "#DCE4EE",
                  border: "1px solid #DCE4EE",
                  borderRadius: 8,
                  color: "#0B6C86",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  cursor: "pointer",
                }}
              >
                Run Again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Info box */}
      <div
        style={{
          background: "#F4F7FB",
          border: "1px solid #DCE4EE",
          borderRadius: 12,
          padding: "14px 18px",
          fontSize: "0.8rem",
          color: "#5F7491",
          lineHeight: 1.7,
        }}
      >
        <strong style={{ color: "#5F7491" }}>Scoring formula:</strong>{" "}
        XP = Σ <code>scoreValue</code> of all enemy captures (scoring captures).
        Self-captures and ally captures are excluded.
        Old captures without an explicit capture type count as scoring by default.
      </div>
    </div>
  );
}
