import {
  withAcceptedStatus,
  withAttemptTimeout,
  withBody,
  withBodyFactory,
  withCredentials,
  withFeature,
  withHeader,
  withHeaders,
  withJson,
  withoutHeader,
  withQuery,
  withRetry,
  withSignal,
  withTimeout,
  type RequestConfiguration,
} from "./core/config.js";
import { decodeResponse, type ResponseMode } from "./core/decode.js";
import { executeRequest } from "./core/executor.js";
import { validateResponseMode } from "./core/validation.js";
import {
  telemetry as createTelemetryFeature,
  type TelemetryHandler,
  type TelemetryOptions,
} from "./features/telemetry.js";
import { createCacheFeature, type CacheOptions } from "./features/cache.js";
import { createDedupeFeature, type DedupeOptions } from "./features/dedupe.js";
import { idempotency as createIdempotencyFeature, type IdempotencyOptions } from "./features/idempotency.js";
import { applySchema, type InferSchema, type ResponseSchema } from "./consumption/schema.js";
import { mapRequestError, type RequestErrorMapper } from "./consumption/error-mapping.js";
import type {
  BodyFactory,
  Duration,
  LafetchResponse,
  QueryParams,
  RawExecution,
  RequestFeature,
  RetryOptions,
  StatusMatcher,
} from "./core/types.js";

export type ResponseType = ResponseMode;

type ResponseData<TData, TMode extends ResponseType> =
  TMode extends "text" ? string :
  TMode extends "arrayBuffer" ? ArrayBuffer :
  TMode extends "blob" ? Blob :
  TMode extends "formData" ? FormData :
  TData;

export interface RequestBuilder<TData = unknown> extends PromiseLike<TData> {
  readonly [Symbol.toStringTag]: "LafetchRequest";
  query(params: QueryParams): RequestBuilder<TData>;
  header(name: string, value: string): RequestBuilder<TData>;
  headers(values: HeadersInit): RequestBuilder<TData>;
  removeHeader(name: string): RequestBuilder<TData>;
  json(value: unknown): RequestBuilder<TData>;
  body(value: BodyInit | null): RequestBuilder<TData>;
  bodyFactory(create: BodyFactory): RequestBuilder<TData>;
  signal(signal: AbortSignal): RequestBuilder<TData>;
  timeout(timeout: Duration): RequestBuilder<TData>;
  attemptTimeout(timeout: Duration): RequestBuilder<TData>;
  retry(retries: number, options?: RetryOptions): RequestBuilder<TData>;
  acceptStatus(matcher: StatusMatcher): RequestBuilder<TData>;
  credentials(credentials: RequestCredentials): RequestBuilder<TData>;
  cache(ttl: Duration, options?: CacheOptions): RequestBuilder<TData>;
  dedupe(options?: DedupeOptions): RequestBuilder<TData>;
  idempotency(options?: IdempotencyOptions): RequestBuilder<TData>;
  validate<TSchema extends ResponseSchema<unknown>>(schema: TSchema): RequestBuilder<InferSchema<TSchema>>;
  mapError(mapper: RequestErrorMapper): RequestBuilder<TData>;
  telemetry(handler: TelemetryHandler, options?: TelemetryOptions): RequestBuilder<TData>;
  use(feature: RequestFeature): RequestBuilder<TData>;
  as<TMode extends ResponseType>(mode: TMode): RequestBuilder<ResponseData<TData, TMode>>;
  response(): Promise<LafetchResponse<TData>>;
  raw(): Promise<Response>;
  then<TResult1 = TData, TResult2 = never>(
    onfulfilled?: ((value: TData) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<TData | TResult>;
  finally(onfinally?: (() => void) | null): Promise<TData>;
}

class RequestBuilderImplementation<TData = unknown> implements RequestBuilder<TData> {
  readonly [Symbol.toStringTag] = "LafetchRequest";
  #execution?: Promise<RawExecution>;

  constructor(
    private readonly configuration: RequestConfiguration,
    private readonly responseMode: ResponseMode = "auto",
    private readonly responseSchema?: ResponseSchema<unknown>,
    private readonly errorMappers: readonly RequestErrorMapper[] = Object.freeze([]),
  ) {}

  #next<TNext = TData>(configuration: RequestConfiguration): RequestBuilder<TNext> {
    return new RequestBuilderImplementation<TNext>(
      configuration,
      this.responseMode,
      this.responseSchema,
      this.errorMappers,
    );
  }

  #nextConsumption<TNext = TData>(
    responseMode: ResponseMode,
    responseSchema: ResponseSchema<unknown> | undefined,
    errorMappers: readonly RequestErrorMapper[],
  ): RequestBuilder<TNext> {
    return new RequestBuilderImplementation<TNext>(
      this.configuration,
      responseMode,
      responseSchema,
      errorMappers,
    );
  }

  #executeOnce(): Promise<RawExecution> {
    this.#execution ??= executeRequest(this.configuration);
    return this.#execution;
  }

  async #execute(): Promise<RawExecution> {
    try {
      return await this.#executeOnce();
    } catch (error) {
      return await mapRequestError(this.errorMappers, error, { phase: "request" });
    }
  }

  async #consume<TResult>(): Promise<{ data: TResult; execution: RawExecution }> {
    const execution = await this.#execute();
    try {
      const decoded = await decodeResponse(
        execution.response.clone(),
        this.responseMode,
        execution.request.method,
      );
      const data = (this.responseSchema
        ? await applySchema(this.responseSchema, decoded)
        : decoded) as TResult;
      return { data, execution };
    } catch (error) {
      return await mapRequestError(this.errorMappers, error, {
        phase: "response",
        request: execution.request,
        response: execution.response.clone(),
      });
    }
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

  json(value: unknown): RequestBuilder<TData> {
    return this.#next(withJson(this.configuration, value));
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

  timeout(timeout: Duration): RequestBuilder<TData> {
    return this.#next(withTimeout(this.configuration, timeout));
  }

  attemptTimeout(timeout: Duration): RequestBuilder<TData> {
    return this.#next(withAttemptTimeout(this.configuration, timeout));
  }

  retry(retries: number, options: RetryOptions = {}): RequestBuilder<TData> {
    return this.#next(withRetry(this.configuration, retries, options));
  }

  acceptStatus(matcher: StatusMatcher): RequestBuilder<TData> {
    return this.#next(withAcceptedStatus(this.configuration, matcher));
  }

  credentials(credentials: RequestCredentials): RequestBuilder<TData> {
    return this.#next(withCredentials(this.configuration, credentials));
  }

  cache(ttl: Duration, options: CacheOptions = {}): RequestBuilder<TData> {
    return this.#next(withFeature(this.configuration, createCacheFeature(ttl, options, {
      store: this.configuration.scope.getCacheStore(),
      now: this.configuration.runtime.now,
    })));
  }

  dedupe(options?: DedupeOptions): RequestBuilder<TData> {
    return this.#next(withFeature(
      this.configuration,
      createDedupeFeature(options, this.configuration.scope.getDedupeExecutions()),
    ));
  }

  idempotency(options?: IdempotencyOptions): RequestBuilder<TData> {
    return this.#next(withFeature(this.configuration, createIdempotencyFeature(options)));
  }

  validate<TSchema extends ResponseSchema<unknown>>(schema: TSchema): RequestBuilder<InferSchema<TSchema>> {
    return this.#nextConsumption<InferSchema<TSchema>>(this.responseMode, schema, this.errorMappers);
  }

  mapError(mapper: RequestErrorMapper): RequestBuilder<TData> {
    return this.#nextConsumption(
      this.responseMode,
      this.responseSchema,
      Object.freeze([...this.errorMappers, mapper]),
    );
  }

  telemetry(handler: TelemetryHandler, options: TelemetryOptions = {}): RequestBuilder<TData> {
    return this.#next(withFeature(this.configuration, createTelemetryFeature(handler, options)));
  }

  use(feature: RequestFeature): RequestBuilder<TData> {
    return this.#next(withFeature(this.configuration, feature));
  }

  as<TMode extends ResponseType>(mode: TMode): RequestBuilder<ResponseData<TData, TMode>> {
    const responseMode = validateResponseMode(mode);
    return this.#nextConsumption<ResponseData<TData, TMode>>(
      responseMode,
      this.responseSchema,
      this.errorMappers,
    );
  }

  async response(): Promise<LafetchResponse<TData>> {
    const { data, execution } = await this.#consume<TData>();
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

  async raw(): Promise<Response> {
    const execution = await this.#execute();
    return execution.response.clone();
  }

  then<TResult1 = TData, TResult2 = never>(
    onfulfilled?: ((value: TData) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.#consume<TData>().then(({ data }) => data).then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<TData | TResult> {
    return this.#consume<TData>().then(({ data }) => data).catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<TData> {
    return this.#consume<TData>().then(({ data }) => data).finally(onfinally ?? undefined);
  }
}

/** @internal */
export function createRequestBuilder<TData = unknown>(configuration: RequestConfiguration): RequestBuilder<TData> {
  return new RequestBuilderImplementation<TData>(configuration);
}
