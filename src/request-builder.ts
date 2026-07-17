import {
  withAcceptedStatus,
  withBody,
  withBodyFactory,
  withFeature,
  withHeader,
  withHeaders,
  withJsonBody,
  withoutHeader,
  withQuery,
  withRetry,
  withSignal,
  withTimeout,
  type RequestConfiguration,
} from "./core/config.js";
import { decodeResponse, type ResponseMode } from "./core/decode.js";
import { executeRequest } from "./core/executor.js";
import { telemetry as createTelemetryFeature, type TelemetryInput } from "./features/telemetry.js";
import type {
  BodyFactory,
  HttpResult,
  QueryParams,
  RawExecution,
  RequestFeature,
  RetryInput,
  StatusMatcher,
  TimeoutInput,
} from "./core/types.js";

export interface RequestBuilder<TData = unknown> extends PromiseLike<HttpResult<TData>> {
  readonly [Symbol.toStringTag]: "LafetchRequest";
  query(params: QueryParams): RequestBuilder<TData>;
  header(name: string, value: string): RequestBuilder<TData>;
  headers(values: HeadersInit): RequestBuilder<TData>;
  removeHeader(name: string): RequestBuilder<TData>;
  jsonBody(value: unknown): RequestBuilder<TData>;
  body(value: BodyInit | null): RequestBuilder<TData>;
  bodyFactory(create: BodyFactory): RequestBuilder<TData>;
  signal(signal: AbortSignal): RequestBuilder<TData>;
  timeout(timeout: TimeoutInput): RequestBuilder<TData>;
  retry(retry: RetryInput): RequestBuilder<TData>;
  acceptStatus(matcher: StatusMatcher): RequestBuilder<TData>;
  telemetry(input: TelemetryInput): RequestBuilder<TData>;
  use(feature: RequestFeature): RequestBuilder<TData>;
  send<TResult = TData>(): Promise<HttpResult<TResult>>;
  json<TResult = TData>(): Promise<TResult>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
  formData(): Promise<FormData>;
  raw(): Promise<Response>;
  then<TResult1 = HttpResult<TData>, TResult2 = never>(
    onfulfilled?: ((value: HttpResult<TData>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<HttpResult<TData> | TResult>;
  finally(onfinally?: (() => void) | null): Promise<HttpResult<TData>>;
}

class RequestBuilderImplementation<TData = unknown> implements RequestBuilder<TData> {
  readonly [Symbol.toStringTag] = "LafetchRequest";
  #execution?: Promise<RawExecution>;

  constructor(private readonly configuration: RequestConfiguration) {}

  #next<TNext = TData>(configuration: RequestConfiguration): RequestBuilder<TNext> {
    return new RequestBuilderImplementation<TNext>(configuration);
  }

  #executeOnce(): Promise<RawExecution> {
    this.#execution ??= executeRequest(this.configuration);
    return this.#execution;
  }

  async #decode<TResult>(mode: ResponseMode): Promise<TResult> {
    const execution = await this.#executeOnce();
    return (await decodeResponse(execution.response.clone(), mode, execution.request.method)) as TResult;
  }

  query(params: QueryParams): RequestBuilder<TData> {
    return this.#next(withQuery(this.configuration, params));
  }

  header(name: string, value: string): RequestBuilder<TData> {
    return this.#next(withHeader(this.configuration, name, value));
  }

  headers(values: HeadersInit): RequestBuilder<TData> {
    return this.#next(withHeaders(this.configuration, values));
  }

  removeHeader(name: string): RequestBuilder<TData> {
    return this.#next(withoutHeader(this.configuration, name));
  }

  jsonBody(value: unknown): RequestBuilder<TData> {
    return this.#next(withJsonBody(this.configuration, value));
  }

  body(value: BodyInit | null): RequestBuilder<TData> {
    return this.#next(withBody(this.configuration, value));
  }

  bodyFactory(create: BodyFactory): RequestBuilder<TData> {
    return this.#next(withBodyFactory(this.configuration, create));
  }

  signal(signal: AbortSignal): RequestBuilder<TData> {
    return this.#next(withSignal(this.configuration, signal));
  }

  timeout(timeout: TimeoutInput): RequestBuilder<TData> {
    return this.#next(withTimeout(this.configuration, timeout));
  }

  retry(retry: RetryInput): RequestBuilder<TData> {
    return this.#next(withRetry(this.configuration, retry));
  }

  acceptStatus(matcher: StatusMatcher): RequestBuilder<TData> {
    return this.#next(withAcceptedStatus(this.configuration, matcher));
  }

  telemetry(input: TelemetryInput): RequestBuilder<TData> {
    return this.#next(withFeature(this.configuration, createTelemetryFeature(input)));
  }

  use(feature: RequestFeature): RequestBuilder<TData> {
    return this.#next(withFeature(this.configuration, feature));
  }

  async send<TResult = TData>(): Promise<HttpResult<TResult>> {
    const execution = await this.#executeOnce();
    const data = (await decodeResponse(
      execution.response.clone(),
      "auto",
      execution.request.method,
    )) as TResult;

    return Object.freeze({
      data,
      status: execution.response.status,
      statusText: execution.response.statusText,
      headers: new Headers(execution.response.headers),
      request: execution.request,
      response: execution.response.clone(),
      meta: execution.meta,
    });
  }

  json<TResult = TData>(): Promise<TResult> {
    return this.#decode<TResult>("json");
  }

  text(): Promise<string> {
    return this.#decode<string>("text");
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.#decode<ArrayBuffer>("arrayBuffer");
  }

  blob(): Promise<Blob> {
    return this.#decode<Blob>("blob");
  }

  formData(): Promise<FormData> {
    return this.#decode<FormData>("formData");
  }

  async raw(): Promise<Response> {
    const execution = await this.#executeOnce();
    return execution.response.clone();
  }

  then<TResult1 = HttpResult<TData>, TResult2 = never>(
    onfulfilled?: ((value: HttpResult<TData>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.send<TData>().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<HttpResult<TData> | TResult> {
    return this.send<TData>().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<HttpResult<TData>> {
    return this.send<TData>().finally(onfinally ?? undefined);
  }
}

/** @internal */
export function createRequestBuilder<TData = unknown>(configuration: RequestConfiguration): RequestBuilder<TData> {
  return new RequestBuilderImplementation<TData>(configuration);
}
