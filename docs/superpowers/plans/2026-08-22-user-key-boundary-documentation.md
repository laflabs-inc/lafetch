# User Key Boundary Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the v0.4 user-key tenant and authentication documentation milestone without changing runtime behavior.

**Architecture:** Extend the existing Cache and Deduplication policy guide as the single source of truth, then align the roadmap and README status summaries. Reuse the implemented `RequestKey` contract and existing security tests; add no API, source file, or duplicate test.

**Tech Stack:** Markdown, TypeScript examples, Git

**Spec:** `docs/superpowers/specs/2026-08-22-user-key-boundary-documentation-design.md`

## Global Constraints

- Do not change the public API, runtime behavior, or tests.
- A user key never enables Cache or Deduplication for a credential-, token-, or signed-URL-bearing request.
- Examples must include tenant and response identity, never an authentication token.
- Do not add key hashing, namespacing APIs, or adaptive Retry work.

## Roadmap Audit Snapshot

- Verified locally: TypeScript, 18 test files with 233 tests, build, packed-package consumption, Worker runtime, and Next.js production build.
- Chromium test code exists, but this host cannot launch Chromium because `libatk-1.0.so.0` is unavailable; this is an environment limitation, not a test assertion failure.
- Implemented with regression coverage: CacheStore reliability, invalidation/revalidation, HTTP freshness, leader/follower cancellation, request identity isolation, optional policy bundles, logical lifecycle, and server-directed Retry delay.
- Documentation-only gap: user key tenant and authentication responsibilities.
- Designed but unimplemented: custom Retry predicate. `RetryOptions` exposes no predicate and the Retry RFC defines only safety constraints.
- Roadmap inconsistency to resolve in the next Retry design: forced Retry is listed in v0.4 Reliability scope but explicitly deferred to the v0.5 Feature/Transport SDK.

---

### Task 1: Close the user-key documentation milestone

**Files:**
- Modify: `docs/cache-deduplication.md:18-36`
- Modify: `docs/roadmap.md:24-31,67-75`
- Modify: `README.md:332-338`

**Interfaces:**
- Consumes: existing `RequestKey = string | ((request: Request) => string | Promise<string>)` behavior from `src/features/request-key.ts`
- Produces: documentation contract only; no TypeScript interface changes

- [ ] **Step 1: Add the tenant-boundary guidance and safe example**

Insert the following section after the existing key callback paragraph in `docs/cache-deduplication.md`:

````markdown
### 사용자 key와 tenant 경계

사용자 key는 내장 method·URL·Header identity를 대체합니다. 따라서 tenant, locale, content negotiation과 Body처럼 Response를 바꾸는 application identity는 호출자가 직접 포함해야 합니다. Fetch 실행 정책은 Lafetch가 계속 덧붙이지만 누락된 application identity를 추론하지 않습니다.

```ts
const tenantId = "tenant-a";

await api
  .get("/catalog")
  .header("X-Tenant", tenantId)
  .header("Accept", "application/json")
  .cache("5m", {
    store,
    key: (request) => [
      "catalog-v1",
      tenantId,
      request.method,
      request.url,
      request.headers.get("accept") ?? "",
    ].join("\n"),
  });
```

외부 `CacheStore`를 여러 client가 공유하면 위 namespace와 tenant 분리가 Store 전체의 신뢰 경계가 됩니다. 같은 책임은 한 client 안에서 사용자 Deduplication key를 사용할 때도 적용됩니다.

credential, token 또는 signed URL처럼 민감한 요청은 사용자 key가 있어도 Cache와 Deduplication을 우회합니다. 사용자 key에 인증 token을 넣어 공유를 활성화할 수 없으며, token 자체를 key나 Store 진단 정보에 기록해서도 안 됩니다.
````

- [ ] **Step 2: Mark the milestone complete and narrow the next step**

Apply these exact status changes:

```markdown
# docs/roadmap.md
| 다음 단계 | v0.4 adaptive Retry |
- 사용자 key의 tenant·인증 경계 문서화 — 문서화 완료

# README.md
현재 단계는 v0.4 Reliability policy입니다. 다음으로 adaptive Retry를 설계하고 검증합니다.
```

- [ ] **Step 3: Verify status and terminology consistency**

Run:

```bash
rg -n "사용자 key의 tenant·인증 경계 문서화|다음 단계|adaptive Retry" docs/roadmap.md README.md
rg -n '사용자 key와 tenant 경계|tenantId|인증 token|외부 `CacheStore`' docs/cache-deduplication.md
```

Expected: the roadmap item says `문서화 완료`; README and roadmap name only adaptive Retry as next; the policy guide contains the tenant example and authentication warning.

- [ ] **Step 4: Check the documentation diff**

Run:

```bash
git diff --check -- docs/cache-deduplication.md docs/roadmap.md README.md
git diff -- docs/cache-deduplication.md docs/roadmap.md README.md
```

Expected: no whitespace errors and no source or test changes.

- [ ] **Step 5: Commit the documentation milestone**

```bash
git add docs/cache-deduplication.md docs/roadmap.md README.md
git commit -m "docs: clarify user key isolation boundaries"
```
