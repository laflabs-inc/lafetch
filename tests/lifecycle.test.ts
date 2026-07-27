import { describe, expect, it, vi } from "vitest";
import {
  HttpConfigurationError,
  lafetch,
  type LLifecycleEvent,
} from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

const immediateRetry = {
  backoff: {
    type: "fixed",
    base: 0,
    jitter: "none",
  },
} as const;

describe("logical lifecycle", () => {
  it("runs client handlers before request handlers in registration order", async () => {
    const calls: string[] = [];
    const transport = mockTransport((request) => {
      expect(request.headers.get("authorization")).toBe("Bearer client");
      expect(request.headers.get("x-request")).toBe("configured");
      return Response.json({ ok: true });
    });
    const api = lafetch
      .create({ baseUrl: "https://api.example.com", transport })
      .on(async (event) => {
        await Promise.resolve();
        calls.push(`client-1:${event.type}`);
        if (event.type === "request") {
          event.request = event.request.header("Authorization", "Bearer client");
        }
      })
      .on((event) => {
        calls.push(`client-2:${event.type}`);
      });

    const response = await api
      .get<{ ok: boolean }>("/resource")
      .on((event) => {
        calls.push(`request:${event.type}`);
        if (event.type === "request") {
          event.request = event.request.header("X-Request", "configured");
        }
      });

    expect(response.data.ok).toBe(true);
    expect(calls).toEqual([
      "client-1:request",
      "client-2:request",
      "request:request",
      "client-1:response",
      "client-2:response",
      "request:response",
    ]);
  });

  it("emits one logical request and response across retries", async () => {
    let attempts = 0;
    const events: string[] = [];
    const observedHeaders: Array<string | null> = [];
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((request) => {
        attempts += 1;
        observedHeaders.push(request.headers.get("x-logical-request"));
        return attempts === 1
          ? new Response(null, { status: 503 })
          : Response.json({ ok: true });
      }),
    });

    const response = await api
      .get<{ ok: boolean }>("/retry")
      .retry(1, immediateRetry)
      .on((event) => {
        events.push(event.type);
        if (event.type === "request") {
          event.request = event.request.header("X-Logical-Request", "once");
        } else {
          expect(event.response.meta.attempts).toBe(2);
        }
      });

    expect(response.meta.attempts).toBe(2);
    expect(events).toEqual(["request", "response"]);
    expect(observedHeaders).toEqual(["once", "once"]);
  });

  it("emits the response event once for repeated direct consumers", async () => {
    const responseHandler = vi.fn();
    const request = lafetch
      .create({
        transport: mockTransport(() => Response.json({ ok: true })),
      })
      .get<{ ok: boolean }>("https://api.example.com/resource")
      .on((event) => {
        if (event.type === "response") responseHandler(event.response);
      });

    const [first, second] = await Promise.all([request, request]);

    expect(responseHandler).toHaveBeenCalledOnce();
    expect(first).not.toBe(second);
    expect(first.headers).not.toBe(second.headers);
  });

  it("keeps explicit data, response, and stream terminals outside LResponse events", async () => {
    const events: string[] = [];
    const handler = (event: LLifecycleEvent) => {
      events.push(event.type);
    };
    const responses = [
      Response.json({ ok: true }),
      new Response("raw"),
      new Response("stream"),
    ];
    const api = lafetch.create({
      transport: mockTransport(() => responses.shift()!),
    });

    await api.get("https://api.example.com/data").on(handler).as("json");
    await api.get("https://api.example.com/raw").on(handler).as("response");
    const stream = await api.get("https://api.example.com/stream").on(handler).as("stream");
    await stream.text();

    expect(events).toEqual(["request", "request", "request"]);
  });

  it("maps request and response handler failures in the matching phase", async () => {
    const requestPhases: string[] = [];
    const responsePhases: string[] = [];
    const requestTransport = mockTransport(() => Response.json({ unused: true }));

    await expect(lafetch
      .create({ transport: requestTransport })
      .get("https://api.example.com/request-error")
      .mapError((error, context) => {
        requestPhases.push(context.phase);
        return error;
      })
      .on((event) => {
        if (event.type === "request") throw new Error("request lifecycle failed");
      }))
      .rejects.toThrow("request lifecycle failed");

    expect(requestTransport.calls).toHaveLength(0);
    expect(requestPhases).toEqual(["request"]);

    await expect(lafetch
      .create({ transport: mockTransport(() => Response.json({ ok: true })) })
      .get("https://api.example.com/response-error")
      .mapError((error, context) => {
        responsePhases.push(context.phase);
        return error;
      })
      .on((event) => {
        if (event.type === "response") throw new Error("response lifecycle failed");
      }))
      .rejects.toThrow("response lifecycle failed");

    expect(responsePhases).toEqual(["response"]);
  });

  it("prevents draft execution, nested handlers, and cross-request replacement", async () => {
    const transport = mockTransport(() => Response.json({ ok: true }));
    const base = lafetch.create({ transport });

    await expect(base
      .on(async (event) => {
        if (event.type === "request") await event.request;
      })
      .get("https://api.example.com/draft"))
      .rejects.toBeInstanceOf(HttpConfigurationError);

    await expect(base
      .on((event) => {
        if (event.type === "request") {
          event.request = event.request.on(() => undefined);
        }
      })
      .get("https://api.example.com/nested"))
      .rejects.toBeInstanceOf(HttpConfigurationError);

    const other = base.get("https://api.example.com/other");
    await expect(base
      .on((event) => {
        if (event.type === "request") event.request = other;
      })
      .get("https://api.example.com/current"))
      .rejects.toBeInstanceOf(HttpConfigurationError);

    expect(transport.calls).toHaveLength(0);
  });

  it("validates handlers at declaration time and keeps client composition immutable", async () => {
    const events: string[] = [];
    const base = lafetch.create({
      transport: mockTransport(() => Response.json({ ok: true })),
    });
    const observed = base.on((event) => {
      events.push(event.type);
    });

    expect(() => (base as any).on(null)).toThrow(HttpConfigurationError);
    expect(() => (base.get("https://api.example.com/x") as any).on(null))
      .toThrow(HttpConfigurationError);
    expect(() => (base.options("https://api.example.com/x") as any).body("payload"))
      .toThrow(HttpConfigurationError);

    await base.get("https://api.example.com/base");
    expect(events).toEqual([]);

    await observed.get("https://api.example.com/observed");
    expect(events).toEqual(["request", "response"]);
  });

  it("keeps body-capable OPTIONS available through the explicit custom method", async () => {
    const api = lafetch.create({
      transport: mockTransport(async (request) => {
        expect(request.method).toBe("OPTIONS");
        expect(await request.text()).toBe("payload");
        return new Response(null, { status: 204 });
      }),
    });

    await api
      .request("OPTIONS", "https://api.example.com/non-standard-options")
      .body("payload");
  });
});
