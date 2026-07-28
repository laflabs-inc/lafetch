import { describe, expect, it } from "vitest";
import { MemoryCacheStore } from "../src/cache.js";
import { runCacheStoreConformance } from "../src/testing/index.js";

describe("CacheStore conformance", () => {
  it("validates the complete built-in MemoryCacheStore contract", async () => {
    const results = await runCacheStoreConformance(() => new MemoryCacheStore());

    expect(results.filter((result) => !result.passed)).toEqual([]);
    expect(results.map((result) => result.name)).toEqual([
      "round-trip",
      "write-isolation",
      "read-isolation",
      "key-and-overwrite",
      "expiration",
      "concurrent-reads",
      "delete",
    ]);
    expect(Object.isFrozen(results)).toBe(true);
  });

  it("reports adapter failures without coupling to a test framework", async () => {
    const results = await runCacheStoreConformance(async () => {
      throw new Error("store unavailable");
    });

    expect(results).toHaveLength(7);
    expect(results.every((result) =>
      !result.passed
      && result.error instanceof Error
      && result.error.message === "store unavailable")).toBe(true);
  });
});
