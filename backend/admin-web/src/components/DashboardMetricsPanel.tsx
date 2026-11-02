import { httpsCallable } from "firebase/functions";
import { useEffect, useMemo, useState } from "react";
import { functions } from "../firebase";

type Point = {
  date: string;
  value: number;
};

type DashboardMetricsResponse = {
  ok?: boolean;
  usersPerDay?: Point[];
  paymentsPerDay?: Point[];
  levelChangesPerDay?: Point[];
  trapsPlacedPerDay?: Point[];
  trapsCapturedPerDay?: Point[];
  trapsRevealedPerDay?: Point[];
  trapsDisarmedPerDay?: Point[];
};

function formatValue(value: number) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

function GraphCard({
  title,
  data,
  valueLabel,
}: {
  title: string;
  data: Point[];
  valueLabel: string;
}) {
  const width = 720;
  const height = 260;
  const paddingTop = 20;
  const paddingRight = 20;
  const paddingBottom = 70;
  const paddingLeft = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const maxValue = Math.max(1, ...data.map((d) => d.value));
  const barGap = 8;
  const barWidth =
    data.length > 0
      ? Math.max(8, (chartWidth - barGap * (data.length - 1)) / data.length)
      : 20;

  const totalValue = useMemo(
    () => data.reduce((sum, item) => sum + item.value, 0),
    [data]
  );

  return (
    <div
      style={{
        background: "#EEF2F7",
        padding: 20,
        borderRadius: 12,
        border: "1px solid #DCE4EE",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <div style={{ fontSize: 12, opacity: 0.75 }}>{valueLabel}</div>
        </div>

        <div style={{ fontSize: 14, fontWeight: 700 }}>
          Total: {formatValue(totalValue)}
        </div>
      </div>

      <div
        style={{
          width: "100%",
          overflowX: "auto",
          background: "#F4F7FB",
          borderRadius: 10,
          padding: 10,
        }}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={title}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, index) => {
            const y = paddingTop + chartHeight - chartHeight * ratio;
            const label = Math.round(maxValue * ratio);

            return (
              <g key={index}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={width - paddingRight}
                  y2={y}
                  stroke="#DCE4EE"
                  strokeWidth="1"
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="#3C516C"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {data.map((item, index) => {
            const x = paddingLeft + index * (barWidth + barGap);
            const barHeight = (item.value / maxValue) * chartHeight;
            const y = paddingTop + chartHeight - barHeight;
            const shortDate = item.date.slice(5);
            const showDateLabel = index % 3 === 0 || index === data.length - 1;
            const labelX = x + barWidth / 2;
            const labelY = height - 16;

            return (
              <g key={item.date}>
                <title>
                  {item.date}: {formatValue(item.value)}
                </title>

                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx={4}
                  ry={4}
                  fill="#178A55"
                />

                {showDateLabel ? (
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor="end"
                    fontSize="10"
                    fill="#26394F"
                    transform={`rotate(-35 ${labelX} ${labelY})`}
                  >
                    {shortDate}
                  </text>
                ) : null}
              </g>
            );
          })}

          <line
            x1={paddingLeft}
            y1={paddingTop + chartHeight}
            x2={width - paddingRight}
            y2={paddingTop + chartHeight}
            stroke="#5F7491"
            strokeWidth="1.5"
          />
        </svg>
      </div>

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gap: 6,
          fontSize: 12,
          opacity: 0.85,
        }}
      >
        <div>Highest day: {formatValue(maxValue)}</div>
        <div>Days shown: {data.length}</div>
      </div>
    </div>
  );
}

export default function DashboardMetricsPanel() {
  const [usersPerDay, setUsersPerDay] = useState<Point[]>([]);
  const [paymentsPerDay, setPaymentsPerDay] = useState<Point[]>([]);
  const [levelChangesPerDay, setLevelChangesPerDay] = useState<Point[]>([]);
  const [trapsPlacedPerDay, setTrapsPlacedPerDay] = useState<Point[]>([]);
  const [trapsCapturedPerDay, setTrapsCapturedPerDay] = useState<Point[]>([]);
  const [trapsRevealedPerDay, setTrapsRevealedPerDay] = useState<Point[]>([]);
  const [trapsDisarmedPerDay, setTrapsDisarmedPerDay] = useState<Point[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setError("");
        const fn = httpsCallable<unknown, DashboardMetricsResponse>(
          functions,
          "adminDashboardMetrics"
        );
        const res = await fn();

        setUsersPerDay(res.data.usersPerDay ?? []);
        setPaymentsPerDay(res.data.paymentsPerDay ?? []);
        setLevelChangesPerDay(res.data.levelChangesPerDay ?? []);
        setTrapsPlacedPerDay(res.data.trapsPlacedPerDay ?? []);
        setTrapsCapturedPerDay(res.data.trapsCapturedPerDay ?? []);
        setTrapsRevealedPerDay(res.data.trapsRevealedPerDay ?? []);
        setTrapsDisarmedPerDay(res.data.trapsDisarmedPerDay ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load dashboard metrics.");
      }
    }

    void load();
  }, []);

  if (error) {
    return (
      <div
        style={{
          background: "#EEF2F7",
          padding: 20,
          borderRadius: 12,
          border: "1px solid #DCE4EE",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Dashboard Metrics</h3>
        <div style={{ color: "#C8283B" }}>{error}</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <GraphCard
        title="Users per day"
        data={usersPerDay}
        valueLabel="Daily new users"
      />
      <GraphCard
        title="Payments per day"
        data={paymentsPerDay}
        valueLabel="Daily payment total"
      />
      <GraphCard
        title="Level changes per day"
        data={levelChangesPerDay}
        valueLabel="Daily level updates"
      />
      <GraphCard
        title="Traps placed per day"
        data={trapsPlacedPerDay}
        valueLabel="Daily traps deployed"
      />
      <GraphCard
        title="Traps captured per day"
        data={trapsCapturedPerDay}
        valueLabel="Daily trap captures"
      />
      <GraphCard
        title="Traps revealed per day"
        data={trapsRevealedPerDay}
        valueLabel="Daily trap reveals"
      />
      <GraphCard
        title="Traps disarmed per day"
        data={trapsDisarmedPerDay}
        valueLabel="Daily trap disarms"
      />
    </div>
  );
}