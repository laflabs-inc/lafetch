import { describe, expect, it } from "vitest";
import { HttpStatusError, lafetch, snapshotRequest } from "../src/index.js";
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
});
