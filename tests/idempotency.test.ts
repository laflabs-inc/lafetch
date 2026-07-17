import { describe, expect, it } from "vitest";
import { lafetch } from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

describe("idempotency", () => {
  it("keeps one key across retries and makes POST retryable by default", async () => {
    const keys: Array<string | null> = [];
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((request, context) => {
        keys.push(request.headers.get("idempotency-key"));
        return context.attempt === 1
          ? new Response("unavailable", { status: 503 })
          : Response.json({ ok: true });
      }),
    });

    await api.post("/jobs").idempotency({ key: "stable" }).retry({
      attempts: 2,
      backoff: { type: "fixed", base: 0, jitter: "none" },
    });

    expect(keys).toEqual(["stable", "stable"]);
  });

  it("preserves an existing key", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((request) => {
        expect(request.headers.get("idempotency-key")).toBe("caller-key");
        return Response.json({ ok: true });
      }),
    });
    await api.post("/jobs").header("Idempotency-Key", "caller-key").idempotency({ key: "generated" });
  });
});
