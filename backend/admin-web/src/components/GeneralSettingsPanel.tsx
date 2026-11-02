import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";
import { functions } from "../firebase";

type GeneralSettings = {
  defaultBagWeightCapacity?: number;
  defaultRefillHours?: number;
};

type GeneralSettingsResponse = {
  settings?: GeneralSettings;
};

export default function GeneralSettingsPanel() {
  const [settings, setSettings] = useState<GeneralSettings>({
    defaultBagWeightCapacity: 5,
    defaultRefillHours: 24,
  });

  const [result, setResult] = useState("");

  async function load() {
    const fn = httpsCallable<unknown, GeneralSettingsResponse>(
      functions,
      "adminGetGeneralSettings"
    );
    const res = await fn();
    setSettings({
      defaultBagWeightCapacity: res.data.settings?.defaultBagWeightCapacity ?? 5,
      defaultRefillHours: res.data.settings?.defaultRefillHours ?? 24,
    });
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    const fn = httpsCallable(functions, "adminUpdateGeneralSettings");
    const res = await fn({
      defaultBagWeightCapacity: settings.defaultBagWeightCapacity ?? 5,
      defaultRefillHours: settings.defaultRefillHours ?? 24,
    });
    setResult(JSON.stringify(res.data, null, 2));
  }

  function helper(text: string) {
    return <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{text}</div>;
  }

  function sectionStyle(): React.CSSProperties {
    return {
      background: "#F4F7FB",
      border: "1px solid #DCE4EE",
      borderRadius: 12,
      padding: 16,
      display: "grid",
      gap: 14,
    };
  }

  function fieldStyle(): React.CSSProperties {
    return {
      display: "grid",
      gap: 6,
    };
  }

  function inputStyle(): React.CSSProperties {
    return {
      padding: 10,
      borderRadius: 8,
      border: "1px solid #5F7491",
      background: "#F4F7FB",
      color: "#0D1F33",
    };
  }

  return (
    <section style={{ background: "#EEF2F7", padding: 20, borderRadius: 12 }}>
      <h2 style={{ marginTop: 0 }}>General Settings</h2>

      <div style={{ display: "grid", gap: 18, maxWidth: 820 }}>
        <div style={sectionStyle()}>
          <h3 style={{ margin: 0 }}>Default Inventory Rules</h3>

          <div style={fieldStyle()}>
            <label htmlFor="defaultBagWeightCapacity">
              Default bag weight capacity (KG)
            </label>
            <input
              id="defaultBagWeightCapacity"
              type="number"
              min={0}
              value={settings.defaultBagWeightCapacity ?? 5}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaultBagWeightCapacity: Number(e.target.value),
                })
              }
              placeholder="Example: 5"
              style={inputStyle()}
            />
            {helper("Fallback total carryable trap weight if a level does not override it. Unit: KG.")}
          </div>

          <div style={fieldStyle()}>
            <label htmlFor="defaultRefillHours">
              Default trap refill time (hours)
            </label>
            <input
              id="defaultRefillHours"
              type="number"
              min={0}
              value={settings.defaultRefillHours ?? 24}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaultRefillHours: Number(e.target.value),
                })
              }
              placeholder="Example: 24"
              style={inputStyle()}
            />
            {helper("Fallback refill time for one trap unit if the trap type does not override it. Unit: hours.")}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => void save()}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "none",
              background: "#178A55",
              color: "#E3F7EC",
              fontWeight: 700,
            }}
          >
            Save general settings
          </button>

          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Units used here: KG, hours
          </div>
        </div>
      </div>

      <pre style={{ whiteSpace: "pre-wrap", marginTop: 16 }}>{result}</pre>
    </section>
  );
}