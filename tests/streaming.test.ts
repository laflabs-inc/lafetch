import { describe, expect, it, vi } from "vitest";
import {
  HttpAbortError,
  HttpConfigurationError,
  HttpConsumptionError,
  HttpFeatureConflictError,
  lafetch,
} from "../src/index.js";
import type { RequestEvent } from "../src/feature.js";
import { mockTransport } from "../src/testing/index.js";

function byteStream(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
}

describe("Streaming responses", () => {
  it("returns a live Response before the source body completes", async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller;
        controller.enqueue(new Uint8Array([1]));
      },
    });
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(body, {
        headers: { "x-stream": "live" },
      })),
    });

    const response = await api.get("/events").as("stream");
    const reader = response.body!.getReader();

    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("x-stream")).toBe("live");
    expect(await reader.read()).toEqual({ done: false, value: new Uint8Array([1]) });

    source.enqueue(new Uint8Array([2]));
    source.close();
    expect(await reader.read()).toEqual({ done: false, value: new Uint8Array([2]) });
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });

  it("preserves Fetch response metadata and clone behavior", async () => {
    const api = lafetch.create();
    const response = await api.get("data:text/plain,hello").as("stream");
    const clone = response.clone();
    const cloneChunks: string[] = [];

    expect(response.url).toBe("data:text/plain,hello");
    expect(clone.url).toBe(response.url);
    expect(clone.redirected).toBe(response.redirected);
    expect(clone.type).toBe(response.type);
    expect(response).toBeInstanceOf(Response);
    expect(typeof response.body?.pipeThrough).toBe("function");
    expect(response.pipe()).toBe(response.body);
    expect(await response.text()).toBe("hello");
    await clone.pipe("text").forEach((chunk) => {
      cloneChunks.push(chunk);
    });
    expect(cloneChunks.join("")).toBe("hello");
  });

  it("decodes split text chunks and awaits forEach handlers sequentially", async () => {
    const encoded = new TextEncoder().encode("가나다");
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(byteStream(
        [...encoded.slice(0, 1)],
        [...encoded.slice(1, 4)],
        [...encoded.slice(4)],
      ))),
    });
    const response = await api.get("/text").as("stream");
    const chunks: string[] = [];
    let active = false;
    const completed = vi.fn();

    const consumption = response.pipe("text").forEach(async (chunk, index) => {
      expect(active).toBe(false);
      active = true;
      await Promise.resolve();
      chunks[index] = chunk;
      active = false;
    });
    expect(consumption).toBeInstanceOf(Promise);
    await consumption.finally(completed);

    expect(chunks.join("")).toBe("가나다");
    expect(completed).toHaveBeenCalledOnce();
  });

  it("accepts standard transforms and keeps the enhanced consumer", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(byteStream([1, 2], [3]))),
    });
    const response = await api.get("/sizes").as("stream");
    const sizes: number[] = [];
    const transform = new TransformStream<Uint8Array, number>({
      transform(chunk, controller) {
        controller.enqueue(chunk.byteLength);
      },
    });

    await response.pipe(transform).forEach((size) => {
      sizes.push(size);
    });

    expect(sizes).toEqual([2, 1]);
  });

  it("owns one consumption mode per LRequest", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response("payload")),
    });
    const request = api.get("/resource");
    const streaming = request.as("stream");

    await expect(request.as("stream")).rejects.toBeInstanceOf(HttpConsumptionError);
    await expect(request.as("response")).rejects.toBeInstanceOf(HttpConsumptionError);
    await (await streaming).body?.cancel();

    const buffered = api.get("/resource");
    await buffered.as("response");
    await expect(buffered.as("stream")).rejects.toBeInstanceOf(HttpConsumptionError);
  });

  it("rejects Schema, Cache, and Deduplication before Transport execution", async () => {
    const transport = mockTransport(() => new Response("unused"));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    await expect((api.get("/schema").validate((value) => value) as any).as("stream"))
      .rejects.toBeInstanceOf(HttpConfigurationError);
    await expect((api.get("/cache").cache("1m") as any).as("stream"))
      .rejects.toBeInstanceOf(HttpFeatureConflictError);
    await expect((api.get("/dedupe").dedupe() as any).as("stream"))
      .rejects.toBeInstanceOf(HttpFeatureConflictError);
    await expect(api.get("/custom-cache").use({
      name: "custom-cache",
      capabilities: { provides: [{ name: "cache" }] },
    }).as("stream")).rejects.toBeInstanceOf(HttpFeatureConflictError);

    expect(transport.calls).toHaveLength(0);
  });

  it("rejects a response body already consumed by a Feature", async () => {
    const transport = mockTransport(() => new Response("consumed"));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    await expect(api.get("/events").use({
      name: "body-consumer",
      hooks: {
        async afterResponse({ response }) {
          await response.text();
        },
      },
    }).as("stream")).rejects.toBeInstanceOf(HttpConsumptionError);
    expect(transport.calls).toHaveLength(1);
  });

  it("applies an explicit byte limit to actual streamed chunks", async () => {
    const transport = mockTransport(() => new Response(
      byteStream([1, 2], [3, 4, 5]),
      { headers: { "content-length": "1" } },
    ));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });
    const response = await api
      .get("/large")
      .maxResponseBytes(4)
      .retry(2)
      .as("stream");
    const reader = response.body!.getReader();

    expect(await reader.read()).toEqual({ done: false, value: new Uint8Array([1, 2]) });
    await expect(reader.read()).rejects.toMatchObject({
      code: "ERR_HTTP_RESPONSE_TOO_LARGE",
      limitBytes: 4,
      receivedBytes: 5,
    });
    expect(transport.calls).toHaveLength(1);
  });

  it("keeps Streaming unbounded unless maxResponseBytes() is explicit", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(byteStream([1, 2, 3], [4, 5, 6]))),
    });

    await expect(api.get("/unbounded").as("stream").then((response) => response.arrayBuffer()))
      .resolves.toHaveProperty("byteLength", 6);
  });

  it("retries status responses before exposing the accepted body", async () => {
    let attempt = 0;
    const transport = mockTransport(() => {
      attempt += 1;
      return attempt === 1
        ? new Response("retry", { status: 503 })
        : new Response("accepted");
    });
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    const response = await api.get("/events").retry(1, {
      backoff: { base: 0, jitter: "none" },
    }).as("stream");

    expect(await response.text()).toBe("accepted");
    expect(transport.calls).toHaveLength(2);
  });

  it("does not retry after the accepted body is exposed", async () => {
    const events: RequestEvent[] = [];
    const transport = mockTransport(() => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      pull(controller) {
        controller.error(new Error("source failed"));
      },
    })));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });
    const response = await api
      .get("/events")
      .retry(2)
      .telemetry((event) => { events.push(event); })
      .as("stream");
    const reader = response.body!.getReader();

    expect(await reader.read()).toEqual({ done: false, value: new Uint8Array([1]) });
    await expect(reader.read()).rejects.toMatchObject({ code: "ERR_HTTP_TRANSPORT" });
    expect(transport.calls).toHaveLength(1);
    expect(events.filter((event) => event.type === "attempt:error")).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("request:error");
  });

  it("keeps total timeout, attempt timeout, and Abort active until body completion", async () => {
    const pendingBody = () => new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
    });
    const transport = mockTransport(() => new Response(pendingBody()));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    const timeoutResponse = await api
      .get("/timeout")
      .attemptTimeout(10)
      .retry(1)
      .as("stream");
    await expect(timeoutResponse.body!.getReader().read()).rejects.toMatchObject({
      code: "ERR_HTTP_TIMEOUT",
      scope: "attempt",
    });
    expect(transport.calls).toHaveLength(1);

    const totalTimeoutResponse = await api
      .get("/total-timeout")
      .timeout(10)
      .as("stream");
    await expect(totalTimeoutResponse.body!.getReader().read()).rejects.toMatchObject({
      code: "ERR_HTTP_TIMEOUT",
      scope: "total",
    });
    expect(transport.calls).toHaveLength(2);

    const controller = new AbortController();
    const abortedResponse = await api
      .get("/abort")
      .signal(controller.signal)
      .as("stream");
    const read = abortedResponse.body!.getReader().read();
    controller.abort("stop");
    await expect(read).rejects.toBeInstanceOf(HttpAbortError);
  });

  it("maps body failures in the response phase", async () => {
    let phase: string | undefined;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(new ReadableStream({
        start(controller) {
          controller.error(new Error("source failed"));
        },
      }))),
    });
    const response = await api
      .get("/events")
      .mapError((_error, context) => {
        phase = context.phase;
        return new Error("mapped body failure");
      })
      .as("stream");

    await expect(response.text()).rejects.toThrow("mapped body failure");
    expect(phase).toBe("response");
  });

  it("preserves a pre-response Abort error when finalization also fails", async () => {
    const controller = new AbortController();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((_request, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
        }),
      ),
    });
    const streaming = api
      .get("/events")
      .signal(controller.signal)
      .use({
        name: "broken-finalizer",
        hooks: {
          finalize() {
            throw new Error("finalizer failed");
          },
        },
      })
      .as("stream");

    controller.abort("stop");

    await expect(streaming).rejects.toBeInstanceOf(HttpAbortError);
  });

  it("finalizes once after body completion and uses a body-less snapshot", async () => {
    const finalize = vi.fn(({ response }: { response?: Response }) => {
      expect(response?.body).toBeNull();
    });
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response("payload")),
    });
    const response = await api.get("/events").use({
      name: "lifecycle",
      hooks: { finalize },
    }).as("stream");

    expect(finalize).not.toHaveBeenCalled();
    expect(await response.text()).toBe("payload");
    expect(finalize).toHaveBeenCalledOnce();
  });

  it("finalizes body-less responses before returning", async () => {
    const finalize = vi.fn();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 204 })),
    });

    const response = await api.get("/empty").use({
      name: "lifecycle",
      hooks: { finalize },
    }).as("stream");

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(finalize).toHaveBeenCalledOnce();
    const consume = vi.fn();
    await response.pipe().forEach(consume);
    expect(consume).not.toHaveBeenCalled();
  });

  it("settles consumer cancellation without leaking lifecycle state", async () => {
    const finalize = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
    });
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(body)),
    });
    const response = await api.get("/events").use({
      name: "lifecycle",
      hooks: { finalize },
    }).as("stream");

    await expect(response.body!.cancel("finished")).resolves.toBeUndefined();
    expect(finalize).toHaveBeenCalledOnce();
  });

  it("surfaces finalizer failures through the final body read", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response("payload")),
    });
    const response = await api.get("/events").use({
      name: "broken-finalizer",
      hooks: {
        finalize() {
          throw new Error("finalizer failed");
        },
      },
    }).as("stream");

    await expect(response.text()).rejects.toThrow("Feature \"broken-finalizer\" failed in the finalize hook.");
  });

  it("cancels and finalizes when a forEach handler fails", async () => {
    const finalize = vi.fn();
    const handlerError = new Error("handler failed");
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(byteStream([1], [2]))),
    });
    const response = await api.get("/events").use({
      name: "lifecycle",
      hooks: { finalize },
    }).as("stream");

    await expect(response.pipe().forEach(() => {
      throw handlerError;
    })).rejects.toBe(handlerError);
    expect(finalize).toHaveBeenCalledOnce();
  });
});
