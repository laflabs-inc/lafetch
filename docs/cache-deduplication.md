# Cache and deduplication policy

Cache and deduplication solve different timing problems and are separate Features.

- Cache reuses a completed response until its TTL expires.
- Deduplication shares only an in-flight execution.

They can be composed on one request. Cache is ordered before deduplication when both official Features are installed.

## Safe defaults

Both policies default to GET and HEAD. They bypass requests whose credentials mode is not `omit` or whose headers contain authorization, cookies, proxy authorization, or API keys.

The built-in cache stores status 200 by default and refuses responses containing `Set-Cookie`, restrictive `Cache-Control`, or `Vary`. Refusing arbitrary `Vary` is conservative: a future variant-aware store can opt into a richer key contract without risking a cross-variant response today.

Unsafe methods require a caller-owned key. A key is a trust boundary; callers must include every value that changes response identity.

## Store contract

`CacheStore` is asynchronous-compatible and stores a Response plus an absolute expiry time. Implementations must return independently consumable Response instances. `MemoryCacheStore` clones entries, expires lazily, and uses bounded least-recently-used eviction.

Runtime-specific stores should be tested for clone isolation, expiry, concurrent reads and writes, bounded storage or external eviction, and safe failure behavior.

The `@laflabs/lafetch/testing` export provides `runCacheStoreConformance()`. It is framework-agnostic and currently checks round-trip behavior, independently consumable response clones, and optional deletion. Adapter projects can translate its result objects into their own test framework assertions.

## Deduplication ownership

The first matching request is the leader. Followers await its retained response but keep their own abort and timeout signals. Aborting a follower never cancels the leader. If a leader ends through abort or timeout, an active follower may fall back to its own Transport execution.

Deduplication covers the leader's whole retry sequence rather than one individual attempt.
