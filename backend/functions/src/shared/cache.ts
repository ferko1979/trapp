import { getDb } from "./firebase";

/**
 * Short-lived per-instance cache for rarely changing config docs (game/general settings, levels,
 * trap definitions, translations). Each warm instance re-reads them at most once per TTL instead of
 * on every call; admin edits therefore show up in the game within CONFIG_TTL_MS.
 */
export const CONFIG_TTL_MS = 60_000;

type Entry<T> = { at: number; value: Promise<T> };
const entries = new Map<string, Entry<unknown>>();

function remember<T>(key: string, load: () => Promise<T>, ttlMs = CONFIG_TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key) as Entry<T> | undefined;
  if (hit && now - hit.at < ttlMs) return hit.value;
  const value = load();
  entries.set(key, { at: now, value });
  // A failed read must not stick for the whole TTL.
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  return value;
}

/** data() of a single doc (undefined when it does not exist). Callers must not mutate the result. */
export function cachedDocData(
  collection: string,
  docId: string,
  ttlMs = CONFIG_TTL_MS
): Promise<Record<string, unknown> | undefined> {
  return remember(`doc:${collection}/${docId}`, async () => {
    const snap = await getDb().collection(collection).doc(docId).get();
    return snap.exists ? (snap.data() as Record<string, unknown>) : undefined;
  }, ttlMs);
}

export type CachedDoc = { id: string; data: Record<string, unknown> };

/** All trap_definitions with enabled == true. Callers must not mutate the result. */
export function cachedEnabledTrapDefinitions(): Promise<CachedDoc[]> {
  return remember("query:trap_definitions/enabled", async () => {
    const snap = await getDb().collection("trap_definitions").where("enabled", "==", true).get();
    return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
  });
}
