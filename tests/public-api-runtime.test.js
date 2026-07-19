import { describe, expect, it } from "vitest";
import { HttpConfigurationError, lafetch } from "../src/index.js";
import { defineFeature } from "../src/feature.js";
import { mockTransport } from "../src/testing/index.js";

describe("JavaScript public API configuration", () => {
  it("rejects invalid closed values before Transport execution", () => {
    const transport = mockTransport(() => Response.json({ ok: true }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });
    const invalidConfigurations = [
      () => api.get("/users").as("yaml"),
      () => api.get("/users").as(null),
      () => api.get("/users").credentials("cross-origin"),
      () => api.get("/users").credentials(null),
      () => lafetch.create({ credentials: "cross-origin" }),
      () => lafetch.create({ credentials: null }),
      () => api.get("/users").retry(2, null),
      () => api.get("/users").retry(2, { backoff: "fixed" }),
      () => api.get("/users").retry(2, { backoff: { type: "linear" } }),
      () => api.get("/users").retry(2, { backoff: { type: null } }),
      () => api.get("/users").retry(2, { backoff: { jitter: "equal" } }),
      () => api.get("/users").retry(2, { backoff: { jitter: null } }),
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

  it("accepts every documented closed value", () => {
    const api = lafetch.create({
      credentials: "omit",
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 204 })),
    });

    for (const mode of ["auto", "json", "text", "arrayBuffer", "blob", "formData"]) {
      expect(() => api.get("/resource").as(mode)).not.toThrow();
    }
    for (const credentials of ["omit", "same-origin", "include"]) {
      expect(() => api.get("/resource").credentials(credentials)).not.toThrow();
    }
    for (const type of ["fixed", "exponential"]) {
      expect(() => api.get("/resource").retry(1, { backoff: { type } })).not.toThrow();
    }
    for (const jitter of ["none", "full"]) {
      expect(() => api.get("/resource").retry(1, { backoff: { jitter } })).not.toThrow();
    }
  });
});
