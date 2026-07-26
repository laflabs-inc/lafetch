import type { CacheStore } from "../core/cache-store.js";
import { durationToMs } from "../core/duration.js";
import { HttpConfigurationError } from "../core/errors.js";
import type { Duration, RequestFeature } from "../core/types.js";
import {
  validateHttpMethods,
  validateHttpStatuses,
  validateOptionalKey,
  validateOptionsObject,
} from "../core/validation.js";
import type { RequestKey } from "./request-key.js";

export interface CacheOptions {
  readonly store?: CacheStore;
  readonly methods?: readonly string[];
  readonly statuses?: readonly number[];
  readonly key?: RequestKey;
}

export interface CacheDeclaration {
  readonly ttlMs: number;
  readonly store?: CacheStore;
  readonly methods: readonly string[];
  readonly statuses: readonly number[];
  readonly key?: RequestKey;
}

export const cacheFeatureDescriptor = Object.freeze<RequestFeature>({
  name: "cache",
  capabilities: { provides: [{ name: "cache", mode: "exclusive" }] },
  // Dedupe intercepts first, so reverse-order finalization commits Cache
  // before followers are settled.
  ordering: { optionalAfter: ["dedupe"] },
});

export function snapshotCacheDeclaration(
  ttl: Duration,
  options: CacheOptions = {},
): CacheDeclaration {
  validateOptionsObject(options, "cache() options");
  if (options.methods !== undefined) validateHttpMethods(options.methods, "cache.methods");
  if (options.statuses !== undefined) validateHttpStatuses(options.statuses, "cache.statuses");
  validateOptionalKey(options.key, "cache.key");
  if (
    options.store !== undefined
    && (
      typeof options.store !== "object"
      || options.store === null
      || typeof options.store.get !== "function"
      || typeof options.store.set !== "function"
      || (options.store.delete !== undefined && typeof options.store.delete !== "function")
    )
  ) {
    throw new HttpConfigurationError(
      "cache.store must provide get() and set() functions and an optional delete() function.",
    );
  }
  return Object.freeze({
    ttlMs: durationToMs(ttl, "cache.ttl"),
    ...(options.store !== undefined ? { store: options.store } : {}),
    methods: Object.freeze([...(options.methods ?? ["GET", "HEAD"])]),
    statuses: Object.freeze([...(options.statuses ?? [200])]),
    ...(options.key !== undefined ? { key: options.key } : {}),
  });
}
