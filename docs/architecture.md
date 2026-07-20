# Kernel architecture

## Public model

```text
lafetch.create()
  -> LafetchClient.method(url)
    -> immutable RequestBuilder
      -> normalized RequestConfiguration
        -> Feature resolver
          -> request / attempt lifecycle
            -> Transport
```

The fluent chain is declarative. Chain order does not wrap nested middleware and does not define runtime order. The executor resolves a stable lifecycle plan before dispatch.

The public API has three strict roles. `lafetch` is only a client factory, each explicitly created client owns shared environment configuration and an isolation boundary, and `.use()` exposes the Feature runtime only for advanced extensions. There is no process-wide default client or static request shortcut.

Application requests have one public grammar:

```text
client.method(url).configure().policy() -> await data
```

Named HTTP methods accept only a URL. Request-specific query, headers, body, cancellation, execution policies, validation, and telemetry are expressed through immutable fluent methods. Awaiting a builder returns automatically decoded data directly. Explicit `asJson()`, `asText()` and related methods terminate configuration and return a real Promise. `asResponse()` opts into the decoded response envelope and `asRaw()` opts into the Fetch Response. The `request(method, url)` entry point exists only for custom HTTP methods.

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

Independently created clients never share a process-wide cache or deduplication registry. Every request therefore belongs to an explicit application, tenant, or request boundary created by `lafetch.create()`. Sharing an explicit store remains possible, but requires the caller to pass the same adapter deliberately.

## Execution scopes

Request scope runs once:

1. normalize URL, query, headers, and body source;
2. resolve Feature capabilities and ordering;
3. create isolated Feature state, shared request metadata, and the total deadline;
4. emit `request:start` and prepare the base request draft;
5. execute attempts;
6. map a final error in reverse Feature order when necessary;
7. run finalizers in reverse order and emit the final request event.

Official policies participate at specific boundaries: cache and deduplication may intercept dispatch, idempotency mutates attempt drafts, Feature error mapping runs after the final attempt, and response validation runs later in response-consumption scope. Builder `mapError()` is applied after both execution and consumption have reached a final failure.

Attempt scope runs for every retry:

1. clone the prepared request draft;
2. create the attempt deadline;
3. run `beforeAttempt` hooks;
4. create a fresh `Request`;
5. emit `attempt:start`;
6. run `intercept` hooks until one returns a Response, otherwise call the Transport;
7. run `afterResponse` hooks, passing replacements to later Features;
8. emit the response event and keep the attempt deadline active through final body retention;
9. emit an attempt error when needed, decide whether to retry, and expose the selected backoff delay;
10. wait for backoff before the next attempt.

## Promise-like invariant

Every builder owns one memoized raw execution Promise. All consumers decode clones of the retained response. This provides the following invariant:

```text
one builder instance = at most one Transport execution sequence
```

Calling another fluent method creates a new immutable builder with a separate execution identity.

Builder inputs are snapshotted at declaration time where the Web Platform permits it: URLs, query arrays, status lists, retry policies, and Feature descriptors cannot be mutated later through caller-owned option objects. Stateful adapters such as `Transport`, `CacheStore`, `AbortSignal`, body values, and callback functions remain explicit caller-owned references.

The kernel currently buffers the final response before settling so total timeout includes response consumption and multiple terminal consumers can safely decode the same response. True streaming will require a separate explicit execution path rather than weakening this invariant silently.

## Retry invariant

The public `retry(count)` value is the number of additional retries after the initial request. Internal execution and `meta.attempts` continue to count total attempts.

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

Feature names are unique within a request. Registering the same official policy twice or shadowing it with a custom Feature is rejected before dispatch instead of applying an order-dependent last-write rule.

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

Execution produces one retained raw Response. Each data consumer works on a clone and optionally validates or transforms it through `validate()`. Direct `await` selects automatic decoding. Explicit `asJson()`, `asText()`, `asBlob()` and related terminals select one decoder and return a real Promise. `asResponse()` wraps automatically decoded data with status, headers, and metadata, while `asRaw()` remains outside decoding and validation. A unified builder `mapError()` handles final execution and consumption failures.

This separation prevents an invalid payload from being retried as a network failure and leaves room for consumption-specific telemetry without changing Transport semantics.

## Decisions still open

- license (`Apache-2.0` is a strong candidate because it includes an explicit patent grant);
- supported Node.js LTS matrix at the first public release;
- external schema ecosystem compatibility beyond the current `parse`/`validate` contract;
- cache ownership and revalidation contracts for Next.js;
- true streaming builder semantics;
- external user testing of the data-first thenable contract.
