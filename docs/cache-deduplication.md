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

내장 Cache는 기본적으로 Status `200`만 저장하며 `Set-Cookie`, 제한적인 `Cache-Control` 또는 `Vary`가 있는 Response를 거부합니다. Response의 `max-age`와 `Age`는 호출자가 지정한 TTL을 줄일 수 있지만 늘릴 수는 없습니다. 임의의 `Vary`를 거부하는 이유는 variant-aware Store가 없는 상태에서 서로 다른 표현을 공유하지 않기 위해서입니다.

Unsafe method는 호출자 소유 key가 필요합니다. `methods: ["POST"]`를 추가해도 이 요구 사항은 없어지지 않습니다. 내장 key가 Request Body를 읽지 않기 때문입니다.

Key callback은 독립적으로 소비할 수 있는 `Request` clone을 받습니다. 정적 key와 callback 결과는 비어 있지 않은 문자열이어야 합니다. Key는 신뢰 경계이므로 Response identity를 바꾸는 모든 값을 호출자가 포함해야 합니다.

## Store 계약

기본 memory store와 진행 중 registry는 지연 생성되며 하나의 `LClient`에 속합니다. 오직 `lafetch.create()`만 새 소유 범위를 만듭니다. 서로 다른 Transport, tenant 또는 test fixture가 상태를 실수로 공유하지 않도록 하기 위한 결정입니다.

사용자 `CacheStore`를 여러 클라이언트에 전달하는 것은 명시적인 공유 선택입니다.

`CacheStore`는 비동기 구현을 허용하며 `Response`와 절대 만료 시각을 저장합니다. 구현체는 서로 독립적으로 소비 가능한 Response를 반환해야 합니다. `MemoryCacheStore`는 `@laflabs/lafetch/cache`에서 가져오며 entry를 clone하고, 만료를 지연 정리하며, 제한된 LRU 방식으로 제거합니다.

Runtime별 Store는 다음 항목을 검증해야 합니다.

- Response clone 격리
- 만료
- 동시 읽기와 쓰기
- 제한된 저장량 또는 외부 eviction
- Store 실패가 HTTP 결과를 오염시키지 않는지 여부

내장 Cache는 Status 처리와 Buffered 크기 제한이 성공한 뒤 finalization에서만 entry를 commit합니다. Retry 대상, 거부, Abort, Timeout과 크기 초과 Response는 저장하지 않습니다.

`@laflabs/lafetch/testing`의 `runCacheStoreConformance()`은 test framework와 독립적인 기본 적합성 검사를 제공합니다. Round trip, 독립 Response clone과 선택적 삭제를 검사하며 adapter 프로젝트가 결과를 자체 assertion으로 변환할 수 있습니다.

## Deduplication 소유권

첫 번째 일치 요청이 leader이고 이후 요청은 follower입니다. Follower는 leader가 보관한 Response를 기다리지만 각자의 Abort와 Timeout signal을 유지합니다.

- Follower Abort는 leader를 취소하지 않습니다.
- Leader가 Abort 또는 Timeout으로 끝나면 active follower 하나가 자체 Transport 실행을 이어받을 수 있습니다.
- 대체 leader 선출은 현재 registry entry를 다시 확인해 한 번만 발생합니다.

Deduplication은 개별 attempt가 아니라 leader의 전체 Retry sequence를 소유합니다. 이후 Retry도 기존 leader로 계속 실행되며 자신의 미완료 공유 실행을 다시 기다리지 않습니다.

Key는 각 최종 attempt `Request`에서 다시 계산합니다. 하나의 leader sequence 안에서 identity가 바뀌면 서로 다른 요청을 같은 Response에 연결하지 않고 `HttpConfigurationError`로 실패합니다.
