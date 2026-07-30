import type { CacheStore } from "../core/cache-store.js";
import type { CacheStoreFailureMode } from "./cache-options.js";

export interface RevalidationRead {
  readonly response?: Response;
  readonly stale?: Response;
}

function preserveResponseMetadata(response: Response, source: Response): Response {
  for (const key of ["url", "redirected", "type"] as const) {
    Object.defineProperty(response, key, { value: source[key] });
  }
  Object.defineProperty(response, "clone", {
    value: () => preserveResponseMetadata(
      Response.prototype.clone.call(response),
      source,
    ),
  });
  return response;
}

export async function readRevalidatingCache(
  store: CacheStore,
  key: string,
  now: number,
  request: Request,
  failureMode: CacheStoreFailureMode,
): Promise<RevalidationRead | undefined> {
  try {
    const entry = await store.get(key);
    if (entry === undefined) return {};
    if (
      typeof entry !== "object"
      || entry === null
      || !(entry.response instanceof Response)
      || !Number.isFinite(entry.expiresAt)
    ) {
      throw new TypeError("CacheStore.get() returned an invalid entry.");
    }
    if (entry.expiresAt > now) return { response: entry.response.clone() };
    const stale = entry.response.clone();
    const etag = stale.headers.get("etag");
    const lastModified = stale.headers.get("last-modified");
    if (etag === null && lastModified === null) {
      await store.delete(key);
      return {};
    }
    if (etag !== null) request.headers.set("If-None-Match", etag);
    if (lastModified !== null) request.headers.set("If-Modified-Since", lastModified);
    return { stale };
  } catch (error) {
    if (failureMode === "throw") throw error;
    return;
  }
}

export function mergeNotModifiedResponse(stale: Response, response: Response): Response {
  const headers = new Headers(stale.headers);
  headers.delete("age");
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() !== "content-length") headers.set(name, value);
  }
  const merged = new Response(stale.body, {
    status: stale.status,
    statusText: stale.statusText,
    headers,
  });
  return preserveResponseMetadata(merged, response);
}
