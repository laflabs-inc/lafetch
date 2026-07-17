import { describe, expect, it, vi } from "vitest";
import { HttpFeatureConflictError, HttpFeatureError, lafetch, type RequestFeature } from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

describe("request features", () => {
  it("orders hooks through a stable dependency graph and finalizes in reverse", async () => {
    const events: string[] = [];
    const first: RequestFeature = {
      name: "first",
      ordering: { before: ["second"] },
      hooks: {
        prepare: () => { events.push("first:prepare"); },
        beforeAttempt: () => { events.push("first:attempt"); },
        afterResponse: () => { events.push("first:response"); },
        finalize: () => { events.push("first:finalize"); },
      },
    };
    const second: RequestFeature = {
      name: "second",
      hooks: {
        prepare: () => { events.push("second:prepare"); },
        beforeAttempt: () => { events.push("second:attempt"); },
        afterResponse: () => { events.push("second:response"); },
        finalize: () => { events.push("second:finalize"); },
      },
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 204 })),
      features: [second, first],
    });

    await api.get("/resource");

    expect(events).toEqual([
      "first:prepare",
      "second:prepare",
      "first:attempt",
      "second:attempt",
      "first:response",
      "second:response",
      "second:finalize",
      "first:finalize",
    ]);
  });

  it("lets a request override a client feature with the same name", async () => {
    const clientHook = vi.fn();
    const requestHook = vi.fn();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 204 })),
      features: [{ name: "trace", hooks: { prepare: clientHook } }],
    });

    await api.get("/resource").use({ name: "trace", hooks: { prepare: requestHook } });

    expect(clientHook).not.toHaveBeenCalled();
    expect(requestHook).toHaveBeenCalledOnce();
  });

  it("rejects exclusive capability conflicts", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 204 })),
      features: [
        { name: "memory-cache", capabilities: { provides: [{ name: "cache" }] } },
        { name: "redis-cache", capabilities: { provides: [{ name: "cache" }] } },
      ],
    });

    await expect(api.get("/resource")).rejects.toBeInstanceOf(HttpFeatureConflictError);
  });

  it("rejects ordering cycles", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 204 })),
      features: [
        { name: "a", ordering: { after: ["b"] } },
        { name: "b", ordering: { after: ["a"] } },
      ],
    });

    await expect(api.get("/resource")).rejects.toMatchObject({
      code: "ERR_HTTP_FEATURE_CONFLICT",
    });
  });

  it("does not misclassify feature failures as transport failures", async () => {
    const transport = mockTransport(() => new Response(null, { status: 204 }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    const request = api.get("/resource").use({
      name: "broken",
      hooks: {
        beforeAttempt() {
          throw new Error("broken hook");
        },
      },
    });

    await expect(request.retry(3)).rejects.toBeInstanceOf(HttpFeatureError);
    expect(transport.calls).toHaveLength(0);
  });
});
