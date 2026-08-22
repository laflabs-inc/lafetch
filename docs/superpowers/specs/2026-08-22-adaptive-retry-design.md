# v0.4 Adaptive Retry 설계

## 목표

v0.4 Retry에 동기식 custom failure predicate를 추가한다. 사용자는 기본 status·network 정책을 요청별로 확장하거나 중단할 수 있지만, Retry 횟수, method·idempotency, Abort·Timeout, `Retry-After`와 Body ownership 경계는 바꿀 수 없다.

## 현재 상태

`retry(count, options)`는 선언 시 옵션을 검증하고 snapshot한 뒤 Executor에서 정규화한다. Executor는 non-accepted status, `HttpTransportError`와 attempt `HttpTimeoutError`를 각각 기본 정책으로 판정하고 `reportAttemptError()`를 통해 최종 `willRetry`와 delay를 Telemetry에 기록한다.

현재 `RetryOptions`에는 custom decision callback이 없다. 로드맵의 custom predicate와 forced Retry가 한 항목에 섞여 있지만, 같은 문서의 명시적 제외는 Request·Response 교체와 forced Retry를 v0.5 Feature·Transport SDK로 미룬다. v0.4는 실패가 이미 발생한 뒤의 decision만 추가하고 이 경계를 명확히 한다.

## 공개 API

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

export interface RetryOptions {
  // 기존 옵션 유지
  readonly shouldRetry?: (
    context: RetryDecisionContext,
  ) => boolean | undefined;
}
```

`RetryDecisionContext`는 root package에서 export한다. `attempt`는 실패한 현재 시도의 1-based 번호이고 `method`는 해당 attempt에서 실제로 사용한 대문자 HTTP method다.

`reason: "response"`는 `acceptStatus()`가 거부한 Response만 나타낸다. raw `Request`, `Response`, Header와 Body는 노출하지 않는다. `reason: "error"`는 기존 immutable `RequestEventErrorSnapshot`을 재사용하며 Transport 오류와 attempt Timeout만 전달한다.

Callback은 동기 함수만 허용한다. 비동기 외부 작업, 요청 변경과 응답 Body 검사는 v0.5 Feature SDK의 attempt 제어 계약과 함께 다룬다.

## 결정 합성

Predicate는 다음 순서로 평가한다.

1. 남은 Retry 횟수와 method gate를 확인한다.
2. `OPTIONS`, `GET`, `HEAD`, 명시적 `methods` 또는 Idempotency policy로 허용된 method만 계속한다.
3. non-accepted Response 또는 안전한 오류 범주에 대해 `shouldRetry`를 한 번 호출한다.
4. 반환값을 기본 결정과 합성한다.
5. 재시도가 선택되면 기존 `retryDelay()`로 Backoff와 `Retry-After`를 판정한다.
6. 최종 결정과 delay를 기존 attempt Telemetry에 기록한다.

반환 의미는 다음과 같다.

| 반환값 | 결과 |
| --- | --- |
| `undefined` | 기존 `statuses`, `networkErrors`와 attempt Timeout 정책 사용 |
| `false` | 기본 정책이 허용해도 재시도하지 않음 |
| `true` | 안전한 실패 범위에서 기본 status 또는 `networkErrors` 결정을 확장 |

`true`도 다음 경계를 우회하지 못한다.

- Retry 횟수와 method·idempotency gate
- accepted Response
- 사용자 Abort와 total Timeout
- configuration, Feature, decoding, schema와 Body consumption 오류
- non-replayable request Body 검사
- `Retry-After`가 `maxRetryAfter`를 넘을 때의 재시도 금지
- Streaming Body가 노출된 뒤의 replacement Retry 금지

따라서 기본 목록에 없는 409 같은 non-accepted status나 `networkErrors: false`인 Transport 오류는 명시적으로 추가할 수 있지만, 성공 Response와 Body 내용으로 새 Retry를 만들 수는 없다.

## 구현 흐름

- `snapshotRetryOptions()`는 `shouldRetry` 함수 참조를 보존한다. callback처럼 상태를 가진 값은 호출자 소유 참조를 유지한다.
- `validateRetryOptions()`는 `shouldRetry`가 함수인지 선언 시점에 확인한다.
- `normalizeRetry()`는 callback을 `NormalizedRetry`에 포함한다.
- 작은 내부 decision helper가 `undefined | boolean` 반환을 기본 결정과 합성한다.
- Response 분기와 error 분기는 같은 helper를 사용하되 각 context를 한 번만 생성한다.
- status가 최종 오류로 이어져 catch 경로에 들어가도 predicate를 다시 호출하지 않는다.
- 기존 Backoff, `retryDelay()`, `reportAttemptError()`와 Telemetry schema는 변경하지 않는다.

새 Retry subsystem, 새 오류 클래스와 custom delay 옵션은 만들지 않는다.

## 오류와 자원 정리

`shouldRetry`가 throw하면 `HttpConfigurationError`로 감싸고 원인을 `cause`로 보존한다. `boolean | undefined`가 아닌 값을 반환해도 `HttpConfigurationError`다. Promise 반환도 비동기 predicate로 간주하지 않고 잘못된 반환값으로 거부한다.

Predicate 오류는 Transport failure로 재분류하거나 다시 Retry하지 않는다. 해당 attempt는 `willRetry: false`로 보고한다. Response 분기에서 predicate가 실패하면 노출되지 않은 Response Body를 취소한 뒤 오류를 전달해 connection과 stream ownership을 남기지 않는다.

## Telemetry

Telemetry 공개 schema는 그대로 유지한다.

- predicate가 `true`이고 delay가 허용되면 `willRetry: true`와 `retryDelayMs`를 기록한다.
- predicate가 `false`이거나 server delay 상한이 재시도를 막으면 `willRetry: false`를 기록한다.
- predicate 자체가 실패하면 정규화된 configuration error와 `willRetry: false`를 기록한다.

Logical `request`·`response` event는 기존처럼 Retry sequence 전체에서 각각 한 번만 실행한다.

## 검증

`tests/retry.test.ts`를 중심으로 다음 회귀를 추가한다.

- `undefined`가 status, network와 attempt Timeout 기본 정책을 보존
- `false`가 기본 status와 Transport Retry를 각각 중단
- `true`가 기본 목록에 없는 non-accepted status와 `networkErrors: false`인 Transport 오류를 Retry
- Retry 횟수 소진과 unsafe method에서 callback 미호출
- 명시적 method와 Idempotency policy에서 callback 호출
- accepted Response, Abort와 total Timeout에서 callback 미호출
- callback throw, Promise와 다른 잘못된 반환값이 `HttpConfigurationError`
- predicate 실패 시 Response Body 취소
- predicate가 attempt마다 한 번만 실행
- Telemetry의 `willRetry`와 `retryDelayMs`가 최종 결정과 일치

`tests/api-conventions.test.ts`와 `tests/public-api-runtime.test.js`에서 root type export, 유효한 callback과 잘못된 JavaScript 값을 검증한다. 기존 Retry, Streaming, Idempotency, lifecycle 테스트를 전체 실행한다.

최종 품질 gate는 typecheck, 전체 테스트, ESM build, packed package, Worker와 Next.js fixture다. Chromium 검증은 필요한 host library가 있는 환경에서 실행한다.

## 문서와 로드맵

- `docs/rfcs/v0.4-retry-decision.md`: custom predicate를 확정 계약으로 이동하고 forced Retry를 v0.5로 분리한다.
- `docs/advanced-usage.md`와 `README.md`: tri-state 의미와 안전한 status 예제를 추가한다.
- `docs/architecture.md`: method gate, predicate, delay 순서를 기록한다.
- `docs/roadmap.md`와 `docs/improvements.md`: v0.4 adaptive Retry 완료와 v0.5 forced Retry 경계를 반영한다.

RateLimit과 비표준 Header의 자동 해석은 계속 제외한다. RateLimit Header Fields 문서는 2026-05-23 기준 active Internet-Draft이며 단일 실패 Response의 Retry delay보다 넓은 quota shaping을 표현한다.

## 호환성

옵션 필드 추가이므로 기존 TypeScript와 JavaScript 호출은 그대로 동작한다. Predicate가 없거나 `undefined`를 반환하면 현재 Retry 결과와 delay가 바뀌지 않는다. 새 의존성은 추가하지 않으며 대표 요청과 complete root의 기존 bundle 예산을 유지한다.

## 명시적 제외

- accepted Response 또는 Body content 기반 forced Retry
- Request·Response 교체와 attempt mutation
- async predicate
- custom delay, jitter callback과 RateLimit Header 해석
- Feature·Transport SDK의 공개 attempt hook
