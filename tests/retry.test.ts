import { describe, expect, it } from "vitest";
import { HttpNonReplayableBodyError, HttpTransportError, lafetch } from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

function success(): Response {
  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
}

const noDelay = {
  attempts: 3,
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

    const result = await api.get<{ ok: boolean }>("/health").retry(noDelay);

    expect(result.data.ok).toBe(true);
    expect(result.meta.attempts).toBe(3);
    expect(transport.calls).toHaveLength(3);
  });

  it("retries transport errors", async () => {
    let attempt = 0;
    const transport = mockTransport(() => {
      attempt += 1;
      if (attempt < 2) throw new TypeError("socket closed");
      return success();
    });
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    const result = await api.get<{ ok: boolean }>("/health").retry({ ...noDelay, attempts: 2 });

    expect(result.meta.attempts).toBe(2);
  });

  it("does not retry POST unless explicitly allowed", async () => {
    const transport = mockTransport(() => new Response("unavailable", { status: 503 }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    await expect(api.post("/jobs").jsonBody({ task: "x" }).retry(noDelay)).rejects.toMatchObject({ status: 503 });
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
      .retry({ ...noDelay, attempts: 2, methods: ["POST"] });

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
      api.post("/upload").body(stream).retry({ ...noDelay, methods: ["POST"] }),
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

    await expect(api.get("/health").retry({ ...noDelay, attempts: 2 })).rejects.toBeInstanceOf(HttpTransportError);
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
      .timeout({ total: "200ms", attempt: "10ms" })
      .retry({ ...noDelay, attempts: 2 });

    expect(result.data.ok).toBe(true);
    expect(result.meta.attempts).toBe(2);
  });

  it("does not retry a failing bodyFactory as a transport error", async () => {
    const transport = mockTransport(() => success());
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    const request = api
      .get("/resource")
      .bodyFactory(() => {
        throw new Error("cannot create body");
      })
      .retry(noDelay);

    await expect(request).rejects.toMatchObject({ code: "ERR_HTTP_CONFIGURATION" });
    expect(transport.calls).toHaveLength(0);
  });
});
