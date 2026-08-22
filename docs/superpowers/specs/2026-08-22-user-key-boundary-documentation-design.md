# 사용자 Key의 Tenant·인증 경계 문서화 설계

## 목표

v0.4의 첫 미완료 항목인 사용자 Cache·Deduplication key의 tenant·인증 경계를 기존 동작 그대로 문서화한다. 공개 API, 런타임 동작과 테스트는 변경하지 않는다.

## 확정 계약

- 내장 key는 최종 Request의 method, URL과 모든 Header를 포함하므로 tenant와 representation Header를 자동으로 분리한다.
- 사용자 key는 내장 요청 identity를 대체하므로 Body, tenant와 representation처럼 Response를 바꾸는 값을 호출자가 포함해야 한다.
- Lafetch는 사용자 key에도 Fetch 실행 정책을 덧붙이지만, 누락된 application identity를 추론하지 않는다.
- credential, token 또는 signed URL처럼 민감한 요청은 사용자 key가 있어도 Cache와 Deduplication을 우회한다. 사용자 key는 민감 요청 공유를 활성화하는 opt-in이 아니다.
- 기본 Cache와 Deduplication 상태는 client별로 격리된다. 외부 CacheStore를 여러 client가 공유하면 Store와 사용자 key의 namespace도 호출자 책임이다.

## 변경 범위

1. `docs/cache-deduplication.md`에 내장 key와 사용자 key의 책임 차이, 민감 요청 우회, tenant를 포함하는 안전한 key callback 예제를 추가한다.
2. `docs/roadmap.md`에서 해당 항목을 완료로 표시하고 다음 단계를 adaptive Retry로 좁힌다.
3. `README.md`의 현재 상태도 같은 다음 단계로 맞춘다.

`SECURITY.md`는 이미 custom key와 CacheStore의 안전성을 사용자 책임으로 명시하므로 수정하지 않는다.

## 오류와 안전성

문서는 인증 token 자체를 key 예제에 넣도록 안내하지 않는다. 빈 사용자 key의 기존 `HttpConfigurationError`, 민감 요청의 강제 우회와 unsafe method의 caller-owned key 요구 사항도 변경하지 않는다.

## 검증

- 세 문서가 사용자 key, tenant, 인증 우회와 공유 Store 책임을 서로 모순 없이 설명하는지 확인한다.
- README와 로드맵의 다음 단계가 모두 adaptive Retry를 가리키는지 검색한다.
- 코드 변경이 없으므로 테스트 파일이나 새 테스트를 추가하지 않는다.

## 제외

- Cache·Deduplication key 구현 변경
- 인증 요청 Cache opt-in
- key hashing 또는 namespace API
- adaptive Retry 설계와 구현
