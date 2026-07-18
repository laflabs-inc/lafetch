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
      .get<{ page: string; source: string }>("/users")
      .query({ page: 2 })
      .header("X-Source", "test")
      .timeout("1s")
      .retry(1);

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
      // @ts-expect-error Request Features are composed on a request, not a client.
      lafetch.create({ features: [] });
      // @ts-expect-error JSON configures a request body and therefore requires a value.
      api.post("/users").json();
      // @ts-expect-error response() is the only decoded response-envelope terminal.
      api.get("/users").send();
      // @ts-expect-error A client boundary is created only through lafetch.create().
      api.extend({ baseUrl: "https://other.example.com" });
      // @ts-expect-error Custom methods use request(method, url), without an option object.
      api.request("/cache", { method: "PURGE" });
      // @ts-expect-error Attempt timeouts use the explicit attemptTimeout() method.
      api.get("/users").timeout({ total: "3s", attempt: "1s" });
      // @ts-expect-error Retry always starts with an additional retry count.
      api.get("/users").retry({ attempts: 2 });
      // @ts-expect-error Backoff uses one structured form inside retry options.
      api.get("/users").retry(2, { backoff: "fixed" });
      // @ts-expect-error Cache always starts with an explicit TTL.
      api.get("/users").cache();
      // @ts-expect-error Cache options are the second argument, never an alternate first argument.
      api.get("/users").cache({ ttl: "30s" });
      // @ts-expect-error Telemetry always starts with its event handler.
      api.get("/users").telemetry({ onEvent() {} });
      // @ts-expect-error Response schemas use validate().
      api.get("/users").schema(() => true);
      // @ts-expect-error One mapError() handles request and response failures.
      api.get("/users").mapDecodeError((error: Error) => error);
    }

    type HasDirectFactoryExport = "createClient" extends keyof typeof publicApi ? true : false;
    expectTypeOf<HasDirectFactoryExport>().toEqualTypeOf<false>();
    expect(Object.keys(lafetch)).toEqual(["create"]);
    expect(publicApi).not.toHaveProperty("createClient");
    expect(publicApi).not.toHaveProperty("telemetry");
    expect(typeof api.get).toBe("function");
    expect(api).not.toHaveProperty("extend");
  });
});
