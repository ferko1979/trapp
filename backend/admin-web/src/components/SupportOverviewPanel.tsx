import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";
import { functions } from "../firebase";

type SupportStatsResponse = {
  ok?: boolean;
  awaitingAdminCount?: number;
  updatedAtEpochMs?: number | null;
};

export default function SupportOverviewPanel() {
  const [awaitingAdminCount, setAwaitingAdminCount] = useState<number>(0);
  const [updatedAtEpochMs, setUpdatedAtEpochMs] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setError("");
        const fn = httpsCallable<unknown, SupportStatsResponse>(
          functions,
          "adminGetSupportStats"
        );
        const res = await fn();
        setAwaitingAdminCount(res.data.awaitingAdminCount ?? 0);
        setUpdatedAtEpochMs(res.data.updatedAtEpochMs ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load support stats.");
      }
    }

    void load();
  }, []);

  return (
    <section
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
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>Support Queue</h3>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Tickets waiting for admin response
          </div>
        </div>

        <div
          style={{
            minWidth: 120,
            textAlign: "center",
            padding: "10px 16px",
            borderRadius: 10,
            background: awaitingAdminCount > 0 ? "#F5C2C9" : "#BFE8D2",
            fontWeight: 700,
            fontSize: 24,
          }}
        >
          {awaitingAdminCount}
        </div>
      </div>

      {updatedAtEpochMs ? (
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          Updated: {new Date(updatedAtEpochMs).toLocaleString()}
        </div>
      ) : null}

      {error ? (
        <div style={{ marginTop: 10, color: "#C8283B" }}>{error}</div>
      ) : null}
    </section>
  );
}