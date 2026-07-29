export type { LClient } from "./client.js";
export { lafetch } from "./lafetch.js";
export type { Lafetch } from "./lafetch.js";
export type { LRequest, ResponseMode } from "./request-builder.js";
export type {
  LLifecycleEvent,
  LLifecycleHandler,
  LRequestEvent,
  LResponseEvent,
} from "./lifecycle.js";
export type {
  LStream,
  LStreamResponse,
} from "./core/stream-response.js";

export { fetchTransport } from "./transports/fetch.js";

export type {
  CacheOptions,
  CacheMode,
  CacheStoreFailureMode,
} from "./features/cache-options.js";
export type { DedupeOptions } from "./features/dedupe-options.js";
export type { IdempotencyOptions } from "./features/idempotency.js";
export type {
  TelemetryHandler,
  TelemetryOptions,
} from "./features/telemetry.js";
export type {
  RequestErrorContext,
  RequestErrorMapper,
  RequestErrorPhase,
} from "./consumption/error-mapping.js";
export type {
  InferSchema,
  ResponseSchema,
  SchemaResult,
  StandardSchemaV1,
} from "./consumption/schema.js";
export type { CacheEntry, CacheStore } from "./core/cache-store.js";

export {
  HttpAbortError,
  HttpConfigurationError,
  HttpDecodeError,
  HttpConsumptionError,
  HttpError,
  HttpFeatureConflictError,
  HttpFeatureError,
  HttpNonReplayableBodyError,
  HttpResponseTooLargeError,
  HttpSchemaError,
  HttpStatusError,
  HttpTimeoutError,
  HttpTransportError,
  isHttpError,
} from "./core/errors.js";

export type {
  HttpErrorByCode,
  HttpErrorCode,
  HttpErrorForCode,
  HttpErrorOptions,
} from "./core/errors.js";
export type { RequestSnapshot } from "./core/request-snapshot.js";

export type {
  AdvancedRequestInit,
  BackoffOptions,
  BodyFactory,
  ClientOptions,
  Duration,
  LResponse,
  QueryParams,
  QueryPrimitive,
  QueryValue,
  RequestMeta,
  RetryOptions,
  RuntimeAdapter,
  StatusMatcher,
  TimeoutScope,
  Transport,
  TransportContext,
} from "./core/types.js";
