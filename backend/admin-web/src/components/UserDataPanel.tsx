import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GameData {
  uid: string;
  displayName: string | null;
  username: string | null;
  xp: number;
  level: number;
  levelName: string;
  captureCount: number;
  timesCaught: number;
  trapsAvailable: number;
  trapsUsed: number;
  dateKey: string;
  totalTraps: number;
  trapsByStatus: Record<string, number>;
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function StatBox({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string | number;
  color?: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        background: "#F4F7FB",
        border: "1px solid #DCE4EE",
        borderRadius: 10,
        padding: "14px 16px",
        minWidth: 110,
      }}
    >
      <div
        style={{
          fontSize: "1.6rem",
          fontWeight: 900,
          color: color ?? "#0D1F33",
          lineHeight: 1,
          letterSpacing: "-0.5px",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: "0.75rem", color: "#5F7491", marginTop: 5 }}>{label}</div>
      {sub && <div style={{ fontSize: "0.7rem", color: "#DCE4EE", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const TRAP_STATUS_COLOR: Record<string, string> = {
  active:   "#178A55",
  captured: "#C2410C",
  disarmed: "#3C516C",
  expired:  "#5F7491",
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function UserDataPanel() {
  const [queryInput, setQueryInput] = useState("");
  const [gameData, setGameData]   = useState<GameData | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [working, setWorking]     = useState(false);

  // ── Lookup ──────────────────────────────────────────────────────────────────
  async function handleLookup() {
    const query = queryInput.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    setGameData(null);
    setActionMsg(null);
    try {
      const fn  = httpsCallable(functions, "adminGetUserGameData");
      const res = (await fn({ query })) as { data: GameData & { ok: boolean } };
      setGameData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }

  // ── Delete traps ────────────────────────────────────────────────────────────
  async function handleDeleteTraps(activeOnly: boolean) {
    if (!gameData) return;

    const label = activeOnly ? "active traps" : "ALL traps (all statuses)";
    const count = activeOnly
      ? (gameData.trapsByStatus["active"] ?? 0)
      : gameData.totalTraps;

    if (count === 0) {
      setActionMsg(`ℹ️ No ${label} to delete.`);
      return;
    }

    if (
      !confirm(
        `Delete ${count} ${label} for "${gameData.displayName ?? gameData.uid}"?\n\nThis cannot be undone.`
      )
    )
      return;

    setWorking(true);
    setActionMsg(null);
    try {
      const fn  = httpsCallable(functions, "adminDeleteUserTraps");
      const res = (await fn({ query: gameData.uid, activeOnly })) as {
        data: { ok: boolean; deleted: number };
      };
      setActionMsg(`✅ Deleted ${res.data.deleted} trap(s).`);
      // Refresh stats
      await handleLookupSilent(gameData.uid);
    } catch (e) {
      setActionMsg(`❌ ${e instanceof Error ? e.message : "Delete failed"}`);
    } finally {
      setWorking(false);
    }
  }

  // ── Reset scores ────────────────────────────────────────────────────────────
  async function handleResetScores() {
    if (!gameData) return;

    if (
      !confirm(
        `Reset ALL scores for "${gameData.displayName ?? gameData.uid}"?\n\n` +
          `This will zero out XP (${gameData.xp}), captures (${gameData.captureCount}), ` +
          `times caught (${gameData.timesCaught}), and reset level to Lv. 1.\n\n` +
          `This cannot be undone.`
      )
    )
      return;

    setWorking(true);
    setActionMsg(null);
    try {
      const fn = httpsCallable(functions, "adminResetUserScores");
      await fn({ query: gameData.uid });
      setActionMsg("✅ Scores reset to zero.");
      await handleLookupSilent(gameData.uid);
    } catch (e) {
      setActionMsg(`❌ ${e instanceof Error ? e.message : "Reset failed"}`);
    } finally {
      setWorking(false);
    }
  }

  // ── Reset daily quota ───────────────────────────────────────────────────────
  async function handleResetDailyQuota() {
    if (!gameData) return;
    if (
      !confirm(
        `Reset today's placement quota for "${gameData.displayName ?? gameData.uid}"?\n\n` +
          `This will restore their daily traps available to 5 (currently ${gameData.trapsAvailable}) ` +
          `and also refill their trap bag.`
      )
    )
      return;

    setWorking(true);
    setActionMsg(null);
    try {
      const fn = httpsCallable(functions, "adminResetUserTrapAvailability");
      await fn({ uid: gameData.uid });
      setActionMsg("✅ Daily quota and trap bag reset.");
      await handleLookupSilent(gameData.uid);
    } catch (e) {
      setActionMsg(`❌ ${e instanceof Error ? e.message : "Reset failed"}`);
    } finally {
      setWorking(false);
    }
  }

  // Silent refresh (uses the resolved UID so it's always exact)
  async function handleLookupSilent(uid: string) {
    try {
      const fn  = httpsCallable(functions, "adminGetUserGameData");
      const res = (await fn({ query: uid })) as { data: GameData & { ok: boolean } };
      setGameData(res.data);
    } catch {
      /* ignore refresh errors */
    }
  }

  const card: React.CSSProperties = {
    background: "#F4F7FB",
    border: "1px solid #DCE4EE",
    borderRadius: 12,
    padding: "20px 24px",
    marginBottom: 20,
  };

  const dangerBtn = (disabled: boolean): React.CSSProperties => ({
    padding: "9px 18px",
    borderRadius: 8,
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 700,
    fontSize: 13,
    opacity: disabled ? 0.45 : 1,
    transition: "background 0.15s",
  });

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 16px" }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, color: "#0D1F33", fontSize: 22 }}>🗑️ User Data Management</h2>
        <p style={{ margin: "4px 0 0", color: "#3C516C", fontSize: 14 }}>
          Look up a user by their UID to view and delete their placed traps or reset their scores.
        </p>
      </div>

      {/* Lookup form */}
      <div style={card}>
        <div style={{ fontWeight: 700, color: "#0D1F33", marginBottom: 12 }}>
          🔍 Find User
        </div>

        {/* Input type hints */}
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          {[
            { label: "UID",      example: "abc123XYZ…",        icon: "🔑" },
            { label: "Username", example: "@trapmaster",        icon: "👤" },
            { label: "Email",    example: "user@example.com",   icon: "✉️" },
          ].map(({ label, example, icon }) => (
            <div
              key={label}
              style={{
                background: "#F4F7FB",
                border: "1px solid #DCE4EE",
                borderRadius: 7,
                padding: "5px 10px",
                fontSize: 12,
                color: "#5F7491",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span>{icon}</span>
              <strong style={{ color: "#3C516C" }}>{label}</strong>
              <span style={{ color: "#5F7491" }}>{example}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            style={{ flex: 1, minWidth: 260 }}
            placeholder="UID, @username, or email address…"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleLookup(); }}
          />
          <button
            onClick={() => void handleLookup()}
            disabled={loading || !queryInput.trim()}
            style={{
              background: "#0B6C86",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "9px 20px",
              fontWeight: 700,
              fontSize: 13,
              cursor: loading || !queryInput.trim() ? "not-allowed" : "pointer",
              opacity: loading || !queryInput.trim() ? 0.5 : 1,
            }}
          >
            {loading ? "Looking up…" : "Look Up"}
          </button>
        </div>
        {error && (
          <div style={{ marginTop: 10, color: "#C8283B", fontSize: 13 }}>⚠ {error}</div>
        )}
      </div>

      {/* User stats */}
      {gameData && (
        <>
          {/* Identity */}
          <div style={card}>
            <div style={{ fontWeight: 700, color: "#0B6C86", marginBottom: 4, fontSize: 13 }}>
              User
            </div>
            <div style={{ color: "#0D1F33", fontWeight: 700, fontSize: 18 }}>
              {gameData.displayName ?? "—"}
              {gameData.username ? (
                <span style={{ color: "#5F7491", fontWeight: 400, fontSize: 13, marginLeft: 8 }}>
                  @{gameData.username}
                </span>
              ) : null}
            </div>
            <div style={{ color: "#5F7491", fontSize: 12, marginTop: 3, fontFamily: "monospace" }}>
              {gameData.uid}
            </div>
          </div>

          {/* Score stats */}
          <div style={{ ...card }}>
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
              <div style={{ fontWeight: 700, color: "#0D1F33", fontSize: 15 }}>
                🏅 Scores & XP
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <StatBox
                label="XP"
                value={gameData.xp.toLocaleString()}
                color="#8A5A0B"
              />
              <StatBox
                label="Level"
                value={`Lv. ${gameData.level}`}
                color="#0B6C86"
                sub={gameData.levelName || undefined}
              />
              <StatBox
                label="Captures"
                value={gameData.captureCount}
                color="#178A55"
              />
              <StatBox
                label="Times Caught"
                value={gameData.timesCaught}
                color="#C2410C"
              />
            </div>

            {/* Today's placement quota */}
            <div
              style={{
                background: "#F4F7FB",
                border: "1px solid #DCE4EE",
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: "#5F7491", marginBottom: 4 }}>
                  📅 Today's Placement Quota ({gameData.dateKey})
                </div>
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <span>
                    <span
                      style={{
                        fontSize: "1.4rem",
                        fontWeight: 800,
                        color: gameData.trapsAvailable <= 0 ? "#C8283B" : "#178A55",
                      }}
                    >
                      {gameData.trapsAvailable}
                    </span>
                    <span style={{ fontSize: 12, color: "#5F7491", marginLeft: 4 }}>available</span>
                  </span>
                  <span style={{ color: "#DCE4EE" }}>·</span>
                  <span>
                    <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "#3C516C" }}>
                      {gameData.trapsUsed}
                    </span>
                    <span style={{ fontSize: 12, color: "#5F7491", marginLeft: 4 }}>used today</span>
                  </span>
                  {gameData.trapsAvailable <= 0 && gameData.trapsUsed === 0 && (
                    <span
                      style={{
                        background: "rgba(239,68,68,0.15)",
                        border: "1px solid rgba(239,68,68,0.3)",
                        borderRadius: 6,
                        padding: "2px 8px",
                        fontSize: 11,
                        color: "#C8283B",
                        fontWeight: 600,
                      }}
                    >
                      ⚠ Penalty
                    </span>
                  )}
                </div>
              </div>
              <button
                style={{
                  ...dangerBtn(working || gameData.trapsAvailable >= 5),
                  background: gameData.trapsAvailable >= 5 ? "#DCE4EE" : "#F3D9A8",
                  color: gameData.trapsAvailable >= 5 ? "#5F7491" : "#8A5A0B",
                  fontSize: 12,
                  padding: "7px 14px",
                }}
                disabled={working || gameData.trapsAvailable >= 5}
                onClick={() => void handleResetDailyQuota()}
                title={gameData.trapsAvailable >= 5 ? "Quota is already full" : "Reset daily quota to 5"}
              >
                🔄 Reset Quota
              </button>
            </div>

            {/* Danger: Reset scores */}
            <div
              style={{
                background: "rgba(127,29,29,0.12)",
                border: "1px solid rgba(127,29,29,0.4)",
                borderRadius: 10,
                padding: "14px 16px",
              }}
            >
              <div style={{ color: "#C8283B", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                ⚠ Danger Zone — Reset Scores
              </div>
              <p style={{ color: "#3C516C", fontSize: 13, margin: "0 0 12px" }}>
                Zeros out XP, capture count, times-caught, and resets progression level to Lv. 1.
                Capture history records are kept.
              </p>
              <button
                style={{
                  ...dangerBtn(working),
                  background: "#F5C2C9",
                  color: "#C8283B",
                }}
                disabled={working}
                onClick={() => void handleResetScores()}
              >
                {working ? "Working…" : "🔄 Reset All Scores"}
              </button>
            </div>
          </div>

          {/* Trap stats */}
          <div style={card}>
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
              <div style={{ fontWeight: 700, color: "#0D1F33", fontSize: 15 }}>
                🪤 Placed Traps
              </div>
              <div style={{ color: "#5F7491", fontSize: 13 }}>
                {gameData.totalTraps} total
              </div>
            </div>

            {/* Status breakdown */}
            {gameData.totalTraps === 0 ? (
              <p style={{ color: "#5F7491", fontSize: 13, margin: 0 }}>
                This user has no placed traps.
              </p>
            ) : (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
                {Object.entries(gameData.trapsByStatus).map(([status, count]) => (
                  <div
                    key={status}
                    style={{
                      background: "#F4F7FB",
                      border: "1px solid #DCE4EE",
                      borderRadius: 8,
                      padding: "10px 14px",
                      minWidth: 90,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "1.4rem",
                        fontWeight: 800,
                        color: TRAP_STATUS_COLOR[status] ?? "#3C516C",
                        lineHeight: 1,
                      }}
                    >
                      {count}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "#5F7491", marginTop: 4, textTransform: "capitalize" }}>
                      {status}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Danger: Delete traps */}
            <div
              style={{
                background: "rgba(127,29,29,0.12)",
                border: "1px solid rgba(127,29,29,0.4)",
                borderRadius: 10,
                padding: "14px 16px",
              }}
            >
              <div style={{ color: "#C8283B", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                ⚠ Danger Zone — Delete Traps
              </div>
              <p style={{ color: "#3C516C", fontSize: 13, margin: "0 0 14px" }}>
                Permanently removes trap documents. This cannot be undone.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  style={{
                    ...dangerBtn(working || (gameData.trapsByStatus["active"] ?? 0) === 0),
                    background: "#F3D9A8",
                    color: "#8A5A0B",
                  }}
                  disabled={working || (gameData.trapsByStatus["active"] ?? 0) === 0}
                  onClick={() => void handleDeleteTraps(true)}
                >
                  🗑️ Delete Active Traps ({gameData.trapsByStatus["active"] ?? 0})
                </button>
                <button
                  style={{
                    ...dangerBtn(working || gameData.totalTraps === 0),
                    background: "#F5C2C9",
                    color: "#C8283B",
                  }}
                  disabled={working || gameData.totalTraps === 0}
                  onClick={() => void handleDeleteTraps(false)}
                >
                  🗑️ Delete ALL Traps ({gameData.totalTraps})
                </button>
              </div>
            </div>
          </div>

          {/* Action result */}
          {actionMsg && (
            <div
              style={{
                ...card,
                borderColor: actionMsg.startsWith("✅") ? "#178A55" : actionMsg.startsWith("ℹ") ? "#DCE4EE" : "#F5C2C9",
                background:  actionMsg.startsWith("✅") ? "#E3F7EC" : actionMsg.startsWith("ℹ") ? "#F4F7FB" : "#FDE7EA",
                color: "#0D1F33",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {actionMsg}
            </div>
          )}
        </>
      )}
    </div>
  );
}
