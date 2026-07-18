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
import { lafetch } from "@laflabs/lafetch";
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
const result = await api.get("/probe").use(feature);
if (result.packageProbe !== "yes" || transport.calls.length !== 1) {
  throw new Error("Packed runtime exports did not execute correctly.");
}
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
const response: Promise<LafetchResponse<User>> = api.get<User>("https://api.example.com/users/1").response();
void request;
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
  if (installedPackage.version !== "0.2.0-alpha.0") {
    throw new Error(`Unexpected installed version: ${installedPackage.version}`);
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
