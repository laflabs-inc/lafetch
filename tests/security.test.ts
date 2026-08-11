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

  it.each([
    "sig",
    "signature",
    "jwt",
    "X-Amz-Signature",
  ])("redacts signed credential query aliases: %s", (name) => {
    const request = snapshotRequest({
      method: "GET",
      url: `https://api.example.com/private?${name}=signed-secret#access_token=fragment-secret`,
      headers: {},
    });

    expect(request.url).toContain(`${encodeURIComponent(name)}=%5BREDACTED%5D`);
    expect(request.url).not.toContain("signed-secret");
    expect(request.url).not.toContain("fragment-secret");
    expect(request.url).not.toContain("#");
  });

  it("keeps signed URL credentials out of CacheStore keys", async () => {
    const keys: string[] = [];
    let writes = 0;
    const store = {
      get(key: string) {
        keys.push(key);
        return undefined;
      },
      set(key: string) {
        keys.push(key);
        writes += 1;
      },
      delete() {},
    };
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    await api.get("/signed?X-Amz-Signature=signed-secret").cache("1m", { store });
    await api.get("/signed?X-Amz-Signature=signed-secret").cache("1m", { store });

    expect(keys.join("\n")).not.toContain("signed-secret");
    expect(writes).toBe(0);
    expect(calls).toBe(2);
  });

  it("keeps signed referrer credentials out of CacheStore keys", async () => {
    const keys: string[] = [];
    const store = {
      get(key: string) { keys.push(key); return undefined; },
      set(key: string) { keys.push(key); },
      delete() {},
    };
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    for (let index = 0; index < 2; index += 1) {
      await api.get("/signed-referrer")
        .requestInit({ referrer: "https://referrer.example/?sig=signed-secret" })
        .cache("1m", { store });
    }

    expect(keys).toEqual([]);
    expect(calls).toBe(2);
  });

  it("removes URL fragments before Transport and request identity", async () => {
    const keys: string[] = [];
    const store = {
      get(key: string) { keys.push(key); return undefined; },
      set(key: string) { keys.push(key); },
      delete() {},
    };
    const transport = mockTransport((request) => Response.json({ url: request.url }));
    const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

    const response = await api.get<{ url: string }>("/fragment#access_token=fragment-secret")
      .cache("1m", { store });

    expect(response.data.url).toBe("https://api.example.com/fragment");
    expect(keys.join("\n")).not.toContain("fragment-secret");
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

describe("origin confinement", () => {
  it.each([
    "https://attacker.example/collect",
    "//attacker.example/collect",
  ])("rejects a baseUrl request that resolves to another origin: %s", async (input) => {
    const transport = mockTransport(() => Response.json({ leaked: true }));
    const api = lafetch.create({
      baseUrl: "https://api.example.com/v1/",
      headers: { Authorization: "Bearer top-secret" },
      transport,
    });

    await expect(api.get(input)).rejects.toMatchObject({ code: "ERR_HTTP_CONFIGURATION" });
    expect(transport.calls).toHaveLength(0);
  });

  it("rejects an opaque baseUrl whose origin cannot be compared safely", async () => {
    const transport = mockTransport(() => Response.json({ leaked: true }));
    const api = lafetch.create({
      baseUrl: "data:text/plain,base",
      headers: { Authorization: "Bearer top-secret" },
      transport,
    });

    await expect(api.get("data:text/plain,payload"))
      .rejects.toMatchObject({ code: "ERR_HTTP_CONFIGURATION" });
    expect(transport.calls).toHaveLength(0);
  });

  it("keeps same-origin absolute and relative requests working", async () => {
    const transport = mockTransport((request) => Response.json({ url: request.url }));
    const api = lafetch.create({
      baseUrl: "https://api.example.com/v1/",
      transport,
    });

    const [relative, absolute] = await Promise.all([
      api.get<{ url: string }>("users"),
      api.get<{ url: string }>("https://api.example.com/health"),
    ]);

    expect(relative.data.url).toBe("https://api.example.com/v1/users");
    expect(absolute.data.url).toBe("https://api.example.com/health");
  });

  it("allows an absolute origin when the client is not baseUrl-bound", async () => {
    const transport = mockTransport((request) => Response.json({ url: request.url }));
    const api = lafetch.create({ transport });

    const response = await api.get<{ url: string }>("https://other.example/data");

    expect(response.data.url).toBe("https://other.example/data");
  });
});
