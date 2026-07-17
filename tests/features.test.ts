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
      features: [first, second],
    });

    await api.get("/resource");

    expect(observations).toEqual(["false", "request-metadata", "first-state", "second-state"]);
  });

  it("can intercept Transport dispatch and transform the resulting Response", async () => {
    const transport = mockTransport(() => {
      throw new Error("Transport must not run");
    });
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport,
      features: [
        {
          name: "fixture",
          hooks: {
            intercept: () => Response.json({ value: 1 }),
          },
        },
        {
          name: "transform",
          hooks: {
            async afterResponse({ response }) {
              const data = await response.json() as { value: number };
              return Response.json({ value: data.value + 1 });
            },
          },
        },
      ],
    });

    const result = await api.get<{ value: number }>("/resource");

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
      features: [first, second],
    });

    await expect(api.get("/resource")).rejects.toThrow("first:second:HTTP 500 Broken.");
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
      features: ["first", "second"].map((name) => ({
        name,
        hooks: { finalize: async ({ response }: { response?: Response }) => {
          bodies.push(await response!.text());
        } },
      })),
    });

    await api.get("/finalize");
    expect(bodies).toEqual(["payload", "payload"]);
  });
});
