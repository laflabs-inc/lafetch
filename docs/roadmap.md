# Lafetch 개발 로드맵

이 문서는 Lafetch 코어의 개발 순서와 각 단계의 완료 조건만 관리합니다. 문제의 근거와 경쟁 제품 비교는 [기술 경쟁력 평가와 개선 백로그](improvements.md), 과거 설계 내용은 [문서 목차의 보관 문서](README.md#보관-문서)를 참고하세요.

## 제품 원칙

- 특정 backend나 Laf ID에 종속되지 않는 범용 TypeScript HTTP client를 유지합니다.
- 하나의 동작에는 하나의 공식 표현만 제공합니다.
- 일반 요청은 `LResponse`, 형식을 강제할 때만 `as(mode)`를 사용합니다.
- Fetch와 Web Platform 타입을 불필요하게 다시 추상화하지 않습니다.
- Browser, Node.js, Next.js, Workers/Edge에서 같은 계약을 검증합니다.
- 새 기능 수보다 격리, 예측 가능성, Body 소유권과 메모리 안전성을 우선합니다.
- React와 Next.js 연동은 core가 아닌 선택 package로 분리합니다.

## 현재 상태

소스 버전은 `0.3.1-alpha.0`입니다. Buffered/Streaming 응답 소유권, 단일 `as(mode)`, Stream DX와 공개 계약 보강을 구현했지만 아직 npm에 배포하지 않았으며 프로덕션 안정 버전이 아닙니다.

| 영역 | 상태 |
| --- | --- |
| 공개 요청 문법 | 구현 완료 |
| `LResponse`와 data mode 반환 계약 | 구현 완료 |
| Streaming Body lifecycle | 구현 완료 |
| Timeout, Retry, Abort | 구현 및 경쟁 상태 테스트 완료 |
| Cache, Deduplication, Idempotency | 기본 구현과 격리 테스트 완료 |
| Validation, Error Mapping, Telemetry | Standard Schema V1과 기본 구현 완료 |
| Node.js 20/22/24, Chromium, Workers/Edge, Next.js | 자동 검증 완료 |
| Packed package 소비 | JavaScript·TypeScript 검증 완료 |
| 다음 단계 | v0.4 Reliability policy 강화 |
| 라이선스와 npm 배포 자동화 | 미완료 |

현재 complete root bundle 기준선은 `44,961 / 13,875 bytes gzip`, 대표 JSON 요청은 `44,104 / 13,641 bytes gzip`입니다. Hard ceiling은 각각 `48/16 KiB`, `44/14 KiB`입니다.

## 완료된 기반

| 버전 | 완료 내용 | 근거 |
| --- | --- | --- |
| v0.2 | 명시적 client, immutable request, Timeout·Retry·Cache 정책, Feature Runtime | [보관된 v0.2 RFC](archive/rfc-v0.2-public-api.md) |
| v0.2.1 | 제한형 Type-State, GET/HEAD Body 차단, Buffered 상한, package consumer 검증 | [보관된 v0.2.1 RFC](archive/rfc-v0.2.1-progressive-builder.md) |
| v0.3 | 단일 `as(mode)`, `LResponse`, live Streaming, Body 종료까지 Timeout·Abort·finalize, Stream DX | [v0.3 RFC](rfcs/v0.3-streaming-body-safety.md) |
| v0.3.1 | Stable error guard, Standard Schema V1, `requestInit()`, redacted `RequestSnapshot`, 이중 bundle budget | [v0.3.1 RFC](rfcs/v0.3.1-public-contract.md) |

과거 버전의 세부 작업과 당시 bundle 수치는 보관 문서와 병합된 PR에 남기고 현행 로드맵에서는 반복하지 않습니다.

## v0.4 — Reliability policy 강화

목표: 외부 Store와 높은 동시성에서도 Cache, Deduplication과 Retry를 예측 가능하게 만듭니다.

### 범위

- CacheStore 적합성 테스트와 Store 실패 정책 확대
- Cache invalidation과 revalidation 계약
- TTL, `Cache-Control`, `Age` 상호작용 검증
- leader/follower Abort·Timeout 경쟁 상태와 누수 테스트
- 사용자 key의 tenant·인증 경계 문서화
- server-directed Retry delay 별도 상한
- `Retry-After`, RateLimit Internet-Draft와 비표준 Header 처리 원칙
- custom Retry predicate와 forced Retry의 method·idempotency gate

### 완료 조건

- client와 tenant 사이에서 Response가 암묵적으로 공유되지 않아야 합니다.
- leader 실패나 follower 취소가 다른 요청을 잘못 취소하지 않아야 합니다.
- 외부 Store가 공통 conformance suite를 통과할 수 있어야 합니다.
- server delay와 custom predicate가 total Timeout이나 safe method 경계를 우회하지 않아야 합니다.

## v0.5 — Feature와 Transport SDK

목표: 외부 개발자가 core 내부 구현에 의존하지 않고 안전한 확장을 만들 수 있게 합니다.

### 범위

- Hook 입력·출력·실패 의미와 상태 변경 범위 확정
- Feature·Transport conformance 도구
- Capability와 ordering 오류 개선
- Abort, Response ownership과 오류 정규화 계약
- runtime capability metadata
- 공개 API 변경 감지와 버전 정책

### 완료 조건

- Feature 순서가 chain 작성 순서나 외부 객체 변경에 따라 우연히 달라지지 않아야 합니다.
- Feature 실패를 Transport 오류로 오분류하지 않아야 합니다.
- custom Transport가 Abort와 Response ownership 적합성 검사를 통과해야 합니다.

## v0.6 — Observability와 전송 신호

목표: 특정 수집 서비스에 종속되지 않는 관찰 계약과 progress·status error data 경계를 확정합니다.

### 범위

- Telemetry event schema versioning, sampling과 filtering
- Retry, Cache, Deduplication metadata
- Trace context와 OpenTelemetry 호환성
- 비동기 batch와 exporter 실패 격리
- URL, Header, Query 개인정보 제거 확대
- Download progress recipe 또는 optional Feature
- Upload progress runtime capability 판정
- bounded `HttpStatusError` Body의 data 소비 DX

### 완료 조건

- 관찰 기능 실패가 HTTP 성공과 실패를 바꾸지 않아야 합니다.
- 요청 Body와 인증 정보가 기본 event에 포함되지 않아야 합니다.
- progress가 Body backpressure를 깨거나 과도한 event를 생성하지 않아야 합니다.

## v0.7 — React와 Next.js 선택 모듈

예상 package:

```text
@laflabs/lafetch
@laflabs/lafetch-react
@laflabs/lafetch-next
```

범위:

- React request state와 취소·재실행
- Suspense 도입 여부
- Server Component, Client Component, Route Handler와 Server Action 경계
- Next.js Cache와 Revalidation adapter

완료 조건:

- core package가 React와 Next.js를 runtime dependency로 가져서는 안 됩니다.
- 선택 module이 core의 요청, 오류와 격리 계약을 변경해서는 안 됩니다.

## v0.8 — 성능과 보안

목표: 공개 배포 전에 성능 회귀, 경쟁 상태, 민감 정보 노출과 공급망 위험을 자동 검증합니다.

범위:

- deterministic Transport 기반 request overhead benchmark
- 정책 수와 Body 크기에 따른 benchmark
- root와 대표 요청 bundle 예산, tree-shaking
- Timeout, Abort, Retry Fuzz test
- 악성 Transport와 Feature 격리
- 오류·진단·event의 민감 정보 유출 검사
- dependency와 배포 산출물 점검
- npm provenance와 재현 가능한 배포

완료 조건:

- 성능과 bundle 허용 기준이 재현 가능한 자동 테스트로 고정되어야 합니다.
- 민감 정보가 기본 오류, event와 외부 Cache key 표현에 노출되지 않아야 합니다.
- 배포 산출물이 저장소에서 검증한 commit과 연결되어야 합니다.

## v0.9 — Release Candidate

목표: 신규 기능을 중단하고 v1에서 유지할 계약을 실제 사용 환경에서 검증합니다.

범위:

- 공개 API freeze와 최종 API reference 정리
- 실제 프로젝트 beta 적용
- 지원 runtime, TypeScript와 SemVer 정책 확정
- 라이선스와 보안 취약점 신고 정책
- npm pre-release 자동화
- API 문서와 예제 일치 검사

완료 조건:

- RC 기간에 중대한 공개 API 변경이 없어야 합니다.
- 지원 runtime 전체에서 실제 package 설치가 통과해야 합니다.
- 알려진 공개 차단 이슈가 없어야 합니다.

## v1.0 — Stable Core

v1.0은 기능 개수가 아니라 장기간 유지 가능한 계약으로 판단합니다.

- 기본 요청 문법을 SemVer 없이 변경하지 않습니다.
- Buffered와 Streaming의 메모리 안전성을 보장합니다.
- Timeout, Retry와 Abort lifecycle을 고정합니다.
- Cache, Deduplication과 Feature 격리 규칙을 고정합니다.
- 오류 code와 Telemetry event versioning을 제공합니다.
- 지원 runtime과 framework 범위를 명시합니다.
- 라이선스, npm 배포, 지원과 보안 정책을 갖춥니다.
- 하나 이상의 실제 서비스 적용으로 API를 검증합니다.

## 웹사이트와 Playground

문서 사이트와 Playground는 v0.9 RC 이후에 시작합니다. 불안정한 API를 시각적으로 먼저 고정하는 수단으로 사용하지 않습니다.

- 안정된 공개 API에서 생성한 Reference
- 최소 시작 예제와 실전 Recipe
- 안전한 fixture Transport 기반 Browser Playground
- Timeout, Retry, Cache와 Feature lifecycle 시각화
- runtime 호환성과 bundle 페이지

## 변경 규칙

- 현재 단계의 완료 조건을 충족한 뒤 다음 단계로 이동합니다.
- 버전 범위를 바꾸면 이 문서와 관련 RFC를 함께 갱신합니다.
- API를 추가하기 전에 기존 method로 표현할 수 있는지 검토합니다.
- 같은 동작을 표현하는 두 번째 공식 문법은 추가하지 않습니다.
- 문제의 근거는 `improvements.md`, 실행 순서는 이 문서에서 관리합니다.
