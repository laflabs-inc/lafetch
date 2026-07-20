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

type RequestBodyMode = "allowed" | "forbidden";
type ResponseConsumptionMode = "open" | "buffered";

interface AwaitableRequest<TData> extends PromiseLike<TData> {
  readonly [Symbol.toStringTag]: "LafetchRequest";
  then<TResult1 = TData, TResult2 = never>(
    onfulfilled?: ((value: TData) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<TData | TResult>;
  finally(onfinally?: (() => void) | null): Promise<TData>;
}

interface CommonRequestOperations<
  TData,
  TBodyMode extends RequestBodyMode,
  TConsumptionMode extends ResponseConsumptionMode,
> {
  query(params: QueryParams): RequestBuilder<TData, TBodyMode, TConsumptionMode>;
  header(name: string, value: string): RequestBuilder<TData, TBodyMode, TConsumptionMode>;
  headers(values: HeadersInit): RequestBuilder<TData, TBodyMode, TConsumptionMode>;
  removeHeader(name: string): RequestBuilder<TData, TBodyMode, TConsumptionMode>;
  signal(signal: AbortSignal): RequestBuilder<TData, TBodyMode, TConsumptionMode>;
  timeout(timeout: Duration): RequestBuilder<TData, TBodyMode, TConsumptionMode>;
  attemptTimeout(timeout: Duration): RequestBuilder<TData, TBodyMode, TConsumptionMode>;
  retry(
    retries: number,
    options?: RetryOptions,
  ): RequestBuilder<TData, TBodyMode, TConsumptionMode>;
  acceptStatus(matcher: StatusMatcher): RequestBuilder<TData, TBodyMode, TConsumptionMode>;
  credentials(
    credentials: RequestCredentials,
  ): RequestBuilder<TData, TBodyMode, TConsumptionMode>;
  cache(
    ttl: Duration,
    options?: CacheOptions,
  ): RequestBuilder<TData, TBodyMode, "buffered">;
  dedupe(options?: DedupeOptions): RequestBuilder<TData, TBodyMode, "buffered">;
  idempotency(
    options?: IdempotencyOptions,
  ): RequestBuilder<TData, TBodyMode, TConsumptionMode>;
  validate<TSchema extends ResponseSchema<unknown>>(
    schema: TSchema,
  ): RequestBuilder<InferSchema<TSchema>, TBodyMode, "buffered">;
  mapError(
    mapper: RequestErrorMapper,
  ): RequestBuilder<TData, TBodyMode, TConsumptionMode>;
  telemetry(
    handler: TelemetryHandler,
    options?: TelemetryOptions,
  ): RequestBuilder<TData, TBodyMode, TConsumptionMode>;
  use(feature: RequestFeature): RequestBuilder<TData, TBodyMode, TConsumptionMode>;
  /** Consume the response as JSON using the Builder data type and end configuration. */
  asJson(): Promise<TData>;
  /** Consume the response as text and end Builder configuration. */
  asText(): Promise<string>;
  /** Consume the response as an ArrayBuffer and end Builder configuration. */
  asArrayBuffer(): Promise<ArrayBuffer>;
  /** Consume the response as a Blob and end Builder configuration. */
  asBlob(): Promise<Blob>;
  /** Consume the response as FormData and end Builder configuration. */
  asFormData(): Promise<FormData>;
  /** Consume automatically decoded data with HTTP and execution metadata. */
  asResponse(): Promise<LafetchResponse<TData>>;
  /** Consume a buffered Fetch Response without decoding or schema validation. */
  asRaw(): Promise<Response>;
}

interface RequestBodyOperations<
  TData,
  TConsumptionMode extends ResponseConsumptionMode,
> {
  /** Configure a JSON request body. Available only when Fetch permits a body for the method. */
  json(value: unknown): RequestBuilder<TData, "allowed", TConsumptionMode>;
  /** Configure a raw Fetch request body. */
  body(value: BodyInit | null): RequestBuilder<TData, "allowed", TConsumptionMode>;
  /** Create a fresh request body for each retry attempt. */
  bodyFactory(create: BodyFactory): RequestBuilder<TData, "allowed", TConsumptionMode>;
}

/**
 * An immutable, lazy request plan. The extra type parameters are internal
 * state used to keep impossible Fetch and response-consumption combinations
 * out of IDE completion while preserving the single fluent grammar.
 */
export type RequestBuilder<
  TData = unknown,
  TBodyMode extends RequestBodyMode = RequestBodyMode,
  TConsumptionMode extends ResponseConsumptionMode = ResponseConsumptionMode,
> = AwaitableRequest<TData>
  & CommonRequestOperations<TData, TBodyMode, TConsumptionMode>
  & (TBodyMode extends "allowed"
    ? RequestBodyOperations<TData, TConsumptionMode>
    : unknown);

class RequestBuilderImplementation<TData = unknown> {
  readonly [Symbol.toStringTag] = "LafetchRequest";
  #execution?: Promise<RawExecution>;

  constructor(
    private readonly configuration: RequestConfiguration,
    private readonly responseSchema?: ResponseSchema<unknown>,
    private readonly errorMappers: readonly RequestErrorMapper[] = Object.freeze([]),
  ) {}

  #next<TNext = TData>(configuration: RequestConfiguration): RequestBuilderImplementation<TNext> {
    return new RequestBuilderImplementation<TNext>(
      configuration,
      this.responseSchema,
      this.errorMappers,
    );
  }

  #nextConsumption<TNext = TData>(
    responseSchema: ResponseSchema<unknown> | undefined,
    errorMappers: readonly RequestErrorMapper[],
  ): RequestBuilderImplementation<TNext> {
    return new RequestBuilderImplementation<TNext>(
      this.configuration,
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

  async #consume<TResult>(responseMode: ResponseMode = "auto"): Promise<{ data: TResult; execution: RawExecution }> {
    const execution = await this.#execute();
    try {
      const decoded = await decodeResponse(
        execution.response.clone(),
        responseMode,
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

  query(params: QueryParams): RequestBuilderImplementation<TData> {
    return this.#next(withQuery(this.configuration, params));
  }

  header(name: string, value: string): RequestBuilderImplementation<TData> {
    return this.#next(withHeader(this.configuration, name, value));
  }

  headers(values: HeadersInit): RequestBuilderImplementation<TData> {
    return this.#next(withHeaders(this.configuration, values));
  }

  removeHeader(name: string): RequestBuilderImplementation<TData> {
    return this.#next(withoutHeader(this.configuration, name));
  }

  json(value: unknown): RequestBuilderImplementation<TData> {
    return this.#next(withJson(this.configuration, value));
  }

  body(value: BodyInit | null): RequestBuilderImplementation<TData> {
    return this.#next(withBody(this.configuration, value));
  }

  bodyFactory(create: BodyFactory): RequestBuilderImplementation<TData> {
    return this.#next(withBodyFactory(this.configuration, create));
  }

  signal(signal: AbortSignal): RequestBuilderImplementation<TData> {
    return this.#next(withSignal(this.configuration, signal));
  }

  timeout(timeout: Duration): RequestBuilderImplementation<TData> {
    return this.#next(withTimeout(this.configuration, timeout));
  }

  attemptTimeout(timeout: Duration): RequestBuilderImplementation<TData> {
    return this.#next(withAttemptTimeout(this.configuration, timeout));
  }

  retry(retries: number, options: RetryOptions = {}): RequestBuilderImplementation<TData> {
    return this.#next(withRetry(this.configuration, retries, options));
  }

  acceptStatus(matcher: StatusMatcher): RequestBuilderImplementation<TData> {
    return this.#next(withAcceptedStatus(this.configuration, matcher));
  }

  credentials(credentials: RequestCredentials): RequestBuilderImplementation<TData> {
    return this.#next(withCredentials(this.configuration, credentials));
  }

  cache(ttl: Duration, options: CacheOptions = {}): RequestBuilderImplementation<TData> {
    return this.#next(withFeature(this.configuration, createCacheFeature(ttl, options, {
      store: this.configuration.scope.getCacheStore(),
      now: this.configuration.runtime.now,
    })));
  }

  dedupe(options?: DedupeOptions): RequestBuilderImplementation<TData> {
    return this.#next(withFeature(
      this.configuration,
      createDedupeFeature(options, this.configuration.scope.getDedupeExecutions()),
    ));
  }

  idempotency(options?: IdempotencyOptions): RequestBuilderImplementation<TData> {
    return this.#next(withFeature(this.configuration, createIdempotencyFeature(options)));
  }

  validate<TSchema extends ResponseSchema<unknown>>(
    schema: TSchema,
  ): RequestBuilderImplementation<InferSchema<TSchema>> {
    return this.#nextConsumption<InferSchema<TSchema>>(schema, this.errorMappers);
  }

  mapError(mapper: RequestErrorMapper): RequestBuilderImplementation<TData> {
    return this.#nextConsumption(
      this.responseSchema,
      Object.freeze([...this.errorMappers, mapper]),
    );
  }

  telemetry(handler: TelemetryHandler, options: TelemetryOptions = {}): RequestBuilderImplementation<TData> {
    return this.#next(withFeature(this.configuration, createTelemetryFeature(handler, options)));
  }

  use(feature: RequestFeature): RequestBuilderImplementation<TData> {
    return this.#next(withFeature(this.configuration, feature));
  }

  async asJson(): Promise<TData> {
    return (await this.#consume<TData>("json")).data;
  }

  async asText(): Promise<string> {
    return (await this.#consume<string>("text")).data;
  }

  async asArrayBuffer(): Promise<ArrayBuffer> {
    return (await this.#consume<ArrayBuffer>("arrayBuffer")).data;
  }

  async asBlob(): Promise<Blob> {
    return (await this.#consume<Blob>("blob")).data;
  }

  async asFormData(): Promise<FormData> {
    return (await this.#consume<FormData>("formData")).data;
  }

  async asResponse(): Promise<LafetchResponse<TData>> {
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

  async asRaw(): Promise<Response> {
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
export function createRequestBuilder<
  TData = unknown,
  TBodyMode extends RequestBodyMode = "allowed",
>(configuration: RequestConfiguration): RequestBuilder<TData, TBodyMode, "open"> {
  return new RequestBuilderImplementation<TData>(configuration) as RequestBuilder<TData, TBodyMode, "open">;
}
