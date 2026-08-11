# Lafetch Security Policy

Lafetch는 네트워크 입력과 원격 응답을 신뢰하지 않습니다. 보안 경계가 공개 API의 편의성보다 우선하며, 취약한 동작을 호환성 옵션으로 유지하지 않습니다.

## 지원 범위

Lafetch는 아직 npm에 공개 배포되지 않은 pre-release 프로젝트입니다. 보안 수정은 최신 `main`과 현재 개발 버전에만 적용합니다.

| 버전 | 보안 지원 |
| --- | --- |
| `0.4.0-alpha.4` 및 이후 | 지원 |
| `0.4.0-alpha.3` 및 이전 | 지원하지 않음 |

이전 revision을 소스에서 직접 사용 중이라면 최신 보안 수정이 포함된 revision으로 업데이트해야 합니다.

## 취약점 신고

취약점, credential, 실제 사용자 데이터 또는 재현 가능한 exploit을 public Issue에 게시하지 마세요.

1. Repository의 **Security** 탭에서 private vulnerability report를 사용할 수 있으면 해당 경로로 신고합니다.
2. private report 경로가 보이지 않으면 public Issue에는 상세 내용을 남기지 말고, maintainer에게 private 연락 경로만 요청합니다.
3. 영향받는 version 또는 commit, 공격 전제, 최소 재현 절차와 예상 영향을 함께 전달합니다.

유효한 신고를 받으면 재현 여부와 영향 범위를 먼저 확인하고, 수정과 회귀 검증이 끝난 뒤 필요한 공개 범위를 결정합니다. 확인되지 않은 보고서에 수정 완료 시점을 보장하지는 않습니다.

## 0.4.0-alpha.4 보안 Hotfix

2026-08-09 내부 보안 검토에서 확인된 Medium 7건과 Low 2건을 npm 공개 배포 전에 수정했습니다. Critical 또는 High finding은 확인되지 않았습니다.

### 수정된 보안 경계

- **Origin confinement** — `baseUrl` client가 공통 `Authorization` Header나 credential 설정을 다른 origin으로 승계하지 못하도록 same-origin 요청만 허용합니다.
- **Request identity isolation** — Cache와 Deduplication identity에 `integrity`, `mode`, `redirect`, `referrer`를 포함한 Fetch 실행 정책을 반영합니다.
- **Unsafe request replay prevention** — Unsafe method의 Dedupe leader가 Abort 또는 Timeout으로 모호하게 실패해도 follower가 쓰기 요청을 자동 재전송하지 않습니다.
- **Bounded in-memory Cache** — 기본 `MemoryCacheStore`에 500개 entry와 응답 Body 합계 64 MiB 제한을 함께 적용합니다.
- **Per-reader freshness** — Cache entry를 읽는 요청의 TTL이 저장 당시의 더 긴 TTL보다 우선하는 최종 상한으로 동작합니다.
- **Cancellation cleanup** — 취소된 Dedupe follower를 진행 중인 leader의 observer registry에서 즉시 분리합니다.
- **Credential redaction and bypass** — signed URL에 흔한 `sig`, `signature`, `jwt`, `X-Amz-Signature`와 민감 referrer를 진단 정보에서 제거하고 Cache·Dedupe 공유를 우회합니다.
- **Early-failure cleanup** — 잘못된 URL은 timer와 Abort listener를 만들기 전에 거부합니다.
- **Fragment removal** — HTTP 전송 identity가 아닌 URL fragment는 Request와 진단 snapshot에 남기지 않습니다.

상세 threat model, 불변식, finding별 결정과 회귀 범위는 [v0.4 Security hotfix RFC](docs/rfcs/v0.4-security-hotfix.md)에 기록합니다.

### 호환성 영향

- `baseUrl`과 다른 origin을 호출하려면 origin별 Lafetch client를 별도로 생성해야 합니다.
- Custom `CacheStore`는 `storedAt`과 `sizeBytes` metadata를 저장하고 그대로 반환해야 합니다.
- 기존 custom Cache·Dedupe key는 내부 Fetch policy suffix가 추가되어 이전 entry와 일치하지 않을 수 있습니다.
- Unsafe Dedupe follower는 leader의 Abort·Timeout 뒤 재전송하지 않고 같은 오류를 받습니다.

보안상 불완전한 compatibility mode는 제공하지 않습니다.

## 검증 기준

Hotfix는 취약 동작이 수정 전 실패하고 수정 후 통과하는 회귀 테스트로 고정했습니다. 다음 gate를 모두 통과해야 수정 완료로 취급합니다.

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:package
pnpm test:worker
pnpm test:next
pnpm test:browser
```

지원 runtime과 CI matrix는 [Runtime compatibility](docs/runtime-compatibility.md)를 따릅니다.

## 사용자의 보안 책임

Lafetch는 HTTP client 수준의 요청 격리, 재시도 안전성, 응답 크기와 메모리 상한을 제공합니다. 다음 책임까지 대신하지는 않습니다.

- 서버의 authentication, authorization과 tenant isolation
- TLS termination과 certificate 운영
- 사용자가 직접 지정한 credential, custom key와 `CacheStore`의 안전성
- 응답 schema와 비즈니스 규칙 검증
- application 수준의 rate limit, audit log와 secret rotation

민감한 요청에는 최소 권한 credential을 사용하고, runtime 데이터 보장이 필요하면 `validate(schema)`를 적용하세요.
