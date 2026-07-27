import { describe, expect, expectTypeOf, it } from "vitest";
import * as publicApi from "../src/index.js";
import {
  lafetch,
  type LLifecycleEvent,
  type LRequest,
  type LResponse,
  type LStreamResponse,
  type ResponseMode,
} from "../src/index.js";
import { defineFeature } from "../src/feature.js";
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

    expect(result.data).toEqual({ page: "2", source: "test" });
  });

  it("exposes one explicit client creation entry point", () => {
    const api = lafetch.create();

    if (false) {
      // @ts-expect-error The package factory does not dispatch requests directly.
      lafetch.get("https://api.example.com/users");
      // @ts-expect-error Named HTTP methods accept only a URL; use the fluent request.
      api.get("/users", { retry: 2 });
      // @ts-expect-error Request policies do not belong in shared client configuration.
      lafetch.create({ timeout: "1s" });
      // @ts-expect-error Request Features are composed on a request, not a client.
      lafetch.create({ features: [] });
      // @ts-expect-error JSON configures a request body and therefore requires a value.
      api.post("/users").json();
      // @ts-expect-error Fetch does not allow request bodies on GET.
      api.get("/users").json({ filter: "active" });
      // @ts-expect-error Fetch does not allow request bodies on HEAD.
      api.head("/users").body("payload");
      // @ts-expect-error The custom-method entry point preserves the GET body restriction.
      api.request("GET", "/users").bodyFactory(() => "payload");
      // @ts-expect-error Explicit terminals use as(mode).
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
      // @ts-expect-error Response modes are a closed public contract.
      api.get("/users").as("xml");
      // @ts-expect-error The old response() terminal is not part of the unified grammar.
      api.get("/users").response();
      // @ts-expect-error The old raw() terminal is not part of the unified grammar.
      api.get("/users").raw();
      // @ts-expect-error Request credentials use the Fetch standard values.
      api.get("/users").credentials("cross-origin");
      // @ts-expect-error Client credentials use the Fetch standard values.
      lafetch.create({ credentials: "cross-origin" });
      // @ts-expect-error Request method is owned by the LClient entry point.
      api.get("/users").requestInit({ method: "POST" });
      // @ts-expect-error Request Body is owned by json(), body(), or bodyFactory().
      api.post("/users").requestInit({ body: "payload" });
      // @ts-expect-error Request Header is owned by header() and headers().
      api.get("/users").requestInit({ headers: { "X-Test": "value" } });
      // @ts-expect-error Request Signal is owned by signal().
      api.get("/users").requestInit({ signal: AbortSignal.timeout(1_000) });
      // @ts-expect-error Request credentials are owned by credentials().
      api.get("/users").requestInit({ credentials: "include" });
      // @ts-expect-error Browser-created navigate mode is not constructible by Lafetch.
      api.get("/users").requestInit({ mode: "navigate" });
      // @ts-expect-error Backoff types are a closed public contract.
      api.get("/users").retry(2, { backoff: { type: "linear" } });
      // @ts-expect-error Jitter types are a closed public contract.
      api.get("/users").retry(2, { backoff: { jitter: "equal" } });
      // @ts-expect-error Capability modes are a closed advanced API contract.
      defineFeature({ name: "invalid", capabilities: { provides: [{ name: "x", mode: "shared" }] } });
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
      // @ts-expect-error OPTIONS is bodyless through the named method.
      api.options("/capabilities").body("payload");
      api.request("OPTIONS", "/capabilities").body("payload");

      expectTypeOf(api.get("/users").as("text")).toEqualTypeOf<Promise<string>>();
      expectTypeOf(api.get<{ id: string }>("/users").as("json"))
        .toEqualTypeOf<Promise<{ id: string }>>();
      expectTypeOf(api.post<{ id: string }>("/users").as("json"))
        .toEqualTypeOf<Promise<{ id: string }>>();
      expectTypeOf(api.put<{ id: string }>("/users/1").as("json"))
        .toEqualTypeOf<Promise<{ id: string }>>();
      expectTypeOf(api.patch<{ id: string }>("/users/1").as("json"))
        .toEqualTypeOf<Promise<{ id: string }>>();
      expectTypeOf(api.delete<{ id: string }>("/users/1").as("json"))
        .toEqualTypeOf<Promise<{ id: string }>>();
      expectTypeOf(api.head<void>("/users").as("json"))
        .toEqualTypeOf<Promise<void>>();
      expectTypeOf(api.request<{ id: string }>("QUERY", "/users").as("json"))
        .toEqualTypeOf<Promise<{ id: string }>>();
      expectTypeOf(api.get("/users/1").validate({
        parse(value: unknown): { id: string } {
          return value as { id: string };
        },
      }).as("json")).toEqualTypeOf<Promise<{ id: string }>>();
      expectTypeOf(api.get("/users/1").validate({
        parse(value: unknown): { id: string } {
          return value as { id: string };
        },
      }).as("text")).toEqualTypeOf<Promise<{ id: string }>>();
      // @ts-expect-error A request has exactly one response Schema.
      api.get("/users").validate((value) => value).validate((value) => value);
      // @ts-expect-error Response data types are declared once on the HTTP method.
      api.get("/users").as<{ id: string }>("json");
      expectTypeOf(api.get("/binary").as("bytes"))
        .toEqualTypeOf<Promise<Uint8Array>>();
      expectTypeOf(api.get("/file").as("blob"))
        .toEqualTypeOf<Promise<Blob>>();
      expectTypeOf(api.get("/form").as("formData"))
        .toEqualTypeOf<Promise<FormData>>();
      // @ts-expect-error The unpublished result mode was removed.
      api.get<{ id: string }>("/users/1").as("result");
      expectTypeOf(api.get("/users").as("response")).toEqualTypeOf<Promise<Response>>();
      expectTypeOf(api.get("/events").as("stream"))
        .toEqualTypeOf<Promise<LStreamResponse>>();
      const responseMode: "json" | "text" = Math.random() > 0.5 ? "json" : "text";
      expectTypeOf(api.get<{ id: string }>("/users").as(responseMode))
        .toEqualTypeOf<Promise<string | { id: string }>>();
      const anyMode = responseMode as ResponseMode;
      api.get<{ id: string }>("/users").as(anyMode);
      // @ts-expect-error Legacy named terminals are intentionally not kept as aliases.
      api.get("/users").asJson();
      // @ts-expect-error Legacy named terminals are intentionally not kept as aliases.
      api.get("/events").asStream();
      expectTypeOf(api.get("/users").maxResponseBytes(1_000_000)).toEqualTypeOf(api.get("/users"));
      expectTypeOf(api.options("/capabilities")).toEqualTypeOf(api.get("/capabilities"));
      expectTypeOf(api.get("/users").on(() => undefined)).toEqualTypeOf(api.get("/users"));
      api.on((event) => {
        expectTypeOf(event).toEqualTypeOf<LLifecycleEvent>();
        if (event.type === "request") {
          expectTypeOf(event.request).toEqualTypeOf<LRequest>();
          event.request = event.request.header("X-Lifecycle", "request");
        } else {
          expectTypeOf(event.response).toEqualTypeOf<LResponse>();
        }
      });
      // @ts-expect-error Explicit response terminals return Promise and end LRequest configuration.
      api.get("/users").as("json").timeout("1s");
      // @ts-expect-error Response Schema validation requires buffered consumption.
      api.get("/events").validate((value) => value).as("stream");
      // @ts-expect-error Cache requires buffered consumption.
      api.get("/events").cache("1m").as("stream");
      // @ts-expect-error Deduplication requires buffered consumption.
      api.get("/events").dedupe().as("stream");

      api.delete("/users/1").json({ reason: "duplicate" });
      // @ts-expect-error A request has exactly one body source.
      api.post("/users").json({ name: "Dohyun" }).body("replacement");
      // @ts-expect-error A request has exactly one body source.
      api.post("/users").body("payload").bodyFactory(() => "replacement");
      api.request("QUERY", "/search").json({ filter: "active" });
    }

    type HasDirectFactoryExport = "createClient" extends keyof typeof publicApi ? true : false;
    expectTypeOf<HasDirectFactoryExport>().toEqualTypeOf<false>();
    expect(Object.keys(lafetch)).toEqual(["create"]);
    expect(publicApi).not.toHaveProperty("createClient");
    expect(publicApi).not.toHaveProperty("telemetry");
    expect(typeof api.get).toBe("function");
    expect(api).not.toHaveProperty("extend");

    const generalGet: LRequest<unknown> = api.get("/users");
    const generalPost: LRequest<unknown> = api.post("/users");
    expectTypeOf(generalGet).toEqualTypeOf<LRequest<unknown>>();
    expectTypeOf(generalPost).toEqualTypeOf<LRequest<unknown>>();
  });
});
