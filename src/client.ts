import {
  createClientPolicyScope,
  createRequestConfiguration,
  type ClientConfiguration,
} from "./core/config.js";
import { HttpConfigurationError } from "./core/errors.js";
import { createRuntime } from "./core/runtime.js";
import type { ClientOptions } from "./core/types.js";
import { validateRequestCredentials } from "./core/validation.js";
import { createRequest, type RequestState } from "./request-builder.js";
import { fetchTransport } from "./transports/fetch.js";

type BodylessRequest<TData> = RequestState<TData, "forbidden">;
type BodyRequest<TData> = RequestState<TData, "allowed">;
type BodylessRequestMethod =
  | `${"g" | "G"}${"e" | "E"}${"t" | "T"}`
  | `${"h" | "H"}${"e" | "E"}${"a" | "A"}${"d" | "D"}`;

export interface LClient {
  /** Custom-method entry point. Prefer the named HTTP methods when possible. */
  request<TData = unknown>(method: BodylessRequestMethod, input: string | URL): BodylessRequest<TData>;
  request<TData = unknown>(method: string, input: string | URL): BodyRequest<TData>;
  get<TData = unknown>(input: string | URL): BodylessRequest<TData>;
  post<TData = unknown>(input: string | URL): BodyRequest<TData>;
  put<TData = unknown>(input: string | URL): BodyRequest<TData>;
  patch<TData = unknown>(input: string | URL): BodyRequest<TData>;
  delete<TData = unknown>(input: string | URL): BodyRequest<TData>;
  head<TData = unknown>(input: string | URL): BodylessRequest<TData>;
}

class ClientImplementation implements LClient {
  constructor(private readonly configuration: ClientConfiguration) {}

  request<TData = unknown>(
    method: BodylessRequestMethod,
    input: string | URL,
  ): BodylessRequest<TData>;
  request<TData = unknown>(method: string, input: string | URL): BodyRequest<TData>;
  request<TData = unknown>(method: string, input: string | URL): BodyRequest<TData> {
    return createRequest<TData, "allowed">(
      createRequestConfiguration(this.configuration, input, method),
    );
  }

  get<TData = unknown>(input: string | URL): BodylessRequest<TData> {
    return createRequest<TData, "forbidden">(
      createRequestConfiguration(this.configuration, input, "GET"),
    );
  }

  post<TData = unknown>(input: string | URL): BodyRequest<TData> {
    return this.request<TData>("POST", input);
  }

  put<TData = unknown>(input: string | URL): BodyRequest<TData> {
    return this.request<TData>("PUT", input);
  }

  patch<TData = unknown>(input: string | URL): BodyRequest<TData> {
    return this.request<TData>("PATCH", input);
  }

  delete<TData = unknown>(input: string | URL): BodyRequest<TData> {
    return this.request<TData>("DELETE", input);
  }

  head<TData = unknown>(input: string | URL): BodylessRequest<TData> {
    return createRequest<TData, "forbidden">(
      createRequestConfiguration(this.configuration, input, "HEAD"),
    );
  }
}

export function createClient(options: ClientOptions = {}): LClient {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new HttpConfigurationError("lafetch.create() options must be an object.");
  }
  const runtime = createRuntime(options.runtime);
  const credentials = options.credentials === undefined
    ? "omit"
    : validateRequestCredentials(options.credentials, "lafetch.create() credentials");
  let baseUrl: URL | undefined;
  if (options.baseUrl !== undefined) {
    try {
      baseUrl = new URL(options.baseUrl);
    } catch (cause) {
      throw new HttpConfigurationError(
        "lafetch.create() baseUrl must be an absolute URL.",
        { cause },
      );
    }
  }
  let headers: Headers;
  try {
    headers = new Headers(options.headers);
  } catch (cause) {
    throw new HttpConfigurationError("lafetch.create() headers are invalid.", { cause });
  }
  const transport = options.transport === undefined ? fetchTransport() : options.transport;
  if (
    typeof transport !== "object"
    || transport === null
    || typeof transport.name !== "string"
    || transport.name.trim() === ""
    || typeof transport.send !== "function"
  ) {
    throw new HttpConfigurationError(
      "lafetch.create() transport must have a non-empty name and send() function.",
    );
  }
  const configuration: ClientConfiguration = Object.freeze({
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    headers,
    transport,
    runtime,
    credentials,
    scope: createClientPolicyScope(),
  });
  return new ClientImplementation(configuration);
}
