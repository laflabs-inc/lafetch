import { describe, expect, it } from "vitest";
import { lafetch } from "../src/index.js";
import type { RequestEvent } from "../src/feature.js";
import { mockTransport } from "../src/testing/index.js";

describe("telemetry", () => {
  it("emits a deterministic lifecycle with retry decisions and safe snapshots", async () => {
    const events: RequestEvent[] = [];
    const delays: number[] = [];
    let attempt = 0;
    let clock = 0;
    const transport = mockTransport(() => {
      attempt += 1;
      return attempt === 1
        ? new Response("unavailable", { status: 503, statusText: "Unavailable" })
        : Response.json({ ok: true });
    });
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport,
      runtime: {
        requestId: () => "req_telemetry",
        now: () => clock++,
        random: () => 1,
        sleep: async (ms) => { delays.push(ms); },
      },
    });

    await api
      .get("/health?access_token=secret")
      .header("Authorization", "Bearer secret")
      .retry(1, {
        backoff: { type: "fixed", base: 25, jitter: "none" },
      })
      .telemetry((event) => { events.push(event); });

    expect(events.map((event) => event.type)).toEqual([
      "request:start",
      "attempt:start",
      "attempt:response",
      "attempt:error",
      "attempt:start",
      "attempt:response",
      "request:success",
    ]);
    expect(delays).toEqual([25]);

    const started = events[0];
    expect(started?.type).toBe("request:start");
    if (started?.type === "request:start") {
      expect(started.request.headers.authorization).toBe("[REDACTED]");
      expect(started.request.url).toContain("access_token=%5BREDACTED%5D");
      expect(Object.isFrozen(started)).toBe(true);
      expect(Object.isFrozen(started.request)).toBe(true);
    }

    const failedAttempt = events.find((event) => event.type === "attempt:error");
    expect(failedAttempt).toMatchObject({
      attempt: 1,
      willRetry: true,
      retryDelayMs: 25,
      error: {
        name: "HttpStatusError",
        code: "ERR_HTTP_STATUS",
        status: 503,
      },
    });

    const success = events.at(-1);
    expect(success).toMatchObject({
      type: "request:success",
      requestId: "req_telemetry",
      attempts: 2,
      source: "mock",
      response: { status: 200 },
    });
  });

  it("isolates telemetry sink failures from the HTTP request", async () => {
    const eventTypes: string[] = [];
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 204 })),
    });

    const result = await api
      .get("/health")
      .telemetry((event) => {
        eventTypes.push(event.type);
        throw new Error("telemetry backend is unavailable");
      });

    expect(result.status).toBe(204);
    expect(eventTypes).toEqual([
      "request:start",
      "attempt:start",
      "attempt:response",
      "request:success",
    ]);
  });

  it("reports the final normalized error after the last attempt", async () => {
    const events: RequestEvent[] = [];
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 404, statusText: "Not Found" })),
    });

    await expect(
      api.get("/missing").telemetry((event) => { events.push(event); }),
    ).rejects.toMatchObject({ code: "ERR_HTTP_STATUS", status: 404 });

    expect(events.map((event) => event.type)).toEqual([
      "request:start",
      "attempt:start",
      "attempt:response",
      "attempt:error",
      "request:error",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "request:error",
      attempts: 1,
      error: {
        name: "HttpStatusError",
        code: "ERR_HTTP_STATUS",
        status: 404,
      },
    });
  });

  it("reports a custom network retry as the final attempt decision", async () => {
    const events: RequestEvent[] = [];
    let attempt = 0;
    const transport = mockTransport(() => {
      if (++attempt === 1) throw new TypeError("offline");
      return Response.json({ ok: true });
    });
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    await api.get("/health").retry(1, {
      backoff: { type: "fixed", base: 0, jitter: "none" },
      networkErrors: false,
      shouldRetry: () => true,
    }).telemetry((event) => { events.push(event); });

    expect(events.find((event) => event.type === "attempt:error")).toMatchObject({
      attempt: 1,
      willRetry: true,
      retryDelayMs: 0,
      error: { code: "ERR_HTTP_TRANSPORT" },
    });
    expect(transport.calls).toHaveLength(2);
  });

  it("reports a predicate veto as the final attempt decision", async () => {
    const events: RequestEvent[] = [];
    const transport = mockTransport(() => new Response("unavailable", { status: 503 }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    await expect(api.get("/health").retry(1, {
      backoff: { type: "fixed", base: 0, jitter: "none" },
      shouldRetry: () => false,
    }).telemetry((event) => { events.push(event); }))
      .rejects.toMatchObject({ code: "ERR_HTTP_STATUS" });

    expect(events.find((event) => event.type === "attempt:error")).toMatchObject({
      attempt: 1,
      willRetry: false,
      error: { code: "ERR_HTTP_STATUS", status: 503 },
    });
    expect(transport.calls).toHaveLength(1);
  });

  it("reports predicate failures as non-retryable configuration errors", async () => {
    const events: RequestEvent[] = [];
    const transport = mockTransport(() => { throw new TypeError("offline"); });
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    await expect(api.get("/health").retry(1, {
      backoff: { type: "fixed", base: 0, jitter: "none" },
      shouldRetry: () => { throw new Error("predicate failed"); },
    }).telemetry((event) => { events.push(event); }))
      .rejects.toMatchObject({ code: "ERR_HTTP_CONFIGURATION" });

    expect(events.find((event) => event.type === "attempt:error")).toMatchObject({
      attempt: 1,
      willRetry: false,
      error: { code: "ERR_HTTP_CONFIGURATION" },
    });
    expect(transport.calls).toHaveLength(1);
  });

  it("does not let a pending observer block the HTTP result", async () => {
    const pending = new Promise<void>(() => undefined);
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ ok: true })),
    });

    const result = await Promise.race([
      api.get<{ ok: boolean }>("/health").telemetry(() => pending),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("telemetry blocked the request")), 100);
      }),
    ]);

    expect(result.ok).toBe(true);
  });

});
