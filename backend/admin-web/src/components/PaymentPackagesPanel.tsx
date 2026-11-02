import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";
import { functions } from "../firebase";

// ─── Types ───────────────────────────────────────────────────────────────────

type Discount = {
  code: string;
  discountPercent: number;
  validUntil: number | null;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
};

type Package = {
  id: string;
  name: string;
  description: string;
  duration: string;
  price: number;
  currency: string;
  trialDays: number;
  isActive: boolean;
  isRecurring: boolean;
  sortOrder: number;
  discounts: Discount[];
  // The user_levels doc ID granted to the user when this package is purchased.
  // Controls map zoom, trap allowances, etc.
  levelId: string;
  // Per-package ad disable flags
  disableBannerAd: boolean;
  disableInterstitialAd: boolean;
  disableRewardedAd: boolean;
  createdAtMs: number | null;
  updatedAtMs: number | null;
};

type UserLevel = { id: string; name: string; mapMinZoom?: number; mapVisibilityRadiusMeters?: number };

type Subscription = {
  id: string;
  uid: string | null;
  packageId: string | null;
  packageName: string | null;
  status: string;
  trialEnd: number | null;
  currentPeriodEnd: number | null;
  cancelledAt: number | null;
  cancelAtPeriodEnd: boolean;
  gateway: string;
  revolutOrderId: string | null;
  amount: number;
  currency: string;
  discountCode: string | null;
  createdAtMs: number | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DURATIONS = ["1d","7d","30d","1m","3m","6m","1y"];
const CURRENCIES = ["EUR","USD","GBP","HUF","CZK","PLN","RON","HRK"];

function fmtDuration(d: string): string {
  const m: Record<string, string> = { "1d":"1 Day","7d":"7 Days","30d":"30 Days","1m":"1 Month","3m":"3 Months","6m":"6 Months","1y":"1 Year" };
  return m[d] ?? d;
}

function fmtMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-EU", { style: "currency", currency: currency || "EUR", minimumFractionDigits: 2 }).format(amount / 100);
}

function fmt(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

const SUB_STATUS_COLOR: Record<string, string> = {
  active: "#178A55", trialing: "#0B6C86", pending_payment: "#8A5A0B",
  cancelled: "#C8283B", expired: "#3C516C", payment_failed: "#C8283B",
};

const EMPTY_PKG = (): Omit<Package, "id" | "createdAtMs" | "updatedAtMs"> => ({
  name: "", description: "", duration: "1m", price: 0, currency: "EUR",
  trialDays: 0, isActive: false, isRecurring: false, sortOrder: 99, discounts: [],
  levelId: "",
  disableBannerAd: false, disableInterstitialAd: false, disableRewardedAd: false,
});

function Card({ children, title, icon }: { children: React.ReactNode; title?: string; icon?: string }) {
  return (
    <div style={{ background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 14, padding: 22, display: "grid", gap: 16 }}>
      {title && <div style={{ fontWeight: 700, fontSize: "1rem", color: "#0D1F33", display: "flex", alignItems: "center", gap: 8 }}>{icon && <span>{icon}</span>}{title}</div>}
      {children}
    </div>
  );
}

// ─── Packages Tab ─────────────────────────────────────────────────────────────

function PackagesSection() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [levels, setLevels] = useState<UserLevel[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(false);
  const [editing, setEditing] = useState<(Package | Omit<Package, "id" | "createdAtMs" | "updatedAtMs">) | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [discPkgId, setDiscPkgId] = useState<string | null>(null);
  const [discForm, setDiscForm] = useState({ code: "", discountPercent: 10, validUntil: "", maxUses: "" });
  const [discMsg, setDiscMsg] = useState(""); const [discErr, setDiscErr] = useState(false);

  async function loadLevels() {
    try {
      const fn = httpsCallable<unknown, { ok: boolean; levels: UserLevel[] }>(functions, "adminListLevels");
      const res = await fn();
      setLevels(res.data.levels ?? []);
    } catch { /* non-fatal */ }
  }

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
        await httpsCallable(functions, "adminCreatePaymentPackage")(editing);
        setMsg("Package created.");
      } else {
        await httpsCallable(functions, "adminUpdatePaymentPackage")(editing);
        setMsg("Package updated.");
      }
      setEditing(null); void load();
    } catch (e) { setErr(true); setMsg(e instanceof Error ? e.message : "Save failed."); } finally { setLoading(false); }
  }

  async function del(id: string, name: string) {
    if (!window.confirm(`Delete package "${name}"?`)) return;
    setLoading(true);
    try { await httpsCallable(functions, "adminDeletePaymentPackage")({ id }); void load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Delete failed."); } finally { setLoading(false); }
  }

  async function addDiscount(pkgId: string) {
    setDiscMsg(""); setDiscErr(false);
    try {
      await httpsCallable(functions, "adminAddDiscount")({
        packageId: pkgId, code: discForm.code, discountPercent: discForm.discountPercent,
        validUntil: discForm.validUntil ? new Date(discForm.validUntil).getTime() : null,
        maxUses: discForm.maxUses ? Number(discForm.maxUses) : null,
      });
      setDiscMsg("Discount added."); setDiscForm({ code: "", discountPercent: 10, validUntil: "", maxUses: "" }); void load();
    } catch (e) { setDiscErr(true); setDiscMsg(e instanceof Error ? e.message : "Failed."); }
  }

  async function removeDiscount(pkgId: string, code: string) {
    if (!window.confirm(`Remove discount code "${code}"?`)) return;
    try { await httpsCallable(functions, "adminRemoveDiscount")({ packageId: pkgId, code }); void load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed."); }
  }

  useEffect(() => { void load(); void loadLevels(); }, []);

  type EP = Omit<Package, "id" | "createdAtMs" | "updatedAtMs"> & { id?: string };
  const e = editing as EP | null;
  function setE(k: string, v: unknown) { setEditing((p) => p ? { ...p, [k]: v } : p); }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn-primary" onClick={() => { setIsNew(true); setEditing(EMPTY_PKG()); setMsg(""); setErr(false); }}>+ New Package</button>
        <button onClick={() => void load()} disabled={loading}>🔄 Refresh</button>
        {msg && <span style={{ fontSize: "0.875rem", color: err ? "#C8283B" : "#178A55" }}>{err ? "⚠ " : "✓ "}{msg}</span>}
      </div>

      {editing && (
        <Card title={isNew ? "Create Package" : "Edit Package"} icon="📦">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <label>
              <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#3C516C" }}>Name *</span>
              <input value={e?.name ?? ""} onChange={(ev) => setE("name", ev.target.value)} placeholder="Monthly Premium" />
            </label>
            <label>
              <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#3C516C" }}>Duration</span>
              <select value={e?.duration ?? "1m"} onChange={(ev) => setE("duration", ev.target.value)} style={{ width: "100%" }}>
                {DURATIONS.map((d) => <option key={d} value={d}>{fmtDuration(d)}</option>)}
              </select>
            </label>
            <label>
              <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#3C516C" }}>Price (minor units — e.g. 999 = €9.99)</span>
              <input type="number" value={e?.price ?? 0} onChange={(ev) => setE("price", Number(ev.target.value))} min={0} />
            </label>
            <label>
              <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#3C516C" }}>Currency</span>
              <select value={e?.currency ?? "EUR"} onChange={(ev) => setE("currency", ev.target.value)} style={{ width: "100%" }}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>
              <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#3C516C" }}>Trial Days (0 = no trial)</span>
              <input type="number" value={e?.trialDays ?? 0} onChange={(ev) => setE("trialDays", Number(ev.target.value))} min={0} />
            </label>
            <label>
              <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#3C516C" }}>Sort Order (lower = shown first)</span>
              <input type="number" value={e?.sortOrder ?? 99} onChange={(ev) => setE("sortOrder", Number(ev.target.value))} min={0} />
            </label>
          </div>
          <label>
            <span style={{ display: "block", marginBottom: 5, fontSize: "0.82rem", color: "#3C516C" }}>Description</span>
            <input value={e?.description ?? ""} onChange={(ev) => setE("description", ev.target.value)} placeholder="Unlimited access for 1 month" />
          </label>

          {/* Membership level (controls map zoom, trap capacity, etc.) */}
          <div style={{ background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 10, padding: "14px 16px", display: "grid", gap: 10 }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#3C516C" }}>🗺️ Membership level granted on purchase</div>
            <select
              value={(e as Record<string, unknown>)?.levelId as string ?? ""}
              onChange={(ev) => setE("levelId", ev.target.value)}
              style={{ padding: 10, borderRadius: 8, border: "1px solid #5F7491", background: "#F4F7FB", color: "#0D1F33", fontSize: "0.875rem" }}
            >
              <option value="">— None (stays on current level) —</option>
              {levels.map((lv) => (
                <option key={lv.id} value={lv.id}>
                  {lv.name || lv.id}
                  {lv.mapMinZoom != null ? ` · zoom ≥ ${lv.mapMinZoom}` : ""}
                  {lv.mapVisibilityRadiusMeters != null && lv.mapMinZoom == null
                    ? ` · ~${lv.mapVisibilityRadiusMeters}m radius`
                    : ""}
                </option>
              ))}
            </select>
            <div style={{ fontSize: "0.72rem", color: "#5F7491", lineHeight: 1.5 }}>
              When this subscription is purchased, the user is moved to the selected level.
              The level controls the maximum map zoom-out distance and other tier perks.
              Selecting "None" leaves the user on their current level (useful for add-on packages).
            </div>
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={Boolean(e?.isActive)} onChange={(ev) => setE("isActive", ev.target.checked)} />
              <span style={{ fontSize: "0.875rem" }}>Active (visible to users)</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={Boolean(e?.isRecurring)} onChange={(ev) => setE("isRecurring", ev.target.checked)} />
              <span style={{ fontSize: "0.875rem" }}>🔄 Recurring subscription</span>
            </label>
          </div>

          {/* Per-package ad disable flags */}
          <div style={{ background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 10, padding: "14px 16px", display: "grid", gap: 8 }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#3C516C", marginBottom: 4 }}>📺 Ads disabled for subscribers of this package</div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {(
                [
                  { key: "disableBannerAd",        label: "Banner ads" },
                  { key: "disableInterstitialAd",  label: "Interstitial ads" },
                  { key: "disableRewardedAd",      label: "Rewarded ads" },
                ] as const
              ).map(({ key, label }) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: "0.875rem" }}>
                  <input
                    type="checkbox"
                    checked={Boolean((e as Record<string, unknown>)?.[key])}
                    onChange={(ev) => setE(key, ev.target.checked)}
                    style={{ accentColor: "#C8283B" }}
                  />
                  <span>🚫 {label}</span>
                </label>
              ))}
            </div>
            <div style={{ fontSize: "0.72rem", color: "#5F7491" }}>
              Only applies when the user has an active, non-expired subscription to this package. Global ad settings still take priority (if a global toggle is off, ads are off for everyone).
            </div>
          </div>

          {e?.isRecurring && (
            <div style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 8, padding: "10px 14px", fontSize: "0.8rem", color: "#8A5A0B" }}>
              ⚠️ <strong>Recurring subscription:</strong> Users will be advised that this plan auto-renews and can be cancelled at any time. They must acknowledge this before checkout.
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-primary" onClick={() => void save()} disabled={loading}>{loading ? "Saving…" : "Save"}</button>
            <button onClick={() => { setEditing(null); setMsg(""); setErr(false); }}>Cancel</button>
          </div>
        </Card>
      )}

      {packages.length === 0 && !loading && !editing && (
        <div style={{ padding: "32px", textAlign: "center", color: "#5F7491", background: "#F4F7FB", borderRadius: 14, border: "1px solid #DCE4EE" }}>
          No packages yet. Create your first payment package above.
        </div>
      )}

      {packages.map((pkg) => (
        <div key={pkg.id} style={{ background: "#F4F7FB", border: `1px solid ${pkg.isActive ? "#DCE4EE" : "#F4F7FB"}`, borderRadius: 14, padding: 18, opacity: pkg.isActive ? 1 : 0.65 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: "1rem", color: "#0D1F33" }}>{pkg.name}</span>
                <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: 999, background: pkg.isActive ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)", color: pkg.isActive ? "#178A55" : "#5F7491", fontWeight: 600 }}>{pkg.isActive ? "Active" : "Inactive"}</span>
                {pkg.isRecurring && <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: 999, background: "rgba(167,139,250,0.15)", color: "#6D3FC9", fontWeight: 600 }}>🔄 Recurring</span>}
                {pkg.trialDays > 0 && <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: 999, background: "rgba(96,165,250,0.15)", color: "#0B6C86", fontWeight: 600 }}>{pkg.trialDays}d trial</span>}
                {pkg.levelId && (() => {
                  const lv = levels.find((l) => l.id === pkg.levelId);
                  return (
                    <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: 999, background: "rgba(34,197,94,0.12)", color: "#178A55", fontWeight: 600 }}>
                      🗺️ {lv ? (lv.name || lv.id) : pkg.levelId}
                      {lv?.mapMinZoom != null ? ` (zoom ≥${lv.mapMinZoom})` : ""}
                    </span>
                  );
                })()}
                {pkg.disableBannerAd && <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: 999, background: "rgba(248,113,113,0.12)", color: "#C8283B", fontWeight: 600 }}>🚫 Banner</span>}
                {pkg.disableInterstitialAd && <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: 999, background: "rgba(248,113,113,0.12)", color: "#C8283B", fontWeight: 600 }}>🚫 Interstitial</span>}
                {pkg.disableRewardedAd && <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: 999, background: "rgba(248,113,113,0.12)", color: "#C8283B", fontWeight: 600 }}>🚫 Rewarded</span>}
              </div>
              <div style={{ fontSize: "0.8rem", color: "#5F7491", marginTop: 4 }}>
                <strong style={{ color: "#0D1F33" }}>{fmtMoney(pkg.price, pkg.currency)}</strong> / {fmtDuration(pkg.duration)}
                {pkg.description ? ` · ${pkg.description}` : ""} · Sort: {pkg.sortOrder}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button onClick={() => { setIsNew(false); setEditing({ ...pkg }); setMsg(""); setErr(false); }} style={{ fontSize: "0.8rem", padding: "5px 12px" }}>✏️ Edit</button>
              <button onClick={() => void del(pkg.id, pkg.name)} style={{ fontSize: "0.8rem", padding: "5px 12px", background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)", color: "#C8283B", borderRadius: 6, cursor: "pointer" }}>🗑 Del</button>
            </div>
          </div>
          <div style={{ borderTop: "1px solid #DCE4EE", paddingTop: 12 }}>
            <div style={{ fontSize: "0.78rem", color: "#3C516C", fontWeight: 600, marginBottom: 8 }}>🏷 Discounts ({pkg.discounts.length})</div>
            {pkg.discounts.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {pkg.discounts.map((d) => (
                  <div key={d.code} style={{ background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 8, padding: "5px 10px", display: "flex", alignItems: "center", gap: 6 }}>
                    <code style={{ fontSize: "0.8rem", color: "#8A5A0B" }}>{d.code}</code>
                    <span style={{ fontSize: "0.75rem", color: "#178A55" }}>-{d.discountPercent}%</span>
                    {d.maxUses && <span style={{ fontSize: "0.72rem", color: "#5F7491" }}>{d.usedCount}/{d.maxUses}</span>}
                    <button onClick={() => void removeDiscount(pkg.id, d.code)} style={{ fontSize: "0.7rem", padding: "1px 5px", background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.3)", color: "#C8283B", borderRadius: 4, cursor: "pointer" }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {discPkgId === pkg.id ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                {[
                  { label: "Code", el: <input value={discForm.code} onChange={(ev) => setDiscForm((p) => ({ ...p, code: ev.target.value.toUpperCase() }))} placeholder="PROMO10" style={{ width: 100 }} /> },
                  { label: "Discount %", el: <input type="number" value={discForm.discountPercent} onChange={(ev) => setDiscForm((p) => ({ ...p, discountPercent: Number(ev.target.value) }))} min={1} max={100} style={{ width: 70 }} /> },
                  { label: "Valid until", el: <input type="date" value={discForm.validUntil} onChange={(ev) => setDiscForm((p) => ({ ...p, validUntil: ev.target.value }))} style={{ width: 130 }} /> },
                  { label: "Max uses", el: <input type="number" value={discForm.maxUses} onChange={(ev) => setDiscForm((p) => ({ ...p, maxUses: ev.target.value }))} placeholder="∞" style={{ width: 80 }} /> },
                ].map(({ label, el }) => (
                  <div key={label}>
                    <div style={{ fontSize: "0.72rem", color: "#5F7491", marginBottom: 3 }}>{label}</div>
                    {el}
                  </div>
                ))}
                <button className="btn-primary" onClick={() => void addDiscount(pkg.id)} style={{ fontSize: "0.8rem" }}>Add</button>
                <button onClick={() => setDiscPkgId(null)} style={{ fontSize: "0.8rem" }}>Cancel</button>
                {discMsg && <span style={{ fontSize: "0.8rem", color: discErr ? "#C8283B" : "#178A55" }}>{discMsg}</span>}
              </div>
            ) : (
              <button onClick={() => { setDiscPkgId(pkg.id); setDiscMsg(""); setDiscErr(false); }} style={{ fontSize: "0.78rem", padding: "4px 10px" }}>+ Add Discount Code</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Subscriptions Section ────────────────────────────────────────────────────

function SubscriptionsSection() {
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
    try { await httpsCallable(functions, "adminCancelSubscription")({ subscriptionId: id }); void load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Cancel failed."); } finally { setCancelling(null); }
  }

  useEffect(() => { void load(); }, [statusFilter]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 180 }}>
          <option value="">All statuses</option>
          {["active","trialing","pending_payment","cancelled","expired","payment_failed"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input value={uidFilter} onChange={(e) => setUidFilter(e.target.value)} placeholder="Filter by UID…" style={{ width: 220, fontFamily: "monospace", fontSize: "0.82rem" }} onKeyDown={(e) => { if (e.key === "Enter") void load(); }} />
        <button onClick={() => void load()} disabled={loading}>🔄 {loading ? "Loading…" : "Refresh"}</button>
      </div>
      {subs.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
          {[["Total",subs.length,"#3C516C"],["Active",subs.filter(s=>s.status==="active").length,"#178A55"],["Trialing",subs.filter(s=>s.status==="trialing").length,"#0B6C86"],["Cancelled",subs.filter(s=>s.status==="cancelled").length,"#C8283B"]].map(([l,v,c]) => (
            <div key={l as string} style={{ background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ fontSize: "0.72rem", color: "#5F7491", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{l}</div>
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: c as string }}>{v as number}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
            <thead>
              <tr style={{ background: "#F4F7FB" }}>
                {["Created","User","Package","Valid Until","Status","Actions"].map((h) => (
                  <th key={h} style={{ padding: "12px 14px", textAlign: "left", color: "#5F7491", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap", borderBottom: "1px solid #DCE4EE" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subs.length === 0 && <tr><td colSpan={6} style={{ padding: "32px 14px", textAlign: "center", color: "#5F7491" }}>{loading ? "Loading…" : "No subscriptions found."}</td></tr>}
              {subs.map((sub, idx) => (
                <tr key={sub.id} style={{ background: idx % 2 === 0 ? "transparent" : "#F4F7FB" }}>
                  <td style={{ padding: "10px 14px", color: "#3C516C", whiteSpace: "nowrap", verticalAlign: "top" }}>{fmt(sub.createdAtMs)}</td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    <div style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "#5F7491" }}>{sub.uid?.slice(0,16) ?? "—"}…</div>
                  </td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    <div style={{ color: "#0D1F33" }}>{sub.packageName ?? sub.packageId ?? "—"}</div>
                    <div style={{ fontSize: "0.75rem", color: "#5F7491" }}>{fmtMoney(sub.amount, sub.currency)}{sub.discountCode ? ` · ${sub.discountCode}` : ""}</div>
                  </td>
                  <td style={{ padding: "10px 14px", color: "#3C516C", verticalAlign: "top", whiteSpace: "nowrap" }}>
                    {sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : "—"}
                    {sub.cancelAtPeriodEnd && <div style={{ fontSize: "0.72rem", color: "#C8283B" }}>⚠ Cancels at end</div>}
                    {sub.trialEnd && <div style={{ fontSize: "0.72rem", color: "#0B6C86" }}>Trial: {new Date(sub.trialEnd).toLocaleDateString()}</div>}
                  </td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    <span style={{ fontSize: "0.73rem", fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: `${SUB_STATUS_COLOR[sub.status] ?? "#3C516C"}20`, color: SUB_STATUS_COLOR[sub.status] ?? "#3C516C", textTransform: "capitalize" }}>
                      {sub.status.replace("_", " ")}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                    {["active","trialing","pending_payment"].includes(sub.status) && (
                      <button onClick={() => void cancel(sub.id)} disabled={cancelling === sub.id} style={{ fontSize: "0.75rem", padding: "4px 10px", background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.3)", color: "#C8283B", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap" }}>
                        {cancelling === sub.id ? "…" : "🚫 Cancel"}
                      </button>
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

// ─── Main panel ───────────────────────────────────────────────────────────────

type Tab = "packages" | "subscriptions";

export default function PaymentPackagesPanel() {
  const [tab, setTab] = useState<Tab>("packages");

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 1100 }}>
      <div style={{ display: "flex", gap: 4, background: "#F4F7FB", borderRadius: 10, padding: 4, border: "1px solid #DCE4EE", width: "fit-content" }}>
        {([{ key: "packages", label: "📦 Packages" }, { key: "subscriptions", label: "📋 Subscriptions" }] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)} style={{ padding: "8px 20px", borderRadius: 7, border: "none", background: tab === key ? "#0B6C86" : "transparent", color: tab === key ? "#fff" : "#3C516C", fontWeight: tab === key ? 600 : 400, fontSize: "0.875rem", cursor: "pointer" }}>{label}</button>
        ))}
      </div>
      {tab === "packages" && <PackagesSection />}
      {tab === "subscriptions" && <SubscriptionsSection />}
    </div>
  );
}
