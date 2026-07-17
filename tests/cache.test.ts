import { describe, expect, it } from "vitest";
import { lafetch, MemoryCacheStore } from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

describe("cache", () => {
  it("reuses a successful response across builders", async () => {
    let calls = 0;
    const store = new MemoryCacheStore();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    const first = await api.get("/cache/basic").cache({ ttl: "1m", store }).json<{ call: number }>();
    const second = await api.get("/cache/basic").cache({ ttl: "1m", store }).json<{ call: number }>();

    expect(first.call).toBe(1);
    expect(second.call).toBe(1);
    expect(calls).toBe(1);
  });

  it("bypasses credentialed requests", async () => {
    let calls = 0;
    const store = new MemoryCacheStore();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    await api.get("/cache/private").credentials("include").cache({ store });
    await api.get("/cache/private").credentials("include").cache({ store });

    expect(calls).toBe(2);
  });

  it("bypasses token-bearing headers and query parameters", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      cache: "1m",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    await api.get("/cache/private", {
      headers: { "X-Auth-Token": "secret" },
      query: { user_token: "secret" },
    });
    await api.get("/cache/private", {
      headers: { "X-Auth-Token": "secret" },
      query: { user_token: "secret" },
    });

    expect(calls).toBe(2);
  });

  it("isolates the default store between clients", async () => {
    const firstApi = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ tenant: "first" })),
    });
    const secondApi = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ tenant: "second" })),
    });

    const first = await firstApi.get("/cache/isolated").cache().json<{ tenant: string }>();
    const second = await secondApi.get("/cache/isolated").cache().json<{ tenant: string }>();

    expect(first.tenant).toBe("first");
    expect(second.tenant).toBe("second");
  });

  it("creates a fresh policy scope for extend()", async () => {
    const base = lafetch.create({
      baseUrl: "https://api.example.com",
      cache: true,
      transport: mockTransport(() => Response.json({ client: "base" })),
    });
    const extended = base.extend({
      transport: mockTransport(() => Response.json({ client: "extended" })),
    });

    expect((await base.get("/cache/extended").json<{ client: string }>()).client).toBe("base");
    expect((await extended.get("/cache/extended").json<{ client: string }>()).client).toBe("extended");
  });

  it("includes tenant and representation headers in the default key", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((request) => {
        calls += 1;
        return Response.json({ tenant: request.headers.get("x-tenant") });
      }),
    });

    const first = await api.get("/cache/tenant", { headers: { "X-Tenant": "first" }, cache: true })
      .json<{ tenant: string }>();
    const second = await api.get("/cache/tenant", { headers: { "X-Tenant": "second" }, cache: true })
      .json<{ tenant: string }>();

    expect(first.tenant).toBe("first");
    expect(second.tenant).toBe("second");
    expect(calls).toBe(2);
  });

  it("supports a cache default on create() and a per-request opt out", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      cache: "1m",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    expect((await api.get("/cache/default").json<{ call: number }>()).call).toBe(1);
    expect((await api.get("/cache/default").json<{ call: number }>()).call).toBe(1);
    expect((await api.get("/cache/default", { cache: false }).json<{ call: number }>()).call).toBe(2);
  });

  it("does not cache a response with max-age=0", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      cache: "1m",
      transport: mockTransport(() => Response.json(
        { call: ++calls },
        { headers: { "Cache-Control": "public, max-age=0" } },
      )),
    });

    expect((await api.get("/cache/server-policy").json<{ call: number }>()).call).toBe(1);
    expect((await api.get("/cache/server-policy").json<{ call: number }>()).call).toBe(2);
  });
});
