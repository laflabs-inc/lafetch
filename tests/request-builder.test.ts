import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  HttpAbortError,
  HttpDecodeError,
  HttpStatusError,
  HttpTimeoutError,
  lafetch,
  type HttpResult,
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

describe("RequestBuilder", () => {
  it("is lazy and executes the same builder only once", async () => {
    const transport = mockTransport(() => json({ id: "1", name: "Dohyun" }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });
    const request = api.get<User>("/users/1");

    expect(transport.calls).toHaveLength(0);

    const [first, second] = await Promise.all([request, request]);

    expect(transport.calls).toHaveLength(1);
    expect(first.data).toEqual({ id: "1", name: "Dohyun" });
    expect(second.data).toEqual(first.data);
    expectTypeOf(first).toEqualTypeOf<HttpResult<User>>();
  });

  it("supports then, catch, and finally like a Promise", async () => {
    const finallySpy = vi.fn();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => json({ id: "1", name: "Dohyun" })),
    });

    const name = await api
      .get<User>("/users/1")
      .then(({ data }) => data.name)
      .catch(() => "fallback")
      .finally(finallySpy);

    expect(name).toBe("Dohyun");
    expect(finallySpy).toHaveBeenCalledOnce();
  });

  it("provides data-only terminal decoders", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => json({ id: "1", name: "Dohyun" })),
    });

    const user = await api.get("/users/1").json<User>();

    expect(user.name).toBe("Dohyun");
    expectTypeOf(user).toEqualTypeOf<User>();
  });

  it("auto-decodes text and empty responses", async () => {
    const responses = [
      new Response("hello", { headers: { "content-type": "text/plain" } }),
      new Response(null, { status: 204 }),
    ];
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => responses.shift()!),
    });

    expect((await api.get<string>("/hello")).data).toBe("hello");
    expect((await api.get<void>("/empty")).data).toBeUndefined();
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
      .jsonBody({ name: "Dohyun" })
      .json();
  });

  it("keeps chained builders immutable", async () => {
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

    const result = await api.get<{ code: string }>("/missing").acceptStatus([404]);
    expect(result.status).toBe(404);
    expect(result.data.code).toBe("NOT_FOUND");
  });

  it("throws HttpDecodeError for invalid JSON", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response("not json", { headers: { "content-type": "application/json" } })),
    });

    await expect(api.get("/broken").json()).rejects.toBeInstanceOf(HttpDecodeError);
  });

  it("returns a clone of the raw Response", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response("raw body", { status: 200 })),
    });
    const request = api.get("/raw");

    const [first, second] = await Promise.all([request.raw(), request.raw()]);

    expect(await first.text()).toBe("raw body");
    expect(await second.text()).toBe("raw body");
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

    const promise = request.send();
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
