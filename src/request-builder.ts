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
  withMaxResponseBytes,
  withoutHeader,
  withQuery,
  withRetry,
  withSignal,
  withTimeout,
  type RequestConfiguration,
} from "./core/config.js";
import { decodeResponse, type ResponseMode } from "./core/decode.js";
import { executeRequest, executeStreamingRequest } from "./core/executor.js";
import {
  telemetry as createTelemetryFeature,
  type TelemetryHandler,
  type TelemetryOptions,
} from "./features/telemetry.js";
import { createCacheFeature, type CacheOptions } from "./features/cache.js";
import { createDedupeFeature, type DedupeOptions } from "./features/dedupe.js";
import { idempotency as createIdempotencyFeature, type IdempotencyOptions } from "./features/idempotency.js";
import { applySchema, type InferSchema, type ResponseSchema } from "./consumption/schema.js";
import { HttpConfigurationError, HttpConsumptionError } from "./core/errors.js";
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

type RequestBodyMode = "allowed" | "configured" | "forbidden";
type ResponseConsumptionMode = "open" | "buffered";
type ResponseValidationMode = "none" | "schema";
type ConsumedData<TData, TFallback, TValidationMode extends ResponseValidationMode> =
  TValidationMode extends "schema" ? TData : TFallback;
type BufferedResponseMode = "json" | "text" | "bytes" | "blob" | "formData";
type ResponseTerminalMode = BufferedResponseMode | "result" | "response" | "stream";

function requireCallerOwnedKey(
  policy: "cache" | "dedupe",
  method: string,
  key: unknown,
): void {
  if (method === "GET" || method === "HEAD" || key !== undefined) return;
  throw new HttpConfigurationError(
    `${policy}() on ${method} requires a caller-owned key. The built-in key does not inspect request bodies.`,
  );
}

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
  TValidationMode extends ResponseValidationMode,
> {
  query(params: QueryParams): RequestBuilderState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  header(name: string, value: string): RequestBuilderState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  headers(values: HeadersInit): RequestBuilderState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  removeHeader(name: string): RequestBuilderState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  signal(signal: AbortSignal): RequestBuilderState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  timeout(timeout: Duration): RequestBuilderState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  attemptTimeout(timeout: Duration): RequestBuilderState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  maxResponseBytes(bytes: number): RequestBuilderState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  retry(
    retries: number,
    options?: RetryOptions,
  ): RequestBuilderState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  acceptStatus(matcher: StatusMatcher): RequestBuilderState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  credentials(
    credentials: RequestCredentials,
  ): RequestBuilderState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  cache(
    ttl: Duration,
    options?: CacheOptions,
  ): RequestBuilderState<TData, TBodyMode, "buffered", TValidationMode>;
  dedupe(options?: DedupeOptions): RequestBuilderState<TData, TBodyMode, "buffered", TValidationMode>;
  idempotency(
    options?: IdempotencyOptions,
  ): RequestBuilderState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  mapError(
    mapper: RequestErrorMapper,
  ): RequestBuilderState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  telemetry(
    handler: TelemetryHandler,
    options?: TelemetryOptions,
  ): RequestBuilderState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  use(feature: RequestFeature): RequestBuilderState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  /** Consume the response as JSON using the Builder data type and end configuration. */
  as(mode: "json"): Promise<TData>;
  /** Consume the response as text and end Builder configuration. */
  as(mode: "text"): Promise<ConsumedData<TData, string, TValidationMode>>;
  /** Consume the response as bytes and end Builder configuration. */
  as(mode: "bytes"): Promise<ConsumedData<TData, Uint8Array, TValidationMode>>;
  /** Consume the response as a Blob and end Builder configuration. */
  as(mode: "blob"): Promise<ConsumedData<TData, Blob, TValidationMode>>;
  /** Consume the response as FormData and end Builder configuration. */
  as(mode: "formData"): Promise<ConsumedData<TData, FormData, TValidationMode>>;
  /** Consume automatically decoded data with HTTP and execution metadata. */
  as(mode: "result"): Promise<LafetchResponse<TData>>;
  /** Consume a buffered Fetch Response without decoding or schema validation. */
  as(mode: "response"): Promise<Response>;
}

interface StreamingRequestOperation {
  /** Consume a live, single-owner Fetch Response and end configuration. */
  as(mode: "stream"): Promise<Response>;
}

interface ValidationRequestOperation<TBodyMode extends RequestBodyMode> {
  validate<TSchema extends ResponseSchema<unknown>>(
    schema: TSchema,
  ): RequestBuilderState<InferSchema<TSchema>, TBodyMode, "buffered", "schema">;
}

interface RequestBodyOperations<
  TData,
  TConsumptionMode extends ResponseConsumptionMode,
  TValidationMode extends ResponseValidationMode,
> {
  /** Configure a JSON request body. Available only when Fetch permits a body for the method. */
  json(value: unknown): RequestBuilderState<TData, "configured", TConsumptionMode, TValidationMode>;
  /** Configure a raw Fetch request body. */
  body(value: BodyInit | null): RequestBuilderState<TData, "configured", TConsumptionMode, TValidationMode>;
  /** Create a fresh request body for each retry attempt. */
  bodyFactory(create: BodyFactory): RequestBuilderState<TData, "configured", TConsumptionMode, TValidationMode>;
}

/**
 * An immutable, lazy request plan. Method-specific state is inferred from the
 * client entry point and intentionally hidden from this public type.
 */
export type RequestBuilder<TData = unknown> = RequestBuilderState<
  TData,
  RequestBodyMode,
  ResponseConsumptionMode,
  "none"
>;

/** Internal state carrier used by client method return types; not re-exported from the package root. */
export type RequestBuilderState<
  TData = unknown,
  TBodyMode extends RequestBodyMode = RequestBodyMode,
  TConsumptionMode extends ResponseConsumptionMode = ResponseConsumptionMode,
  TValidationMode extends ResponseValidationMode = "none",
> = AwaitableRequest<TData>
  & CommonRequestOperations<TData, TBodyMode, TConsumptionMode, TValidationMode>
  & (TBodyMode extends "allowed"
    ? RequestBodyOperations<TData, TConsumptionMode, TValidationMode>
    : unknown)
  & (TValidationMode extends "none" ? ValidationRequestOperation<TBodyMode> : unknown)
  & ("open" extends TConsumptionMode ? StreamingRequestOperation : unknown);

class RequestBuilderImplementation<TData = unknown> {
  readonly [Symbol.toStringTag] = "LafetchRequest";
  #execution?: Promise<RawExecution>;
  #consumptionMode: "open" | "buffered" | "streaming" = "open";

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

  #claimBuffered(): void {
    if (this.#consumptionMode === "streaming") {
      throw new HttpConsumptionError(
        "RequestBuilder is already owned by as(\"stream\").",
      );
    }
    this.#consumptionMode = "buffered";
  }

  #claimStreaming(): void {
    if (this.#consumptionMode !== "open") {
      throw new HttpConsumptionError(
        "as(\"stream\") requires an unconsumed RequestBuilder.",
      );
    }
    this.#consumptionMode = "streaming";
  }

  async #execute(): Promise<RawExecution> {
    try {
      return await this.#executeOnce();
    } catch (error) {
      return await mapRequestError(this.errorMappers, error, { phase: "request" });
    }
  }

  async #consume<TResult>(responseMode: ResponseMode = "auto"): Promise<{ data: TResult; execution: RawExecution }> {
    this.#claimBuffered();
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

  maxResponseBytes(bytes: number): RequestBuilderImplementation<TData> {
    return this.#next(withMaxResponseBytes(this.configuration, bytes));
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
    requireCallerOwnedKey("cache", this.configuration.method, options.key);
    const feature = createCacheFeature(ttl, options, {
      store: this.configuration.scope.getCacheStore(),
      now: this.configuration.runtime.now,
    });
    return this.#next(withFeature(this.configuration, feature));
  }

  dedupe(options?: DedupeOptions): RequestBuilderImplementation<TData> {
    requireCallerOwnedKey("dedupe", this.configuration.method, options?.key);
    const feature = createDedupeFeature(options, this.configuration.scope.getDedupeExecutions());
    return this.#next(withFeature(this.configuration, feature));
  }

  idempotency(options?: IdempotencyOptions): RequestBuilderImplementation<TData> {
    return this.#next(withFeature(this.configuration, createIdempotencyFeature(options)));
  }

  validate<TSchema extends ResponseSchema<unknown>>(
    schema: TSchema,
  ): RequestBuilderImplementation<InferSchema<TSchema>> {
    if (this.responseSchema !== undefined) {
      throw new HttpConfigurationError("validate() cannot replace an existing response Schema.");
    }
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

  async as(mode: ResponseTerminalMode): Promise<unknown> {
    if (mode === "stream") {
      if (this.responseSchema !== undefined) {
        throw new HttpConfigurationError(
          "as(\"stream\") cannot be combined with validate().",
        );
      }
      this.#claimStreaming();
      try {
        return await executeStreamingRequest(this.configuration, async (error, request, response) =>
          await mapRequestError(this.errorMappers, error, {
            phase: "response",
            request,
            response,
          })
        );
      } catch (error) {
        return await mapRequestError(this.errorMappers, error, { phase: "request" });
      }
    }

    if (mode === "response") {
      this.#claimBuffered();
      return (await this.#execute()).response.clone();
    }

    const responseMode = mode === "result" ? "auto" : mode;
    if (
      responseMode !== "auto"
      && responseMode !== "json"
      && responseMode !== "text"
      && responseMode !== "bytes"
      && responseMode !== "blob"
      && responseMode !== "formData"
    ) {
      throw new HttpConfigurationError(`Unknown response mode: ${String(mode)}.`);
    }

    const { data, execution } = await this.#consume<unknown>(responseMode);
    if (mode !== "result") return data;
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
>(configuration: RequestConfiguration): RequestBuilderState<TData, TBodyMode, "open", "none"> {
  return new RequestBuilderImplementation<TData>(configuration) as RequestBuilderState<TData, TBodyMode, "open", "none">;
}
