import { HttpConfigurationError } from "../core/errors.js";
import { isSensitiveHeaderName, isSensitiveName } from "../core/sensitive.js";

export type RequestKey =
  | string
  | ((request: Request) => string | Promise<string>);

function hasSensitiveUrl(url: URL): boolean {
  if (
    url.origin === "null"
    || url.hash !== ""
    || url.username !== ""
    || url.password !== ""
  ) return true;
  for (const name of url.searchParams.keys()) {
    if (isSensitiveName(name)) return true;
  }
  return false;
}

export function hasSensitiveRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (request.credentials !== "omit") return true;
  if (hasSensitiveUrl(url)) return true;
  const referrer = request.referrer;
  if (referrer !== "" && referrer !== "about:client" && hasSensitiveUrl(new URL(referrer))) return true;
  for (const name of request.headers.keys()) {
    if (isSensitiveHeaderName(name)) return true;
  }
  return false;
}

export async function resolveRequestKey(
  configured: RequestKey | undefined,
  request: Request,
): Promise<string> {
  const configuredKey = typeof configured === "function"
    ? await configured(request.clone())
    : configured ?? requestKey(request);
  if (typeof configuredKey !== "string" || configuredKey.trim() === "") {
    throw new HttpConfigurationError("Request key must be a non-empty string.");
  }
  const priority = (request as Request & { readonly priority?: string }).priority ?? "";
  return JSON.stringify([
    configuredKey,
    request.cache,
    request.credentials,
    request.integrity,
    request.keepalive,
    request.mode,
    priority,
    request.redirect,
    request.referrer,
    request.referrerPolicy,
  ]);
}

export function requestKey(request: Request): string {
  const headers = [...request.headers.entries()]
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, value]) => `${name}:${value}`)
    .join("\n");
  return `${request.method}\n${request.url}\n${headers}`;
}
