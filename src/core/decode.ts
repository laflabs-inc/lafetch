import { HttpDecodeError } from "./errors.js";

export type ResponseMode = "auto" | "json" | "text" | "arrayBuffer" | "blob" | "formData";

function hasNoBody(response: Response, method?: string): boolean {
  return method === "HEAD" || response.status === 204 || response.status === 205 || response.headers.get("content-length") === "0";
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  return JSON.parse(text) as unknown;
}

export async function decodeResponse(response: Response, mode: ResponseMode, method?: string): Promise<unknown> {
  if (hasNoBody(response, method)) return undefined;

  try {
    if (mode === "json") return await parseJson(response);
    if (mode === "text") return await response.text();
    if (mode === "arrayBuffer") return await response.arrayBuffer();
    if (mode === "blob") return await response.blob();
    if (mode === "formData") return await response.formData();

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/json") || contentType.includes("+json")) return await parseJson(response);
    if (
      contentType.startsWith("text/") ||
      contentType.includes("application/xml") ||
      contentType.includes("application/x-www-form-urlencoded")
    ) {
      return await response.text();
    }
    return await response.arrayBuffer();
  } catch (cause) {
    throw new HttpDecodeError(mode, { cause });
  }
}

