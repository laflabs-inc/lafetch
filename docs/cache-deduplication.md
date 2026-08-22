# Cache와 Deduplication 정책

Cache와 Deduplication은 서로 다른 시간 문제를 해결하는 별도 Feature입니다.

- Cache는 TTL이 만료될 때까지 완료된 Response를 재사용합니다.
- Deduplication은 동시에 실행 중인 동일 요청만 공유합니다.

두 정책은 한 요청에서 함께 사용할 수 있습니다. Deduplication이 Cache보다 먼저 intercept되고 finalizer는 역순으로 실행되므로, Cache commit이 끝난 뒤 follower가 완료됩니다.

## 안전한 기본값

두 정책의 기본 대상은 `GET`과 `HEAD`입니다. 다음 조건 중 하나라도 해당하면 내장 정책을 우회합니다.

- credentials가 `omit`이 아님
- URL에 user information 또는 token 형태의 Query가 있음
- Header 이름이 credentials, token, secret, session 또는 API key 성격임

내장 key는 모든 `beforeAttempt` hook이 끝난 최종 `Request`에서 계산합니다. Method, 전체 URL과 정규화된 모든 Header를 포함하므로 tenant Header, locale, content negotiation처럼 늦게 결정되는 응답 identity도 분리됩니다.

정적 key나 key callback을 사용해도 Fetch 실행 정책은 key에서 제거되지 않습니다. `cache`, `credentials`, `integrity`, `keepalive`, `mode`, `priority`, `redirect`, `referrer`, `referrerPolicy`를 최종 key에 덧붙여 같은 사용자 key가 의미가 다른 `Request`를 합치지 않게 합니다.

내장 Cache는 기본적으로 Status `200`만 저장하며 `Set-Cookie`, 제한적인 `Cache-Control` 또는 `Vary`가 있는 Response를 거부합니다. Response의 `max-age`와 `Age`는 호출자가 지정한 TTL을 줄일 수 있지만 늘릴 수는 없습니다. 임의의 `Vary`를 거부하는 이유는 variant-aware Store가 없는 상태에서 서로 다른 표현을 공유하지 않기 위해서입니다.

유효한 단일 `max-age`가 있으면 남은 수명은 `min(configured TTL, max(0, max-age - Age))`입니다. `Age`는 첫 list member만 사용하며 `max-age`가 없을 때는 local TTL에서 차감하지 않습니다. Directive는 quoted-string 밖의 쉼표로만 나누고, `max-age`와 `Age`의 정수 차감은 JavaScript `number` 정밀도에 의존하지 않습니다. 중복되거나 잘못된 `max-age`는 즉시 stale로 취급합니다. Response가 Cache hook에 도착한 시점에 절대 만료 시각을 고정하므로 Body 처리나 Store queue가 느려도 freshness가 늘어나지 않습니다.

`304 Not Modified`에 새 `Age`가 없으면 stale Response의 기존 `Age`를 상속하지 않습니다. Revalidation 결과가 `no-store` 등으로 저장 불가가 되면 이전 stale validator도 generation queue에서 제거합니다. `Expires`, `s-maxage`, heuristic freshness와 동적 `Age` 합성은 현재 application-cache 계약에 포함하지 않습니다. 상세 결정은 [v0.4 HTTP freshness RFC](rfcs/v0.4-cache-freshness.md)를 따릅니다.

Unsafe method는 호출자 소유 key가 필요합니다. `methods: ["POST"]`를 추가해도 이 요구 사항은 없어지지 않습니다. 내장 key가 Request Body를 읽지 않기 때문입니다.

Key callback은 독립적으로 소비할 수 있는 `Request` clone을 받습니다. 정적 key와 callback 결과는 비어 있지 않은 문자열이어야 합니다. Fetch 실행 정책은 Lafetch가 항상 분리하지만, Body·tenant처럼 사용자 key가 대신한 Response identity는 호출자가 포함해야 합니다.

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

## Store 계약

기본 memory store와 진행 중 registry는 지연 생성되며 하나의 `LClient`에 속합니다. 오직 `lafetch.create()`만 새 소유 범위를 만듭니다. 서로 다른 Transport, tenant 또는 test fixture가 상태를 실수로 공유하지 않도록 하기 위한 결정입니다.

사용자 `CacheStore`를 여러 클라이언트에 전달하는 것은 명시적인 공유 선택입니다.

`CacheStore`는 비동기 구현을 허용하며 `Response`, `storedAt`, `expiresAt`, `sizeBytes`를 저장합니다. `get()`, `set()`, `delete()`가 모두 필요합니다. 구현체는 입력 Response와 각 읽기를 서로 독립적으로 소비할 수 있게 snapshot하고 metadata를 변경 없이 보존해야 합니다. 같은 key의 쓰기는 이전 entry를 대체하고 없는 key의 삭제도 성공해야 합니다.

`MemoryCacheStore`는 `@laflabs/lafetch/cache`에서 가져오며 entry를 clone하고, 만료를 지연 정리하며, entry 수 또는 응답 Body 합계가 한도를 넘으면 LRU 방식으로 제거합니다. 기본 한도는 500개와 64 MiB입니다. 외부 Store는 만료 entry를 자체 eviction하거나 원래 metadata와 함께 반환할 수 있습니다. Core는 `Response`, `storedAt`, `expiresAt`, `sizeBytes`를 검증합니다. Store 단계에서 stale validator 반환을 금지하지 않아 revalidation 계약을 유지합니다.

Cache hit의 유효 수명은 저장 당시 정책만 신뢰하지 않고 `min(expiresAt, storedAt + 현재 요청 TTL)`로 계산합니다. 따라서 먼저 저장한 긴 TTL이 이후 reader가 선언한 짧은 TTL이나 `cache(0)`을 확장하지 않습니다.

Runtime별 Store는 다음 항목을 검증해야 합니다.

- Response clone 격리
- 만료
- 동시 읽기와 쓰기
- 제한된 저장량 또는 외부 eviction
- `storedAt`·`expiresAt`·`sizeBytes` metadata 보존
- Store 실패 모드와 origin 부하 정책

내장 Cache는 Status 처리와 Buffered 크기 제한이 성공한 뒤 finalization에서만 entry를 commit합니다. Retry 대상, 거부, Abort, Timeout과 크기 초과 Response는 저장하지 않습니다.

Store 장애의 기본값은 `storeFailure: "throw"`입니다. 읽기·만료 삭제 실패는 `intercept`, 쓰기 실패는 `finalize`의 `HttpFeatureError`로 노출합니다. 이는 장애를 숨긴 채 모든 요청을 origin으로 보내는 Cache stampede를 기본 동작으로 만들지 않기 위한 선택입니다.

Cache가 성공 조건이 아닌 서비스는 명시적으로 fail-open을 선택할 수 있습니다.

```ts
await api
  .get("/catalog")
  .cache("5m", {
    store,
    storeFailure: "bypass",
  });
```

`"bypass"`에서는 Store 읽기·만료 정리 실패와 잘못된 entry를 miss로, 쓰기 실패를 skip으로 처리합니다. key callback, Transport, HTTP status, decoding과 validation 오류는 우회하지 않습니다. Store 오류가 Lafetch 결과에 남지 않으므로 adapter가 자체 logging과 metrics를 제공해야 합니다.

`@laflabs/lafetch/testing`의 `runCacheStoreConformance()`은 test framework와 독립적인 적합성 검사를 제공합니다. Metadata·Body round trip, write/read isolation, overwrite, key isolation, 만료 연장 방지, 동시 읽기와 삭제를 검사하며 adapter 프로젝트가 결과를 자체 assertion으로 변환할 수 있습니다. 상세 결정은 [v0.4 CacheStore 신뢰성 RFC](rfcs/v0.4-cache-store-reliability.md)를 기준으로 합니다.

동일 key를 origin 결과로 교체할 때는 기존 `.cache()` 정책에서 invalidation mode를 선언합니다.

```ts
await api.get("/catalog").cache("5m", {
  store,
  mode: "invalidate",
});
```

Invalidation은 기존 in-flight leader를 따라가면 stale 값을 다시 저장할 수 있으므로 해당 logical request에서만 Dedupe 공유를 우회합니다. 일반 Cache·Dedupe 조합의 leader/follower 계약은 바뀌지 않습니다.

Store·key generation guard는 invalidation보다 먼저 시작한 origin 요청이 나중에 완료되어 새 값을 덮어쓰는 것을 막습니다. 동일 경계의 Cache write와 invalidation delete는 직렬화되어 이미 진행 중인 write도 delete보다 먼저 끝납니다. Cache entry의 절대 만료 시각은 origin 응답이 완료될 때 확정하며, commit 차례를 기다리는 동안 만료되면 write를 생략합니다. 활성 요청이 모두 finalize되면 generation record도 제거됩니다.

stale entry가 `ETag` 또는 `Last-Modified`를 제공할 때 조건부 요청을 사용하려면 revalidation mode를 명시합니다. `mode`를 생략하면 기존 read·expiry 계약을 유지하며 `"default"`는 공개 값이 아닙니다.

```ts
await api.get("/catalog").cache("5m", {
  store,
  mode: "revalidate",
});
```

`304 Not Modified`는 저장된 Body의 독립 clone과 갱신된 Header를 가진 정상 응답으로 변환됩니다. validator가 없는 stale entry는 삭제 후 miss가 됩니다. tag·prefix invalidation, stale-while-revalidate와 stale-if-error는 포함하지 않습니다. 상세 경계는 [v0.4 Cache invalidation·revalidation RFC](rfcs/v0.4-cache-invalidation-revalidation.md)를 따릅니다.

## Deduplication 소유권

첫 번째 일치 요청이 leader이고 이후 요청은 follower입니다. Follower는 leader가 보관한 Response를 기다리지만 각자의 Abort와 Timeout signal을 유지합니다.

- Follower Abort는 leader를 취소하지 않습니다.
- 취소된 follower의 observer는 leader가 완료되기 전이라도 즉시 registry에서 분리됩니다.
- Safe method의 leader가 Abort 또는 Timeout으로 끝나면 active follower 하나가 자체 Transport 실행을 이어받을 수 있습니다.
- Unsafe method는 idempotency key가 있어도 leader의 Abort·Timeout이 origin 처리 여부를 확정하지 못하므로 follower가 자동 재전송하지 않고 같은 오류를 받습니다.
- Safe method의 대체 leader 선출은 현재 registry entry를 다시 확인해 한 번만 발생합니다.

Deduplication은 개별 attempt가 아니라 leader의 전체 Retry sequence를 소유합니다. 이후 Retry도 기존 leader로 계속 실행되며 자신의 미완료 공유 실행을 다시 기다리지 않습니다.

Key는 각 최종 attempt `Request`에서 다시 계산합니다. 하나의 leader sequence 안에서 identity가 바뀌면 서로 다른 요청을 같은 Response에 연결하지 않고 `HttpConfigurationError`로 실패합니다.
