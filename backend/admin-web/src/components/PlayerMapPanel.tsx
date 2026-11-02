import { useCallback, useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { collection, getDocs, query, where } from "firebase/firestore";
import { functions, db } from "../firebase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlayerLoc = {
  uid: string;
  lat: number;
  lng: number;
  username: string;
  ageGroup: string;
  updatedAtMs: number | null;
};

type TrapDoc = {
  id: string;
  lat: number;
  lng: number;
  status: string;
  ownerUid: string;
  trapTypeId: string;
  radiusMeters: number;
  generatedBy?: string;
  generatorLocation?: string;
  expiresAt?: { seconds: number } | null;
  createdAt?: { seconds: number } | null;
};

type Tab = "players" | "traps";
type TrapFilter = "all" | "user" | "admin";
type TrapStatus = "active" | "captured" | "disarmed";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTERVALS: { label: string; secs: number }[] = [
  { label: "5 s",    secs: 5   },
  { label: "15 s",   secs: 15  },
  { label: "30 s",   secs: 30  },
  { label: "1 min",  secs: 60  },
  { label: "5 min",  secs: 300 },
  { label: "15 min", secs: 900 },
];

const LS_KEY_INTERVAL = "admin_player_map_interval";
const LS_KEY_TAB      = "admin_player_map_tab";

/** Players not seen within this window are considered inactive. */
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1_000; // 5 minutes

/** Detection radius shown around active players (meters). */
const DETECTION_RADIUS_M = 250;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isActive(p: PlayerLoc): boolean {
  return p.updatedAtMs !== null && Date.now() - p.updatedAtMs < ACTIVE_THRESHOLD_MS;
}

function markerColor(p: PlayerLoc): string {
  const active = isActive(p);
  if (p.ageGroup === "minor") return active ? "#178A55" : "#8A5A0B";
  return active ? "#0B6C86" : "#6D3FC9";
}

function fmtLastSeen(ms: number | null): string {
  if (ms === null) return "—";
  const elapsed = Date.now() - ms;
  if (elapsed < ACTIVE_THRESHOLD_MS) return "Online";
  const totalSecs = Math.max(0, Math.floor(elapsed / 1_000));
  const d = Math.floor(totalSecs / 86_400);
  const h = Math.floor((totalSecs % 86_400) / 3_600);
  const m = Math.floor((totalSecs % 3_600) / 60);
  const s = totalSecs % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ") + " ago";
}

function trapColor(t: TrapDoc): string {
  if (t.status === "captured") return "#C8283B";   // red
  if (t.status === "disarmed") return "#5F7491";   // grey
  // active
  if (t.generatedBy === "admin") return "#8A5A0B"; // amber = admin-placed
  return "#0B6C86";                                 // blue = user-placed
}

// ---------------------------------------------------------------------------
// Leaflet loader
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    L: any;
  }
}

function loadLeaflet(): Promise<void> {
  if (window.L) return Promise.resolve();
  return new Promise((resolve) => {
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id   = "leaflet-css";
      link.rel  = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    if (!document.getElementById("leaflet-js")) {
      const script = document.createElement("script");
      script.id  = "leaflet-js";
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = () => resolve();
      document.body.appendChild(script);
    } else {
      const wait = setInterval(() => {
        if (window.L) { clearInterval(wait); resolve(); }
      }, 50);
    }
  });
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PlayerMapPanel() {
  const mapDivRef      = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef         = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerLayerRef = useRef<any>(null); // LayerGroup for players
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trapLayerRef   = useRef<any>(null); // LayerGroup for traps

  const [tab, setTab] = useState<Tab>(() =>
    (localStorage.getItem(LS_KEY_TAB) as Tab) ?? "players"
  );
  const [players,      setPlayers]      = useState<PlayerLoc[]>([]);
  const [traps,        setTraps]        = useState<TrapDoc[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [lastRefresh,  setLastRefresh]  = useState<Date | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [intervalSecs, setIntervalSecs] = useState<number>(() => {
    const saved = Number(localStorage.getItem(LS_KEY_INTERVAL));
    return INTERVALS.some((i) => i.secs === saved) ? saved : 30;
  });
  const [countdown,       setCountdown]       = useState(0);
  const [showRadii,       setShowRadii]       = useState(false);
  const [trapStatus,      setTrapStatus]      = useState<TrapStatus>("active");
  const [trapFilter,      setTrapFilter]      = useState<TrapFilter>("all");

  // ── Fetch players ────────────────────────────────────────────────────────

  const fetchPlayers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fn  = httpsCallable<unknown, { ok: boolean; players: PlayerLoc[] }>(
        functions, "adminGetPlayerLocations"
      );
      const res = await fn();
      setPlayers(res.data.players ?? []);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch traps ──────────────────────────────────────────────────────────

  const fetchTraps = useCallback(async (status: TrapStatus) => {
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(
        query(collection(db, "traps"), where("status", "==", status))
      );
      const docs: TrapDoc[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id:                d.id,
          lat:               data.lat ?? 0,
          lng:               data.lng ?? 0,
          status:            data.status ?? "",
          ownerUid:          data.ownerUid ?? "",
          trapTypeId:        data.trapTypeId ?? "",
          radiusMeters:      data.radiusMeters ?? 25,
          generatedBy:       data.generatedBy,
          generatorLocation: data.generatorLocation,
          expiresAt:         data.expiresAt,
          createdAt:         data.createdAt,
        };
      });
      setTraps(docs);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trap fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Unified refresh ──────────────────────────────────────────────────────

  const refresh = useCallback(() => {
    if (tab === "players") void fetchPlayers();
    else void fetchTraps(trapStatus);
  }, [tab, trapStatus, fetchPlayers, fetchTraps]);

  // ── Init map (once) ──────────────────────────────────────────────────────

  useEffect(() => {
    let destroyed = false;

    void loadLeaflet().then(() => {
      if (destroyed || !mapDivRef.current || mapRef.current) return;
      const L   = window.L;
      const map = L.map(mapDivRef.current, { center: [47.5, 19.0], zoom: 12 });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
        maxZoom: 19,
      }).addTo(map);

      playerLayerRef.current = L.layerGroup().addTo(map);
      trapLayerRef.current   = L.layerGroup().addTo(map);

      mapRef.current = map;
      void fetchPlayers();
    });

    return () => {
      destroyed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        playerLayerRef.current = null;
        trapLayerRef.current   = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render player markers ────────────────────────────────────────────────

  useEffect(() => {
    const L   = window.L;
    const map = mapRef.current;
    const layer = playerLayerRef.current;
    if (!L || !map || !layer) return;

    layer.clearLayers();
    if (tab !== "players") return;

    for (const p of players) {
      const active = isActive(p);
      const color  = markerColor(p);

      // Detection radius circle
      if (showRadii && active) {
        L.circle([p.lat, p.lng], {
          radius:      DETECTION_RADIUS_M,
          color,
          fillColor:   color,
          fillOpacity: 0.06,
          weight:      1,
          dashArray:   "4 4",
        }).addTo(layer);
      }

      // Player dot
      const m = L.circleMarker([p.lat, p.lng], {
        radius:      active ? 10 : 7,
        color,
        fillColor:   color,
        fillOpacity: active ? 0.9 : 0.45,
        weight:      2,
      }).addTo(layer);

      const lastSeenStr = fmtLastSeen(p.updatedAtMs);
      const onlineBadge = lastSeenStr === "Online"
        ? `<span style="background:#178A55;color:#fff;padding:1px 7px;border-radius:10px;font-size:11px;font-weight:700;">● Online</span>`
        : `<span style="color:#3C516C;font-size:12px;">${lastSeenStr}</span>`;

      m.bindPopup(
        `<b>${p.username}</b><br>` +
        `Age: ${p.ageGroup}<br>` +
        `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}<br>` +
        onlineBadge
      );
    }

    if (players.length > 0) {
      const bounds = L.latLngBounds(players.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, tab, showRadii]);

  // ── Render trap markers ──────────────────────────────────────────────────

  const filteredTraps = traps.filter((t) => {
    if (trapFilter === "admin") return t.generatedBy === "admin";
    if (trapFilter === "user")  return t.generatedBy !== "admin";
    return true;
  });

  useEffect(() => {
    const L     = window.L;
    const map   = mapRef.current;
    const layer = trapLayerRef.current;
    if (!L || !map || !layer) return;

    layer.clearLayers();
    if (tab !== "traps") return;

    for (const t of filteredTraps) {
      const color = trapColor(t);
      const isAdminPlaced = t.generatedBy === "admin";

      const m = L.circleMarker([t.lat, t.lng], {
        radius:      isAdminPlaced ? 6 : 7,
        color,
        fillColor:   color,
        fillOpacity: 0.85,
        weight:      isAdminPlaced ? 1.5 : 2,
      }).addTo(layer);

      const expiry = t.expiresAt
        ? new Date(t.expiresAt.seconds * 1000).toLocaleDateString()
        : "—";
      const source = isAdminPlaced
        ? `<span style="color:#8A5A0B">Admin</span>${t.generatorLocation ? ` (${t.generatorLocation})` : ""}`
        : `<span style="color:#0B6C86">Player</span>`;

      m.bindPopup(
        `<b>${t.trapTypeId || "trap"}</b> — ${t.status}<br>` +
        `Source: ${source}<br>` +
        `Radius: ${t.radiusMeters}m<br>` +
        `Expires: ${expiry}<br>` +
        `<span style="font-size:11px;color:#5F7491">${t.lat.toFixed(5)}, ${t.lng.toFixed(5)}</span>`
      );
    }

    if (filteredTraps.length > 0) {
      const bounds = L.latLngBounds(filteredTraps.map((t) => [t.lat, t.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traps, tab, trapFilter]);

  // Hide the unused layer when tab changes
  useEffect(() => {
    const L     = window.L;
    const map   = mapRef.current;
    if (!L || !map) return;

    if (tab === "players") {
      trapLayerRef.current?.clearLayers();
      void fetchPlayers();
    } else {
      playerLayerRef.current?.clearLayers();
      void fetchTraps(trapStatus);
    }
    localStorage.setItem(LS_KEY_TAB, tab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Re-fetch when trap status changes
  useEffect(() => {
    if (tab === "traps") void fetchTraps(trapStatus);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trapStatus]);

  // ── Countdown + auto-refresh ─────────────────────────────────────────────

  useEffect(() => {
    setCountdown(intervalSecs);
    const tick = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) { void refresh(); return intervalSecs; }
        return prev - 1;
      });
    }, 1_000);
    return () => clearInterval(tick);
  }, [intervalSecs, refresh]);

  // ── Style helpers ─────────────────────────────────────────────────────────

  const s: Record<string, React.CSSProperties> = {
    chip: {
      padding: "6px 13px", borderRadius: 8, border: "1px solid",
      cursor: "pointer", fontWeight: 600, fontSize: 13,
      transition: "background 0.12s, color 0.12s",
    },
    refreshBtn: {
      padding: "6px 14px", borderRadius: 8,
      background: loading ? "#E6F6FB" : "#0B6C86",
      border: "none", color: "#fff",
      cursor: loading ? "not-allowed" : "pointer",
      fontWeight: 600, fontSize: 13,
    },
    table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
    th: { textAlign: "left" as const, padding: "6px 10px", color: "#5F7491", borderBottom: "1px solid #DCE4EE", fontWeight: 600 },
    td: { padding: "7px 10px", borderBottom: "1px solid #F4F7FB", color: "#26394F" },
    tabBtn: (active: boolean): React.CSSProperties => ({
      padding: "8px 20px", borderRadius: 8, border: "none",
      cursor: "pointer", fontWeight: 700, fontSize: 14,
      background: active ? "#0B6C86" : "#EEF2F7",
      color: active ? "#fff" : "#5F7491",
      transition: "background 0.15s",
    }),
    filterChip: (active: boolean): React.CSSProperties => ({
      padding: "4px 11px", borderRadius: 6, border: "1px solid",
      cursor: "pointer", fontWeight: 600, fontSize: 12,
      borderColor: active ? "#0B6C86" : "#DCE4EE",
      background: active ? "#0B6C86" : "transparent",
      color: active ? "#0B6C86" : "#5F7491",
    }),
    toggle: {
      display: "inline-flex", alignItems: "center", gap: 6,
      cursor: "pointer", fontSize: 13, color: "#3C516C", userSelect: "none" as const,
    },
  };

  // ── Stat counts ───────────────────────────────────────────────────────────

  const activePlayers  = players.filter(isActive).length;
  const adminTraps     = filteredTraps.filter((t) => t.generatedBy === "admin").length;
  const userTraps      = filteredTraps.filter((t) => t.generatedBy !== "admin").length;

  return (
    <div>
      {/* ── Tabs ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button style={s.tabBtn(tab === "players")} onClick={() => setTab("players")}>
          👤 Players
        </button>
        <button style={s.tabBtn(tab === "traps")} onClick={() => setTab("traps")}>
          🪤 Traps
        </button>
      </div>

      {/* ── Controls row ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#5F7491", marginRight: 4, fontWeight: 600 }}>REFRESH</span>
          {INTERVALS.map(({ label, secs }) => {
            const active = intervalSecs === secs;
            return (
              <button key={secs} onClick={() => {
                localStorage.setItem(LS_KEY_INTERVAL, String(secs));
                setIntervalSecs(secs);
                setCountdown(secs);
                void refresh();
              }} style={{
                ...s.chip,
                borderColor: active ? "#0B6C86" : "#DCE4EE",
                background:  active ? "#0B6C86" : "transparent",
                color:       active ? "#fff"    : "#3C516C",
              }}>
                {label}
              </button>
            );
          })}
        </div>

        <button onClick={() => void refresh()} disabled={loading} style={s.refreshBtn}>
          {loading ? "Loading…" : "↻  Refresh now"}
        </button>

        <div style={{ fontSize: 13, color: "#5F7491" }}>
          {lastRefresh && (
            <span style={{ marginRight: 10 }}>
              Last: <b style={{ color: "#3C516C" }}>{lastRefresh.toLocaleTimeString()}</b>
            </span>
          )}
          Next in <span style={{ color: "#8A5A0B", fontWeight: 700 }}>{countdown}s</span>
        </div>

        {/* ── Tab-specific controls ── */}
        {tab === "players" && (
          <>
            <label style={s.toggle}>
              <input
                type="checkbox"
                checked={showRadii}
                onChange={(e) => setShowRadii(e.target.checked)}
                style={{ accentColor: "#0B6C86" }}
              />
              Show detection radii ({DETECTION_RADIUS_M}m)
            </label>
            <div style={{ display: "flex", gap: 14, fontSize: 13, marginLeft: "auto", flexWrap: "wrap" }}>
              <span><span style={{ color: "#178A55", fontSize: 15 }}>●</span> Online kid</span>
              <span><span style={{ color: "#8A5A0B", fontSize: 15 }}>●</span> Offline kid</span>
              <span><span style={{ color: "#0B6C86", fontSize: 15 }}>●</span> Online adult</span>
              <span><span style={{ color: "#6D3FC9", fontSize: 15 }}>●</span> Offline adult</span>
              <b style={{ color: "#0D1F33" }}>{players.length} total</b>
            </div>
          </>
        )}

        {tab === "traps" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginLeft: "auto" }}>
            {/* Status filter */}
            <div style={{ display: "flex", gap: 4 }}>
              {(["active", "captured", "disarmed"] as TrapStatus[]).map((st) => (
                <button key={st} onClick={() => setTrapStatus(st)} style={s.filterChip(trapStatus === st)}>
                  {st.charAt(0).toUpperCase() + st.slice(1)}
                </button>
              ))}
            </div>
            <span style={{ color: "#DCE4EE", fontSize: 16 }}>|</span>
            {/* Source filter */}
            <div style={{ display: "flex", gap: 4 }}>
              {([["all", "All sources"], ["user", "User placed"], ["admin", "Admin placed"]] as [TrapFilter, string][]).map(([f, label]) => (
                <button key={f} onClick={() => setTrapFilter(f)} style={s.filterChip(trapFilter === f)}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 13, marginLeft: 8 }}>
              <span><span style={{ color: "#0B6C86", fontSize: 15 }}>●</span> User</span>
              <span><span style={{ color: "#8A5A0B", fontSize: 15 }}>●</span> Admin</span>
              <span><span style={{ color: "#C8283B", fontSize: 15 }}>●</span> Captured</span>
              <span><span style={{ color: "#5F7491", fontSize: 15 }}>●</span> Disarmed</span>
              <b style={{ color: "#0D1F33" }}>{filteredTraps.length} shown</b>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div style={{ background: "#F5C2C9", color: "#C8283B", padding: "10px 16px", borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* ── Map ── */}
      <div style={{ border: "1px solid #DCE4EE", borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
        <div ref={mapDivRef} style={{ height: 540, width: "100%", background: "#F4F7FB" }} />
      </div>

      {/* ── Players table ── */}
      {tab === "players" && (
        <div style={{ background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 12, padding: "16px 20px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#0D1F33" }}>
            Active Players
            <span style={{ marginLeft: 10, color: "#0B6C86", fontWeight: 700 }}>{players.length} total</span>
            <span style={{ marginLeft: 10, color: "#178A55", fontWeight: 700, fontSize: 13 }}>
              ● {activePlayers} online
            </span>
          </h3>
          <div style={{ overflowX: "auto" }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Username</th>
                  <th style={s.th}>Age group</th>
                  <th style={s.th}>Latitude</th>
                  <th style={s.th}>Longitude</th>
                  <th style={s.th}>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {players
                  .slice()
                  .sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0))
                  .map((p) => {
                    const active   = isActive(p);
                    const color    = markerColor(p);
                    const lastSeen = fmtLastSeen(p.updatedAtMs);
                    return (
                      <tr key={p.uid} style={{ opacity: active ? 1 : 0.6 }}>
                        <td style={s.td}>{p.username}</td>
                        <td style={{ ...s.td, color, fontWeight: 600 }}>
                          <span style={{ marginRight: 6, fontSize: 10 }}>●</span>
                          {p.ageGroup}
                        </td>
                        <td style={{ ...s.td, fontFamily: "monospace" }}>{p.lat.toFixed(5)}</td>
                        <td style={{ ...s.td, fontFamily: "monospace" }}>{p.lng.toFixed(5)}</td>
                        <td style={s.td}>
                          {lastSeen === "Online"
                            ? <span style={{ background: "#178A55", color: "#fff", padding: "2px 10px", borderRadius: 10, fontSize: 12, fontWeight: 700 }}>● Online</span>
                            : <span style={{ color: "#5F7491" }}>{lastSeen}</span>}
                        </td>
                      </tr>
                    );
                  })}
                {players.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} style={{ ...s.td, textAlign: "center", color: "#5F7491", padding: 24 }}>
                      No player locations recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Traps table ── */}
      {tab === "traps" && (
        <div style={{ background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 12, padding: "16px 20px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "#0D1F33" }}>
            {trapStatus.charAt(0).toUpperCase() + trapStatus.slice(1)} Traps
            <span style={{ marginLeft: 10, color: "#0B6C86", fontWeight: 700 }}>{filteredTraps.length} shown</span>
            {trapFilter === "all" && (
              <>
                <span style={{ marginLeft: 12, color: "#8A5A0B", fontSize: 13 }}>● {adminTraps} admin</span>
                <span style={{ marginLeft: 10, color: "#0B6C86", fontSize: 13 }}>● {userTraps} user</span>
              </>
            )}
          </h3>
          <div style={{ overflowX: "auto" }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Type</th>
                  <th style={s.th}>Source</th>
                  <th style={s.th}>Latitude</th>
                  <th style={s.th}>Longitude</th>
                  <th style={s.th}>Radius</th>
                  <th style={s.th}>Expires</th>
                </tr>
              </thead>
              <tbody>
                {filteredTraps.map((t) => {
                  const color       = trapColor(t);
                  const isAdminPlaced = t.generatedBy === "admin";
                  const expiry      = t.expiresAt
                    ? new Date(t.expiresAt.seconds * 1000).toLocaleDateString()
                    : "—";
                  return (
                    <tr key={t.id}>
                      <td style={{ ...s.td, fontFamily: "monospace", fontSize: 12 }}>{t.trapTypeId || "—"}</td>
                      <td style={{ ...s.td, color, fontWeight: 600 }}>
                        <span style={{ marginRight: 5, fontSize: 10 }}>●</span>
                        {isAdminPlaced
                          ? `Admin${t.generatorLocation ? ` · ${t.generatorLocation}` : ""}`
                          : "User"}
                      </td>
                      <td style={{ ...s.td, fontFamily: "monospace" }}>{t.lat.toFixed(5)}</td>
                      <td style={{ ...s.td, fontFamily: "monospace" }}>{t.lng.toFixed(5)}</td>
                      <td style={{ ...s.td, color: "#3C516C" }}>{t.radiusMeters}m</td>
                      <td style={{ ...s.td, color: "#5F7491" }}>{expiry}</td>
                    </tr>
                  );
                })}
                {filteredTraps.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} style={{ ...s.td, textAlign: "center", color: "#5F7491", padding: 24 }}>
                      No {trapStatus} traps found{trapFilter !== "all" ? ` (${trapFilter} filter)` : ""}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
