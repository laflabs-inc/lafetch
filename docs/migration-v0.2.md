# Lafetch v0.1에서 v0.2.1로 마이그레이션

v0.2 계열은 호환 별칭을 추가하는 버전이 아니라 요청 문법을 하나로 통일하는 공개 API 재설계입니다. v0.2.1은 응답 형식 문자열을 실제 Promise를 반환하는 `as*()` terminal로 교체합니다. 기존 코드와 새 코드를 섞기보다 아래 순서대로 한 번에 전환하는 것을 권장합니다.

## 가장 빠른 전환 순서

1. 모든 요청을 `lafetch.create()`로 만든 명시적 클라이언트에 연결합니다.
2. 직접 `await`의 반환값을 `HttpResult<T>`에서 데이터 `T`로 변경합니다.
3. JSON 본문, 응답 형식, 검증 메서드의 이름을 교체합니다.
4. Timeout, Retry, Cache, Telemetry 시그니처를 v0.2 형식으로 바꿉니다.
5. 응답 소비를 `asJson()`, `asText()`, `asResponse()`, `asRaw()` terminal로 변경합니다.
6. 사용자 Feature 타입과 Helper import를 `@laflabs/lafetch/feature`로 이동합니다.

## 전체 요청 비교

v0.1:

```ts
const result = await api
  .post<User>("/users")
  .jsonBody({ name: "Dohyun" })
  .timeout({ total: "10s", attempt: "3s" })
  .retry({ attempts: 3 })
  .send();

result.data;
result.status;
```

v0.2.1:

```ts
const user = await api
  .post<User>("/users")
  .json({ name: "Dohyun" })
  .timeout("10s")
  .attemptTimeout("3s")
  .retry(2);
```

상태 코드와 헤더가 필요할 때만 `asResponse()`를 사용합니다.

```ts
const result = await api
  .post<User>("/users")
  .json({ name: "Dohyun" })
  .asResponse();

result.data;
result.status;
```

## API 변경표

| v0.1 | v0.2.1 | 비고 |
| --- | --- | --- |
| `await request` → `HttpResult<T>` | `await request` → `T` | 데이터 우선 반환 |
| `request.send()` | `request.asResponse()` | 전체 응답이 필요할 때만 사용 |
| `request.jsonBody(value)` | `request.json(value)` | JSON 요청 본문 |
| `request.json<T>()` | `await api.get<T>(url)` 또는 `api.get<T>(url).asJson()` | 응답 타입은 HTTP 메서드에서 한 번만 선언 |
| `request.text()` | `request.asText()` | 다른 형식도 `as*()` terminal로 통일 |
| `request.schema(schema)` | `request.validate(schema)` | 검증과 타입 변환 |
| `request.mapDecodeError()` | `request.mapError()` | 요청·응답 오류 매핑 통합 |
| `request.timeout({ total, attempt })` | `.timeout(total).attemptTimeout(attempt)` | 제한 시간 역할을 이름으로 구분 |
| `request.retry({ attempts: 3 })` | `request.retry(2)` | 아래 횟수 의미 확인 |
| `request.cache()` | `request.cache("30s")` | TTL 필수 |
| `request.cache({ ttl, store })` | `request.cache(ttl, { store })` | 하나의 시그니처 |
| `request.telemetry({ onEvent, name })` | `request.telemetry(onEvent, { name })` | Handler가 첫 번째 인자 |
| `api.request(url, { method })` | `api.request(method, url)` | 사용자 정의 HTTP 메서드 |
| `api.extend(options)` | `lafetch.create(options)` | 새 격리 경계 생성 |
| 클라이언트 `features` | 요청의 전용 메서드 또는 `.use(feature)` | 정책 우선순위 제거 |
| 루트의 Feature Helper와 타입 | `@laflabs/lafetch/feature` | 고급 API 분리 |

## 반드시 확인할 동작 차이

### Retry 숫자의 의미

v0.1의 `attempts`는 최초 요청을 포함한 전체 시도 횟수였습니다. v0.2의 숫자는 최초 실패 이후 추가 재시도 횟수입니다.

```ts
// 두 코드 모두 최대 세 번 요청합니다.
request.retry({ attempts: 3 }); // v0.1
request.retry(2);               // v0.2
```

### JSON의 역할

v0.2.1의 `json(value)`는 요청 본문만 설정합니다. JSON 응답은 기본 자동 디코딩에 맡기고, 서버의 `Content-Type`을 신뢰할 수 없을 때만 `api.get<T>(url).asJson()`을 사용합니다. 응답 타입은 HTTP 메서드에서 한 번만 선언하며 `asJson<T>()` 형태는 제공하지 않습니다. GET과 HEAD에서는 Fetch가 요청 본문을 허용하지 않으므로 `json(value)`, `body(value)`, `bodyFactory(factory)`가 TypeScript에 노출되지 않으며 JavaScript에서도 즉시 거부됩니다.

### 오류 매핑

`mapError()`는 Transport, HTTP 상태, 디코딩, 스키마 검증의 최종 실패를 모두 처리합니다. 재시도 판단이 끝난 뒤 실행되므로 Mapper가 재시도 정책을 바꾸지 않습니다.

### 클라이언트 격리

`lafetch.create()`를 호출할 때마다 기본 Cache와 진행 중 Deduplication 상태가 분리됩니다. 기존 `extend()` 대신 공유 환경 설정이 필요할 때 명시적으로 새 클라이언트를 생성합니다.

### 닫힌 설정 값

다음 값은 TypeScript와 JavaScript 런타임에서 모두 검증합니다.

| 설정 | 허용 값 |
| --- | --- |
| Credentials | `omit`, `same-origin`, `include` |
| Backoff `type` | `fixed`, `exponential` |
| Backoff `jitter` | `none`, `full` |

응답 소비는 문자열 설정이 아니라 `asJson()`, `asText()`, `asArrayBuffer()`, `asBlob()`, `asFormData()`라는 닫힌 메서드 집합을 사용합니다. 문자열 축약형 `backoff: "fixed"`나 알 수 없는 값은 기본 동작으로 대체되지 않고 Transport 실행 전에 `HttpConfigurationError`를 발생시킵니다.

## 마이그레이션 확인 목록

- 직접 `await`한 값에서 `.data`를 읽는 코드가 남아 있지 않은지 확인합니다.
- `send`, `jsonBody`, `schema`, `mapDecodeError`, `extend` 호출을 제거합니다.
- `retry()`의 숫자를 전체 시도 횟수에서 추가 재시도 횟수로 변환합니다.
- 모든 `cache()` 호출에 TTL을 명시합니다.
- 응답 종결 메서드를 직접 `await` 또는 `asJson()`, `asText()`, `asResponse()`, `asRaw()` 중 의도에 맞게 변경합니다.
- 클라이언트 Feature를 요청별 전용 메서드 또는 사용자 `.use(feature)`로 옮깁니다.
- TypeScript 검사와 실제 JavaScript 런타임 테스트를 모두 통과시킵니다.
