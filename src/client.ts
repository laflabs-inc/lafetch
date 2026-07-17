import { createRequestConfiguration, type ClientConfiguration } from "./core/config.js";
import { createRuntime } from "./core/runtime.js";
import type { ClientOptions, RequestOptions } from "./core/types.js";
import { createRequestBuilder, type RequestBuilder } from "./request-builder.js";
import { fetchTransport } from "./transports/fetch.js";

type MethodRequestOptions = Omit<RequestOptions, "method">;

function mergeClientOptions(base: ClientConfiguration, options: ClientOptions): ClientConfiguration {
  const headers = new Headers(base.headers);
  if (options.headers) new Headers(options.headers).forEach((value, name) => headers.set(name, value));

  return Object.freeze({
    ...(options.baseUrl !== undefined
      ? { baseUrl: options.baseUrl }
      : base.baseUrl !== undefined
        ? { baseUrl: base.baseUrl }
        : {}),
    headers,
    transport: options.transport ?? base.transport,
    features: Object.freeze([...base.features, ...(options.features ?? [])]),
    runtime: options.runtime ? createRuntime({ ...base.runtime, ...options.runtime }) : base.runtime,
  });
}

export interface LafetchClient {
  request<TData = unknown>(input: string | URL, options?: RequestOptions): RequestBuilder<TData>;
  get<TData = unknown>(input: string | URL, options?: MethodRequestOptions): RequestBuilder<TData>;
  post<TData = unknown>(input: string | URL, options?: MethodRequestOptions): RequestBuilder<TData>;
  put<TData = unknown>(input: string | URL, options?: MethodRequestOptions): RequestBuilder<TData>;
  patch<TData = unknown>(input: string | URL, options?: MethodRequestOptions): RequestBuilder<TData>;
  delete<TData = unknown>(input: string | URL, options?: MethodRequestOptions): RequestBuilder<TData>;
  head<TData = unknown>(input: string | URL, options?: MethodRequestOptions): RequestBuilder<TData>;
  extend(options?: ClientOptions): LafetchClient;
}

class LafetchClientImplementation implements LafetchClient {
  constructor(private readonly configuration: ClientConfiguration) {}

  request<TData = unknown>(input: string | URL, options: RequestOptions = {}): RequestBuilder<TData> {
    return createRequestBuilder<TData>(createRequestConfiguration(this.configuration, input, options));
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

  extend(options: ClientOptions = {}): LafetchClient {
    return new LafetchClientImplementation(mergeClientOptions(this.configuration, options));
  }
}

export function createClient(options: ClientOptions = {}): LafetchClient {
  const configuration: ClientConfiguration = Object.freeze({
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    headers: new Headers(options.headers),
    transport: options.transport ?? fetchTransport(),
    features: Object.freeze([...(options.features ?? [])]),
    runtime: createRuntime(options.runtime),
  });
  return new LafetchClientImplementation(configuration);
}
