# Lafetch 커널 아키텍처

이 문서는 현행 v0.3 커널의 실행 모델과 반드시 유지해야 하는 불변식을 설명합니다. 일반적인 사용법은 [상세 사용 가이드](advanced-usage.md)를 참고하세요.

## 공개 모델

```text
lafetch.create()
  → LClient.method(url)
    → immutable LRequest
      → normalized RequestConfiguration
        → Feature resolver
          → request / attempt lifecycle
            → Transport
```

Fluent chain은 실행 순서를 감싼 middleware가 아니라 선언적 설정입니다. 실제 순서는 요청을 전송하기 전에 Feature 의존성과 Capability를 해석해 한 번 결정합니다.

공개 API의 역할은 세 가지로 제한합니다.

- `lafetch`는 격리된 `LClient`를 만드는 factory입니다.
- `LClient`는 공통 환경 설정과 Cache·Deduplication의 소유 경계입니다.
- `.use(feature)`는 공식 정책이 아닌 외부 확장에만 사용하는 고급 진입점입니다.

프로세스 전역 기본 클라이언트나 static request shortcut은 제공하지 않습니다.

```text
client.method(url).configure().policy() → await LResponse
```

Named HTTP method는 URL만 받고 Query, Header, Body, 취소, 실행 정책, 검증과 Telemetry는 immutable fluent method로 설정합니다. 사용자 정의 HTTP method만 `request(method, url)`을 사용합니다.

응답 소비 계약은 다음과 같습니다.

| 문법 | 반환 | 소유권 |
| --- | --- | --- |
| `await request` | 자동 디코딩된 `data`를 담은 `LResponse<T>` | Buffered, 다중 소비 |
| `request.as(dataMode)` | 강제 디코딩 또는 Schema 변환 값 | Buffered, 다중 소비 |
| `request.as("response")` | Fetch `Response` | Buffered, 다중 소비 |
| `request.as("stream")` | `LStreamResponse` | live Body, 단일 소비 |

## 공개 이름 규칙

| 분류 | 규칙 | 현재 이름 |
| --- | --- | --- |
| 루트 브랜드 | 전체 제품명 유지 | `Lafetch`, `lafetch` |
| Lafetch runtime 객체 | `L` 접두사 하나 | `LClient`, `LRequest`, `LResponse`, `LStreamResponse`, `LStream` |
| 범용 계약 | 역할만 표현 | `ClientOptions`, `RetryOptions`, `Transport`, `CacheStore` |
| HTTP 오류 | protocol 접두사 사용 | `HttpError`, `HttpTimeoutError`, `HttpStatusError` |

아직 공개 배포 전이므로 대체된 긴 이름을 compatibility alias로 남기지 않습니다. 첫 공개 버전에 같은 개념을 표현하는 중복 어휘를 포함하지 않는 것이 우선입니다.

## 상태 소유권

| 상태 | 소유자 | 수명 |
| --- | --- | --- |
| `LRequest` 실행 Promise | 하나의 immutable request | 모든 소비자가 완료될 때까지 |
| Feature `state` | 한 실행의 한 Feature | 요청 실행 1회 |
| Feature `metadata` | 한 실행의 모든 Feature | 요청 실행 1회 |
| 기본 memory cache | 한 `LClient` | 클라이언트 수명 |
| 진행 중 Deduplication registry | 한 `LClient` | leader 실행 동안 |
| 사용자 `CacheStore` | 호출자 | 호출자가 결정 |

서로 다른 `LClient`는 전역 Cache나 Deduplication registry를 공유하지 않습니다. 여러 클라이언트가 같은 Store를 사용하려면 호출자가 동일한 adapter를 명시적으로 전달해야 합니다.

## 실행 범위

### 요청 범위

Request scope는 요청 실행마다 한 번 수행합니다.

1. URL, Query, Header와 Body source를 정규화합니다.
2. Feature Capability와 실행 순서를 확정합니다.
3. 격리된 Feature state, 공유 metadata와 total deadline을 만듭니다.
4. `request:start`를 전달하고 기본 request draft를 준비합니다.
5. 하나 이상의 attempt를 실행합니다.
6. 최종 오류가 있으면 Feature 역순으로 매핑합니다.
7. finalizer를 역순으로 실행하고 최종 request event를 전달합니다.

Cache와 Deduplication은 dispatch를 가로챌 수 있고, Idempotency는 attempt draft를 수정합니다. 응답 검증은 HTTP 실행이 끝난 뒤 consumption scope에서 수행합니다. `LRequest.mapError()`는 실행 또는 소비의 최종 실패가 확정된 뒤 적용합니다.

### 시도 범위

Attempt scope는 최초 시도와 각 Retry마다 실행합니다.

1. 준비된 request draft를 복제합니다.
2. attempt deadline을 만듭니다.
3. `beforeAttempt` hook을 실행합니다.
4. 새로운 Fetch `Request`를 만듭니다.
5. `attempt:start`를 전달합니다.
6. `intercept` 결과가 없으면 Transport를 호출합니다.
7. `afterResponse` hook의 Response 교체를 순서대로 적용합니다.
8. Buffered retention 또는 Streaming Body 종료까지 attempt deadline을 유지합니다.
9. 실패를 정규화하고 Retry 여부와 Backoff를 결정합니다.
10. 다음 시도 전 Backoff를 기다립니다.

## Promise와 응답 소유권

하나의 `LRequest`는 다음 중 하나의 응답 소유권 모델을 선택합니다.

```text
Buffered  = memoized 실행 1회 + 독립적인 다중 소비
Streaming = live 실행 1회 + Body 소유자 1명
```

Buffered 실행은 최종 Response Body를 제한된 크기 안에서 보관합니다. 직접 `await`한 소비자는 독립적인 `LResponse`와 `Headers`를 받고, data mode 소비자는 디코딩 또는 검증된 값만 받습니다. `as("response")`는 Buffered native `Response`를 얻는 유일한 경로입니다.

첫 `as("stream")` 호출은 Streaming 소유권을 점유합니다. 같은 request의 반복 Streaming이나 Buffered와 Streaming 혼합 소비는 `HttpConsumptionError`로 실패합니다. Fluent method를 추가로 호출하면 기존 객체를 변경하지 않고 별도 실행 식별자를 가진 새 `LRequest`를 만듭니다.

Web Platform이 허용하는 입력은 선언 시점에 snapshot합니다. URL, Query 배열, Status 목록, Retry 정책, Schema, advanced `RequestInit`과 Feature descriptor는 호출자가 나중에 변경해도 기존 요청에 영향을 주지 않습니다. `Transport`, `CacheStore`, `AbortSignal`, Body 값과 callback처럼 상태를 가진 adapter는 호출자 소유 참조로 유지합니다.

## Buffered와 Streaming

Buffered 실행은 Body 수신까지 완료한 뒤 settle합니다. 따라서 total Timeout은 Body 소비를 포함하며 여러 소비자가 독립적인 Response clone을 사용할 수 있습니다.

- 기본 실제 수신 상한: `16 MiB`
- 요청별 상한: `.maxResponseBytes(bytes)`
- `Content-Length`는 강제 기준으로 신뢰하지 않고 실제 chunk를 계산

Streaming 실행은 Header를 수락한 뒤 `LStreamResponse`를 반환합니다. 실제 Fetch `Response`와 Web Stream API를 보존하면서 `pipe()`와 순차 `forEach()`만 추가합니다.

- Body가 없으면 `pipe()`는 즉시 닫힌 Stream을 반환
- 기본 총량 상한 없음
- `.maxResponseBytes(bytes)`를 명시한 경우에만 전달 chunk 누적량 제한
- Timeout, Abort, attempt 소유권과 finalizer는 Body 종료 또는 취소까지 유지
- accepted Body를 노출한 뒤에는 새 Response로 Retry하지 않음

## Retry 불변식

`retry(count)`의 `count`는 최초 요청 이후의 추가 재시도 횟수입니다. `meta.attempts`는 최초 시도를 포함한 전체 횟수입니다.

기본 Retry 정책:

- method: `GET`, `HEAD`, `OPTIONS`
- status: `408`, `429`, `500`, `502`, `503`, `504`
- network failure: 활성화
- `Retry-After`: 준수
- `Retry-After` 상한: 일반 Backoff와 분리된 1분
- 상한을 넘는 `Retry-After`: 서버 지시보다 일찍 재시도하지 않고 최종 실패
- Backoff: exponential, full jitter
- 허용된 method의 attempt Timeout: 재시도 가능
- total Timeout과 사용자 Abort: 최종 실패

기존 `ReadableStream` Body는 재생할 수 없으므로 Retry 가능성이 있으면 전송 전에 거부합니다. 시도마다 새 Body를 만들 수 있을 때만 `bodyFactory()`를 사용합니다.

`Retry-After`는 [RFC 9110 §10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)의 delay-seconds와 HTTP-date만 해석합니다. 잘못된 값은 일반 Backoff로 돌아가며, active Internet-Draft인 RateLimit Header와 비표준 `X-RateLimit-*` Header는 자동 Retry 신호로 사용하지 않습니다.

## Feature 해석

Capability는 세 가지 모드를 사용합니다.

- `exclusive`: 하나의 provider만 허용
- `composable`: 여러 provider를 정해진 순서로 허용
- `observer`: 소유권을 갖지 않는 관찰자

Resolver는 required·conflicting Capability를 검증하고 ordering graph를 stable topological sort로 정렬합니다. `before`와 `after`는 대상이 반드시 존재해야 하며, `optionalBefore`와 `optionalAfter`는 선택적 관계입니다.

Feature 이름은 한 요청에서 고유합니다. 공식 정책을 중복 설치하거나 사용자 Feature가 같은 이름을 가로채면 last-write-wins로 처리하지 않고 전송 전에 실패합니다. Cache와 Deduplication은 완성된 Body 소유권이 필요하므로 Streaming과 함께 사용할 수 없습니다.

### Hook 의미

- `intercept`: 정방향으로 실행하며 첫 Response가 해당 attempt의 Transport를 대체
- `afterResponse`: 정방향으로 실행하며 이후 Feature에 교체 Response 전달 가능
- `onAttemptError`: 정규화된 attempt 오류, Retry 여부와 `retryDelayMs` 관찰
- `mapError`: 최종 Error에 한 번, 역순으로 실행
- `finalize`: 성공·실패와 관계없이 역순으로 실행

Feature hook 실패는 이미 `HttpError`가 아닌 경우 `HttpFeatureError`로 감쌉니다. Feature 실패를 Transport 실패로 다시 분류하지 않습니다.

Buffered finalizer는 독립적인 retained Response clone을 받습니다. Streaming finalizer는 Body 종료 뒤 Body가 없는 Response snapshot을 받아 무제한의 두 번째 소비자가 생기지 않도록 합니다.

## 생명주기 이벤트

`onEvent` observer는 immutable하고 Body가 없는 snapshot을 받습니다.

```text
request:start
  attempt:start
  [attempt:response]
  [attempt:error]
  [attempt:start ...]
request:success | request:error
```

`attempt:error`에는 `willRetry`와 `retryDelayMs`가 포함됩니다. Response event의 source는 Transport 이름 또는 `feature:<name>`입니다. 요청 snapshot은 인증 Header와 token 형태의 Query를 제거합니다.

공식 Telemetry는 event 전달을 lifecycle 순서대로 시작하지만 비동기 Handler 완료를 HTTP critical path에서 기다리거나 직렬화하지 않습니다. 순서 보장이나 durable delivery가 필요한 수집기는 자체 queue와 flush lifecycle을 가져야 합니다.

## 보안 기본값

- 명시적으로 허용하지 않은 `200–299` 밖의 Status는 오류
- unsafe method는 기본 Retry 대상에서 제외
- 요청 Body는 진단 정보에 포함하지 않음
- 인증 Header, token 형태 Query와 URL user information 제거
- Fetch credentials 기본값은 `omit`
- 민감 요청은 기본 Cache와 Deduplication 우회
- Cache와 Deduplication 상태는 클라이언트 경계를 넘지 않음
- 기본 키는 최종 Request의 method, 전체 URL과 모든 정규화 Header 포함
- unsafe method에는 호출자 소유 key 요구
- Cache entry는 Body retention과 성공 finalization 뒤에만 commit
- Buffered Body는 실제 byte 기준 유한 상한 적용
- Streaming은 명시한 경우에만 유한 상한 적용
- accepted Streaming Body 오류는 replacement Retry 금지
- Transport 호출 전에 잘못된 설정과 Feature 충돌 거부

## 응답 소비 범위

Buffered execution은 하나의 크기 제한 raw Response를 보관하고 각 소비자는 clone을 사용합니다.

1. 자동 또는 명시적 decoder 적용
2. 선택한 `validate()` Schema 적용
3. 최종 실패에 `mapError()` 적용

직접 `await`는 자동 디코딩된 `LResponse<T>`를 반환합니다. `as("json" | "text" | "bytes" | "blob" | "formData")`는 decoder를 강제하고 값을 직접 반환합니다. Standard Schema V1과 기존 adapter가 값을 변환하면 direct `LResponse.data`와 data mode의 런타임 값·TypeScript 반환 타입이 모두 Schema 출력을 따릅니다. `as("response")`는 decoding, validation과 envelope 밖에 있습니다.

`LResponse.request`는 native `Request`가 아니라 오류·Telemetry와 같은 규칙으로 redaction한 immutable `RequestSnapshot`입니다. 성공 응답을 장기 보관해도 upload Body나 원본 credential Header에 도달할 수 없습니다.

`as("stream")`은 전송 전에 별도 live execution을 선택합니다. 전체 Body decoding이나 Schema validation을 수행하지 않으며 Body read 실패를 response phase 오류로 매핑합니다. 이 분리로 잘못된 payload를 network failure로 Retry하지 않으면서 하나의 `mapError()` 경로를 유지합니다.

## 남은 결정

- 라이선스와 특허 조항
- 첫 공개 버전의 Node.js LTS 범위
- Next.js Cache와 Revalidation adapter의 소유권
- 실제 사용자 프로젝트에서의 `LResponse` thenable 검증

우선순위와 완료 조건은 [기술 경쟁력 평가와 개선 백로그](improvements.md)에서 관리합니다.
