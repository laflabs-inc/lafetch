import { describe, expect, it } from "vitest";
import { MemoryCacheStore } from "../src/cache.js";
import { lafetch } from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

describe("cache", () => {
  it("snapshots policy arrays before the implementation is loaded", async () => {
    let writes = 0;
    const methods = ["GET"];
    const statuses = [200];
    const store = {
      get() { return undefined; },
      set() { writes += 1; },
      delete() {},
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ ok: true })),
    });
    const request = api.get("/cache/snapshot").cache("1m", { methods, statuses, store });

    methods.length = 0;
    statuses.length = 0;
    await request;

    expect(writes).toBe(1);
  });

  it("reuses a successful response across requests", async () => {
    let calls = 0;
    const store = new MemoryCacheStore();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    const first = await api.get<{ call: number }>("/cache/basic").cache("1m", { store });
    const second = await api.get<{ call: number }>("/cache/basic").cache("1m", { store });

    expect(first.data.call).toBe(1);
    expect(second.data.call).toBe(1);
    expect(calls).toBe(1);
  });

  it("invalidates the resolved key before dispatch and stores the replacement", async () => {
    let calls = 0;
    const store = new MemoryCacheStore();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    expect((await api.get<{ call: number }>("/cache/invalidate").cache("1m", { store })).data.call).toBe(1);
    expect((await api.get<{ call: number }>("/cache/invalidate").cache("1m", {
      store,
      mode: "invalidate",
    })).data.call).toBe(2);
    expect((await api.get<{ call: number }>("/cache/invalidate").cache("1m", { store })).data.call).toBe(2);
    expect(calls).toBe(2);
  });

  it("conditionally revalidates a stale ETag response without sharing its Body", async () => {
    let now = 1_000;
    let calls = 0;
    const store = new MemoryCacheStore(10, () => now);
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      runtime: { now: () => now },
      transport: mockTransport((request) => {
        calls += 1;
        if (request.headers.get("if-none-match") === "\"catalog-v1\"") {
          return new Response(null, {
            status: 304,
            headers: { ETag: "\"catalog-v1\"", "X-Revalidated": "true" },
          });
        }
        return Response.json(
          { version: 1 },
          { headers: { ETag: "\"catalog-v1\"", "Cache-Control": "max-age=1" } },
        );
      }),
    });

    await api.get("/cache/revalidate").cache("1s", { store, mode: "revalidate" });
    now += 1_001;
    const first = await api.get<{ version: number }>("/cache/revalidate")
      .cache("1s", { store, mode: "revalidate" });
    const second = await api.get<{ version: number }>("/cache/revalidate")
      .cache("1s", { store, mode: "revalidate" });

    expect(first.data).toEqual({ version: 1 });
    expect(second.data).toEqual({ version: 1 });
    expect(first.headers.get("x-revalidated")).toBe("true");
    expect(calls).toBe(2);
  });

  it("uses Last-Modified when ETag is unavailable and deletes unvalidated stale entries", async () => {
    let now = 10_000;
    const seen: Array<string | null> = [];
    const store = new MemoryCacheStore(10, () => now);
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      runtime: { now: () => now },
      transport: mockTransport((request) => {
        seen.push(request.headers.get("if-modified-since"));
        return new Response("value", {
          headers: { "Last-Modified": "Wed, 29 Jul 2026 00:00:00 GMT" },
        });
      }),
    });

    await api.get("/cache/last-modified").cache("1ms", { store, mode: "revalidate" });
    now += 2;
    await api.get("/cache/last-modified").cache("1ms", { store, mode: "revalidate" });

    expect(seen).toEqual([null, "Wed, 29 Jul 2026 00:00:00 GMT"]);

    let deletes = 0;
    const unvalidatedStore = {
      get() {
        return {
          response: Response.json({ stale: true }),
          expiresAt: now - 1,
        };
      },
      set() {},
      delete() { deletes += 1; },
    };
    await api.get("/cache/no-validator").cache("1m", {
      store: unvalidatedStore,
      mode: "revalidate",
    });
    expect(deletes).toBe(1);
  });

  it("throws on CacheStore read failures by default", async () => {
    const transport = mockTransport(() => Response.json({ unused: true }));
    const store = {
      get() { throw new Error("cache unavailable"); },
      set() {},
      delete() {},
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport,
    });

    await expect(api.get("/cache/read-failure").cache("1m", { store }))
      .rejects.toMatchObject({
        code: "ERR_HTTP_FEATURE",
        feature: "cache",
        hook: "intercept",
        cause: expect.objectContaining({ message: "cache unavailable" }),
      });
    expect(transport.calls).toHaveLength(0);
  });

  it("bypasses CacheStore read failures only when explicitly requested", async () => {
    let calls = 0;
    const store = {
      get() { throw new Error("cache unavailable"); },
      set() {},
      delete() {},
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    const result = await api.get<{ call: number }>("/cache/read-bypass")
      .cache("1m", { store, storeFailure: "bypass" });

    expect(result.data.call).toBe(1);
    expect(calls).toBe(1);
  });

  it("keeps the origin response when a bypassed CacheStore write fails", async () => {
    let calls = 0;
    const store = {
      get() { return undefined; },
      set() { throw new Error("cache unavailable"); },
      delete() {},
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    const first = await api.get<{ call: number }>("/cache/write-bypass")
      .cache("1m", { store, storeFailure: "bypass" });
    const second = await api.get<{ call: number }>("/cache/write-bypass")
      .cache("1m", { store, storeFailure: "bypass" });

    expect([first.data.call, second.data.call]).toEqual([1, 2]);
  });

  it("treats expired-entry cleanup failures as a miss in bypass mode", async () => {
    let calls = 0;
    const store = {
      get() {
        return {
          response: Response.json({ stale: true }),
          expiresAt: Date.now() - 1,
        };
      },
      set() {},
      delete() { throw new Error("cache unavailable"); },
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    const result = await api.get<{ call: number }>("/cache/delete-bypass")
      .cache("1m", { store, storeFailure: "bypass" });

    expect(result.data.call).toBe(1);
  });

  it("rejects malformed Store entries in throw mode and bypasses them on request", async () => {
    let calls = 0;
    const store = {
      get() {
        return {
          response: "not a Response",
          expiresAt: Number.NaN,
        } as any;
      },
      set() {},
      delete() {},
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    await expect(api.get("/cache/malformed").cache("1m", { store }))
      .rejects.toMatchObject({
        code: "ERR_HTTP_FEATURE",
        feature: "cache",
        hook: "intercept",
      });
    const result = await api.get<{ call: number }>("/cache/malformed")
      .cache("1m", { store, storeFailure: "bypass" });

    expect(result.data.call).toBe(1);
  });

  it("bypasses credentialed requests", async () => {
    let calls = 0;
    const store = new MemoryCacheStore();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    await api.get("/cache/private").credentials("include").cache("30s", { store });
    await api.get("/cache/private").credentials("include").cache("30s", { store });

    expect(calls).toBe(2);
  });

  it("bypasses token-bearing headers and query parameters", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    await api.get("/cache/private")
      .header("X-Auth-Token", "secret")
      .query({ user_token: "secret" })
      .cache("1m");
    await api.get("/cache/private")
      .header("X-Auth-Token", "secret")
      .query({ user_token: "secret" })
      .cache("1m");

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

    const first = await firstApi.get<{ tenant: string }>("/cache/isolated").cache("30s");
    const second = await secondApi.get<{ tenant: string }>("/cache/isolated").cache("30s");

    expect(first.data.tenant).toBe("first");
    expect(second.data.tenant).toBe("second");
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

    const first = await api.get<{ tenant: string }>("/cache/tenant").header("X-Tenant", "first").cache("30s");
    const second = await api.get<{ tenant: string }>("/cache/tenant").header("X-Tenant", "second").cache("30s");

    expect(first.data.tenant).toBe("first");
    expect(second.data.tenant).toBe("second");
    expect(calls).toBe(2);
  });

  it("keys from the final Request after beforeAttempt mutations", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((request) => {
        calls += 1;
        return Response.json({ tenant: request.headers.get("x-tenant") });
      }),
    });
    const tenant = (value: string) => ({
      name: `tenant-${value}`,
      hooks: {
        beforeAttempt({ draft }: { draft: { headers: Headers } }) {
          draft.headers.set("X-Tenant", value);
        },
      },
    });

    const first = await api.get<{ tenant: string }>("/cache/final-request")
      .cache("30s")
      .use(tenant("first"));
    const second = await api.get<{ tenant: string }>("/cache/final-request")
      .cache("30s")
      .use(tenant("second"));

    expect(first.data.tenant).toBe("first");
    expect(second.data.tenant).toBe("second");
    expect(calls).toBe(2);
  });

  it("bypasses credentials added during beforeAttempt", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });
    const authentication = {
      name: "authentication",
      hooks: {
        beforeAttempt({ draft }: { draft: { headers: Headers } }) {
          draft.headers.set("Authorization", "Bearer secret");
        },
      },
    };

    await api.get("/cache/late-credentials").cache("30s").use(authentication);
    await api.get("/cache/late-credentials").cache("30s").use(authentication);

    expect(calls).toBe(2);
  });

  it("rejects unsafe methods without a caller-owned key even when methods opts in", () => {
    const transport = mockTransport(() => Response.json({ unused: true }));
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport,
    });

    expect(() => api.post("/cache/unsafe").body("first").cache("30s", { methods: ["POST"] }))
      .toThrow(expect.objectContaining({ code: "ERR_HTTP_CONFIGURATION" }));
    expect(transport.calls).toHaveLength(0);
  });

  it("allows an unsafe method with an explicit caller-owned key", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(async (request) => Response.json({ call: ++calls, body: await request.text() })),
    });

    const first = await api.post<{ call: number; body: string }>("/cache/keyed-write")
      .body("same")
      .cache("30s", { key: async (request) => `keyed-write:${await request.text()}` });
    const second = await api.post<{ call: number; body: string }>("/cache/keyed-write")
      .body("same")
      .cache("30s", { key: async (request) => `keyed-write:${await request.text()}` });

    expect(first.data.call).toBe(1);
    expect(second.data.call).toBe(1);
    expect(first.data.body).toBe("same");
    expect(calls).toBe(1);
  });

  it("does not cache a response with max-age=0", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json(
        { call: ++calls },
        { headers: { "Cache-Control": "public, max-age=0" } },
      )),
    });

    expect((await api.get<{ call: number }>("/cache/server-policy").cache("1m")).data.call).toBe(1);
    expect((await api.get<{ call: number }>("/cache/server-policy").cache("1m")).data.call).toBe(2);
  });

  it("does not store a response that fails the buffer limit", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => {
        calls += 1;
        if (calls === 1) return new Response("oversized");
        return new Response("ok", { headers: { "content-type": "text/plain" } });
      }),
    });

    await expect(api.get("/cache/oversized").cache("1m").maxResponseBytes(2))
      .rejects.toMatchObject({ code: "ERR_HTTP_RESPONSE_TOO_LARGE" });
    await expect(api.get<string>("/cache/oversized").cache("1m").maxResponseBytes(2))
      .resolves.toHaveProperty("data", "ok");
    expect(calls).toBe(2);
  });

  it("stores a configured status only when the request accepts it", async () => {
    let rejectedCalls = 0;
    let acceptedCalls = 0;
    const rejected = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => {
        rejectedCalls += 1;
        return Response.json({ cached: false }, { status: 404 });
      }),
    });
    const accepted = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => {
        acceptedCalls += 1;
        return Response.json({ cached: true }, { status: 404 });
      }),
    });

    await expect(rejected.get("/cache/rejected").cache("1m", { statuses: [404] }))
      .rejects.toMatchObject({ code: "ERR_HTTP_STATUS" });
    await expect(rejected.get("/cache/rejected").cache("1m", { statuses: [404] }))
      .rejects.toMatchObject({ code: "ERR_HTTP_STATUS" });

    await accepted.get("/cache/accepted").cache("1m", { statuses: [404] }).acceptStatus([404]);
    await accepted.get("/cache/accepted").cache("1m", { statuses: [404] }).acceptStatus([404]);

    expect(rejectedCalls).toBe(2);
    expect(acceptedCalls).toBe(1);
  });

  it("rejects a deduplicated group consistently when Cache finalization fails", async () => {
    let calls = 0;
    const store = {
      get() { return undefined; },
      set() { throw new Error("cache unavailable"); },
      delete() {},
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Response.json({ ok: true });
      }),
    });

    const results = await Promise.allSettled([
      api.get("/cache/finalize-failure").cache("1m", { store }).dedupe(),
      api.get("/cache/finalize-failure").cache("1m", { store }).dedupe(),
    ]);

    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ code: "ERR_HTTP_FEATURE", feature: "cache", hook: "finalize" });
      }
    }
    expect(calls).toBe(1);
  });
});
