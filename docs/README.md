# Lafetch 문서

이 디렉터리는 Lafetch의 현행 사용법, 기술 계약, 개발 계획과 과거 설계 기록을 구분해 관리합니다. 설명 문장은 한국어를 기본으로 작성하고 API 이름, 타입, 표준과 코드 식별자는 원래 영문 표기를 유지합니다.

## 처음 읽는 순서

1. [프로젝트 README](../README.md) — 설치와 핵심 사용법
2. [상세 사용 가이드](advanced-usage.md) — 요청 정책과 확장 기능

## 현재 기술 계약

| 문서 | 역할 |
| --- | --- |
| [커널 아키텍처](architecture.md) | 요청 실행, 상태 격리, Feature lifecycle과 보안 불변식 |
| [Cache와 Deduplication](cache-deduplication.md) | 키, Store, leader/follower 소유권 |
| [런타임 호환성](runtime-compatibility.md) | 지원 환경과 자동 검증 범위 |
| [v0.3 Streaming과 본문 안전성 RFC](rfcs/v0.3-streaming-body-safety.md) | Buffered/Streaming 응답 소유권의 확정 결정 |
| [v0.3.1 공개 계약 보강 RFC](rfcs/v0.3.1-public-contract.md) | Error guard, Standard Schema, `RequestInit`과 요청 snapshot |
| [v0.4 Retry 결정 RFC](rfcs/v0.4-retry-decision.md) | Server-directed delay 상한과 adaptive Retry 경계 |
| [v0.4 Core parity와 logical lifecycle RFC](rfcs/v0.4-core-parity.md) | 단일 `.on(handler)`, `LRequest`·`LResponse` lifecycle과 OPTIONS |
| [v0.4 CacheStore 신뢰성 RFC](rfcs/v0.4-cache-store-reliability.md) | 외부 Store 적합성, 필수 삭제와 장애 모드 |
| [v0.4 Cache invalidation·revalidation RFC](rfcs/v0.4-cache-invalidation-revalidation.md) | key 교체와 validator 기반 stale 갱신 |
| [v0.4 HTTP freshness RFC](rfcs/v0.4-cache-freshness.md) | TTL, `Cache-Control: max-age`, `Age`와 revalidation freshness |

## 계획과 평가

| 문서 | 역할 |
| --- | --- |
| [개발 로드맵](roadmap.md) | 버전별 범위와 완료 조건 |
| [기술 경쟁력 평가와 개선 백로그](improvements.md) | Axios·Ky 대비 기술 평가와 우선순위 근거 |

## 보관 문서

`archive/`는 이미 대체된 설계와 구현 보고서를 보존합니다. 현행 API 사용법의 근거로 사용하지 않습니다.

- [v0.2 공개 API RFC](archive/rfc-v0.2-public-api.md)
- [v0.2.1 Progressive Builder RFC](archive/rfc-v0.2.1-progressive-builder.md)
- [v0.3 API 정리 보고서](archive/v0.3-api-polish.md)

## 관리 원칙

- 현행 API 예제는 `README.md`와 `advanced-usage.md`를 기준으로 한 번만 설명합니다.
- 대체된 문서는 현재 문법으로 계속 고쳐 쓰지 않고 `archive/`에 상태와 대체 문서를 기록합니다.
- 공개 API나 반환 계약이 바뀌면 README, 상세 가이드, 관련 RFC와 package consumer 검증을 함께 갱신합니다.
- 실행 환경이나 번들 수치는 검증 가능한 최신 기준선만 현행 문서에 유지합니다.
- 계획은 `roadmap.md`, 문제와 판단 근거는 `improvements.md`에서 각각 관리해 같은 백로그를 중복 서술하지 않습니다.
