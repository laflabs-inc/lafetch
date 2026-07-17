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

/** Framework-agnostic contract checks for third-party CacheStore adapters. */
export async function runCacheStoreConformance(factory: CacheStoreFactory): Promise<readonly CacheStoreConformanceResult[]> {
  return await Promise.all([
    check("round-trip", async () => {
      const store = await factory();
      await store.set("round-trip", { response: new Response("payload"), expiresAt: Date.now() + 60_000 });
      const entry = await store.get("round-trip");
      invariant(entry, "get() did not return the stored entry.");
      invariant(await entry.response.text() === "payload", "The stored response body changed.");
    }),
    check("clone-isolation", async () => {
      const store = await factory();
      await store.set("clone", { response: new Response("payload"), expiresAt: Date.now() + 60_000 });
      const first = await store.get("clone");
      const second = await store.get("clone");
      invariant(first && second, "get() did not return independently readable entries.");
      invariant(await first.response.text() === "payload", "The first response clone was unreadable.");
      invariant(await second.response.text() === "payload", "The second response clone was not isolated.");
    }),
    check("delete", async () => {
      const store = await factory();
      if (!store.delete) return;
      await store.set("delete", { response: new Response("payload"), expiresAt: Date.now() + 60_000 });
      await store.delete("delete");
      invariant(await store.get("delete") === undefined, "delete() did not remove the entry.");
    }),
  ]);
}
