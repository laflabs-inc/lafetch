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

    const first = await api.get("/cache/basic").cache({ ttl: "1m", store }).json<{ call: number }>();
    const second = await api.get("/cache/basic").cache({ ttl: "1m", store }).json<{ call: number }>();

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

    await api.get("/cache/private").credentials("include").cache({ store });
    await api.get("/cache/private").credentials("include").cache({ store });

    expect(calls).toBe(2);
  });
});
