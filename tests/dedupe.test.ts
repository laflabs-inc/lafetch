import { describe, expect, it } from "vitest";
import { lafetch } from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

describe("deduplication", () => {
  it("shares concurrent executions across requests", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Response.json({ ok: true });
      }),
    });

    const [first, second] = await Promise.all([
      api.get<{ ok: boolean }>("/dedupe/basic").dedupe(),
      api.get<{ ok: boolean }>("/dedupe/basic").dedupe(),
    ]);

    expect(first.data.ok).toBe(true);
    expect(second.data.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it("lets a follower abort without cancelling the leader", async () => {
    const controller = new AbortController();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return Response.json({ ok: true });
      }),
    });
    const leader = api.get<{ ok: boolean }>("/dedupe/abort").dedupe();
    const follower = api.get("/dedupe/abort").signal(controller.signal).dedupe();
    setTimeout(() => controller.abort("follower cancelled"), 5);

    await expect(follower).rejects.toMatchObject({ code: "ERR_HTTP_ABORTED" });
    await expect(leader).resolves.toHaveProperty("data.ok", true);
  });

  it("elects one replacement leader when an aborted leader has multiple followers", async () => {
    const leaderController = new AbortController();
    let calls = 0;
    let markLeaderStarted!: () => void;
    const leaderStarted = new Promise<void>((resolve) => { markLeaderStarted = resolve; });
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((_request, context) => {
        calls += 1;
        if (calls === 2) return Response.json({ fallback: true });
        markLeaderStarted();
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
        });
      }),
    });

    const leader = api.get("/dedupe/fallback")
      .signal(leaderController.signal)
      .dedupe()
      .then((value) => value);
    await leaderStarted;
    const followers = [
      api.get<{ fallback: boolean }>("/dedupe/fallback").dedupe().then((value) => value.data),
      api.get<{ fallback: boolean }>("/dedupe/fallback").dedupe().then((value) => value.data),
    ];
    await new Promise((resolve) => setTimeout(resolve, 0));
    leaderController.abort("leader cancelled");

    const [leaderResult, ...followerResults] = await Promise.allSettled([leader, ...followers]);
    expect(leaderResult).toMatchObject({
      status: "rejected",
      reason: { code: "ERR_HTTP_ABORTED" },
    });
    expect(followerResults).toEqual([
      { status: "fulfilled", value: { fallback: true } },
      { status: "fulfilled", value: { fallback: true } },
    ]);
    expect(calls).toBe(2);
  });

  it("isolates in-flight requests between clients", async () => {
    const firstApi = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Response.json({ tenant: "first" });
      }),
    });
    const secondApi = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Response.json({ tenant: "second" });
      }),
    });

    const [first, second] = await Promise.all([
      firstApi.get<{ tenant: string }>("/dedupe/isolated").dedupe(),
      secondApi.get<{ tenant: string }>("/dedupe/isolated").dedupe(),
    ]);

    expect(first.data.tenant).toBe("first");
    expect(second.data.tenant).toBe("second");
  });

  it("does not merge concurrent requests with different tenant headers", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(async (request) => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Response.json({ tenant: request.headers.get("x-tenant") });
      }),
    });

    const [first, second] = await Promise.all([
      api.get<{ tenant: string }>("/dedupe/tenant").header("X-Tenant", "first").dedupe(),
      api.get<{ tenant: string }>("/dedupe/tenant").header("X-Tenant", "second").dedupe(),
    ]);

    expect(first.data.tenant).toBe("first");
    expect(second.data.tenant).toBe("second");
    expect(calls).toBe(2);
  });

  it("keys from the final Request after beforeAttempt mutations", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(async (request) => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
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

    const [first, second] = await Promise.all([
      api.get<{ tenant: string }>("/dedupe/final-request").dedupe().use(tenant("first")),
      api.get<{ tenant: string }>("/dedupe/final-request").dedupe().use(tenant("second")),
    ]);

    expect(first.data.tenant).toBe("first");
    expect(second.data.tenant).toBe("second");
    expect(calls).toBe(2);
  });

  it("bypasses credentials added during beforeAttempt", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Response.json({ call: calls });
      }),
    });
    const authentication = {
      name: "authentication",
      hooks: {
        beforeAttempt({ draft }: { draft: { headers: Headers } }) {
          draft.headers.set("Authorization", "Bearer secret");
        },
      },
    };

    await Promise.all([
      api.get("/dedupe/late-credentials").dedupe().use(authentication),
      api.get("/dedupe/late-credentials").dedupe().use(authentication),
    ]);

    expect(calls).toBe(2);
  });

  it("rejects unsafe methods without a caller-owned key even when methods opts in", () => {
    const transport = mockTransport(() => Response.json({ unused: true }));
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport,
    });

    expect(() => api.post("/dedupe/unsafe").body("first").dedupe({ methods: ["POST"] }))
      .toThrow(expect.objectContaining({ code: "ERR_HTTP_CONFIGURATION" }));
    expect(transport.calls).toHaveLength(0);
  });

  it("allows an unsafe method with an explicit caller-owned key", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(async (request) => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Response.json({ body: await request.text() });
      }),
    });

    const results = await Promise.all([
      api.post<{ body: string }>("/dedupe/keyed-write").body("same")
        .dedupe({ key: async (request) => `keyed-write:${await request.text()}` }),
      api.post<{ body: string }>("/dedupe/keyed-write").body("same")
        .dedupe({ key: async (request) => `keyed-write:${await request.text()}` }),
    ]);

    expect(results.map((result) => result.data.body)).toEqual(["same", "same"]);
    expect(calls).toBe(1);
  });

  it("keeps the leader entry across retries without waiting on itself", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => {
        calls += 1;
        if (calls === 1) return new Response(null, { status: 503 });
        return Response.json({ ok: true });
      }),
    });

    const result = await api.get<{ ok: boolean }>("/dedupe/retry")
      .dedupe()
      .retry(1, { backoff: { base: 0, max: 0, jitter: "none" } });

    expect(result.data.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("rejects a changed request identity across leader retries", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => {
        calls += 1;
        return calls === 1
          ? new Response(null, { status: 503 })
          : Response.json({ ok: true });
      }),
    });
    const rotatingIdentity = {
      name: "rotating-identity",
      hooks: {
        beforeAttempt({ draft, attempt }: { draft: { headers: Headers }; attempt: number }) {
          draft.headers.set("X-Tenant", String(attempt));
        },
      },
    };

    await expect(api.get("/dedupe/retry-identity")
      .dedupe()
      .use(rotatingIdentity)
      .retry(1, { backoff: { base: 0, max: 0, jitter: "none" } }))
      .rejects.toMatchObject({ code: "ERR_HTTP_CONFIGURATION" });
    expect(calls).toBe(1);
  });

});
