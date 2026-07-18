# Library roadmap

The website and interactive playground begin only after the public library contract passes the release gates below. Readiness is tracked through evidence rather than an approximate percentage.

## Implemented foundation

- explicit client factory and isolated mutable policy state;
- immutable, lazy, Promise-compatible request builder;
- replaceable Fetch-based Transport;
- total timeout, attempt timeout, abort, retry, backoff, and replay safety;
- bounded cache, custom store contract, and in-flight deduplication;
- idempotency, response validation, unified error mapping, and telemetry;
- Feature capability resolution, ordering, lifecycle, and conflicts;
- sensitive diagnostic redaction;
- packed tarball installation, public export, and declaration consumption checks;
- Browser, Node.js, Next.js, and Workers/Edge fixtures.

## v0.2 API stabilization

1. Data-first direct `await` and explicit `response()` envelope.
2. Canonical JSON body, response decoder, validation, timeout, and retry names.
3. Request-only Feature composition and advanced `./feature` entry point.
4. Reduced root export surface and migration documentation.
5. External usage review against the golden examples.

## Public release gates

1. Explicit streaming execution contract and bounded-memory tests.
2. Tree-shaking and per-entry bundle budgets.
3. License, package metadata, support policy, and release automation.
4. Final Node.js and runtime support matrix.

## Website phase

After the release gates pass:

- documentation generated from the stable public API;
- browser playground using a safe fixture Transport;
- copyable recipes and a lifecycle visualizer;
- compatibility and bundle-size pages.
