import { MemoryCacheStore, type CacheStore } from "../core/cache-store.js";
import type { ClientPolicyScope } from "../core/config.js";
import type { RequestFeature } from "../core/types.js";
import type { CacheDeclaration } from "./cache-options.js";
import { hasSensitiveRequest, resolveRequestKey } from "./request-key.js";

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
  readonly scope: ClientPolicyScope;
  readonly now: () => number;
}

const defaultStoreState = Symbol("cache.defaultStore");

/** @internal */
export function createCacheFeature(
  declaration: CacheDeclaration,
  runtime: CacheRuntime,
): RequestFeature {
  const now = runtime.now;
  const store: CacheStore = declaration.store
    ?? runtime.scope.get(defaultStoreState, () => new MemoryCacheStore(500, now));
  const methods = new Set(declaration.methods.map((method) => method.toUpperCase()));
  const statuses = new Set(declaration.statuses);
  const key = declaration.key;

  return {
    name: "cache",
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
        const effectiveTtlMs = responseTtl(response, declaration.ttlMs);
        if (effectiveTtlMs <= 0) return;
        await store.set(key, { response: response.clone(), expiresAt: now() + effectiveTtlMs });
      },
    },
  };
}
