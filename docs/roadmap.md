# Framework roadmap

The website and interactive playground begin after the framework reaches at least 90% readiness. Current framework readiness is approximately 75–80%.

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
- schema validation and transformation.

## Runtime hardening — next

1. Browser integration suite using a real HTTP fixture.
2. Workers/Edge compatibility suite without Node globals.
3. Next.js App Router fixture covering server and client boundaries.
4. CacheStore conformance tests for external adapters.

## Public package readiness

1. Streaming execution RFC and explicit streaming API.
2. Consumption telemetry decision.
3. Packed-consumer type and export-condition tests.
4. Bundle-size and tree-shaking checks.
5. License, package metadata, support matrix, and release strategy.

## Website phase

After the framework gate is met:

- documentation site generated from the stable public API;
- browser playground with a safe mock or public fixture Transport;
- copyable DSL recipes and lifecycle visualizer;
- compatibility and bundle-size pages.
