export type { LafetchClient } from "./client.js";
export { lafetch } from "./lafetch.js";
export type { Lafetch } from "./lafetch.js";
export type { RequestBuilder, ResponseType } from "./request-builder.js";

export { fetchTransport } from "./transports/fetch.js";
export { MemoryCacheStore } from "./core/cache-store.js";

export type { CacheOptions } from "./features/cache.js";
export type { DedupeOptions } from "./features/dedupe.js";
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
export type { InferSchema, ResponseSchema, SchemaResult } from "./consumption/schema.js";
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
  HttpSchemaError,
  HttpStatusError,
  HttpTimeoutError,
  HttpTransportError,
} from "./core/errors.js";

export type { HttpErrorOptions, RequestSnapshot } from "./core/errors.js";

export type {
  BackoffOptions,
  BodyFactory,
  ClientOptions,
  Duration,
  LafetchResponse,
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
