# 보관 문서: Lafetch v0.2.1 Progressive Builder RFC

상태: v0.3 공개 계약으로 대체됨 (`2026-07-26`)

대상 버전: `0.2.1-alpha`

> 이 문서는 v0.2.1 설계 당시의 판단을 보존하는 역사 기록입니다. 개별 `asJson()`, `asRaw()` 계열 이름은 v0.3의 단일 `as(mode)` terminal로 대체됐습니다. 현재 사용법은 [상세 사용 가이드](../advanced-usage.md)를 따릅니다.

## 요약

Lafetch에서 `light`는 기능을 제거하거나 내부 구현을 단순하게 만드는 의미가 아닙니다. 평범한 요청은 적은 개념만으로 사용할 수 있고, 필요한 기능은 같은 체인 문법에서 점진적으로 추가할 수 있어야 한다는 의미입니다.

v0.2.1은 기존 immutable request model과 공식 기능을 유지하면서, 확실히 불가능한 조합만 IDE와 JavaScript 런타임에서 조기에 차단합니다. HTTP와 Feature의 모든 가능성을 TypeScript 상태로 표현하지 않습니다. v0.3 API 정리 이후 공개 타입명은 `LRequest`입니다.

```text
쉽게 쓰면 안전한 기본값을 받고,
깊게 쓰면 같은 문법 안에서 필요한 만큼 확장한다.
```

## 제품 결정

- 옵션 객체나 설정 콜백을 새로운 공식 문법으로 추가하지 않습니다.
- Timeout, Retry, Cache, Deduplication, Idempotency, Validation, Error Mapping, Telemetry를 제거하지 않습니다.
- 공식 기능은 전용 `LRequest` 메서드, 사용자 기능은 `use(feature)`로 유지합니다.
- 타입은 확실한 불변식만 표현하고, 상황에 따라 달라지는 정책은 실행 전 런타임 검증이 담당합니다.
- 기본 Transport 계약은 Web Platform의 `Request -> Response`입니다.
- 모든 JavaScript 오용을 별도 검증 계층으로 재현하지 않습니다. 요청 격리, 취소, 메모리 안전성, 닫힌 설정 값처럼 Lafetch가 보장해야 하는 경계만 구조화된 오류로 고정합니다.

## 공개 문법

평범한 요청은 추가 설정 없이 HTTP 문맥과 데이터를 함께 반환합니다.

```ts
const user = await api.get<User>("/users/123");
```

필요한 기능은 같은 `LRequest`에 추가합니다.

```ts
const user = await api
  .post<User>("/users")
  .json(input)
  .timeout("5s")
  .retry(2)
  .idempotency({ key: requestId })
  .validate(UserSchema);
```

응답 형식을 강제할 때만 명시적인 `as(mode)` 종결 메서드를 사용합니다.

```ts
const user = await api.get<User>("/users/123").as("json");
const text = await api.get("/health").as("text");
```

`as("json" | "text" | "bytes" | "blob" | "formData" | "response")`는 Buffered 실행의 실제 `Promise`를 반환합니다. direct `await`는 `LResponse<T>`로 HTTP 문맥을 보존하고, data mode는 강제 디코딩하거나 Schema로 변환한 값을 직접 반환합니다. 응답 데이터 타입은 `get<T>()`, `post<T>()`, `request<T>()` 같은 HTTP 진입 메서드에서 한 번만 선언하며 `as<T>(mode)` 형태는 허용하지 않습니다. v0.3의 `as("stream")`만 별도 live 실행 경로를 선택합니다.

이 RFC는 v0.2.1의 Buffered 계약만 확정합니다. v0.3 Streaming이 별도의 명시적 실행 경로를 가진다는 원칙은 유지하지만, terminal 이름과 반환 계약은 v0.3 RFC에서 결정합니다.

## 제한된 Type-State

공개 `LRequest`는 데이터 타입 하나만 노출합니다. 요청 본문, 응답 소비, Schema 출력의 작은 상태는 내부 타입에만 존재합니다.

```ts
type LRequest<Data> = RequestState<Data, BodyMode, ConsumptionMode, ValidationMode>;
type RequestBodyMode = "allowed" | "configured" | "forbidden";
type ResponseConsumptionMode = "open" | "buffered";
type ResponseValidationMode = "none" | "schema";
```

내부 타입 인자는 루트의 공개 `LRequest<TData>`에서 직접 지정할 수 없습니다. `get()`, `post()`, `validate()`, `cache()` 같은 기존 메서드가 상태를 추론합니다. Schema 상태는 변환 Schema 이후 `as("text")` 같은 terminal이 고정 decoder 타입으로 거짓말하지 않도록 최종 출력 타입만 보존합니다.

### 요청 본문

Fetch는 GET과 HEAD 요청 본문을 허용하지 않습니다. `get()`과 `head()`가 반환하는 `LRequest`에서는 `json()`, `body()`, `bodyFactory()`를 노출하지 않습니다.

```ts
api.get("/users").query({ active: true }); // 허용
api.get<User>("/users").as("json"); // 허용: 응답 형식
api.get("/users").json({ active: true }); // TypeScript 오류: 요청 본문
```

JavaScript 또는 타입 우회 호출도 선언 시점에 `HttpConfigurationError`로 실패하며 Transport에 도달하지 않습니다.

하나의 요청에 `json()`, `body()`, `bodyFactory()`를 둘 이상 선언하는 경우도 첫 본문 설정 후 IDE에서 제거하며, JavaScript에서는 마지막 값으로 조용히 덮어쓰지 않고 즉시 거부합니다.

POST, PUT, PATCH, DELETE와 body 가능한 사용자 정의 메서드(OPTIONS 포함)는 기존 본문 메서드를 유지합니다.

```ts
await api
  .request<Result>("QUERY", "/search")
  .json({ filters })
  .as("json");
```

### 응답 소비

초기 `LRequest`는 향후 Streaming을 선택할 수 있는 `open` 상태입니다. 전체 응답 본문이 필요한 알려진 기능은 `buffered` 상태를 반환합니다.

- `validate()`
- `cache()`
- `dedupe()`

명시적인 `as(mode)` 메서드는 `LRequest` 상태를 바꾸지 않고 실제 Promise를 반환하는 terminal입니다. v0.2.1에는 Streaming 실행이 없었고, v0.3에서 `stream` overload만 `open` 상태에 노출합니다. 이 단방향 상태 전이는 buffered와 streaming의 잘못된 체인 조합을 IDE에서 제거합니다.

일반 설정은 현재 상태를 보존하므로 체인 순서에 의존하지 않습니다.

```ts
api.get("/users").timeout("3s").cache("30s");
api.get("/users").cache("30s").timeout("3s");
```

## 타입으로 표현하지 않는 정책

다음 항목은 타입 인자로 누적하지 않습니다.

- Timeout이나 Retry가 이미 설정되었는지
- 특정 비즈니스 요청의 Retry가 안전한지
- 사용자 Feature가 다른 Feature와 충돌하는지
- 요청 본문이 재시도 가능한지
- 동일 `LRequest` 별칭이 buffered와 streaming으로 동시에 소비되는지

이 항목까지 Type-State에 포함하면 공개 선언, IDE 오류, 외부 Feature 확장이 급격히 복잡해집니다. 기존 Feature Runtime과 실행 전 구성 검증, 향후 v0.3의 소비 소유권 계약이 담당합니다.

## 구현 경계

- 런타임 request implementation은 하나만 유지합니다.
- GET, POST 등 메서드별 런타임 하위 클래스를 만들지 않습니다.
- Proxy로 메서드를 동적으로 숨기지 않습니다.
- Transport capability를 Client 제네릭으로 전파하지 않습니다.
- 공개 타입만 현재 요청에 적합한 `LRequest` view를 제공합니다.
- JavaScript에서는 동일한 계약을 런타임 검증으로 보장합니다.

## 완료 조건

1. GET과 HEAD에서 요청 본문 메서드가 TypeScript 공개 API에 나타나지 않아야 합니다.
2. 같은 호출이 JavaScript에서 Transport 실행 전 `HttpConfigurationError`로 실패해야 합니다.
3. POST, PUT, PATCH, DELETE와 사용자 정의 body 메서드(OPTIONS 포함)는 기존 기능을 유지해야 합니다.
4. `validate()`, `cache()`, `dedupe()`가 buffered 타입 상태를 반환해야 합니다.
5. 모든 명시적 `as(mode)` 소비가 실제 Promise를 반환하고 `LRequest` 설정 체인을 종료해야 합니다.
6. 직접 `await`, `then`, `catch`, `finally`와 immutable `LRequest` 계약이 바뀌지 않아야 합니다.
7. Browser 전체 공개 API의 gzip 번들 예산 `12 KiB`를 유지해야 합니다.
8. 실제 npm tarball 소비자의 TypeScript와 JavaScript 계약 테스트가 통과해야 합니다.
9. 최종 Request 기반 Cache/Deduplication 격리와 unsafe method caller-owned key 규칙이 계약 테스트로 고정돼야 합니다.
10. Buffered 응답이 실제 수신 바이트 기준 기본 상한을 초과하면 `HttpResponseTooLargeError`로 실패해야 합니다.

## 완료 검증

- [PR #18](https://github.com/laflabs-inc/lafetch/pull/18)을 통해 `main`에 병합했습니다.
- Node.js 20, 22, 24에서 15개 test file, 98개 test가 통과했습니다.
- Chromium, Workers/Edge, Next.js App Router, npm tarball 소비 검증이 모두 통과했습니다.
- 전체 브라우저 공개 API는 `33,713 bytes` minified, `10,606 bytes` gzip으로 기존 `36 KiB / 12 KiB` 예산 안에 있습니다.
- v0.3 Fluent API 실험과 Migration 변경은 구현 diff에 포함하지 않았습니다.
