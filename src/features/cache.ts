import { MemoryCacheStore, type CacheStore } from "../core/cache-store.js";
import { durationToMs } from "../core/duration.js";
import type { Duration, RequestFeature } from "../core/types.js";
import { hasSensitiveRequest, resolveRequestKey, type RequestKey } from "./request-key.js";

export interface CacheOptions {
  readonly store?: CacheStore;
  readonly methods?: readonly string[];
  readonly statuses?: readonly number[];
  readonly key?: RequestKey;
}

const keyState = Symbol("cache.key");
const bypassState = Symbol("cache.bypass");

function cacheableResponse(response: Response, statuses: ReadonlySet<number>): boolean {
  if (!statuses.has(response.status) || response.headers.has("set-cookie")) return false;
  const control = response.headers.get("cache-control")?.toLowerCase() ?? "";
  if (/\b(?:no-cache|no-store|private)\b/.test(control)) return false;
  const vary = response.headers.get("vary");
  return !vary || vary.trim() === "";
}

function responseTtl(response: Response, configuredTtlMs: number): number {
  const control = response.headers.get("cache-control") ?? "";
  const match = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i.exec(control);
  if (!match) return /(?:^|,)\s*max-age\s*=/i.test(control) ? 0 : configuredTtlMs;
  const maxAgeSeconds = Number(match[1]);
  if (!Number.isFinite(maxAgeSeconds)) return 0;
  const parsedAge = Number(response.headers.get("age") ?? 0);
  const ageMs = Number.isFinite(parsedAge) && parsedAge > 0 ? parsedAge * 1_000 : 0;
  const maxAgeMs = maxAgeSeconds * 1_000;
  return Math.max(0, Math.min(configuredTtlMs, maxAgeMs - ageMs));
}

interface CacheRuntime {
  readonly store: CacheStore;
  readonly now: () => number;
}

/** @internal */
export function createCacheFeature(
  ttl: Duration,
  options: CacheOptions = {},
  runtime?: Partial<CacheRuntime>,
): RequestFeature {
  const ttlMs = durationToMs(ttl, "cache.ttl");
  const store = options.store ?? runtime?.store ?? new MemoryCacheStore();
  const now = runtime?.now ?? Date.now;
  const methods = new Set((options.methods ?? ["GET", "HEAD"]).map((method) => method.toUpperCase()));
  const statuses = new Set(options.statuses ?? [200]);
  const key = options.key;

  return {
    name: "cache",
    capabilities: { provides: [{ name: "cache", mode: "exclusive" }] },
    // Dedupe intercepts first, so reverse-order finalization commits Cache
    // before followers are settled.
    ordering: { optionalAfter: ["dedupe"] },
    hooks: {
      async intercept({ request, state }) {
        state.delete(keyState);
        const bypass = (key === undefined && !methods.has(request.method)) || hasSensitiveRequest(request);
        state.set(bypassState, bypass);
        if (bypass) return;
        const resolvedKey = await resolveRequestKey(key, request);
        state.set(keyState, resolvedKey);
        const entry = await store.get(resolvedKey);
        if (!entry || entry.expiresAt <= now()) {
          if (entry) await store.delete?.(resolvedKey);
          return;
        }
        return entry.response.clone();
      },
      async finalize({ response, error, source, state }) {
        if (
          error !== undefined ||
          response === undefined ||
          state.get(bypassState) ||
          source === "feature:cache" ||
          !cacheableResponse(response, statuses)
        ) return;
        const key = state.get(keyState);
        if (typeof key !== "string") return;
        const effectiveTtlMs = responseTtl(response, ttlMs);
        if (effectiveTtlMs <= 0) return;
        await store.set(key, { response: response.clone(), expiresAt: now() + effectiveTtlMs });
      },
    },
  };
}
