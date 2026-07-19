import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "lafetch-package-"));
const packageDirectory = join(temporaryRoot, "package");
const consumerDirectory = join(temporaryRoot, "consumer");

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: join(temporaryRoot, "npm-cache"),
      npm_config_loglevel: "error",
      npm_config_update_notifier: "false",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
}

try {
  mkdirSync(packageDirectory);
  mkdirSync(consumerDirectory);
  const packOutput = run("npm", ["pack", "--json", "--pack-destination", packageDirectory], root);
  const packResult = JSON.parse(packOutput)[0];
  if (!packResult?.filename) throw new Error("npm pack did not return a tarball filename.");

  const packagedFiles = new Set(packResult.files.map((file) => file.path));
  for (const requiredFile of [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/feature.js",
    "dist/feature.d.ts",
    "dist/testing/index.js",
    "dist/testing/index.d.ts",
    "README.md",
    "docs/migration-v0.2.md",
  ]) {
    if (!packagedFiles.has(requiredFile)) throw new Error(`Packed package is missing ${requiredFile}.`);
  }
  if ([...packagedFiles].some((file) => file.startsWith("src/") || file.startsWith("tests/"))) {
    throw new Error("Packed package must not include source or test files.");
  }

  const tarball = join(packageDirectory, packResult.filename);
  run("npm", ["init", "--yes"], consumerDirectory);
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], consumerDirectory);

  writeFileSync(join(consumerDirectory, "runtime.mjs"), `
import { HttpConfigurationError, lafetch } from "@laflabs/lafetch";
import { defineFeature } from "@laflabs/lafetch/feature";
import { mockTransport } from "@laflabs/lafetch/testing";

const feature = defineFeature({
  name: "package-probe",
  hooks: { prepare({ draft }) { draft.headers.set("X-Package-Probe", "yes"); } },
});
const transport = mockTransport((request) => Response.json({
  packageProbe: request.headers.get("x-package-probe"),
}));
const api = lafetch.create({ baseUrl: "https://api.example.com", transport });
const result = await api.get("/probe").use(feature).asJson();
if (result.packageProbe !== "yes" || transport.calls.length !== 1) {
  throw new Error("Packed runtime exports did not execute correctly.");
}

const invalidConfigurations = [
  () => api.get("/probe").credentials("cross-origin"),
  () => api.get("/probe").credentials(null),
  () => api.get("/probe").json({ invalid: true }),
  () => api.get("/probe").body("invalid"),
  () => api.get("/probe").bodyFactory(() => "invalid"),
  () => api.head("/probe").json({ invalid: true }),
  () => api.request("GET", "/probe").body("invalid"),
  () => lafetch.create({ credentials: "cross-origin" }),
  () => lafetch.create({ credentials: null }),
  () => api.get("/probe").retry(1, { backoff: "fixed" }),
  () => api.get("/probe").retry(1, { backoff: { type: "linear" } }),
  () => api.get("/probe").retry(1, { backoff: { type: null } }),
  () => api.get("/probe").retry(1, { backoff: { jitter: "equal" } }),
  () => api.get("/probe").retry(1, { backoff: { jitter: null } }),
];
for (const configure of invalidConfigurations) {
  try {
    configure();
    throw new Error("Invalid packed-package configuration was accepted.");
  } catch (error) {
    if (!(error instanceof HttpConfigurationError)) throw error;
  }
}
if (transport.calls.length !== 1) throw new Error("Invalid configuration reached the packed Transport.");
`);
  run(process.execPath, ["runtime.mjs"], consumerDirectory);

  writeFileSync(join(consumerDirectory, "consumer.ts"), `
import { lafetch, type LafetchResponse } from "@laflabs/lafetch";
import { defineFeature, type RequestFeature } from "@laflabs/lafetch/feature";
import { mockTransport } from "@laflabs/lafetch/testing";

interface User { id: string }
const feature: RequestFeature = defineFeature({ name: "type-probe" });
const api = lafetch.create({ transport: mockTransport(() => Response.json({ id: "1" })) });
const request: PromiseLike<User> = api.get<User>("https://api.example.com/users/1").use(feature);
const explicit: Promise<User> = api.get<User>("https://api.example.com/users/1").asJson();
const methodResults: Promise<User>[] = [
  api.post<User>("https://api.example.com/users").asJson(),
  api.put<User>("https://api.example.com/users/1").asJson(),
  api.patch<User>("https://api.example.com/users/1").asJson(),
  api.delete<User>("https://api.example.com/users/1").asJson(),
  api.request<User>("QUERY", "https://api.example.com/users").asJson(),
];
const headResult: Promise<void> = api.head<void>("https://api.example.com/users").asJson();
const response: Promise<LafetchResponse<User>> = api.get<User>("https://api.example.com/users/1").asResponse();
if (false) {
  // @ts-expect-error Response data types are declared on the HTTP method, not asJson().
  api.get("/users").asJson<User>();
  // @ts-expect-error Response consumption uses explicit as* terminal methods.
  api.get("/users").as("json");
  // @ts-expect-error The old response() terminal is not part of the public grammar.
  api.get("/users").response();
  // @ts-expect-error The old raw() terminal is not part of the public grammar.
  api.get("/users").raw();
  // @ts-expect-error Fetch does not allow request bodies on GET.
  api.get("/users").json({ filter: "active" });
  // @ts-expect-error Fetch does not allow request bodies on HEAD.
  api.head("/users").body("payload");
  // @ts-expect-error Custom GET requests preserve the Fetch body restriction.
  api.request("GET", "/users").bodyFactory(() => "payload");
  // @ts-expect-error Request credentials use the Fetch standard values.
  api.get("/users").credentials("cross-origin");
  // @ts-expect-error Client credentials use the Fetch standard values.
  lafetch.create({ credentials: "cross-origin" });
  // @ts-expect-error Backoff types are a closed public contract.
  api.get("/users").retry(1, { backoff: { type: "linear" } });
  // @ts-expect-error Jitter types are a closed public contract.
  api.get("/users").retry(1, { backoff: { jitter: "equal" } });
}
void request;
void explicit;
void methodResults;
void headResult;
void response;
`);
  writeFileSync(join(consumerDirectory, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      strict: true,
      noEmit: true,
      skipLibCheck: false,
    },
    files: ["consumer.ts"],
  }, null, 2));

  const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
  run(process.execPath, [tsc, "--project", "tsconfig.json"], consumerDirectory);

  const installedPackage = JSON.parse(readFileSync(
    join(consumerDirectory, "node_modules", "@laflabs", "lafetch", "package.json"),
    "utf8",
  ));
  if (installedPackage.version !== "0.2.1-alpha.0") {
    throw new Error(`Unexpected installed version: ${installedPackage.version}`);
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
