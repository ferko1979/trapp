import { httpsCallable } from "firebase/functions";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { functions } from "../firebase";

type RankedUserRow = {
  uid: string;
  username?: string | null;
  displayName?: string | null;
  email?: string | null;
  role?: string | null;
  status?: string | null;
  levelId?: string | null;

  placedTrapCount?: number;
  activeTrapCount?: number;
  capturedTrapCount?: number;
  disarmedTrapCount?: number;

  captureCount?: number;
  capturePoints?: number;

  enemyCaptures?: number;
  selfCaptures?: number;
  allyCaptures?: number;

  timesCaughtTotal?: number;
  timesCaughtByEnemy?: number;
  timesCaughtBySelf?: number;
  timesCaughtByAlly?: number;

  averagePointsPerCapture?: number;
  combinedScore?: number;

  rankByPlaced?: number | null;
  rankByCaptureCount?: number | null;
  rankByCapturePoints?: number | null;
  rankByCombinedScore?: number | null;
};

type ResultsResponse = {
  ok?: boolean;
  sortBy?: string;
  totalUsers?: number;
  generatedAtEpochMs?: number;
  items?: RankedUserRow[];
};

type SortBy = "placed" | "captures" | "points" | "combined";

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

function numberValue(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export default function TrapResultsPanel() {
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  const [sortBy, setSortBy] = useState<SortBy>("points");
  const [limit, setLimit] = useState("100");
  const [includeInactive, setIncludeInactive] = useState(true);

  const [data, setData] = useState<ResultsResponse | null>(null);

  async function loadResults() {
    setLoading(true);
    try {
      const fn = httpsCallable<
        { sortBy: SortBy; limit?: number; includeInactive?: boolean },
        ResultsResponse
      >(functions, "adminGetTrapResultsLeaderboard");

      const parsedLimit = Number(limit);

      const res = await fn({
        sortBy,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : 100,
        includeInactive,
      });

      setData(res.data);
      setResult(JSON.stringify(res.data, null, 2));
    } catch (error: any) {
      setResult(
        JSON.stringify(
          {
            message: error?.message ?? "Could not load trap results leaderboard.",
            code: error?.code ?? null,
            details: error?.details ?? null,
          },
          null,
          2
        )
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadResults();
  }, []);

  const rows = useMemo(() => data?.items ?? [], [data]);

  const topByPlaced = useMemo(
    () =>
      [...rows]
        .sort(
          (a, b) =>
            numberValue(b.placedTrapCount) - numberValue(a.placedTrapCount) ||
            numberValue(b.capturePoints) - numberValue(a.capturePoints)
        )
        .slice(0, 10),
    [rows]
  );

  const topByCaptures = useMemo(
    () =>
      [...rows]
        .sort(
          (a, b) =>
            numberValue(b.captureCount) - numberValue(a.captureCount) ||
            numberValue(b.capturePoints) - numberValue(a.capturePoints)
        )
        .slice(0, 10),
    [rows]
  );

  const topByPoints = useMemo(
    () =>
      [...rows]
        .sort(
          (a, b) =>
            numberValue(b.capturePoints) - numberValue(a.capturePoints) ||
            numberValue(b.captureCount) - numberValue(a.captureCount)
        )
        .slice(0, 10),
    [rows]
  );

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
          <h2 style={{ margin: 0 }}>Results & Rankings</h2>
          <button onClick={() => void loadResults()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh leaderboard"}
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            marginBottom: 16,
          }}
        >
          <div>
            <label style={fieldLabelStyle()}>Sort by</label>
            <select
              style={inputStyle()}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
            >
              <option value="points">Weighted capture points</option>
              <option value="captures">Capture count</option>
              <option value="placed">Placed traps</option>
              <option value="combined">Combined score</option>
            </select>
          </div>

          <div>
            <label style={fieldLabelStyle()}>Limit</label>
            <input
              style={inputStyle()}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="100"
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "end",
            }}
          >
            <label
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "10px 12px",
                width: "100%",
                minHeight: 42,
                boxSizing: "border-box",
              }}
            >
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              <span>Include inactive users</span>
            </label>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          <StatCard label="Users ranked" value={data?.totalUsers} />
          <StatCard label="Sort mode" value={data?.sortBy ?? "-"} />
          <StatCard
            label="Generated"
            value={formatEpochMs(data?.generatedAtEpochMs)}
          />
        </div>
      </div>

      <div style={sectionCardStyle()}>
        <h3 style={{ marginTop: 0 }}>Top 10 — Most Placed Traps</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {topByPlaced.map((row) => (
            <div
              key={`placed-${row.uid}`}
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 10,
                padding: 12,
              }}
            >
              <div>
                <strong>#{row.rankByPlaced ?? "-"}</strong> —{" "}
                {row.displayName ?? row.username ?? row.uid}
              </div>
              <div style={{ marginTop: 4, opacity: 0.9 }}>
                Placed: {row.placedTrapCount ?? 0} | Active: {row.activeTrapCount ?? 0} |
                Captured traps: {row.capturedTrapCount ?? 0} | Disarmed traps:{" "}
                {row.disarmedTrapCount ?? 0}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={sectionCardStyle()}>
        <h3 style={{ marginTop: 0 }}>Top 10 — Most Captures</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {topByCaptures.map((row) => (
            <div
              key={`captures-${row.uid}`}
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 10,
                padding: 12,
              }}
            >
              <div>
                <strong>#{row.rankByCaptureCount ?? "-"}</strong> —{" "}
                {row.displayName ?? row.username ?? row.uid}
              </div>
              <div style={{ marginTop: 4, opacity: 0.9 }}>
                Captures: {row.captureCount ?? 0} | Enemy: {row.enemyCaptures ?? 0} |
                Self: {row.selfCaptures ?? 0} | Ally: {row.allyCaptures ?? 0}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={sectionCardStyle()}>
        <h3 style={{ marginTop: 0 }}>Top 10 — Highest Weighted Capture Points</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {topByPoints.map((row) => (
            <div
              key={`points-${row.uid}`}
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 10,
                padding: 12,
              }}
            >
              <div>
                <strong>#{row.rankByCapturePoints ?? "-"}</strong> —{" "}
                {row.displayName ?? row.username ?? row.uid}
              </div>
              <div style={{ marginTop: 4, opacity: 0.9 }}>
                Points: {row.capturePoints ?? 0} | Captures: {row.captureCount ?? 0} |
                Avg points/capture: {row.averagePointsPerCapture ?? 0}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={sectionCardStyle()}>
        <h3 style={{ marginTop: 0 }}>Full Ranking Table</h3>

        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 1200,
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #334155" }}>
                <th style={{ padding: "10px 8px" }}>User</th>
                <th style={{ padding: "10px 8px" }}>Placed Rank</th>
                <th style={{ padding: "10px 8px" }}>Placed</th>
                <th style={{ padding: "10px 8px" }}>Capture Rank</th>
                <th style={{ padding: "10px 8px" }}>Captures</th>
                <th style={{ padding: "10px 8px" }}>Points Rank</th>
                <th style={{ padding: "10px 8px" }}>Points</th>
                <th style={{ padding: "10px 8px" }}>Combined Rank</th>
                <th style={{ padding: "10px 8px" }}>Combined</th>
                <th style={{ padding: "10px 8px" }}>Enemy</th>
                <th style={{ padding: "10px 8px" }}>Self</th>
                <th style={{ padding: "10px 8px" }}>Ally</th>
                <th style={{ padding: "10px 8px" }}>Caught Total</th>
                <th style={{ padding: "10px 8px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.uid}
                  style={{ borderBottom: "1px solid #233043" }}
                >
                  <td style={{ padding: "10px 8px" }}>
                    <div style={{ fontWeight: 700 }}>
                      {row.displayName ?? row.username ?? row.uid}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      {row.username ? `@${row.username}` : row.uid}
                    </div>
                  </td>
                  <td style={{ padding: "10px 8px" }}>{row.rankByPlaced ?? "-"}</td>
                  <td style={{ padding: "10px 8px" }}>{row.placedTrapCount ?? 0}</td>
                  <td style={{ padding: "10px 8px" }}>{row.rankByCaptureCount ?? "-"}</td>
                  <td style={{ padding: "10px 8px" }}>{row.captureCount ?? 0}</td>
                  <td style={{ padding: "10px 8px" }}>{row.rankByCapturePoints ?? "-"}</td>
                  <td style={{ padding: "10px 8px" }}>{row.capturePoints ?? 0}</td>
                  <td style={{ padding: "10px 8px" }}>{row.rankByCombinedScore ?? "-"}</td>
                  <td style={{ padding: "10px 8px" }}>{row.combinedScore ?? 0}</td>
                  <td style={{ padding: "10px 8px" }}>{row.enemyCaptures ?? 0}</td>
                  <td style={{ padding: "10px 8px" }}>{row.selfCaptures ?? 0}</td>
                  <td style={{ padding: "10px 8px" }}>{row.allyCaptures ?? 0}</td>
                  <td style={{ padding: "10px 8px" }}>{row.timesCaughtTotal ?? 0}</td>
                  <td style={{ padding: "10px 8px" }}>{row.status ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <pre style={{ whiteSpace: "pre-wrap" }}>{result}</pre>
    </section>
  );
}