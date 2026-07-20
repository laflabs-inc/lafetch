import { HttpConfigurationError } from "./errors.js";
import { MemoryCacheStore } from "./cache-store.js";
import { mergeQuery } from "./query.js";
import {
  validateCapabilityMode,
  validateRequestCredentials,
  validateRetryOptions,
} from "./validation.js";
import type {
  BodyFactory,
  BodySource,
  Duration,
  QueryParams,
  QueryValue,
  RequestFeature,
  RetryOptions,
  RuntimeAdapter,
  StatusMatcher,
  Transport,
} from "./types.js";

function snapshotRetryOptions(options: RetryOptions): RetryOptions {
  validateRetryOptions(options);
  return Object.freeze({
    ...(options.methods !== undefined ? { methods: Object.freeze([...options.methods]) } : {}),
    ...(options.statuses !== undefined ? { statuses: Object.freeze([...options.statuses]) } : {}),
    ...(options.networkErrors !== undefined ? { networkErrors: options.networkErrors } : {}),
    ...(options.respectRetryAfter !== undefined ? { respectRetryAfter: options.respectRetryAfter } : {}),
    ...(options.backoff !== undefined ? { backoff: Object.freeze({ ...options.backoff }) } : {}),
  });
}

function snapshotFeature(feature: RequestFeature): RequestFeature {
  const capabilities = feature.capabilities === undefined
    ? undefined
    : Object.freeze({
      ...(feature.capabilities.provides !== undefined
        ? {
          provides: Object.freeze(feature.capabilities.provides.map((item) => Object.freeze({
            ...item,
            ...(item.mode !== undefined
              ? {
                mode: validateCapabilityMode(
                  item.mode,
                  `Feature "${feature.name}" capability "${item.name}" mode`,
                ),
              }
              : {}),
          }))),
        }
        : {}),
      ...(feature.capabilities.requires !== undefined
        ? { requires: Object.freeze([...feature.capabilities.requires]) }
        : {}),
      ...(feature.capabilities.conflicts !== undefined
        ? { conflicts: Object.freeze([...feature.capabilities.conflicts]) }
        : {}),
    });
  const ordering = feature.ordering === undefined
    ? undefined
    : Object.freeze({
      ...(feature.ordering.before !== undefined ? { before: Object.freeze([...feature.ordering.before]) } : {}),
      ...(feature.ordering.after !== undefined ? { after: Object.freeze([...feature.ordering.after]) } : {}),
      ...(feature.ordering.optionalBefore !== undefined
        ? { optionalBefore: Object.freeze([...feature.ordering.optionalBefore]) }
        : {}),
      ...(feature.ordering.optionalAfter !== undefined
        ? { optionalAfter: Object.freeze([...feature.ordering.optionalAfter]) }
        : {}),
    });

  return Object.freeze({
    name: feature.name,
    ...(capabilities !== undefined ? { capabilities } : {}),
    ...(ordering !== undefined ? { ordering } : {}),
    ...(feature.hooks !== undefined ? { hooks: Object.freeze({ ...feature.hooks }) } : {}),
  });
}

export interface ClientConfiguration {
  readonly baseUrl?: string | URL;
  readonly headers: Headers;
  readonly transport: Transport;
  readonly runtime: RuntimeAdapter;
  readonly credentials: RequestCredentials;
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

export interface RequestConfiguration {
  readonly input: string | URL;
  readonly baseUrl?: string | URL;
  readonly method: string;
  readonly headers: Headers;
  readonly query: ReadonlyMap<string, QueryValue>;
  readonly body: BodySource;
  readonly signal?: AbortSignal;
  readonly timeout?: Duration;
  readonly attemptTimeout?: Duration;
  readonly retry?: {
    readonly retries: number;
    readonly options: RetryOptions;
  };
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
      throw new HttpConfigurationError("json() cannot serialize undefined, a function, or a symbol.");
    }
    return encoded;
  } catch (cause) {
    if (cause instanceof HttpConfigurationError) throw cause;
    throw new HttpConfigurationError("json() could not serialize the provided value.", { cause });
  }
}

function assertRequestBodyAllowed(config: RequestConfiguration, operation: string): void {
  if (config.method === "GET" || config.method === "HEAD") {
    throw new HttpConfigurationError(
      `${operation} cannot configure a request body for ${config.method}. Fetch does not allow GET or HEAD bodies.`,
    );
  }
}

export function createRequestConfiguration(
  client: ClientConfiguration,
  input: string | URL,
  method: string,
): RequestConfiguration {
  const headers = new Headers(client.headers);
  return {
    input: input instanceof URL ? new URL(input) : input,
    ...(client.baseUrl !== undefined ? { baseUrl: client.baseUrl } : {}),
    method: method.toUpperCase(),
    headers,
    query: new Map(),
    body: { kind: "none" },
    features: Object.freeze([]),
    transport: client.transport,
    runtime: client.runtime,
    credentials: client.credentials,
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

export function withJson(config: RequestConfiguration, value: unknown): RequestConfiguration {
  assertRequestBodyAllowed(config, "json()");
  const headers = new Headers(config.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return { ...config, headers, body: { kind: "value", value: encodeJson(value) } };
}

export function withBody(config: RequestConfiguration, value: BodyInit | null): RequestConfiguration {
  assertRequestBodyAllowed(config, "body()");
  return { ...config, body: { kind: "value", value } };
}

export function withBodyFactory(config: RequestConfiguration, create: BodyFactory): RequestConfiguration {
  assertRequestBodyAllowed(config, "bodyFactory()");
  return { ...config, body: { kind: "factory", create } };
}

export function withSignal(config: RequestConfiguration, signal: AbortSignal): RequestConfiguration {
  return { ...config, signal };
}

export function withTimeout(config: RequestConfiguration, timeout: Duration): RequestConfiguration {
  return { ...config, timeout };
}

export function withAttemptTimeout(config: RequestConfiguration, attemptTimeout: Duration): RequestConfiguration {
  return { ...config, attemptTimeout };
}

export function withRetry(
  config: RequestConfiguration,
  retries: number,
  options: RetryOptions = {},
): RequestConfiguration {
  return { ...config, retry: Object.freeze({ retries, options: snapshotRetryOptions(options) }) };
}

export function withAcceptedStatus(config: RequestConfiguration, acceptStatus: StatusMatcher): RequestConfiguration {
  return {
    ...config,
    acceptStatus: typeof acceptStatus === "function" ? acceptStatus : Object.freeze([...acceptStatus]),
  };
}

export function withCredentials(config: RequestConfiguration, credentials: RequestCredentials): RequestConfiguration {
  return { ...config, credentials: validateRequestCredentials(credentials, "credentials() value") };
}

export function withFeature(config: RequestConfiguration, feature: RequestFeature): RequestConfiguration {
  return { ...config, features: Object.freeze([...config.features, snapshotFeature(feature)]) };
}
