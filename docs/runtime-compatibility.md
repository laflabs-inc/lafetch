# Runtime compatibility

Lafetch is implemented against Fetch and Web Platform primitives. Runtime support is treated as an executable contract rather than an assumption.

## Automated matrix

| Runtime | Automated evidence | Covered behavior |
| --- | --- | --- |
| Node.js 20, 22, 24 | Vitest and TypeScript build matrix | Kernel, policies, errors, response consumption, Worker harness |
| Chromium | Vitest Browser Mode with Playwright | Real same-origin Fetch, headers/query, status retry, AbortSignal mapping |
| Workers/Edge | Bundled fixture inside Miniflare/workerd | Browser-target bundle without Node built-ins, retry and schema execution in an isolate |
| Next.js App Router | Next.js 16 production build | Package self-consumption in Server Components, Client Components, and Route Handlers |

In addition to the runtime matrix, `pnpm check` packs the publishable files into a tarball, installs it in an empty consumer, executes every public export path, and compiles its declarations without workspace source aliases.

The Next fixture intentionally uses TypeScript 5.9 while the library is developed with TypeScript 7. This catches declaration output that compiles internally but is unusable in a stable consumer toolchain.

## Support boundary

Lafetch requires standard `fetch`, `Request`, `Response`, `Headers`, `AbortController`, `ReadableStream`, `Blob`, and `FormData` implementations. A custom Transport can replace global Fetch, but response consumption still depends on the corresponding Web Platform response types.

Runtime-specific caching is not silently delegated to Next.js or a platform cache. The Lafetch cache Feature owns its explicit `CacheStore`; a future Next adapter may bridge framework revalidation semantics through a separate optional module.

## CI responsibilities

- The Node matrix runs the complete core suite and Worker isolate test.
- The browser job installs a pinned Playwright dependency and its matching Chromium build.
- The Next job builds Lafetch first, then consumes only its public package exports from the fixture.
- The Node check installs the packed tarball into an isolated consumer and verifies runtime and TypeScript imports for `.`, `./feature`, and `./testing`.
- Native dependency build scripts are limited to the explicitly approved `esbuild`, `workerd`, and `sharp` packages.
