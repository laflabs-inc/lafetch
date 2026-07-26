import { describe, expect, it } from "vitest";
import {
  HttpAbortError,
  HttpConfigurationError,
  HttpResponseTooLargeError,
  lafetch,
} from "../../src/index.js";

describe("browser Fetch runtime", () => {
  it("executes a real same-origin request", async () => {
    const result = await lafetch
      .create()
      .get<{ method: string; query: { page: string }; header: string }>("/__lafetch_fixture__/echo")
      .query({ page: 2 })
      .header("X-Lafetch-Test", "browser");

    expect(result.data).toEqual({ method: "GET", query: { page: "2" }, header: "browser" });
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

  it("maps browser AbortSignal cancellation", async () => {
    const controller = new AbortController();
    const request = lafetch.create().get("/__lafetch_fixture__/slow").signal(controller.signal);
    setTimeout(() => controller.abort("browser cancelled"), 10);
    await expect(request).rejects.toBeInstanceOf(HttpAbortError);
  });

  it("keeps explicit as(mode) contracts in browser Fetch", async () => {
    const api = lafetch.create();

    await expect(api.get("/__lafetch_fixture__/text").as("text"))
      .resolves.toHaveProperty("data", "browser text");
    await expect(api.get("/__lafetch_fixture__/text").as("bytes"))
      .resolves.toHaveProperty("data", new TextEncoder().encode("browser text"));
    await expect(api.get("/__lafetch_fixture__/empty").as("text"))
      .resolves.toHaveProperty("data", "");
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
