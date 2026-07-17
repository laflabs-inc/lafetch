import { HttpConfigurationError } from "./errors.js";
import { MemoryCacheStore } from "./cache-store.js";
import { mergeQuery } from "./query.js";
import type {
  BodyFactory,
  BodySource,
  ClientOptions,
  QueryParams,
  QueryValue,
  RequestFeature,
  RequestOptions,
  RetryInput,
  RuntimeAdapter,
  StatusMatcher,
  TimeoutInput,
  Transport,
} from "./types.js";

export interface ClientConfiguration {
  readonly baseUrl?: string | URL;
  readonly headers: Headers;
  readonly transport: Transport;
  readonly features: readonly RequestFeature[];
  readonly runtime: RuntimeAdapter;
  readonly credentials: RequestCredentials;
  readonly timeout?: TimeoutInput;
  readonly retry?: RetryInput;
  readonly acceptStatus?: StatusMatcher;
  readonly scope: ClientPolicyScope;
}

/** Internal mutable resources isolated to one LafetchClient instance. */
export interface ClientPolicyScope {
  getCacheStore(): MemoryCacheStore;
  getDedupeExecutions(): Map<string, unknown>;
}

export function createClientPolicyScope(now: () => number = Date.now): ClientPolicyScope {
  let cacheStore: MemoryCacheStore | undefined;
  let dedupeExecutions: Map<string, unknown> | undefined;
  return {
    getCacheStore() {
      cacheStore ??= new MemoryCacheStore(500, now);
      return cacheStore;
    },
    getDedupeExecutions() {
      dedupeExecutions ??= new Map();
      return dedupeExecutions;
    },
  };
}

/** @internal */
export function mergeFeatures(
  base: readonly RequestFeature[],
  overrides: readonly RequestFeature[] = [],
): readonly RequestFeature[] {
  const features = [...base];
  for (const feature of overrides) {
    const existing = features.findIndex((item) => item.name === feature.name);
    if (existing >= 0) features[existing] = feature;
    else features.push(feature);
  }
  return Object.freeze(features);
}

export interface RequestConfiguration {
  readonly input: string | URL;
  readonly baseUrl?: string | URL;
  readonly method: string;
  readonly headers: Headers;
  readonly query: ReadonlyMap<string, QueryValue>;
  readonly body: BodySource;
  readonly signal?: AbortSignal;
  readonly timeout?: TimeoutInput;
  readonly retry?: RetryInput;
  readonly acceptStatus?: StatusMatcher;
  readonly features: readonly RequestFeature[];
  readonly transport: Transport;
  readonly runtime: RuntimeAdapter;
  readonly credentials: RequestCredentials;
  readonly scope: ClientPolicyScope;
}

function encodeJson(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new HttpConfigurationError("jsonBody() cannot serialize undefined, a function, or a symbol.");
    }
    return encoded;
  } catch (cause) {
    if (cause instanceof HttpConfigurationError) throw cause;
    throw new HttpConfigurationError("jsonBody() could not serialize the provided value.", { cause });
  }
}

function bodyFromOptions(options: RequestOptions, headers: Headers): BodySource {
  if (options.body !== undefined && options.json !== undefined) {
    throw new HttpConfigurationError("Request options cannot contain both body and json.");
  }
  if (options.json !== undefined) {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return { kind: "value", value: encodeJson(options.json) };
  }
  if (options.body !== undefined) return { kind: "value", value: options.body };
  return { kind: "none" };
}

export function createRequestConfiguration(
  client: ClientConfiguration,
  input: string | URL,
  options: RequestOptions,
): RequestConfiguration {
  const headers = new Headers(client.headers);
  if (options.headers) new Headers(options.headers).forEach((value, name) => headers.set(name, value));

  const query = mergeQuery(new Map(), options.query ?? {});
  const body = bodyFromOptions(options, headers);
  const timeout = options.timeout === false ? undefined : (options.timeout ?? client.timeout);
  const retry = options.retry === false ? undefined : (options.retry ?? client.retry);
  const acceptStatus = options.acceptStatus ?? client.acceptStatus;

  return {
    input,
    ...(client.baseUrl !== undefined ? { baseUrl: client.baseUrl } : {}),
    method: (options.method ?? "GET").toUpperCase(),
    headers,
    query,
    body,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    ...(retry !== undefined ? { retry } : {}),
    ...(acceptStatus !== undefined ? { acceptStatus } : {}),
    features: mergeFeatures(client.features, options.features),
    transport: client.transport,
    runtime: client.runtime,
    credentials: options.credentials ?? client.credentials,
    scope: client.scope,
  };
}

export function withQuery(config: RequestConfiguration, params: QueryParams): RequestConfiguration {
  return { ...config, query: mergeQuery(config.query, params) };
}

export function withHeader(config: RequestConfiguration, name: string, value: string): RequestConfiguration {
  const headers = new Headers(config.headers);
  headers.set(name, value);
  return { ...config, headers };
}

export function withHeaders(config: RequestConfiguration, values: HeadersInit): RequestConfiguration {
  const headers = new Headers(config.headers);
  new Headers(values).forEach((value, name) => headers.set(name, value));
  return { ...config, headers };
}

export function withoutHeader(config: RequestConfiguration, name: string): RequestConfiguration {
  const headers = new Headers(config.headers);
  headers.delete(name);
  return { ...config, headers };
}

export function withJsonBody(config: RequestConfiguration, value: unknown): RequestConfiguration {
  const headers = new Headers(config.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return { ...config, headers, body: { kind: "value", value: encodeJson(value) } };
}

export function withBody(config: RequestConfiguration, value: BodyInit | null): RequestConfiguration {
  return { ...config, body: { kind: "value", value } };
}

export function withBodyFactory(config: RequestConfiguration, create: BodyFactory): RequestConfiguration {
  return { ...config, body: { kind: "factory", create } };
}

export function withSignal(config: RequestConfiguration, signal: AbortSignal): RequestConfiguration {
  return { ...config, signal };
}

export function withTimeout(config: RequestConfiguration, timeout: TimeoutInput): RequestConfiguration {
  return { ...config, timeout };
}

export function withRetry(config: RequestConfiguration, retry: RetryInput): RequestConfiguration {
  return { ...config, retry };
}

export function withAcceptedStatus(config: RequestConfiguration, acceptStatus: StatusMatcher): RequestConfiguration {
  return { ...config, acceptStatus };
}

export function withCredentials(config: RequestConfiguration, credentials: RequestCredentials): RequestConfiguration {
  return { ...config, credentials };
}

export function withFeature(config: RequestConfiguration, feature: RequestFeature): RequestConfiguration {
  return { ...config, features: mergeFeatures(config.features, [feature]) };
}
