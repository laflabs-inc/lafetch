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

type BodylessRequestBuilder<TData> = RequestBuilder<TData, "forbidden">;
type BodyRequestBuilder<TData> = RequestBuilder<TData, "allowed">;
type BodylessRequestMethod =
  | `${"g" | "G"}${"e" | "E"}${"t" | "T"}`
  | `${"h" | "H"}${"e" | "E"}${"a" | "A"}${"d" | "D"}`;

export interface LafetchClient {
  /** Custom-method entry point. Prefer the named HTTP methods when possible. */
  request<TData = unknown>(method: BodylessRequestMethod, input: string | URL): BodylessRequestBuilder<TData>;
  request<TData = unknown>(method: string, input: string | URL): BodyRequestBuilder<TData>;
  get<TData = unknown>(input: string | URL): BodylessRequestBuilder<TData>;
  post<TData = unknown>(input: string | URL): BodyRequestBuilder<TData>;
  put<TData = unknown>(input: string | URL): BodyRequestBuilder<TData>;
  patch<TData = unknown>(input: string | URL): BodyRequestBuilder<TData>;
  delete<TData = unknown>(input: string | URL): BodyRequestBuilder<TData>;
  head<TData = unknown>(input: string | URL): BodylessRequestBuilder<TData>;
}

class LafetchClientImplementation implements LafetchClient {
  constructor(private readonly configuration: ClientConfiguration) {}

  request<TData = unknown>(
    method: BodylessRequestMethod,
    input: string | URL,
  ): BodylessRequestBuilder<TData>;
  request<TData = unknown>(method: string, input: string | URL): BodyRequestBuilder<TData>;
  request<TData = unknown>(method: string, input: string | URL): BodyRequestBuilder<TData> {
    return createRequestBuilder<TData, "allowed">(
      createRequestConfiguration(this.configuration, input, method),
    );
  }

  get<TData = unknown>(input: string | URL): BodylessRequestBuilder<TData> {
    return createRequestBuilder<TData, "forbidden">(
      createRequestConfiguration(this.configuration, input, "GET"),
    );
  }

  post<TData = unknown>(input: string | URL): BodyRequestBuilder<TData> {
    return this.request<TData>("POST", input);
  }

  put<TData = unknown>(input: string | URL): BodyRequestBuilder<TData> {
    return this.request<TData>("PUT", input);
  }

  patch<TData = unknown>(input: string | URL): BodyRequestBuilder<TData> {
    return this.request<TData>("PATCH", input);
  }

  delete<TData = unknown>(input: string | URL): BodyRequestBuilder<TData> {
    return this.request<TData>("DELETE", input);
  }

  head<TData = unknown>(input: string | URL): BodylessRequestBuilder<TData> {
    return createRequestBuilder<TData, "forbidden">(
      createRequestConfiguration(this.configuration, input, "HEAD"),
    );
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
