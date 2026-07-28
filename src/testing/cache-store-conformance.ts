import type { CacheStore } from "../core/cache-store.js";

export interface CacheStoreConformanceResult {
  readonly name: string;
  readonly passed: boolean;
  readonly error?: unknown;
}

export type CacheStoreFactory = () => CacheStore | Promise<CacheStore>;

async function check(name: string, operation: () => Promise<void>): Promise<CacheStoreConformanceResult> {
  try {
    await operation();
    return Object.freeze({ name, passed: true });
  } catch (error) {
    return Object.freeze({ name, passed: false, error });
  }
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function withCleanup(
  store: CacheStore,
  keys: readonly string[],
  operation: () => Promise<void>,
): Promise<void> {
  try {
    await operation();
  } finally {
    for (const key of keys) {
      try {
        await store.delete(key);
      } catch { /* cleanup must not replace the conformance result */ }
    }
  }
}

/** Framework-agnostic contract checks for third-party CacheStore adapters. */
export async function runCacheStoreConformance(factory: CacheStoreFactory): Promise<readonly CacheStoreConformanceResult[]> {
  const future = () => Date.now() + 60_000;
  const namespace = `lafetch:conformance:${Date.now()}:${Math.random()}:`;
  const key = (name: string) => `${namespace}${name}`;
  const results = await Promise.all([
    check("round-trip", async () => {
      const store = await factory();
      const expiresAt = future();
      const cacheKey = key("round-trip");
      await withCleanup(store, [cacheKey], async () => {
        await store.set(cacheKey, {
          response: new Response("payload", {
            status: 201,
            statusText: "Created",
            headers: { "Content-Type": "text/plain", "X-Cache-Probe": "round-trip" },
          }),
          expiresAt,
        });
        const entry = await store.get(cacheKey);
        invariant(entry, "get() did not return the stored entry.");
        invariant(
          entry.expiresAt > Date.now() && entry.expiresAt <= expiresAt,
          "The Store returned an expired entry or extended its absolute expiration.",
        );
        invariant(entry.response.status === 201, "The stored response status changed.");
        invariant(entry.response.statusText === "Created", "The stored response status text changed.");
        invariant(entry.response.headers.get("x-cache-probe") === "round-trip", "The stored response headers changed.");
        invariant(await entry.response.text() === "payload", "The stored response body changed.");
      });
    }),
    check("write-isolation", async () => {
      const store = await factory();
      const response = new Response("payload");
      const cacheKey = key("write-isolation");
      await withCleanup(store, [cacheKey], async () => {
        await store.set(cacheKey, { response, expiresAt: future() });
        invariant(await response.text() === "payload", "The input response was not independently readable.");
        const entry = await store.get(cacheKey);
        invariant(entry, "get() did not return the stored entry.");
        invariant(await entry.response.text() === "payload", "Consuming the input response changed the stored body.");
      });
    }),
    check("read-isolation", async () => {
      const store = await factory();
      const cacheKey = key("read-isolation");
      await withCleanup(store, [cacheKey], async () => {
        await store.set(cacheKey, {
          response: new Response("payload", { headers: { "X-Cache-Probe": "original" } }),
          expiresAt: future(),
        });
        const first = await store.get(cacheKey);
        const second = await store.get(cacheKey);
        invariant(first && second, "get() did not return independently readable entries.");
        invariant(first.response !== second.response, "get() returned the same Response instance twice.");
        invariant(first.response.headers !== second.response.headers, "Response Header views were shared between reads.");
        invariant(await first.response.text() === "payload", "The first response clone was unreadable.");
        invariant(await second.response.text() === "payload", "The second response clone was not isolated.");
        invariant(second.response.headers.get("x-cache-probe") === "original", "Response headers were shared between reads.");
      });
    }),
    check("key-and-overwrite", async () => {
      const store = await factory();
      const firstKey = key("first-key");
      const secondKey = key("second-key");
      await withCleanup(store, [firstKey, secondKey], async () => {
        await store.set(firstKey, { response: new Response("old"), expiresAt: future() });
        await store.set(secondKey, { response: new Response("second"), expiresAt: future() });
        await store.set(firstKey, { response: new Response("new"), expiresAt: future() });
        const first = await store.get(firstKey);
        const second = await store.get(secondKey);
        invariant(first && second, "Entries with different keys were not retained independently.");
        invariant(await first.response.text() === "new", "set() did not replace an existing key.");
        invariant(await second.response.text() === "second", "Replacing one key changed another key.");
      });
    }),
    check("expiration", async () => {
      const store = await factory();
      const cacheKey = key("expired");
      const expiresAt = Date.now() - 1;
      await withCleanup(store, [cacheKey], async () => {
        await store.set(cacheKey, { response: new Response("stale"), expiresAt });
        const entry = await store.get(cacheKey);
        if (entry === undefined) return;
        invariant(entry.expiresAt <= expiresAt, "The Store extended an expired entry.");
        invariant(await entry.response.text() === "stale", "The stale response body changed.");
      });
    }),
    check("concurrent-reads", async () => {
      const store = await factory();
      const cacheKey = key("concurrent");
      await withCleanup(store, [cacheKey], async () => {
        await store.set(cacheKey, { response: new Response("payload"), expiresAt: future() });
        const entries = await Promise.all([
          store.get(cacheKey),
          store.get(cacheKey),
          store.get(cacheKey),
        ]);
        invariant(entries.every(Boolean), "A concurrent get() missed the stored entry.");
        const bodies = await Promise.all(entries.map((entry) => entry!.response.text()));
        invariant(bodies.every((body) => body === "payload"), "Concurrent reads did not return isolated bodies.");
      });
    }),
    check("delete", async () => {
      const store = await factory();
      const cacheKey = key("delete");
      await store.set(cacheKey, { response: new Response("payload"), expiresAt: future() });
      await store.delete(cacheKey);
      await store.delete(cacheKey);
      invariant(await store.get(cacheKey) === undefined, "delete() did not remove the entry.");
    }),
  ]);
  return Object.freeze(results);
}
