import { gzipSync } from "node:zlib";
import { relative } from "node:path";
import { build, type BuildResult, type Metafile, type OutputFile } from "esbuild";
import { describe, expect, it } from "vitest";

// Hard alpha regression ceiling, not the expected output size. Intentional
// public API growth must still record a measured baseline in the runtime docs.
const MAX_MINIFIED_BYTES = 52 * 1_024;
const MAX_GZIP_BYTES = 17 * 1_024;
const MAX_REPRESENTATIVE_MINIFIED_BYTES = 44 * 1_024;
const MAX_REPRESENTATIVE_GZIP_BYTES = 14 * 1_024;
const MAX_OPTIONAL_POLICY_MINIFIED_BYTES = 4 * 1_024;
const MAX_OPTIONAL_POLICY_GZIP_BYTES = 2.5 * 1_024;

type SplitBuild = BuildResult<{ metafile: true; write: false }>;

function outputKey(path: string): string {
  return relative(process.cwd(), path).replaceAll("\\", "/");
}

function staticClosure(metafile: Metafile, entry: string): ReadonlySet<string> {
  const visited = new Set<string>();
  const visit = (path: string) => {
    if (visited.has(path)) return;
    visited.add(path);
    for (const dependency of metafile.outputs[path]?.imports ?? []) {
      if (dependency.kind === "import-statement") visit(dependency.path);
    }
  };
  visit(entry);
  return visited;
}

function measureOutputs(
  result: SplitBuild,
  paths: ReadonlySet<string>,
): { minified: number; gzip: number } {
  const outputs = new Map(
    result.outputFiles.map((output: OutputFile) => [outputKey(output.path), output.contents]),
  );
  let minified = 0;
  let gzip = 0;
  for (const path of paths) {
    const contents = outputs.get(path);
    if (!contents) throw new Error(`Missing esbuild output: ${path}`);
    minified += contents.byteLength;
    gzip += gzipSync(contents).byteLength;
  }
  return { minified, gzip };
}

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

  it("keeps a representative JSON request inside its stricter budget", async () => {
    const result = await build({
      stdin: {
        contents: `
          import { lafetch } from "./src/index.ts";
          const api = lafetch.create({ baseUrl: "https://api.example.com" });
          export const request = api.get("/users/1").as("json");
        `,
        loader: "ts",
        resolveDir: process.cwd(),
        sourcefile: "representative-request.ts",
      },
      bundle: true,
      splitting: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      minify: true,
      treeShaking: true,
      write: false,
      metafile: true,
      outdir: "out",
    }) as SplitBuild;
    const entry = Object.entries(result.metafile.outputs)
      .find(([, output]) => output.entryPoint === "representative-request.ts")?.[0];
    expect(entry).toBeDefined();

    const initial = staticClosure(result.metafile, entry!);
    const size = measureOutputs(result, initial);
    expect(size.minified).toBeLessThanOrEqual(MAX_REPRESENTATIVE_MINIFIED_BYTES);
    expect(size.gzip).toBeLessThanOrEqual(MAX_REPRESENTATIVE_GZIP_BYTES);

    const initialInputs = new Set(
      [...initial].flatMap((path) => Object.keys(result.metafile.outputs[path]!.inputs)),
    );
    expect(initialInputs).not.toContain("src/features/cache.ts");
    expect(initialInputs).not.toContain("src/features/dedupe.ts");
    expect(initialInputs).not.toContain("src/core/cache-store.ts");
    expect(initialInputs).not.toContain("src/core/logical-lifecycle.ts");
  });

  it.each([
    ["Cache", "src/features/cache.ts"],
    ["Deduplication", "src/features/dedupe.ts"],
    ["Logical lifecycle", "src/core/logical-lifecycle.ts"],
  ])("keeps the optional %s module inside its isolated budget", async (_name, entryPoint) => {
    const result = await build({
      entryPoints: [entryPoint],
      bundle: true,
      splitting: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      minify: true,
      treeShaking: true,
      write: false,
      metafile: true,
      outdir: "out",
    }) as SplitBuild;
    const entry = Object.entries(result.metafile.outputs)
      .find(([, output]) => output.entryPoint === entryPoint)?.[0];
    expect(entry).toBeDefined();

    const size = measureOutputs(result, staticClosure(result.metafile, entry!));
    expect(size.minified).toBeLessThanOrEqual(MAX_OPTIONAL_POLICY_MINIFIED_BYTES);
    expect(size.gzip).toBeLessThanOrEqual(MAX_OPTIONAL_POLICY_GZIP_BYTES);
  });
});
