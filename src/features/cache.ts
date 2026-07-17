import { MemoryCacheStore, type CacheStore } from "../core/cache-store.js";
import { durationToMs } from "../core/duration.js";
import type { Duration, RequestFeature } from "../core/types.js";
import { hasSensitiveRequest, requestKey } from "./request-key.js";

export interface CacheOptions {
  readonly ttl?: Duration;
  readonly store?: CacheStore;
  readonly methods?: readonly string[];
  readonly statuses?: readonly number[];
  readonly key?: string | ((request: Request) => string | Promise<string>);
}

export type CacheInput = Duration | CacheOptions;

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
export function createCacheFeature(input?: CacheInput, runtime?: Partial<CacheRuntime>): RequestFeature {
  const options: CacheOptions = typeof input === "number" || typeof input === "string" ? { ttl: input } : (input ?? {});
  const ttlMs = durationToMs(options.ttl ?? "30s", "cache.ttl");
  const store = options.store ?? runtime?.store ?? new MemoryCacheStore();
  const now = runtime?.now ?? Date.now;
  const methods = new Set((options.methods ?? ["GET", "HEAD"]).map((method) => method.toUpperCase()));
  const statuses = new Set(options.statuses ?? [200]);

  return {
    name: "cache",
    capabilities: { provides: [{ name: "cache", mode: "exclusive" }] },
    ordering: { optionalBefore: ["dedupe"] },
    hooks: {
      async prepare({ draft, state }) {
        const unsafeWithoutCustomKey = !methods.has(draft.method) && options.key === undefined;
        const bypass = unsafeWithoutCustomKey || hasSensitiveRequest(draft);
        state.set(bypassState, bypass);
        if (!bypass && typeof options.key !== "function") state.set(keyState, options.key ?? requestKey(draft));
      },
      async intercept({ request, state }) {
        if (state.get(bypassState)) return;
        const key = typeof options.key === "function" ? await options.key(request) : state.get(keyState);
        if (typeof key !== "string") return;
        state.set(keyState, key);
        const entry = await store.get(key);
        if (!entry || entry.expiresAt <= now()) {
          if (entry) await store.delete?.(key);
          return;
        }
        return entry.response.clone();
      },
      async afterResponse({ response, source, state }) {
        if (state.get(bypassState) || source === "feature:cache" || !cacheableResponse(response, statuses)) return;
        const key = state.get(keyState);
        if (typeof key !== "string") return;
        const effectiveTtlMs = responseTtl(response, ttlMs);
        if (effectiveTtlMs <= 0) return;
        await store.set(key, { response: response.clone(), expiresAt: now() + effectiveTtlMs });
      },
    },
  };
}

export function cache(input?: CacheInput): RequestFeature {
  return createCacheFeature(input);
}
