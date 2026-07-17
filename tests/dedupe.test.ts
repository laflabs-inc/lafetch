import { describe, expect, it } from "vitest";
import { dedupe, lafetch } from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

describe("deduplication", () => {
  it("shares concurrent executions across builders", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      features: [dedupe()],
      transport: mockTransport(async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Response.json({ ok: true });
      }),
    });

    const [first, second] = await Promise.all([
      api.get("/dedupe/basic").json<{ ok: boolean }>(),
      api.get("/dedupe/basic").json<{ ok: boolean }>(),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it("lets a follower abort without cancelling the leader", async () => {
    const controller = new AbortController();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      features: [dedupe()],
      transport: mockTransport(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return Response.json({ ok: true });
      }),
    });
    const leader = api.get("/dedupe/abort").json<{ ok: boolean }>();
    const follower = api.get("/dedupe/abort").signal(controller.signal).json();
    setTimeout(() => controller.abort("follower cancelled"), 5);

    await expect(follower).rejects.toMatchObject({ code: "ERR_HTTP_ABORTED" });
    await expect(leader).resolves.toEqual({ ok: true });
  });

  it("falls back when the leader is aborted", async () => {
    const leaderController = new AbortController();
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      features: [dedupe()],
      transport: mockTransport((_request, context) => {
        calls += 1;
        if (calls === 2) return Response.json({ fallback: true });
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
        });
      }),
    });

    const leader = api.get("/dedupe/fallback").signal(leaderController.signal).json();
    const follower = api.get("/dedupe/fallback").json<{ fallback: boolean }>();
    setTimeout(() => leaderController.abort("leader cancelled"), 5);

    await expect(leader).rejects.toMatchObject({ code: "ERR_HTTP_ABORTED" });
    await expect(follower).resolves.toEqual({ fallback: true });
    expect(calls).toBe(2);
  });
});
