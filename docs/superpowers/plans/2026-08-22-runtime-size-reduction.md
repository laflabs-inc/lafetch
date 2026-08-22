# Behavior-Preserving Runtime Size Reduction Plan

> **For Codex:** Execute this plan with `superpowers:subagent-driven-development`, strict TDD, `superpowers:systematic-debugging`, and Ponytail minimalism. Do not raise bundle ceilings or change public behavior.

**Goal:** Recover at least 592 minified bytes from both the complete-root and representative-request bundles so the adaptive-retry branch passes the existing hard bundle budgets.

**Architecture:** Keep adaptive retry and every public surface unchanged. Delete runtime duplication in three existing, statically reachable areas: non-transforming Feature hook dispatch, stable Feature dependency ordering, and closed-string RequestInit validation. These cuts are independent of adaptive retry semantics and affect both measured graphs.

**Tech stack:** TypeScript, Vitest, esbuild bundle-budget tests, pnpm.

**Measured starting point:** complete root `56,904 / 56,320` minified bytes; representative request `45,904 / 45,312`. Functional suites and typecheck are green; only these two budget assertions fail.

**Hard constraints:**

- Preserve every public API, error type/message, hook order, callback receiver, context shape, state/metadata isolation, optional ordering rule, duplicate-edge behavior, and stable original-order tie break.
- Preserve synchronous `shouldRetry` behavior and all adaptive-retry safety gates.
- Do not change bundle thresholds, add dependencies, move public behavior behind a new subpath, or remove features.
- Prefer deletion and shared control flow; do not use opaque code golf.

---

### Task 1: Add semantic locks and remove shared-runtime duplication

**Files:**

- Modify: `tests/features.test.ts`
- Modify: `tests/request-builder.test.ts`
- Modify: `src/core/feature-runtime.ts`
- Modify: `src/core/features.ts`
- Modify: `src/core/validation.ts`

**Interfaces:**

- Consumes: existing `FeatureRuntime`, `resolveFeatures()`, `validateAdvancedRequestInit()`, and unchanged public Feature/RequestInit contracts.
- Produces: the same observable behavior with a smaller emitted runtime graph. No new public symbol.

- [ ] **Step 1: Record the failing size baseline**

Run:

```bash
LAFETCH_PRINT_BUNDLE_SIZE=1 corepack pnpm exec vitest run tests/bundle-budget.test.ts
```

Expected: optional-module budgets pass; complete root reports about `56,904 > 56,320` and representative request about `45,904 > 45,312`.

- [ ] **Step 2: Add focused semantic regression locks before refactoring**

Extend `tests/features.test.ts` with focused tests that prove:

1. Non-transforming hooks execute sequentially in resolved Feature order even when an earlier hook awaits.
2. Hook methods retain their `hooks` object as `this`, and each Feature still receives its own state plus shared request metadata.
3. A thrown non-`HttpError` from each consolidated hook family is labeled with the exact hook name in `HttpFeatureError`.
4. Repeated equivalent ordering edges are deduplicated, independent Features keep registration order, optional missing targets are ignored, and cycle/unknown/self errors retain their current messages.

Use the public request API where practical. Directly import `resolveFeatures()` only for ordering/error-message cases that cannot be observed precisely through a request.

Extend the existing advanced RequestInit test in `tests/request-builder.test.ts` so all five closed-string options are exercised together (`cache`, `mode`, `priority`, `redirect`, `referrerPolicy`) and invalid values still report their exact `requestInit.<key>` label. Do not add production-only testing seams.

Run:

```bash
corepack pnpm exec vitest run tests/features.test.ts tests/request-builder.test.ts
```

Expected: the semantic locks pass against the current implementation.

- [ ] **Step 3: Consolidate non-transforming Feature hook loops**

In `src/core/feature-runtime.ts`, replace only the repeated loops for `emit`, `prepare`, `beforeAttempt`, and `onAttemptError` with one private dispatcher. The dispatcher must:

- walk `this.features` sequentially;
- skip absent hooks;
- build a fresh context per Feature by combining `#context(feature)` with the caller-provided fields;
- invoke the hook as a method of `feature.hooks` so `this` is preserved;
- route failures through the existing `#run(feature, hookName, ...)` function so error mapping is identical.

Keep transforming/reverse/special-case hooks (`intercept`, `afterResponse`, `mapError`, `finalize`) explicit. Avoid a generic abstraction for those distinct flows.

Run:

```bash
corepack pnpm exec vitest run tests/features.test.ts tests/telemetry.test.ts tests/lifecycle.test.ts
```

Expected: all pass.

- [ ] **Step 4: Simplify stable Feature ordering**

In `src/core/features.ts`, replace the parallel outgoing-edge and indegree maps plus repeatedly sorted ready queue with one insertion-ordered map of inbound dependencies.

Required behavior:

- `addEdge(from, to)` performs the same self and unknown-target validation, then adds `from` to `to`'s dependency `Set`; duplicate edges remain idempotent.
- Repeatedly select the first still-pending Feature in original registration order whose dependency names are no longer pending.
- If none can be selected, report the remaining names in original order using the existing cycle message.
- Keep capability validation and the frozen returned array unchanged.

The intended O(F²) scan is acceptable because Feature lists are small and it deletes more state/queue machinery.

Run:

```bash
corepack pnpm exec vitest run tests/features.test.ts tests/request-builder.test.ts
```

Expected: all pass, including new duplicate-edge/stability/message locks.

- [ ] **Step 5: Consolidate closed-string RequestInit option validation**

In `validateAdvancedRequestInit()` in `src/core/validation.ts`, introduce one local helper that preserves the base access pattern: read a named option once when it is `undefined`, or read it again before calling `closedString()` when it is defined. Keep the allowed set and exact `requestInit.<key>` label unchanged. Use it only for `cache`, `mode`, `priority`, `redirect`, and `referrerPolicy`.

Keep the result assembly, `integrity`/`keepalive`/`referrer` handling, unknown-key rejection, and `only-if-cached` combination validation unchanged.

Run:

```bash
corepack pnpm exec vitest run tests/public-api-runtime.test.js tests/request-builder.test.ts
```

Expected: all pass.

- [ ] **Step 6: Prove the unchanged bundle ceilings pass**

Run:

```bash
LAFETCH_PRINT_BUNDLE_SIZE=1 corepack pnpm exec vitest run tests/bundle-budget.test.ts
```

Expected: all five bundle tests pass. Both complete root and representative request must be at or below their existing minified ceilings. If either remains over budget, stop and report exact measurements; do not change thresholds or add a fourth speculative refactor.

- [ ] **Step 7: Run full verification**

Run:

```bash
corepack pnpm exec vitest run tests/features.test.ts tests/request-builder.test.ts tests/public-api-runtime.test.js tests/retry.test.ts tests/telemetry.test.ts tests/idempotency.test.ts tests/streaming.test.ts tests/lifecycle.test.ts
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
git diff --check
```

Expected: every functional test, full suite, typecheck, lint, and diff check passes; bundle ceilings remain unchanged.

- [ ] **Step 8: Commit the behavior-preserving reduction**

```bash
git add src/core/feature-runtime.ts src/core/features.ts src/core/validation.ts tests/features.test.ts tests/request-builder.test.ts docs/superpowers/plans/2026-08-22-runtime-size-reduction.md
git commit -m "refactor: recover runtime bundle headroom"
```

Report the before/after root and representative sizes, deleted source lines, tests, commit SHA, and any concern.
