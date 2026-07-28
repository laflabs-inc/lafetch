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

  it("detects Stores that retain mutable input headers", async () => {
    const results = await runCacheStoreConformance(() => {
      const entries = new Map<string, {
        body: ArrayBuffer;
        expiresAt: number;
        headers: Headers;
        status: number;
        statusText: string;
      }>();

      return {
        get(key: string) {
          const entry = entries.get(key);
          if (!entry) return;
          return {
            expiresAt: entry.expiresAt,
            response: new Response(entry.body.slice(0), {
              headers: entry.headers,
              status: entry.status,
              statusText: entry.statusText,
            }),
          };
        },
        async set(key: string, entry: { response: Response; expiresAt: number }) {
          entries.set(key, {
            body: await entry.response.clone().arrayBuffer(),
            expiresAt: entry.expiresAt,
            headers: entry.response.headers,
            status: entry.response.status,
            statusText: entry.response.statusText,
          });
        },
        delete(key: string) {
          entries.delete(key);
        },
      };
    });

    expect(results.find((result) => result.name === "write-isolation"))
      .toMatchObject({
        passed: false,
        error: expect.objectContaining({
          message: "Mutating the input response changed the stored headers.",
        }),
      });
  });
});
