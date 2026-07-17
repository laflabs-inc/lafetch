import type { MutableRequestDraft } from "../core/types.js";

const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "proxy-authorization", "x-api-key"]);

export function hasSensitiveRequest(draft: MutableRequestDraft): boolean {
  if (draft.credentials !== "omit") return true;
  for (const name of draft.headers.keys()) {
    if (SENSITIVE_HEADERS.has(name.toLowerCase())) return true;
  }
  return false;
}

export function requestKey(draft: MutableRequestDraft): string {
  const selected = ["accept", "accept-language", "content-type"]
    .map((name) => `${name}:${draft.headers.get(name) ?? ""}`)
    .join("\n");
  return `${draft.method}\n${draft.url.toString()}\n${selected}`;
}
