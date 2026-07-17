export { createClient } from "./client.js";
export type { LafetchClient } from "./client.js";
export { lafetch } from "./lafetch.js";
export type { RequestBuilder } from "./request-builder.js";
export { fetchTransport } from "./transports/fetch.js";
export { telemetry } from "./features/telemetry.js";
export { cache } from "./features/cache.js";
export type { CacheInput, CacheOptions } from "./features/cache.js";
export { dedupe } from "./features/dedupe.js";
export type { DedupeOptions } from "./features/dedupe.js";
export { idempotency } from "./features/idempotency.js";
export type { IdempotencyOptions } from "./features/idempotency.js";
export { errorMapping } from "./features/error-mapping.js";
export type { ErrorMapper } from "./features/error-mapping.js";
export { MemoryCacheStore } from "./core/cache-store.js";
export type { CacheEntry, CacheStore } from "./core/cache-store.js";
export type { ConsumptionErrorContext, ConsumptionErrorMapper } from "./consumption/error-mapping.js";
export type { InferSchema, ResponseSchema, SchemaResult } from "./consumption/schema.js";
export type {
  TelemetryFailureMode,
  TelemetryHandler,
  TelemetryInput,
  TelemetryOptions,
} from "./features/telemetry.js";

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
  snapshotRequest,
} from "./core/errors.js";

export type { HttpErrorOptions, RequestSnapshot } from "./core/errors.js";

export type {
  AfterResponseContext,
  AttemptErrorEvent,
  AttemptErrorContext,
  AttemptResponseEvent,
  AttemptStartedEvent,
  BackoffOptions,
  BeforeAttemptContext,
  BodyFactory,
  BodySource,
  CapabilityMode,
  ClientOptions,
  Duration,
  FeatureCapabilities,
  FeatureEventContext,
  FeatureOrdering,
  FeatureState,
  FinalizeContext,
  HttpResult,
  InterceptContext,
  MapErrorContext,
  MutableRequestDraft,
  PrepareContext,
  ProvidedCapability,
  QueryParams,
  QueryPrimitive,
  QueryValue,
  RequestFeature,
  RequestFeatureHooks,
  RequestEvent,
  RequestEventErrorSnapshot,
  RequestEventRequestSnapshot,
  RequestEventResponseSnapshot,
  RequestFailedEvent,
  RequestMeta,
  RequestOptions,
  RequestStartedEvent,
  RequestSucceededEvent,
  RetryInput,
  RetryOptions,
  RuntimeAdapter,
  StatusMatcher,
  TimeoutInput,
  TimeoutOptions,
  TimeoutScope,
  Transport,
  TransportContext,
} from "./core/types.js";
