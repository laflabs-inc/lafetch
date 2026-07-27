import { HttpConfigurationError } from "./errors.js";
import {
  deferredFeature,
  featureLoader,
  type ConfiguredFeature,
} from "./deferred-feature.js";
import { durationToMs } from "./duration.js";
import { mergeQuery } from "./query.js";
import {
  validateAbortSignal,
  validateAdvancedRequestInit,
  validateCapabilityMode,
  validateQueryParams,
  validateRequestCredentials,
  validateRetryOptions,
  validateStatusMatcher,
} from "./validation.js";
import type {
  BodyFactory,
  BodySource,
  AdvancedRequestInit,
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
    ...(options.maxRetryAfter !== undefined ? { maxRetryAfter: options.maxRetryAfter } : {}),
    ...(options.backoff !== undefined ? { backoff: Object.freeze({ ...options.backoff }) } : {}),
  });
}

function snapshotFeature(feature: ConfiguredFeature): ConfiguredFeature {
  if (
    typeof feature !== "object"
    || feature === null
    || typeof feature.name !== "string"
    || feature.name.trim() === ""
  ) {
    throw new HttpConfigurationError("use() Feature name must be a non-empty string.");
  }

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
  const load = featureLoader(feature);

  const snapshot: RequestFeature = {
    name: feature.name,
    ...(capabilities !== undefined ? { capabilities } : {}),
    ...(ordering !== undefined ? { ordering } : {}),
    ...(feature.hooks !== undefined ? { hooks: Object.freeze({ ...feature.hooks }) } : {}),
  };
  return Object.freeze(load === undefined ? snapshot : deferredFeature(snapshot, load));
}

export interface ClientConfiguration {
  readonly baseUrl?: string | URL;
  readonly headers: Headers;
  readonly transport: Transport;
  readonly runtime: RuntimeAdapter;
  readonly credentials: RequestCredentials;
  readonly scope: ClientPolicyScope;
}

/** Internal mutable resources isolated to one LClient instance. */
export interface ClientPolicyScope {
  get<T>(key: symbol, initialize: () => T): T;
}

export function createClientPolicyScope(): ClientPolicyScope {
  const values = new Map<symbol, unknown>();
  return {
    get<T>(key: symbol, initialize: () => T): T {
      if (values.has(key)) return values.get(key) as T;
      const value = initialize();
      values.set(key, value);
      return value;
    },
  };
}

export interface RequestConfiguration {
  readonly input: string | URL;
  readonly baseUrl?: string | URL;
  readonly method: string;
  readonly bodyAllowed: boolean;
  readonly headers: Headers;
  readonly query: ReadonlyMap<string, QueryValue>;
  readonly body: BodySource;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly attemptTimeoutMs?: number;
  readonly retry?: {
    readonly retries: number;
    readonly options: RetryOptions;
  };
  readonly acceptStatus?: StatusMatcher;
  readonly features: readonly ConfiguredFeature[];
  readonly transport: Transport;
  readonly runtime: RuntimeAdapter;
  readonly credentials: RequestCredentials;
  readonly requestInit: AdvancedRequestInit;
  readonly maxResponseBytes?: number;
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
  if (!config.bodyAllowed) {
    throw new HttpConfigurationError(
      `${operation} cannot configure a request body for this ${config.method} entry point.`,
    );
  }
}

function assertRequestBodyUnset(config: RequestConfiguration, operation: string): void {
  if (config.body.kind !== "none") {
    throw new HttpConfigurationError(
      `${operation} cannot replace an existing request body. Configure exactly one of json(), body(), or bodyFactory().`,
    );
  }
}

export function createRequestConfiguration(
  client: ClientConfiguration,
  input: string | URL,
  method: string,
  bodyAllowed = method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD",
): RequestConfiguration {
  const headers = new Headers(client.headers);
  return {
    input: input instanceof URL ? new URL(input) : input,
    ...(client.baseUrl !== undefined ? { baseUrl: client.baseUrl } : {}),
    method: method.toUpperCase(),
    bodyAllowed,
    headers,
    query: new Map(),
    body: { kind: "none" },
    features: Object.freeze([]),
    transport: client.transport,
    runtime: client.runtime,
    credentials: client.credentials,
    requestInit: Object.freeze({}),
    scope: client.scope,
  };
}

export function withQuery(config: RequestConfiguration, params: QueryParams): RequestConfiguration {
  validateQueryParams(params);
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
  assertRequestBodyUnset(config, "json()");
  const headers = new Headers(config.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return { ...config, headers, body: { kind: "value", value: encodeJson(value) } };
}

export function withBody(config: RequestConfiguration, value: BodyInit | null): RequestConfiguration {
  assertRequestBodyAllowed(config, "body()");
  assertRequestBodyUnset(config, "body()");
  return { ...config, body: { kind: "value", value } };
}

export function withBodyFactory(config: RequestConfiguration, create: BodyFactory): RequestConfiguration {
  assertRequestBodyAllowed(config, "bodyFactory()");
  assertRequestBodyUnset(config, "bodyFactory()");
  if (typeof create !== "function") {
    throw new HttpConfigurationError("bodyFactory() requires a function.");
  }
  return { ...config, body: { kind: "factory", create } };
}

export function withSignal(config: RequestConfiguration, signal: AbortSignal): RequestConfiguration {
  validateAbortSignal(signal);
  return { ...config, signal };
}

export function withTimeout(config: RequestConfiguration, timeout: Duration): RequestConfiguration {
  return { ...config, timeoutMs: durationToMs(timeout, "timeout") };
}

export function withAttemptTimeout(config: RequestConfiguration, attemptTimeout: Duration): RequestConfiguration {
  return { ...config, attemptTimeoutMs: durationToMs(attemptTimeout, "attemptTimeout") };
}

export function withMaxResponseBytes(config: RequestConfiguration, maxResponseBytes: number): RequestConfiguration {
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 0) {
    throw new HttpConfigurationError("maxResponseBytes() requires a non-negative safe integer.");
  }
  return { ...config, maxResponseBytes };
}

export function withRetry(
  config: RequestConfiguration,
  retries: number,
  options: RetryOptions = {},
): RequestConfiguration {
  if (!Number.isSafeInteger(retries) || retries < 0) {
    throw new HttpConfigurationError("retry() requires a non-negative safe integer retry count.");
  }
  return { ...config, retry: Object.freeze({ retries, options: snapshotRetryOptions(options) }) };
}

export function withAcceptedStatus(config: RequestConfiguration, acceptStatus: StatusMatcher): RequestConfiguration {
  validateStatusMatcher(acceptStatus);
  return {
    ...config,
    acceptStatus: typeof acceptStatus === "function" ? acceptStatus : Object.freeze([...acceptStatus]),
  };
}

export function withCredentials(config: RequestConfiguration, credentials: RequestCredentials): RequestConfiguration {
  return { ...config, credentials: validateRequestCredentials(credentials, "credentials() value") };
}

function hasCapability(config: RequestConfiguration, name: string): boolean {
  return config.features.some((feature) =>
    feature.capabilities?.provides?.some((capability) => capability.name === name),
  );
}

export function withRequestInit(
  config: RequestConfiguration,
  requestInit: AdvancedRequestInit,
): RequestConfiguration {
  const next = validateAdvancedRequestInit(requestInit, false);
  const merged = validateAdvancedRequestInit({
    ...config.requestInit,
    ...next,
  });
  if (merged.cache !== undefined && hasCapability(config, "cache")) {
    throw new HttpConfigurationError(
      "requestInit.cache cannot be combined with Lafetch application caching.",
    );
  }
  return { ...config, requestInit: merged };
}

export function withFeature(config: RequestConfiguration, feature: ConfiguredFeature): RequestConfiguration {
  const snapshot = snapshotFeature(feature);
  if (
    config.requestInit.cache !== undefined
    && snapshot.capabilities?.provides?.some((capability) => capability.name === "cache")
  ) {
    throw new HttpConfigurationError(
      "Lafetch application caching cannot be combined with requestInit.cache.",
    );
  }
  return { ...config, features: Object.freeze([...config.features, snapshot]) };
}
