# Lafetch

> 요청 코드는 간단하게, 실패 처리는 안전하게.

Lafetch는 Fetch 표준 위에서 동작하는 TypeScript HTTP 클라이언트입니다. 하나의 일관된 체이닝 API로 요청을 읽기 쉽게 만들고, 재시도·격리·검증·오류 처리처럼 놓치기 쉬운 부분은 안전한 기본값으로 다룹니다.

> 현재 상태: 공개 배포 전 프레임워크 개발 단계입니다. 핵심 기능과 런타임 호환성 검증은 구현되었으며, 첫 공개 버전 전 스트리밍 API와 패키지 배포 준비가 남아 있습니다.

## 시작하기

모든 요청은 명시적으로 생성한 클라이언트에서 시작합니다.

```ts
import { lafetch } from "@laflabs/lafetch";

const api = lafetch.create({
  baseUrl: "https://api.example.com",
});

const user = await api.get("/users/123").json<User>();
```

공통 설정이 없다면 `lafetch.create()`로 동일한 형태의 클라이언트를 만듭니다.

## 왜 Lafetch인가요?

### 편의성

- 간단한 요청부터 고급 정책까지 한 가지 문법만 사용합니다.
- 옵션 객체를 오가며 우선순위를 외울 필요 없이 요청을 위에서 아래로 읽습니다.
- `await`뿐 아니라 `then`, `catch`, `finally`도 그대로 사용할 수 있습니다.
- JSON, 텍스트, 원본 응답을 명확한 종결 메서드로 꺼냅니다.
- TypeScript 타입 추론과 스키마 검증을 함께 사용할 수 있습니다.

### 안정성

- 재시도 가능한 메서드와 본문을 안전하게 구분합니다.
- Timeout, Abort, Retry가 같은 요청 생명주기 안에서 충돌 없이 동작합니다.
- Cache와 Deduplication 상태는 클라이언트별로 격리됩니다.
- 인증 정보가 포함된 요청은 기본 캐시와 중복 제거에서 안전하게 제외됩니다.
- 구조화된 오류와 민감 정보가 제거된 진단 데이터를 제공합니다.
- Browser, Node.js, Next.js, Workers/Edge에서 같은 동작을 검증합니다.

## 하나의 사용 규칙

```text
lafetch.create() → api.get(url) → .timeout().retry() → .json()
```

- `lafetch`는 `create()`만 제공하는 팩토리입니다.
- `create()`는 공통 환경 설정과 상태 격리 경계를 만듭니다.
- `get()`, `post()` 같은 HTTP 메서드는 URL만 받습니다.
- 헤더, 본문, Timeout, Retry, Cache 같은 요청 동작은 체이닝 메서드로 설정합니다.
- `json()`, `text()`, `raw()`, `send()` 또는 `await`로 요청을 실행합니다.
- `.use(feature)`는 사용자 정의 생명주기 확장에만 사용합니다.

하나의 동작을 표현하는 방법도 하나만 제공하여 옵션 우선순위와 팀별 사용법 차이를 줄입니다.

## 자주 사용하는 요청

### 데이터 조회

```ts
const users = await api.get("/users").json<User[]>();
```

### JSON 전송

```ts
const user = await api
  .post("/users")
  .jsonBody({ name: "Dohyun" })
  .json<User>();
```

### Timeout과 Retry

```ts
const users = await api
  .get("/users")
  .timeout("3s")
  .retry(3)
  .json<User[]>();
```

`retry(3)`은 최초 요청을 포함해 최대 세 번 시도한다는 의미입니다. 기본적으로 `GET`, `HEAD`, `OPTIONS`만 자동 재시도합니다.

## 응답 사용하기

데이터만 필요하면 종결 메서드를 사용합니다.

```ts
const user = await api.get("/users/123").json<User>();
const text = await api.get("/health").text();
const response = await api.get("/download").raw();
```

상태 코드와 헤더까지 필요하면 요청 객체를 직접 `await`합니다.

```ts
const result = await api.get<User>("/users/123");

result.data;
result.status;
result.headers;
result.meta.attempts;
```

요청 객체는 Promise처럼 사용할 수도 있습니다.

```ts
api
  .get<User>("/users/123")
  .then(({ data }) => render(data))
  .catch(handleError)
  .finally(stopLoading);
```

요청은 실제로 소비될 때까지 실행되지 않습니다. 같은 요청 객체를 여러 번 소비해도 전송은 한 번만 일어나며, 체이닝 메서드를 추가하면 별도의 불변 요청 객체가 생성됩니다.

## 주요 기능

| 기능 | 간단한 사용법 | 역할 |
| --- | --- | --- |
| Timeout | `.timeout("3s")` | 전체 요청 또는 개별 시도 제한 시간 |
| Retry & Backoff | `.retry(3)` | 안전한 재시도와 지연 정책 |
| Abort | `.signal(signal)` | 표준 `AbortSignal`을 통한 취소 |
| Cache | `.cache("30s")` | 완료된 안전한 응답 캐시 |
| Deduplication | `.dedupe()` | 동시에 발생한 동일 요청 공유 |
| Idempotency | `.idempotency()` | 재시도되는 쓰기 요청의 키 유지 |
| Schema | `.schema(schema)` | 응답 검증과 타입 변환 |
| Error Mapping | `.mapError(mapper)` | 도메인 오류로 변환 |
| Telemetry | `.telemetry(handler)` | 요청 생명주기 관찰 |
| Feature | `.use(feature)` | 사용자 정의 요청 기능 조립 |

세부 옵션과 고급 예제는 [상세 사용 가이드](docs/advanced-usage.md)에서 확인할 수 있습니다.

## 안전한 기본값

- 자격 증명은 기본적으로 전송하지 않으며 `credentials`를 명시해야 합니다.
- 기본 메모리 캐시는 최대 500개 항목으로 제한됩니다.
- 인증 헤더, 토큰 형태의 쿼리, `Set-Cookie`, 제한적인 `Cache-Control`, `Vary`가 포함된 요청과 응답은 기본 캐시를 우회합니다.
- Cache와 Deduplication 키에는 URL과 요청 헤더가 반영되어 테넌트별 응답이 섞이지 않습니다.
- 스트리밍 본문처럼 재생할 수 없는 요청은 위험한 재시도 전에 거부됩니다.
- 요청 본문은 Telemetry에 포함되지 않으며 인증 헤더와 토큰 형태의 쿼리는 진단 정보에서 제거됩니다.
- Feature 충돌, 누락된 요구 기능, 실행 순환 참조는 네트워크 요청 전에 실패합니다.

## 오류 모델

Lafetch는 실패 원인을 구분할 수 있도록 구조화된 오류를 제공합니다.

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

기본 성공 범위는 HTTP `200–299`이며, 이외의 응답은 `HttpStatusError`를 발생시킵니다. 필요한 경우 요청별로 허용할 상태 코드를 명시할 수 있습니다.

## 실행 환경

| 환경 | 검증 범위 |
| --- | --- |
| 브라우저 | 실제 Chromium과 HTTP 픽스처 |
| Node.js | Node.js 20, 22, 24 |
| Next.js | App Router의 Server, Client, Route Handler |
| Workers/Edge | Node.js 전역 객체가 없는 `workerd` 격리 환경 |

Lafetch는 표준 `Request`, `Response`, `Headers`, `AbortSignal`을 사용합니다. 기본 전송 계층(Transport)은 Fetch 기반이며 필요한 경우 런타임별 구현으로 교체할 수 있습니다.

정확한 범위는 [런타임 호환성 문서](docs/runtime-compatibility.md)를 참고하세요.

## 확장 구조

공식 기능은 `.timeout()`, `.retry()`, `.cache()`처럼 전용 체이닝 메서드로 제공합니다. 외부 기능은 `.use(feature)`를 통해 동일한 요청 생명주기에 참여합니다.

Feature 실행 순서는 선언된 `before`와 `after` 관계로 결정되며, 체인을 작성한 순서가 암묵적인 미들웨어 중첩 순서가 되지 않습니다. Transport 역시 공개 인터페이스를 통해 교체할 수 있어 Fetch 호환 런타임 외의 실행 환경과 테스트 더블을 연결할 수 있습니다.

## 문서

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

`pnpm check`는 엄격한 TypeScript 검사, 동작 테스트, ESM 선언 빌드를 실행합니다. 런타임 픽스처는 React나 Next.js를 코어 패키지에 결합하지 않고 실제 소비 환경의 호환성을 검증합니다.

## 현재 범위

첫 공개 버전 전에 다음 작업이 남아 있습니다.

- 명시적인 스트리밍 응답 API
- React와 Next.js 선택 연동 패키지
- 응답 소비 단계 Telemetry 결정
- 독립 패키지 소비자 및 export condition 검증
- 라이선스, 패키지 메타데이터, 배포 전략
- Laf ID 초기 연동 사례

웹사이트와 플레이그라운드는 공개 API가 충분히 안정화된 뒤 별도 단계로 진행합니다.
