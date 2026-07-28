import { describe, expect, it } from "vitest";
import { HttpConfigurationError, lafetch } from "../src/index.js";
import { defineFeature } from "../src/feature.js";
import { mockTransport } from "../src/testing/index.js";

describe("JavaScript public API configuration", () => {
  it("rejects invalid closed values before Transport execution", () => {
    const transport = mockTransport(() => Response.json({ ok: true }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });
    const invalidConfigurations = [
      () => api.get("/users").credentials("cross-origin"),
      () => api.get("/users").credentials(null),
      () => api.get("/users").json({ filter: "active" }),
      () => api.get("/users").body("payload"),
      () => api.get("/users").bodyFactory(() => "payload"),
      () => api.get("/users").validate((value) => value).validate((value) => value),
      () => api.get("/users").requestInit({ method: "POST" }),
      () => api.get("/users").requestInit({ cache: "only-if-cached" }),
      () => api.head("/users").json({ filter: "active" }),
      () => api.request("GET", "/users").body("payload"),
      () => lafetch.create({ credentials: "cross-origin" }),
      () => lafetch.create({ credentials: null }),
      () => api.get("/users").retry(2, null),
      () => api.get("/users").retry(2, { backoff: "fixed" }),
      () => api.get("/users").retry(2, { backoff: { type: "linear" } }),
      () => api.get("/users").retry(2, { backoff: { type: null } }),
      () => api.get("/users").retry(2, { backoff: { jitter: "equal" } }),
      () => api.get("/users").retry(2, { backoff: { jitter: null } }),
      () => api.get("/users").retry(2, { maxRetryAfter: -1 }),
      () => api.get("/users").retry(2, { maxRetryAfter: "forever" }),
      () => api.get("/users").cache("1m", { storeFailure: "ignore" }),
      () => api.get("/users").cache("1m", { storeFailure: null }),
      () => api.get("/users").cache("1m", {
        store: { get() {}, set() {} },
      }),
      () => api.get("/users").retry(-1),
      () => api.get("/users").retry(1.5),
      () => api.get("/users").maxResponseBytes(-1),
      () => api.post("/users").json({ ok: true }).body("replacement"),
      () => api.post("/users").body("payload").bodyFactory(() => "replacement"),
      () => api.get("/users").use(defineFeature({
        name: "invalid-capability",
        capabilities: { provides: [{ name: "custom", mode: "shared" }] },
      })),
    ];

    for (const configure of invalidConfigurations) {
      expect(configure).toThrow(HttpConfigurationError);
      expect(configure).toThrow(expect.objectContaining({ code: "ERR_HTTP_CONFIGURATION" }));
    }
    expect(transport.calls).toHaveLength(0);
  });

  it("rejects invalid asynchronous key callback results before Transport execution", async () => {
    const transport = mockTransport(() => Response.json({ ok: true }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    await expect(api.get("/cache").cache("1m", { key: async () => null }))
      .rejects.toMatchObject({ code: "ERR_HTTP_CONFIGURATION" });
    await expect(api.get("/dedupe").dedupe({ key: async () => "" }))
      .rejects.toMatchObject({ code: "ERR_HTTP_CONFIGURATION" });
    expect(transport.calls).toHaveLength(0);
  });

  it("rejects an invalid dynamic status predicate result as configuration", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 204 })),
    });

    await expect(api.get("/users").acceptStatus(() => "yes"))
      .rejects.toMatchObject({ code: "ERR_HTTP_CONFIGURATION" });
  });

  it("accepts every documented credentials and retry value", () => {
    const api = lafetch.create({
      credentials: "omit",
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 204 })),
    });

    for (const credentials of ["omit", "same-origin", "include"]) {
      expect(() => api.get("/resource").credentials(credentials)).not.toThrow();
    }
    for (const type of ["fixed", "exponential"]) {
      expect(() => api.get("/resource").retry(1, { backoff: { type } })).not.toThrow();
    }
    for (const jitter of ["none", "full"]) {
      expect(() => api.get("/resource").retry(1, { backoff: { jitter } })).not.toThrow();
    }
    expect(() => api.get("/resource").retry(1, { maxRetryAfter: "1m" })).not.toThrow();
    for (const storeFailure of ["throw", "bypass"]) {
      expect(() => api.get("/resource").cache("1m", { storeFailure })).not.toThrow();
    }
  });
});
