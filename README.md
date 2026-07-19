# Lafetch

> 데이터는 바로 받고, 실패 정책은 읽기 쉽게.

Lafetch는 Fetch 표준 위에서 동작하는 TypeScript HTTP 클라이언트입니다. 평범한 요청은 짧게 작성하고, Timeout·Retry·Cache처럼 실패 상황을 다루는 정책은 요청 코드 안에서 명확하게 선언합니다.

## 설치

현재 `0.2.0-alpha` 공개 준비 중입니다. 첫 npm pre-release부터 아래 명령으로 설치합니다.

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

const user = await api.get<User>("/users/123");
```

응답 데이터가 바로 반환되므로 `.data`를 꺼내거나 별도의 JSON 종결 메서드를 호출할 필요가 없습니다.

## JSON 보내기

```ts
const user = await api
  .post<User>("/users")
  .json({ name: "Dohyun" });
```

## 실패 정책 추가하기

```ts
const users = await api
  .get<User[]>("/users")
  .timeout("3s")
  .retry(2);
```

`retry(2)`는 최초 요청이 실패하면 최대 두 번 더 시도한다는 뜻입니다.

## 왜 Lafetch인가요?

### 편의성

- 생성, 요청, 설정, 실행이 한 방향으로 이어집니다.
- 직접 `await`하면 자동 디코딩된 데이터가 반환됩니다.
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
- 잘못된 응답 형식, Credentials, Backoff, Jitter 설정은 요청 전에 `HttpConfigurationError`로 거부합니다.
- Browser, Node.js, Next.js, Workers/Edge에서 같은 계약을 검증합니다.

## 하나의 사용 규칙

```text
lafetch.create() → api.method(url) → body/config/policy → await
```

- `lafetch`는 `create()`만 제공합니다.
- `create()`는 공통 환경 설정과 상태 격리 경계를 만듭니다.
- `get()`, `post()` 같은 HTTP 메서드는 URL만 받습니다.
- 헤더, 쿼리, 본문, 정책은 체이닝 메서드로 설정합니다.
- Builder를 직접 `await`하면 데이터가 반환됩니다.
- 사용자 정의 HTTP 메서드는 `request(method, url)`을 사용합니다.
- 사용자 정의 Feature만 `.use(feature)`를 사용합니다.

같은 동작을 여러 방식으로 표현하지 않아 팀마다 사용법이 달라지는 문제를 줄입니다.

## 전체 응답이 필요할 때

상태 코드, 헤더, 요청 메타데이터가 필요하면 `response()`를 명시합니다.

```ts
const response = await api
  .get<User>("/users/123")
  .response();

response.data;
response.status;
response.headers;
response.meta.attempts;
```

Fetch `Response`가 직접 필요하면 `raw()`를 사용합니다.

## 응답 형식 지정하기

기본적으로 `Content-Type`에 따라 JSON, 문자열, `ArrayBuffer`를 자동 선택합니다. 형식을 강제해야 할 때만 `as()`를 사용합니다.

```ts
const health = await api.get<string>("/health").as("text");
const file = await api.get<Blob>("/files/1").as("blob");
```

## 주요 기능

| 기능 | 사용법 | 역할 |
| --- | --- | --- |
| Query | `.query({ page: 1 })` | URL 쿼리 구성 |
| Headers | `.header("X-Key", value)` | 요청 헤더 구성 |
| JSON Body | `.json(value)` | JSON 직렬화와 Content-Type 설정 |
| Timeout | `.timeout("3s")` | 전체 요청 제한 시간 |
| Attempt Timeout | `.attemptTimeout("1s")` | 개별 시도 제한 시간 |
| Retry & Backoff | `.retry(2)` | 안전한 재시도와 지연 |
| Abort | `.signal(signal)` | 표준 `AbortSignal` 취소 |
| Cache | `.cache("30s")` | 완료된 안전한 응답 재사용 |
| Deduplication | `.dedupe()` | 동시에 발생한 동일 요청 공유 |
| Idempotency | `.idempotency()` | 쓰기 재시도의 키 유지 |
| Validation | `.validate(schema)` | 응답 검증과 타입 변환 |
| Error Mapping | `.mapError(mapper)` | 도메인 오류 변환 |
| Telemetry | `.telemetry(handler)` | 요청 생명주기 관찰 |

고급 설정과 전체 예제는 [상세 사용 가이드](docs/advanced-usage.md)에 분리되어 있습니다.

## 안전한 기본값

- 자격 증명은 기본적으로 전송하지 않습니다.
- 기본 성공 범위는 HTTP `200–299`입니다.
- 기본 재시도 메서드는 `GET`, `HEAD`, `OPTIONS`입니다.
- 기본 메모리 Cache는 500개 항목으로 제한됩니다.
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

하나의 `.mapError()`가 요청 실행과 응답 소비의 최종 실패를 모두 처리합니다. 재시도 판단이 끝난 뒤 오류를 변환하므로 도메인 오류 매핑이 재시도 안전성을 바꾸지 않습니다.

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

- [v0.2 공개 API RFC](docs/rfcs/v0.2-public-api.md)
- [v0.1에서 v0.2로 마이그레이션](docs/migration-v0.2.md)
- [상세 사용 가이드](docs/advanced-usage.md)
- [커널 아키텍처](docs/architecture.md)
- [Cache와 Deduplication 설계](docs/cache-deduplication.md)
- [응답 소비 RFC](docs/rfcs/response-consumption.md)
- [런타임 호환성](docs/runtime-compatibility.md)
- [개발 로드맵](docs/roadmap.md)

## 개발

```bash
pnpm install
pnpm check
```

`pnpm check`는 엄격한 TypeScript 검사, 동작 테스트, ESM 선언 빌드, 실제 tarball 설치와 공개 export 소비 검증을 실행합니다.

## 현재 상태

현재 버전은 `0.2.0-alpha.0`입니다. 공개 배포 전 Streaming 계약, 라이선스와 배포 자동화를 완료할 예정입니다. 웹사이트와 플레이그라운드는 공개 API가 안정화된 뒤 진행합니다.
