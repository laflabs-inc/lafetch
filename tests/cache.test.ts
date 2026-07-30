import { describe, expect, it } from "vitest";
import { MemoryCacheStore, type CacheStore } from "../src/cache.js";
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
          const notModified = new Response(null, {
            status: 304,
            headers: { ETag: "\"catalog-v1\"", "X-Revalidated": "true" },
          });
          Object.defineProperties(notModified, {
            url: { value: "https://api.example.com/cache/revalidate" },
            redirected: { value: true },
            type: { value: "cors" },
          });
          return notModified;
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
    expect(first.url).toBe("https://api.example.com/cache/revalidate");
    expect(second.url).toBe("https://api.example.com/cache/revalidate");
    expect(first.redirected).toBe(true);
    expect(second.type).toBe("cors");
    expect(calls).toBe(2);
  });

  it("does not let deduplication skip invalidation", async () => {
    let calls = 0;
    const memory = new MemoryCacheStore();
    let delayReads = false;
    let releaseRead!: () => void;
    let readStarted!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const started = new Promise<void>((resolve) => { readStarted = resolve; });
    const store = {
      async get(key: string) {
        const entry = memory.get(key);
        if (delayReads) {
          readStarted();
          await readGate;
        }
        return entry;
      },
      set: memory.set.bind(memory),
      delete: memory.delete.bind(memory),
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    await api.get("/cache/invalidate-dedupe").cache("1m", { store });
    delayReads = true;
    const ordinaryRequest = Promise.resolve(
      api.get<{ call: number }>("/cache/invalidate-dedupe")
        .cache("1m", { store })
        .dedupe(),
    );
    await started;
    const invalidated = await api.get<{ call: number }>("/cache/invalidate-dedupe")
      .cache("1m", { store, mode: "invalidate" })
      .dedupe();
    releaseRead();
    const ordinary = await ordinaryRequest;

    expect(ordinary.data.call).toBe(1);
    expect(invalidated.data.call).toBe(2);
    expect(calls).toBe(2);
  });

  it("prevents an older leader from overwriting a completed invalidation", async () => {
    let calls = 0;
    let releaseOrigin!: () => void;
    let originStarted!: () => void;
    const originGate = new Promise<void>((resolve) => { releaseOrigin = resolve; });
    const started = new Promise<void>((resolve) => { originStarted = resolve; });
    const store = new MemoryCacheStore();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(async () => {
        const call = ++calls;
        if (call === 1) {
          originStarted();
          await originGate;
        }
        return Response.json({ call });
      }),
    });

    const olderLeader = Promise.resolve(
      api.get<{ call: number }>("/cache/generation")
        .cache("1m", { store })
        .dedupe(),
    );
    await started;
    const invalidated = await api.get<{ call: number }>("/cache/generation")
      .cache("1m", { store, mode: "invalidate" })
      .dedupe();
    releaseOrigin();
    const older = await olderLeader;
    const cached = await api.get<{ call: number }>("/cache/generation").cache("1m", { store });

    expect(older.data.call).toBe(1);
    expect(invalidated.data.call).toBe(2);
    expect(cached.data.call).toBe(2);
    expect(calls).toBe(2);
  });

  it("serializes invalidation after an older pending cache write", async () => {
    let calls = 0;
    let releaseSet!: () => void;
    let setStarted!: () => void;
    const setGate = new Promise<void>((resolve) => { releaseSet = resolve; });
    const started = new Promise<void>((resolve) => { setStarted = resolve; });
    let keyCalls = 0;
    let invalidationKeyResolved!: () => void;
    const keyResolved = new Promise<void>((resolve) => { invalidationKeyResolved = resolve; });
    const key = () => {
      if (++keyCalls === 2) invalidationKeyResolved();
      return "pending-write";
    };
    const backing = new MemoryCacheStore();
    let blockFirstSet = true;
    const store: CacheStore = {
      get: (key) => backing.get(key),
      delete: (key) => backing.delete(key),
      async set(key, entry) {
        if (blockFirstSet) {
          blockFirstSet = false;
          setStarted();
          await setGate;
        }
        await backing.set(key, entry);
      },
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    const older = Promise.resolve(
      api.get<{ call: number }>("/cache/pending-write").cache("1m", { store, key }),
    );
    await started;
    const invalidated = Promise.resolve(
      api.get<{ call: number }>("/cache/pending-write")
        .cache("1m", { store, key, mode: "invalidate" }),
    );
    await keyResolved;
    await Promise.resolve();
    releaseSet();

    expect((await older).data.call).toBe(1);
    expect((await invalidated).data.call).toBe(2);
    const cached = await api.get<{ call: number }>("/cache/pending-write")
      .cache("1m", { store, key });
    expect(cached.data.call).toBe(2);
    expect(calls).toBe(2);
  });

  it("does not extend response freshness while a cache write waits in the commit queue", async () => {
    let now = 0;
    let calls = 0;
    let setCalls = 0;
    let releaseFirstSet!: () => void;
    let firstSetStarted!: () => void;
    const firstSetGate = new Promise<void>((resolve) => { releaseFirstSet = resolve; });
    const setStarted = new Promise<void>((resolve) => { firstSetStarted = resolve; });
    const entries = new Map<string, { response: Response; expiresAt: number }>();
    let finalizations = 0;
    const advanceQueueClock = {
      name: "advance-queue-clock",
      hooks: {
        finalize() {
          if (++finalizations !== 2) return;
          setTimeout(() => {
            now = 20;
            releaseFirstSet();
          }, 0);
        },
      },
    };
    const store: CacheStore = {
      get(key) {
        const entry = entries.get(key);
        return entry && {
          response: entry.response.clone(),
          expiresAt: entry.expiresAt,
        };
      },
      async set(key, entry) {
        setCalls += 1;
        if (setCalls === 1) {
          firstSetStarted();
          await firstSetGate;
        }
        entries.set(key, {
          response: entry.response.clone(),
          expiresAt: entry.expiresAt,
        });
      },
      delete(key) {
        entries.delete(key);
      },
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      runtime: { now: () => now },
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    const first = Promise.resolve(
      api.get("/cache/queued-expiry").cache("10ms", { store }).use(advanceQueueClock),
    );
    await setStarted;
    const second = Promise.resolve(
      api.get("/cache/queued-expiry").cache("10ms", { store }).use(advanceQueueClock),
    );
    await Promise.all([first, second]);

    expect(setCalls).toBe(1);
    expect([...entries.values()].map((entry) => entry.expiresAt)).toEqual([10]);
    expect(calls).toBe(2);
  });

  it("continues queued invalidation after an older cache write rejects", async () => {
    let calls = 0;
    let rejectSet!: () => void;
    let setStarted!: () => void;
    const setGate = new Promise<void>((_resolve, reject) => {
      rejectSet = () => reject(new Error("cache write failed"));
    });
    const started = new Promise<void>((resolve) => { setStarted = resolve; });
    let keyCalls = 0;
    let invalidationKeyResolved!: () => void;
    const keyResolved = new Promise<void>((resolve) => { invalidationKeyResolved = resolve; });
    const key = () => {
      if (++keyCalls === 2) invalidationKeyResolved();
      return "rejected-write";
    };
    const backing = new MemoryCacheStore();
    let rejectFirstSet = true;
    const store: CacheStore = {
      get: (key) => backing.get(key),
      delete: (key) => backing.delete(key),
      async set(key, entry) {
        if (rejectFirstSet) {
          rejectFirstSet = false;
          setStarted();
          await setGate;
        }
        await backing.set(key, entry);
      },
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    const older = Promise.resolve(
      api.get("/cache/rejected-write").cache("1m", { store, key }),
    );
    await started;
    const invalidated = Promise.resolve(
      api.get<{ call: number }>("/cache/rejected-write")
        .cache("1m", { store, key, mode: "invalidate" }),
    );
    await keyResolved;
    await Promise.resolve();
    rejectSet();

    await expect(older).rejects.toMatchObject({
      code: "ERR_HTTP_FEATURE",
      feature: "cache",
      hook: "finalize",
    });
    expect((await invalidated).data.call).toBe(2);
    const cached = await api.get<{ call: number }>("/cache/rejected-write")
      .cache("1m", { store, key });
    expect(cached.data.call).toBe(2);
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

  it.each([
    {
      name: "ignores Age without max-age",
      cacheControl: undefined,
      age: "999",
      expectedTtlMs: 10_000,
    },
    {
      name: "keeps the configured TTL as an upper bound",
      cacheControl: "public, max-age=20",
      age: "5",
      expectedTtlMs: 10_000,
    },
    {
      name: "subtracts Age from a compatible quoted max-age",
      cacheControl: "max-age=\"8\"",
      age: "3",
      expectedTtlMs: 5_000,
    },
    {
      name: "uses the first list member of Age",
      cacheControl: "max-age=8",
      age: "3, 7",
      expectedTtlMs: 5_000,
    },
    {
      name: "ignores an invalid first Age member",
      cacheControl: "max-age=8",
      age: "invalid, 7",
      expectedTtlMs: 8_000,
    },
    {
      name: "saturates an overflowing max-age before applying the TTL bound",
      cacheControl: `max-age=${"9".repeat(400)}`,
      age: "0",
      expectedTtlMs: 10_000,
    },
  ])("$name", async ({ cacheControl, age, expectedTtlMs }) => {
    const now = 1_000;
    let expiresAt: number | undefined;
    const store: CacheStore = {
      get() { return undefined; },
      set(_key, entry) { expiresAt = entry.expiresAt; },
      delete() {},
    };
    const headers = new Headers({ Age: age });
    if (cacheControl !== undefined) headers.set("Cache-Control", cacheControl);
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      runtime: { now: () => now },
      transport: mockTransport(() => new Response("value", { headers })),
    });

    await api.get("/cache/freshness").cache("10s", { store });

    expect(expiresAt).toBe(now + expectedTtlMs);
  });

  it.each([
    "max-age",
    "max-age=1.5",
    "max-age=\"10",
    "max-age=10, max-age=20",
  ])("treats invalid freshness information as stale: %s", async (cacheControl) => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json(
        { call: ++calls },
        { headers: { "Cache-Control": cacheControl } },
      )),
    });

    await api.get("/cache/invalid-freshness").cache("1m");
    await api.get("/cache/invalid-freshness").cache("1m");

    expect(calls).toBe(2);
  });

  it.each([
    "no-store, max-age=60",
    "max-age=60, no-cache",
    "public, private, max-age=60",
  ])("honors the most restrictive Cache-Control directive: %s", async (cacheControl) => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json(
        { call: ++calls },
        { headers: { "Cache-Control": cacheControl } },
      )),
    });

    await api.get("/cache/restricted").cache("1m");
    await api.get("/cache/restricted").cache("1m");

    expect(calls).toBe(2);
  });

  it("does not extend freshness during later response processing", async () => {
    let now = 1_000;
    let writes = 0;
    const store: CacheStore = {
      get() { return undefined; },
      set() { writes += 1; },
      delete() {},
    };
    const advanceClock = {
      name: "advance-response-clock",
      hooks: {
        afterResponse() {
          now = 5_000;
        },
      },
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      runtime: { now: () => now },
      transport: mockTransport(() => new Response("value", {
        headers: { "Cache-Control": "max-age=3" },
      })),
    });

    await api.get("/cache/response-delay")
      .cache("10s", { store })
      .use(advanceClock);

    expect(writes).toBe(0);
  });

  it("resets an inherited Age after a successful 304 without a new Age value", async () => {
    let now = 0;
    let calls = 0;
    const store = new MemoryCacheStore(10, () => now);
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      runtime: { now: () => now },
      transport: mockTransport((request) => {
        calls += 1;
        if (request.headers.has("if-none-match")) {
          return new Response(null, {
            status: 304,
            headers: { ETag: "\"age-v1\"" },
          });
        }
        return new Response("value", {
          headers: {
            Age: "9",
            "Cache-Control": "max-age=10",
            ETag: "\"age-v1\"",
          },
        });
      }),
    });

    await api.get("/cache/revalidated-age").cache("1m", { store, mode: "revalidate" });
    now = 1_001;
    await api.get("/cache/revalidated-age").cache("1m", { store, mode: "revalidate" });
    now += 2_000;
    const cached = await api.get("/cache/revalidated-age").cache("1m", {
      store,
      mode: "revalidate",
    });

    expect(cached.headers.get("age")).toBeNull();
    expect(calls).toBe(2);
  });

  it("removes a stale validator when revalidation becomes uncacheable", async () => {
    let now = 0;
    let calls = 0;
    const validators: Array<string | null> = [];
    const store = new MemoryCacheStore(10, () => now);
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      runtime: { now: () => now },
      transport: mockTransport((request) => {
        validators.push(request.headers.get("if-none-match"));
        calls += 1;
        if (calls === 1) {
          return new Response("old", {
            headers: {
              "Cache-Control": "max-age=1",
              ETag: "\"old\"",
            },
          });
        }
        return new Response("new", {
          headers: { "Cache-Control": "no-store" },
        });
      }),
    });

    await api.get("/cache/revalidation-no-store").cache("1m", { store, mode: "revalidate" });
    now = 1_001;
    await api.get("/cache/revalidation-no-store").cache("1m", { store, mode: "revalidate" });
    await api.get("/cache/revalidation-no-store").cache("1m", { store, mode: "revalidate" });

    expect(validators).toEqual([null, "\"old\"", null]);
  });

  it("applies storeFailure when uncacheable revalidation cleans up stale data", async () => {
    for (const storeFailure of ["throw", "bypass"] as const) {
      const store: CacheStore = {
        get() {
          return {
            response: Response.json(
              { value: "old" },
              { headers: { ETag: "\"old\"" } },
            ),
            expiresAt: 0,
          };
        },
        set() {},
        delete() { throw new Error("cache cleanup failed"); },
      };
      const api = lafetch.create({
        baseUrl: "https://api.example.com",
        transport: mockTransport(() => Response.json(
          { value: "new" },
          { headers: { "Cache-Control": "no-store" } },
        )),
      });
      const request = Promise.resolve(
        api.get<{ value: string }>("/cache/revalidation-cleanup")
          .cache("1m", { store, storeFailure, mode: "revalidate" }),
      );

      if (storeFailure === "throw") {
        await expect(request).rejects.toMatchObject({
          code: "ERR_HTTP_FEATURE",
          feature: "cache",
          hook: "finalize",
          cause: expect.objectContaining({ message: "cache cleanup failed" }),
        });
      } else {
        await expect(request).resolves.toHaveProperty("data", { value: "new" });
      }
    }
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
