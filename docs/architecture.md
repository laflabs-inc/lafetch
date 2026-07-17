# Kernel architecture

## Public model

```text
lafetch.get() or LafetchClient
  -> immutable RequestBuilder
    -> normalized RequestConfiguration
      -> Feature resolver
        -> request / attempt lifecycle
          -> Transport
```

The fluent chain is declarative. Chain order does not wrap nested middleware and does not define runtime order. The executor resolves a stable lifecycle plan before dispatch.

The public API has three progressive layers. The zero-config `lafetch` object is a default client, `create()` defines reusable application defaults and an isolation boundary, and `.use()` exposes the Feature runtime for advanced extensions. Official policies can be expressed either as request options or fluent methods; both normalize to the same request configuration.

Configuration precedence is client defaults, request options, then fluent methods.

## State isolation

Mutable policy resources have explicit owners:

| State | Owner | Lifetime |
| --- | --- | --- |
| Builder execution Promise | one immutable builder | until its consumers settle |
| Feature `state` | one Feature in one execution | one request execution |
| Feature `metadata` | all Features in one execution | one request execution |
| Default memory cache | one client | client lifetime |
| In-flight deduplication registry | one client | entries live only while leaders execute |
| Custom `CacheStore` | caller | caller-defined |

Independently created clients never share a process-wide cache or deduplication registry. The zero-config `lafetch` object is itself one default client; use `create()` for application or tenant boundaries. `create()` and `extend()` each create a new, lazily initialized policy scope. Sharing an explicit store remains possible, but requires the caller to pass the same adapter deliberately.

## Execution scopes

Request scope runs once:

1. normalize URL, query, headers, and body source;
2. resolve Feature capabilities and ordering;
3. create isolated Feature state, shared request metadata, and the total deadline;
4. emit `request:start` and prepare the base request draft;
5. execute attempts;
6. map a final error in reverse Feature order when necessary;
7. run finalizers in reverse order and emit the final request event.

Official policies participate at specific boundaries: cache and deduplication may intercept dispatch, idempotency mutates attempt drafts, execution error mapping runs after the final attempt, and schema validation runs later in response-consumption scope.

Attempt scope runs for every retry:

1. clone the prepared request draft;
2. create the attempt deadline;
3. run `beforeAttempt` hooks;
4. create a fresh `Request`;
5. emit `attempt:start`;
6. run `intercept` hooks until one returns a Response, otherwise call the Transport;
7. run `afterResponse` hooks, passing replacements to later Features;
8. emit the response or attempt error event;
9. decide whether to retry and expose the selected backoff delay;
10. wait for backoff before the next attempt.

## Promise-like invariant

Every builder owns one memoized raw execution Promise. All consumers decode clones of the retained response. This provides the following invariant:

```text
one builder instance = at most one Transport execution sequence
```

Calling another fluent method creates a new immutable builder with a separate execution identity.

The kernel currently buffers the final response before settling so total timeout includes response consumption and multiple terminal consumers can safely decode the same response. True streaming will require a separate explicit execution path rather than weakening this invariant silently.

## Retry invariant

`attempts` is the maximum total number of attempts, not the number of retries after the first request.

Default retry policy:

- methods: `GET`, `HEAD`, `OPTIONS`;
- statuses: `408`, `429`, `500`, `502`, `503`, `504`;
- network failures: enabled;
- `Retry-After`: respected;
- backoff: exponential with full jitter;
- attempt timeouts: retryable for allowed methods;
- total timeouts and user aborts: final.

An existing `ReadableStream` body is rejected before dispatch when retry could require replay. `bodyFactory()` is the explicit replay contract.

## Feature resolution

Capabilities use one of three modes:

- `exclusive`: at most one provider;
- `composable`: multiple ordered providers;
- `observer`: multiple non-owning observers.

The resolver validates required and conflicting capabilities, constructs a graph from ordering relationships, and applies a stable topological sort. Strict `before` and `after` references must resolve and cannot target the same Feature. `optionalBefore` and `optionalAfter` express soft integration edges. Finalizers run in reverse resolved order and each receives an isolated Response clone.

## Feature Runtime controls

Each Feature receives two state surfaces:

- `state` is isolated to that Feature and one request execution;
- `metadata` is shared by all Features in the same request execution.

Control hooks have explicit semantics:

- `intercept` runs in resolved order; the first returned Response skips Transport dispatch for that attempt;
- `afterResponse` runs in resolved order and may return a replacement Response;
- `onAttemptError` observes normalized attempt errors and the retry decision, including `retryDelayMs`;
- `mapError` runs once on the final Error in reverse resolved order;
- `finalize` runs in reverse resolved order whether execution succeeds or fails.

A Feature hook failure is wrapped in `HttpFeatureError` unless it is already an `HttpError`. Feature failures are never reclassified as Transport failures.

## Lifecycle events

`onEvent` observers receive immutable, body-free snapshots:

```text
request:start
  attempt:start
  [attempt:response]
  [attempt:error]
  [attempt:start ...]
request:success | request:error
```

An `attempt:error` records `willRetry` and the selected `retryDelayMs`. Response events record their source as the Transport name or `feature:<name>` for an intercepted response. Request snapshots reuse the diagnostic redaction policy for credential headers and token-like query parameters.

## Security defaults

- status outside `200–299` is an error unless explicitly accepted;
- unsafe methods are not retried by default;
- request bodies are never included in diagnostics;
- credential headers and token-like query values are redacted;
- URL user information is removed from diagnostics;
- Fetch credentials default to `omit`;
- credentialed and sensitive requests bypass built-in cache and deduplication;
- default cache and deduplication state never crosses client boundaries;
- cache and deduplication keys include all normalized request headers;
- transport and Feature conflicts fail before network dispatch.

## Consumption scope

Execution produces one retained raw Response. Each terminal consumer works on a clone, decodes it, optionally validates or transforms it through a schema, and optionally maps consumption failures. Execution `.mapError()` is completed before this pipeline. `.raw()` is intentionally outside it.

This separation prevents an invalid payload from being retried as a network failure and leaves room for consumption-specific telemetry without changing Transport semantics.

## Decisions still open

- final package and repository name availability;
- license (`Apache-2.0` is a strong candidate because it includes an explicit patent grant);
- supported Node.js LTS matrix at the first public release;
- external schema ecosystem compatibility beyond the current `parse`/`validate` contract;
- cache ownership and revalidation contracts for Next.js;
- true streaming builder semantics;
- whether `RequestBuilder` should remain thenable after external user testing.
