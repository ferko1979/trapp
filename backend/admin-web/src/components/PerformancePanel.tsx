import { useState, useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

type FnStatus = { name: string; desired: number; actual: number | null; error?: string };
type KeepWarmResponse = {
  ok: boolean;
  settings: { enabled: boolean; functions: string[] };
  status: FnStatus[];
  estUsdPerFunctionMonth: number;
};

const LABELS: Record<string, string> = {
  updatePlayerLocation: "Location update (map refresh)",
  revealNearbyTrap: "Reveal trap",
  startTrapDisarm: "Start disassembly",
  tapTrapDisarm: "Disassembly hold",
  disarmAndCollectTrap: "Finish disassembly",
  startTrapPlacement: "Start placement",
  tapTrapPlacement: "Placement hold",
  getMyTrapInventory: "Bag / inventory",
};

export default function PerformancePanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState<FnStatus[]>([]);
  const [usdPerFn, setUsdPerFn] = useState(8);
  const [msg, setMsg] = useState("");

  function apply(data: KeepWarmResponse) {
    setEnabled(data.settings.enabled);
    setSelected(data.settings.functions);
    setStatus(data.status);
    setUsdPerFn(data.estUsdPerFunctionMonth);
  }

  async function load() {
    setLoading(true);
    setMsg("");
    try {
      const res = await httpsCallable<void, KeepWarmResponse>(functions, "adminGetKeepWarm")();
      apply(res.data);
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : "Failed to load."}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function save(nextEnabled: boolean, nextSelected: string[]) {
    setSaving(true);
    setMsg("");
    try {
      const res = await httpsCallable<{ enabled: boolean; functions: string[] }, KeepWarmResponse>(
        functions, "adminSetKeepWarm"
      )({ enabled: nextEnabled, functions: nextSelected });
      apply(res.data);
      const errors = res.data.status.filter((s) => s.error);
      setMsg(errors.length
        ? `Saved, but ${errors.length} function(s) could not be updated: ${errors[0].error}`
        : "✓ Saved and applied.");
    } catch (e: unknown) {
      setMsg(`Error: ${e instanceof Error ? e.message : "Save failed."}`);
    } finally {
      setSaving(false);
    }
  }

  function toggleFn(name: string) {
    const next = selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name];
    setSelected(next);
    if (enabled) void save(true, next);
  }

  const activeCount = enabled ? selected.length : 0;
  const busy = loading || saving;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 720 }}>
      <div style={{
        background: "#F4F7FB", border: `1px solid ${enabled ? "#BFE8D2" : "#DCE4EE"}`, borderRadius: 12,
        padding: "20px 24px", display: "flex", alignItems: "center", gap: 18,
      }}>
        <div style={{ fontSize: "1.6rem" }}>{loading ? "⏳" : enabled ? "🔥" : "❄️"}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "1rem", color: "#0D1F33", marginBottom: 4 }}>
            Keep gameplay functions warm
          </div>
          <div style={{ color: "#3C516C", fontSize: "0.85rem", lineHeight: 1.5 }}>
            Keeps one instance of each selected function always running, so players never wait for a
            cold start (~3 s on the first call after idle). Costs money while on.
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: busy ? "default" : "pointer" }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => void save(e.target.checked, selected)}
            style={{ width: 20, height: 20 }}
          />
          <span style={{ fontWeight: 600, color: enabled ? "#178A55" : "#5F7491" }}>
            {enabled ? "ON" : "OFF"}
          </span>
        </label>
      </div>

      <div style={{ background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 12, overflow: "hidden" }}>
        <div style={{
          padding: "14px 24px", borderBottom: "1px solid #DCE4EE", fontWeight: 700, color: "#0D1F33",
          fontSize: "0.9rem", display: "flex", justifyContent: "space-between",
        }}>
          <span>Functions</span>
          <span style={{ fontWeight: 600, color: activeCount ? "#8A5A0B" : "#5F7491" }}>
            Estimated cost: ~${activeCount * usdPerFn} / month
          </span>
        </div>
        {(status.length ? status : Object.keys(LABELS).map((name) => ({ name, desired: 0, actual: null } as FnStatus)))
          .map((s) => (
            <label key={s.name} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "10px 24px",
              borderBottom: "1px solid #E8EEF5", cursor: busy ? "default" : "pointer",
            }}>
              <input
                type="checkbox"
                checked={selected.includes(s.name)}
                disabled={busy}
                onChange={() => toggleFn(s.name)}
              />
              <div style={{ flex: 1 }}>
                <div style={{ color: "#0D1F33", fontSize: "0.875rem" }}>{LABELS[s.name] ?? s.name}</div>
                <div style={{ color: "#5F7491", fontSize: "0.75rem", fontFamily: "monospace" }}>{s.name}</div>
              </div>
              <span style={{ fontSize: "0.78rem", color: s.error ? "#B42318" : s.actual ? "#178A55" : "#5F7491" }}>
                {s.error ? "⚠ error" : s.actual === null ? "–" : s.actual > 0 ? `warm (${s.actual})` : "cold start"}
              </span>
            </label>
          ))}
        <div style={{ padding: "12px 24px", color: "#5F7491", fontSize: "0.78rem", lineHeight: 1.5 }}>
          ~${usdPerFn} / month per warm function (1 vCPU, 256 MiB, idle rate; estimate). A redeploy may reset
          the setting — it is re-applied automatically every hour.
        </div>
      </div>

      {msg && (
        <div style={{ color: msg.startsWith("✓") ? "#178A55" : "#B42318", fontSize: "0.875rem" }}>{msg}</div>
      )}
    </div>
  );
}
