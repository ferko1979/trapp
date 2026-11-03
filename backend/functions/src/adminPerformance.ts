import { applicationDefault, getApp } from "firebase-admin/app";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getDb } from "./shared/firebase";
import { requireAdmin } from "./shared/admin";
import { writeAuditLog } from "./adminAuditLog";

/**
 * "Keep warm": one always-running instance (Cloud Run service-level minInstanceCount = 1) for the
 * gameplay functions players wait on, so they never hit a cold start. Costs money while on, so the
 * admin switches it per function. A deploy may reset the Cloud Run setting; the hourly reconcile
 * puts it back.
 */

const REGION = "europe-west1";
const SETTINGS_DOC = ["general_settings", "performance"] as const;

export const KEEP_WARM_CANDIDATES = [
  "updatePlayerLocation",
  "revealNearbyTrap",
  "startTrapDisarm",
  "tapTrapDisarm",
  "disarmAndCollectTrap",
  "startTrapPlacement",
  "tapTrapPlacement",
  "getMyTrapInventory",
] as const;

/** Rough idle price of one warm 1 vCPU / 256 MiB instance (Cloud Run tier 1 idle rates). */
const EST_USD_PER_WARM_INSTANCE_MONTH = 8;

type KeepWarmSettings = { enabled: boolean; functions: string[] };

function readSettings(data: Record<string, unknown> | undefined): KeepWarmSettings {
  const fns = Array.isArray(data?.keepWarmFunctions)
    ? (data!.keepWarmFunctions as unknown[]).filter(
      (f): f is string => typeof f === "string" && (KEEP_WARM_CANDIDATES as readonly string[]).includes(f)
    )
    : [...KEEP_WARM_CANDIDATES];
  return { enabled: data?.keepWarmEnabled === true, functions: fns };
}

function desiredMin(settings: KeepWarmSettings, fn: string): number {
  return settings.enabled && settings.functions.includes(fn) ? 1 : 0;
}

function projectId(): string {
  const id = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? getApp().options.projectId;
  if (!id) throw new HttpsError("internal", "Project id unknown.");
  return id;
}

async function runApi(fn: string, method: "GET" | "PATCH", body?: unknown): Promise<Record<string, unknown>> {
  getDb(); // makes sure the default app exists
  const credential = getApp().options.credential ?? applicationDefault();
  const { access_token: token } = await credential.getAccessToken();
  const url = `https://run.googleapis.com/v2/projects/${projectId()}/locations/${REGION}/services/${fn.toLowerCase()}` +
    (method === "PATCH" ? "?updateMask=scaling.minInstanceCount" : "");
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json.error as { message?: string } | undefined)?.message ?? res.statusText;
    throw new Error(`Cloud Run ${method} ${fn}: ${res.status} ${msg}`);
  }
  return json;
}

async function currentMin(fn: string): Promise<number> {
  const svc = await runApi(fn, "GET");
  const n = (svc.scaling as { minInstanceCount?: number } | undefined)?.minInstanceCount;
  return typeof n === "number" ? n : 0;
}

type FnStatus = { name: string; desired: number; actual: number | null; error?: string };

/** Sets every candidate's Cloud Run min instances to what the settings ask for (only where it differs). */
async function reconcile(settings: KeepWarmSettings): Promise<FnStatus[]> {
  return Promise.all(KEEP_WARM_CANDIDATES.map(async (name): Promise<FnStatus> => {
    const desired = desiredMin(settings, name);
    try {
      let actual = await currentMin(name);
      if (actual !== desired) {
        await runApi(name, "PATCH", { scaling: { minInstanceCount: desired } });
        actual = desired;
      }
      return { name, desired, actual };
    } catch (e) {
      return { name, desired, actual: null, error: e instanceof Error ? e.message : String(e) };
    }
  }));
}

async function loadSettings(): Promise<KeepWarmSettings> {
  const snap = await getDb().collection(SETTINGS_DOC[0]).doc(SETTINGS_DOC[1]).get();
  return readSettings(snap.data());
}

export const adminGetKeepWarm = onCall(async (request) => {
  requireAdmin(request);
  const settings = await loadSettings();
  const status = await Promise.all(KEEP_WARM_CANDIDATES.map(async (name): Promise<FnStatus> => {
    try {
      return { name, desired: desiredMin(settings, name), actual: await currentMin(name) };
    } catch (e) {
      return { name, desired: desiredMin(settings, name), actual: null, error: e instanceof Error ? e.message : String(e) };
    }
  }));
  return { ok: true, settings, status, estUsdPerFunctionMonth: EST_USD_PER_WARM_INSTANCE_MONTH };
});

export const adminSetKeepWarm = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const payload = (request.data ?? {}) as Record<string, unknown>;
  const settings = readSettings({
    keepWarmEnabled: payload.enabled === true,
    keepWarmFunctions: payload.functions,
  });
  await getDb().collection(SETTINGS_DOC[0]).doc(SETTINGS_DOC[1]).set({
    keepWarmEnabled: settings.enabled,
    keepWarmFunctions: settings.functions,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: adminUid,
  }, { merge: true });

  const status = await reconcile(settings);
  void writeAuditLog({
    adminUid,
    adminEmail: (request.auth?.token?.email as string | undefined) ?? null,
    category: "general_settings",
    action: "keep_warm_update",
    summary: settings.enabled
      ? `Keep warm ON for ${settings.functions.length} function(s)`
      : "Keep warm OFF",
    details: { ...settings, errors: status.filter((s) => s.error).map((s) => s.name) },
  });
  return { ok: true, settings, status, estUsdPerFunctionMonth: EST_USD_PER_WARM_INSTANCE_MONTH };
});

export const reconcileKeepWarm = onSchedule(
  { schedule: "every 60 minutes", timeZone: "Europe/Budapest" },
  async () => {
    const status = await reconcile(await loadSettings());
    const failed = status.filter((s) => s.error);
    if (failed.length) logger.warn("reconcileKeepWarm errors", { failed });
  }
);
