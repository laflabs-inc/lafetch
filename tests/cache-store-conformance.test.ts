import { describe, expect, it } from "vitest";
import { MemoryCacheStore } from "../src/index.js";
import { runCacheStoreConformance } from "../src/testing/index.js";

describe("CacheStore conformance", () => {
  it("validates the built-in MemoryCacheStore", async () => {
    const results = await runCacheStoreConformance(() => new MemoryCacheStore());
    expect(results.filter((result) => !result.passed)).toEqual([]);
    expect(results.map((result) => result.name)).toEqual(["round-trip", "clone-isolation", "delete"]);
  });
});
