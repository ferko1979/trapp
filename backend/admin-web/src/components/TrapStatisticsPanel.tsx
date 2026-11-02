import { httpsCallable } from "firebase/functions";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { functions } from "../firebase";

type TrapCountsByType = Record<string, number>;

type TrapItem = {
  id: string;
  ownerUid?: string;
  ownerPrimaryAllyGroupId?: string | null;
  ownerScope?: string | null;
  trapTypeId?: string;
  iconKey?: string | null;
  status?: string;
  lat?: number;
  lng?: number;
  dateKey?: string | null;
  createdAtEpochMs?: number | null;
  capturedAtEpochMs?: number | null;
  disarmedAtEpochMs?: number | null;
  capturedUserId?: string | null;
  capturedUsername?: string | null;
  captureDistanceMeters?: number | null;
  disarmedBy?: string | null;
  effectKind?: string | null;
  effectValue?: number | null;
};

type CaptureItem = {
  id: string;
  trapId?: string;
  ownerUid?: string;
  ownerUsername?: string | null;
  ownerPrimaryAllyGroupId?: string | null;
  ownerScope?: string | null;
  capturedUserId?: string;
  capturedUsername?: string | null;
  capturedPrimaryAllyGroupId?: string | null;
  trapTypeId?: string;
  iconKey?: string | null;
  effectKind?: string | null;
  effectValue?: number | null;
  captureDistanceMeters?: number | null;
  dateKey?: string | null;
  capturedAtEpochMs?: number | null;
  captureType?: "enemy" | "self" | "ally" | string;
  scoringCapture?: boolean;
  isSelfTrigger?: boolean;
  isAllyTrigger?: boolean;
};

type TrapSummary = {
  total?: number;
  active?: number;
  captured?: number;
  disarmed?: number;
  otherStatuses?: Record<string, number>;
  byType?: TrapCountsByType;
};

type SourceBucket = {
  total: number;
  active: number;
  captured: number;
  disarmed: number;
  byType?: TrapCountsByType;
  byLocation?: Record<string, number>;
};

type SourceSummary = {
  system: SourceBucket;
  user: SourceBucket;
};

type CaptureSummary = {
  total?: number;
  scoringCaptures?: number;
  enemy?: number;
  self?: number;
  ally?: number;
  byTrapType?: TrapCountsByType;
};

type OverviewResponse = {
  ok?: boolean;
  trapsSummary?: TrapSummary;
  sourceSummary?: SourceSummary;
  capturesSummary?: CaptureSummary;
  recentTraps?: TrapItem[];
  recentCaptures?: CaptureItem[];
};

type SearchResponse = {
  ok?: boolean;
  scope?: string;
  traps?: TrapItem[];
  captures?: CaptureItem[];
  trapsSummary?: TrapSummary;
  capturesSummary?: CaptureSummary;
};

type UserStatsResponse = {
  ok?: boolean;
  uid?: string;
  placedTrapsSummary?: TrapSummary;
  capturesAsOwnerSummary?: CaptureSummary;
  capturesAsVictimSummary?: CaptureSummary;
  recentPlacedTraps?: TrapItem[];
  recentCapturesAsOwner?: CaptureItem[];
  recentCapturesAsVictim?: CaptureItem[];
};

function sectionCardStyle(): CSSProperties {
  return {
    background: "#1e293b",
    padding: 20,
    borderRadius: 12,
    border: "1px solid #334155",
  };
}

function inputStyle(): CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #475569",
    background: "#0f172a",
    color: "white",
    boxSizing: "border-box",
  };
}

function fieldLabelStyle(): CSSProperties {
  return {
    fontSize: 12,
    opacity: 0.9,
    marginBottom: 4,
    display: "block",
  };
}

function statCardStyle(): CSSProperties {
  return {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 10,
    padding: 14,
  };
}

function formatEpochMs(value?: number | null) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "-";
  }
}

function renderCountsMap(map?: TrapCountsByType | null) {
  if (!map || Object.keys(map).length === 0) return "-";
  return Object.entries(map)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}: ${value}`)
    .join(" | ");
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div style={statCardStyle()}>
      <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value ?? "-"}</div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: "#07111e", borderRadius: 8, padding: "8px 10px", border: "1px solid #1e293b" }}>
      <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function SourceBar({ active, captured, disarmed, total }: { active: number; captured: number; disarmed: number; total: number }) {
  const pctA = total > 0 ? (active   / total) * 100 : 0;
  const pctC = total > 0 ? (captured / total) * 100 : 0;
  const pctD = total > 0 ? (disarmed / total) * 100 : 0;
  return (
    <div style={{ height: 8, background: "#1e293b", borderRadius: 4, overflow: "hidden", display: "flex" }}>
      <div style={{ width: `${pctA}%`, background: "#22c55e" }} title={`Active ${active}`} />
      <div style={{ width: `${pctC}%`, background: "#f59e0b" }} title={`Captured ${captured}`} />
      <div style={{ width: `${pctD}%`, background: "#64748b" }} title={`Disarmed ${disarmed}`} />
    </div>
  );
}

export default function TrapStatisticsPanel() {
  const [result, setResult] = useState("");
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingUserStats, setLoadingUserStats] = useState(false);

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [searchData, setSearchData] = useState<SearchResponse | null>(null);
  const [userStats, setUserStats] = useState<UserStatsResponse | null>(null);

  const [scope, setScope] = useState("all");
  const [ownerUid, setOwnerUid] = useState("");
  const [capturedUserId, setCapturedUserId] = useState("");
  const [trapStatus, setTrapStatus] = useState("");
  const [captureType, setCaptureType] = useState("");
  const [limit, setLimit] = useState("200");

  const [userStatsUid, setUserStatsUid] = useState("");

  async function loadOverview() {
    setLoadingOverview(true);
    try {
      const fn = httpsCallable<unknown, OverviewResponse>(
        functions,
        "adminGetTrapStatisticsOverview"
      );
      const res = await fn({});
      setOverview(res.data);
      setResult(JSON.stringify(res.data, null, 2));
    } catch (error: any) {
      setResult(
        JSON.stringify(
          {
            message: error?.message ?? "Could not load overview.",
            code: error?.code ?? null,
            details: error?.details ?? null,
          },
          null,
          2
        )
      );
    } finally {
      setLoadingOverview(false);
    }
  }

  async function runSearch() {
    setLoadingSearch(true);
    try {
      const fn = httpsCallable<
        {
          scope: string;
          ownerUid?: string;
          capturedUserId?: string;
          trapStatus?: string;
          captureType?: string;
          limit?: number;
        },
        SearchResponse
      >(functions, "adminSearchTrapRecords");

      const parsedLimit = Number(limit);

      const res = await fn({
        scope,
        ownerUid: ownerUid.trim() || undefined,
        capturedUserId: capturedUserId.trim() || undefined,
        trapStatus: trapStatus.trim() || undefined,
        captureType: captureType.trim() || undefined,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : 200,
      });

      setSearchData(res.data);
      setResult(JSON.stringify(res.data, null, 2));
    } catch (error: any) {
      setResult(
        JSON.stringify(
          {
            message: error?.message ?? "Could not search trap records.",
            code: error?.code ?? null,
            details: error?.details ?? null,
          },
          null,
          2
        )
      );
    } finally {
      setLoadingSearch(false);
    }
  }

  async function loadUserStats() {
    if (!userStatsUid.trim()) {
      setResult("User UID is required.");
      return;
    }

    setLoadingUserStats(true);
    try {
      const fn = httpsCallable<{ uid: string }, UserStatsResponse>(
        functions,
        "adminGetUserTrapStatistics"
      );

      const res = await fn({ uid: userStatsUid.trim() });
      setUserStats(res.data);
      setResult(JSON.stringify(res.data, null, 2));
    } catch (error: any) {
      setResult(
        JSON.stringify(
          {
            message: error?.message ?? "Could not load user trap statistics.",
            code: error?.code ?? null,
            details: error?.details ?? null,
          },
          null,
          2
        )
      );
    } finally {
      setLoadingUserStats(false);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  const overviewTrapSummary = useMemo(() => overview?.trapsSummary ?? {}, [overview]);
  const overviewCaptureSummary = useMemo(() => overview?.capturesSummary ?? {}, [overview]);
  const sourceSummary = useMemo(() => overview?.sourceSummary ?? null, [overview]);

  return (
    <section style={{ display: "grid", gap: 20 }}>
      <div style={sectionCardStyle()}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0 }}>Trap Statistics</h2>
          <button onClick={() => void loadOverview()} disabled={loadingOverview}>
            {loadingOverview ? "Refreshing..." : "Refresh overview"}
          </button>
        </div>

        <div style={{ display: "grid", gap: 16 }}>

          {/* ── Source breakdown: User vs System ── */}
          {sourceSummary && (
            <div>
              <h3 style={{ marginTop: 0 }}>Trap Source Breakdown</h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                  marginBottom: 12,
                }}
              >
                {/* System-generated */}
                <div
                  style={{
                    background: "#0f172a",
                    border: "2px solid #1d4ed8",
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    <span style={{ fontSize: 20 }}>🤖</span>
                    <span style={{ fontWeight: 700, fontSize: "1rem", color: "#93c5fd" }}>
                      System-Generated
                    </span>
                    <span
                      style={{
                        marginLeft: "auto",
                        background: "#1d4ed8",
                        color: "#fff",
                        borderRadius: 999,
                        padding: "2px 10px",
                        fontSize: "0.8rem",
                        fontWeight: 700,
                      }}
                    >
                      {sourceSummary.system.total}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, 1fr)",
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    <MiniStat label="Active"    value={sourceSummary.system.active}   color="#22c55e" />
                    <MiniStat label="Captured"  value={sourceSummary.system.captured} color="#f59e0b" />
                    <MiniStat label="Disarmed"  value={sourceSummary.system.disarmed} color="#94a3b8" />
                  </div>
                  {sourceSummary.system.total > 0 && (
                    <SourceBar
                      active={sourceSummary.system.active}
                      captured={sourceSummary.system.captured}
                      disarmed={sourceSummary.system.disarmed}
                      total={sourceSummary.system.total}
                    />
                  )}
                  {sourceSummary.system.byLocation &&
                    Object.keys(sourceSummary.system.byLocation).length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          By location
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {Object.entries(sourceSummary.system.byLocation)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 10)
                            .map(([loc, n]) => (
                              <span
                                key={loc}
                                style={{
                                  background: "#1e3a5f",
                                  color: "#93c5fd",
                                  borderRadius: 6,
                                  padding: "2px 8px",
                                  fontSize: "0.75rem",
                                  fontWeight: 600,
                                }}
                              >
                                {loc}: {n}
                              </span>
                            ))}
                        </div>
                      </div>
                    )}
                </div>

                {/* User-placed */}
                <div
                  style={{
                    background: "#0f172a",
                    border: "2px solid #059669",
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    <span style={{ fontSize: 20 }}>👤</span>
                    <span style={{ fontWeight: 700, fontSize: "1rem", color: "#6ee7b7" }}>
                      User-Placed
                    </span>
                    <span
                      style={{
                        marginLeft: "auto",
                        background: "#059669",
                        color: "#fff",
                        borderRadius: 999,
                        padding: "2px 10px",
                        fontSize: "0.8rem",
                        fontWeight: 700,
                      }}
                    >
                      {sourceSummary.user.total}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, 1fr)",
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    <MiniStat label="Active"    value={sourceSummary.user.active}   color="#22c55e" />
                    <MiniStat label="Captured"  value={sourceSummary.user.captured} color="#f59e0b" />
                    <MiniStat label="Disarmed"  value={sourceSummary.user.disarmed} color="#94a3b8" />
                  </div>
                  {sourceSummary.user.total > 0 && (
                    <SourceBar
                      active={sourceSummary.user.active}
                      captured={sourceSummary.user.captured}
                      disarmed={sourceSummary.user.disarmed}
                      total={sourceSummary.user.total}
                    />
                  )}
                  {sourceSummary.user.byType &&
                    Object.keys(sourceSummary.user.byType).length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Top trap types
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {Object.entries(sourceSummary.user.byType)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 6)
                            .map(([type, n]) => (
                              <span
                                key={type}
                                style={{
                                  background: "#064e3b",
                                  color: "#6ee7b7",
                                  borderRadius: 6,
                                  padding: "2px 8px",
                                  fontSize: "0.75rem",
                                  fontWeight: 600,
                                }}
                              >
                                {type}: {n}
                              </span>
                            ))}
                        </div>
                      </div>
                    )}
                </div>
              </div>

              {/* Combined ratio bar */}
              {(sourceSummary.system.total + sourceSummary.user.total) > 0 && (
                <div>
                  <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    System vs User ratio
                  </div>
                  <div style={{ height: 12, background: "#1e293b", borderRadius: 6, overflow: "hidden", display: "flex" }}>
                    {(() => {
                      const total = sourceSummary.system.total + sourceSummary.user.total;
                      const sysPct = total > 0 ? (sourceSummary.system.total / total) * 100 : 0;
                      return (
                        <>
                          <div style={{ width: `${sysPct}%`, background: "#1d4ed8", transition: "width 0.4s" }} />
                          <div style={{ flex: 1, background: "#059669" }} />
                        </>
                      );
                    })()}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: "0.78rem", opacity: 0.7 }}>
                    <span>🤖 {sourceSummary.system.total} system ({Math.round((sourceSummary.system.total / (sourceSummary.system.total + sourceSummary.user.total)) * 100)}%)</span>
                    <span>👤 {sourceSummary.user.total} user ({Math.round((sourceSummary.user.total / (sourceSummary.system.total + sourceSummary.user.total)) * 100)}%)</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <h3 style={{ marginTop: 0 }}>Placed Traps Overview</h3>
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              }}
            >
              <StatCard label="Total placed traps" value={overviewTrapSummary.total} />
              <StatCard label="Active now" value={overviewTrapSummary.active} />
              <StatCard label="Captured traps" value={overviewTrapSummary.captured} />
              <StatCard label="Disarmed traps" value={overviewTrapSummary.disarmed} />
            </div>

            <div style={{ marginTop: 12 }}>
              <strong>Placed by type:</strong>
              <div style={{ marginTop: 6 }}>
                {renderCountsMap(overviewTrapSummary.byType)}
              </div>
            </div>
          </div>

          <div>
            <h3 style={{ marginTop: 0 }}>Capture Overview</h3>
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              }}
            >
              <StatCard label="Total captures" value={overviewCaptureSummary.total} />
              <StatCard
                label="Scoring captures"
                value={overviewCaptureSummary.scoringCaptures}
              />
              <StatCard label="Enemy captures" value={overviewCaptureSummary.enemy} />
              <StatCard label="Self captures" value={overviewCaptureSummary.self} />
              <StatCard label="Ally captures" value={overviewCaptureSummary.ally} />
            </div>

            <div style={{ marginTop: 12 }}>
              <strong>Captures by trap type:</strong>
              <div style={{ marginTop: 6 }}>
                {renderCountsMap(overviewCaptureSummary.byTrapType)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={sectionCardStyle()}>
        <h2 style={{ marginTop: 0 }}>Search Trap Records</h2>

        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            marginBottom: 14,
          }}
        >
          <div>
            <label style={fieldLabelStyle()}>Scope</label>
            <select style={inputStyle()} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">all</option>
              <option value="mine">mine</option>
              <option value="allies">allies</option>
              <option value="individual">individual</option>
            </select>
          </div>

          <div>
            <label style={fieldLabelStyle()}>Owner UID</label>
            <input
              style={inputStyle()}
              value={ownerUid}
              onChange={(e) => setOwnerUid(e.target.value)}
              placeholder="Filter by trap owner uid"
            />
          </div>

          <div>
            <label style={fieldLabelStyle()}>Captured User UID</label>
            <input
              style={inputStyle()}
              value={capturedUserId}
              onChange={(e) => setCapturedUserId(e.target.value)}
              placeholder="Filter by captured uid"
            />
          </div>

          <div>
            <label style={fieldLabelStyle()}>Trap Status</label>
            <select
              style={inputStyle()}
              value={trapStatus}
              onChange={(e) => setTrapStatus(e.target.value)}
            >
              <option value="">all</option>
              <option value="active">active</option>
              <option value="captured">captured</option>
              <option value="disarmed">disarmed</option>
            </select>
          </div>

          <div>
            <label style={fieldLabelStyle()}>Capture Type</label>
            <select
              style={inputStyle()}
              value={captureType}
              onChange={(e) => setCaptureType(e.target.value)}
            >
              <option value="">all</option>
              <option value="enemy">enemy</option>
              <option value="self">self</option>
              <option value="ally">ally</option>
            </select>
          </div>

          <div>
            <label style={fieldLabelStyle()}>Limit</label>
            <input
              style={inputStyle()}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="200"
            />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <button onClick={() => void runSearch()} disabled={loadingSearch}>
            {loadingSearch ? "Searching..." : "Search records"}
          </button>
        </div>

        {searchData ? (
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <h3 style={{ marginTop: 0 }}>Search Summary</h3>
              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                }}
              >
                <StatCard label="Matched traps" value={searchData.trapsSummary?.total} />
                <StatCard label="Matched captures" value={searchData.capturesSummary?.total} />
                <StatCard label="Enemy captures" value={searchData.capturesSummary?.enemy} />
                <StatCard label="Self captures" value={searchData.capturesSummary?.self} />
                <StatCard label="Ally captures" value={searchData.capturesSummary?.ally} />
              </div>
            </div>

            <div>
              <h3 style={{ marginTop: 0 }}>Placed Traps</h3>
              <div style={{ display: "grid", gap: 10 }}>
                {(searchData.traps ?? []).slice(0, 50).map((trap) => (
                  <div
                    key={trap.id}
                    style={{
                      background: "#0f172a",
                      border: "1px solid #334155",
                      borderRadius: 10,
                      padding: 12,
                    }}
                  >
                    <div>
                      <strong>{trap.trapTypeId ?? "unknown"}</strong> — {trap.status ?? "-"}
                    </div>
                    <div style={{ marginTop: 4, opacity: 0.9 }}>
                      Owner: {trap.ownerUid ?? "-"} | Scope: {trap.ownerScope ?? "-"} | Date key:{" "}
                      {trap.dateKey ?? "-"}
                    </div>
                    <div style={{ marginTop: 4, opacity: 0.9 }}>
                      Created: {formatEpochMs(trap.createdAtEpochMs)} | Captured:{" "}
                      {formatEpochMs(trap.capturedAtEpochMs)} | Disarmed:{" "}
                      {formatEpochMs(trap.disarmedAtEpochMs)}
                    </div>
                    <div style={{ marginTop: 4, opacity: 0.9 }}>
                      Captured user: {trap.capturedUserId ?? "-"} | Disarmed by:{" "}
                      {trap.disarmedBy ?? "-"}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 style={{ marginTop: 0 }}>Captures</h3>
              <div style={{ display: "grid", gap: 10 }}>
                {(searchData.captures ?? []).slice(0, 50).map((capture) => (
                  <div
                    key={capture.id}
                    style={{
                      background: "#0f172a",
                      border: "1px solid #334155",
                      borderRadius: 10,
                      padding: 12,
                    }}
                  >
                    <div>
                      <strong>{capture.trapTypeId ?? "unknown"}</strong> — {capture.captureType}
                    </div>
                    <div style={{ marginTop: 4, opacity: 0.9 }}>
                      Owner: {capture.ownerUid ?? "-"} | Victim: {capture.capturedUserId ?? "-"}
                    </div>
                    <div style={{ marginTop: 4, opacity: 0.9 }}>
                      Scope: {capture.ownerScope ?? "-"} | Scoring:{" "}
                      {capture.scoringCapture ? "yes" : "no"} | Distance:{" "}
                      {capture.captureDistanceMeters ?? "-"} m
                    </div>
                    <div style={{ marginTop: 4, opacity: 0.9 }}>
                      Captured at: {formatEpochMs(capture.capturedAtEpochMs)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div style={sectionCardStyle()}>
        <h2 style={{ marginTop: 0 }}>User Trap Statistics</h2>

        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "minmax(260px, 1fr) auto",
            alignItems: "end",
            marginBottom: 14,
          }}
        >
          <div>
            <label style={fieldLabelStyle()}>User UID</label>
            <input
              style={inputStyle()}
              value={userStatsUid}
              onChange={(e) => setUserStatsUid(e.target.value)}
              placeholder="Enter a user uid"
            />
          </div>

          <div>
            <button onClick={() => void loadUserStats()} disabled={loadingUserStats}>
              {loadingUserStats ? "Loading..." : "Load user statistics"}
            </button>
          </div>
        </div>

        {userStats ? (
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <h3 style={{ marginTop: 0 }}>Placed Traps</h3>
              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                }}
              >
                <StatCard label="Total placed" value={userStats.placedTrapsSummary?.total} />
                <StatCard label="Active" value={userStats.placedTrapsSummary?.active} />
                <StatCard label="Captured" value={userStats.placedTrapsSummary?.captured} />
                <StatCard label="Disarmed" value={userStats.placedTrapsSummary?.disarmed} />
              </div>
              <div style={{ marginTop: 10 }}>
                <strong>Placed by type:</strong>
                <div style={{ marginTop: 6 }}>
                  {renderCountsMap(userStats.placedTrapsSummary?.byType)}
                </div>
              </div>
            </div>

            <div>
              <h3 style={{ marginTop: 0 }}>Captures As Owner</h3>
              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                }}
              >
                <StatCard label="Total" value={userStats.capturesAsOwnerSummary?.total} />
                <StatCard label="Enemy" value={userStats.capturesAsOwnerSummary?.enemy} />
                <StatCard label="Self" value={userStats.capturesAsOwnerSummary?.self} />
                <StatCard label="Ally" value={userStats.capturesAsOwnerSummary?.ally} />
                <StatCard
                  label="Scoring"
                  value={userStats.capturesAsOwnerSummary?.scoringCaptures}
                />
              </div>
            </div>

            <div>
              <h3 style={{ marginTop: 0 }}>Captures As Victim</h3>
              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                }}
              >
                <StatCard label="Total" value={userStats.capturesAsVictimSummary?.total} />
                <StatCard label="Enemy" value={userStats.capturesAsVictimSummary?.enemy} />
                <StatCard label="Self" value={userStats.capturesAsVictimSummary?.self} />
                <StatCard label="Ally" value={userStats.capturesAsVictimSummary?.ally} />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <pre style={{ whiteSpace: "pre-wrap" }}>{result}</pre>
    </section>
  );
}