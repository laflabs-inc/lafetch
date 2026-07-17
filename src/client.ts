import {
  createClientPolicyScope,
  createRequestConfiguration,
  mergeFeatures,
  withFeature,
  type ClientConfiguration,
  type RequestConfiguration,
} from "./core/config.js";
import { createRuntime } from "./core/runtime.js";
import type {
  ClientOptions as CoreClientOptions,
  RequestOptions as CoreRequestOptions,
} from "./core/types.js";
import { createRequestBuilder, type RequestBuilder } from "./request-builder.js";
import { fetchTransport } from "./transports/fetch.js";
import { createCacheFeature, type CacheInput } from "./features/cache.js";
import { createDedupeFeature, type DedupeOptions } from "./features/dedupe.js";
import { idempotency, type IdempotencyOptions } from "./features/idempotency.js";
import { telemetry, type TelemetryInput } from "./features/telemetry.js";

export interface RequestPolicyOptions {
  /** Enable the response cache with safe defaults, or configure it. */
  readonly cache?: boolean | CacheInput;
  /** Enable in-flight request deduplication with safe defaults, or configure it. */
  readonly dedupe?: boolean | DedupeOptions;
  /** Add one stable idempotency key for the request execution. */
  readonly idempotency?: boolean | IdempotencyOptions;
  /** Observe the request lifecycle without installing a Feature manually. */
  readonly telemetry?: TelemetryInput | false;
}

export interface LafetchRequestOptions extends CoreRequestOptions, RequestPolicyOptions {}

export interface LafetchClientOptions extends CoreClientOptions {
  /** Default cache policy inherited by requests. Set false in extend() to disable it. */
  readonly cache?: boolean | CacheInput;
  /** Default deduplication policy inherited by requests. Set false in extend() to disable it. */
  readonly dedupe?: boolean | DedupeOptions;
  /** Default telemetry observer inherited by requests. Set false in extend() to disable it. */
  readonly telemetry?: TelemetryInput | false;
}

/** Concise alias for LafetchClientOptions. */
export type ClientOptions = LafetchClientOptions;
/** Concise alias for LafetchRequestOptions. */
export type RequestOptions = LafetchRequestOptions;

type MethodRequestOptions = Omit<LafetchRequestOptions, "method">;

interface ClientPolicyDefaults {
  readonly cache?: boolean | CacheInput;
  readonly dedupe?: boolean | DedupeOptions;
  readonly telemetry?: TelemetryInput | false;
}

interface ClientState {
  readonly configuration: ClientConfiguration;
  readonly policies: ClientPolicyDefaults;
}

function mergeClientOptions(
  base: ClientConfiguration,
  policies: ClientPolicyDefaults,
  options: LafetchClientOptions,
): ClientState {
  const headers = new Headers(base.headers);
  if (options.headers) new Headers(options.headers).forEach((value, name) => headers.set(name, value));
  const runtime = options.runtime ? createRuntime({ ...base.runtime, ...options.runtime }) : base.runtime;

  const configuration: ClientConfiguration = Object.freeze({
    ...(options.baseUrl !== undefined
      ? { baseUrl: options.baseUrl }
      : base.baseUrl !== undefined
        ? { baseUrl: base.baseUrl }
        : {}),
    headers,
    transport: options.transport ?? base.transport,
    features: mergeFeatures(base.features, options.features),
    runtime,
    credentials: options.credentials ?? base.credentials,
    ...(options.timeout !== undefined
      ? { timeout: options.timeout }
      : base.timeout !== undefined ? { timeout: base.timeout } : {}),
    ...(options.retry !== undefined
      ? { retry: options.retry }
      : base.retry !== undefined ? { retry: base.retry } : {}),
    ...(options.acceptStatus !== undefined
      ? { acceptStatus: options.acceptStatus }
      : base.acceptStatus !== undefined ? { acceptStatus: base.acceptStatus } : {}),
    scope: createClientPolicyScope(runtime.now),
  });
  return {
    configuration,
    policies: Object.freeze({
      ...(options.cache !== undefined ? { cache: options.cache } : policies.cache !== undefined ? { cache: policies.cache } : {}),
      ...(options.dedupe !== undefined ? { dedupe: options.dedupe } : policies.dedupe !== undefined ? { dedupe: policies.dedupe } : {}),
      ...(options.telemetry !== undefined ? { telemetry: options.telemetry } : policies.telemetry !== undefined ? { telemetry: policies.telemetry } : {}),
    }),
  };
}

function applyPolicies(
  configuration: RequestConfiguration,
  defaults: ClientPolicyDefaults,
  options: LafetchRequestOptions,
): RequestConfiguration {
  let current = configuration;
  const cachePolicy = options.cache ?? defaults.cache;
  const dedupePolicy = options.dedupe ?? defaults.dedupe;
  const telemetryPolicy = options.telemetry ?? defaults.telemetry;

  if (cachePolicy !== undefined && cachePolicy !== false) {
    current = withFeature(current, createCacheFeature(cachePolicy === true ? undefined : cachePolicy, {
      store: current.scope.getCacheStore(),
      now: current.runtime.now,
    }));
  }
  if (dedupePolicy !== undefined && dedupePolicy !== false) {
    current = withFeature(
      current,
      createDedupeFeature(dedupePolicy === true ? undefined : dedupePolicy, current.scope.getDedupeExecutions()),
    );
  }
  if (options.idempotency !== undefined && options.idempotency !== false) {
    current = withFeature(current, idempotency(options.idempotency === true ? undefined : options.idempotency));
  }
  if (telemetryPolicy !== undefined && telemetryPolicy !== false) {
    current = withFeature(current, telemetry(telemetryPolicy));
  }
  return current;
}

export interface LafetchClient {
  request<TData = unknown>(input: string | URL, options?: LafetchRequestOptions): RequestBuilder<TData>;
  get<TData = unknown>(input: string | URL, options?: MethodRequestOptions): RequestBuilder<TData>;
  post<TData = unknown>(input: string | URL, options?: MethodRequestOptions): RequestBuilder<TData>;
  put<TData = unknown>(input: string | URL, options?: MethodRequestOptions): RequestBuilder<TData>;
  patch<TData = unknown>(input: string | URL, options?: MethodRequestOptions): RequestBuilder<TData>;
  delete<TData = unknown>(input: string | URL, options?: MethodRequestOptions): RequestBuilder<TData>;
  head<TData = unknown>(input: string | URL, options?: MethodRequestOptions): RequestBuilder<TData>;
  extend(options?: LafetchClientOptions): LafetchClient;
}

class LafetchClientImplementation implements LafetchClient {
  constructor(
    private readonly configuration: ClientConfiguration,
    private readonly policyDefaults: ClientPolicyDefaults,
  ) {}

  request<TData = unknown>(input: string | URL, options: LafetchRequestOptions = {}): RequestBuilder<TData> {
    const configuration = createRequestConfiguration(this.configuration, input, options);
    return createRequestBuilder<TData>(applyPolicies(configuration, this.policyDefaults, options));
  }

  get<TData = unknown>(input: string | URL, options: MethodRequestOptions = {}): RequestBuilder<TData> {
    return this.request<TData>(input, { ...options, method: "GET" });
  }

  post<TData = unknown>(input: string | URL, options: MethodRequestOptions = {}): RequestBuilder<TData> {
    return this.request<TData>(input, { ...options, method: "POST" });
  }

  put<TData = unknown>(input: string | URL, options: MethodRequestOptions = {}): RequestBuilder<TData> {
    return this.request<TData>(input, { ...options, method: "PUT" });
  }

  patch<TData = unknown>(input: string | URL, options: MethodRequestOptions = {}): RequestBuilder<TData> {
    return this.request<TData>(input, { ...options, method: "PATCH" });
  }

  delete<TData = unknown>(input: string | URL, options: MethodRequestOptions = {}): RequestBuilder<TData> {
    return this.request<TData>(input, { ...options, method: "DELETE" });
  }

  head<TData = unknown>(input: string | URL, options: MethodRequestOptions = {}): RequestBuilder<TData> {
    return this.request<TData>(input, { ...options, method: "HEAD" });
  }

  extend(options: LafetchClientOptions = {}): LafetchClient {
    const state = mergeClientOptions(this.configuration, this.policyDefaults, options);
    return new LafetchClientImplementation(state.configuration, state.policies);
  }
}

export function createClient(options: LafetchClientOptions = {}): LafetchClient {
  const runtime = createRuntime(options.runtime);
  const configuration: ClientConfiguration = Object.freeze({
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    headers: new Headers(options.headers),
    transport: options.transport ?? fetchTransport(),
    features: Object.freeze([...(options.features ?? [])]),
    runtime,
    credentials: options.credentials ?? "omit",
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    ...(options.retry !== undefined ? { retry: options.retry } : {}),
    ...(options.acceptStatus !== undefined ? { acceptStatus: options.acceptStatus } : {}),
    scope: createClientPolicyScope(runtime.now),
  });
  const policies: ClientPolicyDefaults = Object.freeze({
    ...(options.cache !== undefined ? { cache: options.cache } : {}),
    ...(options.dedupe !== undefined ? { dedupe: options.dedupe } : {}),
    ...(options.telemetry !== undefined ? { telemetry: options.telemetry } : {}),
  });
  return new LafetchClientImplementation(configuration, policies);
}
