import { pool } from "./pool.js";

export async function getCachedValue<T>(key: string): Promise<T | undefined> {
  const result = await pool.query<{ value: T }>(
    "SELECT value FROM cached_records WHERE cache_key = $1 AND expires_at > now()",
    [key]
  );
  return result.rows[0]?.value;
}

/** Read a cache entry even after its TTL so slow upstream refreshes need not block a page. */
export async function getStoredCacheEntry<T>(key: string): Promise<{ value: T; expiresAt: Date } | undefined> {
  const result = await pool.query<{ value: T; expires_at: Date }>(
    "SELECT value, expires_at FROM cached_records WHERE cache_key = $1",
    [key]
  );
  const row = result.rows[0];
  return row ? { value: row.value, expiresAt: row.expires_at } : undefined;
}

export async function setCachedValue(key: string, value: unknown, ttlSeconds: number) {
  await pool.query(
    `
      INSERT INTO cached_records (cache_key, value, expires_at)
      VALUES ($1, $2::jsonb, now() + ($3::text || ' seconds')::interval)
      ON CONFLICT (cache_key) DO UPDATE
      SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, updated_at = now()
    `,
    [key, JSON.stringify(value), ttlSeconds]
  );
}

export async function deleteCachedValue(key: string) {
  await pool.query("DELETE FROM cached_records WHERE cache_key = $1", [key]);
}

/** Refreshes already running, so N concurrent readers trigger one upstream pass. */
const inFlight = new Map<string, Promise<unknown>>();

function refreshInBackground<T>(key: string, ttlSeconds: number, loader: () => Promise<T>) {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const run = loader()
    .then(async (fresh) => {
      await setCachedValue(key, fresh, ttlSeconds);
      return fresh;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, run);
  return run;
}

/**
 * Read-through cache with stale-while-revalidate.
 *
 * Expired entries are served immediately while the refresh runs behind, because
 * the upstream loaders are slow by design: Instantly calls queue against a
 * shared 16/minute budget, and the campaign pulse alone costs ~17 of them. A
 * blocking refresh made whoever arrived after the TTL wait out that whole
 * queue. Only a cold cache with nothing stored blocks.
 *
 * Loader failures propagate on the blocking path; on the background path a
 * failed refresh leaves the stale value in place rather than breaking the page.
 */
export async function cachedFetch<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const hit = await getCachedValue<T>(key);
  if (hit !== undefined) return hit;

  const stale = await getStoredCacheEntry<T>(key);
  if (stale !== undefined) {
    void refreshInBackground(key, ttlSeconds, loader).catch(() => undefined);
    return stale.value;
  }

  return refreshInBackground(key, ttlSeconds, loader);
}
