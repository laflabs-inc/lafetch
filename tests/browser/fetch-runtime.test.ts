import { describe, expect, it } from "vitest";
import {
  HttpAbortError,
  HttpConfigurationError,
  HttpResponseTooLargeError,
  lafetch,
} from "../../src/index.js";

describe("browser Fetch runtime", () => {
  it("runs logical lifecycle handlers with the OPTIONS named method", async () => {
    const events: string[] = [];
    const api = lafetch
      .create()
      .on((event) => {
        events.push(event.type);
        if (event.type === "request") {
          event.request = event.request.header("X-Lafetch-Test", "lifecycle");
        }
      });

    const result = await api.options<{
      method: string;
      header: string;
    }>("/__lafetch_fixture__/options");

    expect(result.data).toMatchObject({
      method: "OPTIONS",
      header: "lifecycle",
    });
    expect(events).toEqual(["request", "response"]);
  });

  it("executes a real same-origin request", async () => {
    const result = await lafetch
      .create()
      .get<{ method: string; query: { page: string }; header: string }>("/__lafetch_fixture__/echo")
      .query({ page: 2 })
      .header("X-Lafetch-Test", "browser");

    expect(result.data).toEqual({ method: "GET", query: { page: "2" }, header: "browser" });
  });

  it("constructs a real browser Request with advanced Fetch options", async () => {
    const result = await lafetch
      .create()
      .get<{ method: string }>("/__lafetch_fixture__/echo")
      .requestInit({
        cache: "no-store",
        mode: "same-origin",
        redirect: "follow",
        referrerPolicy: "no-referrer",
      });

    expect(result.data.method).toBe("GET");
  });

  it("retries an HTTP response through browser fetch", async () => {
    const key = crypto.randomUUID();
    const result = await lafetch
      .create()
      .get<{ attempt: number }>("/__lafetch_fixture__/retry")
      .query({ key })
      .retry(1, { backoff: { type: "fixed", base: 0, jitter: "none" } });

    expect(result.data.attempt).toBe(2);
  });

  it("loads optional Cache and Deduplication policies in the browser", async () => {
    const api = lafetch.create();
    const key = crypto.randomUUID();
    const [first, second] = await Promise.all([
      api.get<{ method: string }>("/__lafetch_fixture__/echo")
        .query({ key })
        .dedupe(),
      api.get<{ method: string }>("/__lafetch_fixture__/echo")
        .query({ key })
        .dedupe(),
    ]);
    const cached = await api.get<{ method: string }>("/__lafetch_fixture__/echo")
      .query({ key: `${key}-cache` })
      .cache("1m");

    expect(first.data.method).toBe("GET");
    expect(second.data.method).toBe("GET");
    expect(cached.data.method).toBe("GET");
  });

  it("applies the explicit CacheStore failure policy in the browser", async () => {
    const store = {
      get() { throw new Error("cache unavailable"); },
      set() {},
      delete() {},
    };
    const api = lafetch.create();

    await expect(api
      .get("/__lafetch_fixture__/echo")
      .cache("1m", { store }))
      .rejects.toMatchObject({
        code: "ERR_HTTP_FEATURE",
        feature: "cache",
        hook: "intercept",
      });

    const result = await api
      .get<{ method: string }>("/__lafetch_fixture__/echo")
      .cache("1m", { store, storeFailure: "bypass" });

    expect(result.data.method).toBe("GET");
  });

  it("maps browser AbortSignal cancellation", async () => {
    const controller = new AbortController();
    const request = lafetch.create().get("/__lafetch_fixture__/slow").signal(controller.signal);
    setTimeout(() => controller.abort("browser cancelled"), 10);
    await expect(request).rejects.toBeInstanceOf(HttpAbortError);
  });

  it("keeps explicit as(mode) contracts in browser Fetch", async () => {
    const api = lafetch.create();

    await expect(api.get("/__lafetch_fixture__/text").as("text"))
      .resolves.toBe("browser text");
    await expect(api.get("/__lafetch_fixture__/text").as("bytes"))
      .resolves.toEqual(new TextEncoder().encode("browser text"));
    await expect(api.get("/__lafetch_fixture__/empty").as("text"))
      .resolves.toBe("");
  });

  it("enforces actual buffered bytes in browser Fetch", async () => {
    await expect(lafetch
      .create()
      .get("/__lafetch_fixture__/large")
      .maxResponseBytes(4))
      .rejects.toBeInstanceOf(HttpResponseTooLargeError);
  });

  it("streams a real browser Fetch response without waiting for completion", async () => {
    const response = await lafetch
      .create()
      .get("/__lafetch_fixture__/stream")
      .as("stream");
    const chunks: string[] = [];

    expect(typeof response.body?.pipeThrough).toBe("function");
    await response.pipe("text").forEach((chunk) => {
      chunks.push(chunk);
    });

    expect(chunks).toEqual(["first", "second"]);
  });

  it("rejects guarded configuration before Fetch", () => {
    const api = lafetch.create();
    expect(() => api.get("/__lafetch_fixture__/echo").maxResponseBytes(-1))
      .toThrow(HttpConfigurationError);
  });
});
