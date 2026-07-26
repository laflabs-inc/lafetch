import { describe, expect, expectTypeOf, it, vi } from "vitest";
import * as v from "valibot";
import * as z from "zod";
import {
  HttpSchemaError,
  lafetch,
  type LResponse,
  type StandardSchemaV1,
} from "../src/index.js";
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
    expect(result.data.id).toBe("1");
    expectTypeOf(result).toEqualTypeOf<LResponse<User>>();
  });

  it("returns the schema output type after an explicit decoder", async () => {
    const lengthSchema = {
      parse(value: unknown): number {
        if (typeof value !== "string") throw new Error("expected text");
        return value.length;
      },
    };
    const api = lafetch.create({ transport: mockTransport(() => new Response("hello")) });
    const resultPromise = api.get("https://api.example.com/text").validate(lengthSchema).as("text");

    expectTypeOf(resultPromise).toEqualTypeOf<Promise<number>>();
    await expect(resultPromise).resolves.toBe(5);
  });

  it("snapshots an object schema when it is attached to an LRequest", async () => {
    const original = vi.fn((value: unknown) => value as User);
    const replacement = vi.fn(() => {
      throw new Error("mutated schema");
    });
    const schema = { parse: original };
    const api = lafetch.create({ transport: mockTransport(() => Response.json({ id: "1" })) });
    const request = api.get("https://api.example.com/user").validate(schema);
    schema.parse = replacement;

    await expect(request).resolves.toHaveProperty("data.id", "1");
    expect(original).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
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
    const response = await api.get("https://api.example.com/user").validate(userSchema).as("response");
    expect(response.status).toBe(200);
  });

  it("infers and transforms Zod Standard Schema output", async () => {
    const schema = z.object({ id: z.string() }).transform(({ id }) => ({
      numericId: Number(id),
    }));
    const api = lafetch.create({
      transport: mockTransport(() => Response.json({ id: "42" })),
    });

    const response = await api.get("https://api.example.com/user").validate(schema);

    expect(response.data).toEqual({ numericId: 42 });
    expectTypeOf(response).toEqualTypeOf<LResponse<{ numericId: number }>>();
  });

  it("infers and transforms Valibot Standard Schema output", async () => {
    const schema = v.pipe(
      v.object({ id: v.string() }),
      v.transform(({ id }) => ({ numericId: Number(id) })),
    );
    const api = lafetch.create({
      transport: mockTransport(() => Response.json({ id: "7" })),
    });

    const result = api.get("https://api.example.com/user").validate(schema).as("json");

    expectTypeOf(result).toEqualTypeOf<Promise<{ numericId: number }>>();
    await expect(result).resolves.toEqual({ numericId: 7 });
  });

  it("supports asynchronous Standard Schema validation", async () => {
    const schema: StandardSchemaV1<unknown, User> = {
      "~standard": {
        version: 1,
        vendor: "test",
        async validate(value) {
          await Promise.resolve();
          return typeof value === "object" && value !== null && "id" in value
            ? { value: value as User }
            : { issues: [{ message: "id is required", path: ["id"] }] };
        },
      },
    };
    const api = lafetch.create({
      transport: mockTransport(() => Response.json({ id: "1" })),
    });

    await expect(api.get("https://api.example.com/user").validate(schema).as("json"))
      .resolves.toEqual({ id: "1" });
  });

  it("preserves Standard Schema issues and thrown causes", async () => {
    const issueSchema: StandardSchemaV1 = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: () => ({
          issues: [{ message: "invalid id", path: [{ key: "id" }] }],
        }),
      },
    };
    const cause = new Error("validator crashed");
    const causeSchema: StandardSchemaV1 = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: () => {
          throw cause;
        },
      },
    };
    const api = lafetch.create({
      transport: mockTransport(() => Response.json({ nope: true })),
    });

    const issueError = await api.get("https://api.example.com/issue")
      .validate(issueSchema)
      .catch((caught: unknown) => caught);
    const causeError = await api.get("https://api.example.com/cause")
      .validate(causeSchema)
      .catch((caught: unknown) => caught);

    expect(issueError).toBeInstanceOf(HttpSchemaError);
    expect((issueError as HttpSchemaError).issues).toEqual([
      { message: "invalid id", path: [{ key: "id" }] },
    ]);
    expect(causeError).toBeInstanceOf(HttpSchemaError);
    expect((causeError as Error).cause).toBe(cause);
  });

  it("prefers the Standard Schema contract over vendor-specific methods", async () => {
    const parse = vi.fn(() => "legacy");
    const schema = {
      "~standard": {
        version: 1 as const,
        vendor: "hybrid",
        validate: () => ({ value: "standard" }),
        types: undefined as unknown as { input: unknown; output: string },
      },
      parse,
    };
    const api = lafetch.create({
      transport: mockTransport(() => Response.json({ id: "1" })),
    });

    const result = await api.get("https://api.example.com/user").validate(schema).as("json");

    expect(result).toBe("standard");
    expect(parse).not.toHaveBeenCalled();
    expectTypeOf(result).toEqualTypeOf<string>();
  });

  it("rejects malformed Standard Schema declarations without falling back", () => {
    const api = lafetch.create({
      transport: mockTransport(() => Response.json({ id: "1" })),
    });
    const schema = {
      "~standard": { version: 2, vendor: "broken", validate: () => ({ value: "x" }) },
      parse: () => "legacy",
    };

    expect(() => api.get("https://api.example.com/user").validate(schema as any))
      .toThrow("invalid Standard Schema V1");
  });
});
