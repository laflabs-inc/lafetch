import type { MutableRequestDraft } from "../core/types.js";
import { isSensitiveHeaderName, isSensitiveName } from "../core/sensitive.js";

export function hasSensitiveRequest(draft: MutableRequestDraft): boolean {
  if (draft.credentials !== "omit") return true;
  if (draft.url.username !== "" || draft.url.password !== "") return true;
  for (const name of draft.url.searchParams.keys()) {
    if (isSensitiveName(name)) return true;
  }
  for (const name of draft.headers.keys()) {
    if (isSensitiveHeaderName(name)) return true;
  }
  return false;
}

export function requestKey(draft: MutableRequestDraft): string {
  const headers = [...draft.headers.entries()]
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, value]) => `${name}:${value}`)
    .join("\n");
  return `${draft.method}\n${draft.url.toString()}\n${headers}`;
}
