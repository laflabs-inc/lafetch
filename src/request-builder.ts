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
  withRequestInit,
  withRetry,
  withSignal,
  withTimeout,
  type RequestConfiguration,
} from "./core/config.js";
import { decodeResponse, type ResponseMode as DecodeResponseMode } from "./core/decode.js";
import { deferredFeature } from "./core/deferred-feature.js";
import { executeRequest, executeStreamingRequest } from "./core/executor.js";
import type { LStreamResponse } from "./core/stream-response.js";
import {
  telemetry as createTelemetryFeature,
  type TelemetryHandler,
  type TelemetryOptions,
} from "./features/telemetry.js";
import {
  cacheFeatureDescriptor,
  snapshotCacheDeclaration,
  type CacheOptions,
} from "./features/cache-options.js";
import {
  dedupeFeatureDescriptor,
  snapshotDedupeDeclaration,
  type DedupeOptions,
} from "./features/dedupe-options.js";
import { idempotency as createIdempotencyFeature, type IdempotencyOptions } from "./features/idempotency.js";
import {
  applySchema,
  snapshotResponseSchema,
  type InferSchema,
  type ResponseSchema,
} from "./consumption/schema.js";
import { HttpConfigurationError, HttpConsumptionError } from "./core/errors.js";
import { snapshotRequest } from "./core/request-snapshot.js";
import {
  mapRequestError,
  validateRequestErrorMapper,
  type RequestErrorMapper,
} from "./consumption/error-mapping.js";
import type {
  BodyFactory,
  AdvancedRequestInit,
  Duration,
  LResponse,
  QueryParams,
  ExecutionResult,
  RequestFeature,
  RetryOptions,
  StatusMatcher,
} from "./core/types.js";

type RequestBodyMode = "allowed" | "configured" | "forbidden";
type ResponseConsumptionMode = "open" | "buffered";
type ResponseValidationMode = "none" | "schema";
type ConsumedData<TData, TFallback, TValidationMode extends ResponseValidationMode> =
  TValidationMode extends "schema" ? TData : TFallback;
export type ResponseMode =
  | "json"
  | "text"
  | "bytes"
  | "blob"
  | "formData"
  | "response"
  | "stream";

type AvailableResponseMode<TConsumptionMode extends ResponseConsumptionMode> =
  | Exclude<ResponseMode, "stream">
  | ("open" extends TConsumptionMode ? "stream" : never);

type ResponseForMode<
  TData,
  TValidationMode extends ResponseValidationMode,
  TMode extends ResponseMode,
> = TMode extends "json" ? TData
  : TMode extends "text" ? ConsumedData<TData, string, TValidationMode>
  : TMode extends "bytes" ? ConsumedData<TData, Uint8Array, TValidationMode>
  : TMode extends "blob" ? ConsumedData<TData, Blob, TValidationMode>
  : TMode extends "formData" ? ConsumedData<TData, FormData, TValidationMode>
  : TMode extends "response" ? Response
  : TMode extends "stream" ? LStreamResponse
  : never;

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

/**
 * Await directly for an LResponse whose data is decoded from Content-Type. Use
 * as("json"), as("text"), or another data mode only when the server's declared
 * format must be overridden.
 */
interface AwaitableRequest<TData> extends PromiseLike<LResponse<TData>> {
  readonly [Symbol.toStringTag]: "LafetchRequest";
  then<TResult1 = LResponse<TData>, TResult2 = never>(
    onfulfilled?: ((value: LResponse<TData>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<LResponse<TData> | TResult>;
  finally(onfinally?: (() => void) | null): Promise<LResponse<TData>>;
}

interface CommonRequestOperations<
  TData,
  TBodyMode extends RequestBodyMode,
  TConsumptionMode extends ResponseConsumptionMode,
  TValidationMode extends ResponseValidationMode,
> {
  query(params: QueryParams): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  header(name: string, value: string): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  headers(values: HeadersInit): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  removeHeader(name: string): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  signal(signal: AbortSignal): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  timeout(timeout: Duration): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  attemptTimeout(timeout: Duration): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  maxResponseBytes(bytes: number): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  retry(
    retries: number,
    options?: RetryOptions,
  ): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  acceptStatus(matcher: StatusMatcher): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  credentials(
    credentials: RequestCredentials,
  ): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  requestInit(
    init: AdvancedRequestInit,
  ): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  cache(
    ttl: Duration,
    options?: CacheOptions,
  ): RequestState<TData, TBodyMode, "buffered", TValidationMode>;
  dedupe(options?: DedupeOptions): RequestState<TData, TBodyMode, "buffered", TValidationMode>;
  idempotency(
    options?: IdempotencyOptions,
  ): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  mapError(
    mapper: RequestErrorMapper,
  ): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  telemetry(
    handler: TelemetryHandler,
    options?: TelemetryOptions,
  ): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  use(feature: RequestFeature): RequestState<TData, TBodyMode, TConsumptionMode, TValidationMode>;
  /**
   * End request configuration. Data modes force a decoder and return its value
   * directly; response and stream expose the corresponding Fetch response mode.
   */
  as<TMode extends AvailableResponseMode<TConsumptionMode>>(
    mode: TMode,
  ): Promise<ResponseForMode<TData, TValidationMode, TMode>>;
}

interface ValidationRequestOperation<TBodyMode extends RequestBodyMode> {
  validate<TSchema extends ResponseSchema<any>>(
    schema: TSchema,
  ): RequestState<InferSchema<TSchema>, TBodyMode, "buffered", "schema">;
}

interface RequestBodyOperations<
  TData,
  TConsumptionMode extends ResponseConsumptionMode,
  TValidationMode extends ResponseValidationMode,
> {
  /** Configure a JSON request body. Available only when Fetch permits a body for the method. */
  json(value: unknown): RequestState<TData, "configured", TConsumptionMode, TValidationMode>;
  /** Configure a raw Fetch request body. */
  body(value: BodyInit | null): RequestState<TData, "configured", TConsumptionMode, TValidationMode>;
  /** Create a fresh request body for each retry attempt. */
  bodyFactory(create: BodyFactory): RequestState<TData, "configured", TConsumptionMode, TValidationMode>;
}

/**
 * An immutable, lazy Lafetch request. Method-specific state is inferred from the
 * client entry point and intentionally hidden from this public type. Direct
 * await returns LResponse with Content-Type auto decoding; data modes passed to
 * as() force a decoder and return the decoded value directly.
 */
export type LRequest<TData = unknown> = RequestState<
  TData,
  RequestBodyMode,
  ResponseConsumptionMode,
  "none"
>;

/** Internal state carrier used by LClient method return types; not re-exported from the package root. */
export type RequestState<
  TData = unknown,
  TBodyMode extends RequestBodyMode = RequestBodyMode,
  TConsumptionMode extends ResponseConsumptionMode = ResponseConsumptionMode,
  TValidationMode extends ResponseValidationMode = "none",
> = AwaitableRequest<TData>
  & CommonRequestOperations<TData, TBodyMode, TConsumptionMode, TValidationMode>
  & (TBodyMode extends "allowed"
    ? RequestBodyOperations<TData, TConsumptionMode, TValidationMode>
    : unknown)
  & (TValidationMode extends "none" ? ValidationRequestOperation<TBodyMode> : unknown);

class RequestImplementation<TData = unknown> {
  readonly [Symbol.toStringTag] = "LafetchRequest";
  #execution?: Promise<ExecutionResult>;
  #consumptionMode: "open" | "buffered" | "streaming" = "open";

  constructor(
    private readonly configuration: RequestConfiguration,
    private readonly responseSchema?: ResponseSchema<unknown>,
    private readonly errorMappers: readonly RequestErrorMapper[] = Object.freeze([]),
  ) {}

  #next<TNext = TData>(configuration: RequestConfiguration): RequestImplementation<TNext> {
    return new RequestImplementation<TNext>(
      configuration,
      this.responseSchema,
      this.errorMappers,
    );
  }

  #nextConsumption<TNext = TData>(
    responseSchema: ResponseSchema<unknown> | undefined,
    errorMappers: readonly RequestErrorMapper[],
  ): RequestImplementation<TNext> {
    return new RequestImplementation<TNext>(
      this.configuration,
      responseSchema,
      errorMappers,
    );
  }

  #executeOnce(): Promise<ExecutionResult> {
    this.#execution ??= executeRequest(this.configuration);
    return this.#execution;
  }

  #claimBuffered(): void {
    if (this.#consumptionMode === "streaming") {
      throw new HttpConsumptionError(
        "This request is already owned by as(\"stream\").",
      );
    }
    this.#consumptionMode = "buffered";
  }

  #claimStreaming(): void {
    if (this.#consumptionMode !== "open") {
      throw new HttpConsumptionError(
        "as(\"stream\") requires an unconsumed request.",
      );
    }
    this.#consumptionMode = "streaming";
  }

  async #execute(): Promise<ExecutionResult> {
    try {
      return await this.#executeOnce();
    } catch (error) {
      return await mapRequestError(this.errorMappers, error, { phase: "request" });
    }
  }

  async #consume<TResult>(responseMode: DecodeResponseMode = "auto"): Promise<{ data: TResult; execution: ExecutionResult }> {
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

  #createResponse<TResult>(data: TResult, execution: ExecutionResult): LResponse<TResult> {
    const response = execution.response;
    return Object.freeze({
      data,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
      url: response.url,
      redirected: response.redirected,
      type: response.type,
      request: snapshotRequest(execution.request),
      meta: execution.meta,
    });
  }

  query(params: QueryParams): RequestImplementation<TData> {
    return this.#next(withQuery(this.configuration, params));
  }

  header(name: string, value: string): RequestImplementation<TData> {
    return this.#next(withHeader(this.configuration, name, value));
  }

  headers(values: HeadersInit): RequestImplementation<TData> {
    return this.#next(withHeaders(this.configuration, values));
  }

  removeHeader(name: string): RequestImplementation<TData> {
    return this.#next(withoutHeader(this.configuration, name));
  }

  json(value: unknown): RequestImplementation<TData> {
    return this.#next(withJson(this.configuration, value));
  }

  body(value: BodyInit | null): RequestImplementation<TData> {
    return this.#next(withBody(this.configuration, value));
  }

  bodyFactory(create: BodyFactory): RequestImplementation<TData> {
    return this.#next(withBodyFactory(this.configuration, create));
  }

  signal(signal: AbortSignal): RequestImplementation<TData> {
    return this.#next(withSignal(this.configuration, signal));
  }

  timeout(timeout: Duration): RequestImplementation<TData> {
    return this.#next(withTimeout(this.configuration, timeout));
  }

  attemptTimeout(timeout: Duration): RequestImplementation<TData> {
    return this.#next(withAttemptTimeout(this.configuration, timeout));
  }

  maxResponseBytes(bytes: number): RequestImplementation<TData> {
    return this.#next(withMaxResponseBytes(this.configuration, bytes));
  }

  retry(retries: number, options: RetryOptions = {}): RequestImplementation<TData> {
    return this.#next(withRetry(this.configuration, retries, options));
  }

  acceptStatus(matcher: StatusMatcher): RequestImplementation<TData> {
    return this.#next(withAcceptedStatus(this.configuration, matcher));
  }

  credentials(credentials: RequestCredentials): RequestImplementation<TData> {
    return this.#next(withCredentials(this.configuration, credentials));
  }

  requestInit(init: AdvancedRequestInit): RequestImplementation<TData> {
    return this.#next(withRequestInit(this.configuration, init));
  }

  cache(ttl: Duration, options: CacheOptions = {}): RequestImplementation<TData> {
    const declaration = snapshotCacheDeclaration(ttl, options);
    requireCallerOwnedKey("cache", this.configuration.method, declaration.key);
    const feature = deferredFeature(cacheFeatureDescriptor, async () => {
      const { createCacheFeature } = await import("./features/cache.js");
      return createCacheFeature(declaration, {
        scope: this.configuration.scope,
        now: this.configuration.runtime.now,
      });
    });
    return this.#next(withFeature(this.configuration, feature));
  }

  dedupe(options?: DedupeOptions): RequestImplementation<TData> {
    const declaration = snapshotDedupeDeclaration(options);
    requireCallerOwnedKey("dedupe", this.configuration.method, declaration.key);
    const feature = deferredFeature(dedupeFeatureDescriptor, async () => {
      const { createDedupeFeature } = await import("./features/dedupe.js");
      return createDedupeFeature(declaration, this.configuration.scope);
    });
    return this.#next(withFeature(this.configuration, feature));
  }

  idempotency(options?: IdempotencyOptions): RequestImplementation<TData> {
    return this.#next(withFeature(this.configuration, createIdempotencyFeature(options)));
  }

  validate<TSchema extends ResponseSchema<any>>(
    schema: TSchema,
  ): RequestImplementation<InferSchema<TSchema>> {
    if (this.responseSchema !== undefined) {
      throw new HttpConfigurationError("validate() cannot replace an existing response Schema.");
    }
    return this.#nextConsumption<InferSchema<TSchema>>(
      snapshotResponseSchema(schema),
      this.errorMappers,
    );
  }

  mapError(mapper: RequestErrorMapper): RequestImplementation<TData> {
    validateRequestErrorMapper(mapper);
    return this.#nextConsumption(
      this.responseSchema,
      Object.freeze([...this.errorMappers, mapper]),
    );
  }

  telemetry(handler: TelemetryHandler, options: TelemetryOptions = {}): RequestImplementation<TData> {
    return this.#next(withFeature(this.configuration, createTelemetryFeature(handler, options)));
  }

  use(feature: RequestFeature): RequestImplementation<TData> {
    return this.#next(withFeature(this.configuration, feature));
  }

  async as(mode: ResponseMode): Promise<unknown> {
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

    const responseMode = mode;
    if (
      responseMode !== "json"
      && responseMode !== "text"
      && responseMode !== "bytes"
      && responseMode !== "blob"
      && responseMode !== "formData"
    ) {
      throw new HttpConfigurationError(`Unknown response mode: ${String(mode)}.`);
    }

    const { data } = await this.#consume<unknown>(responseMode);
    return data;
  }

  then<TResult1 = LResponse<TData>, TResult2 = never>(
    onfulfilled?: ((value: LResponse<TData>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.#consume<TData>()
      .then(({ data, execution }) => this.#createResponse(data, execution))
      .then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<LResponse<TData> | TResult> {
    return this.#consume<TData>()
      .then(({ data, execution }) => this.#createResponse(data, execution))
      .catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<LResponse<TData>> {
    return this.#consume<TData>()
      .then(({ data, execution }) => this.#createResponse(data, execution))
      .finally(onfinally ?? undefined);
  }
}

/** @internal */
export function createRequest<
  TData = unknown,
  TBodyMode extends RequestBodyMode = "allowed",
>(configuration: RequestConfiguration): RequestState<TData, TBodyMode, "open", "none"> {
  return new RequestImplementation<TData>(configuration) as RequestState<TData, TBodyMode, "open", "none">;
}
