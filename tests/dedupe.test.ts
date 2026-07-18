import { describe, expect, it } from "vitest";
import { lafetch } from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

describe("deduplication", () => {
  it("shares concurrent executions across builders", async () => {
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
      api.get("/dedupe/basic").dedupe().json<{ ok: boolean }>(),
      api.get("/dedupe/basic").dedupe().json<{ ok: boolean }>(),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
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
    const leader = api.get("/dedupe/abort").dedupe().json<{ ok: boolean }>();
    const follower = api.get("/dedupe/abort").signal(controller.signal).dedupe().json();
    setTimeout(() => controller.abort("follower cancelled"), 5);

    await expect(follower).rejects.toMatchObject({ code: "ERR_HTTP_ABORTED" });
    await expect(leader).resolves.toEqual({ ok: true });
  });

  it("falls back when the leader is aborted", async () => {
    const leaderController = new AbortController();
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((_request, context) => {
        calls += 1;
        if (calls === 2) return Response.json({ fallback: true });
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
        });
      }),
    });

    const leader = api.get("/dedupe/fallback").signal(leaderController.signal).dedupe().json();
    const follower = api.get("/dedupe/fallback").dedupe().json<{ fallback: boolean }>();
    setTimeout(() => leaderController.abort("leader cancelled"), 5);

    await expect(leader).rejects.toMatchObject({ code: "ERR_HTTP_ABORTED" });
    await expect(follower).resolves.toEqual({ fallback: true });
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
      firstApi.get("/dedupe/isolated").dedupe().json<{ tenant: string }>(),
      secondApi.get("/dedupe/isolated").dedupe().json<{ tenant: string }>(),
    ]);

    expect(first.tenant).toBe("first");
    expect(second.tenant).toBe("second");
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
      api.get("/dedupe/tenant").header("X-Tenant", "first").dedupe().json<{ tenant: string }>(),
      api.get("/dedupe/tenant").header("X-Tenant", "second").dedupe().json<{ tenant: string }>(),
    ]);

    expect(first.tenant).toBe("first");
    expect(second.tenant).toBe("second");
    expect(calls).toBe(2);
  });

});
