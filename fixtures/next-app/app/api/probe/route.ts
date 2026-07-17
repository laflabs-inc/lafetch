import { lafetch } from "@laflabs/lafetch";

export async function GET() {
  const data = await lafetch.create({
    transport: { name: "next-fixture", send: async () => Response.json({ ok: true }) },
  }).get("https://fixture.invalid/probe").json<{ ok: boolean }>();
  return Response.json(data);
}
