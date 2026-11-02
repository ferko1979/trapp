import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";
import { functions } from "../firebase";

type GameSettings = {
  activeGame?: boolean;
  maintenanceMode?: boolean;
  allowSelfTrapTrigger?: boolean;
  defaultTrapRadiusMeters?: number;
  globalTrapRadiusMultiplier?: number;
  areaTrapLimitRadiusMeters?: number;
  areaTrapLimit?: number;
  // Advertising toggles
  bannerAdEnabled?: boolean;
  interstitialAdEnabled?: boolean;
  rewardedAdEnabled?: boolean;
  rewardedAdReductionType?: string;
  rewardedAdReductionValue?: number;
  rewardedAdMaxUsesPerSession?: number;
  // Trap refill reward (separate reward segment)
  rewardedRefillAdEnabled?: boolean;
  rewardedRefillAdReductionType?: string;
  rewardedRefillAdReductionValue?: number;
  rewardedRefillAdMaxUsesPerSession?: number;
  // AdMob IDs
  admobAppId?: string;
  admobBannerAdUnitId?: string;
  admobInterstitialAdUnitId?: string;
  admobRewardedAdUnitId?: string;
  admobRewardedInterstitialAdUnitId?: string;
  // Payments
  revolutPaymentEnabled?: boolean;
  stripePaymentEnabled?: boolean;
  // Android version control
  minAndroidVersionCode?: number;
  latestAndroidVersionCode?: number;
};

type GameSettingsResponse = {
  settings?: GameSettings;
};

export default function GameSettingsPanel() {
  const [settings, setSettings] = useState<GameSettings>({
    activeGame: true,
    maintenanceMode: false,
    allowSelfTrapTrigger: false,
    defaultTrapRadiusMeters: 25,
    globalTrapRadiusMultiplier: 1,
    areaTrapLimitRadiusMeters: 200,
    areaTrapLimit: 2,
    bannerAdEnabled: true,
    interstitialAdEnabled: true,
    rewardedAdEnabled: true,
    rewardedAdReductionType: "seconds",
    rewardedAdReductionValue: 30,
    rewardedAdMaxUsesPerSession: 1,
    rewardedRefillAdEnabled: true,
    rewardedRefillAdReductionType: "minutes",
    rewardedRefillAdReductionValue: 30,
    rewardedRefillAdMaxUsesPerSession: 1,
    admobAppId:                        "ca-app-pub-6648859971587001~8403928140",
    admobBannerAdUnitId:               "",
    admobInterstitialAdUnitId:         "",
    admobRewardedAdUnitId:             "ca-app-pub-6648859971587001/8212356456",
    admobRewardedInterstitialAdUnitId: "ca-app-pub-6648859971587001/5582567533",
    revolutPaymentEnabled: true,
    stripePaymentEnabled: false,
    minAndroidVersionCode: 1,
    latestAndroidVersionCode: 15,
  });

  const [result, setResult] = useState("");

  async function load() {
    const fn = httpsCallable<unknown, GameSettingsResponse>(
      functions,
      "adminGetGameSettings"
    );
    const res = await fn();

    setSettings({
      activeGame: res.data.settings?.activeGame ?? true,
      maintenanceMode: res.data.settings?.maintenanceMode ?? false,
      allowSelfTrapTrigger: res.data.settings?.allowSelfTrapTrigger ?? false,
      defaultTrapRadiusMeters: res.data.settings?.defaultTrapRadiusMeters ?? 25,
      globalTrapRadiusMultiplier: res.data.settings?.globalTrapRadiusMultiplier ?? 1,
      areaTrapLimitRadiusMeters: res.data.settings?.areaTrapLimitRadiusMeters ?? 200,
      areaTrapLimit: res.data.settings?.areaTrapLimit ?? 2,
      bannerAdEnabled: res.data.settings?.bannerAdEnabled ?? true,
      interstitialAdEnabled: res.data.settings?.interstitialAdEnabled ?? true,
      rewardedAdEnabled: res.data.settings?.rewardedAdEnabled ?? true,
      rewardedAdReductionType: res.data.settings?.rewardedAdReductionType ?? "seconds",
      rewardedAdReductionValue: res.data.settings?.rewardedAdReductionValue ?? 30,
      rewardedAdMaxUsesPerSession: res.data.settings?.rewardedAdMaxUsesPerSession ?? 1,
      rewardedRefillAdEnabled: res.data.settings?.rewardedRefillAdEnabled ?? true,
      rewardedRefillAdReductionType: res.data.settings?.rewardedRefillAdReductionType ?? "minutes",
      rewardedRefillAdReductionValue: res.data.settings?.rewardedRefillAdReductionValue ?? 30,
      rewardedRefillAdMaxUsesPerSession: res.data.settings?.rewardedRefillAdMaxUsesPerSession ?? 1,
      admobAppId:                        res.data.settings?.admobAppId                        ?? "",
      admobBannerAdUnitId:               res.data.settings?.admobBannerAdUnitId               ?? "",
      admobInterstitialAdUnitId:         res.data.settings?.admobInterstitialAdUnitId         ?? "",
      admobRewardedAdUnitId:             res.data.settings?.admobRewardedAdUnitId             ?? "",
      admobRewardedInterstitialAdUnitId: res.data.settings?.admobRewardedInterstitialAdUnitId ?? "",
      revolutPaymentEnabled: res.data.settings?.revolutPaymentEnabled ?? true,
      stripePaymentEnabled: res.data.settings?.stripePaymentEnabled ?? false,
      minAndroidVersionCode: res.data.settings?.minAndroidVersionCode ?? 1,
      latestAndroidVersionCode: res.data.settings?.latestAndroidVersionCode ?? 15,
    });
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    const fn = httpsCallable(functions, "adminUpdateGameSettings");
    const res = await fn({
      activeGame: settings.activeGame ?? true,
      maintenanceMode: settings.maintenanceMode ?? false,
      allowSelfTrapTrigger: settings.allowSelfTrapTrigger ?? false,
      defaultTrapRadiusMeters: Number(settings.defaultTrapRadiusMeters ?? 25),
      globalTrapRadiusMultiplier: Number(settings.globalTrapRadiusMultiplier ?? 1),
      areaTrapLimitRadiusMeters: Number(settings.areaTrapLimitRadiusMeters ?? 200),
      areaTrapLimit: Number(settings.areaTrapLimit ?? 2),
      bannerAdEnabled: settings.bannerAdEnabled ?? true,
      interstitialAdEnabled: settings.interstitialAdEnabled ?? true,
      rewardedAdEnabled: settings.rewardedAdEnabled ?? true,
      rewardedAdReductionType: settings.rewardedAdReductionType ?? "seconds",
      rewardedAdReductionValue: Number(settings.rewardedAdReductionValue ?? 30),
      rewardedAdMaxUsesPerSession: Number(settings.rewardedAdMaxUsesPerSession ?? 1),
      rewardedRefillAdEnabled: settings.rewardedRefillAdEnabled ?? true,
      rewardedRefillAdReductionType: settings.rewardedRefillAdReductionType ?? "minutes",
      rewardedRefillAdReductionValue: Number(settings.rewardedRefillAdReductionValue ?? 30),
      rewardedRefillAdMaxUsesPerSession: Number(settings.rewardedRefillAdMaxUsesPerSession ?? 1),
      admobAppId:                        settings.admobAppId                        ?? "",
      admobBannerAdUnitId:               settings.admobBannerAdUnitId               ?? "",
      admobInterstitialAdUnitId:         settings.admobInterstitialAdUnitId         ?? "",
      admobRewardedAdUnitId:             settings.admobRewardedAdUnitId             ?? "",
      admobRewardedInterstitialAdUnitId: settings.admobRewardedInterstitialAdUnitId ?? "",
      revolutPaymentEnabled: settings.revolutPaymentEnabled ?? true,
      stripePaymentEnabled: settings.stripePaymentEnabled ?? false,
      minAndroidVersionCode: Number(settings.minAndroidVersionCode ?? 1),
      latestAndroidVersionCode: Number(settings.latestAndroidVersionCode ?? 15),
    });
    setResult(JSON.stringify(res.data, null, 2));
  }

  function helper(text: string) {
    return (
      <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
        {text}
      </div>
    );
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
      <h2 style={{ marginTop: 0 }}>Game Settings</h2>

      <div style={{ display: "grid", gap: 18, maxWidth: 820 }}>
        <div style={sectionStyle()}>
          <h3 style={{ margin: 0 }}>Android App Version</h3>

          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ display: "block", marginBottom: 4 }}>
                Minimum required version code
              </label>
              <input
                type="number"
                min={1}
                step={1}
                value={settings.minAndroidVersionCode ?? 1}
                onChange={(e) =>
                  setSettings({ ...settings, minAndroidVersionCode: Number(e.target.value) })
                }
                style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #5F7491", background: "#F4F7FB", color: "#0D1F33" }}
              />
              {helper("Users below this version see a forced update dialog and cannot continue.")}
            </div>

            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ display: "block", marginBottom: 4 }}>
                Latest available version code
              </label>
              <input
                type="number"
                min={1}
                step={1}
                value={settings.latestAndroidVersionCode ?? 1}
                onChange={(e) =>
                  setSettings({ ...settings, latestAndroidVersionCode: Number(e.target.value) })
                }
                style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #5F7491", background: "#F4F7FB", color: "#0D1F33" }}
              />
              {helper("Users below this version see a soft update prompt they can dismiss.")}
            </div>
          </div>
          {helper("Current build in distribution: 15 (v0.3.1). Set both to 1 to disable update checks.")}
        </div>

        <div style={sectionStyle()}>
          <h3 style={{ margin: 0 }}>Game State</h3>

          <div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!settings.activeGame}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    activeGame: e.target.checked,
                  })
                }
              />
              Active game
            </label>
            {helper("Global gameplay switch.")}
          </div>

          <div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!settings.maintenanceMode}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    maintenanceMode: e.target.checked,
                  })
                }
              />
              Maintenance mode
            </label>
            {helper("Blocks gameplay for normal users.")}
          </div>
        </div>

        <div style={sectionStyle()}>
          <h3 style={{ margin: 0 }}>Trap Rules</h3>

          <div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!settings.allowSelfTrapTrigger}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    allowSelfTrapTrigger: e.target.checked,
                  })
                }
              />
              Allow self-triggering traps
            </label>
            {helper(
              "If disabled, a player can never be captured by their own trap."
            )}
          </div>

          <div>
            <label htmlFor="defaultTrapRadiusMeters">
              Default trap radius (meters)
            </label>
            <input
              id="defaultTrapRadiusMeters"
              type="number"
              min={1}
              value={settings.defaultTrapRadiusMeters ?? 25}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaultTrapRadiusMeters: Number(e.target.value),
                })
              }
              style={inputStyle()}
            />
            {helper(
              "Fallback radius if a trap definition has no radiusMeters set."
            )}
          </div>

          <div>
            <label htmlFor="globalTrapRadiusMultiplier">
              Global trap radius multiplier
            </label>
            <input
              id="globalTrapRadiusMultiplier"
              type="number"
              step="0.1"
              min={0.1}
              value={settings.globalTrapRadiusMultiplier ?? 1}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  globalTrapRadiusMultiplier: Number(e.target.value),
                })
              }
              style={inputStyle()}
            />
            {helper(
              "Scales all trap radii globally. Example: 1 = normal, 0.8 = smaller, 1.2 = larger."
            )}
          </div>

          <div>
            <label htmlFor="areaTrapLimitRadiusMeters">
              Trap spacing limit (meters)
            </label>
            <input
              id="areaTrapLimitRadiusMeters"
              type="number"
              min={10}
              step={10}
              value={settings.areaTrapLimitRadiusMeters ?? 200}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  areaTrapLimitRadiusMeters: Number(e.target.value),
                })
              }
              style={inputStyle()}
            />
            {helper(
              "How close (in meters) two of the same player's active traps can be. Default: 200."
            )}
          </div>

          <div>
            <label htmlFor="areaTrapLimit">
              Max traps within spacing area
            </label>
            <input
              id="areaTrapLimit"
              type="number"
              min={1}
              step={1}
              value={settings.areaTrapLimit ?? 2}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  areaTrapLimit: Number(e.target.value),
                })
              }
              style={inputStyle()}
            />
            {helper(
              "Maximum number of your own active traps allowed within the spacing radius. Default: 2."
            )}
          </div>
        </div>

        {/* ── Advertising ─────────────────────────────────────────────────── */}
        <div
          style={{
            ...sectionStyle(),
            border: "1px solid #0B6C86",
            background: "linear-gradient(135deg, #F4F7FB 0%, #F4F7FB 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
            <span style={{ fontSize: "1.3rem" }}>📺</span>
            <h3 style={{ margin: 0, color: "#0B6C86" }}>Advertising (AdMob)</h3>
          </div>
          <div
            style={{
              fontSize: "0.8rem",
              color: "#5F7491",
              lineHeight: 1.6,
              padding: "8px 12px",
              background: "#F4F7FB",
              borderRadius: 8,
              border: "1px solid #DCE4EE",
            }}
          >
            Changes here take effect immediately — the mobile app fetches these settings at launch via{" "}
            <code>getPublicGameSettings</code>. No app update needed.
          </div>

          {/* Ad type toggles */}
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {(
              [
                { key: "bannerAdEnabled",        label: "Banner ads",        desc: "Persistent banner at the bottom of the game screen. Hidden for paid subscribers." },
                { key: "interstitialAdEnabled",  label: "Interstitial ads",  desc: "Full-screen ad shown at natural gameplay breaks." },
                { key: "rewardedAdEnabled",      label: "Rewarded ads",      desc: "User-initiated: watch a full ad to cut placement time. Configured below." },
              ] as const
            ).map(({ key, label, desc }) => (
              <div
                key={key}
                style={{
                  background: settings[key] ? "rgba(11,108,134,0.08)" : "#F4F7FB",
                  border: `1px solid ${settings[key] ? "rgba(11,108,134,0.3)" : "#DCE4EE"}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={!!settings[key]}
                    onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
                    style={{ accentColor: "#0B6C86", width: 16, height: 16 }}
                  />
                  {label}
                </label>
                <div style={{ fontSize: "0.75rem", color: "#5F7491", lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>

          {/* Rewarded ad reward configuration */}
          <div
            style={{
              background: settings.rewardedAdEnabled ? "rgba(251,191,36,0.06)" : "#F4F7FB",
              border: `1px solid ${settings.rewardedAdEnabled ? "rgba(251,191,36,0.2)" : "#DCE4EE"}`,
              borderRadius: 10,
              padding: "16px 18px",
              display: "grid",
              gap: 16,
              opacity: settings.rewardedAdEnabled ? 1 : 0.5,
            }}
          >
            <div style={{ fontWeight: 700, color: "#8A5A0B", fontSize: "0.875rem" }}>
              🎁 Rewarded Ad Timer Discount
            </div>

            {/* Preview badge */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                background: "#F4F7FB",
                border: "1px solid #DCE4EE",
                borderRadius: 10,
                padding: "10px 16px",
                width: "fit-content",
                maxWidth: "100%",
              }}
            >
              <span style={{ fontSize: "1.4rem" }}>📺</span>
              <div>
                <div style={{ fontWeight: 700, color: "#0D1F33", fontSize: "0.875rem" }}>
                  Preview — what the player sees:
                </div>
                <div style={{ color: "#0B6C86", fontSize: "0.82rem", marginTop: 2 }}>
                  {settings.rewardedAdReductionType === "percent"
                    ? `"Watch a short ad to cut ${settings.rewardedAdReductionValue ?? 50}% off your placement time!"`
                    : `"Watch a short ad to save ${settings.rewardedAdReductionValue ?? 30} ${settings.rewardedAdReductionType ?? "seconds"} off your placement timer!"`}
                </div>
                <div style={{ color: "#5F7491", fontSize: "0.75rem", marginTop: 3 }}>
                  Up to {settings.rewardedAdMaxUsesPerSession ?? 1} use(s) per session
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr 1fr" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="rewardedAdReductionType" style={{ fontSize: "0.82rem", fontWeight: 600, color: "#3C516C" }}>
                  Reduction type
                </label>
                <select
                  id="rewardedAdReductionType"
                  value={settings.rewardedAdReductionType ?? "seconds"}
                  onChange={(e) => setSettings({ ...settings, rewardedAdReductionType: e.target.value })}
                  style={{ ...inputStyle(), fontSize: "0.875rem" }}
                  disabled={!settings.rewardedAdEnabled}
                >
                  <option value="seconds">Fixed — seconds</option>
                  <option value="minutes">Fixed — minutes</option>
                  <option value="hours">Fixed — hours</option>
                  <option value="percent">% of total timer</option>
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="rewardedAdReductionValue" style={{ fontSize: "0.82rem", fontWeight: 600, color: "#3C516C" }}>
                  Amount ({settings.rewardedAdReductionType === "percent" ? "%" : settings.rewardedAdReductionType ?? "sec"})
                </label>
                <input
                  id="rewardedAdReductionValue"
                  type="number"
                  min={1}
                  max={settings.rewardedAdReductionType === "percent" ? 100 : 9999}
                  value={settings.rewardedAdReductionValue ?? 30}
                  onChange={(e) => setSettings({ ...settings, rewardedAdReductionValue: Number(e.target.value) })}
                  style={{ ...inputStyle(), fontSize: "0.875rem" }}
                  disabled={!settings.rewardedAdEnabled}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="rewardedAdMaxUsesPerSession" style={{ fontSize: "0.82rem", fontWeight: 600, color: "#3C516C" }}>
                  Max uses / session
                </label>
                <input
                  id="rewardedAdMaxUsesPerSession"
                  type="number"
                  min={1}
                  max={10}
                  value={settings.rewardedAdMaxUsesPerSession ?? 1}
                  onChange={(e) => setSettings({ ...settings, rewardedAdMaxUsesPerSession: Number(e.target.value) })}
                  style={{ ...inputStyle(), fontSize: "0.875rem" }}
                  disabled={!settings.rewardedAdEnabled}
                />
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gap: 6,
                gridTemplateColumns: "1fr 1fr",
                fontSize: "0.75rem",
                color: "#5F7491",
                lineHeight: 1.5,
              }}
            >
              <div>
                <strong style={{ color: "#5F7491" }}>Reduction type:</strong> "Fixed" deducts a set
                number of seconds/minutes/hours from the remaining timer. "%" removes that
                percentage of the total required hold time.
              </div>
              <div>
                <strong style={{ color: "#5F7491" }}>Max uses / session:</strong> How many times one
                user can use rewarded ads during a single trap placement session (1–10).
                The timer is updated immediately after each successfully watched ad.
              </div>
            </div>
          </div>

          {/* Trap Refill Reward section */}
          <div
            style={{
              background: settings.rewardedRefillAdEnabled ? "rgba(34,197,94,0.06)" : "#F4F7FB",
              border: `1px solid ${settings.rewardedRefillAdEnabled ? "rgba(34,197,94,0.2)" : "#DCE4EE"}`,
              borderRadius: 10,
              padding: "16px 18px",
              display: "grid",
              gap: 16,
              opacity: settings.rewardedRefillAdEnabled ? 1 : 0.5,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: "1.2rem" }}>🔄</span>
              <div>
                <div style={{ fontWeight: 700, color: "#178A55", fontSize: "0.875rem" }}>
                  Trap Refill Reward
                </div>
                <div style={{ fontSize: "0.75rem", color: "#5F7491", marginTop: 2 }}>
                  Separate from placement/disassembly rewards — players watch an ad to reduce the
                  refill wait time on an empty trap slot.
                </div>
              </div>
              <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={!!settings.rewardedRefillAdEnabled}
                  onChange={(e) => setSettings({ ...settings, rewardedRefillAdEnabled: e.target.checked })}
                  style={{ accentColor: "#178A55", width: 16, height: 16 }}
                />
                <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Enabled</span>
              </label>
            </div>

            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr 1fr" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="rewardedRefillAdReductionType" style={{ fontSize: "0.82rem", fontWeight: 600, color: "#3C516C" }}>
                  Reduction type
                </label>
                <select
                  id="rewardedRefillAdReductionType"
                  value={settings.rewardedRefillAdReductionType ?? "minutes"}
                  onChange={(e) => setSettings({ ...settings, rewardedRefillAdReductionType: e.target.value })}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #5F7491", background: "#F4F7FB", color: "#0D1F33", fontSize: "0.875rem" }}
                  disabled={!settings.rewardedRefillAdEnabled}
                >
                  <option value="seconds">Fixed — seconds</option>
                  <option value="minutes">Fixed — minutes</option>
                  <option value="hours">Fixed — hours</option>
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="rewardedRefillAdReductionValue" style={{ fontSize: "0.82rem", fontWeight: 600, color: "#3C516C" }}>
                  Amount ({settings.rewardedRefillAdReductionType ?? "minutes"})
                </label>
                <input
                  id="rewardedRefillAdReductionValue"
                  type="number"
                  min={1}
                  max={9999}
                  value={settings.rewardedRefillAdReductionValue ?? 30}
                  onChange={(e) => setSettings({ ...settings, rewardedRefillAdReductionValue: Number(e.target.value) })}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #5F7491", background: "#F4F7FB", color: "#0D1F33", fontSize: "0.875rem" }}
                  disabled={!settings.rewardedRefillAdEnabled}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="rewardedRefillAdMaxUsesPerSession" style={{ fontSize: "0.82rem", fontWeight: 600, color: "#3C516C" }}>
                  Max uses / session
                </label>
                <input
                  id="rewardedRefillAdMaxUsesPerSession"
                  type="number"
                  min={1}
                  max={10}
                  value={settings.rewardedRefillAdMaxUsesPerSession ?? 1}
                  onChange={(e) => setSettings({ ...settings, rewardedRefillAdMaxUsesPerSession: Number(e.target.value) })}
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #5F7491", background: "#F4F7FB", color: "#0D1F33", fontSize: "0.875rem" }}
                  disabled={!settings.rewardedRefillAdEnabled}
                />
              </div>
            </div>

            <div style={{ fontSize: "0.75rem", color: "#5F7491", lineHeight: 1.5 }}>
              Example: "30 minutes" subtracts 30 minutes from the refill countdown when the user
              watches a full ad. The countdown is updated immediately on the server.
            </div>
          </div>

          {/* EU/GDPR consent note */}
          <div
            style={{
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 9,
              padding: "10px 14px",
              fontSize: "0.78rem",
              color: "#3C516C",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: "#C8283B" }}>🇪🇺 GDPR / Hungary (EEA):</strong> The mobile app must
            trigger the{" "}
            <strong style={{ color: "#C8283B" }}>Google User Messaging Platform (UMP)</strong> consent
            flow at launch <em>before</em> loading any ads. Configure this in AdMob → Privacy &amp;
            messaging. Non-personalized ads will be served to users who decline or are underage.
          </div>
        </div>

        {/* ── AdMob App & Ad Unit IDs ────────────────────────────────────────── */}
        <div
          style={{
            ...sectionStyle(),
            border: "1px solid #E3F7EC",
            background: "linear-gradient(135deg, #E3F7EC 0%, #F4F7FB 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: "1.3rem" }}>🔑</span>
            <h3 style={{ margin: 0, color: "#178A55" }}>AdMob App & Ad Unit IDs</h3>
          </div>
          <div
            style={{
              fontSize: "0.8rem",
              color: "#5F7491",
              lineHeight: 1.6,
              padding: "8px 12px",
              background: "#F4F7FB",
              borderRadius: 8,
              border: "1px solid #E3F7EC",
            }}
          >
            These IDs are fetched by the app at launch via <code>getPublicGameSettings</code> and used
            to initialise the Google Mobile Ads SDK. Changing them here takes effect on the next app
            cold start — no app update required. The App ID is also required in{" "}
            <code>AndroidManifest.xml</code> / <code>Info.plist</code> for SDK initialisation.
          </div>

          {/* Warning */}
          <div
            style={{
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 8,
              padding: "9px 13px",
              fontSize: "0.78rem",
              color: "#C8283B",
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <span style={{ fontSize: "1rem", flexShrink: 0 }}>⚠</span>
            <span>
              These values are <strong>not secret</strong> — they are embedded in every app binary and
              are safe to store here. Do not confuse them with your AdMob publisher secret or any OAuth
              credentials.
            </span>
          </div>

          {(
            [
              {
                key:   "admobAppId"                        as const,
                label: "App ID",
                desc:  "Required in AndroidManifest.xml & Info.plist. Format: ca-app-pub-XXXXXXXXXXXXXXXX~NNNNNNNNNN",
                placeholder: "ca-app-pub-6648859971587001~8403928140",
              },
              {
                key:   "admobBannerAdUnitId"               as const,
                label: "Banner Ad Unit ID",
                desc:  "Standard banner shown at the bottom of the game screen.",
                placeholder: "ca-app-pub-XXXXXXXXXXXXXXXX/NNNNNNNNNN",
              },
              {
                key:   "admobInterstitialAdUnitId"         as const,
                label: "Interstitial Ad Unit ID",
                desc:  "Full-screen ad shown at natural gameplay breaks.",
                placeholder: "ca-app-pub-XXXXXXXXXXXXXXXX/NNNNNNNNNN",
              },
              {
                key:   "admobRewardedAdUnitId"             as const,
                label: "Rewarded Video Ad Unit ID",
                desc:  "User watches a full video to earn a placement timer discount. (\"Video Banner\" in your AdMob console.)",
                placeholder: "ca-app-pub-6648859971587001/8212356456",
              },
              {
                key:   "admobRewardedInterstitialAdUnitId" as const,
                label: "Rewarded Interstitial Ad Unit ID",
                desc:  "Shown at natural gameplay breaks (trap placement). Ad unit type: Rewarded Interstitial. (\"TrappOne\" in your AdMob console.)",
                placeholder: "ca-app-pub-6648859971587001/5582567533",
              },
            ] as const
          ).map(({ key, label, desc, placeholder }) => (
            <div key={key} style={{ display: "grid", gap: 5 }}>
              <label
                htmlFor={key}
                style={{ fontWeight: 600, fontSize: "0.85rem", color: "#178A55" }}
              >
                {label}
              </label>
              <input
                id={key}
                type="text"
                value={settings[key] ?? ""}
                onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                placeholder={placeholder}
                style={{
                  ...inputStyle(),
                  fontFamily: "monospace",
                  fontSize: "0.82rem",
                  letterSpacing: "0.02em",
                  borderColor: settings[key] ? "#DCE4EE" : "#5F7491",
                }}
              />
              <div style={{ fontSize: "0.73rem", color: "#5F7491", lineHeight: 1.5 }}>
                {desc}
              </div>
            </div>
          ))}
        </div>

        <div style={sectionStyle()}>
          <h3 style={{ margin: 0 }}>Payment Gateways</h3>

          <div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!settings.revolutPaymentEnabled}
                onChange={(e) => setSettings({ ...settings, revolutPaymentEnabled: e.target.checked })}
              />
              Revolut payments enabled
            </label>
            {helper("When enabled, the app offers Revolut as a checkout option for subscriptions.")}
          </div>

          <div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!settings.stripePaymentEnabled}
                onChange={(e) => setSettings({ ...settings, stripePaymentEnabled: e.target.checked })}
              />
              Stripe payments enabled
            </label>
            {helper("When enabled, the app offers Stripe as a checkout option (card payments). Requires Stripe secret key configured in Payment Settings.")}
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
            Save game settings
          </button>
        </div>
      </div>

      <pre style={{ whiteSpace: "pre-wrap", marginTop: 16 }}>{result}</pre>
    </section>
  );
}