import { describe, expect, it } from "vitest";
import { lafetch } from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

describe("public API conventions", () => {
  it("uses one fluent request grammar", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((request) => Response.json({
        page: new URL(request.url).searchParams.get("page"),
        source: request.headers.get("x-source"),
      })),
    });

    const result = await api
      .get("/users")
      .query({ page: 2 })
      .header("X-Source", "test")
      .timeout("1s")
      .retry(1)
      .json<{ page: string; source: string }>();

    expect(result).toEqual({ page: "2", source: "test" });
  });

  it("keeps request policies out of clients and named method arguments", () => {
    const api = lafetch.create();

    if (false) {
      // @ts-expect-error Named HTTP methods accept only a URL; use the fluent builder.
      api.get("/users", { retry: 2 });
      // @ts-expect-error Request policies do not belong in shared client configuration.
      lafetch.create({ timeout: "1s" });
    }

    expect(typeof api.get).toBe("function");
  });
});
