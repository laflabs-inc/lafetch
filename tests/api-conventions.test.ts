import { describe, expect, expectTypeOf, it } from "vitest";
import * as publicApi from "../src/index.js";
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

  it("exposes one explicit client creation entry point", () => {
    const api = lafetch.create();

    if (false) {
      // @ts-expect-error The package factory does not dispatch requests directly.
      lafetch.get("https://api.example.com/users");
      // @ts-expect-error Named HTTP methods accept only a URL; use the fluent builder.
      api.get("/users", { retry: 2 });
      // @ts-expect-error Request policies do not belong in shared client configuration.
      lafetch.create({ timeout: "1s" });
    }

    type HasDirectFactoryExport = "createClient" extends keyof typeof publicApi ? true : false;
    expectTypeOf<HasDirectFactoryExport>().toEqualTypeOf<false>();
    expect(Object.keys(lafetch)).toEqual(["create"]);
    expect(publicApi).not.toHaveProperty("createClient");
    expect(typeof api.get).toBe("function");
  });
});
