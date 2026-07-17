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
    const result = await api.get("https://api.example.com/user").schema(userSchema);
    expect(result.data.id).toBe("1");
    expectTypeOf(result.data).toEqualTypeOf<User>();
  });

  it("uses a distinct consumption error mapping scope", async () => {
    const api = lafetch.create({ transport: mockTransport(() => Response.json({ nope: true })) });
    const error = await api
      .get("https://api.example.com/user")
      .schema(userSchema)
      .mapDecodeError((caught) => new TypeError("bad payload", { cause: caught }))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).cause).toBeInstanceOf(HttpSchemaError);
  });

  it("keeps raw response access outside schema consumption", async () => {
    const api = lafetch.create({ transport: mockTransport(() => Response.json({ nope: true })) });
    const response = await api.get("https://api.example.com/user").schema(userSchema).raw();
    expect(response.status).toBe(200);
  });
});
