# Dependabot Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all six open Dependabot alerts without changing Lafetch runtime behavior or public compatibility.

**Architecture:** Upgrade the owning upstream package for the PostCSS finding and use one temporary root override for the five Undici findings because stable Miniflare 4 has not adopted the patched Undici release. Keep both dependency repairs in the development/CI graph and verify them through existing runtime conformance gates.

**Tech Stack:** pnpm 10.13.1, npm registry metadata, Vitest, TypeScript, Playwright, Miniflare/workerd, Next.js.

**Spec:** `docs/superpowers/specs/2026-08-22-dependabot-remediation-design.md`

## Global Constraints

- Do not change Lafetch source, public exports, public `engines.node >=20`, runtime behavior, bundle ceilings, or package contents.
- Do not upgrade to Miniflare 5 alpha.
- Do not override PostCSS; consume its fix through stable Next.js.
- Pin the temporary Undici override to exactly `7.29.0` and document its removal condition in the spec.
- Add no dependency other than the patched versions already required by the existing toolchain.
- Keep root and `fixtures/next-app` Next.js versions aligned.
- Use `corepack pnpm install --frozen-lockfile` as the reproducibility gate.
- Audit acceptance is the absence from `pnpm audit --json` of the six authorized IDs: `GHSA-4cwx-7wf7-3272`, `GHSA-8xcm-r25x-g524`, `GHSA-jr45-8vmc-qm54`, `GHSA-v3r7-h72x-cjcm`, `GHSA-m8rv-5g2x-5cg5`, and `GHSA-fxqj-rqcc-2cmp`. A whole-registry non-zero exit caused by separately reported findings is not an acceptance failure.

---

### Task 1: Remove the PostCSS alert through Next.js

**Files:**

- Modify: `package.json:57`
- Modify: `fixtures/next-app/package.json:9-11`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: both workspace importers using `next@^16.2.12`.
- Produces: both importers using `next@^16.3.2`, resolving `postcss@8.5.23` or newer with no direct PostCSS override.

- [ ] **Step 1: Record the failing dependency evidence**

Run:

```bash
rg -n 'next@16\.2\.12|postcss@8\.4\.31|postcss: 8\.4\.31' pnpm-lock.yaml
corepack pnpm audit --audit-level moderate
```

Expected: the lockfile shows `next@16.2.12 → postcss@8.4.31`; audit includes `GHSA-fxqj-rqcc-2cmp` and exits non-zero.

- [ ] **Step 2: Raise both Next.js lower bounds**

Change root `package.json`:

```json
"next": "^16.3.2"
```

Change `fixtures/next-app/package.json`:

```json
"next": "^16.3.2"
```

Do not change React, React DOM, or TypeScript versions.

- [ ] **Step 3: Regenerate only dependency metadata**

Run:

```bash
corepack pnpm install --lockfile-only
```

Expected: both importers resolve the same stable Next.js line and the old Next/PostCSS snapshots disappear.

- [ ] **Step 4: Verify the PostCSS alert is removed locally**

Run:

```bash
rg -n 'next@16\.3\.2|postcss@8\.5\.2[3-9]|postcss: 8\.5\.2[3-9]' pnpm-lock.yaml
rg -n 'postcss@8\.4\.31|postcss: 8\.4\.31' pnpm-lock.yaml
corepack pnpm audit --json
```

Expected: the first search shows the patched path, the second search returns no matches, and audit no longer lists `GHSA-fxqj-rqcc-2cmp`. The five Undici advisories may remain until Task 2.

- [ ] **Step 5: Run the Next.js compatibility gate**

Run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test:next
```

Expected: the Lafetch build and Next.js App Router production build pass.

- [ ] **Step 6: Commit the upstream security update**

```bash
git add package.json fixtures/next-app/package.json pnpm-lock.yaml
git commit -m "build: update Next.js for patched PostCSS"
```

---

### Task 2: Override Undici to its patched release

**Files:**

- Modify: `package.json:65`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `miniflare@4.x` with its exact transitive `undici@7.28.0` dependency.
- Produces: one root pnpm override resolving the existing Undici graph to exactly `7.29.0` without changing Miniflare major version.

- [ ] **Step 1: Record the remaining failing evidence**

Run:

```bash
rg -n 'miniflare@4|undici: 7\.28\.0|undici@7\.28\.0' pnpm-lock.yaml
corepack pnpm audit --json
```

Expected: the JSON audit includes the five Undici IDs and the lockfile maps Miniflare to `7.28.0`. Its global exit code may also reflect unrelated findings.

- [ ] **Step 2: Add the temporary root override**

Add this root field after `devDependencies` in `package.json`:

```json
"pnpm": {
  "overrides": {
    "undici": "7.29.0"
  }
}
```

Do not add Undici to `dependencies` or `devDependencies`; it remains transitive development tooling.

- [ ] **Step 3: Regenerate the lockfile**

Run:

```bash
corepack pnpm install --lockfile-only
```

Expected lockfile shape:

```yaml
overrides:
  undici: 7.29.0
```

and the Miniflare dependency edge resolves to `undici: 7.29.0` with no `undici@7.28.0` snapshot.

- [ ] **Step 4: Verify the dependency graph and audit**

Run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm why undici
rg -n 'undici: 7\.28\.0|undici@7\.28\.0|postcss@8\.4\.31' pnpm-lock.yaml
audit_file=/tmp/lafetch-audit.json
audit_status=0
corepack pnpm audit --json > "$audit_file" || audit_status=$?
if [ "$audit_status" -ne 0 ] && [ "$audit_status" -ne 1 ]; then
  exit "$audit_status"
fi
node - "$audit_file" <<'NODE'
const { readFileSync } = require('node:fs');
const targeted = new Set([
  'GHSA-4cwx-7wf7-3272', 'GHSA-8xcm-r25x-g524', 'GHSA-jr45-8vmc-qm54',
  'GHSA-v3r7-h72x-cjcm', 'GHSA-m8rv-5g2x-5cg5', 'GHSA-fxqj-rqcc-2cmp',
]);
const audit = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!audit || typeof audit !== 'object' || Array.isArray(audit)) {
  throw new Error('audit did not return an object report');
}
if (Object.hasOwn(audit, 'error')) {
  throw new Error(`pnpm audit failed: ${JSON.stringify(audit.error)}`);
}
if (!Object.hasOwn(audit, 'advisories') || !audit.advisories ||
    typeof audit.advisories !== 'object' || Array.isArray(audit.advisories)) {
  throw new Error('audit report is missing an advisories object');
}
if (!audit.metadata || typeof audit.metadata !== 'object' || Array.isArray(audit.metadata) ||
    !audit.metadata.vulnerabilities || typeof audit.metadata.vulnerabilities !== 'object' ||
    Array.isArray(audit.metadata.vulnerabilities)) {
  throw new Error('audit report is missing metadata.vulnerabilities');
}
for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
  const count = audit.metadata.vulnerabilities[severity];
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`audit report has invalid ${severity} vulnerability count`);
  }
}
const found = Object.values(audit.advisories)
  .map((advisory) => advisory.github_advisory_id)
  .filter((id) => targeted.has(id));
if (found.length) throw new Error(`targeted advisories remain: ${found.join(', ')}`);
console.log('all six targeted Dependabot advisory IDs are absent');
NODE
```

Expected: `pnpm why` reports only `undici@7.29.0`, the vulnerable-version search returns no matches, and the JSON assertion first rejects operational/error or malformed audit output, then proves all six targeted IDs are absent. Record `GHSA-f88m-g3jw-g9cj` (Sharp) and `GHSA-2v37-7h3g-55p8` (Nano ID), if present, as follow-up triage; do not suppress or remediate them in this plan.

- [ ] **Step 5: Run focused runtime gates**

Run:

```bash
corepack pnpm test:worker
corepack pnpm test:next
corepack pnpm test:browser
```

Expected: Miniflare/workerd, Next.js, and Chromium compatibility tests pass. If local Chromium lacks a system library, record the exact launch blocker and rely on the required GitHub Browser job before merge.

- [ ] **Step 6: Run the full release gates**

Run:

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:package
env LAFETCH_PRINT_BUNDLE_SIZE=1 corepack pnpm exec vitest run tests/bundle-budget.test.ts --disableConsoleIntercept
git diff --check origin/main..HEAD
```

Expected: all functional and packaging gates pass, and the unchanged complete-root and representative bundle ceilings remain green.

- [ ] **Step 7: Commit the temporary transitive override**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: override Undici to patched release"
```

---

## Pull Request and Post-Merge Verification

Before merge, require the GitHub CI jobs for Node 20, 22, 24, Browser/Chromium, and Next.js App Router to pass. After merge, query:

```bash
gh api --paginate -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  '/repos/laflabs-inc/lafetch/dependabot/alerts?classification=general&state=open&per_page=100'
```

Expected: `[]`. If GitHub still reports an alert after the patched lockfile is on `main`, compare the alert's manifest and vulnerable range with the merged lockfile before dismissing anything; do not manually dismiss an alert merely because CI is green.
