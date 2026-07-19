# Lafetch 상세 사용 가이드

이 문서는 Lafetch v0.2의 고급 옵션과 확장 지점을 설명합니다. 처음 사용하는 경우 [README의 기본 사용법](../README.md)부터 확인하세요.

## 데이터, 전체 응답, 원본 응답

### 데이터

Builder를 직접 `await`하면 `Content-Type`에 따라 자동 디코딩된 데이터가 반환됩니다.

```ts
const user = await api.get<User>("/users/123");
```

### 전체 응답

`response()`는 데이터와 HTTP 및 실행 메타데이터를 함께 반환합니다.

```ts
const result = await api
  .get<User>("/users/123")
  .response();

result.data;
result.status;
result.statusText;
result.headers;
result.request;
result.response;
result.meta.attempts;
```

### 원본 Response

```ts
const response = await api.get("/download").raw();
```

`raw()`는 응답 디코딩과 `validate()`를 적용하지 않습니다.

## 응답 형식

기본 `auto` 모드는 JSON 계열 Content-Type을 객체로, text·XML·form-urlencoded를 문자열로, 그 외 응답을 `ArrayBuffer`로 디코딩합니다. 빈 응답과 `HEAD`, `204`, `205`는 `undefined`를 반환합니다.

서버의 Content-Type을 신뢰할 수 없거나 특정 형식이 필요하면 `as()`를 사용합니다.

```ts
const json = await api.get<User>("/user").as("json");
const text = await api.get<string>("/health").as("text");
const bytes = await api.get<ArrayBuffer>("/binary").as("arrayBuffer");
const blob = await api.get<Blob>("/file").as("blob");
const form = await api.get<FormData>("/form").as("formData");
```

허용되는 값은 `"auto"`, `"json"`, `"text"`, `"arrayBuffer"`, `"blob"`, `"formData"`입니다. TypeScript는 다른 값을 컴파일 단계에서 거부하고, JavaScript에서도 요청 전에 `HttpConfigurationError`가 발생합니다.

## Promise 호환성과 실행 불변식

`RequestBuilder<T>`는 지연 실행되는 `PromiseLike<T>`입니다.

```ts
api
  .get<User>("/users/123")
  .then((user) => render(user))
  .catch(handleError)
  .finally(stopLoading);
```

하나의 Builder를 여러 소비자가 사용해도 Transport 실행은 한 번만 일어납니다. 각 소비자는 보관된 응답의 독립적인 복제본을 디코딩합니다.

```ts
const request = api.get<User>("/users/123");

const name = request.then((user) => user.name);
const email = request.then((user) => user.email);

await Promise.all([name, email]);
```

체이닝 메서드를 호출하면 기존 Builder를 변경하지 않고 별도의 실행 식별자를 가진 Builder를 만듭니다.

## 요청 구성

```ts
const user = await api
  .post<User>("/users")
  .query({ notify: true, tag: ["new", "member"] })
  .header("X-Request-Source", "admin")
  .json({ name: "Dohyun" });
```

원시 `BodyInit`은 `body()`로 전달합니다.

```ts
await api
  .post<void>("/upload")
  .body(formData);
```

자격 증명의 기본값은 `"omit"`입니다. 클라이언트 또는 요청에서 명시적으로 활성화할 수 있습니다.

```ts
const api = lafetch.create({ credentials: "same-origin" });

await api.get("/session").credentials("include");
```

Credentials는 Fetch 표준의 `"omit"`, `"same-origin"`, `"include"`만 허용합니다.

## Timeout

전체 요청과 개별 시도는 서로 다른 메서드로 설정합니다.

```ts
await api
  .get<User>("/users/123")
  .timeout("20s")
  .attemptTimeout("5s");
```

사용자 취소는 `HttpAbortError`, 제한 시간 초과는 `HttpTimeoutError`를 발생시킵니다. Timeout 오류의 `scope`는 `"total"` 또는 `"attempt"`입니다.

## Retry와 Backoff

첫 번째 인자는 최초 시도 이후의 추가 재시도 횟수입니다.

```ts
await api.get<User>("/users/123").retry(2);
```

고급 설정은 두 번째 인자에서 구성합니다.

```ts
await api.get<User>("/users/123").retry(2, {
  statuses: [408, 429, 500, 502, 503, 504],
  networkErrors: true,
  respectRetryAfter: true,
  backoff: {
    type: "exponential",
    base: "200ms",
    max: "10s",
    jitter: "full",
  },
});
```

기본 재시도 메서드는 `GET`, `HEAD`, `OPTIONS`입니다. 전체 Timeout과 사용자 Abort는 최종 실패이며, 허용된 메서드의 개별 시도 Timeout은 재시도할 수 있습니다.

Backoff `type`은 `"fixed"` 또는 `"exponential"`, `jitter`는 `"none"` 또는 `"full"`만 허용합니다. v0.1의 축약형 `backoff: "fixed"`는 더 이상 허용하지 않습니다. 잘못된 값과 객체 형태는 기본값으로 대체하지 않고 요청 선언 시 `HttpConfigurationError`를 발생시킵니다.

기존 `ReadableStream`은 다시 재생할 수 없습니다. 재시도마다 새로운 본문을 만들 수 있을 때만 `bodyFactory()`를 사용합니다.

```ts
await api
  .post<void>("/upload")
  .bodyFactory(() => createUploadStream())
  .retry(1, { methods: ["POST"] });
```

## Abort

```ts
const controller = new AbortController();

const request = api
  .get<Report>("/reports/1")
  .signal(controller.signal);

controller.abort();
```

## Cache와 Deduplication

Cache는 완료된 응답을 재사용하고, Deduplication은 동시에 진행 중인 동일 요청만 공유합니다.

```ts
const users = await api
  .get<User[]>("/users")
  .cache("30s")
  .dedupe();
```

기본 Cache와 진행 중 요청 Registry는 `lafetch.create()`로 만든 클라이언트마다 격리됩니다. 인증 정보, 토큰 형태의 쿼리, `Set-Cookie`, 제한적인 Cache-Control, `Vary`는 기본 Cache를 우회합니다. 안전하지 않은 메서드는 호출자가 책임지는 명시적인 키가 필요합니다.

호출자가 같은 Store를 전달한 경우에만 여러 클라이언트가 Cache를 공유합니다.

```ts
import { MemoryCacheStore } from "@laflabs/lafetch";

const store = new MemoryCacheStore(1_000);

await api
  .get<Catalog>("/catalog")
  .cache("5m", { store });
```

세부 규칙은 [Cache와 Deduplication 설계](cache-deduplication.md)를 참고하세요.

## Idempotency

Idempotency는 하나의 재시도 시퀀스에서 안정적인 키를 유지합니다.

```ts
await api
  .post<Payment>("/payments")
  .json(input)
  .idempotency()
  .retry(2);
```

기존 `Idempotency-Key`는 유지됩니다. `retry()`에 메서드 목록이 없으면 현재 쓰기 메서드를 재시도 가능하게 만들지만, 사용자가 명시한 목록은 변경하지 않습니다.

## 응답 검증

`validate()`는 함수 또는 `parse()`나 `validate()` 메서드가 있는 객체를 받습니다. 검증과 반환 타입 변환을 함께 지원합니다.

```ts
const userSchema = {
  parse(value: unknown): User {
    return validateUser(value);
  },
};

const user = await api
  .get("/users/123")
  .validate(userSchema);
```

## 오류 매핑

하나의 `mapError()`가 요청 실행과 응답 소비 실패를 모두 처리합니다.

```ts
await api
  .get<User>("/users/123")
  .validate(userSchema)
  .mapError((error, context) => {
    if (context.phase === "response") {
      return new InvalidPayloadError({ cause: error });
    }
    return mapApiError(error);
  });
```

`context.phase`는 `"request"` 또는 `"response"`입니다. 여러 Mapper를 연결하면 마지막에 선언한 Mapper부터 역순으로 실행합니다.

기본 성공 범위는 HTTP `200–299`입니다. 다른 상태를 정상 응답으로 처리해야 한다면 요청에 명시합니다.

```ts
const job = await api
  .get<Job>("/jobs/123")
  .acceptStatus((status) => status === 200 || status === 404);
```

## Telemetry

```ts
await api
  .get<Health>("/health")
  .telemetry((event) => {
    sendToCollector(event);
  });
```

이벤트는 `request:start`, 각 시도의 시작·응답·오류, 최종 `request:success` 또는 `request:error` 순서로 발생합니다. 요청 본문은 포함하지 않고 민감한 헤더와 쿼리를 제거합니다. 공식 Telemetry는 관찰 전용이므로 Handler 실패가 HTTP 요청의 결과를 바꾸지 않습니다.

여러 수집기를 설치할 때만 고유한 이름을 지정합니다.

```ts
await api
  .get<Health>("/health")
  .telemetry(sendToMetrics, { name: "metrics" })
  .telemetry(sendToTrace, { name: "trace" });
```

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

## 사용자 정의 Feature

공식 정책은 전용 Builder 메서드를 사용하고 외부 기능만 `.use()`로 설치합니다.

```ts
import { defineFeature } from "@laflabs/lafetch/feature";

const requestId = defineFeature({
  name: "request-id",
  hooks: {
    prepare({ draft, requestId }) {
      draft.headers.set("X-Request-ID", requestId);
    },
  },
});

await api.get<User[]>("/users").use(requestId);
```

Feature 순서는 `before`와 `after` 관계로 결정됩니다. Capability 충돌, 누락된 요구 사항, 순환 참조는 Transport 실행 전에 실패합니다. 자세한 생명주기는 [커널 아키텍처](architecture.md)를 참고하세요.

## 어댑터 테스트

```ts
import { runCacheStoreConformance } from "@laflabs/lafetch/testing";

const results = await runCacheStoreConformance(
  () => new RedisCacheStore(),
);
```

테스트용 Transport도 별도 진입점에서 제공합니다.

```ts
import { mockTransport } from "@laflabs/lafetch/testing";

const api = lafetch.create({
  transport: mockTransport(() => Response.json({ ok: true })),
});
```
