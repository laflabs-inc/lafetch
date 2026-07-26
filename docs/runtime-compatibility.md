# Runtime compatibility

Lafetch is implemented against Fetch and Web Platform primitives. Runtime support is treated as an executable contract rather than an assumption.

## Automated matrix

| Runtime | Automated evidence | Covered behavior |
| --- | --- | --- |
| Node.js 20, 22, 24 | Vitest and TypeScript build matrix | Kernel, policies, Buffered/Streaming consumption, lifecycle errors |
| Chromium | Vitest Browser Mode with Playwright | Real same-origin Fetch, status retry, AbortSignal, incremental Streaming |
| Workers/Edge | Bundled fixture inside Miniflare/workerd | Browser-target bundle, retry, schema, Web Stream execution in an isolate |
| Next.js App Router | Next.js 16 production build | Buffered and Streaming package consumption in Server, Client, and Route Handler builds |

In addition to the runtime matrix, `pnpm check` packs the publishable files into a tarball, installs it in an empty consumer, executes every public export path, and compiles its declarations without workspace source aliases.

The Next fixture intentionally uses TypeScript 5.9 while the library is developed with TypeScript 7. This catches declaration output that compiles internally but is unusable in a stable consumer toolchain.

The complete browser-facing root export has a hard regression budget of `48 KiB` minified and `16 KiB` gzip. The earlier `36 KiB / 12 KiB gzip` threshold was introduced as an alpha snapshot guard rather than a browser or package-distribution constraint; keeping it only a few bytes above the implementation incorrectly blocked intentional public DX work. The larger ceiling remains a regression alarm, not a size target: reviewed features may move the recorded baseline, while accidental growth still fails CI. The v0.3 Stream DX baseline is `37,318 bytes` minified and `11,895 bytes` gzip; the unified `as(mode)` baseline was `36,633 bytes` minified and `11,679 bytes` gzip, and the previous v0.2.1 baseline was `33,713 bytes` minified and `10,606 bytes` gzip.

## Support boundary

Lafetch requires standard `fetch`, `Request`, `Response`, `Headers`, `AbortController`, `ReadableStream`, `Blob`, and `FormData` implementations. A custom Transport can replace global Fetch, but response consumption still depends on the corresponding Web Platform response types. `response.pipe("text")` additionally uses the runtime's standard `TextDecoderStream`; byte and caller-supplied transform paths do not.

Runtime-specific caching is not silently delegated to Next.js or a platform cache. The Lafetch cache Feature owns its explicit `CacheStore`; a future Next adapter may bridge framework revalidation semantics through a separate optional module.

## CI responsibilities

- The Node matrix runs the complete core suite and Worker isolate test.
- The browser job installs a pinned Playwright dependency and its matching Chromium build.
- The Next job builds Lafetch first, then consumes only its public package exports from the fixture.
- The Node check installs the packed tarball into an isolated consumer and verifies runtime and TypeScript imports for `.`, `./feature`, and `./testing`.
- The core suite fails when the complete browser-facing root export exceeds either bundle budget.
- Native dependency build scripts are limited to the explicitly approved `esbuild`, `workerd`, and `sharp` packages.
