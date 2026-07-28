# Lafetch 상세 사용 가이드

이 문서는 Lafetch v0.3.1의 고급 옵션과 확장 지점을 설명합니다. 처음 사용하는 경우 [README의 기본 사용법](../README.md)부터 확인하세요.

## LResponse, 원본 응답, Streaming 응답

### LResponse

`LRequest`를 직접 `await`하면 `Content-Type`에 따라 자동 디코딩된 `data`와 HTTP 및 실행 메타데이터를 담은 `LResponse<T>`가 반환됩니다.

```ts
const result = await api.get<User>("/users/123");

result.data;
result.ok;
result.status;
result.statusText;
result.headers;
result.url;
result.redirected;
result.type;
result.request;
result.meta.attempts;
```

`LResponse` 객체는 shallow freeze되며 소비자마다 독립적인 `Headers`를 받습니다. 이미 디코딩한 Body의 native `Response` clone은 중복 보관하지 않습니다.

`result.request`는 method, 최종 URL과 Header만 담은 immutable `RequestSnapshot`입니다. upload Body와 native `Request`를 보존하지 않으며 URL user information, credential Header와 token 형태 Query를 제거합니다. 재전송 입력이 아니라 안전한 진단 정보로 사용합니다.

### 원본 Response

```ts
const response = await api.get("/download").as("response");
```

`as("response")`는 native Fetch `Response`가 필요한 유일한 Buffered 경로입니다. 응답 디코딩과 `validate()`를 적용하지 않으며 전체 Body가 기본 16 MiB 상한 안에 들어와야 합니다.

### Streaming 응답

```ts
const response = await api
  .get("/events")
  .timeout("2m")
  .as("stream");

await response.pipe("text").forEach(async (chunk, index) => {
  await saveChunk(index, chunk);
});
```

`as("stream")`은 Status와 Header가 확정되면 실제 Fetch `Response`를 확장한 `LStreamResponse`를 반환합니다. 별도 envelope로 감싸지 않으므로 `status`, `headers`, `body`, `text()`, `arrayBuffer()`, `clone()`과 표준 `ReadableStream` API를 그대로 사용할 수 있습니다.

```ts
response.pipe();                // LStream<Uint8Array>
response.pipe("text");          // LStream<string>
response.pipe(customTransform); // LStream<T>

await response.pipe().pipeTo(writable);
```

`forEach()`는 callback을 순차적으로 `await`합니다. Stream이 끝나면 반환한 `Promise<void>`가 완료되고, source 또는 callback이 실패하면 Stream을 취소한 뒤 같은 오류로 실패합니다. Body가 없는 응답의 `pipe()`는 즉시 닫히는 Stream을 반환합니다.

기존 저수준 API도 제거하지 않습니다.

```ts
const reader = response.body
  ?.pipeThrough(customTransform)
  .getReader();
```

Lafetch는 전체 Body를 보관하지 않으며 Body는 한 소비자만 소유합니다. 같은 `LRequest`에서 Streaming 소비를 반복하거나 Buffered terminal과 혼합하면 `HttpConsumptionError`가 발생합니다.

Streaming은 기본 총량 제한이 없습니다. 제한이 필요한 요청만 `maxResponseBytes()`를 명시합니다.

```ts
const response = await api
  .get("/downloads/report.csv")
  .maxResponseBytes(1024 * 1024 * 1024)
  .as("stream");
```

`validate()`, `cache()`, `dedupe()` 뒤에는 `as("stream")` overload가 TypeScript 자동완성에서 제거되며 JavaScript 우회도 Transport 실행 전에 실패합니다. accepted Body를 노출한 뒤 발생한 오류와 Timeout은 Stream을 실패시키지만 새 시도로 교체하지 않습니다. Body를 끝까지 읽지 않을 때는 `response.body?.cancel()`로 lifecycle을 종료해야 합니다.

## 자동 디코딩과 강제 decoder

기본 자동 소비는 JSON 계열 Content-Type을 객체로, text·XML·form-urlencoded를 문자열로, 그 외 응답을 `Uint8Array`로 디코딩합니다. 빈 JSON과 자동 소비, `HEAD`, `204`, `205`의 데이터는 `undefined`가 될 수 있습니다. 명시적 `text`, `bytes`, `blob`, `formData` 모드는 각각 빈 문자열, 빈 `Uint8Array`, 빈 Blob, 빈 FormData를 반환해 선언된 타입을 유지합니다.

direct `await`가 일반 경로입니다. 서버의 `Content-Type`을 신뢰할 수 없거나 특정 형식이 반드시 필요할 때만 `as("json" | "text" | "bytes" | "blob" | "formData")`로 decoder를 강제합니다.

```ts
const json: User = await api.get<User>("/legacy-user").as("json"); // text/plain으로 잘못 표시된 JSON
const text: string = await api.get("/health").as("text");
const bytes: Uint8Array = await api.get("/binary").as("bytes");
const blob: Blob = await api.get("/file").as("blob");
const form: FormData = await api.get("/form").as("formData");
```

응답 데이터 타입은 모든 HTTP 진입 메서드의 제네릭으로 한 번만 선언합니다. `as<T>(mode)`처럼 terminal에서 타입을 다시 지정하는 문법은 제공하지 않습니다.

`validate(schema)`는 decoder 이후에 실행됩니다. Schema가 값을 변환했다면 direct `await`는 `LResponse<SchemaOutput>`, `as(mode)`는 `Promise<SchemaOutput>`을 반환합니다. 따라서 `as("text")`처럼 명시적 decoder를 사용해도 최종 값은 Schema 출력입니다.

`as(mode)`는 실제 `Promise`를 반환합니다. 모드는 닫힌 literal union이며 JavaScript의 알 수 없는 값도 기본 동작으로 처리하지 않고 `HttpConfigurationError`로 거부합니다. terminal 뒤에는 `LRequest` 설정을 연결할 수 없고, `stream`도 실행 전에 소비 전략을 확정하는 같은 규칙을 사용합니다.

## Promise 호환성과 실행 불변식

`LRequest<T>`는 지연 실행되는 `PromiseLike<LResponse<T>>`입니다. 공개 generic에는 데이터 타입 하나만 보이며, 요청 본문 허용 여부, 향후 Streaming 선택, Schema 출력 보존에 필요한 상태는 내부에서만 추적합니다.

```ts
api
  .get<User>("/users/123")
  .then((response) => render(response.data))
  .catch(handleError)
  .finally(stopLoading);
```

Buffered `LRequest`를 여러 소비자가 사용해도 Transport 실행은 한 번만 일어납니다. 각 소비자는 보관된 응답의 독립적인 복제본을 디코딩합니다. Streaming `LRequest`는 한 번만 소비할 수 있으며 반환된 Promise 자체를 공유해야 합니다.

```ts
const request = api.get<User>("/users/123");

const name = request.then((response) => response.data.name);
const email = request.then((response) => response.data.email);

await Promise.all([name, email]);
```

체이닝 메서드를 호출하면 기존 `LRequest`를 변경하지 않고 별도의 실행 식별자를 가진 `LRequest`를 만듭니다.

## Logical lifecycle

`api.on(handler)`는 해당 client의 모든 요청에, `request.on(handler)`는 하나의 immutable request에 적용됩니다. client handler가 먼저 실행되고 같은 범위에서는 등록 순서를 유지합니다.

```ts
const api = lafetch
  .create({ baseUrl: "https://api.example.com" })
  .on(async (event) => {
    if (event.type === "request") {
      event.request = event.request.header(
        "Authorization",
        `Bearer ${await getToken()}`,
      );
    }

    if (event.type === "response") {
      console.log(event.response.status);
      console.log(event.response.meta.attempts);
    }
  });

await api
  .get<User>("/users/123")
  .on((event) => {
    if (event.type === "request") {
      event.request = event.request.timeout("3s");
    }
  });
```

`LRequest`는 immutable이므로 `event.request.header()`가 만든 새 request를 event에 다시 연결합니다. lifecycle request draft는 설정 전용이라 직접 `await`할 수 없고, 다른 client나 다른 logical request에서 만든 `LRequest`로 교체할 수도 없습니다.

- `request`: Retry 전체가 시작되기 전에 한 번
- `response`: 자동 decoding과 validation 뒤 direct `LResponse`가 만들어질 때 한 번
- 전체 시도 수: `event.response.meta.attempts`
- attempt별 event: `.telemetry()`의 `attempt:*`

`as("json")`, `as("response")`, `as("stream")` 같은 explicit terminal은 각각 data, native `Response`, live `LStreamResponse`를 직접 반환하므로 `response` lifecycle event를 만들지 않습니다. request event는 terminal과 관계없이 적용됩니다.

## 요청 구성

```ts
const { data: user } = await api
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

하나의 요청에는 `json()`, `body()`, `bodyFactory()` 중 하나만 설정할 수 있습니다. 이미 설정한 본문을 다른 메서드로 조용히 덮어쓰지 않고 선언 시점에 `HttpConfigurationError`를 발생시킵니다.

`query()`는 모든 HTTP 메서드에서 사용할 수 있습니다. 반면 Fetch는 GET과 HEAD 요청 본문을 허용하지 않으므로 해당 `LRequest`에서는 `json()`, `body()`, `bodyFactory()`가 노출되지 않습니다. JavaScript에서 같은 메서드를 호출하면 Transport 실행 전에 `HttpConfigurationError`가 발생합니다.

```ts
await api
  .get<User[]>("/users")
  .query({ active: true });
```

본문을 사용하는 안전하고 멱등적인 조회 API가 필요하고 서버가 지원한다면 사용자 정의 `QUERY` 메서드를 사용할 수 있습니다.

```ts
await api
  .request<SearchResult>("QUERY", "/search")
  .json({ filters })
  .as("json");
```

표준 capability 조회는 bodyless `options()` named method를 사용합니다.

```ts
await api.options("/capabilities");
```

Body가 필요한 비표준 OPTIONS 요청은 명시적인 `request("OPTIONS", url)`을 사용합니다.

자격 증명의 기본값은 `"omit"`입니다. 클라이언트 또는 요청에서 명시적으로 활성화할 수 있습니다.

```ts
const api = lafetch.create({ credentials: "same-origin" });

await api.get("/session").credentials("include");
```

Credentials는 Fetch 표준의 `"omit"`, `"same-origin"`, `"include"`만 허용합니다.

### 고급 RequestInit

기존 요청 문법이 소유하지 않는 stable Fetch option은 `requestInit()` 하나로 전달합니다.

```ts
await api
  .get("/download")
  .requestInit({
    redirect: "manual",
    cache: "no-store",
    priority: "high",
  });
```

허용 필드는 `cache`, `integrity`, `keepalive`, `mode`, `priority`, `redirect`, `referrer`, `referrerPolicy`입니다. `method`, `headers`, `body`, `signal`, `credentials`는 각각 기존 Lafetch 메서드와 lifecycle이 소유하므로 거부합니다. Browser가 생성하는 `mode: "navigate"`도 사용할 수 없습니다.

`requestInit.cache`는 Fetch의 native HTTP cache mode이고 `.cache(ttl)`는 Lafetch application Cache입니다. 두 계층의 의미가 조용히 충돌하지 않도록 같은 요청에서 함께 사용할 수 없습니다. 런타임 Request constructor가 지원하지 않는 조합은 `HttpConfigurationError`로 정규화됩니다.

## 제한 시간

전체 요청과 개별 시도는 서로 다른 메서드로 설정합니다.

```ts
await api
  .get<User>("/users/123")
  .timeout("20s")
  .attemptTimeout("5s");
```

사용자 취소는 `HttpAbortError`, 제한 시간 초과는 `HttpTimeoutError`를 발생시킵니다. Timeout 오류의 `scope`는 `"total"` 또는 `"attempt"`입니다.

Buffered 응답은 실제 수신 바이트를 기준으로 기본 16 MiB까지 보관합니다. 요청 특성에 맞는 다른 상한은 명시적으로 설정할 수 있습니다. 서버의 `Content-Length` 값만 신뢰하지 않고 실제 body chunk를 계산하며, 초과하면 `HttpResponseTooLargeError`가 발생합니다.

```ts
await api
  .get<Report>("/reports/1")
  .maxResponseBytes(2 * 1024 * 1024);
```

Streaming은 설정이 없으면 총량을 제한하지 않지만, `maxResponseBytes()`를 명시하면 실제 전달 chunk를 누적해 같은 오류를 발생시킵니다. 전체 Timeout, 시도 Timeout, 사용자 Abort는 Streaming Body가 종료될 때까지 유지됩니다.

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
  maxRetryAfter: "1m",
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

`Retry-After`의 delay-seconds와 HTTP-date는 기본적으로 따르지만 일반 Backoff의 `max`와는 별도 정책입니다. `maxRetryAfter`의 기본값은 1분입니다. 서버가 이보다 긴 대기를 요구하면 상한만큼 기다렸다가 일찍 재시도하지 않고 해당 응답을 최종 결과로 처리합니다. 잘못된 `Retry-After`는 무시하고 일반 Backoff를 사용하며, `respectRetryAfter: false`로 server-directed delay를 끌 수 있습니다.

RateLimit Header는 아직 active Internet-Draft이므로 자동 재시도 신호로 해석하지 않습니다. `X-RateLimit-*` 같은 비표준 Header도 core에서 자동 처리하지 않습니다. 현재 결정과 남은 custom predicate 범위는 [v0.4 Retry 결정 RFC](rfcs/v0.4-retry-decision.md)에 정리합니다.

기존 `ReadableStream`은 다시 재생할 수 없습니다. 재시도마다 새로운 본문을 만들 수 있을 때만 `bodyFactory()`를 사용합니다.

```ts
await api
  .post<void>("/upload")
  .bodyFactory(() => createUploadStream())
  .retry(1, { methods: ["POST"] });
```

## 요청 취소

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
const { data: users } = await api
  .get<User[]>("/users")
  .cache("30s")
  .dedupe();
```

기본 Cache와 진행 중 요청 Registry는 `lafetch.create()`로 만든 클라이언트마다 격리됩니다. 키와 민감 요청 여부는 모든 `beforeAttempt` Feature가 헤더와 자격 증명을 적용한 최종 `Request`에서 계산합니다. 인증 정보, 토큰 형태의 쿼리, `Set-Cookie`, 제한적인 Cache-Control, `Vary`는 기본 Cache를 우회합니다. 안전하지 않은 메서드는 호출자가 책임지는 명시적인 키가 필요하며 `methods: ["POST"]`만으로 이 규칙을 우회할 수 없습니다.

```ts
await api
  .post<SearchResult>("/search")
  .json(filters)
  .cache("30s", { key: `search:${stableHash(filters)}` });
```

호출자가 같은 Store를 전달한 경우에만 여러 클라이언트가 Cache를 공유합니다.

```ts
import { MemoryCacheStore } from "@laflabs/lafetch/cache";

const store = new MemoryCacheStore(1_000);

await api
  .get<Catalog>("/catalog")
  .cache("5m", { store });
```

외부 Store 장애는 기본적으로 요청 실패로 드러납니다. Cache가 성공 조건이 아니고 origin으로의 fallback을 의도한 경우에만 `"bypass"`를 선택합니다.

```ts
await api
  .get<Catalog>("/catalog")
  .cache("5m", {
    store,
    storeFailure: "bypass",
  });
```

`CacheStore` adapter는 `get()`, `set()`, `delete()`를 구현하고 `@laflabs/lafetch/testing`의 `runCacheStoreConformance()`으로 Body·Header 격리, 만료, overwrite와 동시 읽기를 검증해야 합니다. `"bypass"`는 Store 오류를 반환 결과에서 제거하므로 adapter가 자체 logging과 metrics를 제공해야 합니다.

세부 규칙은 [Cache와 Deduplication 설계](cache-deduplication.md)를 참고하세요.

## 멱등성

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

`validate()`는 Standard Schema V1, 함수 또는 `parse()`나 `validate()` 메서드가 있는 객체를 받습니다. 검증과 반환 타입 변환을 함께 지원합니다.

요청에는 하나의 최종 Response Schema만 선언할 수 있습니다. 여러 검증 단계를 사용하려면 하나의 Schema 안에서 조합하며, 뒤의 `validate()`가 앞의 Schema를 조용히 덮어쓰지 않습니다.

```ts
const userSchema = {
  parse(value: unknown): User {
    return validateUser(value);
  },
};

const { data: user } = await api
  .get("/users/123")
  .validate(userSchema);
```

Zod, Valibot처럼 Standard Schema V1을 구현한 validator는 별도 Lafetch adapter 없이 전달합니다. Schema가 vendor-specific `parse()`와 `~standard`를 함께 제공하면 vendor-neutral Standard Schema 계약을 우선합니다. 검증 실패의 `issues`와 validator가 throw한 `cause`는 `HttpSchemaError`에 보존됩니다.

## 오류 좁히기

`catch`의 `unknown` 오류는 `isHttpError(error, code?)`로 좁힙니다.

```ts
try {
  await api.get("/reports/1").timeout("1s");
} catch (error) {
  if (isHttpError(error, "ERR_HTTP_TIMEOUT")) {
    error.scope;
    error.timeoutMs;
  }
}
```

code를 생략하면 `HttpError`, stable code를 전달하면 해당 오류 subtype으로 추론합니다. guard는 `instanceof`만 사용하지 않으므로 같은 runtime에 Lafetch가 중복 설치된 경우에도 동작하며, 구조만 비슷한 일반 객체는 오류로 분류하지 않습니다.

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
const { data: job } = await api
  .get<Job>("/jobs/123")
  .acceptStatus((status) => status === 200 || status === 404);
```

## 관찰과 Telemetry

```ts
await api
  .get<Health>("/health")
  .telemetry((event) => {
    sendToCollector(event);
  });
```

이벤트 전달은 `request:start`, 각 시도의 시작·응답·오류, 최종 `request:success` 또는 `request:error` 순서로 시작되지만 비동기 Handler의 완료 순서를 직렬화하지는 않습니다. 요청 본문은 포함하지 않고 민감한 헤더와 쿼리를 제거합니다. 공식 Telemetry는 관찰 전용 비동기 전달이므로 느리거나 실패한 Handler가 HTTP 결과를 막지 않습니다. 애플리케이션 종료 전에 순서 보장이나 전송 완료가 필요하면 수집기 구현이 자체 queue와 flush 수명주기를 제공해야 합니다.

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

커널은 `send()` 대기를 시도 Timeout·전체 Timeout과 경쟁시켜, Transport가 실수로 Signal을 무시해도 요청 Promise는 제한 시간 안에 종료합니다. 다만 이미 시작된 I/O 자원을 실제로 정리하려면 Transport 구현도 반드시 `context.signal`을 하위 런타임에 전달해야 합니다.

## 사용자 정의 Feature

공식 정책은 전용 `LRequest` 메서드를 사용하고 외부 기능만 `.use()`로 설치합니다.

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
