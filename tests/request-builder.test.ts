import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  HttpAbortError,
  HttpDecodeError,
  HttpStatusError,
  HttpTimeoutError,
  lafetch,
  type LafetchResponse,
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
  it("supports clients without shared configuration", async () => {
    const payload = encodeURIComponent(JSON.stringify({ id: "1", name: "Dohyun" }));
    const api = lafetch.create();
    const user = await api.get<User>(`data:application/json,${payload}`);

    expect(user.name).toBe("Dohyun");
  });

  it("is lazy and executes the same builder only once", async () => {
    const transport = mockTransport(() => json({ id: "1", name: "Dohyun" }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });
    const request = api.get<User>("/users/1");

    expect(transport.calls).toHaveLength(0);

    const [first, second] = await Promise.all([request, request]);

    expect(transport.calls).toHaveLength(1);
    expect(first).toEqual({ id: "1", name: "Dohyun" });
    expect(second).toEqual(first);
    expectTypeOf(first).toEqualTypeOf<User>();
  });

  it("supports then, catch, and finally like a Promise", async () => {
    const finallySpy = vi.fn();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => json({ id: "1", name: "Dohyun" })),
    });

    const name = await api
      .get<User>("/users/1")
      .then((user) => user.name)
      .catch(() => "fallback")
      .finally(finallySpy);

    expect(name).toBe("Dohyun");
    expect(finallySpy).toHaveBeenCalledOnce();
  });

  it("returns decoded data directly", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => json({ id: "1", name: "Dohyun" })),
    });

    const user = await api.get<User>("/users/1");

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

    expect(await api.get<string>("/hello")).toBe("hello");
    expect(await api.get<void>("/empty")).toBeUndefined();
  });

  it("uses explicit asJson() terminal consumption", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response('{"id":"1","name":"Dohyun"}', {
        headers: { "content-type": "text/plain" },
      })),
    });

    const user = await api.get("/users/1").asJson<User>();

    expect(user.name).toBe("Dohyun");
    expectTypeOf(user).toEqualTypeOf<User>();
  });

  it("exposes explicit as* terminals as real Promises", async () => {
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

    const text = api.get("/text").asText();
    expect(text).toBeInstanceOf(Promise);
    expect(await text).toBe("hello");

    expect([...new Uint8Array(await api.get("/bytes").asArrayBuffer())]).toEqual([1, 2, 3]);
    expect(await (await api.get("/blob").asBlob()).text()).toBe("blob body");
    expect((await api.get("/form").asFormData()).get("name")).toBe("Lafetch");
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

    expect(result.matches).toBe(1);
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

  it("snapshots URL, query, and status-list inputs when a builder is declared", async () => {
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
      .acceptStatus([404])
      .asResponse();
    expect(result.status).toBe(404);
    expect(result.data.code).toBe("NOT_FOUND");
    expectTypeOf(result).toEqualTypeOf<LafetchResponse<{ code: string }>>();
  });

  it("throws HttpDecodeError for invalid JSON", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response("not json", { headers: { "content-type": "application/json" } })),
    });

    await expect(api.get("/broken")).rejects.toBeInstanceOf(HttpDecodeError);
  });

  it("returns a clone of the raw Response", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response("raw body", { status: 200 })),
    });
    const request = api.get("/raw");

    const [first, second] = await Promise.all([request.asRaw(), request.asRaw()]);

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
