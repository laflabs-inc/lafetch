import { describe, expect, expectTypeOf, it } from "vitest";
import { HttpSchemaError, lafetch } from "../src/index.js";
import { mockTransport } from "../src/testing/index.js";

interface User { id: string }

const userSchema = {
  parse(value: unknown): User {
    if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string") {
      throw new Error("invalid user");
    }
    return value as User;
  },
};

describe("response schema", () => {
  it("validates, transforms, and infers the result", async () => {
    const api = lafetch.create({ transport: mockTransport(() => Response.json({ id: "1" })) });
    const result = await api.get("https://api.example.com/user").validate(userSchema);
    expect(result.id).toBe("1");
    expectTypeOf(result).toEqualTypeOf<User>();
  });

  it("maps response validation failures through the unified error mapper", async () => {
    const api = lafetch.create({ transport: mockTransport(() => Response.json({ nope: true })) });
    const error = await api
      .get("https://api.example.com/user")
      .validate(userSchema)
      .mapError((caught, context) => {
        expect(context.phase).toBe("response");
        return new TypeError("bad payload", { cause: caught });
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).cause).toMatchObject({
      name: "HttpSchemaError",
      code: "ERR_HTTP_SCHEMA",
    });
  });

  it("keeps raw response access outside schema consumption", async () => {
    const api = lafetch.create({ transport: mockTransport(() => Response.json({ nope: true })) });
    const response = await api.get("https://api.example.com/user").validate(userSchema).asRaw();
    expect(response.status).toBe(200);
  });
});
