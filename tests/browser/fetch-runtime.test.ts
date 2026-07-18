import { describe, expect, it } from "vitest";
import { HttpAbortError, lafetch } from "../../src/index.js";

describe("browser Fetch runtime", () => {
  it("executes a real same-origin request", async () => {
    const result = await lafetch
      .create()
      .get<{ method: string; query: { page: string }; header: string }>("/__lafetch_fixture__/echo")
      .query({ page: 2 })
      .header("X-Lafetch-Test", "browser");

    expect(result).toEqual({ method: "GET", query: { page: "2" }, header: "browser" });
  });

  it("retries an HTTP response through browser fetch", async () => {
    const key = crypto.randomUUID();
    const result = await lafetch
      .create()
      .get<{ attempt: number }>("/__lafetch_fixture__/retry")
      .query({ key })
      .retry(1, { backoff: { type: "fixed", base: 0, jitter: "none" } });

    expect(result.attempt).toBe(2);
  });

  it("maps browser AbortSignal cancellation", async () => {
    const controller = new AbortController();
    const request = lafetch.create().get("/__lafetch_fixture__/slow").signal(controller.signal);
    setTimeout(() => controller.abort("browser cancelled"), 10);
    await expect(request).rejects.toBeInstanceOf(HttpAbortError);
  });
});
