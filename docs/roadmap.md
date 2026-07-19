# Lafetch 개발 로드맵

이 문서는 Lafetch 코어 라이브러리의 개발 순서와 각 버전의 완료 조건을 정의합니다. 기능 개수나 임의의 진행률보다 테스트, 런타임 호환성, 공개 API 계약처럼 확인 가능한 근거로 성숙도를 판단합니다.

웹사이트와 플레이그라운드는 라이브러리의 공개 API가 동결되는 v0.9 단계 이후에 시작합니다.

## 제품 원칙

- Lafetch는 특정 백엔드나 Laf ID에 의존하지 않는 범용 TypeScript HTTP 클라이언트입니다.
- 하나의 동작에는 하나의 공식 표현만 제공합니다.
- 일반 요청은 데이터 우선으로 단순하게 유지하고, 실패 정책은 체인에서 명시합니다.
- Fetch와 Web Platform 타입을 불필요하게 다시 추상화하지 않습니다.
- Browser, Node.js, Next.js, Workers/Edge에서 같은 요청 계약을 유지합니다.
- React와 Next.js 연동은 코어와 분리된 선택 모듈로 제공합니다.
- 새로운 기능보다 기존 계약의 예측 가능성, 격리, 메모리 안전성을 우선합니다.

## 현재 수준: v0.2.1-alpha

현재 단계는 단순 프로토타입을 넘어선 **Progressive Builder 안정화 알파**입니다. 기능 범위는 넓지만 Streaming, 대용량 응답, 외부 Feature 호환성, 공개 배포 정책이 남아 있으므로 프로덕션 안정 버전으로 간주하지 않습니다.

| 영역 | 현재 상태 |
| --- | --- |
| 공개 API 방향 | 안정화 후보 |
| 데이터 우선 RequestBuilder | 구현 및 테스트 완료 |
| 제한된 Type-State와 `as*()` terminal | v0.2.1 구현 및 계약 테스트 |
| Timeout, Retry, Backoff, Abort | 구현 및 경쟁 상태 테스트 |
| Cache와 Deduplication | 기본 정책과 클라이언트 격리 구현 |
| Idempotency, Validation, Error Mapping | 구현 완료 |
| Feature Runtime | 생명주기, 순서, Capability 충돌 구현 |
| Telemetry | 요청 단위 관찰 기능 구현 |
| Transport 교체 | 구현 완료 |
| Browser, Node.js, Next.js, Workers/Edge | 자동 검증 구성 |
| npm 패키지 소비 | tarball 설치와 공개 export 검증 |
| Streaming과 메모리 상한 | 미구현 |
| React와 Next.js 선택 모듈 | 미구현 |
| 라이선스와 공개 배포 자동화 | 미완성 |

## v0.2 — 공개 API 재설계

### 목표

데이터 우선 소비와 하나의 공식 요청 문법을 확정합니다.

```ts
const user = await api
  .get<User>("/users/123")
  .timeout("3s")
  .retry(2);
```

### 구현된 범위

- 직접 `await`하면 디코딩된 데이터 `T` 반환
- 전체 응답과 Fetch 응답은 v0.2.1의 `asResponse()`, `asRaw()`로 명시
- JSON 본문은 `json(value)`, 명시적 응답 소비는 `asJson()` 같은 `as*()` terminal로 분리
- 응답 검증은 `validate(schema)`로 통일
- 전체 Timeout과 시도 Timeout을 `timeout()`과 `attemptTimeout()`으로 분리
- Retry의 숫자를 최초 시도 이후의 추가 재시도 횟수로 정의
- Cache TTL을 `cache(ttl, options?)`의 첫 번째 인자로 명시
- `lafetch`는 `create()`만 노출하고 모든 요청을 명시적 클라이언트에 귀속
- 공식 정책은 전용 메서드, 사용자 Feature만 `use(feature)` 사용
- Feature 타입과 Helper를 `@laflabs/lafetch/feature` 진입점으로 분리
- 중복 Feature 이름과 Capability 충돌을 네트워크 실행 전에 거부
- URL, Query, 상태 목록, Retry 옵션, Feature 정의를 선언 시점에 스냅샷
- 실제 tarball 설치와 루트, `./feature`, `./testing` export 소비 검증
- 한국어 README, 상세 가이드, 마이그레이션 RFC 작성

### v0.2.0 이후 확인된 보강점

- 문자열 기반 응답 형식과 소비 메서드의 역할이 시각적으로 분리되지 않았습니다.
- 모든 요청이 같은 Builder 표면을 사용해 GET과 HEAD에서도 요청 본문 메서드가 IDE에 나타났습니다.
- HTTP와 Feature의 모든 조합을 Type-State로 표현하면 공개 타입과 오류가 과도하게 복잡해질 위험이 확인되었습니다.

이 항목은 v0.2.1에서 기능을 제거하지 않는 제한형 Type-State와 명시적인 `as*()` terminal로 보강합니다.

### 완료 조건

- 하나의 기능을 표현하는 공식 문법이 하나뿐이어야 합니다.
- 잘못된 구성은 Transport 실행 전에 구조화된 오류로 실패해야 합니다.
- Node.js 전체 매트릭스, Chromium, Next.js, Workers/Edge CI가 통과해야 합니다.
- 독립 소비자가 공개 export와 선언 파일을 소스 경로 없이 사용할 수 있어야 합니다.

## v0.2.1 — Progressive Builder와 소비 문법

### 목표

기능 개수를 줄이지 않고, 평범한 요청이 부담하는 개념과 잘못된 IDE 선택지만 줄입니다.

```ts
const user = await api.get<User>("/users/123");

const created = await api
  .post("/users")
  .json(input)
  .timeout("5s")
  .retry(2)
  .asJson<User>();
```

### 작업 범위

- GET과 HEAD Builder에서 `json()`, `body()`, `bodyFactory()` 제거
- 같은 JavaScript 호출을 선언 시점의 `HttpConfigurationError`로 거부
- Request body 허용 여부와 buffered 여부만 추적하는 제한형 Type-State
- `asJson()`, `asText()`, `asArrayBuffer()`, `asBlob()`, `asFormData()` terminal
- 전체 결과 `asResponse()`, Fetch 응답 `asRaw()`로 소비 이름 통일
- 기존 `as(type)`, `response()`, `raw()` 제거
- 직접 `await`와 Promise 호환성 유지
- TypeScript, JavaScript, 실제 tarball 소비 계약 테스트

### 완료 조건

- 일반 요청이 Feature 또는 Type-State 개념을 알지 않고 동작해야 합니다.
- 명시적 `as*()` terminal은 실제 Promise를 반환해야 합니다.
- 확실히 잘못된 조합만 타입에서 제거하고, 상황 의존 정책은 런타임 검증이 담당해야 합니다.
- 공식 Timeout, Retry, Cache, Deduplication, Idempotency, Validation, Error Mapping, Telemetry 기능을 유지해야 합니다.
- 전체 브라우저 공개 API가 기존 `12 KiB` gzip 예산을 지켜야 합니다.

## v0.3 — Streaming과 본문 안전성

### 목표

현재의 Buffered 다중 소비 계약과 진짜 Streaming 소비 계약을 명시적으로 분리하고, 응답 크기에 따른 메모리 위험을 제거합니다.

### 작업 범위

- Streaming 응답 공개 API RFC
- buffered `asRaw()`와 streaming `asStream()`의 책임 분리
- Streaming 응답의 단일 소비와 Builder 재사용 규칙
- Buffered 응답의 최대 크기와 메모리 상한
- `Content-Length`가 없거나 잘못된 응답의 크기 추적
- 본문 소비 중 전체 Timeout, 시도 Timeout, Abort 처리
- Streaming 실패와 Retry의 경계
- 대용량 다운로드와 Streaming 업로드 테스트
- Cache, Deduplication, Feature finalizer와 Streaming의 충돌 규칙

### 완료 조건

- Streaming 경로가 전체 응답을 메모리에 보관하지 않아야 합니다.
- Buffered 경로는 설정된 메모리 상한을 초과할 수 없어야 합니다.
- Timeout과 Abort가 응답 헤더뿐 아니라 본문 소비 종료까지 일관되게 적용되어야 합니다.

## v0.4 — Cache와 Deduplication 프로덕션 강화

### 목표

기본 메모리 구현을 넘어 외부 CacheStore와 높은 동시성에서도 예측 가능한 정책을 제공합니다.

### 작업 범위

- CacheStore 적합성 테스트 확장
- Store 읽기와 쓰기 실패 처리 정책
- 명시적인 Cache 무효화와 갱신 계약
- TTL, `Cache-Control`, `Age` 상호작용 검증
- Leader와 Follower의 Abort·Timeout 경쟁 상태 확대
- Deduplication 정리 누락과 메모리 누수 테스트
- 사용자 정의 키의 테넌트·인증 경계 문서화
- Next.js Cache Adapter가 사용할 수 있는 기반 인터페이스 검토

### 완료 조건

- 서로 다른 클라이언트와 테넌트의 응답이 암묵적으로 공유되지 않아야 합니다.
- Leader 실패나 Follower 취소가 다른 요청을 잘못 취소하지 않아야 합니다.
- 외부 Store 구현이 공통 적합성 검사를 통과할 수 있어야 합니다.

## v0.5 — Feature SDK 안정화

### 목표

외부 개발자가 코어 내부 구현에 의존하지 않고 Feature를 만들 수 있도록 확장 계약을 안정화합니다.

### 작업 범위

- Hook별 입력, 출력, 실패 의미 최종 확정
- Feature 상태와 공유 Metadata의 변경 가능 범위 명시
- Feature conformance test 도구
- Capability 모드와 충돌 규칙의 런타임 검증
- 순서 그래프 오류 메시지 개선
- Feature API 호환성 및 버전 정책
- 공식 Feature와 사용자 Feature의 보안 경계 검토
- `@laflabs/lafetch/feature` 공개 API 보고서 생성

### 완료 조건

- Feature 실행 순서가 체인 작성 순서나 객체 변경에 따라 우연히 달라지지 않아야 합니다.
- 잘못된 Feature가 Transport 오류로 오분류되지 않아야 합니다.
- 공개 Feature 타입 변경을 자동으로 감지할 수 있어야 합니다.

## v0.6 — Observability 계약 안정화

### 목표

특정 수집 서비스에 의존하지 않는 요청 관찰 계약을 확정합니다.

### 작업 범위

- Telemetry 이벤트 스키마 버전 관리
- Retry, Cache, Deduplication 결과를 포함한 실행 Metadata 정리
- Sampling과 필터링
- Trace context 전달
- 범용 Exporter 인터페이스
- OpenTelemetry 호환성 검토
- 비동기 Batch와 전송 실패 격리
- URL, 헤더, 쿼리의 개인정보 제거 정책 확대
- Browser, Node.js, Edge의 수명주기 차이 검증
- 현재 `telemetry(handler)` 계약의 v1 최종 형태 결정

### 완료 조건

- 관찰 기능의 실패가 HTTP 요청의 성공과 실패를 바꾸지 않아야 합니다.
- 요청 본문과 인증 정보가 기본 이벤트에 포함되지 않아야 합니다.
- 이벤트 스키마가 버전으로 식별되어야 합니다.

## v0.7 — React와 Next.js 선택 모듈

### 목표

코어 패키지를 프레임워크에 종속시키지 않으면서 React와 Next.js의 실행 모델에 맞는 선택 연동을 제공합니다.

### 예상 패키지

```text
@laflabs/lafetch
@laflabs/lafetch-react
@laflabs/lafetch-next
```

### 작업 범위

- React 요청 상태 Hook
- 취소, 재실행, Suspense 연동 여부
- Server Component와 Client Component 경계
- Route Handler와 Server Action 사용 패턴
- Next.js Cache와 Revalidation Adapter
- 코어 패키지의 React 의존성 부재 검증
- 선택 모듈을 설치하지 않은 소비자의 번들 회귀 방지

### 완료 조건

- 코어 패키지는 React와 Next.js를 런타임 의존성으로 가져서는 안 됩니다.
- 선택 모듈이 코어의 요청·오류·격리 계약을 변경해서는 안 됩니다.

## v0.8 — 성능과 보안 강화

### 목표

공개 배포 전 성능 회귀, 경쟁 상태, 민감 정보 노출, 공급망 위험을 자동 검증합니다.

### 작업 범위

- 요청 경로와 Feature 수에 따른 Benchmark
- 루트 및 하위 진입점별 번들 예산
- Tree-shaking 검증
- Timeout, Abort, Retry 경쟁 상태 Fuzz test
- 악성 Transport와 Feature 실패 격리 테스트
- 진단 정보와 오류 직렬화의 민감 정보 유출 검사
- 의존성 및 배포 산출물 점검
- npm provenance와 재현 가능한 배포 검토
- 공개 API 변경 감지 자동화

### 완료 조건

- 성능과 번들 크기의 허용 기준이 자동 테스트로 고정되어야 합니다.
- 민감 정보가 기본 오류, 이벤트, Cache key 외부 표현에 노출되지 않아야 합니다.
- 배포 산출물이 저장소에서 검증한 코드와 연결되어야 합니다.

## v0.9 — Release Candidate

### 목표

신규 기능을 중단하고 v1.0에서 유지할 계약을 실제 사용자와 배포 환경에서 검증합니다.

### 작업 범위

- 공개 API 동결
- 실제 프로젝트 베타 적용
- 전체 마이그레이션 가이드
- 지원 런타임과 TypeScript 버전 확정
- SemVer 및 지원 정책
- 라이선스 확정
- 보안 취약점 신고 정책
- npm 배포 자동화와 Pre-release 검증
- API 문서와 예제의 일치 검사

### 완료 조건

- Release Candidate 기간에 중대한 공개 API 변경이 없어야 합니다.
- 지원 런타임 전체에서 실제 패키지 설치 테스트가 통과해야 합니다.
- 알려진 공개 차단 이슈가 없어야 합니다.

## v1.0 — Stable Core

v1.0은 기능 개수가 아니라 장기간 유지할 수 있는 계약으로 판단합니다.

- 기본 요청 문법을 SemVer 없이 변경하지 않습니다.
- Buffered와 Streaming 응답 모두 메모리 안전성을 보장합니다.
- Timeout, Retry, Abort의 생명주기 계약이 고정됩니다.
- Cache, Deduplication, Feature의 격리 규칙이 고정됩니다.
- 오류 코드와 Telemetry 이벤트 버전 정책을 제공합니다.
- 지원 Browser, Node.js, Next.js, Workers/Edge 범위를 명시합니다.
- npm 공개 패키지, 라이선스, 지원 및 보안 정책을 갖춥니다.
- 하나 이상의 실제 서비스 적용 사례로 API를 검증합니다.

## 웹사이트와 플레이그라운드 단계

웹사이트 작업은 v0.9 Release Candidate 이후에 시작합니다. 문서 사이트가 불안정한 API를 먼저 고정하는 수단이 되어서는 안 됩니다.

- 안정된 공개 API에서 자동 생성한 Reference
- 처음 사용하는 개발자를 위한 최소 예제
- 안전한 Fixture Transport를 사용하는 브라우저 Playground
- Timeout, Retry, Cache, Feature 생명주기 시각화
- 런타임 호환성과 번들 크기 페이지
- 복사 가능한 실전 Recipe

## 로드맵 변경 규칙

- 현재 버전의 완료 조건을 먼저 충족한 뒤 다음 버전으로 이동합니다.
- 버전 범위를 바꿀 때는 이 문서와 관련 RFC를 함께 갱신합니다.
- 공개 API를 추가하기 전에 기존 메서드로 표현할 수 있는지 검토합니다.
- 같은 동작을 표현하는 두 번째 공식 문법은 추가하지 않습니다.
- 웹사이트와 플레이그라운드는 v0.9 이전의 코어 개발보다 우선하지 않습니다.
