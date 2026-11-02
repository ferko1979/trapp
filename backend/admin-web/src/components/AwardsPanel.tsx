import { useState, useEffect, useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

// ── Types ─────────────────────────────────────────────────────────────────────

type RewardItem = {
  type: "card_time_deduction" | "xp_bonus" | "bag_refill";
  quantity: number;
};

type AwardDefinition = {
  id: string;
  name: string;
  description: string;
  iconEmoji: string;
  trigger: "day1_login" | "day1_hourly" | "daily_streak";
  triggerValue: number;
  rewards: RewardItem[];
  active: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

type UserInventory = {
  uid: string;
  unusedCards: Card[];
  usedCards: Card[];
  totalCardsEarned: number;
  totalCardsUsed: number;
  loginStreak: number;
  longestStreak: number;
  totalDaysPlayed: number;
  lastLoginDate: string | null;
};

type Card = {
  id: string;
  type: string;
  earnedAt: { seconds: number };
  earnedFrom: string;
  usedAt: { seconds: number } | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<AwardDefinition["trigger"], string> = {
  day1_login: "Day 1 Login Bonus",
  day1_hourly: "Day 1 Hourly",
  daily_streak: "Daily Streak",
};

const REWARD_LABELS: Record<RewardItem["type"], string> = {
  card_time_deduction: "⏱️ Time Card",
  xp_bonus: "⭐ XP Bonus",
  bag_refill: "🎒 Bag Refill",
};

// ── Styles ────────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "#0a1628",
  border: "1px solid #1e3a5f",
  borderRadius: 12,
  overflow: "hidden",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  background: "#060e1a",
  border: "1px solid #1e3a5f",
  borderRadius: 7,
  color: "#e2e8f0",
  fontSize: "0.875rem",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  color: "#94a3b8",
  fontSize: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 5,
};

const btn = (primary = false, danger = false): React.CSSProperties => ({
  padding: "8px 16px",
  background: danger ? "#7f1d1d" : primary ? "#1d4ed8" : "transparent",
  border: `1px solid ${danger ? "#dc2626" : primary ? "#3b82f6" : "#1e3a5f"}`,
  borderRadius: 7,
  color: danger ? "#fca5a5" : primary ? "#fff" : "#94a3b8",
  fontWeight: 600,
  fontSize: "0.8rem",
  cursor: "pointer",
});

const badge = (color: string): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: 5,
  fontSize: "0.72rem",
  fontWeight: 700,
  background: color + "22",
  color: color,
  border: `1px solid ${color}44`,
});

// ── Helper ────────────────────────────────────────────────────────────────────

function rewardSummary(rewards: RewardItem[]): string {
  return rewards.map((r) => `${r.quantity}× ${REWARD_LABELS[r.type] ?? r.type}`).join(", ");
}

function triggerBadgeColor(t: AwardDefinition["trigger"]): string {
  if (t === "day1_login")   return "#f59e0b";
  if (t === "day1_hourly")  return "#06b6d4";
  return "#8b5cf6";
}

// ── Empty form ────────────────────────────────────────────────────────────────

function emptyDef(): Omit<AwardDefinition, "id" | "createdAt" | "updatedAt"> {
  return {
    name: "",
    description: "",
    iconEmoji: "🎁",
    trigger: "daily_streak",
    triggerValue: 1,
    rewards: [{ type: "card_time_deduction", quantity: 1 }],
    active: true,
    sortOrder: 99,
  };
}

// ── Main component ────────────────────────────────────────────────────────────

type Tab = "definitions" | "lookup";

export default function AwardsPanel() {
  const [tab, setTab] = useState<Tab>("definitions");
  const [awards, setAwards] = useState<AwardDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<AwardDefinition | null>(null);
  const [creating, setCreating] = useState(false);

  const loadAwards = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const fn = httpsCallable<void, { ok: boolean; awards: AwardDefinition[] }>(
        functions, "adminListAwardDefinitions"
      );
      const res = await fn();
      setAwards(res.data.awards);
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : "Failed to load"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAwards(); }, [loadAwards]);

  async function seedDefaults() {
    setSeeding(true);
    setMsg("");
    try {
      const fn = httpsCallable<void, { ok: boolean; seeded: number }>(functions, "adminSeedDefaultAwards");
      const res = await fn();
      setMsg(`Seeded ${res.data.seeded} new award definitions.`);
      await loadAwards();
    } catch (e: unknown) {
      setMsg(`Seed error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSeeding(false);
    }
  }

  async function toggleActive(def: AwardDefinition) {
    try {
      const fn = httpsCallable<Record<string, unknown>, { ok: boolean }>(functions, "adminUpdateAwardDefinition");
      await fn({ id: def.id, active: !def.active });
      await loadAwards();
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function deleteAward(id: string) {
    if (!window.confirm("Delete this award definition?")) return;
    try {
      const fn = httpsCallable<{ id: string }, { ok: boolean }>(functions, "adminDeleteAwardDefinition");
      await fn({ id });
      await loadAwards();
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Group by trigger
  const grouped: Record<string, AwardDefinition[]> = {};
  for (const a of awards) {
    const g = a.trigger;
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(a);
  }

  if (editing || creating) {
    return (
      <AwardEditor
        initial={editing}
        onSaved={async () => { setEditing(null); setCreating(false); await loadAwards(); }}
        onCancel={() => { setEditing(null); setCreating(false); }}
        setMsg={setMsg}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 }}>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {([["definitions", "🏅 Award Definitions"], ["lookup", "🔍 User Inventory"]] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...btn(tab === t),
              padding: "10px 20px",
              borderRadius: 8,
              fontSize: "0.875rem",
              background: tab === t ? "#1d4ed8" : "transparent",
              color: tab === t ? "#fff" : "#64748b",
            }}
          >
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => void loadAwards()} style={btn()}>↻ Refresh</button>
        <button onClick={() => void seedDefaults()} disabled={seeding} style={btn()}>
          {seeding ? "⏳ Seeding…" : "🌱 Seed Defaults"}
        </button>
        {tab === "definitions" && (
          <button onClick={() => setCreating(true)} style={btn(true)}>+ New Award</button>
        )}
      </div>

      {msg && (
        <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: "0.875rem", background: "#0d2e16", border: "1px solid #14532d", color: "#86efac" }}>
          {msg}
        </div>
      )}

      {tab === "definitions" ? (
        loading ? (
          <div style={{ color: "#64748b", padding: 20 }}>Loading…</div>
        ) : awards.length === 0 ? (
          <div style={{ ...card, padding: 32, textAlign: "center", color: "#64748b" }}>
            <div style={{ fontSize: "2rem", marginBottom: 10 }}>🏅</div>
            <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>No award definitions yet</div>
            <div style={{ fontSize: "0.875rem", marginBottom: 16 }}>Click "Seed Defaults" to populate the built-in award schedule.</div>
            <button onClick={() => void seedDefaults()} disabled={seeding} style={btn(true)}>
              {seeding ? "Seeding…" : "🌱 Seed Default Awards"}
            </button>
          </div>
        ) : (
          <>
            {/* Summary card */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
              {(["day1_login", "day1_hourly", "daily_streak"] as const).map((t) => (
                <div key={t} style={{ ...card, padding: "14px 18px" }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: triggerBadgeColor(t), marginBottom: 4 }}>
                    {TRIGGER_LABELS[t]}
                  </div>
                  <div style={{ fontSize: "1.6rem", fontWeight: 800, color: "#e2e8f0" }}>
                    {(grouped[t] ?? []).length}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                    {(grouped[t] ?? []).filter((a) => a.active).length} active
                  </div>
                </div>
              ))}
            </div>

            {/* Award groups */}
            {(["day1_login", "day1_hourly", "daily_streak"] as const).map((trigger) => {
              const defs = grouped[trigger] ?? [];
              if (!defs.length) return null;
              return (
                <div key={trigger} style={card}>
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid #1e3a5f", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={badge(triggerBadgeColor(trigger))}>{TRIGGER_LABELS[trigger]}</span>
                    <span style={{ color: "#64748b", fontSize: "0.8rem" }}>{defs.length} awards</span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                      <thead>
                        <tr style={{ background: "#060e1a", color: "#64748b", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600 }}>Award</th>
                          {trigger === "day1_hourly" && <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600 }}>Hour</th>}
                          {trigger === "daily_streak" && <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600 }}>Day</th>}
                          <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600 }}>Rewards</th>
                          <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 600 }}>Status</th>
                          <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {defs.map((def, i) => (
                          <tr
                            key={def.id}
                            style={{ borderTop: i > 0 ? "1px solid #1e3a5f" : "none", opacity: def.active ? 1 : 0.5 }}
                          >
                            <td style={{ padding: "12px 16px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: "1.4rem" }}>{def.iconEmoji}</span>
                                <div>
                                  <div style={{ fontWeight: 700, color: "#e2e8f0" }}>{def.name}</div>
                                  <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: 1 }}>{def.description}</div>
                                </div>
                              </div>
                            </td>
                            {(trigger === "day1_hourly" || trigger === "daily_streak") && (
                              <td style={{ padding: "12px", color: "#e2e8f0", fontWeight: 700, fontSize: "1rem" }}>
                                {trigger === "day1_hourly" ? `H${def.triggerValue}` : `D${def.triggerValue}`}
                              </td>
                            )}
                            <td style={{ padding: "12px", color: "#94a3b8", fontSize: "0.8rem" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                {def.rewards.map((r, ri) => (
                                  <span key={ri} style={{ ...badge("#3b82f6"), display: "inline-flex" }}>
                                    {r.quantity}× {REWARD_LABELS[r.type] ?? r.type}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td style={{ padding: "12px", textAlign: "center" }}>
                              <button
                                onClick={() => void toggleActive(def)}
                                style={{ ...badge(def.active ? "#4ade80" : "#64748b"), cursor: "pointer", border: `1px solid ${def.active ? "#4ade8044" : "#64748b44"}` }}
                              >
                                {def.active ? "Active" : "Off"}
                              </button>
                            </td>
                            <td style={{ padding: "12px 16px", textAlign: "right" }}>
                              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                                <button onClick={() => setEditing(def)} style={btn()}>Edit</button>
                                <button onClick={() => void deleteAward(def.id)} style={btn(false, true)}>✕</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            {/* Reward legend */}
            <div style={{ ...card, padding: "14px 20px" }}>
              <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 10, fontSize: "0.875rem" }}>📘 Reward Types</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: "0.85rem", color: "#94a3b8" }}>
                <div><strong style={{ color: "#e2e8f0" }}>⏱️ Time Card (card_time_deduction):</strong> User can spend 1 card to subtract 5 minutes from a trap deployment or disassembly waiting timer. One-time use per card.</div>
                <div><strong style={{ color: "#e2e8f0" }}>⭐ XP Bonus (xp_bonus):</strong> Adds XP directly to the user's score. Applied automatically when the award is claimed.</div>
                <div><strong style={{ color: "#e2e8f0" }}>🎒 Bag Refill (bag_refill):</strong> Refills the user's trap bag by N extra traps on top of the normal daily limit.</div>
              </div>
            </div>
          </>
        )
      ) : (
        <UserInventoryLookup />
      )}
    </div>
  );
}

// ── User Inventory Lookup ─────────────────────────────────────────────────────

function UserInventoryLookup() {
  const [uid, setUid] = useState("");
  const [inv, setInv] = useState<UserInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [grantQty, setGrantQty] = useState(1);
  const [grantReason, setGrantReason] = useState("");
  const [granting, setGranting] = useState(false);

  async function lookup() {
    if (!uid.trim()) return;
    setLoading(true);
    setMsg("");
    setInv(null);
    try {
      const fn = httpsCallable<{ uid: string }, { ok: boolean } & UserInventory>(
        functions, "adminGetUserInventory"
      );
      const res = await fn({ uid: uid.trim() });
      setInv(res.data);
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function grantCards() {
    if (!uid.trim() || !grantQty) return;
    setGranting(true);
    try {
      const fn = httpsCallable<{ uid: string; quantity: number; reason: string }, { ok: boolean; granted: number }>(
        functions, "adminGrantCards"
      );
      const res = await fn({ uid: uid.trim(), quantity: grantQty, reason: grantReason || "admin_grant" });
      setMsg(`✅ Granted ${res.data.granted} card(s) to user.`);
      await lookup();
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGranting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
      <div style={card}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #1e3a5f", fontWeight: 700, color: "#e2e8f0", fontSize: "0.9rem" }}>
          🔍 Look Up User Inventory
        </div>
        <div style={{ padding: "16px 20px", display: "flex", gap: 10 }}>
          <input
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void lookup(); }}
            placeholder="Firebase UID"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={() => void lookup()} disabled={loading || !uid.trim()} style={btn(true)}>
            {loading ? "Looking up…" : "Look Up"}
          </button>
        </div>
      </div>

      {msg && (
        <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: "0.875rem", background: "#0d2e16", border: "1px solid #14532d", color: "#86efac" }}>
          {msg}
        </div>
      )}

      {inv && (
        <>
          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            {[
              { label: "Unused Cards", value: inv.unusedCards.length, color: "#4ade80" },
              { label: "Cards Used", value: inv.usedCards.length, color: "#94a3b8" },
              { label: "Day Streak", value: inv.loginStreak, color: "#f59e0b" },
              { label: "Days Played", value: inv.totalDaysPlayed, color: "#60a5fa" },
            ].map((s) => (
              <div key={s.label} style={{ ...card, padding: "14px 16px" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: "1.8rem", fontWeight: 800, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: "0.85rem", color: "#94a3b8" }}>
            <div style={card}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e3a5f", fontWeight: 700, color: "#e2e8f0", fontSize: "0.85rem" }}>
                ⏱️ Available Cards ({inv.unusedCards.length})
              </div>
              <div style={{ padding: "12px 16px", maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {inv.unusedCards.length === 0 ? (
                  <span style={{ color: "#475569" }}>No unused cards</span>
                ) : (
                  inv.unusedCards.map((c) => (
                    <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "#060e1a", borderRadius: 6, border: "1px solid #1e3a5f" }}>
                      <span style={{ color: "#4ade80", fontWeight: 700, fontSize: "0.8rem" }}>⏱️ −5 min</span>
                      <span style={{ color: "#64748b", fontSize: "0.72rem" }}>{c.earnedFrom}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div style={card}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e3a5f", fontWeight: 700, color: "#e2e8f0", fontSize: "0.85rem" }}>
                ✅ Used Cards ({inv.usedCards.length})
              </div>
              <div style={{ padding: "12px 16px", maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {inv.usedCards.length === 0 ? (
                  <span style={{ color: "#475569" }}>No used cards yet</span>
                ) : (
                  inv.usedCards.slice(0, 50).map((c) => (
                    <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "#060e1a", borderRadius: 6, border: "1px solid #1e3a5f", opacity: 0.6 }}>
                      <span style={{ color: "#64748b", fontSize: "0.8rem" }}>⏱️ used</span>
                      <span style={{ color: "#64748b", fontSize: "0.72rem" }}>{c.earnedFrom}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Grant cards */}
          <div style={card}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #1e3a5f", fontWeight: 700, color: "#e2e8f0", fontSize: "0.9rem" }}>
              🎁 Grant Cards to User
            </div>
            <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "80px 1fr auto", gap: 10, alignItems: "end" }}>
              <div>
                <label style={labelStyle}>Quantity</label>
                <input
                  type="number" min={1} max={100} value={grantQty}
                  onChange={(e) => setGrantQty(Number(e.target.value))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Reason (optional)</label>
                <input
                  value={grantReason}
                  onChange={(e) => setGrantReason(e.target.value)}
                  placeholder="e.g. compensation, contest prize"
                  style={inputStyle}
                />
              </div>
              <button onClick={() => void grantCards()} disabled={granting} style={btn(true)}>
                {granting ? "Granting…" : "Grant Cards"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Award Editor ──────────────────────────────────────────────────────────────

function AwardEditor({
  initial,
  onSaved,
  onCancel,
  setMsg,
}: {
  initial: AwardDefinition | null;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  setMsg: (m: string) => void;
}) {
  const isNew = !initial;
  const [form, setForm] = useState<Omit<AwardDefinition, "id" | "createdAt" | "updatedAt">>(
    initial ? {
      name: initial.name,
      description: initial.description,
      iconEmoji: initial.iconEmoji,
      trigger: initial.trigger,
      triggerValue: initial.triggerValue,
      rewards: initial.rewards,
      active: initial.active,
      sortOrder: initial.sortOrder,
    } : emptyDef()
  );
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function setReward(i: number, patch: Partial<RewardItem>) {
    setForm((prev) => {
      const rewards = [...prev.rewards];
      rewards[i] = { ...rewards[i], ...patch };
      return { ...prev, rewards };
    });
  }

  function addReward() {
    setForm((prev) => ({ ...prev, rewards: [...prev.rewards, { type: "card_time_deduction", quantity: 1 }] }));
  }

  function removeReward(i: number) {
    setForm((prev) => ({ ...prev, rewards: prev.rewards.filter((_, idx) => idx !== i) }));
  }

  async function save() {
    if (!form.name.trim()) { setMsg("Name is required."); return; }
    if (!form.rewards.length) { setMsg("At least one reward is required."); return; }
    setSaving(true);
    try {
      if (isNew) {
        const fn = httpsCallable<Record<string, unknown>, { ok: boolean }>(functions, "adminCreateAwardDefinition");
        await fn(form as unknown as Record<string, unknown>);
      } else {
        const fn = httpsCallable<Record<string, unknown>, { ok: boolean }>(functions, "adminUpdateAwardDefinition");
        await fn({ id: initial!.id, ...form } as unknown as Record<string, unknown>);
      }
      await onSaved();
    } catch (e: unknown) {
      setMsg(`Save error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const triggerDescription: Record<AwardDefinition["trigger"], string> = {
    day1_login: "Fires once when the user logs in for the very first time. triggerValue is ignored (set to 1).",
    day1_hourly: "Fires when the user has had the app open for N hours on their first day. triggerValue = hour number (1–8).",
    daily_streak: "Fires when the user reaches a consecutive login streak of N days. triggerValue = streak day number.",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 680 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onCancel} style={btn()}>← Back</button>
        <h2 style={{ margin: 0, fontSize: "1.2rem", color: "#e2e8f0" }}>
          {isNew ? "New Award Definition" : `Edit: ${initial!.name}`}
        </h2>
      </div>

      <div style={card}>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 12 }}>
            <div>
              <label style={labelStyle}>Award Name *</label>
              <input value={form.name} onChange={(e) => set("name", e.target.value)} style={inputStyle} placeholder="Week Warrior" />
            </div>
            <div>
              <label style={labelStyle}>Icon</label>
              <input value={form.iconEmoji} onChange={(e) => set("iconEmoji", e.target.value)} style={inputStyle} placeholder="🏆" maxLength={4} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Description</label>
            <input value={form.description} onChange={(e) => set("description", e.target.value)} style={inputStyle} placeholder="Short message shown to the user" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Trigger Type</label>
              <select value={form.trigger} onChange={(e) => set("trigger", e.target.value as AwardDefinition["trigger"])} style={inputStyle}>
                <option value="day1_login">Day 1 Login Bonus</option>
                <option value="day1_hourly">Day 1 Hourly</option>
                <option value="daily_streak">Daily Streak</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Trigger Value {form.trigger === "day1_hourly" ? "(hour 1–8)" : form.trigger === "daily_streak" ? "(streak day)" : "(ignored)"}</label>
              <input
                type="number" min={1} max={form.trigger === "day1_hourly" ? 8 : 9999}
                value={form.triggerValue}
                onChange={(e) => set("triggerValue", Number(e.target.value))}
                style={inputStyle}
                disabled={form.trigger === "day1_login"}
              />
            </div>
            <div>
              <label style={labelStyle}>Sort Order</label>
              <input type="number" min={0} value={form.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} style={inputStyle} />
            </div>
          </div>

          <div style={{ background: "#060e1a", border: "1px solid #1e3a5f", borderRadius: 8, padding: "10px 14px", fontSize: "0.8rem", color: "#64748b" }}>
            {triggerDescription[form.trigger]}
          </div>

          {/* Rewards */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Rewards *</label>
              <button onClick={addReward} style={{ ...btn(), fontSize: "0.75rem", padding: "5px 10px" }}>+ Add Reward</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {form.rewards.map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 100px auto", gap: 8, alignItems: "center" }}>
                  <select value={r.type} onChange={(e) => setReward(i, { type: e.target.value as RewardItem["type"] })} style={inputStyle}>
                    <option value="card_time_deduction">⏱️ Time Deduction Card (−5 min)</option>
                    <option value="xp_bonus">⭐ XP Bonus</option>
                    <option value="bag_refill">🎒 Bag Refill</option>
                  </select>
                  <input
                    type="number" min={1} value={r.quantity}
                    onChange={(e) => setReward(i, { quantity: Number(e.target.value) })}
                    style={inputStyle}
                    placeholder="Qty"
                  />
                  <button onClick={() => removeReward(i)} style={{ ...btn(false, true), padding: "8px 10px" }}>✕</button>
                </div>
              ))}
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} style={{ accentColor: "#3b82f6" }} />
            <span style={{ color: "#e2e8f0", fontWeight: 600 }}>Active (award fires when triggered)</span>
          </label>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => void save()} disabled={saving} style={btn(true)}>
          {saving ? "Saving…" : isNew ? "Create Award" : "Save Changes"}
        </button>
        <button onClick={onCancel} style={btn()}>Cancel</button>
      </div>
    </div>
  );
}
