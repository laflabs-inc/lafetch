import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

let runtime: Miniflare | undefined;

afterEach(async () => {
  await runtime?.dispose();
  runtime = undefined;
});

describe("Workers/Edge runtime", () => {
  it("bundles without Node built-ins and executes inside workerd", async () => {
    const bundle = await build({
      entryPoints: ["tests/fixtures/worker-entry.ts"],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      write: false,
    });
    const script = bundle.outputFiles[0]?.text;
    expect(script).toBeTruthy();

    runtime = new Miniflare({
      modules: true,
      script: script!,
      compatibilityDate: "2026-07-01",
    });
    const response = await runtime.dispatchFetch("https://worker.test/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ calls: 2, processGlobal: false });
  });
});
