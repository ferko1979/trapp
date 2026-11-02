import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";
import { functions } from "../firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

type TrapAgeGroup = "minor" | "adult";

type LocaleMap = Record<string, string>;

type TrapDefinitionItem = {
  id: string;
  name?: string | null;
  description?: string | null;
  names?: LocaleMap | null;
  descriptions?: LocaleMap | null;
  iconKey?: string | null;
  imageUrl?: string | null;

  soundOnPlacedUrl?: string | null;
  soundOnCapturedUrl?: string | null;
  soundOnBlownUrl?: string | null;
  soundOnDisarmedUrl?: string | null;

  enabled?: boolean | null;
  radiusMeters?: number | null;
  /** Max distance at which reveal/disarm is possible. Must be > radiusMeters. */
  disarmRadiusMeters?: number | null;
  /** Consecutive out-of-disarm-zone seconds allowed before session cancels. */
  disarmLeaveSeconds?: number | null;
  /** Consecutive out-of-placement-zone seconds allowed before session cancels. */
  placementLeaveSeconds?: number | null;

  placementHoldSeconds?: number | null;
  revealHoldSeconds?: number | null;
  disarmHoldSeconds?: number | null;

  effectKind?: string | null;
  effectValue?: number | null;

  ownerCanTrigger?: boolean | null;
  visibility?: "owner-only" | "public-after-reveal" | null;

  refillHours?: number | null;
  maxBagSlots?: number | null;

  allowedAgeGroups?: TrapAgeGroup[] | null;
};

type LiveTrap = {
  id: string;
  ownerUid?: string;
  trapTypeId?: string;
  status?: string;
  lat?: number;
  lng?: number;
  allowedAgeGroups?: string[];
  createdAt?: { seconds?: number } | null;
};

type TrapDefinitionsResponse = {
  ok?: boolean;
  items?: TrapDefinitionItem[];
};

type LiveTrapsResponse = {
  ok?: boolean;
  items?: LiveTrap[];
};

const EFFECT_KINDS = [
  "laughter",
  "timeout",
  "warning",
  "slowdown",
  "penalty",
] as const;

const STATUS_COLORS: Record<string, string> = {
  active:   "#178A55",
  inactive: "#5F7491",
  captured: "#8A5A0B",
  disarmed: "#0B6C86",
  blown:    "#C8283B",
  used:     "#6D3FC9",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeAllowedAgeGroups(
  value?: TrapAgeGroup[] | null
): TrapAgeGroup[] {
  const items = Array.isArray(value) ? value : [];
  const filtered = items.filter(
    (x): x is TrapAgeGroup => x === "minor" || x === "adult"
  );
  return filtered.length > 0 ? filtered : ["minor", "adult"];
}

function fmtTime(trap: LiveTrap): string {
  const secs = trap.createdAt?.seconds;
  if (!secs) return "—";
  return new Date(secs * 1000).toLocaleString();
}

function StatusBadge({ status }: { status?: string }) {
  const color = STATUS_COLORS[status ?? ""] ?? "#3C516C";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        background: color + "22",
        color,
        border: `1px solid ${color}44`,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {status ?? "unknown"}
    </span>
  );
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({
  active,
  onChange,
}: {
  active: "definitions" | "live";
  onChange: (t: "definitions" | "live") => void;
}) {
  const tab = (id: "definitions" | "live", label: string) => (
    <button
      onClick={() => onChange(id)}
      style={{
        padding: "8px 20px",
        borderRadius: 8,
        border: "none",
        cursor: "pointer",
        fontWeight: 700,
        fontSize: 13,
        background: active === id ? "#0B6C86" : "#F4F7FB",
        color:      active === id ? "#fff"     : "#5F7491",
        transition: "background 0.15s, color 0.15s",
      }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
      {tab("definitions", "🪤  Trap Definitions")}
      {tab("live",        "📡  Live Traps")}
    </div>
  );
}

// ─── Age group helpers ────────────────────────────────────────────────────────

type AgeFilter = "all" | "adult" | "minor";

function trapAgeGroup(trap: LiveTrap): "adult" | "minor" | "mixed" {
  const groups = trap.allowedAgeGroups ?? [];
  const hasAdult  = groups.includes("adult");
  const hasMinor  = groups.includes("minor");
  if (hasAdult && hasMinor) return "mixed";
  if (hasMinor) return "minor";
  return "adult"; // default / adult-only
}

// ─── Age toggle ───────────────────────────────────────────────────────────────

function AgeToggle({ value, onChange }: { value: AgeFilter; onChange: (v: AgeFilter) => void }) {
  const btn = (v: AgeFilter, label: string) => (
    <button
      onClick={() => onChange(v)}
      style={{
        padding: "6px 14px",
        borderRadius: 7,
        border: "1px solid",
        borderColor: value === v ? "#0B6C86" : "#DCE4EE",
        background:  value === v ? "#DCE4EE" : "transparent",
        color:       value === v ? "#0B6C86" : "#5F7491",
        fontWeight: 700,
        fontSize: 12,
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {btn("all",   "All Ages")}
      {btn("adult", "👤 Adults")}
      {btn("minor", "🧒 Kids")}
    </div>
  );
}

// ─── LIVE TRAPS TAB ───────────────────────────────────────────────────────────

function LiveTrapsTab() {
  const [traps, setTraps]         = useState<LiveTrap[]>([]);
  const [loading, setLoading]     = useState(false);
  const [msg, setMsg]             = useState<string | null>(null);
  const [working, setWorking]     = useState<string | null>(null);
  const [statusFilter, setFilter] = useState<string>("all");
  const [ageFilter, setAgeFilter] = useState<AgeFilter>("all");

  const isBulkWorking = working === "__delete__" || working === "__activate__" || working === "__deactivate__";

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const fn = httpsCallable<unknown, LiveTrapsResponse>(functions, "adminListTraps");
      const res = await fn({ limit: 200 });
      setTraps(res.data.items ?? []);
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : "Failed to load"}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  // ── Single-trap actions ────────────────────────────────────────────────────

  async function activate(trapId: string) {
    setWorking(trapId);
    try {
      await httpsCallable(functions, "adminActivateTrap")({ trapId });
      setTraps((prev) => prev.map((t) => t.id === trapId ? { ...t, status: "active" } : t));
      setMsg(`✅ Trap activated.`);
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : "Action failed"}`);
    } finally { setWorking(null); }
  }

  async function deactivate(trapId: string) {
    setWorking(trapId);
    try {
      await httpsCallable(functions, "adminDeactivateTrap")({ trapId });
      setTraps((prev) => prev.map((t) => t.id === trapId ? { ...t, status: "inactive" } : t));
      setMsg(`✅ Trap deactivated.`);
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : "Action failed"}`);
    } finally { setWorking(null); }
  }

  async function deleteTrap(trapId: string) {
    if (!confirm(
      `⚠️ Delete this trap?\n\nThis is IRREVERSIBLE — the trap will be permanently removed and cannot be recovered.\n\nProceed?`
    )) return;
    setWorking(trapId);
    try {
      await httpsCallable(functions, "adminDeleteTrap")({ trapId });
      setTraps((prev) => prev.filter((t) => t.id !== trapId));
      setMsg(`✅ Trap permanently deleted.`);
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : "Delete failed"}`);
    } finally { setWorking(null); }
  }

  // ── Bulk actions on the current filtered set ───────────────────────────────

  // ── Derived values ─────────────────────────────────────────────────────────

  // Apply both status and age filters to get the visible set
  const ageName = ageFilter === "adult" ? "Adults" : ageFilter === "minor" ? "Kids" : "All";

  const byAge = (t: LiveTrap) => {
    if (ageFilter === "all") return true;
    const ag = trapAgeGroup(t);
    return ageFilter === "adult" ? ag !== "minor" : ag === "minor";
  };

  const byStatus = (t: LiveTrap) =>
    statusFilter === "all" || (t.status ?? "unknown") === statusFilter;

  const visible = traps.filter((t) => byAge(t) && byStatus(t));

  // Adults / Kids sub-lists (used when ageFilter === "all" for sectioned rendering)
  const adultTraps = visible.filter((t) => trapAgeGroup(t) !== "minor");
  const kidTraps   = visible.filter((t) => trapAgeGroup(t) === "minor");

  // Status counts scoped to the age filter (for chip bar)
  const counts = traps.filter(byAge).reduce<Record<string, number>>((acc, t) => {
    const s = t.status ?? "unknown";
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  const statuses = ["all", ...Array.from(new Set(traps.filter(byAge).map((t) => t.status ?? "unknown")))];

  const activeInView    = visible.filter((t) => t.status === "active");
  const nonActiveInView = visible.filter((t) => t.status !== "active");

  // ── Bulk actions ──────────────────────────────────────────────────────────

  async function deleteFiltered(targets: LiveTrap[]) {
    const isGlobalAll = statusFilter === "all" && ageFilter === "all";
    const ageLabel    = ageFilter === "all" ? "all players" : `${ageName} players`;
    const statusLabel = statusFilter === "all" ? "" : ` "${statusFilter}"`;
    const qtyLabel    = `${targets.length}${statusLabel} ${ageName} trap${targets.length !== 1 ? "s" : ""}`;

    if (!confirm(
      `⚠️ PERMANENTLY DELETE ${qtyLabel.toUpperCase()}?\n\n` +
      `This is IRREVERSIBLE — deleted traps cannot be recovered under any circumstances.\n\n` +
      `Scope: ${ageLabel}${statusFilter !== "all" ? `, status "${statusFilter}" only` : ""}.\n\n` +
      `Press OK only if you are certain.`
    )) return;

    setWorking("__delete__");
    setMsg(null);
    try {
      let deleted = 0;
      if (isGlobalAll) {
        const res = await httpsCallable(functions, "adminDeleteAllTraps")({ confirm: true }) as
          { data: { ok: boolean; deleted: number } };
        deleted = res.data.deleted;
        setTraps([]);
      } else {
        const fn  = httpsCallable(functions, "adminDeleteTrap");
        const ids = new Set(targets.map((t) => t.id));
        for (const trap of targets) {
          try { await fn({ trapId: trap.id }); deleted++; } catch { /* continue on error */ }
        }
        setTraps((prev) => prev.filter((t) => !ids.has(t.id)));
      }
      setMsg(`✅ Permanently deleted ${deleted} trap${deleted !== 1 ? "s" : ""}.`);
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : "Delete failed"}`);
    } finally { setWorking(null); }
  }

  async function activateFiltered(targets: LiveTrap[]) {
    const toActivate = targets.filter((t) => t.status !== "active");
    if (!toActivate.length) return;
    if (!confirm(`Activate ${toActivate.length} ${ageName} trap${toActivate.length !== 1 ? "s" : ""}?`)) return;
    setWorking("__activate__");
    const fn  = httpsCallable(functions, "adminActivateTrap");
    const ids = new Set(toActivate.map((t) => t.id));
    for (const trap of toActivate) {
      try { await fn({ trapId: trap.id }); } catch { /* continue */ }
    }
    setTraps((prev) => prev.map((t) => ids.has(t.id) ? { ...t, status: "active" } : t));
    setMsg(`✅ Activated ${toActivate.length} ${ageName} trap${toActivate.length !== 1 ? "s" : ""}.`);
    setWorking(null);
  }

  async function deactivateFiltered(targets: LiveTrap[]) {
    const toDeactivate = targets.filter((t) => t.status === "active");
    if (!toDeactivate.length) return;
    if (!confirm(`Deactivate ${toDeactivate.length} ${ageName} trap${toDeactivate.length !== 1 ? "s" : ""}?`)) return;
    setWorking("__deactivate__");
    const fn  = httpsCallable(functions, "adminDeactivateTrap");
    const ids = new Set(toDeactivate.map((t) => t.id));
    for (const trap of toDeactivate) {
      try { await fn({ trapId: trap.id }); } catch { /* continue */ }
    }
    setTraps((prev) => prev.map((t) => ids.has(t.id) ? { ...t, status: "inactive" } : t));
    setMsg(`✅ Deactivated ${toDeactivate.length} ${ageName} trap${toDeactivate.length !== 1 ? "s" : ""}.`);
    setWorking(null);
  }

  // ── Reusable bulk button ──────────────────────────────────────────────────

  function BulkBtn({ label, onClick, disabled, color, bg, border }: {
    label: string; onClick: () => void; disabled: boolean;
    color: string; bg: string; border: string;
  }) {
    return (
      <button onClick={onClick} disabled={disabled} style={{
        background: bg, color, border: `1px solid ${border}`,
        padding: "7px 14px", borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 700, fontSize: 12,
        opacity: disabled ? 0.45 : 1,
        whiteSpace: "nowrap",
      }}>
        {label}
      </button>
    );
  }

  // ── Trap row ──────────────────────────────────────────────────────────────

  function TrapRow({ trap }: { trap: LiveTrap }) {
    const busy     = working === trap.id;
    const anyBusy  = busy || isBulkWorking;
    const isActive = trap.status === "active";
    const ag       = trapAgeGroup(trap);

    return (
      <div style={{
        background: "#F4F7FB",
        border: `1px solid ${ag === "minor" ? "#EFE8FB" : "#DCE4EE"}`,
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
        opacity: isBulkWorking ? 0.6 : 1,
        transition: "opacity 0.2s",
      }}>
        <StatusBadge status={trap.status} />

        {/* Age badge */}
        <span style={{
          padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700,
          background: ag === "minor" ? "#EFE8FB22" : "#DCE4EE",
          color:      ag === "minor" ? "#6D3FC9"   : "#0B6C86",
          border:     `1px solid ${ag === "minor" ? "#6D3FC944" : "#0B6C8644"}`,
        }}>
          {ag === "minor" ? "🧒 Kids" : "👤 Adult"}
        </span>

        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#26394F" }}>
            {trap.trapTypeId ?? "unknown type"}
          </div>
          <div style={{ fontSize: 11, color: "#5F7491", marginTop: 2 }}>ID: {trap.id}</div>
          <div style={{ fontSize: 11, color: "#5F7491" }}>Owner: {trap.ownerUid ?? "—"}</div>
          {trap.lat != null && trap.lng != null && (
            <div style={{ fontSize: 11, color: "#5F7491" }}>
              {trap.lat.toFixed(5)}, {trap.lng.toFixed(5)}
            </div>
          )}
        </div>

        <div style={{ fontSize: 11, color: "#5F7491", minWidth: 120 }}>
          <div>{fmtTime(trap)}</div>
        </div>

        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {isActive ? (
            <button onClick={() => void deactivate(trap.id)} disabled={anyBusy} style={{
              background: "#DCE4EE", color: "#0B6C86", border: "1px solid #0B6C86",
              padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700,
              cursor: anyBusy ? "not-allowed" : "pointer",
            }}>
              {busy ? "…" : "⏸ Deactivate"}
            </button>
          ) : (
            <button onClick={() => void activate(trap.id)} disabled={anyBusy} style={{
              background: "#BFE8D222", color: "#178A55", border: "1px solid #BFE8D2",
              padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700,
              cursor: anyBusy ? "not-allowed" : "pointer",
            }}>
              {busy ? "…" : "▶ Activate"}
            </button>
          )}
          <button onClick={() => void deleteTrap(trap.id)} disabled={anyBusy} style={{
            background: "#F5C2C922", color: "#C8283B", border: "1px solid #F5C2C9",
            padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700,
            cursor: anyBusy ? "not-allowed" : "pointer",
          }}>
            {busy ? "…" : "🗑 Delete"}
          </button>
        </div>
      </div>
    );
  }

  // ── Section with header + bulk buttons + trap rows ────────────────────────

  function TrapSection({
    label, icon, borderColor, accentColor, trapsInSection,
  }: {
    label: string; icon: string; borderColor: string; accentColor: string;
    trapsInSection: LiveTrap[];
  }) {
    const sectionActive    = trapsInSection.filter((t) => t.status === "active");
    const sectionNonActive = trapsInSection.filter((t) => t.status !== "active");
    if (trapsInSection.length === 0) return null;
    return (
      <div>
        {/* Section header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          marginBottom: 10,
          paddingBottom: 8,
          borderBottom: `2px solid ${borderColor}`,
        }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: accentColor }}>
            {icon} {label} <span style={{ fontWeight: 400, color: "#5F7491", fontSize: 12 }}>({trapsInSection.length})</span>
          </span>
          <div style={{ flex: 1 }} />
          {sectionNonActive.length > 0 && (
            <BulkBtn
              label={working === "__activate__" ? "Activating…" : `▶ Activate ${sectionNonActive.length}`}
              onClick={() => void activateFiltered(trapsInSection)}
              disabled={isBulkWorking} color="#178A55" bg="#BFE8D222" border="#BFE8D2"
            />
          )}
          {sectionActive.length > 0 && (
            <BulkBtn
              label={working === "__deactivate__" ? "Deactivating…" : `⏸ Deactivate ${sectionActive.length}`}
              onClick={() => void deactivateFiltered(trapsInSection)}
              disabled={isBulkWorking} color="#0B6C86" bg="#DCE4EE" border="#0B6C86"
            />
          )}
          <BulkBtn
            label={working === "__delete__" ? "Deleting…" : `🗑 Delete ${trapsInSection.length}`}
            onClick={() => void deleteFiltered(trapsInSection)}
            disabled={isBulkWorking} color="#C8283B" bg="#F5C2C9" border="#F5C2C9"
          />
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {trapsInSection.map((t) => <TrapRow key={t.id} trap={t} />)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>

      {/* Toolbar */}
      <div style={{
        background: "#EEF2F7", border: "1px solid #DCE4EE", borderRadius: 12,
        padding: 20, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}>
        <button onClick={() => void load()} disabled={loading || isBulkWorking} style={{ minWidth: 100 }}>
          {loading ? "Loading…" : "↻ Refresh"}
        </button>

        {/* Age group toggle */}
        <AgeToggle value={ageFilter} onChange={(v) => { setAgeFilter(v); setMsg(null); }} />

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => { setFilter(e.target.value); setMsg(null); }}
          style={{ minWidth: 160 }}
          disabled={isBulkWorking}
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s === "all"
                ? `All statuses (${traps.filter(byAge).length})`
                : `${s} (${counts[s] ?? 0})`}
            </option>
          ))}
        </select>

        <div style={{ flex: 1 }} />

        {/* Global bulk buttons (only when not split into sections) */}
        {ageFilter !== "all" && (
          <>
            {nonActiveInView.length > 0 && (
              <BulkBtn
                label={working === "__activate__" ? "Activating…" : `▶ Activate ${nonActiveInView.length} ${ageName}`}
                onClick={() => void activateFiltered(visible)}
                disabled={isBulkWorking} color="#178A55" bg="#BFE8D222" border="#BFE8D2"
              />
            )}
            {activeInView.length > 0 && (
              <BulkBtn
                label={working === "__deactivate__" ? "Deactivating…" : `⏸ Deactivate ${activeInView.length} ${ageName}`}
                onClick={() => void deactivateFiltered(visible)}
                disabled={isBulkWorking} color="#0B6C86" bg="#DCE4EE" border="#0B6C86"
              />
            )}
            <BulkBtn
              label={working === "__delete__"
                ? "Deleting…"
                : statusFilter === "all"
                  ? `🗑 Delete ALL ${ageName} (${visible.length})`
                  : `🗑 Delete ${visible.length} "${statusFilter}" ${ageName}`}
              onClick={() => void deleteFiltered(visible)}
              disabled={isBulkWorking || visible.length === 0}
              color="#C8283B" bg="#F5C2C9" border="#F5C2C9"
            />
          </>
        )}
        {ageFilter === "all" && (
          <BulkBtn
            label={working === "__delete__"
              ? "Deleting…"
              : statusFilter === "all"
                ? `🗑 Delete ALL (${visible.length})`
                : `🗑 Delete ${visible.length} "${statusFilter}"`}
            onClick={() => void deleteFiltered(visible)}
            disabled={isBulkWorking || visible.length === 0}
            color="#C8283B" bg="#F5C2C9" border="#F5C2C9"
          />
        )}
      </div>

      {/* Status chips — scoped to age filter */}
      {traps.filter(byAge).length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span onClick={() => setFilter("all")} style={{
            padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
            background: statusFilter === "all" ? "#0B6C8644" : "#EEF2F7",
            color: statusFilter === "all" ? "#0B6C86" : "#5F7491",
            border: `1px solid ${statusFilter === "all" ? "#0B6C86" : "#DCE4EE"}`,
            cursor: "pointer", userSelect: "none",
          }}>
            all · {traps.filter(byAge).length}
          </span>
          {Object.entries(counts).map(([s, n]) => (
            <span key={s} onClick={() => setFilter(s)} style={{
              padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
              background: statusFilter === s
                ? (STATUS_COLORS[s] ?? "#3C516C") + "44"
                : (STATUS_COLORS[s] ?? "#3C516C") + "18",
              color: STATUS_COLORS[s] ?? "#3C516C",
              border: `1px solid ${(STATUS_COLORS[s] ?? "#3C516C")}${statusFilter === s ? "88" : "33"}`,
              cursor: "pointer", userSelect: "none",
            }}>
              {s} · {n}
            </span>
          ))}
        </div>
      )}

      {/* Isolation verification banner */}
      <div style={{
        background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 10,
        padding: "10px 16px", fontSize: 12, color: "#5F7491",
        display: "flex", gap: 16, flexWrap: "wrap",
      }}>
        <span style={{ color: "#178A55", fontWeight: 700 }}>✓ Age isolation active</span>
        <span>Adults see only adult traps · Kids see only kids traps</span>
        <span>Cross-capture, reveal &amp; disarm all blocked server-side</span>
        <span>
          👤 {adultTraps.length} adult trap{adultTraps.length !== 1 ? "s" : ""} ·{" "}
          🧒 {kidTraps.length} kid trap{kidTraps.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Feedback banner */}
      {msg && (
        <div style={{
          padding: "10px 14px", borderRadius: 8,
          background: msg.startsWith("✅") ? "#BFE8D222" : "#F5C2C922",
          color:      msg.startsWith("✅") ? "#178A55"   : "#C8283B",
          border:     `1px solid ${msg.startsWith("✅") ? "#BFE8D2" : "#F5C2C9"}`,
          fontSize: 13,
        }}>
          {msg}
        </div>
      )}

      {/* Trap list */}
      {loading ? (
        <div style={{ color: "#5F7491", padding: 24, textAlign: "center" }}>Loading traps…</div>
      ) : visible.length === 0 ? (
        <div style={{ color: "#5F7491", padding: 24, textAlign: "center" }}>
          {traps.length === 0 ? "No live traps found." : "No traps match this filter."}
        </div>
      ) : ageFilter !== "all" ? (
        // Single-section: age already filtered — flat list
        <div style={{ display: "grid", gap: 8 }}>
          {visible.map((t) => <TrapRow key={t.id} trap={t} />)}
        </div>
      ) : (
        // Split into Adults + Kids sections with per-section bulk buttons
        <div style={{ display: "grid", gap: 28 }}>
          <TrapSection
            label="Adults" icon="👤" borderColor="#0B6C86" accentColor="#0B6C86"
            trapsInSection={adultTraps}
          />
          <TrapSection
            label="Kids" icon="🧒" borderColor="#6D3FC9" accentColor="#6D3FC9"
            trapsInSection={kidTraps}
          />
        </div>
      )}
    </div>
  );
}

// ─── TRAP DEFINITIONS TAB ─────────────────────────────────────────────────────

function LocaleMapEditor({
  label,
  hint,
  rows,
  onChange,
}: {
  label: string;
  hint: string;
  rows: { lang: string; value: string }[];
  onChange: (rows: { lang: string; value: string }[]) => void;
}) {
  const inputStyle: React.CSSProperties = { flex: 1, padding: "4px 8px", background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 6, color: "#0D1F33", fontSize: 13 };
  return (
    <div style={{ border: "1px solid #DCE4EE", borderRadius: 10, padding: 12, background: "#F4F7FB" }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>{hint}</div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
          <input
            value={row.lang}
            maxLength={2}
            placeholder="en"
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...next[i], lang: e.target.value };
              onChange(next);
            }}
            style={{ ...inputStyle, flex: "0 0 50px" }}
          />
          <input
            value={row.value}
            placeholder="Translation…"
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...next[i], value: e.target.value };
              onChange(next);
            }}
            style={inputStyle}
          />
          <button
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            style={{ background: "#F5C2C9", border: "none", borderRadius: 6, color: "#C8283B", cursor: "pointer", padding: "4px 8px" }}
          >✕</button>
        </div>
      ))}
      <button
        onClick={() => onChange([...rows, { lang: "", value: "" }])}
        style={{ fontSize: 12, padding: "4px 10px", marginTop: 4 }}
      >+ Add language</button>
    </div>
  );
}

function TrapDefinitionsTab() {
  const [items, setItems] = useState<TrapDefinitionItem[]>([]);
  const [result, setResult] = useState("");

  const [id, setId]                 = useState("");
  const [name, setName]             = useState("");
  const [description, setDescription] = useState("");
  const [iconKey, setIconKey]       = useState("trap_default");
  const [imageUrl, setImageUrl]     = useState("");

  const [soundOnPlacedUrl, setSoundOnPlacedUrl]       = useState("");
  const [soundOnCapturedUrl, setSoundOnCapturedUrl]   = useState("");
  const [soundOnBlownUrl, setSoundOnBlownUrl]         = useState("");
  const [soundOnDisarmedUrl, setSoundOnDisarmedUrl]   = useState("");

  const [enabled, setEnabled]                     = useState(true);
  const [radiusMeters, setRadiusMeters]           = useState(25);
  const [disarmRadiusMeters, setDisarmRadiusMeters] = useState(26);
  const [disarmLeaveSeconds, setDisarmLeaveSeconds]           = useState(15);
  const [placementLeaveSeconds, setPlacementLeaveSeconds]     = useState(15);
  const [placementHoldSeconds, setPlacementHoldSeconds] = useState(3);
  const [revealHoldSeconds, setRevealHoldSeconds]       = useState(2);
  const [disarmHoldSeconds, setDisarmHoldSeconds]       = useState(4);
  const [effectKind, setEffectKind]               = useState("warning");
  const [effectValue, setEffectValue]             = useState(1);
  const [ownerCanTrigger, setOwnerCanTrigger]     = useState(true);
  const [visibility, setVisibility]               = useState<"owner-only" | "public-after-reveal">("owner-only");
  const [refillHours, setRefillHours]             = useState(24);
  const [maxBagSlots, setMaxBagSlots]             = useState(2);
  const [allowedAgeGroups, setAllowedAgeGroups]   = useState<TrapAgeGroup[]>(["minor", "adult"]);
  const [editingId, setEditingId]                 = useState("");
  // Per-locale name/description maps
  const [nameLocales, setNameLocales]             = useState<{lang: string; value: string}[]>([]);
  const [descLocales, setDescLocales]             = useState<{lang: string; value: string}[]>([]);
  const [translating, setTranslating]             = useState(false);
  const [translateError, setTranslateError]       = useState("");

  async function loadItems() {
    const fn = httpsCallable<unknown, TrapDefinitionsResponse>(functions, "adminListTrapDefinitions");
    const res = await fn();
    setItems(res.data.items ?? []);
  }

  function resetForm() {
    setId(""); setName(""); setDescription(""); setIconKey("trap_default"); setImageUrl("");
    setSoundOnPlacedUrl(""); setSoundOnCapturedUrl(""); setSoundOnBlownUrl(""); setSoundOnDisarmedUrl("");
    setEnabled(true); setRadiusMeters(25); setDisarmRadiusMeters(26);
    setDisarmLeaveSeconds(15); setPlacementLeaveSeconds(15);
    setTranslating(false); setTranslateError("");
    setPlacementHoldSeconds(3); setRevealHoldSeconds(2);
    setDisarmHoldSeconds(4); setEffectKind("warning"); setEffectValue(1);
    setOwnerCanTrigger(true); setVisibility("owner-only"); setRefillHours(24); setMaxBagSlots(2);
    setAllowedAgeGroups(["minor", "adult"]); setEditingId("");
    setNameLocales([]); setDescLocales([]);
  }

  function localeMapToRows(m?: LocaleMap | null) {
    if (!m) return [];
    return Object.entries(m).map(([lang, value]) => ({ lang, value }));
  }

  function startEdit(item: TrapDefinitionItem) {
    setEditingId(item.id); setId(item.id); setName(item.name ?? "");
    setDescription(item.description ?? ""); setIconKey(item.iconKey ?? "trap_default");
    setImageUrl(item.imageUrl ?? ""); setSoundOnPlacedUrl(item.soundOnPlacedUrl ?? "");
    setSoundOnCapturedUrl(item.soundOnCapturedUrl ?? ""); setSoundOnBlownUrl(item.soundOnBlownUrl ?? "");
    setSoundOnDisarmedUrl(item.soundOnDisarmedUrl ?? ""); setEnabled(item.enabled !== false);
    setRadiusMeters(item.radiusMeters ?? 25);
    setDisarmRadiusMeters(item.disarmRadiusMeters ?? (item.radiusMeters ?? 25) + 1);
    setDisarmLeaveSeconds(item.disarmLeaveSeconds ?? 15);
    setPlacementLeaveSeconds(item.placementLeaveSeconds ?? 15);
    setPlacementHoldSeconds(item.placementHoldSeconds ?? 3);
    setRevealHoldSeconds(item.revealHoldSeconds ?? 2); setDisarmHoldSeconds(item.disarmHoldSeconds ?? 4);
    setEffectKind(item.effectKind ?? "warning"); setEffectValue(item.effectValue ?? 1);
    setOwnerCanTrigger(item.ownerCanTrigger !== false);
    setVisibility(item.visibility === "public-after-reveal" ? "public-after-reveal" : "owner-only");
    setRefillHours(item.refillHours ?? 24); setMaxBagSlots(item.maxBagSlots ?? 2);
    setAllowedAgeGroups(normalizeAllowedAgeGroups(item.allowedAgeGroups));
    setNameLocales(localeMapToRows(item.names));
    setDescLocales(localeMapToRows(item.descriptions));
  }

  function rowsToLocaleMap(rows: {lang: string; value: string}[]): LocaleMap {
    const m: LocaleMap = {};
    for (const r of rows) {
      const k = r.lang.trim().toLowerCase().slice(0, 2);
      if (k && r.value.trim()) m[k] = r.value.trim();
    }
    return m;
  }

  function toggleAgeGroup(group: TrapAgeGroup) {
    setAllowedAgeGroups((prev) => {
      const next = prev.includes(group) ? prev.filter((x) => x !== group) : [...prev, group];
      return next.length > 0 ? next : prev;
    });
  }

  const payload = () => ({
    id: editingId || id.trim(), name: name.trim(), description: description.trim(),
    names: rowsToLocaleMap(nameLocales),
    descriptions: rowsToLocaleMap(descLocales),
    iconKey: iconKey.trim(), imageUrl: imageUrl.trim(),
    soundOnPlacedUrl: soundOnPlacedUrl.trim(), soundOnCapturedUrl: soundOnCapturedUrl.trim(),
    soundOnBlownUrl: soundOnBlownUrl.trim(), soundOnDisarmedUrl: soundOnDisarmedUrl.trim(),
    enabled, radiusMeters: Number(radiusMeters),
    disarmRadiusMeters: Math.max(Number(disarmRadiusMeters), Number(radiusMeters) + 1),
    disarmLeaveSeconds: Math.max(1, Math.round(Number(disarmLeaveSeconds))),
    placementLeaveSeconds: Math.max(1, Math.round(Number(placementLeaveSeconds))),
    placementHoldSeconds: Number(placementHoldSeconds), revealHoldSeconds: Number(revealHoldSeconds),
    disarmHoldSeconds: Number(disarmHoldSeconds), effectKind, effectValue: Number(effectValue),
    ownerCanTrigger, visibility, refillHours: Number(refillHours), maxBagSlots: Number(maxBagSlots),
    allowedAgeGroups,
  });

  async function createTrapDefinition() {
    const fn = httpsCallable(functions, "adminCreateTrapDefinition");
    const res = await fn(payload());
    setResult(JSON.stringify(res.data, null, 2));
    resetForm(); await loadItems();
  }

  async function updateTrapDefinition() {
    const fn = httpsCallable(functions, "adminUpdateTrapDefinition");
    const res = await fn(payload());
    setResult(JSON.stringify(res.data, null, 2));
    resetForm(); await loadItems();
  }

  async function deleteTrapDefinition(trapId: string) {
    const fn = httpsCallable(functions, "adminDeleteTrapDefinition");
    const res = await fn({ id: trapId });
    setResult(JSON.stringify(res.data, null, 2));
    if (editingId === trapId) resetForm();
    await loadItems();
  }

  useEffect(() => { void loadItems(); }, []);

  function helper(text: string) {
    return <div style={{ fontSize: 12, opacity: 0.75 }}>{text}</div>;
  }

  return (
    <section style={{ display: "grid", gap: 20 }}>
      <div style={{ background: "#EEF2F7", padding: 20, borderRadius: 12, border: "1px solid #DCE4EE" }}>
        <h2 style={{ marginTop: 0 }}>
          {editingId ? "Edit Trap Definition" : "Create Trap Definition"}
        </h2>
        <div style={{ display: "grid", gap: 10, maxWidth: 720 }}>
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Trap ID" disabled={!!editingId} />
          {helper("Example: timeout_major")}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Trap name (default / English)" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (default / English)" />

          {/* ── Auto-translate ────────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              disabled={translating || !name.trim()}
              onClick={async () => {
                setTranslating(true);
                setTranslateError("");
                try {
                  const fn = httpsCallable<unknown, { ok: boolean; names: Record<string, string>; descriptions: Record<string, string> }>(
                    functions, "adminTranslateTrapTexts"
                  );
                  const res = await fn({ name: name.trim(), description: description.trim() });
                  const { names: n, descriptions: d } = res.data;
                  // Merge results into locale rows, skipping "en" (already the default field)
                  setNameLocales(Object.entries(n).filter(([l]) => l !== "en").map(([lang, value]) => ({ lang, value })));
                  if (Object.keys(d).length > 0) {
                    setDescLocales(Object.entries(d).filter(([l]) => l !== "en").map(([lang, value]) => ({ lang, value })));
                  }
                } catch (e: unknown) {
                  setTranslateError(e instanceof Error ? e.message : "Translation failed.");
                } finally {
                  setTranslating(false);
                }
              }}
              style={{ background: "#0B6C86", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 600 }}
            >
              {translating ? "Translating…" : "🌐 Auto-translate name & description"}
            </button>
            {helper("Uses Claude AI to translate the English name/description into all supported languages. Overwrites existing translations.")}
          </div>
          {translateError && <div style={{ color: "#C8283B", fontSize: 13 }}>{translateError}</div>}

          {/* ── Per-language translations ─────────────────────────────── */}
          <LocaleMapEditor
            label="Name translations"
            hint="e.g. lang=hu value=Tréfa Csapda"
            rows={nameLocales}
            onChange={setNameLocales}
          />
          <LocaleMapEditor
            label="Description translations"
            hint="e.g. lang=hu value=Leejti és megnevettetiő csapda"
            rows={descLocales}
            onChange={setDescLocales}
          />

          <input value={iconKey} onChange={(e) => setIconKey(e.target.value)} placeholder="Icon key" />
          <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="Image URL" />
          {helper("Sounds (optional URLs)")}
          <input value={soundOnPlacedUrl}   onChange={(e) => setSoundOnPlacedUrl(e.target.value)}   placeholder="Sound: on placed"   />
          <input value={soundOnCapturedUrl} onChange={(e) => setSoundOnCapturedUrl(e.target.value)} placeholder="Sound: on captured" />
          <input value={soundOnBlownUrl}    onChange={(e) => setSoundOnBlownUrl(e.target.value)}    placeholder="Sound: on blown"    />
          <input value={soundOnDisarmedUrl} onChange={(e) => setSoundOnDisarmedUrl(e.target.value)} placeholder="Sound: on disarmed" />
          <label>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{" "}Enabled
          </label>
          <label>
            Trap radius — capture zone (m)
            <input type="number" min={1} value={radiusMeters}
              onChange={(e) => {
                const r = Number(e.target.value);
                setRadiusMeters(r);
                // Keep disarm radius ahead of trap radius automatically
                if (disarmRadiusMeters <= r) setDisarmRadiusMeters(r + 1);
              }} />
            {helper("Player is caught when they step within this distance.")}
          </label>
          <label>
            Disarm radius — safe working zone (m)
            <input type="number" min={radiusMeters + 1} value={disarmRadiusMeters}
              onChange={(e) => {
                const dr = Number(e.target.value);
                setDisarmRadiusMeters(Math.max(dr, radiusMeters + 1));
              }} />
            {helper(`Must be > trap radius (${radiusMeters}m). Player must stay between ${radiusMeters + 1}m–${disarmRadiusMeters}m to reveal/disarm. Step inside ${radiusMeters}m = trapped.`)}
          </label>
          <label>
            Disarm leave tolerance (seconds)
            <input type="number" min={1} max={30} value={disarmLeaveSeconds}
              onChange={(e) => setDisarmLeaveSeconds(Math.max(1, Math.round(Number(e.target.value))))} />
            {helper(`Player may leave the disarm zone for up to ${disarmLeaveSeconds}s before the reveal/disarm session is cancelled. Countdown shown in-app.`)}
          </label>
          <label>
            Placement leave tolerance (seconds)
            <input type="number" min={1} max={30} value={placementLeaveSeconds}
              onChange={(e) => setPlacementLeaveSeconds(Math.max(1, Math.round(Number(e.target.value))))} />
            {helper(`Player may leave the placement zone (${100}m) for up to ${placementLeaveSeconds}s before the placement session is cancelled. Countdown shown in-app.`)}
          </label>
          <label>Placement hold seconds<input type="number" value={placementHoldSeconds} onChange={(e) => setPlacementHoldSeconds(Number(e.target.value))} /></label>
          <label>Reveal hold seconds<input type="number" value={revealHoldSeconds} onChange={(e) => setRevealHoldSeconds(Number(e.target.value))} /></label>
          <label>Disarm hold seconds<input type="number" value={disarmHoldSeconds} onChange={(e) => setDisarmHoldSeconds(Number(e.target.value))} /></label>
          <label>Effect kind
            <select value={effectKind} onChange={(e) => setEffectKind(e.target.value)}>
              {EFFECT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label>Effect value<input type="number" value={effectValue} onChange={(e) => setEffectValue(Number(e.target.value))} /></label>
          <label><input type="checkbox" checked={ownerCanTrigger} onChange={(e) => setOwnerCanTrigger(e.target.checked)} />{" "}Owner can trigger</label>
          <label>Visibility
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as "owner-only" | "public-after-reveal")}>
              <option value="owner-only">owner-only</option>
              <option value="public-after-reveal">public-after-reveal</option>
            </select>
          </label>
          <label>Refill hours<input type="number" value={refillHours} onChange={(e) => setRefillHours(Number(e.target.value))} /></label>
          <label>Max bag slots<input type="number" value={maxBagSlots} onChange={(e) => setMaxBagSlots(Number(e.target.value))} /></label>

          <div style={{ border: "1px solid #DCE4EE", borderRadius: 10, padding: 12, background: "#F4F7FB" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Available age groups</div>
            <label style={{ display: "block", marginBottom: 6 }}>
              <input type="checkbox" checked={allowedAgeGroups.includes("minor")} onChange={() => toggleAgeGroup("minor")} />{" "}Minor
            </label>
            <label style={{ display: "block" }}>
              <input type="checkbox" checked={allowedAgeGroups.includes("adult")} onChange={() => toggleAgeGroup("adult")} />{" "}Adult
            </label>
            {helper("At least one age group must remain selected.")}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {!editingId ? (
              <button onClick={() => void createTrapDefinition()}>Create trap</button>
            ) : (
              <>
                <button onClick={() => void updateTrapDefinition()}>Save changes</button>
                <button onClick={() => resetForm()}>Cancel edit</button>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ background: "#EEF2F7", padding: 20, borderRadius: 12, border: "1px solid #DCE4EE" }}>
        <h2 style={{ marginTop: 0 }}>Trap Definitions</h2>
        <div style={{ display: "grid", gap: 10 }}>
          {items.map((item) => (
            <div key={item.id} style={{ border: "1px solid #DCE4EE", borderRadius: 10, padding: 12, display: "grid", gap: 6 }}>
              <div><strong>{item.name ?? item.id}</strong></div>
              <div>ID: {item.id}</div>
              <div>Icon: {item.iconKey ?? "-"}</div>
              <div>Effect: {item.effectKind ?? "-"} / {item.effectValue ?? "-"}</div>
              <div>Visibility: {item.visibility ?? "owner-only"} | Enabled: {item.enabled === false ? "false" : "true"}</div>
              <div>Age groups: {normalizeAllowedAgeGroups(item.allowedAgeGroups).join(", ")}</div>
              <div>Capture: {item.radiusMeters ?? 25}m | Disarm zone: {item.disarmRadiusMeters ?? ((item.radiusMeters ?? 25) + 1)}m | Leave (disarm): {item.disarmLeaveSeconds ?? 15}s | Leave (place): {item.placementLeaveSeconds ?? 15}s | Place: {item.placementHoldSeconds ?? 3}s | Reveal: {item.revealHoldSeconds ?? 2}s | Disarm: {item.disarmHoldSeconds ?? 4}s</div>
              <div>Refill: {item.refillHours ?? 24}h | Bag slots: {item.maxBagSlots ?? 2}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => startEdit(item)}>Edit</button>
                <button onClick={() => void deleteTrapDefinition(item.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <pre style={{ whiteSpace: "pre-wrap" }}>{result}</pre>
    </section>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────

export default function TrapManagementPanel() {
  const [tab, setTab] = useState<"definitions" | "live">("definitions");
  return (
    <div>
      <TabBar active={tab} onChange={setTab} />
      {tab === "definitions" ? <TrapDefinitionsTab /> : <LiveTrapsTab />}
    </div>
  );
}
