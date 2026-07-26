import { describe, expect, expectTypeOf, it } from "vitest";
import {
  HttpError,
  HttpStatusError,
  HttpTimeoutError,
  isHttpError,
  type HttpErrorCode,
} from "../src/index.js";

describe("isHttpError", () => {
  it("narrows Lafetch errors and stable error codes", () => {
    const error: unknown = new HttpTimeoutError("total", 1_000);

    if (!isHttpError(error)) throw new Error("Expected a Lafetch error.");
    expectTypeOf(error).toEqualTypeOf<HttpError>();
    expect(error.code).toBe("ERR_HTTP_TIMEOUT");

    const timeout: unknown = error;
    if (!isHttpError(timeout, "ERR_HTTP_TIMEOUT")) {
      throw new Error("Expected a timeout error.");
    }
    expectTypeOf(timeout).toEqualTypeOf<HttpTimeoutError>();
    expect(timeout.timeoutMs).toBe(1_000);
  });

  it("supports a union of stable codes", () => {
    const code: HttpErrorCode = Math.random() > 0.5
      ? "ERR_HTTP_TIMEOUT"
      : "ERR_HTTP_STATUS";
    const error: unknown = new HttpStatusError(new Response(null, { status: 503 }));

    if (isHttpError(error, code)) {
      expectTypeOf(error).toEqualTypeOf<HttpTimeoutError | HttpStatusError>();
    }
  });

  it("recognizes another installed copy through the global brand", () => {
    const duplicate = {
      name: "HttpTimeoutError",
      message: "timed out",
      code: "ERR_HTTP_TIMEOUT",
      scope: "total",
      timeoutMs: 1_000,
      [Symbol.for("@laflabs/lafetch/HttpError")]: true,
    };

    expect(isHttpError(duplicate)).toBe(true);
    expect(isHttpError(duplicate, "ERR_HTTP_TIMEOUT")).toBe(true);
    expect(isHttpError(duplicate, "ERR_HTTP_STATUS")).toBe(false);
  });

  it("does not accept unbranded lookalikes or plain unknown values", () => {
    expect(isHttpError({ name: "HttpError", code: "ERR_HTTP_TIMEOUT" })).toBe(false);
    expect(isHttpError(new Error("ordinary"))).toBe(false);
    expect(isHttpError(null)).toBe(false);
    expect(isHttpError("ERR_HTTP_TIMEOUT")).toBe(false);
    expect(isHttpError({
      code: "ERR_HTTP_FUTURE",
      [Symbol.for("@laflabs/lafetch/HttpError")]: true,
    })).toBe(false);
    expect(isHttpError(new Proxy({}, {
      get() {
        throw new Error("hostile proxy");
      },
    }))).toBe(false);
  });
});
