import { lafetch } from "@laflabs/lafetch";
import { defineFeature } from "@laflabs/lafetch/feature";

export async function GET() {
  const fixtureFeature = defineFeature({ name: "next-fixture" });
  const data = await lafetch.create({
    transport: { name: "next-fixture", send: async () => Response.json({ ok: true }) },
  })
    .get<{ ok: boolean }>("https://fixture.invalid/probe")
    .use(fixtureFeature);
  return Response.json(data);
}
