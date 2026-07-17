import { lafetch } from "@laflabs/lafetch";
import { ClientProbe } from "./client-probe";

export const dynamic = "force-dynamic";

export default function Page() {
  const api = lafetch.create({ baseUrl: "https://example.com" });
  return <main><p data-runtime="server">{typeof api.get}</p><ClientProbe /></main>;
}
