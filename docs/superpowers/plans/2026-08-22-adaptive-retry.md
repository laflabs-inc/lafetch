# Adaptive Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a synchronous `shouldRetry` predicate that can extend or stop Lafetch's default failure retry decision without bypassing method, timeout, server-delay, or Body ownership gates.

**Architecture:** Keep the existing `.retry()` configuration and Executor loop. Add one public discriminated context type, snapshot and validate the callback with existing Retry options, and compose its tri-state result inside the current Response and normalized-error branches before the existing delay and Telemetry code.

**Tech Stack:** TypeScript 7, Fetch/Web Platform APIs, Vitest 4, pnpm 10

**Spec:** `docs/superpowers/specs/2026-08-22-adaptive-retry-design.md`

## Global Constraints

- `shouldRetry` is synchronous and returns only `boolean | undefined`.
- Evaluate Retry count and method/idempotency gates before invoking the predicate.
- Never invoke the predicate for accepted Responses, Abort, total Timeout, configuration, Feature, decoding, schema, or Body consumption errors.
- Never expose raw `Request`, `Response`, Header, or Body values to the predicate.
- A `true` decision cannot bypass `Retry-After` above `maxRetryAfter`, non-replayable Body checks, or Streaming ownership.
- Keep forced Retry, Response replacement, async predicates, custom delay callbacks, RateLimit parsing, and Feature/Transport attempt hooks out of v0.4.
- Add no dependency and preserve current bundle ceilings.

## File Map

- `src/core/types.ts`: define `RetryDecisionContext` and add `RetryOptions.shouldRetry`.
- `src/index.ts`: export the new root package type.
- `src/core/validation.ts`: reject non-function predicate configuration.
- `src/core/config.ts`: preserve the callback reference in the immutable Retry option snapshot.
- `src/core/executor.ts`: normalize the callback and compose its result in Response and safe-error Retry branches.
- `tests/api-conventions.test.ts`: lock the public TypeScript contract and sync-only return type.
- `tests/public-api-runtime.test.js`: lock JavaScript declaration-time validation.
- `tests/retry.test.ts`: cover Response/error tri-state decisions, gates, invalid results, cancellation, and callback invocation count.
- `tests/telemetry.test.ts`: prove Telemetry reports the final predicate decision without a schema change.
- `README.md`, `docs/advanced-usage.md`, `docs/architecture.md`, `docs/rfcs/v0.4-retry-decision.md`, `docs/roadmap.md`, `docs/improvements.md`: publish the contract and close the v0.4 roadmap item while retaining forced Retry in v0.5.

---

### Task 1: Public Retry Decision Contract

**Files:**
- Modify: `src/core/types.ts:34-41,120-126`
- Modify: `src/index.ts:67-84`
- Modify: `src/core/validation.ts:178-202`
- Modify: `src/core/config.ts:32-42`
- Test: `tests/api-conventions.test.ts:1-100`
- Test: `tests/public-api-runtime.test.js:5-95`

**Interfaces:**
- Consumes: existing `RequestEventErrorSnapshot` and `RetryOptions` in `src/core/types.ts`.
- Produces: `RetryDecisionContext` and `RetryOptions.shouldRetry?: (context: RetryDecisionContext) => boolean | undefined` for the Executor tasks.

- [ ] **Step 1: Write the failing TypeScript contract checks**

Add `RetryDecisionContext` to the type imports in `tests/api-conventions.test.ts`, then add these compile-time checks inside the existing `if (false)` block:

```ts
const shouldRetry = (context: RetryDecisionContext): boolean | undefined => {
  if (context.reason === "response") {
    expectTypeOf(context.status).toEqualTypeOf<number>();
    return context.status === 409 ? true : undefined;
  }
  expectTypeOf(context.error.code).toEqualTypeOf<string | undefined>();
  return false;
};
api.get("/users").retry(2, { shouldRetry });

// @ts-expect-error Retry predicates are deliberately synchronous in v0.4.
api.get("/users").retry(2, { shouldRetry: async () => true });
```

- [ ] **Step 2: Write the failing JavaScript validation checks**

Add this entry to `invalidConfigurations` in `tests/public-api-runtime.test.js`:

```js
() => api.get("/users").retry(2, { shouldRetry: true }),
```

Add this assertion to the documented Retry values test:

```js
expect(() => api.get("/resource").retry(1, {
  shouldRetry: () => undefined,
})).not.toThrow();
```

- [ ] **Step 3: Run the focused checks and verify they fail**

Run:

```bash
corepack pnpm typecheck
corepack pnpm exec vitest run tests/api-conventions.test.ts tests/public-api-runtime.test.js
```

Expected: typecheck fails because `RetryDecisionContext` and `shouldRetry` do not exist; the JavaScript test also shows the non-function value is not rejected.

- [ ] **Step 4: Add the public type and option**

Add this before `RetryOptions` in `src/core/types.ts`:

```ts
export type RetryDecisionContext =
  | {
      readonly reason: "response";
      readonly attempt: number;
      readonly method: string;
      readonly status: number;
    }
  | {
      readonly reason: "error";
      readonly attempt: number;
      readonly method: string;
      readonly error: RequestEventErrorSnapshot;
    };
```

Add this field to `RetryOptions`:

```ts
readonly shouldRetry?: (context: RetryDecisionContext) => boolean | undefined;
```

Add `RetryDecisionContext` beside `RetryOptions` in the `src/index.ts` type export list.

- [ ] **Step 5: Validate and snapshot the callback**

Add this check in `validateRetryOptions()` before Backoff validation:

```ts
if (value.shouldRetry !== undefined && typeof value.shouldRetry !== "function") {
  throw new HttpConfigurationError("retry.shouldRetry must be a function.");
}
```

Add this property to the object returned by `snapshotRetryOptions()`:

```ts
...(options.shouldRetry !== undefined ? { shouldRetry: options.shouldRetry } : {}),
```

- [ ] **Step 6: Run focused and full contract checks**

Run:

```bash
corepack pnpm typecheck
corepack pnpm exec vitest run tests/api-conventions.test.ts tests/public-api-runtime.test.js
```

Expected: typecheck and both test files pass.

- [ ] **Step 7: Commit the public contract**

```bash
git add src/core/types.ts src/index.ts src/core/validation.ts src/core/config.ts tests/api-conventions.test.ts tests/public-api-runtime.test.js
git commit -m "feat: add retry decision contract"
```

---

### Task 2: Response Predicate Decisions and Safety Gates

**Files:**
- Modify: `src/core/executor.ts:25-47,65-91,220-222,299-310,704-725`
- Test: `tests/retry.test.ts:13-270`

**Interfaces:**
- Consumes: `RetryDecisionContext` and `RetryOptions.shouldRetry` from Task 1.
- Produces: internal `retryDecision(retry, defaultDecision, context): boolean` and Response-path tri-state behavior for Task 3 to reuse.

- [ ] **Step 1: Write failing tests for default, stop, and extend behavior**

Add three focused cases to `tests/retry.test.ts`:

```ts
it("uses the default status policy when shouldRetry returns undefined", async () => {
  let attempt = 0;
  const api = lafetch.create({
    baseUrl: "https://api.example.com",
    transport: mockTransport(() => ++attempt === 1
      ? new Response("unavailable", { status: 503 })
      : success()),
  });

  await expect(api.get("/health").retry(1, {
    ...noDelay,
    shouldRetry: () => undefined,
  })).resolves.toHaveProperty("meta.attempts", 2);
});

it("lets shouldRetry stop a default status retry", async () => {
  const transport = mockTransport(() => new Response("unavailable", { status: 503 }));
  const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

  await expect(api.get("/health").retry(2, {
    ...noDelay,
    shouldRetry: () => false,
  })).rejects.toMatchObject({ code: "ERR_HTTP_STATUS", status: 503 });
  expect(transport.calls).toHaveLength(1);
});

it("lets shouldRetry add a non-default rejected status", async () => {
  let attempt = 0;
  const contexts: unknown[] = [];
  const api = lafetch.create({
    baseUrl: "https://api.example.com",
    transport: mockTransport(() => ++attempt < 3
      ? new Response("conflict", { status: 409 })
      : success()),
  });

  await expect(api.get("/jobs/1").retry(2, {
    ...noDelay,
    shouldRetry: (context) => {
      contexts.push(context);
      return context.reason === "response" && context.status === 409 ? true : undefined;
    },
  })).resolves.toHaveProperty("meta.attempts", 3);
  expect(contexts).toEqual([
    { reason: "response", attempt: 1, method: "GET", status: 409 },
    { reason: "response", attempt: 2, method: "GET", status: 409 },
  ]);
  expect(Object.isFrozen(contexts[0])).toBe(true);
});
```

- [ ] **Step 2: Write failing tests for method, acceptance, and attempt gates**

Add these gate checks:

```ts
it("applies the method gate before shouldRetry", async () => {
  const predicate = vi.fn(() => true);
  const transport = mockTransport(() => new Response("unavailable", { status: 503 }));
  const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

  await expect(api.post("/jobs").json({ task: "x" }).retry(2, {
    ...noDelay,
    shouldRetry: predicate,
  })).rejects.toMatchObject({ status: 503 });
  expect(predicate).not.toHaveBeenCalled();
  expect(transport.calls).toHaveLength(1);
});

it("allows an idempotent write to reach shouldRetry", async () => {
  const attempts: number[] = [];
  let call = 0;
  const api = lafetch.create({
    baseUrl: "https://api.example.com",
    transport: mockTransport(() => ++call === 1
      ? new Response("conflict", { status: 409 })
      : success()),
  });

  await api.post("/jobs").idempotency({ key: "stable" }).retry(1, {
    ...noDelay,
    shouldRetry: (context) => {
      attempts.push(context.attempt);
      return true;
    },
  });
  expect(attempts).toEqual([1]);
});

it("allows an explicitly configured write method to reach shouldRetry", async () => {
  const predicate = vi.fn(() => true);
  let call = 0;
  const api = lafetch.create({
    baseUrl: "https://api.example.com",
    transport: mockTransport(() => ++call === 1
      ? new Response("conflict", { status: 409 })
      : success()),
  });

  await api.post("/jobs").retry(1, {
    ...noDelay,
    methods: ["POST"],
    shouldRetry: predicate,
  });
  expect(predicate).toHaveBeenCalledTimes(1);
});

it("does not call shouldRetry for accepted responses or exhausted attempts", async () => {
  const predicate = vi.fn(() => true);
  const acceptedApi = lafetch.create({
    baseUrl: "https://api.example.com",
    transport: mockTransport(() => new Response(null, { status: 204 })),
  });

  await acceptedApi.get("/health").retry(2, { ...noDelay, shouldRetry: predicate });
  const exhaustedApi = lafetch.create({
    baseUrl: "https://api.example.com",
    transport: mockTransport(() => new Response("unavailable", { status: 503 })),
  });
  await expect(exhaustedApi.get("/health").retry(0, {
    ...noDelay,
    shouldRetry: predicate,
  })).rejects.toMatchObject({ status: 503 });
  expect(predicate).not.toHaveBeenCalled();
});
```

Also add `shouldRetry: () => true` to the existing `Retry-After`-above-ceiling test. Its existing assertions of one Transport call and no sleep prove that a positive predicate cannot override `maxRetryAfter`.

Import `vi` from Vitest for the spy assertions.

- [ ] **Step 3: Write failing tests for predicate errors and Body cancellation**

```ts
it("maps response predicate failures to configuration errors and cancels the body", async () => {
  let cancelled = 0;
  const body = new ReadableStream({ cancel() { cancelled += 1; } });
  const api = lafetch.create({
    baseUrl: "https://api.example.com",
    transport: mockTransport(() => new Response(body, { status: 503 })),
  });

  await expect(api.get("/health").retry(1, {
    ...noDelay,
    shouldRetry: () => { throw new Error("predicate failed"); },
  })).rejects.toMatchObject({ code: "ERR_HTTP_CONFIGURATION" });
  expect(cancelled).toBe(1);
});

it.each([
  ["Promise", () => Promise.resolve(true)],
  ["string", () => "yes"],
])("rejects a %s response predicate result", async (_label, shouldRetry) => {
  const api = lafetch.create({
    baseUrl: "https://api.example.com",
    transport: mockTransport(() => new Response("unavailable", { status: 503 })),
  });

  await expect(api.get("/health").retry(1, {
    ...noDelay,
    shouldRetry: shouldRetry as never,
  })).rejects.toMatchObject({ code: "ERR_HTTP_CONFIGURATION" });
});
```

- [ ] **Step 4: Run the focused tests and verify they fail**

Run:

```bash
corepack pnpm exec vitest run tests/retry.test.ts
```

Expected: new tests fail because the callback is stored but not normalized or invoked.

- [ ] **Step 5: Normalize and evaluate the predicate**

Import `RetryDecisionContext` in `src/core/executor.ts`, add this field to `NormalizedRetry`, and populate it in `normalizeRetry()`:

```ts
readonly shouldRetry?: RetryOptions["shouldRetry"];
```

```ts
...(options.shouldRetry !== undefined ? { shouldRetry: options.shouldRetry } : {}),
```

Add this helper beside `canRetry()`:

```ts
function retryDecision(
  retry: NormalizedRetry,
  defaultDecision: boolean,
  context: RetryDecisionContext,
): boolean {
  if (!retry.shouldRetry) return defaultDecision;
  let decision: unknown;
  try {
    decision = retry.shouldRetry(Object.freeze(context));
  } catch (cause) {
    throw new HttpConfigurationError(
      "retry.shouldRetry() failed while evaluating an attempt.",
      { cause },
    );
  }
  if (decision !== undefined && typeof decision !== "boolean") {
    throw new HttpConfigurationError(
      "retry.shouldRetry() must return a boolean or undefined.",
    );
  }
  return decision ?? defaultDecision;
}
```

- [ ] **Step 6: Compose the Response decision after safety gates**

Replace the existing `retryEligible` calculation in the Response branch with:

```ts
let retryEligible = false;
if (!accepted && canRetry(retry, attemptDraft.method, attempt)) {
  try {
    retryEligible = retryDecision(
      retry,
      retry.statuses.has(response.status),
      {
        reason: "response",
        attempt,
        method: attemptDraft.method,
        status: response.status,
      },
    );
  } catch (error) {
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }
}
```

Leave `retryDelay()`, `Retry-After` handling, `reportAttemptError()`, Body cancellation on successful Retry, and the final status path unchanged.

- [ ] **Step 7: Run the focused and adjacent suites**

Run:

```bash
corepack pnpm exec vitest run tests/retry.test.ts tests/idempotency.test.ts tests/streaming.test.ts
corepack pnpm typecheck
```

Expected: all focused tests and typecheck pass; existing Streaming and Idempotency behavior remains green.

- [ ] **Step 8: Commit the Response decision path**

```bash
git add src/core/executor.ts tests/retry.test.ts
git commit -m "feat: add adaptive status retry decisions"
```

---

### Task 3: Error Decisions and Telemetry

**Files:**
- Modify: `src/core/executor.ts:798-819`
- Test: `tests/retry.test.ts:271-428`
- Test: `tests/telemetry.test.ts:1-120`

**Interfaces:**
- Consumes: `retryDecision()` from Task 2 and existing `snapshotError()`/`reportAttemptError()` helpers.
- Produces: tri-state decisions for `HttpTransportError` and attempt `HttpTimeoutError`, with unchanged attempt Telemetry schema.

- [ ] **Step 1: Write failing Transport decision tests**

Add these tests to `tests/retry.test.ts`:

```ts
it("lets shouldRetry override disabled network retries", async () => {
  let attempt = 0;
  const contexts: unknown[] = [];
  const api = lafetch.create({
    baseUrl: "https://api.example.com",
    transport: mockTransport(() => {
      if (++attempt === 1) throw new TypeError("offline");
      return success();
    }),
  });

  await expect(api.get("/health").retry(1, {
    ...noDelay,
    networkErrors: false,
    shouldRetry: (context) => {
      contexts.push(context);
      return true;
    },
  })).resolves.toHaveProperty("meta.attempts", 2);
  expect(contexts).toMatchObject([{
    reason: "error",
    attempt: 1,
    method: "GET",
    error: { code: "ERR_HTTP_TRANSPORT" },
  }]);
});

it("lets shouldRetry stop a default network retry", async () => {
  const transport = mockTransport(() => { throw new TypeError("offline"); });
  const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

  await expect(api.get("/health").retry(2, {
    ...noDelay,
    shouldRetry: () => false,
  })).rejects.toMatchObject({ code: "ERR_HTTP_TRANSPORT" });
  expect(transport.calls).toHaveLength(1);
});
```

- [ ] **Step 2: Write failing Timeout and terminal-cancellation gate tests**

```ts
it("lets shouldRetry stop an attempt timeout", async () => {
  const predicate = vi.fn(() => false);
  const transport = mockTransport((_request, context) => new Promise((_resolve, reject) => {
    context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
  }));
  const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

  await expect(api.get("/health").attemptTimeout("10ms").retry(2, {
    ...noDelay,
    shouldRetry: predicate,
  })).rejects.toMatchObject({ code: "ERR_HTTP_TIMEOUT", scope: "attempt" });
  expect(predicate).toHaveBeenCalledTimes(1);
  expect(transport.calls).toHaveLength(1);
});

it("does not invoke shouldRetry for total timeout or caller abort", async () => {
  const predicate = vi.fn(() => true);
  const pendingTransport = () => mockTransport((_request, context) => new Promise((_resolve, reject) => {
    context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
  }));
  const timeoutApi = lafetch.create({
    baseUrl: "https://api.example.com",
    transport: pendingTransport(),
  });

  await expect(timeoutApi.get("/timeout").timeout("10ms").retry(1, {
    ...noDelay,
    shouldRetry: predicate,
  })).rejects.toMatchObject({ code: "ERR_HTTP_TIMEOUT", scope: "total" });

  const controller = new AbortController();
  const abortApi = lafetch.create({
    baseUrl: "https://api.example.com",
    transport: pendingTransport(),
  });
  const abortedRequest = abortApi.get("/abort").signal(controller.signal).retry(1, {
    ...noDelay,
    shouldRetry: predicate,
  });
  setTimeout(() => controller.abort("caller cancelled"), 0);
  await expect(abortedRequest).rejects.toMatchObject({ code: "ERR_HTTP_ABORTED" });
  expect(predicate).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Write Telemetry decision tests**

Add these cases to `tests/telemetry.test.ts`:

```ts
it("reports a custom network retry as the final attempt decision", async () => {
  const events: RequestEvent[] = [];
  let attempt = 0;
  const transport = mockTransport(() => {
    if (++attempt === 1) throw new TypeError("offline");
    return Response.json({ ok: true });
  });
  const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

  await api.get("/health").retry(1, {
    backoff: { type: "fixed", base: 0, jitter: "none" },
    networkErrors: false,
    shouldRetry: () => true,
  }).telemetry((event) => { events.push(event); });

  expect(events.find((event) => event.type === "attempt:error")).toMatchObject({
    attempt: 1,
    willRetry: true,
    retryDelayMs: 0,
    error: { code: "ERR_HTTP_TRANSPORT" },
  });
  expect(transport.calls).toHaveLength(2);
});

it("reports a predicate veto as the final attempt decision", async () => {
  const events: RequestEvent[] = [];
  const transport = mockTransport(() => new Response("unavailable", { status: 503 }));
  const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

  await expect(api.get("/health").retry(1, {
    backoff: { type: "fixed", base: 0, jitter: "none" },
    shouldRetry: () => false,
  }).telemetry((event) => { events.push(event); }))
    .rejects.toMatchObject({ code: "ERR_HTTP_STATUS" });

  expect(events.find((event) => event.type === "attempt:error")).toMatchObject({
    attempt: 1,
    willRetry: false,
    error: { code: "ERR_HTTP_STATUS", status: 503 },
  });
  expect(transport.calls).toHaveLength(1);
});
```

- [ ] **Step 4: Run focused tests and verify the error-path failures**

Run:

```bash
corepack pnpm exec vitest run tests/retry.test.ts tests/telemetry.test.ts
```

Expected: Transport, attempt Timeout, and custom-network Telemetry tests fail because the catch branch still uses only the default decision. The Response Telemetry veto test may already pass from Task 2 and serves as a regression lock.

- [ ] **Step 5: Compose safe normalized errors with the predicate**

In the Executor catch block, replace the current `willRetry` calculation with this shape:

```ts
const retryableFailure =
  (error instanceof HttpTransportError && retry.networkErrors)
  || (error instanceof HttpTimeoutError && error.scope === "attempt");
const safeFailure =
  error instanceof HttpTransportError
  || (error instanceof HttpTimeoutError && error.scope === "attempt");
let willRetry = false;
if (safeFailure && canRetry(retry, attemptDraft.method, attempt)) {
  try {
    willRetry = retryDecision(retry, retryableFailure, {
      reason: "error",
      attempt,
      method: attemptDraft.method,
      error: snapshotError(error),
    });
  } catch (decisionError) {
    const normalizedDecisionError = ensureError(decisionError, request);
    await reportAttemptError(featureRuntime, config, {
      ...(request !== undefined ? { request } : {}),
      error: normalizedDecisionError,
      attempt,
      willRetry: false,
    });
    throw normalizedDecisionError;
  }
}
```

Keep the existing delay calculation, attempt report, Abort/total Timeout terminal guard, and cancellable sleep after this block.

- [ ] **Step 6: Verify predicate failures in the normalized-error branch**

Add this test to `tests/retry.test.ts`:

```ts
it("maps error predicate failures to configuration errors without retrying", async () => {
  const transport = mockTransport(() => { throw new TypeError("offline"); });
  const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

  await expect(api.get("/health").retry(2, {
    ...noDelay,
    shouldRetry: () => { throw new Error("predicate failed"); },
  })).rejects.toMatchObject({ code: "ERR_HTTP_CONFIGURATION" });
  expect(transport.calls).toHaveLength(1);
});
```

Add this case to `tests/telemetry.test.ts` so the predicate failure itself is observable without being reclassified as Transport failure:

```ts
it("reports predicate failures as non-retryable configuration errors", async () => {
  const events: RequestEvent[] = [];
  const transport = mockTransport(() => { throw new TypeError("offline"); });
  const api = lafetch.create({ baseUrl: "https://api.example.com", transport });

  await expect(api.get("/health").retry(1, {
    backoff: { type: "fixed", base: 0, jitter: "none" },
    shouldRetry: () => { throw new Error("predicate failed"); },
  }).telemetry((event) => { events.push(event); }))
    .rejects.toMatchObject({ code: "ERR_HTTP_CONFIGURATION" });

  expect(events.find((event) => event.type === "attempt:error")).toMatchObject({
    attempt: 1,
    willRetry: false,
    error: { code: "ERR_HTTP_CONFIGURATION" },
  });
  expect(transport.calls).toHaveLength(1);
});
```

- [ ] **Step 7: Run Retry, Telemetry, lifecycle, and full tests**

Run:

```bash
corepack pnpm exec vitest run tests/retry.test.ts tests/telemetry.test.ts tests/lifecycle.test.ts tests/streaming.test.ts
corepack pnpm test
corepack pnpm typecheck
```

Expected: all 18 or more test files pass, the total test count exceeds the 233-test baseline, and typecheck passes.

- [ ] **Step 8: Commit error decisions and Telemetry coverage**

```bash
git add src/core/executor.ts tests/retry.test.ts tests/telemetry.test.ts
git commit -m "feat: apply adaptive retry to attempt errors"
```

---

### Task 4: Documentation, Roadmap Closure, and Release Gates

**Files:**
- Modify: `README.md:227-245,330-340`
- Modify: `docs/advanced-usage.md:270-310`
- Modify: `docs/architecture.md:157-175`
- Modify: `docs/rfcs/v0.4-retry-decision.md:1-95`
- Modify: `docs/roadmap.md:12-105`
- Modify: `docs/improvements.md:255-345`

**Interfaces:**
- Consumes: the completed `RetryDecisionContext` and `RetryOptions.shouldRetry` behavior from Tasks 1-3.
- Produces: one documented v0.4 contract and an unambiguous v0.5 forced-Retry boundary.

- [ ] **Step 1: Update the Retry RFC from pending to implemented contract**

Change the RFC state to `server-directed delay와 custom failure predicate 구현 완료`. Replace the pending custom predicate section with the approved tri-state table and these explicit boundaries:

```md
- Retry count와 method·idempotency gate 뒤에서만 predicate를 호출합니다.
- `true`는 non-accepted status와 안전한 attempt 오류의 기본 결정을 확장합니다.
- `false`는 기본 Retry를 중단하고 `undefined`는 기본 정책을 유지합니다.
- accepted Response, raw Body, Abort와 total Timeout은 predicate 입력이나 강제 Retry 대상이 아닙니다.
- forced Retry와 Response 교체는 v0.5 Feature·Transport SDK에 유지합니다.
```

- [ ] **Step 2: Add one public usage example and architecture order**

Add this example to the Retry section in `docs/advanced-usage.md` and a shorter equivalent near the README Retry table:

```ts
await api.get<Job>("/jobs/1").retry(2, {
  shouldRetry: (context) =>
    context.reason === "response" && context.status === 409
      ? true
      : undefined,
});
```

Document that the callback is synchronous, `false` vetoes, `undefined` preserves defaults, and raw Response Body is unavailable. In `docs/architecture.md`, record the order as `count → method/idempotency → predicate → Retry-After/Backoff → Telemetry`.

- [ ] **Step 3: Close v0.4 and preserve v0.5 scope**

Make these exact roadmap changes:

- Mark `custom Retry predicate의 method·idempotency gate — 구현 완료` under v0.4 Reliability.
- Keep `Request·Response attempt 교체와 forced Retry — v0.5 Feature·Transport SDK 유지` under explicit exclusions.
- Change the current status table from `adaptive Retry 강화 진행 중` to `adaptive Retry 구현 완료`.
- Change `다음 단계` to `v0.5 Feature와 Transport SDK`.
- Update README's current status to name v0.5 as the next design stage.
- Update COMP-05 in `docs/improvements.md` to say the safe failure predicate is complete and response-content/forced Retry remains v0.5.

- [ ] **Step 4: Check documentation consistency**

Run:

```bash
rg -n "custom Retry|shouldRetry|forced Retry|다음 단계|adaptive Retry" README.md docs
git diff --check
```

Expected: every current document describes the tri-state predicate as implemented, every forced Retry reference points to v0.5, and no current-state text still calls the predicate pending.

- [ ] **Step 5: Run all executable quality gates**

Run:

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:package
corepack pnpm test:worker
corepack pnpm build
corepack pnpm --filter @laflabs/lafetch-next-fixture build
```

Expected: typecheck, all unit tests, ESM/declaration build, packed package consumption, Worker runtime, and Next.js production build pass.

- [ ] **Step 6: Attempt the Chromium runtime gate**

Run:

```bash
corepack pnpm test:browser
```

Expected in a complete host: browser tests pass. On the current host, if Chromium still cannot load `libatk-1.0.so.0`, record that exact environment blocker and do not classify it as a test assertion failure or install system packages without approval.

- [ ] **Step 7: Inspect the complete patch**

Run:

```bash
git status --short
git diff --check
git diff --stat origin/main
git diff origin/main -- src tests README.md docs
```

Expected: only the planned source, test, and documentation files differ; `graphify-out/` is absent from this worktree and from the patch.

- [ ] **Step 8: Commit documentation and roadmap closure**

```bash
git add README.md docs/advanced-usage.md docs/architecture.md docs/rfcs/v0.4-retry-decision.md docs/roadmap.md docs/improvements.md
git commit -m "docs: complete adaptive retry roadmap"
```

- [ ] **Step 9: Verify branch state**

Run:

```bash
git status --short --branch
git log --oneline --decorate origin/main..HEAD
```

Expected: a clean `feat/adaptive-retry` worktree containing the design, public contract, status decision, error decision, and documentation commits.
