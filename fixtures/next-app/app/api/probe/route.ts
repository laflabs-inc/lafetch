import { lafetch } from "@laflabs/lafetch";
import { defineFeature } from "@laflabs/lafetch/feature";

export async function GET() {
  const fixtureFeature = defineFeature({ name: "next-fixture" });
  const api = lafetch.create({
    transport: { name: "next-fixture", send: async () => Response.json({ ok: true }) },
  });
  const data = await api
    .get<{ ok: boolean }>("https://fixture.invalid/probe")
    .use(fixtureFeature);
  let streamed = "";
  await (await api
    .get("https://fixture.invalid/stream")
    .as("stream"))
    .pipe("text")
    .forEach((chunk) => {
      streamed += chunk;
    });
  return Response.json({ ...data, streamed });
}
