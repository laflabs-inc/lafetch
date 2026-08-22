import { describe, expect, it, vi } from "vitest";
import { HttpFeatureConflictError, HttpFeatureError, lafetch } from "../src/index.js";
import { resolveFeatures } from "../src/core/features.js";
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

  it("awaits non-transforming hooks sequentially in resolved Feature order", async () => {
    const events: string[] = [];
    const record = async (label: string) => {
      events.push(`${label}:start`);
      await Promise.resolve();
      events.push(`${label}:end`);
    };
    const feature = (name: string, ordering?: RequestFeature["ordering"]): RequestFeature => ({
      name,
      ...(ordering !== undefined ? { ordering } : {}),
      hooks: {
        async onEvent({ event }) {
          if (event.type === "request:start") await record(`${name}:onEvent`);
        },
        async prepare() { await record(`${name}:prepare`); },
        async beforeAttempt() { await record(`${name}:beforeAttempt`); },
        async onAttemptError() { await record(`${name}:onAttemptError`); },
      },
    });
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => { throw new TypeError("offline"); }),
    });

    await expect(api.get("/resource")
      .use(feature("second"))
      .use(feature("first", { before: ["second"] })))
      .rejects.toMatchObject({ code: "ERR_HTTP_TRANSPORT" });

    expect(events).toEqual([
      "first:onEvent:start", "first:onEvent:end", "second:onEvent:start", "second:onEvent:end",
      "first:prepare:start", "first:prepare:end", "second:prepare:start", "second:prepare:end",
      "first:beforeAttempt:start", "first:beforeAttempt:end",
      "second:beforeAttempt:start", "second:beforeAttempt:end",
      "first:onAttemptError:start", "first:onAttemptError:end",
      "second:onAttemptError:start", "second:onAttemptError:end",
    ]);
  });

  it("preserves hook receivers, per-Feature state, and shared request metadata", async () => {
    const firstReceivers: unknown[] = [];
    const secondReceivers: unknown[] = [];
    const states: Array<Map<PropertyKey, unknown>> = [];
    const metadata: Array<Map<string, unknown>> = [];
    const firstHooks: NonNullable<RequestFeature["hooks"]> = {
      onEvent({ event, state, metadata: shared }) {
        firstReceivers.push(this);
        if (event.type !== "request:start") return;
        state.set("owner", "first");
        shared.set("shared", "yes");
        states.push(state);
        metadata.push(shared);
      },
      prepare({ state, metadata: shared }) {
        firstReceivers.push(this);
        expect(state.get("owner")).toBe("first");
        states.push(state);
        metadata.push(shared);
      },
      beforeAttempt({ state, metadata: shared }) {
        firstReceivers.push(this);
        expect(state.get("owner")).toBe("first");
        states.push(state);
        metadata.push(shared);
      },
      onAttemptError({ state, metadata: shared }) {
        firstReceivers.push(this);
        expect(state.get("owner")).toBe("first");
        states.push(state);
        metadata.push(shared);
      },
    };
    const secondHooks: NonNullable<RequestFeature["hooks"]> = {
      onEvent({ event, state, metadata: shared }) {
        secondReceivers.push(this);
        if (event.type !== "request:start") return;
        expect(state.has("owner")).toBe(false);
        expect(shared.get("shared")).toBe("yes");
        state.set("owner", "second");
        states.push(state);
        metadata.push(shared);
      },
      prepare({ state, metadata: shared }) {
        secondReceivers.push(this);
        expect(state.get("owner")).toBe("second");
        states.push(state);
        metadata.push(shared);
      },
      beforeAttempt({ state, metadata: shared }) {
        secondReceivers.push(this);
        expect(state.get("owner")).toBe("second");
        states.push(state);
        metadata.push(shared);
      },
      onAttemptError({ state, metadata: shared }) {
        secondReceivers.push(this);
        expect(state.get("owner")).toBe("second");
        states.push(state);
        metadata.push(shared);
      },
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => { throw new TypeError("offline"); }),
    });

    await expect(api.get("/resource")
      .use({ name: "first", hooks: firstHooks })
      .use({ name: "second", hooks: secondHooks }))
      .rejects.toMatchObject({ code: "ERR_HTTP_TRANSPORT" });

    expect(new Set(firstReceivers)).toHaveLength(1);
    expect(new Set(secondReceivers)).toHaveLength(1);
    expect(firstReceivers[0]).not.toBe(secondReceivers[0]);
    expect(new Set(states)).toHaveLength(2);
    expect(new Set(metadata)).toHaveLength(1);
  });

  it("labels failures from every non-transforming hook with its exact hook name", async () => {
    const cases: Array<{ hook: string; feature: RequestFeature; transportFails?: boolean }> = [
      { hook: "onEvent", feature: { name: "broken", hooks: { onEvent() { throw new Error("broken"); } } } },
      { hook: "prepare", feature: { name: "broken", hooks: { prepare() { throw new Error("broken"); } } } },
      {
        hook: "beforeAttempt",
        feature: { name: "broken", hooks: { beforeAttempt() { throw new Error("broken"); } } },
      },
      {
        hook: "onAttemptError",
        feature: { name: "broken", hooks: { onAttemptError() { throw new Error("broken"); } } },
        transportFails: true,
      },
    ];

    for (const { hook, feature, transportFails } of cases) {
      const api = lafetch.create({
        baseUrl: "https://api.example.com",
        transport: mockTransport(() => {
          if (transportFails) throw new TypeError("offline");
          return new Response(null, { status: 204 });
        }),
      });

      await expect(api.get("/resource").use(feature)).rejects.toMatchObject({
        message: `Feature "broken" failed in the ${hook} hook.`,
        feature: "broken",
        hook,
      });
    }
  });

  it("keeps stable ordering, duplicate edges, optional targets, and conflict messages", () => {
    const ordered = resolveFeatures([
      { name: "independent-first" },
      { name: "dependent", ordering: { after: ["prerequisite", "prerequisite"] } },
      { name: "prerequisite", ordering: { before: ["dependent", "dependent"] } },
      { name: "independent-last", ordering: { optionalBefore: ["missing"] } },
    ]);

    expect(ordered.map(({ name }) => name)).toEqual([
      "independent-first",
      "prerequisite",
      "dependent",
      "independent-last",
    ]);
    expect(() => resolveFeatures([
      { name: "a", ordering: { after: ["b"] } },
      { name: "b", ordering: { after: ["a"] } },
    ])).toThrow("Feature ordering contains a cycle: a -> b.");
    expect(() => resolveFeatures([
      { name: "known", ordering: { before: ["missing"] } },
    ])).toThrow('Feature ordering references unknown Feature "missing".');
    expect(() => resolveFeatures([
      { name: "self", ordering: { optionalAfter: ["self"] } },
    ])).toThrow('Feature "self" cannot order itself.');
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

  it("snapshots a custom Feature when it is attached to an LRequest", async () => {
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
      });

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
    })).resolves.toMatchObject({ status: 204 });
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
