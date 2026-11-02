import { useCallback, useEffect, useRef, useState } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirestore, doc, onSnapshot, type Unsubscribe } from "firebase/firestore";

type CityEntry = { name: string; lat: number; lng: number; population: number };

type JobStatus = "queued" | "running" | "completed" | "failed";

type JobProgress = {
  phase: string;
  message: string;
  processed: number;
  total: number;
  percentComplete: number;
  estimatedSecondsRemaining?: number;
};

type PreviewPoint = { lat: number; lng: number; trapTypeId: string };

type JobDoc = {
  status: JobStatus;
  mode: "city" | "country";
  locationName: string;
  trapCount: number;
  minSpacingMeters: number;
  dryRun: boolean;
  progress: JobProgress;
  result?: {
    placed: number;
    candidates: number;
    preview: PreviewPoint[];
    cityBreakdown?: { city: string; count: number }[];
    elapsedSeconds: number;
  };
  error?: string;
};

type TrapTypeCount = { trapTypeId: string; count: number };

type TrapDefSummary = { id: string; name: string; iconKey: string; enabled: boolean };

type FirstLoginSettings = {
  firstLoginTrapGenEnabled: boolean;
  firstLoginTrapCount: number;
  firstLoginTrapRadiusMeters: number;
  firstLoginTrapMinDistanceMeters: number;
  firstLoginTrapMinSpacingMeters: number;
  firstLoginTrapExpiryDays: number;
  firstLoginTrapTypeMode: "random" | "fixed";
  firstLoginTrapTypeIds: string[];
  firstLoginTrapTypeCounts: TrapTypeCount[];
};

type PlayerLocation = {
  uid: string;
  username: string;
  lat: number;
  lng: number;
  updatedAtMs: number | null;
};

type UserJob = {
  uid: string;
  username: string;
  lat: number;
  lng: number;
  jobId: string;
  status?: JobStatus;
  pct?: number;
  message?: string;
};

// ─── World countries ──────────────────────────────────────────────────────────

const WORLD_COUNTRIES = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda",
  "Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain",
  "Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia",
  "Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso",
  "Burundi","Cabo Verde","Cambodia","Cameroon","Canada","Central African Republic",
  "Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica","Croatia","Cuba",
  "Cyprus","Czech Republic","Denmark","Djibouti","Dominica","Dominican Republic",
  "Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini",
  "Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana",
  "Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras",
  "Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy",
  "Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kuwait","Kyrgyzstan",
  "Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania",
  "Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta",
  "Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova",
  "Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia",
  "Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria",
  "North Korea","North Macedonia","Norway","Oman","Pakistan","Palau","Palestine",
  "Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal",
  "Qatar","Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia",
  "Saint Vincent and the Grenadines","Samoa","San Marino","Saudi Arabia","Senegal",
  "Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia",
  "Solomon Islands","Somalia","South Africa","South Korea","South Sudan","Spain",
  "Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria","Taiwan","Tajikistan",
  "Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia",
  "Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates",
  "United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Vatican City",
  "Venezuela","Vietnam","Yemen","Zambia","Zimbabwe",
].sort();

// ─── Styles ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "#F4F7FB",
  border: "1px solid #DCE4EE",
  borderRadius: 12,
  padding: "20px 24px",
  marginBottom: 20,
};

const lbl: React.CSSProperties = {
  display: "block",
  color: "#3C516C",
  fontSize: "0.8rem",
  fontWeight: 600,
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const inp: React.CSSProperties = {
  width: "100%",
  background: "#F4F7FB",
  border: "1px solid #DCE4EE",
  borderRadius: 8,
  color: "#0D1F33",
  fontSize: "0.9rem",
  padding: "9px 12px",
  boxSizing: "border-box",
  outline: "none",
};

const btnPrimary: React.CSSProperties = {
  background: "#0B6C86",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 22px",
  fontSize: "0.9rem",
  fontWeight: 600,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  background: "#F4F7FB",
  color: "#3C516C",
  border: "1px solid #DCE4EE",
  borderRadius: 8,
  padding: "10px 22px",
  fontSize: "0.9rem",
  fontWeight: 600,
  cursor: "pointer",
};

const tag: React.CSSProperties = {
  display: "inline-block",
  background: "#DCE4EE",
  color: "#0B6C86",
  borderRadius: 6,
  padding: "3px 10px",
  fontSize: "0.78rem",
  fontWeight: 600,
  marginRight: 6,
  marginBottom: 4,
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function TrapGeneratorPanel() {
  // Country picker
  const [countrySearch, setCountrySearch]     = useState("");
  const [selectedCountry, setSelectedCountry] = useState("");
  const [showCountryList, setShowCountryList] = useState(false);

  // City list (loaded after country select)
  const [cities, setCities]             = useState<CityEntry[]>([]);
  const [selectedCities, setSelectedCities] = useState<Set<string>>(new Set());
  const [citiesLoading, setCitiesLoading]   = useState(false);
  const [citiesError, setCitiesError]       = useState<string | null>(null);
  const [citySearch, setCitySearch]         = useState("");

  // Fallback: manual city name when no cities found
  const [fallbackCity, setFallbackCity] = useState("");

  // Common settings
  const [trapCount, setTrapCount]               = useState(20);
  const [minSpacingMeters, setMinSpacingMeters] = useState(100);
  const [expiryDays, setExpiryDays]             = useState(30);
  const [dryRun, setDryRun]                     = useState(true);
  const [trapTypeIds, setTrapTypeIds]           = useState("");
  const [allowMinors, setAllowMinors]           = useState(true);
  const [allowAdults, setAllowAdults]           = useState(true);

  // Job
  const [starting, setStarting] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [jobId, setJobId]       = useState<string | null>(null);
  const [job, setJob]           = useState<JobDoc | null>(null);

  const unsubRef       = useRef<Unsubscribe | null>(null);
  const countryDropRef = useRef<HTMLDivElement | null>(null);

  // ── First-Login Auto-Placement settings ────────────────────────────────────
  const [flSettings, setFlSettings]     = useState<FirstLoginSettings>({
    firstLoginTrapGenEnabled: false,
    firstLoginTrapCount: 10,
    firstLoginTrapRadiusMeters: 1000,
    firstLoginTrapMinDistanceMeters: 0,
    firstLoginTrapMinSpacingMeters: 150,
    firstLoginTrapExpiryDays: 30,
    firstLoginTrapTypeMode: "random",
    firstLoginTrapTypeIds: [],
    firstLoginTrapTypeCounts: [],
  });
  const [flLoading, setFlLoading]       = useState(true);
  const [flSaving, setFlSaving]         = useState(false);
  const [flSaveMsg, setFlSaveMsg]       = useState<string | null>(null);
  const [trapDefs, setTrapDefs]         = useState<TrapDefSummary[]>([]);
  const [trapDefsLoading, setTrapDefsLoading] = useState(true);

  // ── Place Near Users state ─────────────────────────────────────────────────
  const [players, setPlayers]             = useState<PlayerLocation[]>([]);
  const [playerSearch, setPlayerSearch]   = useState("");
  const [selectedUids, setSelectedUids]   = useState<Set<string>>(new Set());
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playersError, setPlayersError]   = useState<string | null>(null);
  const [userJobCount, setUserJobCount]   = useState(10);
  const [userJobRadius, setUserJobRadius] = useState(1000);
  const [userJobSpacing, setUserJobSpacing] = useState(150);
  const [userJobExpiry, setUserJobExpiry] = useState(30);
  const [userJobDryRun, setUserJobDryRun] = useState(true);
  const [userJobs, setUserJobs]           = useState<UserJob[]>([]);
  const [userJobsRunning, setUserJobsRunning] = useState(false);
  const [userJobsError, setUserJobsError] = useState<string | null>(null);
  const userJobUnsubsRef = useRef<Map<string, Unsubscribe>>(new Map());

  // Firestore listener for active job
  useEffect(() => {
    if (!jobId) return;
    unsubRef.current?.();
    const db = getFirestore();
    unsubRef.current = onSnapshot(
      doc(db, "admin_trap_gen_jobs", jobId),
      (snap) => { if (snap.exists()) setJob(snap.data() as JobDoc); }
    );
    return () => { unsubRef.current?.(); unsubRef.current = null; };
  }, [jobId]);

  // Close country dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (countryDropRef.current && !countryDropRef.current.contains(e.target as Node)) {
        setShowCountryList(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Load first-login settings + trap definitions on mount
  useEffect(() => {
    const fns = getFunctions(undefined, "europe-west1");

    const getSettings = httpsCallable<Record<string, never>, { ok: boolean; settings: Record<string, unknown> }>(
      fns, "adminGetGameSettings"
    );
    getSettings({})
      .then(({ data }) => {
        const s = data.settings as Record<string, unknown>;
        const rawTypeCounts = Array.isArray(s.firstLoginTrapTypeCounts)
          ? (s.firstLoginTrapTypeCounts as TrapTypeCount[])
          : [];
        const rawTypeIds = Array.isArray(s.firstLoginTrapTypeIds)
          ? (s.firstLoginTrapTypeIds as string[])
          : [];
        setFlSettings({
          firstLoginTrapGenEnabled: Boolean(s.firstLoginTrapGenEnabled),
          firstLoginTrapCount: Number(s.firstLoginTrapCount) || 10,
          firstLoginTrapRadiusMeters: Number(s.firstLoginTrapRadiusMeters) || 1000,
          firstLoginTrapMinDistanceMeters: Number(s.firstLoginTrapMinDistanceMeters) || 0,
          firstLoginTrapMinSpacingMeters: Number(s.firstLoginTrapMinSpacingMeters) || 150,
          firstLoginTrapExpiryDays: Number(s.firstLoginTrapExpiryDays) || 30,
          firstLoginTrapTypeMode: s.firstLoginTrapTypeMode === "fixed" ? "fixed" : "random",
          firstLoginTrapTypeIds: rawTypeIds,
          firstLoginTrapTypeCounts: rawTypeCounts,
        });
      })
      .catch(() => { /* non-critical */ })
      .finally(() => setFlLoading(false));

    const listDefs = httpsCallable<Record<string, never>, { ok: boolean; definitions: TrapDefSummary[] }>(
      fns, "adminListTrapDefinitions"
    );
    listDefs({})
      .then(({ data }) => {
        setTrapDefs((data.definitions ?? []).filter((d) => d.enabled !== false));
      })
      .catch(() => { /* non-critical — UI degrades gracefully */ })
      .finally(() => setTrapDefsLoading(false));
  }, []);

  // Clean up user-job Firestore listeners on unmount
  useEffect(() => {
    return () => {
      userJobUnsubsRef.current.forEach((unsub) => unsub());
      userJobUnsubsRef.current.clear();
    };
  }, []);

  async function saveFlSettings() {
    setFlSaving(true);
    setFlSaveMsg(null);
    try {
      const fns = getFunctions(undefined, "europe-west1");
      const update = httpsCallable(fns, "adminUpdateGameSettings");
      await update(flSettings);
      setFlSaveMsg("Saved!");
      setTimeout(() => setFlSaveMsg(null), 3000);
    } catch (e: unknown) {
      setFlSaveMsg("Error: " + ((e as Error).message ?? "Save failed"));
    } finally {
      setFlSaving(false);
    }
  }

  async function loadPlayers() {
    setPlayersLoading(true);
    setPlayersError(null);
    try {
      const fns = getFunctions(undefined, "europe-west1");
      const fn = httpsCallable<Record<string, never>, { ok: boolean; players: PlayerLocation[] }>(
        fns, "adminGetPlayerLocations"
      );
      const { data } = await fn({});
      setPlayers(data.players);
      setSelectedUids(new Set(data.players.map((p) => p.uid)));
    } catch (e: unknown) {
      setPlayersError((e as Error).message ?? "Failed to load players");
    } finally {
      setPlayersLoading(false);
    }
  }

  function togglePlayer(uid: string) {
    setSelectedUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  }

  const subscribeUserJob = useCallback((jobId: string, uid: string) => {
    const db = getFirestore();
    const unsub = onSnapshot(doc(db, "admin_trap_gen_jobs", jobId), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data() as { status: JobStatus; progress: JobProgress };
      setUserJobs((prev) => prev.map((j) =>
        j.jobId === jobId
          ? { ...j, status: d.status, pct: d.progress.percentComplete, message: d.progress.message }
          : j
      ));
      if (d.status === "completed" || d.status === "failed") {
        userJobUnsubsRef.current.get(jobId)?.();
        userJobUnsubsRef.current.delete(jobId);
      }
    });
    userJobUnsubsRef.current.set(jobId, unsub);
  }, []);

  async function handlePlaceNearUsers() {
    if (selectedUids.size === 0) { setUserJobsError("Select at least one user."); return; }
    setUserJobsRunning(true);
    setUserJobsError(null);
    setUserJobs([]);
    userJobUnsubsRef.current.forEach((u) => u());
    userJobUnsubsRef.current.clear();

    try {
      const fns = getFunctions(undefined, "europe-west1");
      const create = httpsCallable<Record<string, unknown>, {
        ok: boolean;
        jobs: { uid: string; username: string; lat: number; lng: number; jobId: string }[];
        skipped: { uid: string; reason: string }[];
      }>(fns, "adminTriggerUserLocationTrapGen");

      const { data } = await create({
        userIds: Array.from(selectedUids),
        trapCount: userJobCount,
        radiusMeters: userJobRadius,
        minSpacingMeters: userJobSpacing,
        expiryDays: userJobExpiry,
        dryRun: userJobDryRun,
      });

      const created: UserJob[] = data.jobs.map((j) => ({
        ...j, status: "queued" as JobStatus, pct: 0, message: "Queued…",
      }));
      setUserJobs(created);

      // Fire all job workers and subscribe to each for progress
      const runJob = httpsCallable(fns, "adminRunTrapGenJob");
      for (const j of created) {
        subscribeUserJob(j.jobId, j.uid);
        runJob({ jobId: j.jobId }).catch(() => {
          setUserJobs((prev) => prev.map((uj) =>
            uj.jobId === j.jobId ? { ...uj, status: "failed" } : uj
          ));
        });
      }
    } catch (e: unknown) {
      setUserJobsError((e as Error).message ?? "Failed to create jobs");
    } finally {
      setUserJobsRunning(false);
    }
  }

  // Fetch cities when country changes
  useEffect(() => {
    if (!selectedCountry) return;
    setCities([]);
    setSelectedCities(new Set());
    setCitiesError(null);
    setFallbackCity("");
    setCitiesLoading(true);

    const fns = getFunctions(undefined, "europe-west1");
    const fetchCities = httpsCallable<
      { countryName: string },
      { ok: boolean; cities: CityEntry[] }
    >(fns, "adminFetchCountryCities");

    fetchCities({ countryName: selectedCountry })
      .then(({ data }) => {
        const sorted = [...data.cities].sort((a, b) => b.population - a.population);
        setCities(sorted);
        setSelectedCities(new Set(sorted.map((c) => c.name)));
      })
      .catch((e: unknown) => {
        setCitiesError((e as Error).message ?? "Failed to fetch cities");
      })
      .finally(() => setCitiesLoading(false));
  }, [selectedCountry]);

  const filteredCountries = countrySearch
    ? WORLD_COUNTRIES.filter((c) => c.toLowerCase().includes(countrySearch.toLowerCase()))
    : WORLD_COUNTRIES;

  const filteredCities = citySearch
    ? cities.filter((c) => c.name.toLowerCase().includes(citySearch.toLowerCase()))
    : cities;

  function toggleCity(name: string) {
    setSelectedCities((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  async function handleStart() {
    setError(null);
    setJob(null);
    setJobId(null);
    setStarting(true);

    try {
      if (!selectedCountry) { setError("Please select a country."); setStarting(false); return; }

      const fns = getFunctions(undefined, "europe-west1");
      const ids = trapTypeIds.split(",").map((s) => s.trim()).filter(Boolean);
      const ageGroups = [
        ...(allowMinors ? ["minor"] : []),
        ...(allowAdults ? ["adult"] : []),
      ];

      // Determine mode and cityList
      let mode: "city" | "country";
      let locationName: string;
      let cityList: CityEntry[] | null = null;

      const checkedCities = cities.filter((c) => selectedCities.has(c.name));

      if (cities.length === 0 && fallbackCity.trim()) {
        // No OSM cities found — use typed city name in city mode
        mode = "city";
        locationName = fallbackCity.trim();
      } else if (checkedCities.length === 0) {
        setError("Please select at least one city."); setStarting(false); return;
      } else {
        mode = "country";
        locationName = selectedCountry;
        cityList = checkedCities;
      }

      const createJob = httpsCallable<Record<string, unknown>, { ok: boolean; jobId: string }>(
        fns, "adminCreateTrapGenJob"
      );
      const { data } = await createJob({
        mode, locationName, trapCount,
        minSpacingMeters, expiryDays, dryRun,
        trapTypeIds: ids,
        allowedAgeGroups: ageGroups.length > 0 ? ageGroups : ["minor", "adult"],
        cityList,
      });

      const newJobId = data.jobId;
      setJobId(newJobId);

      const runJob = httpsCallable(fns, "adminRunTrapGenJob");
      runJob({ jobId: newJobId }).catch((e: unknown) => {
        const msg = (e as Error).message ?? "Worker failed";
        setJob((prev) => prev ? { ...prev, status: "failed", error: msg } : null);
      });
    } catch (e: unknown) {
      setError((e as Error).message ?? "Failed to start job");
    } finally {
      setStarting(false);
    }
  }

  function handleReset() {
    unsubRef.current?.();
    unsubRef.current = null;
    setJobId(null);
    setJob(null);
    setError(null);
  }

  const isRunning  = job?.status === "queued" || job?.status === "running";
  const pct        = job?.progress.percentComplete ?? 0;
  const previewMap = job?.result?.preview ? groupBy(job.result.preview, (p) => p.trapTypeId) : null;

  return (
    <div style={{ padding: "24px 28px", color: "#0D1F33", maxWidth: 900 }}>

      {/* ── First-Login Auto-Placement Settings ───────────────────────────── */}
      <div style={{ ...card, marginBottom: 28, border: "1px solid #DCE4EE" }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
            First-Login Auto-Placement
          </h3>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "#3C516C", fontSize: "0.85rem" }}>
              {flSettings.firstLoginTrapGenEnabled ? "Enabled" : "Disabled"}
            </span>
            <div
              onClick={() => !flLoading && setFlSettings((s) => ({ ...s, firstLoginTrapGenEnabled: !s.firstLoginTrapGenEnabled }))}
              style={{
                width: 44, height: 24, borderRadius: 12,
                background: flSettings.firstLoginTrapGenEnabled ? "#178A55" : "#DCE4EE",
                position: "relative", cursor: flLoading ? "default" : "pointer",
                transition: "background 0.2s", flexShrink: 0,
              }}
            >
              <div style={{
                position: "absolute", top: 3,
                left: flSettings.firstLoginTrapGenEnabled ? 22 : 3,
                width: 18, height: 18, borderRadius: "50%",
                background: "#fff", transition: "left 0.2s",
              }} />
            </div>
          </div>
        </div>
        <p style={{ color: "#5F7491", margin: "0 0 16px", fontSize: "0.82rem" }}>
          When enabled, the system places traps near a new user's GPS location on their very first
          login after email verification. Idempotent — safe to call multiple times per user.
        </p>

        {flSettings.firstLoginTrapGenEnabled && (
          <>
            {/* ── Distance / spacing / expiry ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div>
                <label style={lbl}>Min distance from user (meters)</label>
                <input
                  type="number" style={inp}
                  value={flSettings.firstLoginTrapMinDistanceMeters} min={0} max={500}
                  onChange={(e) => setFlSettings((s) => ({
                    ...s, firstLoginTrapMinDistanceMeters: Math.max(0, Math.min(500, parseInt(e.target.value) || 0)),
                  }))}
                />
                <div style={{ fontSize: "0.75rem", color: "#5F7491", marginTop: 3 }}>
                  Inner exclusion zone — no trap closer than this (0 = directly next to user is OK)
                </div>
              </div>
              <div>
                <label style={lbl}>Max distance from user (meters)</label>
                <input
                  type="number" style={inp}
                  value={flSettings.firstLoginTrapRadiusMeters} min={50} max={50000}
                  onChange={(e) => setFlSettings((s) => ({
                    ...s, firstLoginTrapRadiusMeters: Math.max(50, Math.min(50000, parseInt(e.target.value) || 1000)),
                  }))}
                />
                <div style={{ fontSize: "0.75rem", color: "#5F7491", marginTop: 3 }}>
                  Outer radius — traps placed closest-first up to this distance
                </div>
              </div>
              <div>
                <label style={lbl}>Min spacing between traps (meters)</label>
                <input
                  type="number" style={inp}
                  value={flSettings.firstLoginTrapMinSpacingMeters} min={10} max={5000}
                  onChange={(e) => setFlSettings((s) => ({
                    ...s, firstLoginTrapMinSpacingMeters: Math.max(10, Math.min(5000, parseInt(e.target.value) || 150)),
                  }))}
                />
              </div>
              <div>
                <label style={lbl}>Trap expiry (days)</label>
                <input
                  type="number" style={inp}
                  value={flSettings.firstLoginTrapExpiryDays} min={1} max={365}
                  onChange={(e) => setFlSettings((s) => ({
                    ...s, firstLoginTrapExpiryDays: Math.max(1, Math.min(365, parseInt(e.target.value) || 30)),
                  }))}
                />
              </div>
            </div>

            {/* ── Trap type mode ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ ...lbl, marginBottom: 10 }}>Trap type assignment</div>
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                {(["random", "fixed"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setFlSettings((s) => ({ ...s, firstLoginTrapTypeMode: mode }))}
                    style={{
                      ...btnSecondary,
                      ...(flSettings.firstLoginTrapTypeMode === mode
                        ? { background: "#0B6C86", color: "#fff", border: "1px solid #0B6C86" }
                        : {}),
                      minWidth: 130,
                    }}
                  >
                    {mode === "random" ? "🎲 Random" : "🎯 Fixed per type"}
                  </button>
                ))}
              </div>

              {/* Random mode */}
              {flSettings.firstLoginTrapTypeMode === "random" && (
                <>
                  <div style={{ marginBottom: 10 }}>
                    <label style={lbl}>Total traps to place</label>
                    <input
                      type="number" style={{ ...inp, maxWidth: 140 }}
                      value={flSettings.firstLoginTrapCount} min={1} max={100}
                      onChange={(e) => setFlSettings((s) => ({
                        ...s, firstLoginTrapCount: Math.max(1, Math.min(100, parseInt(e.target.value) || 10)),
                      }))}
                    />
                  </div>
                  <div style={{ ...lbl, marginBottom: 8 }}>
                    Restrict to types{" "}
                    <span style={{ color: "#5F7491", textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>
                      — leave all unchecked to use every enabled type randomly
                    </span>
                  </div>
                  {trapDefsLoading ? (
                    <div style={{ color: "#5F7491", fontSize: "0.83rem" }}>Loading trap types…</div>
                  ) : trapDefs.length === 0 ? (
                    <div style={{ color: "#5F7491", fontSize: "0.83rem" }}>No trap definitions found.</div>
                  ) : (
                    <div style={{
                      display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8,
                    }}>
                      {trapDefs.map((def) => {
                        const checked = flSettings.firstLoginTrapTypeIds.includes(def.id);
                        return (
                          <div
                            key={def.id}
                            onClick={() => setFlSettings((s) => ({
                              ...s,
                              firstLoginTrapTypeIds: checked
                                ? s.firstLoginTrapTypeIds.filter((id) => id !== def.id)
                                : [...s.firstLoginTrapTypeIds, def.id],
                            }))}
                            style={{
                              display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                              borderRadius: 8, cursor: "pointer",
                              border: `1px solid ${checked ? "#0B6C86" : "#DCE4EE"}`,
                              background: checked ? "rgba(11,108,134,0.12)" : "#F4F7FB",
                            }}
                          >
                            <div style={{
                              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                              border: `2px solid ${checked ? "#0B6C86" : "#DCE4EE"}`,
                              background: checked ? "#0B6C86" : "transparent",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              {checked && (
                                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                  <path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                            </div>
                            <span style={{ fontSize: "0.85rem", color: checked ? "#0B6C86" : "#0D1F33" }}>
                              {def.name || def.id}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {flSettings.firstLoginTrapTypeIds.length === 0 && !trapDefsLoading && (
                    <div style={{ marginTop: 8, fontSize: "0.78rem", color: "#5F7491" }}>
                      All {trapDefs.length} enabled type{trapDefs.length !== 1 ? "s" : ""} will be used at random.
                    </div>
                  )}
                </>
              )}

              {/* Fixed mode */}
              {flSettings.firstLoginTrapTypeMode === "fixed" && (
                <>
                  <div style={{ fontSize: "0.82rem", color: "#5F7491", marginBottom: 12 }}>
                    Set an exact count for each trap type. Total traps = sum of all counts.
                    Types with count 0 are skipped.
                  </div>
                  {trapDefsLoading ? (
                    <div style={{ color: "#5F7491", fontSize: "0.83rem" }}>Loading trap types…</div>
                  ) : trapDefs.length === 0 ? (
                    <div style={{ color: "#5F7491", fontSize: "0.83rem" }}>No trap definitions found.</div>
                  ) : (
                    <>
                      <div style={{
                        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10, marginBottom: 10,
                      }}>
                        {trapDefs.map((def) => {
                          const entry = flSettings.firstLoginTrapTypeCounts.find((e) => e.trapTypeId === def.id);
                          const count = entry?.count ?? 0;
                          return (
                            <div
                              key={def.id}
                              style={{
                                display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                                borderRadius: 8,
                                border: `1px solid ${count > 0 ? "#0B6C86" : "#DCE4EE"}`,
                                background: count > 0 ? "rgba(11,108,134,0.08)" : "#F4F7FB",
                              }}
                            >
                              <span style={{ flex: 1, fontSize: "0.85rem", color: count > 0 ? "#0B6C86" : "#3C516C" }}>
                                {def.name || def.id}
                              </span>
                              <input
                                type="number"
                                value={count}
                                min={0} max={50}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const n = Math.max(0, Math.min(50, parseInt(e.target.value) || 0));
                                  setFlSettings((s) => {
                                    const next = s.firstLoginTrapTypeCounts.filter((x) => x.trapTypeId !== def.id);
                                    if (n > 0) next.push({ trapTypeId: def.id, count: n });
                                    return { ...s, firstLoginTrapTypeCounts: next };
                                  });
                                }}
                                style={{
                                  width: 60, background: "#F4F7FB", border: "1px solid #DCE4EE",
                                  borderRadius: 6, color: "#0D1F33", fontSize: "0.88rem",
                                  padding: "4px 8px", textAlign: "center",
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                      {(() => {
                        const total = flSettings.firstLoginTrapTypeCounts.reduce((s, e) => s + e.count, 0);
                        return (
                          <div style={{ fontSize: "0.83rem", color: total > 0 ? "#178A55" : "#5F7491" }}>
                            Total traps that will be placed: <strong>{total}</strong>
                            {total === 0 && " — set at least one count above"}
                          </div>
                        );
                      })()}
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 4 }}>
          <button
            style={{ ...btnPrimary, opacity: flSaving || flLoading ? 0.6 : 1 }}
            onClick={saveFlSettings}
            disabled={flSaving || flLoading}
          >
            {flSaving ? "Saving…" : "Save Settings"}
          </button>
          {flSaveMsg && (
            <span style={{
              fontSize: "0.85rem",
              color: flSaveMsg.startsWith("Error") ? "#C8283B" : "#178A55",
            }}>
              {flSaveMsg}
            </span>
          )}
        </div>
      </div>

      <h2 style={{ margin: "0 0 6px", fontSize: "1.3rem", fontWeight: 700 }}>
        Trap Placer
      </h2>
      <p style={{ color: "#5F7491", margin: "0 0 24px", fontSize: "0.9rem" }}>
        Select a country and the cities within it where you want traps placed. Checking a single
        city targets just that location. Runs as a background job with real-time progress.
      </p>

      {/* Country + city picker */}
      <div style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: cities.length > 0 || citiesLoading || citiesError ? 20 : 0 }}>

          {/* Country dropdown */}
          <div ref={countryDropRef} style={{ position: "relative" }}>
            <label style={lbl}>Country</label>
            <input
              style={inp}
              value={selectedCountry && !countrySearch ? selectedCountry : countrySearch}
              onChange={(e) => {
                setCountrySearch(e.target.value);
                setShowCountryList(true);
                if (!e.target.value) setSelectedCountry("");
              }}
              onFocus={() => setShowCountryList(true)}
              placeholder="Search country…"
            />
            {showCountryList && filteredCountries.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "100%", left: 0, right: 0,
                  maxHeight: 240, overflowY: "auto",
                  background: "#F4F7FB",
                  border: "1px solid #DCE4EE",
                  borderRadius: 8,
                  zIndex: 100,
                  marginTop: 4,
                }}
              >
                {filteredCountries.map((c) => (
                  <div
                    key={c}
                    onClick={() => {
                      setSelectedCountry(c);
                      setCountrySearch("");
                      setShowCountryList(false);
                    }}
                    style={{
                      padding: "9px 14px",
                      cursor: "pointer",
                      color: c === selectedCountry ? "#0B6C86" : "#0D1F33",
                      background: c === selectedCountry ? "#F4F7FB" : "transparent",
                      fontSize: "0.88rem",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#F4F7FB"; }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background =
                        c === selectedCountry ? "#F4F7FB" : "transparent";
                    }}
                  >
                    {c}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Trap count */}
          <div>
            <label style={lbl}>Trap count (max 500)</label>
            <input
              type="number" style={inp} value={trapCount} min={1} max={500}
              onChange={(e) => setTrapCount(Math.max(1, Math.min(500, parseInt(e.target.value) || 1)))}
            />
          </div>
        </div>

        {/* City list */}
        {selectedCountry && (
          <>
            {citiesLoading && (
              <div style={{ color: "#5F7491", fontSize: "0.88rem", padding: "10px 0" }}>
                ⏳ Loading cities in {selectedCountry}…
              </div>
            )}

            {citiesError && (
              <div style={{ color: "#C8283B", fontSize: "0.85rem", padding: "8px 0" }}>
                ❌ {citiesError}
              </div>
            )}

            {!citiesLoading && cities.length > 0 && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={lbl}>
                    Cities in {selectedCountry}
                    <span style={{ color: "#5F7491", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                      {" "}— {selectedCities.size} / {cities.length} selected
                    </span>
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      style={{ ...btnSecondary, padding: "5px 14px", fontSize: "0.78rem" }}
                      onClick={() => setSelectedCities(new Set(cities.map((c) => c.name)))}
                    >
                      Select all
                    </button>
                    <button
                      style={{ ...btnSecondary, padding: "5px 14px", fontSize: "0.78rem" }}
                      onClick={() => setSelectedCities(new Set())}
                    >
                      Deselect all
                    </button>
                  </div>
                </div>
                <input
                  style={{ ...inp, marginBottom: 10 }}
                  value={citySearch}
                  onChange={(e) => setCitySearch(e.target.value)}
                  placeholder="Filter cities…"
                />
                <div
                  style={{
                    maxHeight: 280, overflowY: "auto",
                    background: "#F4F7FB",
                    borderRadius: 8, border: "1px solid #DCE4EE",
                  }}
                >
                  {filteredCities.map((city) => {
                    const checked = selectedCities.has(city.name);
                    return (
                      <div
                        key={city.name}
                        onClick={() => toggleCity(city.name)}
                        style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "9px 14px", cursor: "pointer",
                          borderBottom: "1px solid #F4F7FB",
                          background: checked ? "rgba(11,108,134,0.08)" : "transparent",
                        }}
                      >
                        <div
                          style={{
                            width: 16, height: 16, borderRadius: 4,
                            border: `2px solid ${checked ? "#0B6C86" : "#DCE4EE"}`,
                            background: checked ? "#0B6C86" : "transparent",
                            flexShrink: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}
                        >
                          {checked && (
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                              <path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                        <span style={{ flex: 1, color: "#0D1F33", fontSize: "0.88rem" }}>{city.name}</span>
                        {city.population > 0 && (
                          <span style={{ color: "#5F7491", fontSize: "0.75rem", fontFamily: "monospace" }}>
                            {city.population >= 1_000_000
                              ? `${(city.population / 1_000_000).toFixed(1)}M`
                              : city.population >= 1_000
                              ? `${Math.round(city.population / 1_000)}k`
                              : String(city.population)}
                          </span>
                        )}
                        <span style={{ color: "#DCE4EE", fontSize: "0.72rem", fontFamily: "monospace" }}>
                          {city.lat.toFixed(2)}, {city.lng.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {!citiesLoading && !citiesError && cities.length === 0 && (
              <div>
                <p style={{ color: "#5F7491", fontSize: "0.85rem", margin: "0 0 10px" }}>
                  No cities found via OpenStreetMap for {selectedCountry}. Type a city name
                  below to place traps there directly.
                </p>
                <input
                  style={inp}
                  value={fallbackCity}
                  onChange={(e) => setFallbackCity(e.target.value)}
                  placeholder="City name (e.g. Budapest)"
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Spacing + expiry */}
      <div style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <label style={lbl}>Min spacing between traps (meters)</label>
            <input
              type="number" style={inp} value={minSpacingMeters} min={10} max={5000}
              onChange={(e) =>
                setMinSpacingMeters(Math.max(10, Math.min(5000, parseInt(e.target.value) || 100)))
              }
            />
            <p style={{ color: "#5F7491", fontSize: "0.78rem", margin: "6px 0 0" }}>
              Also respects spacing vs. all existing active traps.
            </p>
          </div>
          <div>
            <label style={lbl}>Expiry (days from now)</label>
            <input
              type="number" style={inp} value={expiryDays} min={1} max={365}
              onChange={(e) =>
                setExpiryDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 30)))
              }
            />
          </div>
        </div>
      </div>

      {/* Trap types */}
      <div style={card}>
        <label style={lbl}>Trap type IDs (optional — leave blank for all)</label>
        <input
          style={inp} value={trapTypeIds}
          onChange={(e) => setTrapTypeIds(e.target.value)}
          placeholder="e.g. freeze_trap, slowdown_trap  (comma-separated)"
        />
        <p style={{ color: "#5F7491", fontSize: "0.78rem", margin: "6px 0 0" }}>
          Types assigned round-robin. Leave empty to use all enabled types.
        </p>
      </div>

      {/* Age groups */}
      <div style={card}>
        <span style={lbl}>Allowed age groups</span>
        <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
          {(
            [
              { key: "minor", label: "👶 Minors", state: allowMinors, set: setAllowMinors },
              { key: "adult", label: "🧑 Adults", state: allowAdults, set: setAllowAdults },
            ] as const
          ).map(({ key, label, state, set }) => (
            <button
              key={key}
              onClick={() => set((v) => !v)}
              style={{
                ...btnSecondary,
                ...(state ? { background: "#0B6C86", color: "#fff", border: "1px solid #0B6C86" } : {}),
                minWidth: 130,
              }}
            >
              {state ? "✅ " : "⬜ "}{label}
            </button>
          ))}
        </div>
        {!allowMinors && !allowAdults && (
          <p style={{ color: "#C8283B", fontSize: "0.8rem", margin: "8px 0 0" }}>
            ⚠️ At least one age group must be selected. Defaulting to both.
          </p>
        )}
      </div>

      {/* Dry run toggle */}
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 16 }}>
        <div
          onClick={() => setDryRun((v) => !v)}
          style={{
            width: 44, height: 24, borderRadius: 12,
            background: dryRun ? "#0B6C86" : "#DCE4EE",
            position: "relative", cursor: "pointer", transition: "background 0.2s",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: "absolute", top: 3,
              left: dryRun ? 22 : 3,
              width: 18, height: 18, borderRadius: "50%",
              background: "#fff", transition: "left 0.2s",
            }}
          />
        </div>
        <span
          style={{ color: "#0D1F33", fontWeight: 600, cursor: "pointer" }}
          onClick={() => setDryRun((v) => !v)}
        >
          {dryRun
            ? "🔍 Dry run — preview only, no traps written"
            : "⚡ Live run — will create traps in Firestore"}
        </span>
      </div>

      {/* Action */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <button
          style={{ ...btnPrimary, opacity: starting || isRunning ? 0.6 : 1 }}
          onClick={handleStart}
          disabled={starting || isRunning}
        >
          {starting ? "Starting…" : isRunning ? "⏳ Running…" : dryRun ? "🔍 Preview Placement" : "⚡ Generate Traps"}
        </button>
        {(jobId || error) && (
          <button style={btnSecondary} onClick={handleReset}>Reset</button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.4)",
            borderRadius: 8, padding: "12px 16px", color: "#C8283B", marginBottom: 20,
          }}
        >
          ❌ {error}
        </div>
      )}

      {/* Progress card */}
      {job && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
              {job.status === "queued"    && "⏳ Queued"}
              {job.status === "running"   && "⚙️ Running"}
              {job.status === "completed" && (job.dryRun ? "🔍 Dry Run Complete" : "✅ Traps Created")}
              {job.status === "failed"    && "❌ Failed"}
            </h3>
            {jobId && (
              <span style={{ color: "#5F7491", fontSize: "0.72rem", fontFamily: "monospace" }}>{jobId}</span>
            )}
          </div>

          <div style={{ height: 8, background: "#F4F7FB", borderRadius: 4, marginBottom: 8, overflow: "hidden" }}>
            <div
              style={{
                height: "100%", width: `${pct}%`, borderRadius: 4, transition: "width 0.4s ease",
                background: job.status === "failed" ? "#C8283B" : job.status === "completed" ? "#178A55" : "#0B6C86",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ color: "#3C516C", fontSize: "0.85rem" }}>{job.progress.message}</span>
            <span style={{ color: "#5F7491", fontSize: "0.78rem" }}>
              {pct}%
              {job.progress.estimatedSecondsRemaining != null && job.status === "running" &&
                ` · ~${formatSeconds(job.progress.estimatedSecondsRemaining)} left`}
            </span>
          </div>

          {job.status === "failed" && job.error && (
            <div
              style={{
                marginTop: 12, padding: "10px 14px",
                background: "rgba(220,38,38,0.1)", borderRadius: 8,
                color: "#C8283B", fontSize: "0.85rem",
              }}
            >
              {job.error}
            </div>
          )}

          {job.status === "completed" && job.result && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 16, marginBottom: 16 }}>
                <Stat label="Candidates" value={job.result.candidates} />
                <Stat label="Placed"     value={job.result.placed} />
                <Stat label="Time"       value={`${job.result.elapsedSeconds}s`} />
              </div>

              {previewMap && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ color: "#5F7491", fontSize: "0.75rem", marginBottom: 6 }}>TYPE DISTRIBUTION</div>
                  {Object.entries(previewMap).map(([typeId, pts]) => (
                    <span key={typeId} style={tag}>{typeId}: {pts.length}</span>
                  ))}
                </div>
              )}

              {job.result.cityBreakdown && job.result.cityBreakdown.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ color: "#5F7491", fontSize: "0.75rem", marginBottom: 6 }}>CITIES</div>
                  {job.result.cityBreakdown.map((c) => (
                    <span key={c.city} style={{ ...tag, background: "#F4F7FB" }}>{c.city}: {c.count}</span>
                  ))}
                </div>
              )}

              <div style={{ color: "#5F7491", fontSize: "0.75rem", marginBottom: 6 }}>
                PLACEMENT PREVIEW (first 50 of {job.result.placed})
              </div>
              <div style={{ maxHeight: 280, overflowY: "auto", background: "#F4F7FB", borderRadius: 8, border: "1px solid #DCE4EE" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #DCE4EE" }}>
                      {["#", "Lat", "Lng", "Type"].map((h) => (
                        <th key={h} style={{ padding: "8px 12px", color: "#5F7491", textAlign: "left", fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {job.result.preview.slice(0, 50).map((p, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #F4F7FB", background: i % 2 === 0 ? "transparent" : "#F4F7FB" }}>
                        <td style={{ padding: "7px 12px", color: "#5F7491" }}>{i + 1}</td>
                        <td style={{ padding: "7px 12px", color: "#0D1F33", fontFamily: "monospace" }}>{p.lat.toFixed(6)}</td>
                        <td style={{ padding: "7px 12px", color: "#0D1F33", fontFamily: "monospace" }}>{p.lng.toFixed(6)}</td>
                        <td style={{ padding: "7px 12px", color: "#0B6C86" }}>{p.trapTypeId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!job.dryRun && (
                <div
                  style={{
                    marginTop: 14, padding: "10px 14px",
                    background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)",
                    borderRadius: 8, color: "#178A55", fontSize: "0.85rem",
                  }}
                >
                  ✅ {job.result.placed} traps are now active in Firestore and visible to players in {job.locationName}.
                </div>
              )}
            </>
          )}
        </div>
      )}
      {/* ── Place Traps Near Users ────────────────────────────────────────── */}
      <div style={{ ...card, marginTop: 32, border: "1px solid #DCE4EE" }}>
        <h3 style={{ margin: "0 0 6px", fontSize: "1rem", fontWeight: 700 }}>
          Place Traps Near Users' Last Known Locations
        </h3>
        <p style={{ color: "#5F7491", margin: "0 0 16px", fontSize: "0.82rem" }}>
          Load players with a known location, select individuals or all of them, configure the
          placement parameters, then fire one job per user. All jobs run in parallel — each shows
          live progress below.
        </p>

        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <button
            style={{ ...btnPrimary, opacity: playersLoading ? 0.6 : 1 }}
            onClick={loadPlayers}
            disabled={playersLoading}
          >
            {playersLoading ? "Loading…" : players.length > 0 ? "Reload Players" : "Load Players with Locations"}
          </button>
          {players.length > 0 && (
            <>
              <button
                style={{ ...btnSecondary, padding: "10px 16px", fontSize: "0.82rem" }}
                onClick={() => setSelectedUids(new Set(players.map((p) => p.uid)))}
              >
                Select All ({players.length})
              </button>
              <button
                style={{ ...btnSecondary, padding: "10px 16px", fontSize: "0.82rem" }}
                onClick={() => setSelectedUids(new Set())}
              >
                None
              </button>
            </>
          )}
        </div>

        {playersError && (
          <div style={{ color: "#C8283B", fontSize: "0.85rem", marginBottom: 12 }}>❌ {playersError}</div>
        )}

        {players.length > 0 && (
          <>
            <input
              style={{ ...inp, marginBottom: 10 }}
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
              placeholder="Filter by username…"
            />
            <div style={{
              maxHeight: 260, overflowY: "auto",
              background: "#F4F7FB", borderRadius: 8, border: "1px solid #DCE4EE",
              marginBottom: 20,
            }}>
              {players
                .filter((p) => !playerSearch || p.username.toLowerCase().includes(playerSearch.toLowerCase()))
                .map((p) => {
                  const checked = selectedUids.has(p.uid);
                  const updatedAgo = p.updatedAtMs
                    ? Math.round((Date.now() - p.updatedAtMs) / 60000)
                    : null;
                  return (
                    <div
                      key={p.uid}
                      onClick={() => togglePlayer(p.uid)}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "9px 14px", cursor: "pointer",
                        borderBottom: "1px solid #F4F7FB",
                        background: checked ? "rgba(11,108,134,0.08)" : "transparent",
                      }}
                    >
                      <div style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                        border: `2px solid ${checked ? "#0B6C86" : "#DCE4EE"}`,
                        background: checked ? "#0B6C86" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {checked && (
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                            <path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <span style={{ flex: 1, color: "#0D1F33", fontSize: "0.88rem", fontWeight: 600 }}>
                        {p.username}
                      </span>
                      <span style={{ color: "#5F7491", fontSize: "0.75rem", fontFamily: "monospace" }}>
                        {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                      </span>
                      {updatedAgo !== null && (
                        <span style={{ color: "#DCE4EE", fontSize: "0.72rem" }}>
                          {updatedAgo < 60 ? `${updatedAgo}m ago` : `${Math.round(updatedAgo / 60)}h ago`}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>

            {/* Per-job placement settings */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div>
                <label style={lbl}>Traps per user</label>
                <input type="number" style={inp} value={userJobCount} min={1} max={100}
                  onChange={(e) => setUserJobCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 10)))}
                />
              </div>
              <div>
                <label style={lbl}>Max distance from user (meters)</label>
                <input type="number" style={inp} value={userJobRadius} min={50} max={50000}
                  onChange={(e) => setUserJobRadius(Math.max(50, Math.min(50000, parseInt(e.target.value) || 1000)))}
                />
              </div>
              <div>
                <label style={lbl}>Min spacing (meters)</label>
                <input type="number" style={inp} value={userJobSpacing} min={10} max={5000}
                  onChange={(e) => setUserJobSpacing(Math.max(10, Math.min(5000, parseInt(e.target.value) || 150)))}
                />
              </div>
              <div>
                <label style={lbl}>Expiry (days)</label>
                <input type="number" style={inp} value={userJobExpiry} min={1} max={365}
                  onChange={(e) => setUserJobExpiry(Math.max(1, Math.min(365, parseInt(e.target.value) || 30)))}
                />
              </div>
            </div>

            {/* Dry-run toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div
                onClick={() => setUserJobDryRun((v) => !v)}
                style={{
                  width: 44, height: 24, borderRadius: 12,
                  background: userJobDryRun ? "#0B6C86" : "#DCE4EE",
                  position: "relative", cursor: "pointer", transition: "background 0.2s",
                }}
              >
                <div style={{
                  position: "absolute", top: 3,
                  left: userJobDryRun ? 22 : 3,
                  width: 18, height: 18, borderRadius: "50%",
                  background: "#fff", transition: "left 0.2s",
                }} />
              </div>
              <span
                style={{ color: "#0D1F33", fontWeight: 600, cursor: "pointer", fontSize: "0.9rem" }}
                onClick={() => setUserJobDryRun((v) => !v)}
              >
                {userJobDryRun ? "🔍 Dry run — preview only" : "⚡ Live run — will write traps"}
              </span>
            </div>

            {userJobsError && (
              <div style={{
                background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.4)",
                borderRadius: 8, padding: "10px 14px", color: "#C8283B", fontSize: "0.85rem",
                marginBottom: 12,
              }}>
                ❌ {userJobsError}
              </div>
            )}

            <button
              style={{
                ...btnPrimary,
                opacity: userJobsRunning || selectedUids.size === 0 ? 0.6 : 1,
                background: userJobDryRun ? "#0B6C86" : "#178A55",
              }}
              onClick={handlePlaceNearUsers}
              disabled={userJobsRunning || selectedUids.size === 0}
            >
              {userJobsRunning
                ? "Creating jobs…"
                : userJobDryRun
                ? `🔍 Preview for ${selectedUids.size} user${selectedUids.size === 1 ? "" : "s"}`
                : `⚡ Place traps for ${selectedUids.size} user${selectedUids.size === 1 ? "" : "s"}`}
            </button>
          </>
        )}

        {/* Per-user job progress list */}
        {userJobs.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ color: "#5F7491", fontSize: "0.75rem", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Job Status ({userJobs.length} jobs)
            </div>
            {userJobs.map((j) => (
              <div key={j.jobId} style={{
                background: "#F4F7FB", borderRadius: 8, border: "1px solid #DCE4EE",
                padding: "12px 14px", marginBottom: 8,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div>
                    <span style={{ fontWeight: 600, color: "#0D1F33", fontSize: "0.88rem" }}>{j.username}</span>
                    <span style={{ color: "#5F7491", fontSize: "0.75rem", marginLeft: 10, fontFamily: "monospace" }}>
                      {j.lat.toFixed(4)}, {j.lng.toFixed(4)}
                    </span>
                  </div>
                  <span style={{
                    fontSize: "0.72rem", padding: "2px 8px", borderRadius: 4, fontWeight: 600,
                    background: j.status === "completed" ? "rgba(34,197,94,0.15)"
                      : j.status === "failed" ? "rgba(220,38,38,0.15)"
                      : j.status === "running" ? "rgba(11,108,134,0.15)"
                      : "rgba(71,85,105,0.3)",
                    color: j.status === "completed" ? "#178A55"
                      : j.status === "failed" ? "#C8283B"
                      : j.status === "running" ? "#0B6C86"
                      : "#3C516C",
                  }}>
                    {j.status === "completed" ? "✅ Done"
                      : j.status === "failed" ? "❌ Failed"
                      : j.status === "running" ? "⚙️ Running"
                      : "⏳ Queued"}
                  </span>
                </div>
                <div style={{ height: 5, background: "#F4F7FB", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", width: `${j.pct ?? 0}%`, borderRadius: 4, transition: "width 0.4s ease",
                    background: j.status === "failed" ? "#C8283B"
                      : j.status === "completed" ? "#178A55" : "#0B6C86",
                  }} />
                </div>
                {j.message && (
                  <div style={{ color: "#5F7491", fontSize: "0.75rem", marginTop: 4 }}>{j.message}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Stat({ label: l, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: "#F4F7FB", borderRadius: 8, padding: "12px 14px", border: "1px solid #DCE4EE" }}>
      <div style={{ color: "#5F7491", fontSize: "0.72rem", fontWeight: 600, marginBottom: 4, textTransform: "uppercase" }}>{l}</div>
      <div style={{ color: "#0D1F33", fontSize: "1.4rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const k = key(item);
    (result[k] ??= []).push(item);
  }
  return result;
}
