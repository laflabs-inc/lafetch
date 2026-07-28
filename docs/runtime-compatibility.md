# 런타임 호환성

Lafetch는 Fetch와 Web Platform primitive를 기준으로 구현합니다. 지원 범위는 추정이 아니라 자동 검증 결과로 정의합니다.

## 자동 검증 범위

| 런타임 | 검증 방법 | 주요 범위 |
| --- | --- | --- |
| Node.js 20, 22, 24 | Vitest와 TypeScript build matrix | 커널, 정책, Buffered/Streaming 소비, lifecycle 오류 |
| Chromium | Playwright 기반 Vitest Browser Mode | 실제 same-origin Fetch, logical lifecycle, OPTIONS, CacheStore 실패 모드, Status Retry, AbortSignal, incremental Streaming |
| Workers/Edge | Miniflare/workerd 격리 fixture | Browser target bundle, logical lifecycle, OPTIONS, CacheStore bypass, Retry, Schema, Web Stream |
| Next.js App Router | Next.js 16 production build | Server, Client, Route Handler의 공개 package 소비 |

`pnpm check`는 일반 테스트 외에도 배포 대상 파일을 tarball로 만들고 빈 프로젝트에 설치합니다. 이 독립 소비자에서 JavaScript 실행, TypeScript declaration과 `.`, `./cache`, `./feature`, `./testing` 공개 export를 검증합니다.

Next.js fixture는 라이브러리 개발 환경의 TypeScript 7과 다른 TypeScript 5.9를 사용합니다. 내부에서는 compile되지만 안정 버전 소비자에서 깨지는 declaration을 찾기 위한 의도적인 차이입니다.

## 번들 회귀 기준

Browser 대상 현재 기준선:

| 대상 | Minified | Gzip |
| --- | ---: | ---: |
| Complete root 단일 bundle | `51,274 bytes` | `15,676 bytes` |
| 대표 JSON 요청 초기 graph | `44,955 bytes` | `14,197 bytes` |
| Cache policy | `4,016 bytes` | `1,868 bytes` |
| Deduplication policy | `3,730 bytes` | `1,743 bytes` |
| Logical lifecycle dispatcher | `1,722 bytes` | `926 bytes` |

Hard ceiling:

- Complete root: `52 KiB / 17 KiB gzip`
- 대표 JSON 요청: `44 KiB / 14 KiB gzip`
- Cache·Deduplication·Logical lifecycle 각각: `4 KiB / 2.5 KiB gzip`

Complete root는 dynamic chunk까지 한 파일로 강제 합쳐 전체 기능 비용을 감시합니다. 대표 요청은 code splitting 후 최초 요청에 필요한 정적 output만 합산하며, Cache·Deduplication 구현, `MemoryCacheStore`와 logical lifecycle dispatcher가 포함되지 않는지도 검사합니다.

이 상한은 성능 목표나 배포 플랫폼 제한이 아니라 의도하지 않은 증가를 막는 회귀 경보입니다. 새 기능은 complete root 상한만 보고 core에 추가하지 않으며 대표 요청과 해당 optional policy 예산을 함께 통과해야 합니다.

## 지원 경계

다음 표준 구현이 필요합니다.

- `fetch`
- `Request`
- `Response`
- `Headers`
- `AbortController`
- `ReadableStream`
- `Blob`
- `FormData`

사용자 Transport는 전역 Fetch를 교체할 수 있지만 응답 소비는 해당 런타임의 Web Platform Response 타입에 의존합니다. `response.pipe("text")`는 표준 `TextDecoderStream`을 추가로 사용하고, byte 및 사용자 transform 경로는 사용하지 않습니다.

Runtime Cache를 Next.js나 배포 플랫폼 Cache에 암묵적으로 위임하지 않습니다. Lafetch Cache Feature는 명시적인 `CacheStore`를 소유하며, framework revalidation 연동은 향후 선택 adapter로 분리합니다.

현재 지원을 선언하지 않는 범위:

- CommonJS 전용 소비자
- Node.js 전용 Proxy·HTTP/2·bandwidth limit
- React Native
- Web Platform primitive가 불완전한 임의의 Fetch polyfill

이 기능은 검증 없이 호환된다고 간주하지 않으며, 실제 수요가 확인되면 core가 아닌 선택 Transport 또는 별도 adapter를 우선 검토합니다.

## CI 책임

- Node matrix는 전체 core suite와 Worker 격리 테스트를 실행합니다.
- Browser job은 고정된 Playwright와 일치하는 Chromium build를 설치합니다.
- Next.js job은 Lafetch를 먼저 build한 뒤 fixture가 공개 package export만 소비합니다.
- Package 검증은 packed tarball을 독립 프로젝트에 설치합니다.
- Bundle budget 초과는 core test를 실패시킵니다.
- Native dependency build script는 명시적으로 허용한 `esbuild`, `workerd`, `sharp`만 사용합니다.
