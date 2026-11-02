import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";
import { functions } from "../firebase";
import type { TrapDefinition } from "../types";

type AdminTrapDefinitionsResponse = {
  ok?: boolean;
  items?: TrapDefinition[];
};

function formatAgeGroups(groups?: ("minor" | "adult")[]) {
  if (!groups || groups.length === 0) return "minor, adult";
  return groups.join(", ");
}

export default function TrapDefinitionsPanel() {
  const [items, setItems] = useState<TrapDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [timerMsg, setTimerMsg] = useState<string | null>(null);
  const [timerWorking, setTimerWorking] = useState(false);

  async function loadDefs() {
    setLoading(true);
    try {
      const fn = httpsCallable<unknown, AdminTrapDefinitionsResponse>(
        functions,
        "adminListTrapDefinitions"
      );
      const result = await fn();
      setItems(result.data.items ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function seed() {
    const fn = httpsCallable(functions, "seedTrapDefinitions");
    await fn();
    await loadDefs();
  }

  async function updateTimers(force = false) {
    const label = force
      ? "Force-update ALL trap timers (even already-reasonable ones)?"
      : "Update trap timers for definitions that still have short defaults (≤ 10s)?";
    if (!confirm(label)) return;
    setTimerWorking(true);
    setTimerMsg(null);
    try {
      const fn = httpsCallable<{ force?: boolean }, { ok: boolean; updated: number }>(
        functions,
        "adminUpdateTrapTimers"
      );
      const result = await fn({ force });
      setTimerMsg(`✅ Updated ${result.data.updated} trap definition(s) with meaningful timer values.`);
      await loadDefs();
    } catch (e) {
      setTimerMsg(`❌ ${e instanceof Error ? e.message : "Failed"}`);
    } finally {
      setTimerWorking(false);
    }
  }

  useEffect(() => {
    void loadDefs();
  }, []);

  return (
    <section style={{ background: "#EEF2F7", padding: 20, borderRadius: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <h2>Trap Definitions (Admin)</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => void seed()}>Seed defaults</button>
          <button
            onClick={() => void updateTimers(false)}
            disabled={timerWorking}
            style={{ background: "#DCE4EE", color: "#0B6C86", border: "1px solid #0B6C86", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}
          >
            ⏱ Fix Short Timers
          </button>
          <button
            onClick={() => void updateTimers(true)}
            disabled={timerWorking}
            style={{ background: "#FDE7EA", color: "#C8283B", border: "1px solid #C8283B", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}
          >
            ⏱ Force Update All Timers
          </button>
        </div>
      </div>
      {timerMsg && <p style={{ color: timerMsg.startsWith("✅") ? "#178A55" : "#C8283B", margin: "8px 0 0" }}>{timerMsg}</p>}

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{ padding: 12, border: "1px solid #DCE4EE", borderRadius: 8 }}
            >
              <strong>{item.name}</strong> ({item.id})
              <br />
              icon: {item.iconKey}
              <br />
              effect: {item.effectKind} / {item.effectValue}
              <br />
              placement: {item.placementHoldSeconds}s, reveal: {item.revealHoldSeconds}s,
              {" "}disarm: {item.disarmHoldSeconds}s
              <br />
              enabled: {item.enabled === false ? "false" : "true"}
              <br />
              visibility: {item.visibility}
              <br />
              age groups: {formatAgeGroups(item.allowedAgeGroups)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}