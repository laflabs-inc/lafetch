import {
  MemoryCacheStore,
  type CacheEntry,
  type CacheStore,
} from "../core/cache-store.js";
import type { ClientPolicyScope } from "../core/config.js";
import type { RequestFeature } from "../core/types.js";
import type {
  CacheDeclaration,
  CacheStoreFailureMode,
} from "./cache-options.js";
import type { CacheGenerationRegistration } from "./cache-generation.js";
import { cacheInvalidationMetadata } from "./policy-metadata.js";
import { hasSensitiveRequest, resolveRequestKey } from "./request-key.js";

const keyState = Symbol("cache.key");
const bypassState = Symbol("cache.bypass");
const staleState = Symbol("cache.stale");
const generationState = Symbol("cache.generation");
const responseTimeState = Symbol();

function assertCacheEntry(entry: unknown): asserts entry is CacheEntry {
  const candidate = entry as Partial<CacheEntry> | null;
  if (
    typeof entry !== "object"
    || entry === null
    || !(candidate!.response instanceof Response)
    || !Number.isFinite(candidate!.expiresAt)
  ) {
    throw new TypeError("CacheStore.get() returned an invalid entry.");
  }
}

async function storeOperation<T>(
  failureMode: CacheStoreFailureMode,
  operation: () => T | Promise<T>,
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    if (failureMode === "throw") throw error;
    return;
  }
}

function readStore(
  store: CacheStore,
  key: string,
  now: number,
  failureMode: CacheStoreFailureMode,
): Promise<Response | undefined> {
  return storeOperation(failureMode, async () => {
    const entry = await store.get(key);
    if (entry === undefined) return;
    assertCacheEntry(entry);
    if (entry.expiresAt <= now) {
      await store.delete(key);
      return;
    }
    return entry.response.clone();
  });
}

function responseTtl(
  response: Response,
  statuses: ReadonlySet<number>,
  configuredTtlMs: number,
): number | undefined {
  if (!statuses.has(response.status) || response.headers.has("set-cookie")) return;
  const control = response.headers.get("cache-control") ?? "";
  if (/\b(?:no-cache|no-store|private)\b/i.test(control)) return;
  if (response.headers.get("vary")?.trim()) return;
  const maxAges = control.match(/(?:^|,)\s*max-age(?=\s*(?:=|$))[^,]*/gi);
  if (!maxAges) return configuredTtlMs;
  if (maxAges.length > 1) return 0;
  const match = /(?:^|,)\s*max-age\s*=\s*(?:"(\d+)"|(\d+))\s*$/i.exec(maxAges[0]!);
  if (!match) return 0;
  const age = /^\s*(\d+)\s*(?:,|$)/.exec(response.headers.get("age") ?? "")?.[1] ?? "0";
  const maxAgeSeconds = +(match[1] ?? match[2]!);
  const ageSeconds = +age;
  return maxAgeSeconds <= ageSeconds
    ? 0
    : Math.min(configuredTtlMs, (maxAgeSeconds - ageSeconds) * 1_000);
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
      prepare({ metadata }) {
        if (declaration.mode === "invalidate") {
          metadata.set(cacheInvalidationMetadata, true);
        }
      },
      async intercept({ request, state }) {
        state.delete(keyState);
        state.delete(staleState);
        const bypass = (key === undefined && !methods.has(request.method)) || hasSensitiveRequest(request);
        state.set(bypassState, bypass);
        if (bypass) return;
        const resolvedKey = await resolveRequestKey(key, request);
        state.set(keyState, resolvedKey);
        let registration = state.get(generationState) as CacheGenerationRegistration | undefined;
        if (registration?.key !== resolvedKey) {
          registration?.release();
          const { acquireCacheGeneration } = await import("./cache-generation.js");
          registration = acquireCacheGeneration(
            store,
            resolvedKey,
            declaration.mode === "invalidate",
          );
          state.set(generationState, registration);
        }
        if (declaration.mode === "invalidate") {
          await registration.commit(() =>
            storeOperation(declaration.storeFailure, () => store.delete(resolvedKey))
          );
          return;
        }
        if (declaration.mode === "revalidate") {
          const { readRevalidatingCache } = await import("./cache-revalidation.js");
          const read = await readRevalidatingCache(
            store,
            resolvedKey,
            now(),
            request,
            declaration.storeFailure,
          );
          if (read?.stale === undefined) return read?.response;
          state.set(staleState, read.stale);
          return;
        }
        return await readStore(store, resolvedKey, now(), declaration.storeFailure);
      },
      async afterResponse({ response, source, state }) {
        if (source === "feature:cache") return;
        const stale = state.get(staleState);
        state.set(responseTimeState, now());
        if (response.status !== 304 || !(stale instanceof Response)) return;
        const { mergeNotModifiedResponse } = await import("./cache-revalidation.js");
        return mergeNotModifiedResponse(stale, response);
      },
      async finalize({ response, error, source, state }) {
        const registration = state.get(generationState) as CacheGenerationRegistration | undefined;
        try {
          if (
            error !== undefined ||
            response === undefined ||
            state.get(bypassState) ||
            source === "feature:cache"
          ) return;
          const key = state.get(keyState);
          if (typeof key !== "string" || registration === undefined) return;
          const ttl = responseTtl(response, statuses, declaration.ttlMs);
          if (ttl === undefined) {
            if (state.get(staleState) instanceof Response) {
              await registration.commit(() =>
                storeOperation(declaration.storeFailure, () => store.delete(key))
              );
            }
            return;
          }
          if (ttl <= 0) return;
          const expiresAt = ttl + (state.get(responseTimeState) as number);
          await registration.commit(() =>
            expiresAt > now() && storeOperation(
                declaration.storeFailure,
                () => store.set(key, {
                  response: response.clone(),
                  expiresAt,
                }),
              )
          );
        } finally {
          registration?.release();
          state.delete(generationState);
        }
      },
    },
  };
}
