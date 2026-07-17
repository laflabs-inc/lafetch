import { describe, expect, it } from "vitest";
import {
  HttpFeatureError,
  lafetch,
  telemetry,
  type RequestEvent,
} from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

describe("telemetry", () => {
  it("supports a concise create() default", async () => {
    const eventTypes: string[] = [];
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      telemetry: (event) => { eventTypes.push(event.type); },
      transport: mockTransport(() => new Response(null, { status: 204 })),
    });

    await api.get("/health");

    expect(eventTypes).toEqual([
      "request:start",
      "attempt:start",
      "attempt:response",
      "request:success",
    ]);
  });

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
      .retry({
        attempts: 2,
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

  it("supports client-level telemetry and ignores sink failures by default", async () => {
    const eventTypes: string[] = [];
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 204 })),
      features: [telemetry((event) => {
        eventTypes.push(event.type);
        throw new Error("telemetry backend is unavailable");
      })],
    });

    const result = await api.get("/health");

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

  it("can make telemetry failures explicit", async () => {
    const transport = mockTransport(() => new Response(null, { status: 204 }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    const request = api.get("/health").telemetry({
      failureMode: "throw",
      onEvent() {
        throw new Error("sink failed");
      },
    });

    await expect(request).rejects.toBeInstanceOf(HttpFeatureError);
    expect(transport.calls).toHaveLength(0);
  });
});
