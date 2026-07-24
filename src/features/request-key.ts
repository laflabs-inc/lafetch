import { HttpConfigurationError } from "../core/errors.js";
import { isSensitiveHeaderName, isSensitiveName } from "../core/sensitive.js";

export type RequestKey =
  | string
  | ((request: Request) => string | Promise<string>);

export function hasSensitiveRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (request.credentials !== "omit") return true;
  if (url.username !== "" || url.password !== "") return true;
  for (const name of url.searchParams.keys()) {
    if (isSensitiveName(name)) return true;
  }
  for (const name of request.headers.keys()) {
    if (isSensitiveHeaderName(name)) return true;
  }
  return false;
}

export async function resolveRequestKey(
  configured: RequestKey | undefined,
  request: Request,
): Promise<string> {
  const key = typeof configured === "function"
    ? await configured(request.clone())
    : configured ?? requestKey(request);
  if (typeof key !== "string" || key.trim() === "") {
    throw new HttpConfigurationError("Request key must be a non-empty string.");
  }
  return key;
}

export function requestKey(request: Request): string {
  const headers = [...request.headers.entries()]
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, value]) => `${name}:${value}`)
    .join("\n");
  return `${request.method}\n${request.url}\n${headers}`;
}
