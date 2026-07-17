import { HttpConfigurationError } from "./errors.js";
import type { QueryParams, QueryPrimitive, QueryValue } from "./types.js";

function primitiveToString(value: Exclude<QueryPrimitive, undefined>): string {
  return value === null ? "" : String(value);
}

function isQueryArray(value: QueryValue): value is readonly QueryPrimitive[] {
  return Array.isArray(value);
}

export function mergeQuery(base: ReadonlyMap<string, QueryValue>, next: QueryParams): Map<string, QueryValue> {
  const merged = new Map(base);
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) merged.delete(key);
    else merged.set(key, value);
  }
  return merged;
}

export function applyQuery(url: URL, query: ReadonlyMap<string, QueryValue>): URL {
  const result = new URL(url);
  for (const [key, value] of query) {
    result.searchParams.delete(key);
    if (isQueryArray(value)) {
      for (const item of value) {
        if (item !== undefined) result.searchParams.append(key, primitiveToString(item));
      }
    } else if (value !== undefined) {
      result.searchParams.append(key, primitiveToString(value));
    }
  }
  return result;
}

export function resolveUrl(input: string | URL, baseUrl?: string | URL): URL {
  try {
    if (input instanceof URL) return new URL(input);
    if (baseUrl) return new URL(input, baseUrl);
    if (typeof globalThis.location !== "undefined") return new URL(input, globalThis.location.href);
    return new URL(input);
  } catch (cause) {
    throw new HttpConfigurationError(
      `Cannot resolve URL "${String(input)}". Provide an absolute URL or configure baseUrl.`,
      { cause },
    );
  }
}
