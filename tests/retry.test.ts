import { describe, expect, it } from "vitest";
import { HttpNonReplayableBodyError, HttpTransportError, lafetch } from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

function success(): Response {
  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
}

const noDelay = {
  backoff: { type: "fixed" as const, base: 0, jitter: "none" as const },
};

describe("retry", () => {
  it("retries configured status codes", async () => {
    let attempt = 0;
    const transport = mockTransport(() => {
      attempt += 1;
      return attempt < 3 ? new Response("unavailable", { status: 503 }) : success();
    });
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    const result = await api.get<{ ok: boolean }>("/health").retry(2, noDelay);

    expect(result.data.ok).toBe(true);
    expect(result.meta.attempts).toBe(3);
    expect(transport.calls).toHaveLength(3);
  });

  it("snapshots retry options when the policy is declared", async () => {
    let attempt = 0;
    const statuses = [503];
    const options = {
      statuses,
      backoff: { type: "fixed" as const, base: 0, jitter: "none" as const },
    };
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => ++attempt === 1 ? new Response(null, { status: 503 }) : success()),
    });
    const request = api.get<{ ok: boolean }>("/health").retry(1, options);

    statuses.length = 0;
    options.backoff.base = 10_000;

    await expect(request).resolves.toHaveProperty("data.ok", true);
    expect(attempt).toBe(2);
  });

  it("keeps Retry-After independent from the exponential backoff ceiling", async () => {
    const delays: number[] = [];
    let attempt = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => {
        attempt += 1;
        return attempt === 1
          ? new Response("unavailable", { status: 503, headers: { "Retry-After": "2" } })
          : success();
      }),
      runtime: {
        now: () => 0,
        random: () => 1,
        sleep: async (ms) => { delays.push(ms); },
      },
    });

    const result = await api.get<{ ok: boolean }>("/health").retry(1, {
      maxRetryAfter: "3s",
      backoff: { type: "fixed", base: 10, max: 10, jitter: "none" },
    });

    expect(result.data.ok).toBe(true);
    expect(delays).toEqual([2_000]);
  });

  it("does not retry earlier than a Retry-After value above the configured ceiling", async () => {
    const delays: number[] = [];
    const transport = mockTransport(() =>
      new Response("unavailable", { status: 503, headers: { "Retry-After": "2" } }));
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport,
      runtime: {
        now: () => 0,
        random: () => 1,
        sleep: async (ms) => { delays.push(ms); },
      },
    });

    await expect(api.get("/health").retry(2, {
      maxRetryAfter: "1s",
      backoff: { type: "fixed", base: 10, jitter: "none" },
    })).rejects.toMatchObject({ code: "ERR_HTTP_STATUS", status: 503 });

    expect(transport.calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it("uses HTTP-date Retry-After values relative to the runtime clock", async () => {
    const delays: number[] = [];
    let attempt = 0;
    const now = Date.parse("2026-07-26T10:00:00.000Z");
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => {
        attempt += 1;
        return attempt === 1
          ? new Response("unavailable", {
            status: 503,
            headers: { "Retry-After": "Sun, 26 Jul 2026 10:00:03 GMT" },
          })
          : success();
      }),
      runtime: {
        now: () => now,
        random: () => 1,
        sleep: async (ms) => { delays.push(ms); },
      },
    });

    await api.get("/health").retry(1, { maxRetryAfter: "5s" });

    expect(delays).toEqual([3_000]);
  });

  it("falls back to backoff for malformed Retry-After values", async () => {
    const delays: number[] = [];
    let attempt = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => {
        attempt += 1;
        return attempt === 1
          ? new Response("unavailable", { status: 503, headers: { "Retry-After": "-1" } })
          : success();
      }),
      runtime: {
        now: () => 0,
        random: () => 1,
        sleep: async (ms) => { delays.push(ms); },
      },
    });

    await api.get("/health").retry(1, {
      maxRetryAfter: 0,
      backoff: { type: "fixed", base: 25, jitter: "none" },
    });

    expect(delays).toEqual([25]);
  });

  it("can ignore Retry-After without changing the backoff policy", async () => {
    const delays: number[] = [];
    let attempt = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => {
        attempt += 1;
        return attempt === 1
          ? new Response("unavailable", { status: 503, headers: { "Retry-After": "2" } })
          : success();
      }),
      runtime: {
        now: () => 0,
        random: () => 1,
        sleep: async (ms) => { delays.push(ms); },
      },
    });

    await api.get("/health").retry(1, {
      respectRetryAfter: false,
      maxRetryAfter: 0,
      backoff: { type: "fixed", base: 25, jitter: "none" },
    });

    expect(delays).toEqual([25]);
  });

  it("lets the total timeout cancel a server-directed retry delay", async () => {
    const transport = mockTransport(() =>
      new Response("unavailable", { status: 503, headers: { "Retry-After": "2" } }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    await expect(api.get("/health").timeout("10ms").retry(1, { maxRetryAfter: "3s" }))
      .rejects.toMatchObject({ code: "ERR_HTTP_TIMEOUT", scope: "total" });
    expect(transport.calls).toHaveLength(1);
  });

  it("retries transport errors", async () => {
    let attempt = 0;
    const transport = mockTransport(() => {
      attempt += 1;
      if (attempt < 2) throw new TypeError("socket closed");
      return success();
    });
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    const result = await api.get<{ ok: boolean }>("/health").retry(1, noDelay);

    expect(result.meta.attempts).toBe(2);
  });

  it("does not retry POST unless explicitly allowed", async () => {
    const transport = mockTransport(() => new Response("unavailable", { status: 503 }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    await expect(api.post("/jobs").json({ task: "x" }).retry(2, noDelay)).rejects.toMatchObject({ status: 503 });
    expect(transport.calls).toHaveLength(1);
  });

  it("recreates bodies through bodyFactory for explicitly retryable writes", async () => {
    const bodies: string[] = [];
    const transport = mockTransport(async (request, context) => {
      bodies.push(await request.text());
      return context.attempt === 1 ? new Response("unavailable", { status: 503 }) : success();
    });
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    await api
      .post("/jobs")
      .bodyFactory(() => `attempt-body`)
      .retry(1, { ...noDelay, methods: ["POST"] });

    expect(bodies).toEqual(["attempt-body", "attempt-body"]);
  });

  it("rejects a non-replayable stream body before dispatch", async () => {
    const transport = mockTransport(() => success());
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("payload"));
        controller.close();
      },
    });

    await expect(
      api.post("/upload").body(stream).retry(2, { ...noDelay, methods: ["POST"] }),
    ).rejects.toBeInstanceOf(HttpNonReplayableBodyError);
    expect(transport.calls).toHaveLength(0);
  });

  it("exposes the final transport error", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => {
        throw new Error("offline");
      }),
    });

    await expect(api.get("/health").retry(1, noDelay)).rejects.toBeInstanceOf(HttpTransportError);
  });

  it("can retry an attempt timeout without retrying a total timeout", async () => {
    let calls = 0;
    const transport = mockTransport((_request, context) => {
      calls += 1;
      if (calls === 2) return success();
      return new Promise((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
      });
    });
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    const result = await api
      .get<{ ok: boolean }>("/health")
      .timeout("200ms")
      .attemptTimeout("10ms")
      .retry(1, noDelay);

    expect(result.data.ok).toBe(true);
    expect(result.meta.attempts).toBe(2);
  });

  it("keeps the attempt timeout active while consuming the response body", async () => {
    let calls = 0;
    const transport = mockTransport(() => {
      calls += 1;
      if (calls === 2) return success();
      return new Response(new ReadableStream({ pull() {} }));
    });
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    const result = await api
      .get<{ ok: boolean }>("/health")
      .timeout("200ms")
      .attemptTimeout("10ms")
      .retry(1, noDelay);

    expect(result.data.ok).toBe(true);
    expect(result.meta.attempts).toBe(2);
    expect(transport.calls).toHaveLength(2);
  });

  it("does not retry a failing bodyFactory as a transport error", async () => {
    const transport = mockTransport(() => success());
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    const request = api
      .post("/resource")
      .bodyFactory(() => {
        throw new Error("cannot create body");
      })
      .retry(2, noDelay);

    await expect(request).rejects.toMatchObject({ code: "ERR_HTTP_CONFIGURATION" });
    expect(transport.calls).toHaveLength(0);
  });

  it("applies timeout cancellation while awaiting an async bodyFactory", async () => {
    const transport = mockTransport(() => success());
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });
    const never = new Promise<BodyInit | null>(() => undefined);

    await expect(api
      .post("/resource")
      .bodyFactory(() => never)
      .timeout("10ms"))
      .rejects.toMatchObject({ code: "ERR_HTTP_TIMEOUT", scope: "total" });
    expect(transport.calls).toHaveLength(0);
  });

  it("enforces an attempt timeout when a custom Transport ignores its signal", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Promise<Response>(() => undefined)),
    });

    await expect(api.get("/resource").attemptTimeout("10ms"))
      .rejects.toMatchObject({ code: "ERR_HTTP_TIMEOUT", scope: "attempt" });
  });

  it("does not let platform timer overflow turn a long timeout into an immediate timeout", async () => {
    const controller = new AbortController();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((_request, context) => new Promise((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
      })),
    });
    const request = api.get("/long-timeout").signal(controller.signal).timeout(3_000_000_000);
    setTimeout(() => controller.abort("caller cancelled"), 10);

    await expect(request).rejects.toMatchObject({ code: "ERR_HTTP_ABORTED" });
  });
});
