import { describe, expect, it } from "vitest";
import { HttpStatusError, lafetch } from "../src/index.js";
import { snapshotRequest } from "../src/core/request-snapshot.js";
import { mockTransport } from "../src/testing/index.js";

describe("safe diagnostics", () => {
  it("redacts sensitive headers and query parameters in error snapshots", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response("forbidden", { status: 403 })),
    });

    const error = await api
      .get("/private")
      .query({ access_token: "secret" })
      .header("Authorization", "Bearer secret")
      .header("X-API-Key", "secret")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).request?.headers.authorization).toBe("[REDACTED]");
    expect((error as HttpStatusError).request?.headers["x-api-key"]).toBe("[REDACTED]");
    expect((error as HttpStatusError).request?.url).toContain("access_token=%5BREDACTED%5D");
    expect(JSON.stringify(error)).not.toContain("Bearer secret");
  });

  it("removes URL credentials without over-redacting ordinary key names", async () => {
    const request = snapshotRequest({
      method: "GET",
      url: "https://user:password@api.example.com/private?monkey=visible&api_key=secret",
      headers: {},
    });
    expect(request.url).not.toContain("user");
    expect(request.url).not.toContain("password");
    expect(request.url).toContain("monkey=visible");
    expect(request.url).toContain("api_key=%5BREDACTED%5D");
  });

  it("redacts prefixed secret names while preserving unrelated names", async () => {
    const api = lafetch.create({
      transport: mockTransport(() => new Response(null, { status: 500 })),
    });

    const error = await api
      .get("https://api.example.com/failure")
      .headers({ "X-Auth-Token": "header-secret", "X-Tokenizer": "public" })
      .query({ user_token: "query-secret", tokenizer: "public" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpStatusError);
    const request = (error as HttpStatusError).request;
    expect(request?.headers["x-auth-token"]).toBe("[REDACTED]");
    expect(request?.headers["x-tokenizer"]).toBe("public");
    expect(request?.url).toContain("user_token=%5BREDACTED%5D");
    expect(request?.url).toContain("tokenizer=public");
  });

  it("returns an immutable redacted snapshot without retaining the upload Body", async () => {
    const api = lafetch.create({
      transport: mockTransport(() => Response.json({ ok: true })),
    });

    const response = await api
      .post<{ ok: boolean }>("https://api.example.com/private?access_token=secret")
      .header("Authorization", "Bearer secret")
      .body("large upload");

    expect(response.request).not.toBeInstanceOf(Request);
    expect(response.request).toEqual({
      method: "POST",
      url: "https://api.example.com/private?access_token=%5BREDACTED%5D",
      headers: {
        authorization: "[REDACTED]",
        "content-type": "text/plain;charset=UTF-8",
      },
    });
    expect(Object.isFrozen(response.request)).toBe(true);
    expect(Object.isFrozen(response.request.headers)).toBe(true);
    expect(response.request).not.toHaveProperty("body");
    expect(response.request).not.toHaveProperty("clone");
    expect(JSON.stringify(response.request)).not.toContain("large upload");
    expect(JSON.stringify(response.request)).not.toContain("Bearer secret");
  });

  it("stores unusual Header names without mutating the snapshot prototype", () => {
    const request = snapshotRequest({
      method: "GET",
      url: "https://api.example.com",
      headers: { constructor: "visible" },
    });

    expect(request.headers.constructor).toBe("visible");
    expect(Object.getPrototypeOf(request.headers)).toBeNull();
  });
});
