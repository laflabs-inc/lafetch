# Lafetch

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

> 데이터와 HTTP 문맥은 함께 받고, 실패 정책은 읽기 쉽게.

Lafetch는 Fetch 표준 위에서 동작하는 TypeScript HTTP 클라이언트입니다. 평범한 요청은 짧게 작성하고, Timeout·Retry·Cache처럼 실패 상황을 다루는 정책은 요청 코드 안에서 명확하게 선언합니다.

## 설치

현재 소스 버전은 `0.4.0-alpha.1`이며 아직 npm 공개 배포 전입니다. 첫 pre-release가 배포된 뒤부터 아래 명령으로 설치합니다.

```bash
npm install @laflabs/lafetch
```

## 시작하기

모든 요청은 명시적으로 생성한 클라이언트에서 시작합니다.

```ts
import { lafetch } from "@laflabs/lafetch";

type User = { id: string; name: string };

const api = lafetch.create({
  baseUrl: "https://api.example.com",
});

const response = await api.get<User>("/users/123");

response.data;    // User
response.status;  // number
response.headers; // Headers
```

기본 반환값은 `LResponse<User>`입니다. 서버의 `Content-Type`에 따라 디코딩된 값은 항상 `response.data`에 있고, HTTP 상태와 실행 메타데이터도 같은 응답에서 확인할 수 있습니다. JSON API에 별도의 종결 메서드를 반복할 필요는 없습니다.

## JSON 보내기

```ts
const response = await api
  .post<User>("/users")
  .json({ name: "Dohyun" });

response.data;
```

## 실패 정책 추가하기

```ts
const { data: users } = await api
  .get<User[]>("/users")
  .timeout("3s")
  .retry(2);
```

`retry(2)`는 최초 요청이 실패하면 최대 두 번 더 시도한다는 뜻입니다.

## Logical lifecycle

Client에 `.on(handler)`를 등록하면 요청 직전에 최신 인증 토큰을 공통으로 추가할 수 있습니다.

```ts
type User = { id: string; name: string };

const api = lafetch
  .create({ baseUrl: "https://api.example.com" })
  .on(async (event) => {
    if (event.type !== "request") return;

    const accessToken = await getAccessToken();
    event.request = event.request.header(
      "Authorization",
      `Bearer ${accessToken}`,
    );
  });

const { data: me } = await api.get<User>("/me");
```

Client handler는 모든 요청에 적용되고, request handler를 추가하면 한 요청에만 적용할 수 있습니다. `request`와 `response`는 Retry attempt마다 반복되지 않고 logical request에서 각각 한 번 실행됩니다. 전체 시도 횟수는 `response` event의 `event.response.meta.attempts`, attempt별 관찰은 `.telemetry()`에서 확인합니다. `response` event는 실제 `LResponse`를 만드는 direct `await`·`then`·`catch`·`finally`에서만 발생하며, 값을 직접 반환하는 `as(mode)` terminal은 다시 `LResponse`로 포장하지 않습니다.

## 왜 Lafetch인가요?

### 편의성

- 생성, 요청, 설정, 실행이 한 방향으로 이어집니다.
- 직접 `await`하면 자동 디코딩된 `.data`와 HTTP metadata를 담은 `LResponse`가 반환됩니다.
- JSON 본문은 `.json(value)`, 응답 검증은 `.validate(schema)`처럼 이름만으로 역할을 알 수 있습니다.
- `await`, `then`, `catch`, `finally`를 일반 Promise처럼 사용할 수 있습니다.
- 단순한 사용법과 고급 사용법이 서로 다른 API 규칙으로 갈라지지 않습니다.

### 안정성

- 안전한 HTTP 메서드만 기본 재시도합니다.
- 전체 Timeout과 개별 시도 Timeout을 구분합니다.
- 재생할 수 없는 요청 본문은 위험한 재시도 전에 거부합니다.
- Cache와 진행 중 요청 Deduplication은 클라이언트별로 격리됩니다.
- 인증 정보가 포함된 요청은 기본 Cache와 Deduplication을 우회합니다.
- Transport, HTTP 상태, 디코딩, 스키마 오류를 구조적으로 구분합니다.
- 잘못된 요청 옵션은 선언 시점에 `HttpConfigurationError`로 정규화합니다.
- Browser, Node.js, Next.js, Workers/Edge에서 같은 계약을 검증합니다.

## 하나의 사용 규칙

```text
lafetch.create() → api.method(url) → body/config/policy → await
```

- `lafetch`는 `create()`만 제공합니다.
- `create()`는 공통 환경 설정과 상태 격리 경계를 만듭니다.
- `get()`, `post()` 같은 HTTP 메서드는 URL만 받습니다.
- 헤더, 쿼리, 본문, 정책은 체이닝 메서드로 설정합니다.
- `LRequest`를 직접 `await`하면 `Content-Type` 기반 자동 디코딩 결과를 담은 `LResponse`가 반환됩니다.
- 사용자 정의 HTTP 메서드는 `request(method, url)`을 사용합니다.
- 사용자 정의 Feature만 `.use(feature)`를 사용합니다.

같은 동작을 여러 방식으로 표현하지 않아 팀마다 사용법이 달라지는 문제를 줄입니다.

## 필요한 만큼만 드러나는 LRequest

Lafetch는 기능을 줄이는 대신, 확실히 사용할 수 없는 메서드를 현재 요청의 IDE 자동완성에서 제외합니다. Fetch가 요청 본문을 허용하지 않는 GET과 HEAD에서는 `json()`, `body()`, `bodyFactory()`가 나타나지 않습니다.

```ts
const { data: users } = await api
  .get<User[]>("/users")
  .query({ active: true })
  .cache("30s");
```

JSON 요청 본문이 필요한 메서드에서는 같은 기능을 그대로 사용합니다.

```ts
const { data: user } = await api
  .post<User>("/users")
  .json({ name: "Dohyun" })
  .idempotency({ key: requestId })
  .retry(2);
```

TypeScript에서 차단한 조합은 JavaScript에서도 요청 선언 시 `HttpConfigurationError`로 실패하며 Transport에 도달하지 않습니다. 세부 정책 충돌은 Feature Runtime이 실행 전에 검증하므로 고급 기능을 타입 상태로 과도하게 누적하지 않습니다.

## 기본 LResponse

`LRequest`를 직접 `await`하면 `LResponse<T>`를 반환합니다.

```ts
const response = await api
  .get<User>("/users/123");

response.data;
response.ok;
response.status;
response.headers;
response.request;       // redacted RequestSnapshot
response.meta.attempts;
```

`LResponse`는 Body가 이미 디코딩된 envelope이므로 native `Response`를 상속하거나 원본 Body를 중복 보관하지 않습니다. `response.request`도 upload Body와 원본 credential Header 대신 redacted `RequestSnapshot`을 제공합니다. Fetch `Response`가 필요하면 요청을 `as("response")`로 종료합니다. 이 모드도 안전한 다중 소비를 위해 기본 16 MiB 안에서 전체 Body를 버퍼링합니다.

실시간 Body가 필요하면 `as("stream")`을 사용합니다.

```ts
const response = await api
  .get("/events")
  .timeout("2m")
  .as("stream");

await response.pipe("text").forEach((chunk) => {
  console.log(chunk);
});
```

`as("stream")`은 Header가 확정되면 실제 Fetch `Response`에 얇은 편의 인터페이스를 더한 `LStreamResponse`를 반환합니다. `status`, `headers`, `body`, `text()`, `clone()`과 `body.pipeThrough()` 같은 표준 기능은 그대로 유지됩니다.

- `response.pipe()`는 nullable Body 처리가 필요 없는 byte Stream을 반환합니다.
- `response.pipe("text")`는 text Stream을 반환합니다.
- `response.pipe(transform)`은 표준 `ReadableWritablePair`를 적용합니다.
- 반환된 Stream의 `forEach()`는 각 callback을 순서대로 기다려 backpressure를 유지합니다.

같은 `LRequest`에서는 Streaming을 한 번만 시작할 수 있고, Body 노출 뒤에는 Retry하지 않습니다. Cache, Deduplication, 전체 Body Schema validation과는 함께 사용할 수 없습니다.

## 자동 디코딩과 형식 강제

일반 요청의 기본 문법은 직접 `await`하는 것입니다. 서버의 `Content-Type`이 정확하다면 JSON API에서도 `as("json")`을 반복할 필요가 없습니다.

| 문법 | 동작 | 권장 사용처 |
| --- | --- | --- |
| `await request` | `Content-Type`으로 `.data`를 자동 디코딩한 `LResponse` | 일반 요청 |
| `request.as("json")` | Header와 무관하게 JSON decoding을 강제하고 값을 직접 반환 | 잘못된 `Content-Type`을 보내는 API |
| `request.as(dataMode)` | 지정 형식의 값을 직접 반환 | text·bytes·blob·formData가 필요할 때 |
| `request.as("response")` | Buffered Fetch `Response` | 표준 `Response`를 직접 다룰 때 |
| `request.as("stream")` | live Fetch `Response` | Body를 실시간 소비할 때 |

예를 들어 서버가 JSON Body를 `text/plain`으로 잘못 표시할 때만 decoder를 강제합니다.

```ts
const user: User = await api.get<User>("/legacy/users/123").as("json");
const health: string = await api.get("/health").as("text");
const bytes: Uint8Array = await api.get("/files/1").as("bytes");
const file: Blob = await api.get("/files/1").as("blob");
```

`as(mode)`는 결과 형식과 함께 반환 형태까지 명시하는 실제 `Promise` terminal입니다. 데이터 mode를 선택했다면 `.data`를 한 번 더 거치지 않습니다.

응답 데이터 타입은 `get<T>()`, `post<T>()` 같은 HTTP 메서드에서 한 번만 선언합니다. `as<T>(mode)` 같은 타입 단언 문법은 제공하지 않으므로 서로 다른 타입을 중복 선언할 수 없습니다.

`validate(schema)`는 Standard Schema V1과 기존 function·`parse`·`validate` adapter를 지원합니다. Schema가 값을 변환하면 직접 `await`의 `LResponse.data`와 data mode의 직접 반환 타입이 모두 Schema 출력 타입을 따릅니다. 타입 선언만으로 런타임 데이터가 검증되는 것은 아니며, 실제 보장이 필요할 때 `validate(schema)`를 사용합니다.

지원 모드는 `json`, `text`, `bytes`, `blob`, `formData`, `response`, `stream`입니다. 앞의 다섯 mode는 decoder 결과를 직접 반환하고, 뒤의 두 mode는 native Fetch 응답 소유권을 선택합니다. 알 수 없는 mode는 Transport 실행 전에 거부합니다.

## 주요 기능

| 기능 | 사용법 | 역할 |
| --- | --- | --- |
| Query | `.query({ page: 1 })` | URL 쿼리 구성 |
| Headers | `.header("X-Key", value)` | 요청 헤더 구성 |
| Native Fetch options | `.requestInit({ redirect: "manual" })` | 고급 `RequestInit` 전달 |
| JSON Body | `.json(value)` | JSON 직렬화와 Content-Type 설정 |
| Timeout | `.timeout("3s")` | 전체 요청 제한 시간 |
| Attempt Timeout | `.attemptTimeout("1s")` | 개별 시도 제한 시간 |
| Response Limit | `.maxResponseBytes(1_000_000)` | Buffered 또는 명시적 Streaming 실제 바이트 상한 |
| Streaming | `.as("stream")` | Header 우선 단일 소비 `Response` |
| Retry & Backoff | `.retry(2)` | 안전한 재시도와 지연 |
| Abort | `.signal(signal)` | 표준 `AbortSignal` 취소 |
| Cache | `.cache("30s")` | 완료된 안전한 응답 재사용 |
| Deduplication | `.dedupe()` | 동시에 발생한 동일 요청 공유 |
| Idempotency | `.idempotency()` | 쓰기 재시도의 키 유지 |
| Validation | `.validate(schema)` | 응답 검증과 타입 변환 |
| Error Mapping | `.mapError(mapper)` | 도메인 오류 변환 |
| Telemetry | `.telemetry(handler)` | 요청 생명주기 관찰 |
| Logical lifecycle | `.on(handler)` | `LRequest` 구성과 최종 `LResponse` 처리 |

고급 설정과 전체 예제는 [상세 사용 가이드](docs/advanced-usage.md)에 분리되어 있습니다.

## 안전한 기본값

- 자격 증명은 기본적으로 전송하지 않습니다.
- 기본 성공 범위는 HTTP `200–299`입니다.
- 기본 재시도 메서드는 `GET`, `HEAD`, `OPTIONS`입니다.
- `Retry-After`는 일반 Backoff와 분리해 최대 1분까지만 따르며, 그보다 길면 더 일찍 재시도하지 않습니다.
- 기본 메모리 Cache는 500개 항목으로 제한됩니다.
- Buffered 응답은 기본 16 MiB로 제한되며 요청별로 명시적인 상한을 지정할 수 있습니다.
- Streaming은 기본 총량 제한 없이 backpressure를 따르며, `maxResponseBytes()`를 명시한 요청만 누적 전달량을 제한합니다.
- 인증 헤더, 토큰 형태의 쿼리, `Set-Cookie`, 제한적인 `Cache-Control`, `Vary`는 기본 Cache를 우회합니다.
- 요청 본문은 Telemetry에 포함하지 않습니다.
- 진단 데이터에서 인증 헤더와 토큰 형태의 쿼리를 제거합니다.
- Telemetry 수집기 장애는 HTTP 요청의 결과와 격리합니다.
- Feature 충돌과 실행 순환 참조는 네트워크 요청 전에 실패합니다.

## 오류 모델

- `HttpTransportError`
- `HttpTimeoutError`
- `HttpAbortError`
- `HttpStatusError`
- `HttpDecodeError`
- `HttpConsumptionError`
- `HttpSchemaError`
- `HttpConfigurationError`
- `HttpFeatureConflictError`
- `HttpFeatureError`
- `HttpNonReplayableBodyError`
- `HttpResponseTooLargeError`

하나의 `.mapError()`가 요청 실행과 응답 소비의 최종 실패를 모두 처리합니다. 재시도 판단이 끝난 뒤 오류를 변환하므로 도메인 오류 매핑이 재시도 안전성을 바꾸지 않습니다.

`catch`의 `unknown` 오류는 하나의 stable guard로 좁힙니다.

```ts
import { isHttpError } from "@laflabs/lafetch";

try {
  await api.get("/users/1").timeout("1s");
} catch (error) {
  if (isHttpError(error, "ERR_HTTP_TIMEOUT")) {
    console.log(error.scope, error.timeoutMs);
  }
}
```

## 실행 환경

| 환경 | 자동 검증 |
| --- | --- |
| Browser | 실제 Chromium과 HTTP 픽스처 |
| Node.js | Node.js 20, 22, 24 |
| Next.js | App Router의 Server, Client, Route Handler |
| Workers/Edge | Node.js 전역 객체가 없는 `workerd` 격리 환경 |

기본 전송 계층은 Fetch 기반이며 공개 `Transport` 인터페이스로 교체할 수 있습니다. 정확한 범위는 [런타임 호환성 문서](docs/runtime-compatibility.md)를 참고하세요.

## 확장 경계

공식 기능은 전용 체이닝 메서드로 제공합니다. 사용자 정의 요청 기능만 고급 진입점에서 정의합니다.

```ts
import { defineFeature } from "@laflabs/lafetch/feature";
```

Feature Runtime과 Capability 타입을 루트 패키지에서 분리하여 일반 사용자가 내부 생명주기를 먼저 학습하지 않도록 했습니다.

## 문서

- [문서 전체 목차](docs/README.md)
- [상세 사용 가이드](docs/advanced-usage.md)
- [개발 로드맵](docs/roadmap.md)
- [기술 경쟁력 평가와 개선 백로그](docs/improvements.md)

현행 계약과 이미 대체된 설계 기록은 [문서 전체 목차](docs/README.md)에서 구분해 안내합니다.

## 개발

```bash
pnpm install
pnpm check
pnpm check:runtimes
```

`pnpm check`는 엄격한 TypeScript 검사, 동작 테스트, ESM 선언 빌드, 실제 tarball 설치와 공개 export 소비 검증을 실행합니다. `pnpm check:runtimes`는 Playwright Chromium이 설치된 환경에서 Chromium, Workers/Edge, Next.js 소비 환경을 추가로 검증합니다.

## 라이선스

Lafetch는 [Apache License 2.0](LICENSE)에 따라 배포됩니다. 자세한 이용 조건은 라이선스 전문을 확인하세요.

## 현재 상태

현재 소스 후보는 `0.4.0-alpha.1`입니다. v0.3의 응답·Streaming 계약 위에 logical lifecycle, `OPTIONS`와 외부 CacheStore 신뢰성 계약을 추가했습니다. Node.js 20·22·24, Chromium, Workers/Edge, Next.js와 실제 package 소비 검증을 유지합니다.

현재 단계는 v0.4 Reliability policy입니다. 다음으로 Cache invalidation·revalidation, 높은 동시성의 Deduplication과 adaptive Retry 경계를 확정합니다.

Protocol/Contract layer, Server adapter, OpenAPI, Mock framework는 현재 코어 로드맵 범위가 아닙니다. npm 배포 자동화는 공개 pre-release 전에 별도로 완료하며, 웹사이트와 플레이그라운드는 공개 API가 안정화된 뒤 진행합니다. 자세한 완료 근거와 다음 단계는 [개발 로드맵](docs/roadmap.md)을 참고하세요.
