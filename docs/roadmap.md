# Framework roadmap

The website and interactive playground begin after the framework reaches at least 90% readiness. Current framework readiness is approximately 88%.

## Completed core

- immutable Promise-like request DSL;
- replaceable Fetch-based Transport;
- timeout, abort, retry, backoff, and replay safety;
- Feature capability resolution, lifecycle, ordering, and conflict checks;
- telemetry and safe diagnostic snapshots;
- bounded memory cache and custom store contract;
- in-flight request deduplication;
- idempotency for retryable writes;
- execution and consumption error mapping;
- schema validation and transformation;
- zero-config static requests, reusable client defaults, request options, and fluent policy composition;
- client-scoped cache and deduplication isolation with tenant-aware keys.

## Completed runtime hardening

- Browser integration suite using a real HTTP fixture.
- Workers/Edge compatibility suite executing inside workerd without Node globals.
- Next.js App Router production fixture covering server, client, and Route Handler boundaries.
- Framework-agnostic CacheStore conformance runner for external adapters.
- Browser bundle regression budget for the complete public API.

## Public package readiness

1. Streaming execution RFC and explicit streaming API.
2. Consumption telemetry decision.
3. Standalone packed-consumer and export-condition tests beyond the Next fixture.
4. Tree-shaking and per-entry bundle budgets beyond the complete public API budget.
5. License, package metadata, formal support matrix, and release strategy.

## Website phase

After the framework gate is met:

- documentation site generated from the stable public API;
- browser playground with a safe mock or public fixture Transport;
- copyable DSL recipes and lifecycle visualizer;
- compatibility and bundle-size pages.
