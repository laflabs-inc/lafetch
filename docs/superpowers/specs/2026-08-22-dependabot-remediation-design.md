# Dependabot 6건 Remediation Design

## 상태

- 대상 repository: `laflabs-inc/lafetch`
- GitHub `main`: `cc8817ddb96a7dfc75af9f7326cf704ad7e7dcca`
- 분석 대상 lockfile blob: `57206fb01fb159d75fb3b1facb2df232c937e051`
- 열린 Dependabot alert: High 1건, Medium 5건
- 분석 방식: GitHub REST intake와 현재 `main` lockfile·manifest·CI·package export의 정적 증거만 사용

GitHub `main`과 로컬 분석 revision의 commit은 달랐지만 `pnpm-lock.yaml` blob은 동일했습니다. 동적 exploit 재현은 수행하지 않았습니다.

## Triage 결과

취약 버전의 존재는 6건 모두 확인했습니다. 다만 영향을 받는 두 package는 `devDependencies`의 transitive dependency이고 Lafetch의 npm 배포 파일에는 포함되지 않습니다. 제품 보안 경계 기준 verdict는 모두 `not_actionable`이며, alert 제거는 지원 중인 `main`의 dependency hygiene와 CI 안전성을 위한 maintenance로 수행합니다.

| Input | Severity | Advisory | 현재 경로 | Patched | Verdict |
| --- | --- | --- | --- | --- | --- |
| Dependabot #14 | High | `GHSA-4cwx-7wf7-3272` | `miniflare@4.20260710.0 → undici@7.28.0` | `undici@7.29.0` | `not_actionable` / high confidence |
| Dependabot #15 | Medium | `GHSA-8xcm-r25x-g524` | `miniflare@4.20260710.0 → undici@7.28.0` | `undici@7.29.0` | `not_actionable` / high confidence |
| Dependabot #16 | Medium | `GHSA-jr45-8vmc-qm54` | `miniflare@4.20260710.0 → undici@7.28.0` | `undici@7.29.0` | `not_actionable` / high confidence |
| Dependabot #17 | Medium | `GHSA-v3r7-h72x-cjcm` | `miniflare@4.20260710.0 → undici@7.28.0` | `undici@7.29.0` | `not_actionable` / high confidence |
| Dependabot #18 | Medium | `GHSA-m8rv-5g2x-5cg5` | `miniflare@4.20260710.0 → undici@7.28.0` | `undici@7.29.0` | `not_actionable` / high confidence |
| Dependabot #19 | Medium | `GHSA-fxqj-rqcc-2cmp` | `next@16.2.12 → postcss@8.4.31` | `postcss@8.5.23` | `not_actionable` / high confidence |

### 공통 boundary 근거

- `package.json`은 runtime `dependencies`를 선언하지 않고 `dist`, `LICENSE`, `README.md`, `docs`만 배포합니다.
- `miniflare`는 `tests/worker-runtime.test.ts`에서 repository가 정의한 Worker fixture를 실행할 때만 사용합니다.
- `next`는 `fixtures/next-app` production-build 호환성 검증에만 사용합니다.
- CI의 pull-request 권한은 `contents: read`이고, 해당 작업은 원래부터 repository code와 test를 실행하므로 advisory 입력이 별도의 더 낮은 신뢰 경계에서 유입되는 hosted service가 아닙니다.
- `SECURITY.md`의 지원 경계는 Lafetch HTTP client가 처리하는 원격 요청·응답이며, 위 도구들은 배포되는 Lafetch runtime graph에 포함되지 않습니다.

### Alert별 정적 판단

- #14, #16은 Undici cache 해석 문제지만 repository는 Undici cache interceptor를 직접 구성하지 않습니다. Miniflare는 test-only runtime이며 다중 사용자 cache service로 배포되지 않습니다.
- #15는 Undici retry interceptor 문제지만 repository의 Retry 구현은 Lafetch core이고 Miniflare의 Undici retry interceptor를 구성하지 않습니다.
- #17은 cookie helper 입력 검증 문제지만 worker fixture와 Lafetch package는 Undici cookie API를 사용하지 않습니다.
- #18은 blob-like body의 `type`에서 발생하는 CRLF injection 문제입니다. Miniflare가 Undici fetch primitive를 포함하므로 vulnerable code는 설치되지만, fixture 입력은 repository 상수이며 별도 공격자 입력 채널이 없습니다.
- #19는 PostCSS가 `from` 없이 공격자 제어 `sourceMappingURL`을 처리할 때의 local file disclosure입니다. 이 repository의 Next fixture는 repository-owned source만 production build하고 외부 stylesheet 처리 service로 배포되지 않습니다.

## 수정 전략

### PostCSS

`postcss`를 직접 override하지 않습니다. 현재 stable `next@16.3.2`가 patched floor인 `postcss@8.5.23`을 선언하므로 root와 fixture의 Next 범위를 `^16.3.2`로 올립니다. Vite가 사용하는 `postcss@8.5.25`는 이미 안전합니다.

### Undici

stable Miniflare 4 최신 계열은 아직 `undici@7.28.0`을 고정하고 있고 Miniflare 5는 alpha입니다. public SDK surface를 흔드는 alpha major upgrade 대신 root `pnpm.overrides`로 유일한 Undici instance를 `7.29.0`에 고정합니다. stable Miniflare 4가 `>=7.29.0`을 채택하면 override를 제거합니다.

`undici@7.29.0`은 Node `>=20.18.1`을 요구하지만 영향을 받는 Miniflare 자체가 Node `>=22` 개발 도구입니다. Lafetch의 공개 `engines.node >=20` 계약은 변경하지 않습니다.

### 후속 triage

현재 registry audit의 `GHSA-f88m-g3jw-g9cj` (Miniflare 경유 Sharp)와 `GHSA-2v37-7h3g-55p8` (Vitest/Vite/PostCSS 경유 Nano ID)는 이 six-alert remediation의 사용자 승인 범위 밖입니다. 별도 follow-up으로 보고하며, 이 plan에서 억제하거나 dependency 변경으로 해결하지 않습니다.

## 완료 조건

- `pnpm-lock.yaml`에 `postcss@8.4.31`과 `undici@7.28.0`이 남지 않습니다.
- Next 경로는 `postcss@8.5.23` 이상, Miniflare 경로는 `undici@7.29.0`을 해석합니다.
- `pnpm audit --json`의 advisory ID에 `GHSA-4cwx-7wf7-3272`, `GHSA-8xcm-r25x-g524`, `GHSA-jr45-8vmc-qm54`, `GHSA-v3r7-h72x-cjcm`, `GHSA-m8rv-5g2x-5cg5`, `GHSA-fxqj-rqcc-2cmp`가 없습니다. whole-registry audit exit code는 follow-up triage와 구분해 acceptance로 해석하지 않습니다.
- typecheck, unit, bundle budget, package, Worker, Chromium, Next.js gate가 모두 통과합니다.
- merge 후 GitHub REST의 open general Dependabot alerts가 빈 배열을 반환합니다.

## Proof gaps

- 실제 advisory exploit은 재현하지 않았습니다.
- GitHub alert의 자동 종료는 patched lockfile이 default branch에 merge된 뒤에만 검증할 수 있습니다.
