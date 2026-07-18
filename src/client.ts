import {
  createClientPolicyScope,
  createRequestConfiguration,
  type ClientConfiguration,
} from "./core/config.js";
import { createRuntime } from "./core/runtime.js";
import type { ClientOptions } from "./core/types.js";
import { validateRequestCredentials } from "./core/validation.js";
import { createRequestBuilder, type RequestBuilder } from "./request-builder.js";
import { fetchTransport } from "./transports/fetch.js";

export interface LafetchClient {
  /** Custom-method entry point. Prefer the named HTTP methods when possible. */
  request<TData = unknown>(method: string, input: string | URL): RequestBuilder<TData>;
  get<TData = unknown>(input: string | URL): RequestBuilder<TData>;
  post<TData = unknown>(input: string | URL): RequestBuilder<TData>;
  put<TData = unknown>(input: string | URL): RequestBuilder<TData>;
  patch<TData = unknown>(input: string | URL): RequestBuilder<TData>;
  delete<TData = unknown>(input: string | URL): RequestBuilder<TData>;
  head<TData = unknown>(input: string | URL): RequestBuilder<TData>;
}

class LafetchClientImplementation implements LafetchClient {
  constructor(private readonly configuration: ClientConfiguration) {}

  request<TData = unknown>(method: string, input: string | URL): RequestBuilder<TData> {
    return createRequestBuilder<TData>(createRequestConfiguration(this.configuration, input, method));
  }

  get<TData = unknown>(input: string | URL): RequestBuilder<TData> {
    return this.request<TData>("GET", input);
  }

  post<TData = unknown>(input: string | URL): RequestBuilder<TData> {
    return this.request<TData>("POST", input);
  }

  put<TData = unknown>(input: string | URL): RequestBuilder<TData> {
    return this.request<TData>("PUT", input);
  }

  patch<TData = unknown>(input: string | URL): RequestBuilder<TData> {
    return this.request<TData>("PATCH", input);
  }

  delete<TData = unknown>(input: string | URL): RequestBuilder<TData> {
    return this.request<TData>("DELETE", input);
  }

  head<TData = unknown>(input: string | URL): RequestBuilder<TData> {
    return this.request<TData>("HEAD", input);
  }
}

export function createClient(options: ClientOptions = {}): LafetchClient {
  const runtime = createRuntime(options.runtime);
  const credentials = options.credentials === undefined
    ? "omit"
    : validateRequestCredentials(options.credentials, "lafetch.create() credentials");
  const configuration: ClientConfiguration = Object.freeze({
    ...(options.baseUrl !== undefined
      ? { baseUrl: options.baseUrl instanceof URL ? new URL(options.baseUrl) : options.baseUrl }
      : {}),
    headers: new Headers(options.headers),
    transport: options.transport ?? fetchTransport(),
    runtime,
    credentials,
    scope: createClientPolicyScope(runtime.now),
  });
  return new LafetchClientImplementation(configuration);
}
