import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { geohashForLocation } from "geofire-common";
import { writeAuditLog } from "./adminAuditLog";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { requireAppCheck } from "./shared/appCheck";
import { CITIES_BY_COUNTRY, type CityEntry } from "./citiesData";

// Multiple Overpass endpoints — tried in order, first successful response wins
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter",
];
const JOBS_COLLECTION = "admin_trap_gen_jobs";

// ─── Types ────────────────────────────────────────────────────────────────────

type LatLng = { lat: number; lng: number };

type TrapDefRow = {
  id: string;
  iconKey?: string;
  effectKind?: string;
  effectValue?: number;
  radiusMeters?: number;
  disarmRadiusMeters?: number;
  visibility?: string;
  ownerCanTrigger?: boolean;
  allowedAgeGroups?: string[];
};

type JobProgress = {
  phase: string;
  message: string;
  processed: number;
  total: number;
  percentComplete: number;
  estimatedSecondsRemaining?: number;
};

// ─── Geo helpers ──────────────────────────────────────────────────────────────

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Sort candidates closest-first relative to a centre point. */
function sortByDistance(candidates: LatLng[], centerLat: number, centerLng: number): LatLng[] {
  return [...candidates].sort(
    (a, b) =>
      haversineMeters(centerLat, centerLng, a.lat, a.lng) -
      haversineMeters(centerLat, centerLng, b.lat, b.lng)
  );
}

function filterBySpacing(
  candidates: LatLng[],
  minSpacingMeters: number,
  existing: LatLng[]
): LatLng[] {
  const accepted: LatLng[] = [...existing];
  const filtered: LatLng[] = [];
  for (const pt of candidates) {
    const tooClose = accepted.some(
      (a) => haversineMeters(pt.lat, pt.lng, a.lat, a.lng) < minSpacingMeters
    );
    if (!tooClose) {
      filtered.push(pt);
      accepted.push(pt);
    }
  }
  return filtered;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Overpass helpers ─────────────────────────────────────────────────────────

async function overpassPost(query: string): Promise<unknown[]> {
  let lastErr: unknown;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(35_000),
      });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      const json = (await res.json()) as { elements?: unknown[] };
      return json.elements ?? [];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function toLatLngs(elements: unknown[]): LatLng[] {
  return (elements as Array<{ lat?: number; lon?: number }>)
    .filter((e) => typeof e.lat === "number" && typeof e.lon === "number")
    .map((e) => ({ lat: e.lat!, lng: e.lon! }));
}

// Node type selector reused in every city query
const HIGHWAY_NODE_FILTER =
  `["highway"~"^(traffic_signals|crossing|junction|turning_circle|mini_roundabout|bus_stop)$"]`;

async function fetchRoadNodesForCity(cityName: string): Promise<LatLng[]> {
  // Strategy 1: administrative boundary area — works for capitals and most major
  // cities (Budapest, Vienna, Warsaw…). OSM marks these with boundary=administrative
  // rather than place=city on the area relation.
  try {
    const q = `[out:json][timeout:30];
area["name"="${cityName}"]["boundary"="administrative"]->.a;
(
  node(area.a)${HIGHWAY_NODE_FILTER};
  node(area.a)["place"="square"];
);
out body;`;
    const pts = toLatLngs(await overpassPost(q));
    if (pts.length >= 5) return pts;
  } catch { /* fall through */ }

  // Strategy 2: place area — works for smaller cities and towns where the OSM
  // relation carries place=city|town|village instead of boundary=administrative.
  try {
    const q = `[out:json][timeout:30];
area["name"="${cityName}"]["place"~"^(city|town|village|municipality)$"]->.a;
(
  node(area.a)${HIGHWAY_NODE_FILTER};
  node(area.a)["place"="square"];
);
out body;`;
    const pts = toLatLngs(await overpassPost(q));
    if (pts.length >= 5) return pts;
  } catch { /* fall through */ }

  // Strategy 3: Nominatim geocode → radius search around centroid
  try {
    const nomUrl =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(cityName)}&featuretype=city&format=json&limit=3`;
    const nomRes = await fetch(nomUrl, {
      headers: { "User-Agent": "TrapApp-AdminTool/1.0", "Accept-Language": "en" },
      signal: AbortSignal.timeout(10_000),
    });
    if (nomRes.ok) {
      const nomData = await nomRes.json() as Array<{ lat?: string; lon?: string }>;
      if (nomData.length > 0) {
        const lat = parseFloat(nomData[0].lat ?? "");
        const lng = parseFloat(nomData[0].lon ?? "");
        if (isFinite(lat) && isFinite(lng)) {
          const radiusQ = `[out:json][timeout:30];
(
  node(around:15000,${lat},${lng})${HIGHWAY_NODE_FILTER};
  node(around:15000,${lat},${lng})["place"="square"];
);
out body;`;
          const pts = toLatLngs(await overpassPost(radiusQ));
          if (pts.length >= 5) return pts;

          // Synthetic grid centred on the geocoded point
          const grid: LatLng[] = [];
          for (let dlat = -5; dlat <= 5; dlat++) {
            for (let dlng = -5; dlng <= 5; dlng++) {
              grid.push({ lat: lat + dlat * 0.005, lng: lng + dlng * 0.005 });
            }
          }
          return grid;
        }
      }
    }
  } catch { /* give up */ }

  return [];
}


async function fetchCitiesWithCoords(countryName: string): Promise<CityEntry[]> {
  type OsmNode = { lat?: number; lon?: number; tags?: { name?: string; population?: string } };

  function parseNodes(elements: unknown[]): CityEntry[] {
    const raw = (elements as OsmNode[])
      .filter((e) => typeof e.lat === "number" && typeof e.lon === "number" && e.tags?.name)
      .map((e) => ({
        name: e.tags!.name!,
        lat: e.lat!,
        lng: e.lon!,
        population: parseInt(e.tags?.population ?? "0") || 0,
      }));
    const seen = new Set<string>();
    const unique: CityEntry[] = [];
    for (const c of raw.sort((a, b) => b.population - a.population)) {
      if (!seen.has(c.name)) { seen.add(c.name); unique.push(c); }
    }
    return unique;
  }

  const placeFilter = `["place"~"^(city|town|capital)$"]["name"]`;

  // Strategy 1: Nominatim → exact OSM relation ID → area(id) Overpass query.
  // This is the most reliable approach — no name-matching ambiguity.
  try {
    const nomUrl =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(countryName)}&featuretype=country&format=json&limit=5`;
    const nomRes = await fetch(nomUrl, {
      headers: {
        "User-Agent": "TrapApp-AdminTool/1.0",
        "Accept-Language": "en",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (nomRes.ok) {
      const nomData = await nomRes.json() as Array<{
        osm_type?: string; osm_id?: number; class?: string; type?: string;
      }>;
      const rel = nomData.find(
        (r) => r.osm_type === "relation" &&
               (r.class === "boundary" || r.type === "administrative" || r.class === "place")
      );
      if (rel?.osm_id) {
        const areaId = 3_600_000_000 + rel.osm_id;
        logger.info(`[fetchCities] Nominatim found relation ${rel.osm_id} for "${countryName}", area ${areaId}`);
        const q = `[out:json][timeout:60];\narea(${areaId})->.ca;\nnode(area.ca)${placeFilter};\nout body;`;
        const elements = await overpassPost(q);
        if (elements.length >= 1) {
          logger.info(`[fetchCities] Nominatim+Overpass: ${elements.length} cities for "${countryName}"`);
          return parseNodes(elements);
        }
      }
    }
  } catch (e) {
    logger.warn(`[fetchCities] Nominatim strategy failed for "${countryName}":`, e);
  }

  // Strategy 2: area by English name (name:en), admin_level=2
  try {
    const q = `[out:json][timeout:60];\narea["name:en"="${countryName}"]["admin_level"="2"]->.ca;\nnode(area.ca)${placeFilter};\nout body;`;
    const elements = await overpassPost(q);
    if (elements.length >= 1) {
      logger.info(`[fetchCities] name:en strategy: ${elements.length} cities for "${countryName}"`);
      return parseNodes(elements);
    }
  } catch { /* try next */ }

  // Strategy 3: native name, admin_level=2
  try {
    const q = `[out:json][timeout:60];\narea["name"="${countryName}"]["admin_level"="2"]->.ca;\nnode(area.ca)${placeFilter};\nout body;`;
    const elements = await overpassPost(q);
    if (elements.length >= 1) {
      logger.info(`[fetchCities] native-name strategy: ${elements.length} cities for "${countryName}"`);
      return parseNodes(elements);
    }
  } catch { /* give up */ }

  logger.warn(`[fetchCities] all strategies returned 0 cities for "${countryName}"`);
  return [];
}

// Kept for legacy country-mode without pre-fetched cities
async function fetchCitiesInCountry(
  countryName: string
): Promise<{ name: string; population: number }[]> {
  return fetchCitiesWithCoords(countryName);
}

// Radius-based node fetch — used when city coordinates are already known.
// Falls back to a synthetic street grid if all Overpass endpoints fail (e.g. 429).
async function fetchRoadNodesAroundPoint(
  lat: number,
  lng: number,
  radiusMeters = 12_000
): Promise<LatLng[]> {
  const q = `[out:json][timeout:30];
(
  node(around:${radiusMeters},${lat},${lng})${HIGHWAY_NODE_FILTER};
  node(around:${radiusMeters},${lat},${lng})["place"="square"];
);
out body;`;
  try {
    const pts = toLatLngs(await overpassPost(q));
    if (pts.length > 0) return pts;
  } catch (e) {
    logger.warn(`[fetchRoadNodes] Overpass failed for (${lat},${lng}): ${e}`);
  }

  // Synthetic grid fallback — 25×25 points covering ~radiusMeters around center.
  // Each step ≈ 0.009° ≈ 1 km, giving enough spread for spacing filters.
  logger.info(`[fetchRoadNodes] using synthetic grid fallback for (${lat},${lng})`);
  const stepDeg = (radiusMeters / 111_000) * 0.8;
  const half = 12;
  const grid: LatLng[] = [];
  for (let dlat = -half; dlat <= half; dlat++) {
    for (let dlng = -half; dlng <= half; dlng++) {
      grid.push({ lat: lat + dlat * stepDeg, lng: lng + dlng * stepDeg });
    }
  }
  return grid;
}

// ─── Job progress updater ─────────────────────────────────────────────────────

async function updateJobProgress(
  jobId: string,
  progress: JobProgress,
  extra?: Record<string, unknown>
): Promise<void> {
  try {
    await getDb()
      .collection(JOBS_COLLECTION)
      .doc(jobId)
      .update({ progress, status: "running", ...extra });
  } catch (e) {
    logger.warn(`[trapGen] progress update failed for ${jobId}:`, e);
  }
}

// ─── Shared placement helper (used by inline first-login gen + job worker) ───

type PlacementConfig = {
  ownerUid: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  minDistanceMeters?: number;       // inner exclusion radius — no traps closer than this
  trapCount: number;
  minSpacingMeters: number;
  expiryDays: number;
  dryRun: boolean;
  allowedAgeGroups: ("minor" | "adult")[];
  trapTypeIds: string[];
  orderedTrapTypeIds?: string[];    // fixed-mode: pre-expanded list, index maps to slot
  generatorLabel: string;
};

type PlacementResult = {
  placed: number;
  candidates: number;
  preview: { lat: number; lng: number; trapTypeId: string }[];
  elapsedSeconds: number;
};

async function runPlacementAtPoint(cfg: PlacementConfig): Promise<PlacementResult> {
  const startMs = Date.now();
  const db = getDb();

  const defsSnap = await db.collection("trap_definitions").get();
  const allDefs = defsSnap.docs
    .filter((d) => d.data().enabled !== false)
    .map((d) => ({ id: d.id, ...d.data() } as TrapDefRow));

  const defs = cfg.trapTypeIds.length > 0
    ? allDefs.filter((t) => cfg.trapTypeIds.includes(t.id))
    : allDefs;

  if (defs.length === 0) throw new Error("No enabled trap definitions found");

  const rawCandidates = await fetchRoadNodesAroundPoint(cfg.lat, cfg.lng, cfg.radiusMeters);
  if (rawCandidates.length === 0) throw new Error("No road nodes found near location");

  // Apply inner exclusion radius — drop candidates that are too close to the user
  const filteredByMinDist = (cfg.minDistanceMeters && cfg.minDistanceMeters > 0)
    ? rawCandidates.filter(
        (pt) => haversineMeters(cfg.lat, cfg.lng, pt.lat, pt.lng) >= cfg.minDistanceMeters!
      )
    : rawCandidates;

  if (filteredByMinDist.length === 0) {
    throw new Error(
      `No road nodes found outside the ${cfg.minDistanceMeters}m minimum distance. ` +
      `Try reducing the minimum distance or increasing the outer radius.`
    );
  }

  const existingSnap = await db
    .collection("traps")
    .where("status", "==", "active")
    .select("lat", "lng")
    .limit(2000)
    .get();
  const existingLocs: LatLng[] = existingSnap.docs
    .map((d) => ({ lat: d.data().lat as number, lng: d.data().lng as number }))
    .filter((p) => typeof p.lat === "number" && typeof p.lng === "number");

  // Sort closest-first so traps are placed as near the user as possible,
  // then apply spacing to keep them from bunching.
  const chosen = filterBySpacing(
    sortByDistance(filteredByMinDist, cfg.lat, cfg.lng),
    cfg.minSpacingMeters,
    existingLocs
  ).slice(0, cfg.trapCount);

  if (chosen.length === 0) {
    throw new Error(`All candidates within ${cfg.minSpacingMeters}m of existing traps`);
  }

  function getTrapTypeIdAt(idx: number): string {
    if (cfg.orderedTrapTypeIds && cfg.orderedTrapTypeIds.length > 0) {
      return cfg.orderedTrapTypeIds[Math.min(idx, cfg.orderedTrapTypeIds.length - 1)];
    }
    return defs[idx % defs.length].id;
  }

  const preview = chosen.map((pt, i) => ({
    lat: pt.lat, lng: pt.lng, trapTypeId: getTrapTypeIdAt(i),
  }));

  if (!cfg.dryRun) {
    const dateKey = todayKey();
    const expiresAt = Timestamp.fromMillis(Date.now() + cfg.expiryDays * 24 * 60 * 60 * 1000);
    const BATCH_SIZE = 400;
    for (let b = 0; b < chosen.length; b += BATCH_SIZE) {
      const slice = chosen.slice(b, b + BATCH_SIZE);
      const batch = db.batch();
      for (let i = 0; i < slice.length; i++) {
        const pt = slice[i];
        const absIdx = b + i;
        const trapTypeId = getTrapTypeIdAt(absIdx);
        const def = allDefs.find((d) => d.id === trapTypeId) ?? defs[absIdx % defs.length];
        batch.set(db.collection("traps").doc(), {
          ownerUid: cfg.ownerUid,
          trapTypeId: def.id,
          iconKey: def.iconKey ?? def.id,
          effectKind: def.effectKind ?? "none",
          effectValue: def.effectValue ?? 0,
          radiusMeters: def.radiusMeters ?? 25,
          disarmRadiusMeters: def.disarmRadiusMeters ?? 50,
          visibility: def.visibility ?? "hidden",
          ownerCanTrigger: def.ownerCanTrigger ?? false,
          allowedAgeGroups: cfg.allowedAgeGroups,
          status: "active",
          lat: pt.lat,
          lng: pt.lng,
          geohash: geohashForLocation([pt.lat, pt.lng]),
          dateKey,
          expiresAt,
          createdAt: FieldValue.serverTimestamp(),
          revealedTo: {},
          capturedUserId: null, capturedAt: null, captureDistanceMeters: null,
          disarmedBy: null, disarmedAt: null,
          generatedBy: "admin",
          generatorLocation: cfg.generatorLabel,
        });
      }
      await batch.commit();
    }
  }

  return {
    placed: chosen.length,
    candidates: rawCandidates.length,
    preview,
    elapsedSeconds: Math.round((Date.now() - startMs) / 1000),
  };
}

// ─── Callable 0: Fetch cities for a country (admin UI pre-load) ──────────────

export const adminFetchCountryCities = onCall(
  { timeoutSeconds: 10, memory: "256MiB" },
  (request) => {
    requireAdmin(request);
    const { countryName } = (request.data ?? {}) as { countryName?: string };
    if (!countryName?.trim()) {
      throw new HttpsError("invalid-argument", "countryName is required");
    }
    const key = countryName.trim();
    const entry = Object.entries(CITIES_BY_COUNTRY).find(
      ([k]) => k.toLowerCase() === key.toLowerCase()
    );
    const cities: CityEntry[] = entry ? entry[1] : [];
    logger.info(`[adminFetchCountryCities] "${key}" → ${cities.length} cities (static db)`);
    return { ok: true, cities };
  }
);

// ─── Callable 1: Create job (fast — returns immediately) ──────────────────────

export const adminCreateTrapGenJob = onCall(async (request) => {
  requireAdmin(request);

  const data = (request.data ?? {}) as Record<string, unknown>;

  const mode = data.mode as string;
  if (mode !== "city" && mode !== "country" && mode !== "latLng") {
    throw new HttpsError("invalid-argument", "mode must be 'city', 'country', or 'latLng'");
  }

  // latLng mode: caller supplies coordinates directly (no Nominatim needed)
  let jobLat: number | null = null;
  let jobLng: number | null = null;
  let jobRadiusMeters: number | null = null;
  let jobSourceUid: string | null = null;

  if (mode === "latLng") {
    jobLat = Number(data.lat);
    jobLng = Number(data.lng);
    if (!isFinite(jobLat) || !isFinite(jobLng)) {
      throw new HttpsError("invalid-argument", "lat and lng are required for latLng mode");
    }
    jobRadiusMeters = Math.max(500, Math.min(50_000, Math.round(Number(data.radiusMeters) || 5_000)));
    jobSourceUid = typeof data.sourceUid === "string" ? data.sourceUid : null;
  }

  const locationName = mode === "latLng"
    ? (typeof data.locationName === "string" && data.locationName.trim()
        ? data.locationName.trim()
        : `${jobLat!.toFixed(4)},${jobLng!.toFixed(4)}`)
    : (data.locationName as string | undefined)?.trim();

  if (mode !== "latLng" && !locationName) {
    throw new HttpsError("invalid-argument", "locationName is required");
  }

  const trapCount = Math.min(500, Math.max(1, Math.round(Number(data.trapCount) || 20)));
  const minSpacingMeters = Math.max(10, Math.round(Number(data.minSpacingMeters) || 100));
  const expiryDays = Math.min(365, Math.max(1, Math.round(Number(data.expiryDays) || 30)));
  const dryRun = data.dryRun === true;
  const trapTypeIds = Array.isArray(data.trapTypeIds)
    ? (data.trapTypeIds as string[])
    : [];

  // Validate allowedAgeGroups — must be a non-empty subset of ["minor", "adult"]
  const rawAgeGroups = Array.isArray(data.allowedAgeGroups) ? data.allowedAgeGroups as string[] : [];
  const allowedAgeGroups: ("minor" | "adult")[] =
    rawAgeGroups.filter((g): g is "minor" | "adult" => g === "minor" || g === "adult");
  const resolvedAgeGroups = allowedAgeGroups.length > 0 ? allowedAgeGroups : ["minor", "adult" as const];

  // Optional pre-fetched city list (country mode) — carries coords so the worker
  // can skip re-querying Overpass city names.
  const rawCityList = Array.isArray(data.cityList) ? data.cityList as unknown[] : [];
  const cityList: CityEntry[] = rawCityList
    .filter(
      (c): c is CityEntry =>
        typeof (c as CityEntry).name === "string" &&
        typeof (c as CityEntry).lat === "number" &&
        typeof (c as CityEntry).lng === "number"
    )
    .map((c) => ({
      name: (c as CityEntry).name,
      lat: (c as CityEntry).lat,
      lng: (c as CityEntry).lng,
      population: Number((c as CityEntry).population) || 0,
    }));

  const adminUid = request.auth!.uid;

  const jobRef = getDb().collection(JOBS_COLLECTION).doc();
  await jobRef.set({
    status: "queued",
    adminUid,
    mode,
    locationName: locationName ?? null,
    // latLng-mode extras (null for city/country modes)
    lat: jobLat,
    lng: jobLng,
    radiusMeters: jobRadiusMeters,
    sourceUid: jobSourceUid,
    trapCount,
    minSpacingMeters,
    expiryDays,
    dryRun,
    trapTypeIds,
    allowedAgeGroups: resolvedAgeGroups,
    cityList: cityList.length > 0 ? cityList : null,
    progress: {
      phase: "queued",
      message: "Job queued — starting…",
      processed: 0,
      total: trapCount,
      percentComplete: 0,
    },
    result: null,
    error: null,
    createdAt: FieldValue.serverTimestamp(),
    startedAt: null,
    completedAt: null,
  });

  return { ok: true, jobId: jobRef.id };
});

// ─── Callable 2: Run job (long-running worker, updates Firestore progress) ────

export const adminRunTrapGenJob = onCall(
  { timeoutSeconds: 540, memory: "512MiB" },
  async (request) => {
    requireAdmin(request);

    const { jobId } = (request.data ?? {}) as { jobId?: string };
    if (!jobId) throw new HttpsError("invalid-argument", "jobId is required");

    const db = getDb();
    const jobRef = db.collection(JOBS_COLLECTION).doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) throw new HttpsError("not-found", `Job ${jobId} not found`);

    const job = jobSnap.data()!;
    if (job.status === "running" || job.status === "completed" || job.status === "failed") {
      throw new HttpsError("failed-precondition", `Job is already ${job.status}`);
    }

    const {
      mode,
      locationName: rawLocationName,
      lat: jobLat,
      lng: jobLng,
      radiusMeters: jobRadiusMeters,
      trapCount,
      minSpacingMeters,
      expiryDays,
      dryRun,
      trapTypeIds,
      allowedAgeGroups,
      cityList,
      adminUid,
    } = job as {
      mode: "city" | "country" | "latLng";
      locationName: string;
      lat: number | null;
      lng: number | null;
      radiusMeters: number | null;
      trapCount: number;
      minSpacingMeters: number;
      expiryDays: number;
      dryRun: boolean;
      trapTypeIds: string[];
      allowedAgeGroups: ("minor" | "adult")[];
      cityList: CityEntry[] | null;
      adminUid: string;
    };
    const locationName = rawLocationName ?? `${jobLat?.toFixed(4)},${jobLng?.toFixed(4)}`;

    await jobRef.update({ status: "running", startedAt: FieldValue.serverTimestamp() });
    const startMs = Date.now();

    function estSecondsLeft(pct: number): number | undefined {
      if (pct <= 0) return undefined;
      const elapsed = (Date.now() - startMs) / 1000;
      return Math.round((elapsed / pct) * (1 - pct));
    }

    try {
      // 1. Load trap definitions
      await updateJobProgress(jobId, {
        phase: "loading_definitions",
        message: "Loading trap definitions…",
        processed: 0,
        total: trapCount,
        percentComplete: 2,
      });

      const defsSnap = await db.collection("trap_definitions").get();
      const allDefs = defsSnap.docs
        .filter((d) => d.data().enabled !== false)
        .map((d) => ({ id: d.id, ...d.data() } as TrapDefRow));

      const defs =
        trapTypeIds.length > 0
          ? allDefs.filter((t) => trapTypeIds.includes(t.id))
          : allDefs;

      if (defs.length === 0) {
        throw new Error("No enabled trap definitions found for the specified types");
      }

      // 2. Gather candidate locations
      let candidates: LatLng[] = [];
      const cityBreakdown: { city: string; count: number }[] = [];

      if (mode === "latLng") {
        if (jobLat === null || jobLng === null) {
          throw new Error("latLng job is missing lat/lng coordinates");
        }
        await updateJobProgress(jobId, {
          phase: "fetching_nodes",
          message: `Fetching road nodes near ${locationName}…`,
          processed: 0, total: trapCount, percentComplete: 10,
          estimatedSecondsRemaining: estSecondsLeft(0.1),
        });
        candidates = await fetchRoadNodesAroundPoint(jobLat, jobLng, jobRadiusMeters ?? 5_000);
        logger.info(`[trapGen:${jobId}] latLng mode: ${candidates.length} nodes near (${jobLat},${jobLng})`);
      } else if (mode === "city") {
        await updateJobProgress(jobId, {
          phase: "fetching_nodes",
          message: `Fetching road nodes in ${locationName}…`,
          processed: 0,
          total: trapCount,
          percentComplete: 10,
          estimatedSecondsRemaining: estSecondsLeft(0.1),
        });

        candidates = await fetchRoadNodesForCity(locationName);
        logger.info(`[trapGen:${jobId}] city mode: ${candidates.length} nodes`);
      } else {
        // Country mode — use pre-fetched city list if available (faster, more
        // reliable), otherwise fall back to Overpass country query.
        let cities: CityEntry[];

        if (cityList && cityList.length > 0) {
          cities = cityList;
          logger.info(`[trapGen:${jobId}] country mode (pre-fetched): ${cities.length} cities`);
        } else {
          await updateJobProgress(jobId, {
            phase: "fetching_cities",
            message: `Finding cities in ${locationName}…`,
            processed: 0,
            total: trapCount,
            percentComplete: 5,
            estimatedSecondsRemaining: estSecondsLeft(0.05),
          });
          cities = await fetchCitiesWithCoords(locationName);
          if (cities.length === 0) {
            throw new Error(`No cities found in country: ${locationName}`);
          }
          logger.info(`[trapGen:${jobId}] country mode (live fetch): ${cities.length} cities`);
        }

        const perCity = Math.max(1, Math.ceil(trapCount / cities.length)) * 10;

        for (let i = 0; i < cities.length; i++) {
          const city = cities[i];
          const pct = 0.05 + (i / cities.length) * 0.45;

          await updateJobProgress(jobId, {
            phase: `fetching_city_${i + 1}_of_${cities.length}`,
            message: `Road nodes: ${city.name} (${i + 1}/${cities.length})…`,
            processed: i,
            total: cities.length,
            percentComplete: Math.round(pct * 100),
            estimatedSecondsRemaining: estSecondsLeft(pct),
          });

          try {
            // Use coordinate-based radius search when coords are available —
            // avoids re-querying Overpass by name (which can fail for non-ASCII cities).
            const pts = shuffle(
              await fetchRoadNodesAroundPoint(city.lat, city.lng)
            ).slice(0, perCity);
            candidates.push(...pts);
            cityBreakdown.push({ city: city.name, count: pts.length });
          } catch (e) {
            logger.warn(`[trapGen:${jobId}] skipped ${city.name}: ${e}`);
            cityBreakdown.push({ city: city.name, count: 0 });
          }
        }
        logger.info(`[trapGen:${jobId}] total candidates: ${candidates.length}`);
      }

      if (candidates.length === 0) {
        throw new Error(
          `No road nodes found for: ${locationName}. Try a different spelling or check if it exists on OpenStreetMap.`
        );
      }

      // 3. Load existing trap locations and apply spacing filter
      await updateJobProgress(jobId, {
        phase: "filtering",
        message: `Applying ${minSpacingMeters}m spacing filter…`,
        processed: 0,
        total: trapCount,
        percentComplete: 60,
        estimatedSecondsRemaining: estSecondsLeft(0.6),
      });

      const existingSnap = await db
        .collection("traps")
        .where("status", "==", "active")
        .select("lat", "lng")
        .limit(2000)
        .get();
      const existingLocs: LatLng[] = existingSnap.docs
        .map((d) => ({ lat: d.data().lat as number, lng: d.data().lng as number }))
        .filter((p) => typeof p.lat === "number" && typeof p.lng === "number");

      // For latLng mode, sort closest-first so traps surround the target point.
      // For city/country mode, shuffle for even coverage across the area.
      const ordered = (mode === "latLng")
        ? sortByDistance(candidates, jobLat ?? 0, jobLng ?? 0)
        : shuffle(candidates);
      const chosen = filterBySpacing(ordered, minSpacingMeters, existingLocs).slice(0, trapCount);

      if (chosen.length === 0) {
        throw new Error(
          `All candidate locations are within ${minSpacingMeters}m of existing traps. ` +
          `Try a smaller minSpacingMeters or a different location.`
        );
      }

      // 4. Build preview
      const preview = chosen.map((pt, i) => ({
        lat: pt.lat,
        lng: pt.lng,
        trapTypeId: defs[i % defs.length].id,
      }));

      // 5. Write traps (if not dry run)
      if (!dryRun) {
        const dateKey = todayKey();
        const expiresAt = Timestamp.fromMillis(
          Date.now() + expiryDays * 24 * 60 * 60 * 1000
        );

        const BATCH_SIZE = 400;
        let written = 0;

        for (let b = 0; b < chosen.length; b += BATCH_SIZE) {
          const slice = chosen.slice(b, b + BATCH_SIZE);
          const pct = 0.7 + (b / chosen.length) * 0.28;

          await updateJobProgress(jobId, {
            phase: "writing",
            message: `Writing traps to Firestore: ${written}/${chosen.length}…`,
            processed: written,
            total: chosen.length,
            percentComplete: Math.round(pct * 100),
            estimatedSecondsRemaining: estSecondsLeft(pct),
          });

          const batch = db.batch();
          for (let i = 0; i < slice.length; i++) {
            const pt = slice[i];
            const def = defs[(b + i) % defs.length];
            const ref = db.collection("traps").doc();
            batch.set(ref, {
              ownerUid: adminUid,
              trapTypeId: def.id,
              iconKey: def.iconKey ?? def.id,
              effectKind: def.effectKind ?? "none",
              effectValue: def.effectValue ?? 0,
              radiusMeters: def.radiusMeters ?? 25,
              disarmRadiusMeters: def.disarmRadiusMeters ?? 50,
              visibility: def.visibility ?? "hidden",
              ownerCanTrigger: def.ownerCanTrigger ?? false,
              allowedAgeGroups: allowedAgeGroups ?? def.allowedAgeGroups ?? ["minor", "adult"],
              status: "active",
              lat: pt.lat,
              lng: pt.lng,
              geohash: geohashForLocation([pt.lat, pt.lng]),
              dateKey,
              expiresAt,
              createdAt: FieldValue.serverTimestamp(),
              revealedTo: {},
              capturedUserId: null,
              capturedAt: null,
              captureDistanceMeters: null,
              disarmedBy: null,
              disarmedAt: null,
              generatedBy: "admin",
              generatorLocation: locationName,
            });
          }
          await batch.commit();
          written += slice.length;
        }

        writeAuditLog({
          adminUid,
          category: "traps",
          action: "TRAPS_GENERATED",
          targetId: locationName,
          summary: `Generated ${written} traps in ${locationName} (${mode} mode)`,
          details: {
            mode,
            locationName,
            trapCount: written,
            minSpacingMeters,
            expiryDays,
            trapTypeIds: trapTypeIds.length > 0 ? trapTypeIds : "all",
            jobId,
          },
        }).catch(() => {});
      }

      // 6. Mark complete
      const result = {
        placed: chosen.length,
        candidates: candidates.length,
        preview,
        cityBreakdown: mode === "country" ? cityBreakdown : null,
        elapsedSeconds: Math.round((Date.now() - startMs) / 1000),
      };

      await jobRef.update({
        status: "completed",
        result,
        error: null,
        completedAt: FieldValue.serverTimestamp(),
        progress: {
          phase: "completed",
          message: dryRun
            ? `Dry run complete — ${chosen.length} positions found`
            : `Done! ${chosen.length} traps created in Firestore`,
          processed: chosen.length,
          total: chosen.length,
          percentComplete: 100,
        },
      });

      return { ok: true, jobId };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`[trapGen:${jobId}] failed:`, e);

      await jobRef.update({
        status: "failed",
        error: msg,
        completedAt: FieldValue.serverTimestamp(),
        progress: {
          phase: "failed",
          message: `Failed: ${msg}`,
          processed: 0,
          total: trapCount,
          percentComplete: 0,
        },
      });

      throw new HttpsError("internal", msg);
    }
  }
);

// ─── Callable 3: First-login auto-placement (user-callable) ──────────────────
// Called by the Android app once after email verification, passing the device's
// current GPS coordinates. The backend places X traps nearby according to the
// settings in game_settings/global. Idempotent — safe to call multiple times.

export const triggerFirstLoginTrapGen = onCall(
  { timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    requireAppCheck(request);
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");
    const uid = request.auth.uid;

    const data = (request.data ?? {}) as Record<string, unknown>;
    const inputLat = typeof data.lat === "number" ? data.lat : null;
    const inputLng = typeof data.lng === "number" ? data.lng : null;

    const db = getDb();

    // Read feature settings
    const settingsSnap = await db.collection("game_settings").doc("global").get();
    const settings = settingsSnap.data() ?? {};

    if (!settings.firstLoginTrapGenEnabled) {
      return { ok: true, skipped: true, reason: "feature_disabled" };
    }

    // Check idempotency flag
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (userSnap.data()?.firstLoginTrapsGenerated === true) {
      return { ok: true, skipped: true, reason: "already_completed" };
    }

    // Resolve location: caller's GPS first, fall back to player_locations
    let useLat: number;
    let useLng: number;
    if (inputLat !== null && inputLng !== null && isFinite(inputLat) && isFinite(inputLng)) {
      useLat = inputLat;
      useLng = inputLng;
    } else {
      const locSnap = await db.collection("player_locations").doc(uid).get();
      const locData = locSnap.data();
      if (typeof locData?.lat !== "number" || typeof locData?.lng !== "number") {
        return { ok: true, skipped: true, reason: "no_location" };
      }
      useLat = locData.lat;
      useLng = locData.lng;
    }

    // Mark as done atomically before placement so concurrent calls don't double-place
    await userRef.set(
      {
        firstLoginTrapsGenerated: true,
        firstLoginTrapsGeneratedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const trapCount = Math.min(100, Math.max(1, Math.round(Number(settings.firstLoginTrapCount) || 10)));
    const radiusMeters = Math.max(50, Math.min(50_000, Math.round(Number(settings.firstLoginTrapRadiusMeters) || 1_000)));
    const minDistanceMeters = Math.max(0, Math.min(500, Math.round(Number(settings.firstLoginTrapMinDistanceMeters) || 0)));
    const minSpacingMeters = Math.max(10, Math.round(Number(settings.firstLoginTrapMinSpacingMeters) || 150));
    const expiryDays = Math.min(365, Math.max(1, Math.round(Number(settings.firstLoginTrapExpiryDays) || 30)));
    const typeMode = typeof settings.firstLoginTrapTypeMode === "string"
      ? settings.firstLoginTrapTypeMode
      : "random";

    // Build trap-type assignment for fixed mode (exact counts per type)
    let resolvedTrapTypeIds: string[] = [];
    let resolvedTrapCount = trapCount;
    let resolvedOrderedTrapTypeIds: string[] | undefined;

    if (typeMode === "fixed") {
      const typeCounts = Array.isArray(settings.firstLoginTrapTypeCounts)
        ? (settings.firstLoginTrapTypeCounts as { trapTypeId: string; count: number }[])
        : [];
      const expanded: string[] = [];
      for (const entry of typeCounts) {
        if (typeof entry.trapTypeId === "string" && entry.trapTypeId && entry.count > 0) {
          for (let c = 0; c < Math.min(entry.count, 50); c++) expanded.push(entry.trapTypeId);
        }
      }
      if (expanded.length > 0) {
        resolvedOrderedTrapTypeIds = expanded;
        resolvedTrapCount = expanded.length;
        resolvedTrapTypeIds = [...new Set(expanded)]; // unique IDs for def lookup
      }
    } else {
      // Random mode: optionally restrict to specific types
      const typeIds = Array.isArray(settings.firstLoginTrapTypeIds)
        ? (settings.firstLoginTrapTypeIds as string[]).filter((s) => typeof s === "string" && s)
        : [];
      resolvedTrapTypeIds = typeIds;
    }

    try {
      const result = await runPlacementAtPoint({
        ownerUid: "system",
        lat: useLat,
        lng: useLng,
        radiusMeters,
        minDistanceMeters,
        trapCount: resolvedTrapCount,
        minSpacingMeters,
        expiryDays,
        dryRun: false,
        allowedAgeGroups: ["minor", "adult"],
        trapTypeIds: resolvedTrapTypeIds,
        orderedTrapTypeIds: resolvedOrderedTrapTypeIds,
        generatorLabel: `first_login:${uid.slice(0, 8)}`,
      });

      logger.info(`[triggerFirstLoginTrapGen] uid=${uid} placed=${result.placed} lat=${useLat} lng=${useLng}`);

      void writeAuditLog({
        adminUid: "SYSTEM",
        adminEmail: null,
        adminName: "System",
        category: "traps",
        action: "TRAPS_GENERATED",
        targetId: uid,
        summary: `First-login: placed ${result.placed} traps near new user ${uid.slice(0, 8)}`,
        details: { uid, lat: useLat, lng: useLng, radiusMeters, placed: result.placed },
      });

      return { ok: true, placed: result.placed, candidates: result.candidates };
    } catch (e) {
      // Reset flag so a future retry can succeed
      await userRef.set({ firstLoginTrapsGenerated: false }, { merge: true }).catch(() => {});
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`[triggerFirstLoginTrapGen] uid=${uid} failed: ${msg}`);
      throw new HttpsError("internal", msg);
    }
  }
);

// ─── Callable 4: Admin — place traps near users' last known locations ─────────
// Creates one latLng job per selected user (or all users with known locations).
// Returns job IDs that the admin UI can immediately start via adminRunTrapGenJob.

export const adminTriggerUserLocationTrapGen = onCall(
  { timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    requireAdmin(request);

    const data = (request.data ?? {}) as Record<string, unknown>;
    const rawUserIds = data.userIds;
    const trapCount = Math.min(100, Math.max(1, Math.round(Number(data.trapCount) || 10)));
    const radiusMeters = Math.max(500, Math.min(50_000, Math.round(Number(data.radiusMeters) || 5_000)));
    const minSpacingMeters = Math.max(10, Math.round(Number(data.minSpacingMeters) || 300));
    const expiryDays = Math.min(365, Math.max(1, Math.round(Number(data.expiryDays) || 30)));
    const dryRun = data.dryRun === true;

    const db = getDb();
    const adminUid = request.auth!.uid;

    let uids: string[];
    if (rawUserIds === "all") {
      const locSnap = await db.collection("player_locations").limit(500).get();
      uids = locSnap.docs.map((d) => d.id);
    } else if (Array.isArray(rawUserIds) && rawUserIds.length > 0) {
      uids = (rawUserIds as string[]).filter((id) => typeof id === "string");
    } else {
      throw new HttpsError("invalid-argument", "userIds must be a non-empty string[] or 'all'");
    }

    if (uids.length > 200) {
      throw new HttpsError("invalid-argument", "Too many users — max 200 per batch");
    }

    // Batch-fetch all locations and user profiles
    const [locDocs, userDocs] = await Promise.all([
      Promise.all(uids.map((uid) => db.collection("player_locations").doc(uid).get())),
      Promise.all(uids.map((uid) => db.collection("users").doc(uid).get())),
    ]);

    const jobs: { uid: string; username: string; lat: number; lng: number; jobId: string }[] = [];
    const skipped: { uid: string; reason: string }[] = [];

    for (let i = 0; i < uids.length; i++) {
      const uid = uids[i];
      const locData = locDocs[i].data();
      const userData = userDocs[i].data() ?? {};
      const username = typeof userData.username === "string" && userData.username
        ? userData.username
        : uid.slice(0, 8);

      if (typeof locData?.lat !== "number" || typeof locData?.lng !== "number") {
        skipped.push({ uid, reason: "no_location" });
        continue;
      }

      const lat = locData.lat;
      const lng = locData.lng;
      const locationName = `${username} (${lat.toFixed(4)},${lng.toFixed(4)})`;

      const jobRef = db.collection(JOBS_COLLECTION).doc();
      await jobRef.set({
        status: "queued",
        adminUid,
        mode: "latLng",
        locationName,
        lat,
        lng,
        radiusMeters,
        sourceUid: uid,
        trapCount,
        minSpacingMeters,
        expiryDays,
        dryRun,
        trapTypeIds: [],
        allowedAgeGroups: ["minor", "adult"] as ("minor" | "adult")[],
        cityList: null,
        progress: {
          phase: "queued",
          message: "Job queued — starting…",
          processed: 0,
          total: trapCount,
          percentComplete: 0,
        },
        result: null,
        error: null,
        createdAt: FieldValue.serverTimestamp(),
        startedAt: null,
        completedAt: null,
      });

      jobs.push({ uid, username, lat, lng, jobId: jobRef.id });
    }

    logger.info(`[adminTriggerUserLocationTrapGen] created ${jobs.length} jobs, skipped ${skipped.length}`);
    return { ok: true, jobs, skipped };
  }
);
