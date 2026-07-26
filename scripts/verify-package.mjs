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
    "dist/cache.js",
    "dist/cache.d.ts",
    "dist/feature.js",
    "dist/feature.d.ts",
    "dist/testing/index.js",
    "dist/testing/index.d.ts",
    "README.md",
  ]) {
    if (!packagedFiles.has(requiredFile)) throw new Error(`Packed package is missing ${requiredFile}.`);
  }
  if ([...packagedFiles].some((file) => file.startsWith("src/") || file.startsWith("tests/"))) {
    throw new Error("Packed package must not include source or test files.");
  }

  const tarball = join(packageDirectory, packResult.filename);
  run("npm", ["init", "--yes"], consumerDirectory);
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    tarball,
    join(root, "node_modules", "valibot"),
    join(root, "node_modules", "zod"),
  ], consumerDirectory);

  writeFileSync(join(consumerDirectory, "runtime.mjs"), `
import {
  HttpConfigurationError,
  HttpResponseTooLargeError,
  isHttpError,
  lafetch,
} from "@laflabs/lafetch";
import { MemoryCacheStore } from "@laflabs/lafetch/cache";
import { defineFeature } from "@laflabs/lafetch/feature";
import { mockTransport } from "@laflabs/lafetch/testing";
import * as v from "valibot";
import * as z from "zod";

const feature = defineFeature({
  name: "package-probe",
  hooks: { prepare({ draft }) { draft.headers.set("X-Package-Probe", "yes"); } },
});
const transport = mockTransport((request) => Response.json({
  packageProbe: request.headers.get("x-package-probe"),
}));
const api = lafetch.create({ baseUrl: "https://api.example.com", transport });
if (!(new MemoryCacheStore() instanceof MemoryCacheStore)) {
  throw new Error("Packed Cache entrypoint did not execute correctly.");
}
let policyCalls = 0;
const policyApi = lafetch.create({
  baseUrl: "https://api.example.com",
  transport: mockTransport(() => Response.json({ call: ++policyCalls })),
});
await Promise.all([
  policyApi.get("/dedupe").dedupe(),
  policyApi.get("/dedupe").dedupe(),
]);
await policyApi.get("/cache").cache("1m");
await policyApi.get("/cache").cache("1m");
if (policyCalls !== 2) {
  throw new Error("Packed optional policy chunks did not execute correctly.");
}
const result = await api.get("/probe").use(feature).as("json");
if (result.packageProbe !== "yes" || transport.calls.length !== 1) {
  throw new Error("Packed runtime exports did not execute correctly.");
}
const streamed = await api.get("/stream").as("stream");
let streamedText = "";
await streamed.pipe("text").forEach((chunk) => {
  streamedText += chunk;
});
if (JSON.parse(streamedText).packageProbe !== null || transport.calls.length !== 2) {
  throw new Error("Packed Streaming terminal did not execute correctly.");
}
if (typeof HttpResponseTooLargeError !== "function") {
  throw new Error("Packed response-size error export is missing.");
}
if (!isHttpError(new HttpResponseTooLargeError(1, 2), "ERR_HTTP_RESPONSE_TOO_LARGE")) {
  throw new Error("Packed stable error guard did not recognize a Lafetch error.");
}
const zodResult = await api.get("/zod").validate(
  z.object({ packageProbe: z.string().nullable() }),
).as("json");
const valibotResult = await api.get("/valibot").validate(
  v.object({ packageProbe: v.nullable(v.string()) }),
).as("json");
if (zodResult.packageProbe !== null || valibotResult.packageProbe !== null) {
  throw new Error("Packed Standard Schema validation did not execute correctly.");
}
try {
  await api.get("/invalid-mode").as("xml");
  throw new Error("Unknown packed-package response mode was accepted.");
} catch (error) {
  if (!(error instanceof HttpConfigurationError)) throw error;
}
try {
  await api.get("/removed-result-mode").as("result");
  throw new Error("Removed packed-package result mode was accepted.");
} catch (error) {
  if (!(error instanceof HttpConfigurationError)) throw error;
}
if (transport.calls.length !== 4) {
  throw new Error("Unknown response mode reached the packed Transport.");
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
  () => api.get("/probe").retry(1, { methods: null }),
  () => api.get("/probe").retry(1, { statuses: "500" }),
  () => api.get("/probe").retry(1, { networkErrors: "yes" }),
  () => api.get("/probe").maxResponseBytes(-1),
  () => api.get("/probe").timeout("later"),
  () => api.get("/probe").attemptTimeout(-1),
  () => api.get("/probe").signal(null),
  () => api.get("/probe").query(null),
  () => api.get("/probe").validate(null),
  () => api.get("/probe").requestInit({ method: "POST" }),
  () => api.get("/probe").requestInit({ cache: "only-if-cached" }),
  () => api.get("/probe").mapError(null),
  () => api.get("/probe").use(null),
  () => api.get("/probe").cache("1m", null),
  () => api.get("/probe").dedupe(null),
  () => api.post("/probe").body("one").body("two"),
  () => api.post("/probe").idempotency(null),
  () => api.post("/probe").cache("1m"),
  () => lafetch.create(null),
  () => lafetch.create({ runtime: { sleep: null } }),
  () => lafetch.create({ transport: null }),
];
for (const configure of invalidConfigurations) {
  try {
    configure();
    throw new Error("Invalid packed-package configuration was accepted.");
  } catch (error) {
    if (!(error instanceof HttpConfigurationError)) throw error;
  }
}
if (transport.calls.length !== 4) throw new Error("Invalid configuration reached the packed Transport.");
`);
  run(process.execPath, ["runtime.mjs"], consumerDirectory);

  writeFileSync(join(consumerDirectory, "consumer.ts"), `
import {
  HttpTimeoutError,
  isHttpError,
  lafetch,
  type LClient,
  type LRequest,
  type LResponse,
  type LStream,
  type LStreamResponse,
  type ResponseMode,
  type RequestSnapshot,
} from "@laflabs/lafetch";
import { MemoryCacheStore, type CacheStore } from "@laflabs/lafetch/cache";
import { defineFeature, type RequestFeature } from "@laflabs/lafetch/feature";
import { mockTransport } from "@laflabs/lafetch/testing";
import * as v from "valibot";
import * as z from "zod";

interface User { id: string }
const cacheStore: CacheStore = new MemoryCacheStore();
void cacheStore;
const feature: RequestFeature = defineFeature({ name: "type-probe" });
const api = lafetch.create({ transport: mockTransport(() => Response.json({ id: "1" })) });
const client: LClient = api;
const request: PromiseLike<LResponse<User>> = api.get<User>("https://api.example.com/users/1").use(feature);
const typedRequest: LRequest<User> = api.get<User>("https://api.example.com/users/1");
const explicit: Promise<User> = api.get<User>("https://api.example.com/users/1").as("json");
const methodResults: Promise<User>[] = [
  api.post<User>("https://api.example.com/users").as("json"),
  api.put<User>("https://api.example.com/users/1").as("json"),
  api.patch<User>("https://api.example.com/users/1").as("json"),
  api.delete<User>("https://api.example.com/users/1").as("json"),
  api.request<User>("QUERY", "https://api.example.com/users").as("json"),
];
const headResult: Promise<void> = api.head<void>("https://api.example.com/users").as("json");
const response: Promise<LResponse<User>> = Promise.resolve(
  api.get<User>("https://api.example.com/users/1"),
);
const bytes: Promise<Uint8Array> = api.get("https://api.example.com/binary").as("bytes");
const bufferedResponse: Promise<Response> = api.get("https://api.example.com/response").as("response");
const validatedText: Promise<number> = api.get("https://api.example.com/text").validate({
  parse(value: unknown): number { return String(value).length; },
}).as("text");
const zodValidated: Promise<User> = api
  .get("https://api.example.com/user")
  .validate(z.object({ id: z.string() }))
  .as("json");
const valibotValidated: Promise<User> = api
  .get("https://api.example.com/user")
  .validate(v.object({ id: v.string() }))
  .as("json");
const limited: PromiseLike<LResponse<User>> = api.get<User>("https://api.example.com/users/1").maxResponseBytes(1_000_000);
const advanced: PromiseLike<LResponse<User>> = api
  .get<User>("https://api.example.com/users/1")
  .requestInit({ redirect: "manual", priority: "high" });
const streaming: Promise<LStreamResponse> = api.get("https://api.example.com/events").as("stream");
const dynamicMode: "json" | "text" = Math.random() > 0.5 ? "json" : "text";
const dynamic: Promise<User | string> =
  api.get<User>("https://api.example.com/users/1").as(dynamicMode);
const publicMode: ResponseMode = dynamicMode;
const consumeTextStream = (stream: LStream<string>): void => { void stream; };
const inspectSnapshot = (value: LResponse<User>): RequestSnapshot => value.request;
const caught: unknown = new HttpTimeoutError("total", 1_000);
if (isHttpError(caught, "ERR_HTTP_TIMEOUT")) {
  const timeoutMs: number = caught.timeoutMs;
  void timeoutMs;
}
if (false) {
  // @ts-expect-error Response data types are declared on the HTTP method, not as().
  api.get("/users").as<User>("json");
  // @ts-expect-error Response modes are a closed public contract.
  api.get("/users").as("xml");
  // @ts-expect-error The unpublished result mode was removed.
  api.get("/users").as("result");
  // @ts-expect-error Legacy named terminals are intentionally not kept as aliases.
  api.get("/users").asJson();
  // @ts-expect-error Legacy named terminals are intentionally not kept as aliases.
  api.get("/events").asStream();
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
  // @ts-expect-error A request has exactly one body source.
  api.post("/users").json({ name: "Dohyun" }).body("replacement");
  // @ts-expect-error Request credentials use the Fetch standard values.
  api.get("/users").credentials("cross-origin");
  // @ts-expect-error Client credentials use the Fetch standard values.
  lafetch.create({ credentials: "cross-origin" });
  // @ts-expect-error Request method uses the LClient entry point.
  api.get("/users").requestInit({ method: "POST" });
  // @ts-expect-error Request signals use signal().
  api.get("/users").requestInit({ signal: AbortSignal.timeout(1_000) });
  // @ts-expect-error Backoff types are a closed public contract.
  api.get("/users").retry(1, { backoff: { type: "linear" } });
  // @ts-expect-error Jitter types are a closed public contract.
  api.get("/users").retry(1, { backoff: { jitter: "equal" } });
  // @ts-expect-error Response Schema validation requires buffered consumption.
  api.get("/events").validate((value) => value).as("stream");
  // @ts-expect-error Cache requires buffered consumption.
  api.get("/events").cache("1m").as("stream");
  // @ts-expect-error Deduplication requires buffered consumption.
  api.get("/events").dedupe().as("stream");
}
void request;
void client;
void typedRequest;
void explicit;
void methodResults;
void headResult;
void response;
void bytes;
void bufferedResponse;
void validatedText;
void zodValidated;
void valibotValidated;
void limited;
void advanced;
void streaming;
void dynamic;
void publicMode;
void consumeTextStream;
void inspectSnapshot;
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
  if (installedPackage.version !== "0.3.1-alpha.0") {
    throw new Error(`Unexpected installed version: ${installedPackage.version}`);
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
