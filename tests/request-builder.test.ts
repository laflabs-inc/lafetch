import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  HttpAbortError,
  HttpConsumptionError,
  HttpDecodeError,
  HttpConfigurationError,
  HttpResponseTooLargeError,
  HttpTimeoutError,
  lafetch,
  type LResponse,
} from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

interface User {
  id: string;
  name: string;
}

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

describe("LRequest", () => {
  it("supports clients without shared configuration", async () => {
    const payload = encodeURIComponent(JSON.stringify({ id: "1", name: "Dohyun" }));
    const api = lafetch.create();
    const user = await api.get<User>(`data:application/json,${payload}`);

    expect(user.data.name).toBe("Dohyun");
  });

  it("is lazy and executes the same LRequest only once", async () => {
    const transport = mockTransport(() => json({ id: "1", name: "Dohyun" }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });
    const request = api.get<User>("/users/1");

    expect(transport.calls).toHaveLength(0);

    const [first, second] = await Promise.all([request, request]);

    expect(transport.calls).toHaveLength(1);
    expect(first.data).toEqual({ id: "1", name: "Dohyun" });
    expect(second.data).toEqual(first.data);
    expect(first.headers).not.toBe(second.headers);
    first.headers.set("X-Consumer", "first");
    expect(second.headers.has("X-Consumer")).toBe(false);
    expect(first).not.toHaveProperty("raw");
    expect(second).not.toHaveProperty("raw");
    expectTypeOf(first).toEqualTypeOf<LResponse<User>>();
  });

  it("shares one buffered execution between direct and explicit data consumers", async () => {
    const transport = mockTransport(() => json({ id: "1", name: "Dohyun" }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });
    const request = api.get<User>("/users/1");

    const [response, user, nativeResponse] = await Promise.all([
      request,
      request.as("json"),
      request.as("response"),
    ]);

    expect(transport.calls).toHaveLength(1);
    expect(response.data).toEqual(user);
    expect(await nativeResponse.json()).toEqual(user);
    expect(response).not.toHaveProperty("raw");
    expect(response).not.toHaveProperty("response");
    expectTypeOf(response).toEqualTypeOf<LResponse<User>>();
    expectTypeOf(user).toEqualTypeOf<User>();
    expectTypeOf(nativeResponse).toEqualTypeOf<Response>();
  });

  it("supports then, catch, and finally like a Promise", async () => {
    const finallySpy = vi.fn();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => json({ id: "1", name: "Dohyun" })),
    });

    const name = await api
      .get<User>("/users/1")
      .then((response) => response.data.name)
      .catch(() => "fallback")
      .finally(finallySpy);

    expect(name).toBe("Dohyun");
    expect(finallySpy).toHaveBeenCalledOnce();
  });

  it("returns decoded data with HTTP and execution metadata", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => json({ id: "1", name: "Dohyun" })),
    });

    const user = await api.get<User>("/users/1");

    expect(user.data.name).toBe("Dohyun");
    expect(user).toMatchObject({
      ok: true,
      status: 200,
      statusText: "",
      redirected: false,
      type: "default",
    });
    expect(user.headers).toBeInstanceOf(Headers);
    expect(user.request).toEqual({
      method: "GET",
      url: "https://api.example.com/users/1",
      headers: {},
    });
    expect(user.request).not.toBeInstanceOf(Request);
    expect(user).not.toHaveProperty("raw");
    expect(user).not.toHaveProperty("response");
    expect(user.meta.attempts).toBe(1);
    expect(Object.isFrozen(user)).toBe(true);
    expectTypeOf(user).toEqualTypeOf<LResponse<User>>();
  });

  it("auto-decodes text, bytes, and empty responses", async () => {
    const responses = [
      new Response("hello", { headers: { "content-type": "text/plain" } }),
      new Response(new Uint8Array([1, 2, 3])),
      new Response(null, { status: 204 }),
    ];
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => responses.shift()!),
    });

    expect((await api.get<string>("/hello")).data).toBe("hello");
    expect((await api.get<Uint8Array>("/bytes")).data).toEqual(new Uint8Array([1, 2, 3]));
    expect((await api.get<void>("/empty")).data).toBeUndefined();
  });

  it("distinguishes automatic Content-Type decoding from forced as(\"json\") decoding", async () => {
    const payload = '{"id":"1","name":"Dohyun"}';
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(payload, {
        headers: { "content-type": "text/plain" },
      })),
    });

    const automatic = await api.get<string>("/users/1");
    const user = await api.get<User>("/users/1").as("json");

    expect(automatic.data).toBe(payload);
    expect(user.name).toBe("Dohyun");
    expectTypeOf(user).toEqualTypeOf<User>();
  });

  it("exposes explicit as(mode) terminals as real Promises", async () => {
    const responses = [
      new Response("hello", { headers: { "content-type": "text/plain" } }),
      new Response(new Uint8Array([1, 2, 3])),
      new Response("blob body"),
      new Response("name=Lafetch", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
    ];
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => responses.shift()!),
    });

    const text = api.get("/text").as("text");
    expect(text).toBeInstanceOf(Promise);
    expect(await text).toBe("hello");

    expect([...(await api.get("/bytes").as("bytes"))]).toEqual([1, 2, 3]);
    expect(await (await api.get("/blob").as("blob")).text()).toBe("blob body");
    expect((await api.get("/form").as("formData")).get("name")).toBe("Lafetch");
  });

  it("keeps fixed terminal return types for empty responses", async () => {
    const responses = [
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    ];
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => responses.shift()!),
    });

    expect(await api.get("/empty-text").as("text")).toBe("");
    expect((await api.get("/empty-bytes").as("bytes")).byteLength).toBe(0);
    expect((await api.get("/empty-blob").as("blob")).size).toBe(0);
    expect([...((await api.get("/empty-form").as("formData")).entries())]).toEqual([]);
  });

  it("does not discard a body because of an incorrect Content-Length header", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response("present", {
        headers: { "content-type": "text/plain", "content-length": "0" },
      })),
    });

    await expect(api.get("/incorrect-length").as("text"))
      .resolves.toBe("present");
  });

  it("limits buffered responses using actual received bytes", async () => {
    const transport = mockTransport(() => new Response(new Uint8Array([1, 2, 3, 4, 5]), {
      headers: { "content-length": "1" },
    }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    const error = await api.get("/large")
      .maxResponseBytes(4)
      .as("bytes")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpResponseTooLargeError);
    expect(error).toMatchObject({
      code: "ERR_HTTP_RESPONSE_TOO_LARGE",
      limitBytes: 4,
      receivedBytes: 5,
    });
    await expect(api.get("/exact").maxResponseBytes(5).as("bytes"))
      .resolves.toHaveLength(5);
  });

  it("rejects a custom Transport response that violates the byte-stream contract", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue("not bytes" as unknown as Uint8Array);
        controller.close();
      },
    });
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(body)),
    });

    await expect(api.get("/invalid-stream"))
      .rejects.toMatchObject({ code: "ERR_HTTP_TRANSPORT" });
  });

  it("reports a Feature-consumed buffered body as a consumption error", async () => {
    const transport = mockTransport(() => new Response("consumed"));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    await expect(api.get("/consumed").use({
      name: "body-consumer",
      hooks: {
        async afterResponse({ response }) {
          await response.text();
        },
      },
    })).rejects.toBeInstanceOf(HttpConsumptionError);
    expect(transport.calls).toHaveLength(1);
  });

  it("rejects invalid response limits at declaration time", () => {
    const transport = mockTransport(() => new Response("unused"));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    expect(() => api.get("/invalid-limit").maxResponseBytes(-1)).toThrow(HttpConfigurationError);
    expect(() => api.get("/invalid-limit").maxResponseBytes(1.5)).toThrow(HttpConfigurationError);
    expect(transport.calls).toHaveLength(0);
  });

  it("passes advanced Fetch options through one immutable requestInit escape hatch", async () => {
    const observed: Request[] = [];
    const options: {
      cache: RequestCache;
      keepalive: boolean;
      mode: Exclude<RequestMode, "navigate">;
      redirect: RequestRedirect;
      referrerPolicy: ReferrerPolicy;
    } = {
      cache: "no-store",
      keepalive: true,
      mode: "same-origin",
      redirect: "manual",
      referrerPolicy: "no-referrer",
    };
    const api = lafetch.create({
      transport: mockTransport((request) => {
        observed.push(request);
        return new Response(null, { status: 204 });
      }),
    });
    const request = api.get("https://api.example.com/options").requestInit(options);
    options.redirect = "follow";

    await request;

    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      cache: "no-store",
      keepalive: true,
      mode: "same-origin",
      redirect: "manual",
      referrerPolicy: "no-referrer",
    });
  });

  it("rejects invalid or Lafetch-owned RequestInit fields before Transport", () => {
    const transport = mockTransport(() => new Response(null, { status: 204 }));
    const api = lafetch.create({ transport });
    const invalid = [
      () => (api.get("/x") as any).requestInit(null),
      () => (api.get("/x") as any).requestInit({ method: "POST" }),
      () => (api.get("/x") as any).requestInit({ signal: new AbortController().signal }),
      () => (api.get("/x") as any).requestInit({ mode: "navigate" }),
      () => (api.get("/x") as any).requestInit({ redirect: "sometimes" }),
      () => (api.get("/x") as any).requestInit({ keepalive: "yes" }),
      () => (api.get("/x") as any).requestInit({ cache: "only-if-cached" }),
    ];

    for (const configure of invalid) {
      expect(configure).toThrow(HttpConfigurationError);
    }
    expect(transport.calls).toHaveLength(0);
  });

  it("does not combine native Fetch cache with Lafetch application caching", () => {
    const api = lafetch.create({
      transport: mockTransport(() => new Response(null, { status: 204 })),
    });

    expect(() => api.get("/x").requestInit({ cache: "no-store" }).cache("1m"))
      .toThrow("cannot be combined");
    expect(() => api.get("/x").cache("1m").requestInit({ cache: "no-store" }))
      .toThrow("cannot be combined");
  });

  it("merges repeated requestInit calls after snapshotting each value", async () => {
    let observed: Request | undefined;
    const api = lafetch.create({
      transport: mockTransport((request) => {
        observed = request;
        return new Response(null, { status: 204 });
      }),
    });

    await api.get("https://api.example.com/x")
      .requestInit({ mode: "same-origin" })
      .requestInit({ cache: "only-if-cached" });

    expect(observed).toMatchObject({
      mode: "same-origin",
      cache: "only-if-cached",
    });
  });

  it("normalizes invalid JavaScript configuration failures at declaration time", () => {
    const transport = mockTransport(() => new Response("unused"));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });
    const invalid = [
      () => (api.get("/x") as any).timeout("later"),
      () => (api.get("/x") as any).attemptTimeout(-1),
      () => (api.get("/x") as any).retry(1, { methods: null }),
      () => (api.get("/x") as any).retry(1, { statuses: "500" }),
      () => (api.get("/x") as any).retry(1, { networkErrors: "yes" }),
      () => (api.get("/x") as any).acceptStatus(null),
      () => (api.get("/x") as any).signal(null),
      () => (api.get("/x") as any).query(null),
      () => (api.get("/x") as any).query({ nested: { nope: true } }),
      () => (api.get("/x") as any).validate(null),
      () => (api.get("/x") as any).mapError(null),
      () => (api.get("/x") as any).use(null),
      () => (api.get("/x") as any).cache("1m", null),
      () => (api.get("/x") as any).dedupe(null),
      () => (api.post("/x") as any).idempotency(null),
      () => (api.get("/x") as any).telemetry(() => undefined, null),
      () => (lafetch.create as any)(null),
      () => (lafetch.create as any)({ runtime: { sleep: null } }),
      () => (lafetch.create as any)({ transport: null }),
    ];

    for (const configure of invalid) {
      expect(configure).toThrow(HttpConfigurationError);
    }
    expect(transport.calls).toHaveLength(0);
  });

  it("rejects unknown response modes before dispatch", async () => {
    const transport = mockTransport(() => new Response("unused"));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    await expect((api.get("/invalid-mode") as any).as("xml"))
      .rejects.toBeInstanceOf(HttpConfigurationError);
    await expect((api.get("/removed-result-mode") as any).as("result"))
      .rejects.toBeInstanceOf(HttpConfigurationError);
    expect(transport.calls).toHaveLength(0);
  });

  it("supports custom methods without an option-object request path", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((request) => {
        expect(request.method).toBe("PURGE");
        return new Response(null, { status: 204 });
      }),
    });

    await api.request<void>("PURGE", "/cache/entries");
  });

  it("keeps request bodies available for body-capable custom methods", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(async (request) => {
        expect(request.method).toBe("QUERY");
        expect(await request.json()).toEqual({ filter: "active" });
        return json({ matches: 1 });
      }),
    });

    const result = await api
      .request<{ matches: number }>("QUERY", "/search")
      .json({ filter: "active" });

    expect(result.data.matches).toBe(1);
  });

  it("builds query, headers, and JSON bodies", async () => {
    const transport = mockTransport(async (request) => {
      expect(request.url).toBe("https://api.example.com/users?tag=a&tag=b&active=true&empty=");
      expect(request.headers.get("x-client")).toBe("lafetch");
      expect(request.headers.get("content-type")).toBe("application/json");
      expect(await request.json()).toEqual({ name: "Dohyun" });
      return json({ ok: true });
    });
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    await api
      .post("/users")
      .query({ tag: ["a", "b"], active: true, empty: null, omitted: undefined })
      .header("X-Client", "lafetch")
      .json({ name: "Dohyun" });
  });

  it("keeps chained LRequests immutable", async () => {
    const observed: Array<string | null> = [];
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((request) => {
        observed.push(request.headers.get("x-variant"));
        return json({ ok: true });
      }),
    });
    const base = api.get("/resource");
    const variant = base.header("X-Variant", "yes");

    await base;
    await variant;

    expect(observed).toEqual([null, "yes"]);
  });

  it("snapshots URL, query, and status-list inputs when an LRequest is declared", async () => {
    const observed: string[] = [];
    const transport = mockTransport((request) => {
      observed.push(request.url);
      return new Response(null, { status: 404 });
    });
    const api = lafetch.create({ transport });
    const url = new URL("https://api.example.com/original");
    const tags = ["first"];
    const accepted = [404];
    const request = api
      .get<void>(url)
      .query({ tag: tags })
      .acceptStatus(accepted);

    url.pathname = "/mutated";
    tags.push("second");
    accepted.length = 0;

    await request;
    expect(observed).toEqual(["https://api.example.com/original?tag=first"]);
  });

  it("throws HttpStatusError by default and supports accepted statuses", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => json({ code: "NOT_FOUND" }, { status: 404, statusText: "Not Found" })),
    });

    await expect(api.get("/missing")).rejects.toMatchObject({
      name: "HttpStatusError",
      code: "ERR_HTTP_STATUS",
      status: 404,
    });

    const result = await api
      .get<{ code: string }>("/missing")
      .acceptStatus([404]);
    expect(result.status).toBe(404);
    expect(result.ok).toBe(false);
    expect(result.data.code).toBe("NOT_FOUND");
    expectTypeOf(result).toEqualTypeOf<LResponse<{ code: string }>>();
  });

  it("throws HttpDecodeError for invalid JSON", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response("not json", { headers: { "content-type": "application/json" } })),
    });

    await expect(api.get("/broken")).rejects.toBeInstanceOf(HttpDecodeError);
  });

  it("returns independent clones of the buffered Response", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response("raw body", { status: 200 })),
    });
    const request = api.get("/raw");

    const [first, second] = await Promise.all([request.as("response"), request.as("response")]);

    expect(await first.text()).toBe("raw body");
    expect(await second.text()).toBe("raw body");
    expect(first).not.toHaveProperty("pipe");
  });
});

describe("cancellation", () => {
  it("maps a user AbortSignal to HttpAbortError", async () => {
    const controller = new AbortController();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((_request, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
        }),
      ),
    });
    const request = api.get("/slow").signal(controller.signal);

    const promise = request.then((value) => value);
    controller.abort("user cancelled");

    await expect(promise).rejects.toBeInstanceOf(HttpAbortError);
  });

  it("preserves a buffered Abort error when finalization also fails", async () => {
    const controller = new AbortController();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((_request, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
        }),
      ),
    });
    const request = api
      .get("/slow")
      .signal(controller.signal)
      .use({
        name: "broken-finalizer",
        hooks: {
          finalize() {
            throw new Error("finalizer failed");
          },
        },
      });

    const promise = request.then((value) => value);
    controller.abort("user cancelled");

    await expect(promise).rejects.toBeInstanceOf(HttpAbortError);
  });

  it("distinguishes total timeout from user abort", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((_request, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
        }),
      ),
    });

    const error = await api
      .get("/slow")
      .timeout("10ms")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpTimeoutError);
    expect(error).toMatchObject({ scope: "total", timeoutMs: 10 });
  });

  it("treats a zero timeout as an immediate deadline", async () => {
    const transport = mockTransport(() => new Response(null, { status: 204 }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    await expect(api.get("/resource").timeout(0)).rejects.toMatchObject({
      code: "ERR_HTTP_TIMEOUT",
      scope: "total",
    });
    expect(transport.calls).toHaveLength(0);
  });

  it("applies the total timeout while buffering the response body", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      pull() {},
      cancel() { cancelled = true; },
    });
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(body)),
    });

    await expect(api.get("/stream").timeout("10ms")).rejects.toMatchObject({
      code: "ERR_HTTP_TIMEOUT",
      scope: "total",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled).toBe(true);
  });
});
