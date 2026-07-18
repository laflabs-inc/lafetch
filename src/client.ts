import {
  createClientPolicyScope,
  createRequestConfiguration,
  mergeFeatures,
  type ClientConfiguration,
} from "./core/config.js";
import { createRuntime } from "./core/runtime.js";
import type { ClientOptions, RequestOptions } from "./core/types.js";
import { createRequestBuilder, type RequestBuilder } from "./request-builder.js";
import { fetchTransport } from "./transports/fetch.js";

function mergeClientOptions(
  base: ClientConfiguration,
  options: ClientOptions,
): ClientConfiguration {
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
    scope: createClientPolicyScope(runtime.now),
  });
  return configuration;
}

export interface LafetchClient {
  /** Low-level entry point. Prefer the named HTTP methods for application requests. */
  request<TData = unknown>(input: string | URL, options?: RequestOptions): RequestBuilder<TData>;
  get<TData = unknown>(input: string | URL): RequestBuilder<TData>;
  post<TData = unknown>(input: string | URL): RequestBuilder<TData>;
  put<TData = unknown>(input: string | URL): RequestBuilder<TData>;
  patch<TData = unknown>(input: string | URL): RequestBuilder<TData>;
  delete<TData = unknown>(input: string | URL): RequestBuilder<TData>;
  head<TData = unknown>(input: string | URL): RequestBuilder<TData>;
  extend(options?: ClientOptions): LafetchClient;
}

class LafetchClientImplementation implements LafetchClient {
  constructor(private readonly configuration: ClientConfiguration) {}

  request<TData = unknown>(input: string | URL, options: RequestOptions = {}): RequestBuilder<TData> {
    return createRequestBuilder<TData>(createRequestConfiguration(this.configuration, input, options));
  }

  get<TData = unknown>(input: string | URL): RequestBuilder<TData> {
    return this.request<TData>(input, { method: "GET" });
  }

  post<TData = unknown>(input: string | URL): RequestBuilder<TData> {
    return this.request<TData>(input, { method: "POST" });
  }

  put<TData = unknown>(input: string | URL): RequestBuilder<TData> {
    return this.request<TData>(input, { method: "PUT" });
  }

  patch<TData = unknown>(input: string | URL): RequestBuilder<TData> {
    return this.request<TData>(input, { method: "PATCH" });
  }

  delete<TData = unknown>(input: string | URL): RequestBuilder<TData> {
    return this.request<TData>(input, { method: "DELETE" });
  }

  head<TData = unknown>(input: string | URL): RequestBuilder<TData> {
    return this.request<TData>(input, { method: "HEAD" });
  }

  extend(options: ClientOptions = {}): LafetchClient {
    return new LafetchClientImplementation(mergeClientOptions(this.configuration, options));
  }
}

export function createClient(options: ClientOptions = {}): LafetchClient {
  const runtime = createRuntime(options.runtime);
  const configuration: ClientConfiguration = Object.freeze({
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    headers: new Headers(options.headers),
    transport: options.transport ?? fetchTransport(),
    features: Object.freeze([...(options.features ?? [])]),
    runtime,
    credentials: options.credentials ?? "omit",
    scope: createClientPolicyScope(runtime.now),
  });
  return new LafetchClientImplementation(configuration);
}
