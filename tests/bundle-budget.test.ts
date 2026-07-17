import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const MAX_MINIFIED_BYTES = 36 * 1_024;
const MAX_GZIP_BYTES = 12 * 1_024;

describe("browser bundle budget", () => {
  it("keeps the complete public API inside the alpha size budget", async () => {
    const result = await build({
      entryPoints: ["src/index.ts"],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      minify: true,
      treeShaking: true,
      write: false,
    });
    const output = result.outputFiles[0]?.contents;
    expect(output).toBeDefined();

    expect(output!.byteLength).toBeLessThanOrEqual(MAX_MINIFIED_BYTES);
    expect(gzipSync(output!).byteLength).toBeLessThanOrEqual(MAX_GZIP_BYTES);
  });
});
