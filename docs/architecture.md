# Kernel architecture

## Public model

```text
LafetchClient
  -> immutable RequestBuilder
    -> normalized RequestConfiguration
      -> Feature resolver
        -> request / attempt lifecycle
          -> Transport
```

The fluent chain is declarative. Chain order does not wrap nested middleware and does not define runtime order. The executor resolves a stable lifecycle plan before dispatch.

## Execution scopes

Request scope runs once:

1. normalize URL, query, headers, and body source;
2. resolve Feature capabilities and ordering;
3. prepare the base request draft;
4. create the total deadline and request metadata;
5. settle the final result and run finalizers.

Attempt scope runs for every retry:

1. clone the prepared request draft;
2. create the attempt deadline;
3. run `beforeAttempt` hooks;
4. create a fresh `Request`;
5. call the Transport;
6. observe the response or attempt error;
7. decide whether to retry and wait for backoff.

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

The resolver validates required and conflicting capabilities, constructs a graph from `before` and `after`, and applies a stable topological sort. Finalizers run in reverse resolved order.

## Security defaults

- status outside `200–299` is an error unless explicitly accepted;
- unsafe methods are not retried by default;
- request bodies are never included in diagnostics;
- credential headers and token-like query values are redacted;
- transport and Feature conflicts fail before network dispatch.

## Decisions still open

- final package and repository name availability;
- license (`Apache-2.0` is a strong candidate because it includes an explicit patent grant);
- supported Node.js LTS matrix at the first public release;
- schema compatibility contract;
- cache ownership contract for Next.js;
- true streaming builder semantics;
- whether `RequestBuilder` should remain thenable after external user testing.

