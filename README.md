# Lafetch

Lafetch is a DX-first, policy-composable TypeScript HTTP client built on the Fetch standard.

> Status: `v0.1` kernel prototype. The package is intentionally private and not ready for npm publication.

```ts
import { lafetch } from "@laflabs/lafetch";

const api = lafetch.create({
  baseUrl: "https://api.example.com",
});

const user = await api
  .get("/users/123")
  .timeout("3s")
  .retry(3)
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

Streaming request bodies are not replayable. Use `bodyFactory()` when every attempt needs a fresh body.

```ts
await api
  .post("/upload")
  .bodyFactory(() => createUploadStream())
  .retry({ attempts: 2, methods: ["POST"] });
```

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

## Error model

- `HttpTransportError`
- `HttpTimeoutError`
- `HttpAbortError`
- `HttpStatusError`
- `HttpDecodeError`
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
- error mapping and telemetry adapters;
- true streaming response mode;
- React and Next.js integration packages;
- Laf ID authentication integration.

These features should be added only after the kernel API and lifecycle survive the first RFC review.
