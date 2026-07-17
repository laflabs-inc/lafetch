# Lafetch

Lafetch is a DX-first, policy-composable TypeScript HTTP client built on the Fetch standard.

> Status: pre-release framework development. Core request policies are implemented, but runtime compatibility and packaging work remain before npm publication.

```ts
import { lafetch } from "@laflabs/lafetch";

const api = lafetch.create({
  baseUrl: "https://api.example.com",
});

const user = await api
  .get("/users/123")
  .timeout("3s")
  .retry(3)
  .cache("30s")
  .json<User>();
```

## Design goals

- Keep simple requests short.
- Keep complex request policy readable.
- Use standard `Request`, `Response`, `Headers`, and `AbortSignal` objects.
- Keep Transport replaceable and request Features composable.
- Run the same semantics in browsers, Node.js, Next.js, and Fetch-compatible workers.
- Fail safely for unsafe retries, non-replayable bodies, sensitive diagnostics, and Feature conflicts.

## Current kernel API

### Result envelope

Awaiting a builder directly returns an `HttpResult<T>`.

```ts
const result = await api.get<User>("/users/123");

result.data;
result.status;
result.headers;
result.response;
result.meta.attempts;
```

Data-only terminal methods return a normal `Promise`.

```ts
const user = await api.get("/users/123").json<User>();
const text = await api.get("/health").text();
const response = await api.get("/download").raw();
```

### Promise-compatible chaining

`RequestBuilder` is a lazy Promise-like value.

```ts
api
  .get<User>("/users/123")
  .timeout("3s")
  .retry(3)
  .then(({ data }) => render(data))
  .catch(handleError)
  .finally(stopLoading);
```

The request starts when the builder is consumed by `await`, `then`, `catch`, `finally`, `send`, or a terminal decoder. A single builder executes its Transport exactly once, even when it has multiple consumers.

```ts
const request = api.get<User>("/users/123");

const name = request.then(({ data }) => data.name);
const email = request.then(({ data }) => data.email);

await Promise.all([name, email]); // one HTTP execution
```

Chained builders are immutable. Creating a variant produces a new request execution.

### Request configuration

```ts
const created = await api
  .post("/users")
  .query({ notify: true, tag: ["new", "member"] })
  .header("X-Request-Source", "admin")
  .jsonBody({ name: "Dohyun" })
  .timeout({ total: "20s", attempt: "5s" })
  .retry({
    attempts: 3,
    methods: ["POST"],
    backoff: {
      type: "exponential",
      base: "200ms",
      max: "10s",
      jitter: "full",
    },
  })
  .json<User>();
```

`retry(3)` means **at most three total attempts**, including the initial attempt. By default only `GET`, `HEAD`, and `OPTIONS` are retried.

Credentials default to `"omit"`. Opt in explicitly at client or request scope.

```ts
const api = lafetch.create({ credentials: "same-origin" });
await api.get("/session").credentials("include");
```

Streaming request bodies are not replayable. Use `bodyFactory()` when every attempt needs a fresh body.

```ts
await api
  .post("/upload")
  .bodyFactory(() => createUploadStream())
  .retry({ attempts: 2, methods: ["POST"] });
```

### Cache and deduplication

Cache completed safe responses and share concurrent safe requests with separate policies.

```ts
const users = await api
  .get("/users")
  .cache("30s")
  .dedupe()
  .json<User[]>();
```

The default memory cache is bounded to 500 entries. Credentialed requests, authorization headers, `Set-Cookie`, restrictive `Cache-Control`, and responses with `Vary` bypass the default cache. GET and HEAD are the default cache and deduplication methods. Unsafe methods require an explicit custom key.

```ts
import { MemoryCacheStore } from "@laflabs/lafetch";

const store = new MemoryCacheStore(1_000);
await api.get("/catalog").cache({ ttl: "5m", store });
```

### Idempotent writes

Idempotency adds one stable key for the entire retry sequence. It makes the current method retryable when `retry.methods` is omitted; an explicit method list remains authoritative.

```ts
await api
  .post("/payments")
  .jsonBody(input)
  .idempotency()
  .retry(3);
```

An existing `Idempotency-Key` is preserved. Custom asynchronous key generation and header names are supported.

### Schema validation and error mapping

Schema validation runs after HTTP execution and response decoding. It accepts a function or an object with `parse()` or `validate()` and can transform the returned type.

```ts
const userSchema = {
  parse(value: unknown): User {
    return validateUser(value);
  },
};

const user = await api.get("/me").schema(userSchema).json();
```

Execution failures and response-consumption failures have separate mapping scopes.

```ts
await api
  .get("/users/123")
  .mapError((error) => mapApiError(error))
  .schema(userSchema)
  .mapDecodeError((error) => mapPayloadError(error));
```

`raw()` always returns a response clone and deliberately bypasses schema consumption.

### Abort and timeout

```ts
const controller = new AbortController();

const request = api
  .get("/reports")
  .signal(controller.signal)
  .timeout({ total: "30s", attempt: "10s" });

controller.abort();
```

User cancellation throws `HttpAbortError`. Total and per-attempt deadlines throw `HttpTimeoutError` with a `scope` of `"total"` or `"attempt"`. Safe methods may retry an attempt timeout; a total timeout is always final.

### Custom Transport

```ts
import type { Transport } from "@laflabs/lafetch";

const transport: Transport = {
  name: "custom",
  async send(request, context) {
    return customRuntimeFetch(request, context.signal);
  },
};

const api = lafetch.create({ transport });
```

### Request Feature

Official policies have first-class DSL methods. External behavior is installed with `.use()`.

```ts
const requestIdFeature = {
  name: "request-id",
  capabilities: {
    provides: [{ name: "request-id", mode: "exclusive" }],
  },
  hooks: {
    prepare({ draft, requestId }) {
      draft.headers.set("X-Request-ID", requestId);
    },
  },
};

await api.get("/users").use(requestIdFeature);
```

Feature order is resolved from `before` and `after` relationships. Exclusive capability conflicts, missing requirements, and ordering cycles fail before Transport dispatch.

Strict `before`/`after` references must name an installed Feature. Use `optionalBefore` or `optionalAfter` for optional integrations.

### Feature Runtime controls

Features receive isolated request-scoped `state` and a shared request-scoped `metadata` map. Control hooks can short-circuit Transport dispatch, replace a Response, or map the final Error without changing the fluent request API.

```ts
const fixtureFeature = {
  name: "fixture",
  hooks: {
    intercept({ request }) {
      if (new URL(request.url).pathname === "/health") {
        return Response.json({ ok: true });
      }
    },
    afterResponse({ response }) {
      // Return undefined to keep the current Response,
      // or return a Response to replace it for later Features.
      return response;
    },
    mapError({ error }) {
      return error;
    },
  },
};

const result = await api.get("/health").use(fixtureFeature);
result.meta.transport; // "feature:fixture"
```

Only the first `intercept` hook that returns a Response skips dispatch. `afterResponse` runs in resolved order and passes replacements to later Features. `mapError` runs once for the final failure in reverse resolved order. `finalize` also runs in reverse order.

### Telemetry

Telemetry is an observer Feature and can be installed for one request with the fluent DSL.

```ts
await api
  .get("/health")
  .retry(3)
  .telemetry((event) => {
    console.log(event.type, event.requestId);
  });
```

Install it at client scope when every request should be observed.

```ts
import { lafetch, telemetry } from "@laflabs/lafetch";

const api = lafetch.create({
  features: [
    telemetry((event) => sendToCollector(event)),
  ],
});
```

The event sequence uses the following discriminated event types:

- `request:start`;
- `attempt:start`;
- `attempt:response`;
- `attempt:error`, including `willRetry` and `retryDelayMs`;
- `request:success` or `request:error`.

Request snapshots never include bodies and redact credential headers and token-like query values. Telemetry handler failures are ignored by default so an unavailable collector cannot fail an HTTP request. Set `failureMode: "throw"` when strict delivery is required.

## Error model

- `HttpTransportError`
- `HttpTimeoutError`
- `HttpAbortError`
- `HttpStatusError`
- `HttpDecodeError`
- `HttpConsumptionError`
- `HttpSchemaError`
- `HttpConfigurationError`
- `HttpFeatureConflictError`
- `HttpFeatureError`
- `HttpNonReplayableBodyError`

Responses outside `200–299` throw `HttpStatusError` by default. Override the accepted range explicitly when an endpoint needs different semantics.

```ts
const result = await api
  .get<ApiResult>("/jobs/123")
  .acceptStatus((status) => status === 200 || status === 404);
```

Diagnostic request snapshots redact credential headers and token-like query values.

## Testing

```ts
import { lafetch } from "@laflabs/lafetch";
import { mockTransport } from "@laflabs/lafetch/testing";

const transport = mockTransport(() =>
  Response.json({ id: "user_123" }),
);

const api = lafetch.create({
  baseUrl: "https://api.example.com",
  transport,
});
```

## Development

```bash
pnpm install
pnpm check
```

`pnpm check` runs strict TypeScript checking, the behavioral test suite, and the ESM declaration build.

## Prototype boundaries

The following are intentionally not implemented yet:

- cache and in-flight deduplication;
- idempotency-key generation;
- schema adapters and type inference from schemas;
- an official error-mapping Feature and external telemetry adapters;
- true streaming response mode;
- React and Next.js integration packages;
- Laf ID authentication integration.

These features should be added only after the kernel API and lifecycle survive the first RFC review.
