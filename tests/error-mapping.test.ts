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
    await expect(api.get("/missing").mapError((error) =>
      error instanceof HttpStatusError ? new NotFoundError("missing", { cause: error }) : error,
    )).rejects.toBeInstanceOf(NotFoundError);
  });
});
