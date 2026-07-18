# Lafetch 상세 사용 가이드

이 문서는 Lafetch의 고급 옵션과 확장 지점을 설명합니다. 처음 사용하는 경우 [README의 기본 사용법](../README.md)부터 확인하세요.

## 응답 형태

### 데이터만 받기

종결 메서드는 일반 `Promise`를 반환합니다.

```ts
const user = await api.get("/users/123").json<User>();
const text = await api.get("/health").text();
const response = await api.get("/download").raw();
```

`raw()`는 항상 복제된 `Response`를 반환하며 스키마 검증을 적용하지 않습니다.

### 전체 결과 받기

요청 객체를 직접 `await`하면 `HttpResult<T>`를 반환합니다.

```ts
const result = await api.get<User>("/users/123");

result.data;
result.status;
result.headers;
result.response;
result.meta.attempts;
```

### Promise 호환 체이닝

`RequestBuilder`는 지연 실행되는 Promise 호환 객체입니다.

```ts
api
  .get<User>("/users/123")
  .timeout("3s")
  .retry(3)
  .then(({ data }) => render(data))
  .catch(handleError)
  .finally(stopLoading);
```

하나의 Builder는 여러 소비자가 있어도 Transport를 한 번만 실행합니다.

```ts
const request = api.get<User>("/users/123");

const name = request.then(({ data }) => data.name);
const email = request.then(({ data }) => data.email);

await Promise.all([name, email]);
```

새 fluent 메서드를 호출하면 기존 Builder를 변경하지 않고 별도의 실행 식별자를 가진 Builder를 반환합니다.

## 요청 구성

쿼리, 헤더, 본문은 요청 Builder에서 구성합니다.

```ts
const user = await api
  .post("/users")
  .query({ notify: true, tag: ["new", "member"] })
  .header("X-Request-Source", "admin")
  .jsonBody({ name: "Dohyun" })
  .json<User>();
```

자격 증명의 기본값은 `"omit"`입니다. 클라이언트 또는 요청에서 명시적으로 활성화할 수 있습니다.

```ts
const api = lafetch.create({ credentials: "same-origin" });

await api.get("/session").credentials("include");
```

## Timeout, Retry, Backoff

간단한 정책은 숫자와 시간 문자열로 설정합니다.

```ts
await api
  .get("/users")
  .timeout("3s")
  .retry(3);
```

전체 요청과 개별 시도에 서로 다른 제한을 적용할 수도 있습니다.

```ts
await api
  .get("/users")
  .timeout({ total: "20s", attempt: "5s" })
  .retry({
    attempts: 3,
    backoff: {
      type: "exponential",
      base: "200ms",
      max: "10s",
      jitter: "full",
    },
  });
```

`attempts`는 최초 요청을 포함한 최대 총 시도 횟수입니다. 기본 재시도 대상은 `GET`, `HEAD`, `OPTIONS`이며 상태 코드는 `408`, `429`, `500`, `502`, `503`, `504`입니다. `Retry-After` 헤더를 존중하고, 전체 Timeout과 사용자 Abort는 재시도하지 않습니다.

기존 `ReadableStream` 본문은 다시 재생할 수 없습니다. 재시도마다 새로운 본문을 만들 수 있을 때만 `bodyFactory()`를 사용합니다.

```ts
await api
  .post("/upload")
  .bodyFactory(() => createUploadStream())
  .retry({ attempts: 2, methods: ["POST"] });
```

## Abort

표준 `AbortSignal`로 요청을 취소할 수 있습니다.

```ts
const controller = new AbortController();

const request = api
  .get("/reports")
  .signal(controller.signal)
  .timeout("30s");

controller.abort();
```

사용자 취소는 `HttpAbortError`, 제한 시간 초과는 `HttpTimeoutError`를 발생시킵니다. Timeout 오류의 `scope`는 `"total"` 또는 `"attempt"`입니다.

## Cache와 Deduplication

완료된 응답 캐시와 진행 중인 동일 요청 공유는 서로 다른 정책입니다.

```ts
const users = await api
  .get("/users")
  .cache("30s")
  .dedupe()
  .json<User[]>();
```

기본 메모리 캐시는 500개 항목으로 제한됩니다. Cache와 Deduplication 상태는 클라이언트별로 격리되며 `extend()` 역시 새로운 격리 범위를 만듭니다.

기본 키에는 URL과 모든 요청 헤더가 포함됩니다. 인증 헤더와 토큰 형태의 쿼리가 있는 요청, `Set-Cookie`, 제한적인 `Cache-Control`, `Vary`가 있는 응답은 기본 캐시를 우회합니다. 안전하지 않은 HTTP 메서드는 명시적인 사용자 정의 키가 필요합니다.

호출자가 같은 Store를 전달한 경우에만 여러 클라이언트가 캐시를 공유합니다.

```ts
import { MemoryCacheStore } from "@laflabs/lafetch";

const store = new MemoryCacheStore(1_000);

await api
  .get("/catalog")
  .cache({ ttl: "5m", store });
```

세부 안전 규칙은 [Cache와 Deduplication 설계](cache-deduplication.md)를 참고하세요.

## Idempotency

Idempotency는 전체 재시도 시퀀스에서 하나의 안정적인 키를 유지합니다.

```ts
await api
  .post("/payments")
  .jsonBody(input)
  .idempotency()
  .retry(3);
```

기존 `Idempotency-Key`는 유지됩니다. `retry.methods`가 생략되면 현재 메서드를 재시도 가능하게 만들지만, 사용자가 명시한 메서드 목록은 변경하지 않습니다. 비동기 키 생성과 사용자 정의 헤더 이름도 지원합니다.

## Schema Validation

스키마 검증은 HTTP 실행과 응답 디코딩 이후에 동작합니다. 함수 또는 `parse()`나 `validate()` 메서드가 있는 객체를 사용할 수 있으며 반환 타입 변환도 지원합니다.

```ts
const userSchema = {
  parse(value: unknown): User {
    return validateUser(value);
  },
};

const user = await api
  .get("/me")
  .schema(userSchema)
  .json();
```

## Error Mapping

HTTP 실행 실패와 응답 소비 실패는 서로 다른 범위에서 매핑합니다.

```ts
await api
  .get("/users/123")
  .mapError((error) => mapApiError(error))
  .schema(userSchema)
  .mapDecodeError((error) => mapPayloadError(error));
```

기본 성공 범위는 HTTP `200–299`입니다. 다른 상태를 정상 응답으로 처리해야 한다면 요청에서 명시합니다.

```ts
const result = await api
  .get<ApiResult>("/jobs/123")
  .acceptStatus((status) => status === 200 || status === 404);
```

## Telemetry

Telemetry는 요청 동작을 변경하지 않는 Observer Feature입니다.

```ts
await api
  .get("/health")
  .telemetry((event) => {
    console.log(event.type, event.requestId);
  });
```

모든 요청을 관찰하려면 클라이언트 Feature로 설치합니다.

```ts
import { lafetch, telemetry } from "@laflabs/lafetch";

const api = lafetch.create({
  features: [
    telemetry((event) => sendToCollector(event)),
  ],
});
```

이벤트는 다음 순서를 따릅니다.

- `request:start`
- `attempt:start`
- `attempt:response`
- `attempt:error` (`willRetry`, `retryDelayMs` 포함)
- `request:success` 또는 `request:error`

요청 본문은 이벤트에 포함되지 않으며 인증 헤더와 토큰 형태의 쿼리는 제거됩니다. Telemetry Handler 실패는 기본적으로 실제 요청을 실패시키지 않습니다. 엄격한 전달이 필요할 때만 `failureMode: "throw"`를 사용합니다.

## 사용자 정의 Transport

```ts
import type { Transport } from "@laflabs/lafetch";

const transport: Transport = {
  name: "custom",
  async send(request, context) {
    return customRuntimeFetch(request, context.signal);
  },
};

const api = lafetch.create({ transport });
```

Transport는 표준 `Request`를 받고 `Response`를 반환합니다. 테스트 더블이나 Fetch 외부 런타임 연결에도 같은 인터페이스를 사용합니다.

## 사용자 정의 Feature

공식 정책은 전용 fluent 메서드를 사용하고, 외부 동작만 `.use()`로 설치합니다.

```ts
const requestIdFeature = {
  name: "request-id",
  capabilities: {
    provides: [{ name: "request-id", mode: "exclusive" }],
  },
  hooks: {
    prepare({ draft, requestId }) {
      draft.headers.set("X-Request-ID", requestId);
    },
  },
};

await api.get("/users").use(requestIdFeature);
```

Feature 순서는 `before`와 `after` 관계로 결정됩니다. 배타적 Capability 충돌, 누락된 요구 사항, 순환 참조는 Transport 실행 전에 실패합니다. 선택적 통합 관계에는 `optionalBefore`와 `optionalAfter`를 사용합니다.

### Feature Runtime 제어

Feature Hook은 요청을 가로채거나 응답을 교체하고 최종 오류를 변환할 수 있습니다.

```ts
const fixtureFeature = {
  name: "fixture",
  hooks: {
    intercept({ request }) {
      if (new URL(request.url).pathname === "/health") {
        return Response.json({ ok: true });
      }
    },
    afterResponse({ response }) {
      return response;
    },
    mapError({ error }) {
      return error;
    },
  },
};

const result = await api
  .get("/health")
  .use(fixtureFeature);

result.meta.transport; // "feature:fixture"
```

Feature는 자신의 요청 범위 `state`와 Feature 간 공유 `metadata`를 받습니다. `intercept`는 Transport를 건너뛸 수 있고, `afterResponse`는 후속 Feature에 전달할 응답을 교체할 수 있으며, `mapError`는 최종 오류를 변환합니다. `mapError`와 `finalize`는 역순으로 실행됩니다.

자세한 실행 순서는 [커널 아키텍처](architecture.md)를 참고하세요.

## 어댑터 테스트

사용자 정의 캐시 어댑터는 프레임워크에 독립적인 적합성 검사를 재사용할 수 있습니다.

```ts
import { runCacheStoreConformance } from "@laflabs/lafetch/testing";

const results = await runCacheStoreConformance(
  () => new RedisCacheStore(),
);

if (results.some((result) => !result.passed)) {
  throw new Error("Invalid CacheStore adapter");
}
```

테스트용 Transport도 별도 export로 제공합니다.

```ts
import { lafetch } from "@laflabs/lafetch";
import { mockTransport } from "@laflabs/lafetch/testing";

const api = lafetch.create({
  baseUrl: "https://api.example.com",
  transport: mockTransport(() => Response.json({ id: "user_123" })),
});
```
