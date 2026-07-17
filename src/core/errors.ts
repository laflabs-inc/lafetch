import type { RequestMeta, TimeoutScope } from "./types.js";

export interface RequestSnapshot {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface HttpErrorOptions {
  readonly cause?: unknown;
  readonly request?: Request | RequestSnapshot;
  readonly meta?: RequestMeta;
}

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
]);

const SENSITIVE_NAME = /^(?:access[-_]?token|api[-_]?key|auth(?:orization)?|client[-_]?secret|credential|password|refresh[-_]?token|secret|session(?:id)?|token)$/i;

function redactHeader(name: string, value: string): string {
  const normalized = name.toLowerCase();
  if (SENSITIVE_HEADERS.has(normalized) || SENSITIVE_NAME.test(normalized)) {
    return "[REDACTED]";
  }
  return value;
}

export function snapshotRequest(request: Request | RequestSnapshot): RequestSnapshot {
  const headers: Record<string, string> = {};
  if (request instanceof Request) {
    request.headers.forEach((value, name) => {
      headers[name] = redactHeader(name, value);
    });
  } else {
    for (const [name, value] of Object.entries(request.headers)) {
      headers[name.toLowerCase()] = redactHeader(name, value);
    }
  }

  const url = new URL(request.url);
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.toLowerCase();
    if (SENSITIVE_NAME.test(normalized)) {
      url.searchParams.set(key, "[REDACTED]");
    }
  }

  return Object.freeze({ method: request.method, url: url.toString(), headers: Object.freeze(headers) });
}

export class HttpError extends Error {
  readonly code: string;
  readonly request?: RequestSnapshot;
  readonly meta?: RequestMeta;

  constructor(message: string, code: string, options: HttpErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    if (options.request) this.request = snapshotRequest(options.request);
    if (options.meta) this.meta = options.meta;
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
