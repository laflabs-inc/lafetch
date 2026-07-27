# Lafetch 기술 경쟁력 평가와 개선 백로그

평가 기준일: `2026-07-27`

비교 대상:

- `@laflabs/lafetch@0.4.0-alpha.0`
- `axios@1.18.1`
- `ky@2.0.2`

이 문서는 GitHub Star, Pull Request 수, 다운로드 수, 커뮤니티 규모와 같은 인기 지표를 사용하지 않습니다. 공개 API, 타입 계약, 런타임 동작, 확장 구조, 메모리 안전성, 번들 비용과 지원 범위만 평가합니다.

## 결론

Lafetch는 이미 **현대적인 Browser, Node.js, Next.js, Workers/Edge 환경을 위한 reliability 중심 HTTP client**로 기술적 차별성을 갖고 있습니다. 특히 Cache, Deduplication, Idempotency, Retry, Telemetry를 하나의 검증된 lifecycle에서 조합하고 Buffered와 Streaming의 Body 소유권을 분리한 구조는 Axios와 Ky의 단순 interceptor 또는 hook 조합보다 강한 계약입니다.

다만 모든 용도에서 우위에 있지는 않습니다.

- 일반적인 JSON 호출과 최소 번들에서는 Ky가 더 단순하고 작습니다.
- Proxy, HTTP/2, rate limiting, 자동 Form 직렬화, CJS와 같은 Node.js transport 범위에서는 Axios가 더 넓습니다.
- 최신 Ky는 Standard Schema, 세분화된 오류 guard, adaptive Retry, 전체 Timeout과 전송 progress까지 제공하므로 더 이상 단순한 Fetch wrapper로 평가하면 안 됩니다.
- Lafetch는 v0.3.1에서 오류 narrowing, Standard Schema 공식 호환, 고급 `RequestInit` 전달 경로와 성공 응답의 요청 보존 비용을 보강했습니다.

따라서 제품 포지셔닝은 다음과 같이 고정합니다.

> Lafetch는 가장 작은 Fetch wrapper나 모든 환경의 범용 transport가 아니라, Web Platform 위에서 신뢰성 정책을 안전하게 조합하는 TypeScript HTTP execution client다.

### 워크로드별 판정

| 워크로드 | 우선 선택 | 판단 |
| --- | --- | --- |
| 소수의 일반 JSON 호출, 최소 번들 | Ky | 간결한 `ResponsePromise`, 작은 번들, Standard Schema와 강한 Retry 기본기 |
| Node.js 전용 Proxy, HTTP/2, rate limit, 복잡한 Form 처리 | Axios | HTTP adapter와 Node 전용 옵션의 범위가 가장 넓음 |
| Cache, Deduplication, Idempotency, Retry, Telemetry를 함께 사용하는 API client | Lafetch | 정책 격리, Capability 충돌, lifecycle과 테스트 계약이 가장 강함 |
| SSE, AI token stream, 대용량 Body의 Timeout·Abort·상한 관리 | Lafetch | Body 완료까지 유지되는 deadline과 명시적 Streaming 소유권 |
| React Native 또는 CJS가 필수인 프로젝트 | Axios | 현재 Lafetch와 Ky의 공식 범위 밖 |

Lafetch는 Axios의 완전한 대체재도, Ky의 더 큰 복제품도 아닙니다. **modern Web runtime의 production reliability**라는 좁고 명확한 범위에서 경쟁력이 있습니다.

## 평가 방법

### 기능 조사

다음 공식 자료와 배포 패키지의 공개 declaration을 기준으로 조사했습니다.

- [Axios 공식 문서](https://axios-http.com/docs/intro)
- [Axios Request Config](https://axios-http.com/docs/req_config)
- [Axios Interceptors](https://axios-http.com/docs/interceptors)
- [Axios Error Handling](https://axios-http.com/docs/handling_errors)
- [Ky 공식 README와 공개 API](https://github.com/sindresorhus/ky)
- npm registry의 `axios@1.18.1`, `ky@2.0.2` package metadata와 배포 파일
- Lafetch의 현재 소스, declaration build, runtime 문서와 테스트

RateLimit header는 평가 시점에 아직 RFC가 아니라 [IETF HTTPAPI Working Group의 active Internet-Draft](https://datatracker.ietf.org/wg/httpapi/)입니다. Lafetch는 이를 표준으로 오인해 기본 동작에 고정하지 않습니다.

### 번들 실측

세 라이브러리 모두 client instance를 만들고 JSON GET 한 번을 수행하는 browser ESM entry를 사용했습니다. Lafetch는 Cache·Deduplication의 dynamic chunk를 제외하고 최초 요청에 필요한 정적 output closure를 합산합니다.

- esbuild `0.28.1`
- `platform: "browser"`
- `target: "es2022"`
- minify와 tree-shaking 활성화
- Node.js `zlib.gzipSync`로 gzip 측정

```text
Lafetch  44,889 bytes minified / 14,167 bytes gzip
Axios    45,838 bytes minified / 17,855 bytes gzip
Ky       20,608 bytes minified /  7,370 bytes gzip
```

해석:

- Lafetch는 Axios보다 minified 약 `2%`, gzip 약 `21%` 작습니다.
- Lafetch는 Ky보다 minified 약 `118%`, gzip 약 `92%` 큽니다.
- 대표 JSON 요청의 정적 graph에서 Cache, Deduplication, `MemoryCacheStore`와 logical lifecycle dispatcher 구현을 제거했습니다. 선언과 공개 interface는 core에 남지만 실제 hook은 사용 시 별도 ESM chunk를 불러옵니다.
- 모든 공개 API와 optional module을 한 파일로 합친 complete root 기준선은 `50,805 / 15,536 bytes gzip`입니다. 이 수치는 최초 요청 비용이 아니라 전체 기능 비용 회귀를 감시합니다.
- Logical lifecycle과 OPTIONS interface 추가로 대표 요청은 이전 기준선보다 `2,415 bytes minified / 539 bytes gzip` 증가했지만 `44/14 KiB` 예산은 완화하지 않았습니다.
- Cache 구현은 `3,620 / 1,722 bytes gzip`, Deduplication은 `3,730 / 1,743 bytes gzip`이며 각각 별도 `4/2.5 KiB` 예산으로 제한합니다.
- Logical lifecycle dispatcher는 `1,722 / 926 bytes gzip`이며 같은 별도 예산으로 제한합니다.

Complete root는 optional loader 경계까지 한 파일로 강제 합치므로 상한을 `52/17 KiB`로 완화했습니다. 대신 일반 사용자의 초기 비용인 대표 요청은 `44/14 KiB`로 유지하고 정책별 예산을 추가해, 전체 상한 증가가 사용하지 않는 기능의 무제한 core 편입으로 이어지지 않게 합니다.

이 수치는 네트워크 왕복시간이나 실제 처리량 benchmark가 아닙니다. 현재 Lafetch에는 신뢰할 수 있는 runtime overhead 비교 자료가 없으므로 성능 우위를 주장하지 않습니다.

### 패키지 특성

| 항목 | Lafetch | Axios | Ky |
| --- | --- | --- | --- |
| Runtime dependency | 0 | 4 | 0 |
| 배포 package unpacked | `494,045 bytes` 실측 | `1,772,607 bytes` registry metadata | `405,395 bytes` registry metadata |
| 대표 browser bundle gzip | `14,167 bytes` | `17,855 bytes` | `7,370 bytes` |
| Module | ESM | ESM, CJS | ESM |
| Node.js engine | `>=20` | package에서 미지정 | `>=22` |
| Built-in transport | Fetch | XHR, HTTP, Fetch adapter | Fetch |

Package unpacked 크기는 dependency 설치 크기를 포함하지 않으며 runtime 성능을 의미하지 않습니다.

## 기술 비교

| 평가 축 | Axios | Ky | Lafetch | 판정 |
| --- | --- | --- | --- | --- |
| 기본 응답 DX | 자동 변환된 `AxiosResponse.data` | direct `Response`, shortcut decoder | direct `LResponse.data`, 명시적 `as(mode)` | Lafetch는 Axios metadata와 Ky식 terminal의 장점을 결합 |
| Fetch 상호운용성 | adapter에 따라 의미가 달라질 수 있음 | native Fetch 중심 | native Request/Response/Stream 중심 | Ky와 Lafetch 우세 |
| RequestInit 범위 | 자체 config가 매우 넓음 | 대부분의 `RequestInit` 지원 | stable 고급 필드의 `requestInit()` | Ky가 범위에서 우세, Lafetch는 정책 충돌을 차단 |
| Runtime Schema | core 지원 없음 | Standard Schema V1 | Standard Schema V1과 기존 adapter | Ky와 Lafetch 대등 |
| 오류 narrowing | `isAxiosError`, `isCancel` | 세분화된 `is*Error` guard | `isHttpError(error, code?)` | 세 제품 모두 공식 guard 제공 |
| Retry | core API 없음 | 기본 Retry, custom predicate, forced Retry, server delay header | 명시적 Retry, Retry-After, Backoff, Idempotency 연계 | Lafetch는 Axios보다 우세, Ky보다 제어 범위가 좁음 |
| Timeout | 단일 request timeout 중심 | attempt와 total timeout | attempt와 total timeout | Ky와 Lafetch 대등 |
| Body 완료까지 Timeout·Abort | adapter와 소비 방식에 따라 다름 | shortcut Body 소비는 response Promise 이후 | Buffered와 Streaming Body 종료까지 lifecycle 유지 | Lafetch 우세 |
| Buffered Body 상한 | Node 옵션은 있으나 기본 unlimited | 성공 Body shortcut의 공통 상한 없음 | 전 runtime 기본 16 MiB | Lafetch 우세 |
| Cache | core application cache 없음 | Fetch cache option과 hook 조합 | CacheStore, TTL, Cache-Control, 격리 | Lafetch 우세 |
| Deduplication | core 없음 | core 없음 | leader/follower, Abort 경쟁 상태와 client 격리 | Lafetch 우세 |
| Idempotency | 수동 header 또는 interceptor | 수동 header 또는 hook | Retry와 연계된 공식 policy | Lafetch 우세 |
| 확장 구조 | interceptor와 adapter | lifecycle hooks와 custom Fetch | Feature graph, Capability, Transport | Lafetch가 안전성에서 우세, SDK 성숙도는 열세 |
| Telemetry | interceptor로 직접 구성 | hook와 context로 직접 구성 | 구조화 event, redaction, 비차단 handler | Lafetch 우세 |
| Upload/download progress | 지원 | 지원 | 전용 API 없음 | Lafetch 열세 |
| Form, query 직렬화 | 가장 넓은 자동화와 custom serializer | Web Platform 중심 편의 기능 | 제한된 Query와 raw Body | Axios 우세 |
| Node transport | Proxy, redirect, decompress, rate, experimental HTTP/2 | native Fetch 범위 | native Fetch와 custom Transport | Axios 우세 |
| Runtime 검증 | adapter별 범위가 넓음 | modern runtime 중심 | Node 20/22/24, Chromium, Workers, Next.js 자동 검증 | Lafetch의 명시적 matrix가 강점 |
| 최소 bundle | 가장 큼 | 가장 작음 | 중간 | Ky 우세 |

## Lafetch의 확실한 강점

### 1. Reliability policy를 하나의 실행 모델로 관리

Axios interceptor와 Ky hook는 유연하지만, 여러 확장이 같은 lifecycle을 수정할 때 순서, 충돌과 상태 소유권을 사용자가 관리해야 합니다.

Lafetch는 다음을 core 계약으로 검증합니다.

- Feature dependency와 ordering graph
- exclusive와 observer Capability
- Cache와 Deduplication의 client 격리
- leader/follower Abort와 Timeout
- Retry 전체 sequence의 단일 Deduplication ownership
- Idempotency key의 attempt 간 안정성
- Streaming과 호환되지 않는 policy의 실행 전 거부

이 구조는 단일 요청의 짧은 DX보다 여러 reliability 기능을 조합할 때 가치가 커집니다.

### 2. Body lifecycle과 메모리 안전성

Lafetch의 가장 강한 차별점입니다.

- Buffered 응답은 모든 지원 runtime에서 기본 `16 MiB` 상한 적용
- `Content-Length`가 없거나 잘못되어도 실제 chunk를 추적
- `as("stream")`은 전체 Body를 보관하지 않음
- total과 attempt Timeout이 Header 수신이 아니라 Body 종료까지 유지
- accepted Streaming Body를 노출한 이후에는 Retry하지 않음
- Cache와 Deduplication이 Streaming 소유권을 침범하지 못함
- Request stream Retry에는 `bodyFactory()`를 요구

Axios와 Ky도 Stream을 사용할 수 있지만, 이 전체 조합을 하나의 cross-runtime 계약으로 고정하지는 않습니다.

### 3. 보안 기본값과 격리

- 기본 credentials가 `omit`
- 인증 또는 token 성격의 요청은 자동 Cache와 Deduplication에서 우회
- 사용자 key를 사용한 unsafe method policy
- 오류와 Telemetry의 민감 header·query redaction
- Feature 충돌과 잘못된 설정을 Transport 실행 전에 거부
- request와 policy 설정을 선언 시점에 snapshot

보안 기능을 별도 옵션 모음이 아니라 기본 실행 규칙에 포함한 점이 강점입니다.

### 4. 좁고 일관된 공개 문법

```ts
const response = await api
  .get<User>("/users/123")
  .timeout("3s")
  .retry(2)
  .cache("30s");

response.data;
response.status;
response.meta.attempts;
```

- named method는 URL만 받음
- 정책은 fluent method 한 형태로만 표현
- direct `await`는 `LResponse`
- decoder를 강제할 때만 `as(mode)`
- runtime validation은 `validate(schema)`
- raw Buffered와 live Streaming ownership을 분리

Axios의 큰 options object와 Ky의 option/hook 조합보다 선택지는 적지만, 같은 기능의 표현이 중복되지 않습니다.

### 5. 실제 소비 환경 검증

현재 다음 경로를 자동 또는 package consumer test로 검증합니다.

- Node.js 20, 22, 24
- Chromium
- Workers/Edge
- Next.js App Router
- packed JavaScript와 TypeScript consumer
- declaration export
- browser bundle budget

기능 구현과 runtime 호환성 주장을 같은 CI 계약에 둔 점은 기술적 경쟁력입니다.

## 개선 백로그

우선순위 정의:

- `P0`: 공개 API가 더 굳기 전에 해결해야 하는 계약 결함
- `P1`: v1 이전에 경쟁력을 결정하는 production 기능
- `P2`: 사용 근거가 생길 때 선택적으로 추가하거나 문서로 해결할 기능

### P0 — 완료된 공개 계약 보강

| ID | 부족한 점 | 영향 | 결정 |
| --- | --- | --- | --- |
| COMP-01 | `unknown` 오류를 안전하게 좁히는 guard 부재 | package 중복·realm 경계에서 `instanceof`만으로 부족 | 완료: branded `isHttpError(error, code?)`와 code별 subtype narrowing |
| COMP-02 | Standard Schema V1 공식 호환 부재 | validator 상호운용 계약과 타입 추론이 비표준 | 완료: dependency 없는 `~standard.validate`와 Zod·Valibot 검증 |
| COMP-03 | 고급 `RequestInit` 전달 경로 부재 | Web Platform 기능 일부를 표현할 수 없음 | 완료: stable field만 허용하는 `requestInit()`과 cache 충돌 규칙 |
| COMP-04 | `LResponse.request`가 native `Request`를 보존 | upload Body와 민감 Header를 불필요하게 참조 | 완료: immutable redacted `RequestSnapshot`으로 대체 |

#### COMP-01 완료 조건

- `isHttpError(error)`가 `HttpError`로 narrowing
- `isHttpError(error, "ERR_HTTP_TIMEOUT")`처럼 stable code로 subtype narrowing
- 같은 package의 `instanceof`, package가 중복 설치된 경우, plain unknown input 테스트
- 구조만 비슷한 일반 오류를 과도하게 Lafetch 오류로 판정하지 않음
- bundle 증가량 측정

전용 guard를 오류 class마다 무한히 추가하지 않습니다. 하나의 공식 표현 원칙을 유지합니다.

#### COMP-02 완료 조건

- Standard Schema V1 success, issues, sync와 async validation 테스트
- Zod 등 최소 두 validator의 실제 package consumer 검증
- 기존 function, `parse`, `validate` adapter와 명확한 우선순위
- Schema output이 direct `LResponse.data`와 모든 data mode에 동일하게 반영
- validation error의 `issues`와 `cause` 보존

#### COMP-03 완료 조건

- 기존 `credentials()`, `cache()`, `signal()` 등과 충돌하는 필드 처리 원칙 확정
- Browser, Workers와 Node.js에서 실제 Fetch 의미가 유지되는 필드만 허용
- 알 수 없는 값과 환경 미지원 기능의 오류 경계 정의
- 두 번째 일반 요청 DSL을 만들지 않음
- native option을 사용하지 않는 요청의 타입과 bundle 회귀 없음

모든 `RequestInit` 필드를 개별 fluent method로 복제하지 않습니다.

#### COMP-04 완료 조건

- `LResponse`가 native Request Body를 보존하지 않음
- method, 최종 URL과 redacted header가 필요한 진단 사용 사례는 snapshot으로 충족
- snapshot 객체와 내부 header record가 immutable
- direct `LResponse`를 장기 보관해도 raw upload Body에 도달할 수 없음
- 현행 README, 상세 가이드와 RFC에 계약 기록

### P1 — Reliability와 production 경쟁력

| ID | 부족한 점 | 영향 | 방향 |
| --- | --- | --- | --- |
| COMP-05 | Retry가 custom predicate와 response-content Retry를 표현하지 못함 | Ky 2.0 대비 adaptive Retry 범위가 좁음 | 진행 중: `maxRetryAfter` 분리 완료, predicate와 forced Retry gate는 후속 |
| COMP-06 | Transport용 conformance kit와 안정성 정책 부재 | custom Transport는 가능하지만 품질을 검증할 공식 방법이 없음 | Feature SDK와 함께 Transport contract 안정화 |
| COMP-07 | Upload/download progress 계약 부재 | 파일 전송 UX에서 Axios와 Ky보다 불편 | Stream·Telemetry 기반 optional Feature로 먼저 검토 |
| COMP-08 | 대표 요청도 root 전체와 거의 같은 bundle | 사용하지 않는 policy가 초기 비용에 포함 | v0.4 초기 분리 완료, v0.8에서 측정 자동화와 최종 구조 재평가 |
| COMP-09 | 실제 request overhead benchmark 부재 | 성능 우위를 주장하거나 회귀를 탐지할 수 없음 | deterministic local transport benchmark와 CI threshold 설계 |
| COMP-10 | 성공 응답에 비해 HTTP status error Body 소비가 번거로움 | `HttpStatusError.response`를 직접 clone·decode해야 함 | bounded Body를 유지하면서 중복 보관 없는 error data DX RFC |
| COMP-11 | 일반 lifecycle 작업에 고급 Feature hook가 필요함 | 인증 Header 갱신과 최종 응답 확인의 학습 비용이 큼 | v0.4에서 단일 `.on(handler)` logical lifecycle 제공 |
| COMP-12 | 표준 `OPTIONS` named method가 없음 | 기본 Retry safe method와 공개 client method가 비대칭 | v0.4에서 bodyless `api.options()` 제공 |

#### Logical lifecycle 방향

- event별 overload 대신 `event.type`으로 좁혀지는 단일 `.on(handler)`를 사용
- public lifecycle은 `LRequest`와 `LResponse`, attempt 제어는 native `Request`와 `Response` 사용
- Retry 전체에서 request와 최종 response를 각각 한 번만 처리
- attempt metadata는 `LResponse.meta`와 Telemetry에 유지
- direct 실행할 수 없는 same-lineage request draft로 client 격리와 중복 dispatch 차단
- data·raw·stream terminal을 `LResponse`로 다시 포장하지 않음

#### Retry 방향

Lafetch는 Ky의 동작을 그대로 복제하지 않습니다.

- 표준 `Retry-After`는 기본 지원 유지
- server delay 상한은 일반 Backoff와 분리하고, 상한을 넘으면 서버 지시보다 일찍 재시도하지 않음
- 평가 시점의 RateLimit header는 Internet-Draft이므로 기본 표준처럼 고정하지 않음
- non-standard `X-RateLimit-*`은 명시적 opt-in 또는 adapter로만 검토
- server 지정 delay의 별도 상한을 공개 계약으로 분리
- custom predicate가 programming error나 unsafe method를 무분별하게 Retry하지 못하도록 method와 idempotency gate를 우선 적용
- accepted Body가 노출된 뒤에는 custom logic도 Retry할 수 없음

#### Transport 방향

Axios의 Node 전용 기능을 core에 직접 이식하지 않습니다.

```text
@laflabs/lafetch
  └─ Fetch/Web Platform core

optional transport
  ├─ proxy
  ├─ HTTP/2
  ├─ bandwidth limit
  └─ specialized runtime
```

먼저 `Transport` conformance test를 제공하고 실제 수요가 확인된 기능만 선택 package로 만듭니다.

#### Progress 방향

Download progress는 이미 `LStreamResponse.body`와 `pipe()`로 구현할 수 있습니다. 따라서 core shortcut을 즉시 추가하지 않고 다음 순서로 검토합니다.

1. 공식 recipe와 reusable `TransformStream`
2. Telemetry event로 노출할 때의 event volume과 sampling
3. optional Feature
4. 반복 사용 근거가 있을 때만 core method

Upload progress는 runtime별 request stream 지원 차이가 크므로 조용히 무시하는 동작을 채택하지 않습니다. 미지원 runtime에서는 명시적으로 capability를 판정해야 합니다.

### P2 — 의도적으로 추격하지 않는 범위

| 항목 | 결정 |
| --- | --- |
| 기본 global one-off client | 추가하지 않음. 명시적 client가 Cache, Deduplication과 credentials 격리 경계임 |
| Axios 전체 Form serializer 복제 | 추가하지 않음. `FormData`, `URLSearchParams`와 recipe를 우선 |
| 모든 nested query convention 내장 | 추가하지 않음. 서버마다 다른 bracket 규칙을 core 표준으로 만들지 않음 |
| CJS build | 실제 사용자 요구가 확인되기 전까지 ESM 유지 |
| React Native | Web Fetch 호환성 검증 없이 지원을 선언하지 않음 |
| Axios Node adapter 전체 복제 | core 범위 밖. 필요하면 선택 Transport |
| Ky보다 작은 절대 bundle | 목표로 삼지 않음. 대신 대표 요청 `14 KiB gzip`과 optional policy별 비용을 관리 |
| 자동 Retry 기본 활성화 | 추가하지 않음. 네트워크 요청 횟수와 부작용은 caller가 명시 |

## 로드맵 연결

이 문서는 문제와 판단 근거만 관리합니다. 버전별 상세 작업과 완료 조건은 [개발 로드맵](roadmap.md)을 단일 기준으로 사용합니다.

| 단계 | 연결된 개선 항목 |
| --- | --- |
| v0.3.1 완료 | COMP-01~04: Error guard, Standard Schema, `RequestInit`, Request snapshot |
| v0.4 | COMP-05·08·11·12: adaptive Retry, optional policy bundle, logical lifecycle, OPTIONS |
| v0.5 | COMP-06: Feature·Transport conformance |
| v0.6 | COMP-07, COMP-10: Progress와 Status error data |
| v0.8 | COMP-08 마무리, COMP-09: 최종 Bundle 구조와 runtime overhead |

## 재평가 조건

다음 시점에 같은 기준으로 다시 평가합니다.

- v0.5 Feature와 Transport SDK 완료
- v0.9 Release Candidate 진입
- Axios 또는 Ky의 major release로 핵심 계약이 변경된 경우

재평가에서도 인기 지표를 기술 점수에 포함하지 않습니다. 실제 Lafetch 사용 사례가 생기면 사용성 근거로만 별도 기록합니다.
