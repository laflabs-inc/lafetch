import type { TimeoutScope } from "./types.js";
import { snapshotRequest, type RequestSnapshot } from "./request-snapshot.js";

const HTTP_ERROR_BRAND = Symbol.for("@laflabs/lafetch/HttpError");

export type HttpErrorCode =
  | "ERR_HTTP_CONFIGURATION"
  | "ERR_HTTP_TRANSPORT"
  | "ERR_HTTP_ABORTED"
  | "ERR_HTTP_TIMEOUT"
  | "ERR_HTTP_STATUS"
  | "ERR_HTTP_DECODE"
  | "ERR_HTTP_CONSUMPTION"
  | "ERR_HTTP_SCHEMA"
  | "ERR_HTTP_FEATURE_CONFLICT"
  | "ERR_HTTP_FEATURE"
  | "ERR_HTTP_NON_REPLAYABLE_BODY"
  | "ERR_HTTP_RESPONSE_TOO_LARGE";

export interface HttpErrorOptions {
  readonly cause?: unknown;
  readonly request?: Request | RequestSnapshot;
}

export class HttpError extends Error {
  readonly code: HttpErrorCode;
  readonly request?: RequestSnapshot;

  constructor(message: string, code: HttpErrorCode, options: HttpErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    Object.defineProperty(this, HTTP_ERROR_BRAND, { value: true });
    if (options.request) this.request = snapshotRequest(options.request);
  }
}

export class HttpConfigurationError extends HttpError {
  constructor(message: string, options: HttpErrorOptions = {}) {
    super(message, "ERR_HTTP_CONFIGURATION", options);
  }
}

export class HttpTransportError extends HttpError {
  constructor(message: string, options: HttpErrorOptions = {}) {
    super(message, "ERR_HTTP_TRANSPORT", options);
  }
}

export class HttpAbortError extends HttpError {
  readonly reason: unknown;

  constructor(reason: unknown, options: HttpErrorOptions = {}) {
    super("The HTTP request was aborted.", "ERR_HTTP_ABORTED", { ...options, cause: options.cause ?? reason });
    this.reason = reason;
  }
}

export class HttpTimeoutError extends HttpError {
  readonly scope: TimeoutScope;
  readonly timeoutMs: number;

  constructor(scope: TimeoutScope, timeoutMs: number, options: HttpErrorOptions = {}) {
    super(`The HTTP ${scope} timeout of ${timeoutMs}ms was exceeded.`, "ERR_HTTP_TIMEOUT", options);
    this.scope = scope;
    this.timeoutMs = timeoutMs;
  }
}

export class HttpStatusError extends HttpError {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;

  constructor(response: Response, options: HttpErrorOptions = {}) {
    super(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`, "ERR_HTTP_STATUS", options);
    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = new Headers(response.headers);
    this.response = response;
  }
}

export class HttpDecodeError extends HttpError {
  readonly responseType: string;

  constructor(responseType: string, options: HttpErrorOptions = {}) {
    super(`Failed to decode the HTTP response as ${responseType}.`, "ERR_HTTP_DECODE", options);
    this.responseType = responseType;
  }
}

export class HttpConsumptionError extends HttpError {
  constructor(message: string, options: HttpErrorOptions = {}) {
    super(message, "ERR_HTTP_CONSUMPTION", options);
  }
}

export class HttpSchemaError extends HttpConsumptionError {
  override readonly code = "ERR_HTTP_SCHEMA";
  readonly issues?: unknown;

  constructor(message = "The HTTP response did not match the configured schema.", options: HttpErrorOptions & { issues?: unknown } = {}) {
    super(message, options);
    this.name = "HttpSchemaError";
    if (options.issues !== undefined) this.issues = options.issues;
  }
}

export class HttpFeatureConflictError extends HttpError {
  constructor(message: string, options: HttpErrorOptions = {}) {
    super(message, "ERR_HTTP_FEATURE_CONFLICT", options);
  }
}

export class HttpFeatureError extends HttpError {
  readonly feature: string;
  readonly hook: string;

  constructor(feature: string, hook: string, options: HttpErrorOptions = {}) {
    super(`Feature "${feature}" failed in the ${hook} hook.`, "ERR_HTTP_FEATURE", options);
    this.feature = feature;
    this.hook = hook;
  }
}

export class HttpNonReplayableBodyError extends HttpError {
  constructor(options: HttpErrorOptions = {}) {
    super(
      "The request body cannot be replayed for retry. Use bodyFactory() or disable retry.",
      "ERR_HTTP_NON_REPLAYABLE_BODY",
      options,
    );
  }
}

export class HttpResponseTooLargeError extends HttpError {
  readonly limitBytes: number;
  readonly receivedBytes: number;

  constructor(limitBytes: number, receivedBytes: number, options: HttpErrorOptions = {}) {
    super(
      `The HTTP response exceeded the configured ${limitBytes}-byte buffer limit.`,
      "ERR_HTTP_RESPONSE_TOO_LARGE",
      options,
    );
    this.limitBytes = limitBytes;
    this.receivedBytes = receivedBytes;
  }
}

export interface HttpErrorByCode {
  readonly ERR_HTTP_CONFIGURATION: HttpConfigurationError;
  readonly ERR_HTTP_TRANSPORT: HttpTransportError;
  readonly ERR_HTTP_ABORTED: HttpAbortError;
  readonly ERR_HTTP_TIMEOUT: HttpTimeoutError;
  readonly ERR_HTTP_STATUS: HttpStatusError;
  readonly ERR_HTTP_DECODE: HttpDecodeError;
  readonly ERR_HTTP_CONSUMPTION: HttpConsumptionError;
  readonly ERR_HTTP_SCHEMA: HttpSchemaError;
  readonly ERR_HTTP_FEATURE_CONFLICT: HttpFeatureConflictError;
  readonly ERR_HTTP_FEATURE: HttpFeatureError;
  readonly ERR_HTTP_NON_REPLAYABLE_BODY: HttpNonReplayableBodyError;
  readonly ERR_HTTP_RESPONSE_TOO_LARGE: HttpResponseTooLargeError;
}

export type HttpErrorForCode<TCode extends HttpErrorCode> = HttpErrorByCode[TCode];

function hasHttpErrorBrand(error: object): boolean {
  return Reflect.get(error, HTTP_ERROR_BRAND) === true;
}

function isHttpErrorCode(code: unknown): code is HttpErrorCode {
  switch (code) {
    case "ERR_HTTP_CONFIGURATION":
    case "ERR_HTTP_TRANSPORT":
    case "ERR_HTTP_ABORTED":
    case "ERR_HTTP_TIMEOUT":
    case "ERR_HTTP_STATUS":
    case "ERR_HTTP_DECODE":
    case "ERR_HTTP_CONSUMPTION":
    case "ERR_HTTP_SCHEMA":
    case "ERR_HTTP_FEATURE_CONFLICT":
    case "ERR_HTTP_FEATURE":
    case "ERR_HTTP_NON_REPLAYABLE_BODY":
    case "ERR_HTTP_RESPONSE_TOO_LARGE":
      return true;
    default:
      return false;
  }
}

export function isHttpError(error: unknown): error is HttpError;
export function isHttpError<TCode extends HttpErrorCode>(
  error: unknown,
  code: TCode,
): error is HttpErrorForCode<TCode>;
export function isHttpError(error: unknown, code?: HttpErrorCode): error is HttpError {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  try {
    const errorCode = Reflect.get(error, "code");
    if (!hasHttpErrorBrand(error) || !isHttpErrorCode(errorCode)) return false;
    return code === undefined ? true : errorCode === code;
  } catch {
    return false;
  }
}
