import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";
import { functions } from "../firebase";

type LevelItem = {
  id: string;
  name?: string;
  description?: string | null;
  active?: boolean;
  priceAmount?: number;
  priceCurrency?: string;
  membershipLengthType?: string;
  membershipLengthValue?: number;
  dailyTrapAllowance?: number;
  bagWeightCapacity?: number;
  bagSize?: number;
  placementReductionPercent?: number;
  disarmReductionPercent?: number;
  refillReductionPercent?: number;
  mapVisibilityRadiusMeters?: number;
  rangeMultiplier?: number;
  leaveMultiplier?: number;
  // Ad visibility for users at this level
  disableBannerAd?: boolean;
  disableInterstitialAd?: boolean;
  disableRewardedAd?: boolean;
};

type LevelsResponse = {
  items?: LevelItem[];
};

type LevelFormState = {
  id: string;
  name: string;
  description: string;
  active: boolean;
  priceAmount: number;
  priceCurrency: string;
  membershipLengthType: string;
  membershipLengthValue: number;
  dailyTrapAllowance: number;
  bagWeightCapacity: number;
  placementReductionPercent: number;
  disarmReductionPercent: number;
  refillReductionPercent: number;
  mapVisibilityRadiusMeters: number;
  rangeMultiplier: number;
  leaveMultiplier: number;
  disableBannerAd: boolean;
  disableInterstitialAd: boolean;
  disableRewardedAd: boolean;
};

function getEmptyForm(): LevelFormState {
  return {
    id: "",
    name: "",
    description: "",
    active: true,
    priceAmount: 0,
    priceCurrency: "EUR",
    membershipLengthType: "months",
    membershipLengthValue: 1,
    dailyTrapAllowance: 5,
    bagWeightCapacity: 5,
    placementReductionPercent: 0,
    disarmReductionPercent: 0,
    refillReductionPercent: 0,
    mapVisibilityRadiusMeters: 2000,
    rangeMultiplier: 1,
    leaveMultiplier: 1,
    disableBannerAd: false,
    disableInterstitialAd: false,
    disableRewardedAd: false,
  };
}

function toForm(item?: LevelItem): LevelFormState {
  return {
    id: item?.id ?? "",
    name: item?.name ?? "",
    description: item?.description ?? "",
    active: item?.active ?? true,
    priceAmount: item?.priceAmount ?? 0,
    priceCurrency: item?.priceCurrency ?? "EUR",
    membershipLengthType: item?.membershipLengthType ?? "months",
    membershipLengthValue: item?.membershipLengthValue ?? 1,
    dailyTrapAllowance: item?.dailyTrapAllowance ?? 5,
    bagWeightCapacity: item?.bagWeightCapacity ?? item?.bagSize ?? 5,
    placementReductionPercent: item?.placementReductionPercent ?? 0,
    disarmReductionPercent: item?.disarmReductionPercent ?? 0,
    refillReductionPercent: item?.refillReductionPercent ?? 0,
    mapVisibilityRadiusMeters: item?.mapVisibilityRadiusMeters ?? 2000,
    rangeMultiplier: item?.rangeMultiplier ?? 1,
    leaveMultiplier: item?.leaveMultiplier ?? 1,
    disableBannerAd: item?.disableBannerAd ?? false,
    disableInterstitialAd: item?.disableInterstitialAd ?? false,
    disableRewardedAd: item?.disableRewardedAd ?? false,
  };
}

export default function UserLevelsPanel() {
  const [items, setItems] = useState<LevelItem[]>([]);
  const [result, setResult] = useState("");

  const [form, setForm] = useState<LevelFormState>(getEmptyForm());

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<LevelFormState>(getEmptyForm());

  async function load() {
    const fn = httpsCallable<unknown, LevelsResponse>(functions, "adminListLevels");
    const res = await fn();
    setItems(res.data.items ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createLevel() {
    const fn = httpsCallable(functions, "adminCreateLevel");
    const payload = {
      ...form,
      bagWeightCapacity: form.bagWeightCapacity,
    };
    const res = await fn(payload);
    setResult(JSON.stringify(res.data, null, 2));
    setForm(getEmptyForm());
    await load();
  }

  async function updateLevel(id: string, patch: Record<string, unknown>) {
    const fn = httpsCallable(functions, "adminUpdateLevel");
    const res = await fn({ id, ...patch });
    setResult(JSON.stringify(res.data, null, 2));
    await load();
  }

  async function saveEditedLevel() {
    if (!editingId) return;

    const fn = httpsCallable(functions, "adminUpdateLevel");
    const payload = {
      id: editingId,
      name: editForm.name,
      description: editForm.description,
      active: editForm.active,
      priceAmount: editForm.priceAmount,
      priceCurrency: editForm.priceCurrency,
      membershipLengthType: editForm.membershipLengthType,
      membershipLengthValue: editForm.membershipLengthValue,
      dailyTrapAllowance: editForm.dailyTrapAllowance,
      bagWeightCapacity: editForm.bagWeightCapacity,
      placementReductionPercent: editForm.placementReductionPercent,
      disarmReductionPercent: editForm.disarmReductionPercent,
      refillReductionPercent: editForm.refillReductionPercent,
      mapVisibilityRadiusMeters: editForm.mapVisibilityRadiusMeters,
      rangeMultiplier: editForm.rangeMultiplier,
      leaveMultiplier: editForm.leaveMultiplier,
      disableBannerAd: editForm.disableBannerAd,
      disableInterstitialAd: editForm.disableInterstitialAd,
      disableRewardedAd: editForm.disableRewardedAd,
    };

    const res = await fn(payload);
    setResult(JSON.stringify(res.data, null, 2));
    setEditingId(null);
    setEditForm(getEmptyForm());
    await load();
  }

  function startEdit(item: LevelItem) {
    setEditingId(item.id);
    setEditForm(toForm(item));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(getEmptyForm());
  }

  async function deleteLevel(id: string) {
    const fn = httpsCallable(functions, "adminDeleteLevel");
    const res = await fn({ id });
    setResult(JSON.stringify(res.data, null, 2));

    if (editingId === id) {
      cancelEdit();
    }

    await load();
  }

  function helper(text: string) {
    return <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{text}</div>;
  }

  function renderLevelForm(
    title: string,
    localForm: LevelFormState,
    setLocalForm: React.Dispatch<React.SetStateAction<LevelFormState>>,
    submitLabel: string,
    onSubmit: () => void,
    showIdField: boolean,
    extraAction?: React.ReactNode
  ) {
    return (
      <div style={{ background: "#EEF2F7", padding: 20, borderRadius: 12 }}>
        <h2>{title}</h2>

        <div style={{ display: "grid", gap: 18, maxWidth: 760 }}>
          <div>
            <h3>Identity</h3>

            {showIdField ? (
              <>
                <input
                  placeholder="Level ID (example: pro_monthly)"
                  value={localForm.id}
                  onChange={(e) => setLocalForm({ ...localForm, id: e.target.value })}
                />
                {helper("Internal unique key for this level.")}
              </>
            ) : (
              <>
                <input value={localForm.id} disabled />
                {helper("Level ID cannot be changed here.")}
              </>
            )}

            <input
              placeholder="Level name"
              value={localForm.name}
              onChange={(e) => setLocalForm({ ...localForm, name: e.target.value })}
              style={{ marginTop: 8 }}
            />
            {helper("Readable name shown in admin and purchase screens.")}

            <input
              placeholder="Description"
              value={localForm.description}
              onChange={(e) => setLocalForm({ ...localForm, description: e.target.value })}
              style={{ marginTop: 8 }}
            />
            {helper("Short summary of the benefits included in this level.")}

            <label style={{ display: "block", marginTop: 8 }}>
              <input
                type="checkbox"
                checked={localForm.active}
                onChange={(e) => setLocalForm({ ...localForm, active: e.target.checked })}
              />{" "}
              Active
            </label>
            {helper("If off, this level cannot be assigned or sold.")}
          </div>

          <div>
            <h3>Pricing</h3>

            <input
              type="number"
              placeholder="Price amount"
              value={localForm.priceAmount}
              onChange={(e) =>
                setLocalForm({ ...localForm, priceAmount: Number(e.target.value) })
              }
            />
            {helper("Numeric price of the membership.")}

            <input
              placeholder="Currency (EUR / USD / HUF)"
              value={localForm.priceCurrency}
              onChange={(e) => setLocalForm({ ...localForm, priceCurrency: e.target.value })}
              style={{ marginTop: 8 }}
            />
            {helper("Currency code used for pricing.")}
          </div>

          <div>
            <h3>Membership length</h3>

            <select
              value={localForm.membershipLengthType}
              onChange={(e) =>
                setLocalForm({ ...localForm, membershipLengthType: e.target.value })
              }
            >
              <option value="days">days</option>
              <option value="months">months</option>
              <option value="years">years</option>
            </select>
            {helper("Unit for the membership duration.")}

            <input
              type="number"
              placeholder="Length value"
              value={localForm.membershipLengthValue}
              onChange={(e) =>
                setLocalForm({
                  ...localForm,
                  membershipLengthValue: Number(e.target.value),
                })
              }
              style={{ marginTop: 8 }}
            />
            {helper("Example: 1 month, 12 months, 30 days.")}
          </div>

          <div>
            <h3>Gameplay limits</h3>

            <input
              type="number"
              placeholder="Daily trap allowance"
              value={localForm.dailyTrapAllowance}
              onChange={(e) =>
                setLocalForm({
                  ...localForm,
                  dailyTrapAllowance: Number(e.target.value),
                })
              }
            />
            {helper("How many traps the user may use per day.")}

            <input
              type="number"
              placeholder="Bag weight capacity (KG)"
              value={localForm.bagWeightCapacity}
              onChange={(e) =>
                setLocalForm({
                  ...localForm,
                  bagWeightCapacity: Number(e.target.value),
                })
              }
              style={{ marginTop: 8 }}
            />
            {helper("Maximum total carryable trap weight in KG.")}
          </div>

          <div>
            <h3>Bonuses</h3>

            <input
              type="number"
              placeholder="Placement reduction percent"
              value={localForm.placementReductionPercent}
              onChange={(e) =>
                setLocalForm({
                  ...localForm,
                  placementReductionPercent: Number(e.target.value),
                })
              }
            />
            {helper("Makes trap placement faster. Example: 25 means 25% less time.")}

            <input
              type="number"
              placeholder="Disarm reduction percent"
              value={localForm.disarmReductionPercent}
              onChange={(e) =>
                setLocalForm({
                  ...localForm,
                  disarmReductionPercent: Number(e.target.value),
                })
              }
              style={{ marginTop: 8 }}
            />
            {helper("Makes trap disarming faster.")}

            <input
              type="number"
              placeholder="Refill reduction percent"
              value={localForm.refillReductionPercent}
              onChange={(e) =>
                setLocalForm({
                  ...localForm,
                  refillReductionPercent: Number(e.target.value),
                })
              }
              style={{ marginTop: 8 }}
            />
            {helper("Makes trap refill timing faster.")}
          </div>

          <div>
            <h3>Map visibility</h3>

            <input
              type="number"
              placeholder="Map visibility radius (meters)"
              min={50}
              step={100}
              value={localForm.mapVisibilityRadiusMeters}
              onChange={(e) =>
                setLocalForm({
                  ...localForm,
                  mapVisibilityRadiusMeters: Number(e.target.value),
                })
              }
            />
            {helper(
              "Furthest zoom-out radius in meters at which this level's player can see traps on the map. " +
              "Overrides the global default (400 m). Example: 2000 = 2 km."
            )}
          </div>

          <div>
            <h3>Range & leave multipliers</h3>

            <input
              type="number"
              placeholder="Range multiplier"
              step="0.1"
              min="0.5"
              max="5"
              value={localForm.rangeMultiplier}
              onChange={(e) =>
                setLocalForm({ ...localForm, rangeMultiplier: Number(e.target.value) })
              }
            />
            {helper("Multiplies the disarm/reveal radius for players at this level. 1 = no change, 1.5 = 50% larger range.")}

            <input
              type="number"
              placeholder="Leave multiplier"
              step="0.1"
              min="0.5"
              max="5"
              value={localForm.leaveMultiplier}
              onChange={(e) =>
                setLocalForm({ ...localForm, leaveMultiplier: Number(e.target.value) })
              }
              style={{ marginTop: 8 }}
            />
            {helper("Multiplies how many seconds players at this level can leave the placement/disarm zone before the session cancels. 1 = no change, 2 = twice as long.")}
          </div>

          <div style={{ background: "#F4F7FB", border: "1px solid #DCE4EE", borderRadius: 10, padding: "14px 16px", display: "grid", gap: 10 }}>
            <h3 style={{ margin: 0, color: "#0D1F33" }}>📺 Advertisements</h3>
            <p style={{ margin: 0, fontSize: 12, color: "#3C516C" }}>
              Users at this level will have the checked ad types hidden. The global Game Settings
              ad toggles still take priority — if an ad type is disabled globally, it is off for
              everyone regardless of level.
            </p>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {(
                [
                  { key: "disableBannerAd" as const,        label: "🚫 Disable banner ads" },
                  { key: "disableInterstitialAd" as const,  label: "🚫 Disable interstitial ads" },
                  { key: "disableRewardedAd" as const,      label: "🚫 Disable rewarded ads" },
                ]
              ).map(({ key, label }) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={localForm[key]}
                    onChange={(e) => setLocalForm({ ...localForm, [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => void onSubmit()}>{submitLabel}</button>
            {extraAction}
          </div>
        </div>
      </div>
    );
  }

  return (
    <section style={{ display: "grid", gap: 20 }}>
      {editingId
        ? renderLevelForm(
            `Edit Level: ${editingId}`,
            editForm,
            setEditForm,
            "Save changes",
            saveEditedLevel,
            false,
            <button onClick={cancelEdit}>Cancel edit</button>
          )
        : null}

      {renderLevelForm(
        "Create Level",
        form,
        setForm,
        "Create level",
        createLevel,
        true
      )}

      <div style={{ background: "#EEF2F7", padding: 20, borderRadius: 12 }}>
        <h2>💎 Membership Plans</h2>
        <p style={{ margin: "0 0 16px", color: "#3C516C", fontSize: 13 }}>
          Payment-based membership tiers (Free, Monthly, Annual, etc.).
          These are separate from the XP-based Player Levels.
        </p>

        <div style={{ display: "grid", gap: 10 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{ padding: 12, border: "1px solid #DCE4EE", borderRadius: 8 }}
            >
              <div>
                <strong>{item.name ?? "Unnamed level"}</strong> ({item.id})
              </div>

              <div>description: {item.description ?? "-"}</div>
              <div>active: {String(item.active ?? true)}</div>
              <div>
                price: {item.priceAmount ?? 0} {item.priceCurrency ?? "EUR"}
              </div>
              <div>
                duration: {item.membershipLengthValue ?? 1}{" "}
                {item.membershipLengthType ?? "months"}
              </div>
              <div>
                daily traps: {item.dailyTrapAllowance ?? 5} | bag weight:{" "}
                {item.bagWeightCapacity ?? item.bagSize ?? 5} KG
              </div>
              <div>
                placement -{item.placementReductionPercent ?? 0}% | disarm -
                {item.disarmReductionPercent ?? 0}% | refill -
                {item.refillReductionPercent ?? 0}%
              </div>
              <div>
                map visibility: {item.mapVisibilityRadiusMeters ?? 2000} m
              </div>
              <div>
                range ×{item.rangeMultiplier ?? 1} | leave ×{item.leaveMultiplier ?? 1}
              </div>
              <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {item.disableBannerAd && <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 999, background: "rgba(248,113,113,0.15)", color: "#C8283B" }}>🚫 Banner</span>}
                {item.disableInterstitialAd && <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 999, background: "rgba(248,113,113,0.15)", color: "#C8283B" }}>🚫 Interstitial</span>}
                {item.disableRewardedAd && <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 999, background: "rgba(248,113,113,0.15)", color: "#C8283B" }}>🚫 Rewarded</span>}
                {!item.disableBannerAd && !item.disableInterstitialAd && !item.disableRewardedAd && (
                  <span style={{ fontSize: 11, color: "#5F7491" }}>All ads shown</span>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button onClick={() => startEdit(item)}>Edit</button>

                <button
                  onClick={() =>
                    void updateLevel(item.id, { active: !(item.active ?? true) })
                  }
                >
                  {item.active ?? true ? "Deactivate" : "Activate"}
                </button>

                <button onClick={() => void deleteLevel(item.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <pre style={{ whiteSpace: "pre-wrap" }}>{result}</pre>
    </section>
  );
}