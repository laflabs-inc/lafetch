import { describe, expect, it, vi } from "vitest";
import { HttpFeatureConflictError, HttpFeatureError, lafetch } from "../src/index.js";
import { defineFeature, type RequestFeature } from "../src/feature.js";
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
    });

    await api.get("/resource").use(second).use(first);

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

  it("rejects duplicate Feature names instead of silently overriding policy", async () => {
    const firstHook = vi.fn();
    const requestHook = vi.fn();
    const transport = mockTransport(() => new Response(null, { status: 204 }));
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport,
    });

    await expect(api
      .get("/resource")
      .use({ name: "trace", hooks: { prepare: firstHook } })
      .use({ name: "trace", hooks: { prepare: requestHook } }))
      .rejects.toBeInstanceOf(HttpFeatureConflictError);

    expect(firstHook).not.toHaveBeenCalled();
    expect(requestHook).not.toHaveBeenCalled();
    expect(transport.calls).toHaveLength(0);
  });

  it("preserves Feature inference through the advanced helper", () => {
    const feature = defineFeature({
      name: "typed-feature",
      hooks: { prepare: vi.fn() },
    });

    expect(feature.name).toBe("typed-feature");
  });

  it("snapshots a custom Feature when it is attached to a builder", async () => {
    const originalHook = vi.fn();
    const mutatedHook = vi.fn();
    const feature: RequestFeature = {
      name: "stable-feature",
      hooks: { prepare: originalHook },
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 204 })),
    });
    const request = api.get("/resource").use(feature);

    feature.hooks!.prepare = mutatedHook;

    await request;
    expect(originalHook).toHaveBeenCalledOnce();
    expect(mutatedHook).not.toHaveBeenCalled();
  });

  it("rejects exclusive capability conflicts", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 204 })),
    });

    await expect(api
      .get("/resource")
      .use({ name: "memory-cache", capabilities: { provides: [{ name: "cache" }] } })
      .use({ name: "redis-cache", capabilities: { provides: [{ name: "cache" }] } }))
      .rejects.toBeInstanceOf(HttpFeatureConflictError);
  });

  it("rejects ordering cycles", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 204 })),
    });

    await expect(api
      .get("/resource")
      .use({ name: "a", ordering: { after: ["b"] } })
      .use({ name: "b", ordering: { after: ["a"] } }))
      .rejects.toMatchObject({
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

    await expect(request.retry(2)).rejects.toBeInstanceOf(HttpFeatureError);
    expect(transport.calls).toHaveLength(0);
  });

  it("isolates state per Feature while sharing request metadata", async () => {
    const observations: string[] = [];
    const first: RequestFeature = {
      name: "first",
      hooks: {
        prepare({ state, metadata }) {
          state.set("value", "first-state");
          metadata.set("shared", "request-metadata");
        },
        beforeAttempt({ state }) {
          observations.push(String(state.get("value")));
        },
      },
    };
    const second: RequestFeature = {
      name: "second",
      hooks: {
        prepare({ state, metadata }) {
          observations.push(String(state.has("value")));
          observations.push(String(metadata.get("shared")));
          state.set("value", "second-state");
        },
        beforeAttempt({ state }) {
          observations.push(String(state.get("value")));
        },
      },
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 204 })),
    });

    await api.get("/resource").use(first).use(second);

    expect(observations).toEqual(["false", "request-metadata", "first-state", "second-state"]);
  });

  it("can intercept Transport dispatch and transform the resulting Response", async () => {
    const transport = mockTransport(() => {
      throw new Error("Transport must not run");
    });
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport,
    });

    const result = await api
      .get<{ value: number }>("/resource")
      .use({
        name: "fixture",
        hooks: { intercept: () => Response.json({ value: 1 }) },
      })
      .use({
        name: "transform",
        hooks: {
          async afterResponse({ response }) {
            const data = await response.json() as { value: number };
            return Response.json({ value: data.value + 1 });
          },
        },
      })
      .response();

    expect(result.data).toEqual({ value: 2 });
    expect(result.meta.transport).toBe("feature:fixture");
    expect(transport.calls).toHaveLength(0);
  });

  it("maps the final error in reverse Feature order before finalization", async () => {
    const finalized: string[] = [];
    const first: RequestFeature = {
      name: "first",
      hooks: {
        mapError: ({ error }) => new Error(`first:${error.message}`),
        finalize: ({ error }) => { finalized.push((error as Error).message); },
      },
    };
    const second: RequestFeature = {
      name: "second",
      hooks: {
        mapError: ({ error }) => new Error(`second:${error.message}`),
        finalize: ({ error }) => { finalized.push((error as Error).message); },
      },
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 500, statusText: "Broken" })),
    });

    await expect(api.get("/resource").use(first).use(second))
      .rejects.toThrow("first:second:HTTP 500 Broken.");
    expect(finalized).toEqual([
      "first:second:HTTP 500 Broken.",
      "first:second:HTTP 500 Broken.",
    ]);
  });

  it("rejects unknown strict ordering targets but allows optional targets", async () => {
    const transport = mockTransport(() => new Response(null, { status: 204 }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    await expect(api.get("/strict").use({
      name: "strict",
      ordering: { before: ["missing"] },
    })).rejects.toMatchObject({ code: "ERR_HTTP_FEATURE_CONFLICT" });

    await expect(api.get("/optional").use({
      name: "optional",
      ordering: { optionalBefore: ["missing"] },
    }).response()).resolves.toMatchObject({ status: 204 });
  });

  it("isolates finalizer response bodies", async () => {
    const bodies: string[] = [];
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response("payload")),
    });

    const request = ["first", "second"].reduce(
      (builder, name) => builder.use({
        name,
        hooks: { finalize: async ({ response }) => {
          bodies.push(await response!.text());
        } },
      }),
      api.get("/finalize"),
    );

    await request;
    expect(bodies).toEqual(["payload", "payload"]);
  });
});
