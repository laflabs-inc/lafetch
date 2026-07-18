import { describe, expect, it } from "vitest";
import { HttpStatusError, lafetch } from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

class NotFoundError extends Error {}

describe("error mapping", () => {
  it("maps final execution failures", async () => {
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 404 })),
    });
    await expect(api.get("/missing").mapError((error, context) => {
      expect(context.phase).toBe("request");
      return error instanceof HttpStatusError ? new NotFoundError("missing", { cause: error }) : error;
    })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("composes multiple fluent mappers instead of replacing the previous mapper", async () => {
    const calls: string[] = [];
    const api = lafetch.create({
      baseUrl: "https://api.example.com",
      transport: mockTransport(() => new Response(null, { status: 404 })),
    });

    await expect(api
      .get("/missing")
      .mapError((error) => {
        calls.push("first");
        return new NotFoundError("mapped", { cause: error });
      })
      .mapError((error) => {
        calls.push("second");
        return error;
      }))
      .rejects.toBeInstanceOf(NotFoundError);

    expect(calls).toEqual(["second", "first"]);
  });
});
