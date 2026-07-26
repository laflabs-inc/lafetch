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
            : Response.json({ calls, processGlobal: "process" in globalThis });
        },
      },
    });
    const result = await api
      .get("https://fixture.invalid/runtime")
      .maxResponseBytes(1_024)
      .retry(1, { backoff: { type: "fixed", base: 0, jitter: "none" } })
      .validate({
        parse(value: unknown): { calls: number; processGlobal: boolean } {
          return value as { calls: number; processGlobal: boolean };
        },
      });
    const streamed = await (await api
      .get("https://fixture.invalid/stream")
      .as("stream")).text();
    return Response.json({ ...result, streamed });
  },
};
