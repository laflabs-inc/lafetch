import { playwright } from "@vitest/browser-playwright";
import { defineConfig, type Plugin } from "vitest/config";

function httpFixture(): Plugin {
  const attempts = new Map<string, number>();
  return {
    name: "lafetch-http-fixture",
    configureServer(server) {
      server.middlewares.use("/__lafetch_fixture__", (request, response) => {
        const url = new URL(request.url ?? "/", "http://fixture.local");
        const route = url.pathname;
        if (route === "/slow") {
          setTimeout(() => {
            if (!response.writableEnded) {
              response.setHeader("content-type", "application/json");
              response.end(JSON.stringify({ ok: true }));
            }
          }, 200);
          return;
        }
        if (route === "/retry") {
          const key = url.searchParams.get("key") ?? "default";
          const attempt = (attempts.get(key) ?? 0) + 1;
          attempts.set(key, attempt);
          response.statusCode = attempt === 1 ? 503 : 200;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ attempt }));
          return;
        }
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          method: request.method,
          query: Object.fromEntries(url.searchParams),
          header: request.headers["x-lafetch-test"] ?? null,
        }));
      });
    },
  };
}

export default defineConfig({
  plugins: [httpFixture()],
  test: {
    include: ["tests/browser/**/*.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
