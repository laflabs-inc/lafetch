import { lafetch } from "../../src/index.js";

export default {
  async fetch(): Promise<Response> {
    let calls = 0;
    const api = lafetch.create({
      transport: {
        name: "worker-fixture",
        async send(request, context) {
          calls += 1;
          if (request.url.endsWith("/stream")) {
            return new Response(new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("worker stream"));
                controller.close();
              },
            }));
          }
          return context.attempt === 1
            ? new Response("retry", { status: 503 })
            : Response.json({
              calls,
              processGlobal: "process" in globalThis,
              requestCache: request.cache,
              requestRedirect: request.redirect,
            });
        },
      },
    });
    const result = await api
      .get("https://fixture.invalid/runtime")
      .maxResponseBytes(1_024)
      .requestInit({ cache: "no-store", redirect: "manual" })
      .retry(1, { backoff: { type: "fixed", base: 0, jitter: "none" } })
      .validate({
        parse(value: unknown): {
          calls: number;
          processGlobal: boolean;
          requestCache: RequestCache;
          requestRedirect: RequestRedirect;
        } {
          return value as {
            calls: number;
            processGlobal: boolean;
            requestCache: RequestCache;
            requestRedirect: RequestRedirect;
          };
        },
      });
    let streamed = "";
    await (await api
      .get("https://fixture.invalid/stream")
      .as("stream"))
      .pipe("text")
      .forEach((chunk) => {
        streamed += chunk;
      });
    return Response.json({ ...result.data, streamed });
  },
};
