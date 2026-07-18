import { describe, expect, it } from "vitest";
import { lafetch, MemoryCacheStore } from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

describe("cache", () => {
  it("reuses a successful response across builders", async () => {
    let calls = 0;
    const store = new MemoryCacheStore();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    const first = await api.get<{ call: number }>("/cache/basic").cache("1m", { store });
    const second = await api.get<{ call: number }>("/cache/basic").cache("1m", { store });

    expect(first.call).toBe(1);
    expect(second.call).toBe(1);
    expect(calls).toBe(1);
  });

  it("bypasses credentialed requests", async () => {
    let calls = 0;
    const store = new MemoryCacheStore();
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    await api.get("/cache/private").credentials("include").cache("30s", { store });
    await api.get("/cache/private").credentials("include").cache("30s", { store });

    expect(calls).toBe(2);
  });

  it("bypasses token-bearing headers and query parameters", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ call: ++calls })),
    });

    await api.get("/cache/private")
      .header("X-Auth-Token", "secret")
      .query({ user_token: "secret" })
      .cache("1m");
    await api.get("/cache/private")
      .header("X-Auth-Token", "secret")
      .query({ user_token: "secret" })
      .cache("1m");

    expect(calls).toBe(2);
  });

  it("isolates the default store between clients", async () => {
    const firstApi = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ tenant: "first" })),
    });
    const secondApi = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json({ tenant: "second" })),
    });

    const first = await firstApi.get<{ tenant: string }>("/cache/isolated").cache("30s");
    const second = await secondApi.get<{ tenant: string }>("/cache/isolated").cache("30s");

    expect(first.tenant).toBe("first");
    expect(second.tenant).toBe("second");
  });

  it("includes tenant and representation headers in the default key", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport((request) => {
        calls += 1;
        return Response.json({ tenant: request.headers.get("x-tenant") });
      }),
    });

    const first = await api.get<{ tenant: string }>("/cache/tenant").header("X-Tenant", "first").cache("30s");
    const second = await api.get<{ tenant: string }>("/cache/tenant").header("X-Tenant", "second").cache("30s");

    expect(first.tenant).toBe("first");
    expect(second.tenant).toBe("second");
    expect(calls).toBe(2);
  });

  it("does not cache a response with max-age=0", async () => {
    let calls = 0;
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => Response.json(
        { call: ++calls },
        { headers: { "Cache-Control": "public, max-age=0" } },
      )),
    });

    expect((await api.get<{ call: number }>("/cache/server-policy").cache("1m")).call).toBe(1);
    expect((await api.get<{ call: number }>("/cache/server-policy").cache("1m")).call).toBe(2);
  });
});
