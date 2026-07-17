export type Duration = number | `${number}ms` | `${number}s` | `${number}m`;

export type QueryPrimitive = string | number | boolean | bigint | null | undefined;
export type QueryValue = QueryPrimitive | readonly QueryPrimitive[];
export type QueryParams = Readonly<Record<string, QueryValue>>;

export type StatusMatcher = readonly number[] | ((status: number) => boolean);

export type TimeoutScope = "total" | "attempt";

export interface TimeoutOptions {
  readonly total?: Duration;
  readonly attempt?: Duration;
}

export type TimeoutInput = Duration | TimeoutOptions;

export type BackoffType = "fixed" | "exponential";
export type JitterType = "none" | "full";

export interface BackoffOptions {
  readonly type?: BackoffType;
  readonly base?: Duration;
  readonly max?: Duration;
  readonly jitter?: JitterType;
}

export interface RetryOptions {
  /** Maximum total attempts, including the initial request. */
  readonly attempts: number;
  readonly methods?: readonly string[];
  readonly statuses?: readonly number[];
  readonly networkErrors?: boolean;
  readonly respectRetryAfter?: boolean;
  readonly backoff?: BackoffType | BackoffOptions;
}

export type RetryInput = number | RetryOptions;

export interface RequestMeta {
  readonly requestId: string;
  readonly attempts: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly transport: string;
}

export interface HttpResult<T> {
  readonly data: T;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly request: Request;
  readonly response: Response;
  readonly meta: RequestMeta;
}

export interface TransportContext {
  readonly requestId: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
}

export interface Transport {
  readonly name: string;
  send(request: Request, context: TransportContext): Promise<Response>;
}

export interface RuntimeAdapter {
  now(): number;
  random(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  requestId(): string;
}

export interface RequestOptions {
  readonly method?: string;
  readonly headers?: HeadersInit;
  readonly query?: QueryParams;
  readonly body?: BodyInit | null;
  readonly json?: unknown;
  readonly signal?: AbortSignal;
  /** Set to false to disable a client-level timeout default. */
  readonly timeout?: TimeoutInput | false;
  /** Set to false to disable a client-level retry default. */
  readonly retry?: RetryInput | false;
  readonly acceptStatus?: StatusMatcher;
  readonly credentials?: RequestCredentials;
  readonly features?: readonly RequestFeature[];
}

export interface ClientOptions {
  readonly baseUrl?: string | URL;
  readonly headers?: HeadersInit;
  readonly transport?: Transport;
  readonly features?: readonly RequestFeature[];
  /** Defaults to `omit` so credentials are never sent implicitly. */
  readonly credentials?: RequestCredentials;
  /** Default timeout inherited by requests. */
  readonly timeout?: TimeoutInput;
  /** Default retry policy inherited by requests. */
  readonly retry?: RetryInput;
  /** Default accepted status matcher inherited by requests. */
  readonly acceptStatus?: StatusMatcher;
  /** Intended for deterministic tests and specialized runtimes. */
  readonly runtime?: Partial<RuntimeAdapter>;
}

export interface MutableRequestDraft {
  url: URL;
  method: string;
  headers: Headers;
  body: BodySource;
  credentials: RequestCredentials;
}

export type BodyFactory = () => BodyInit | null | Promise<BodyInit | null>;

export type BodySource =
  | { readonly kind: "none" }
  | { readonly kind: "value"; readonly value: BodyInit | null }
  | { readonly kind: "factory"; readonly create: BodyFactory };

export type CapabilityMode = "exclusive" | "composable" | "observer";

/** Mutable storage isolated to one Feature for the lifetime of one request. */
export type FeatureState = Map<PropertyKey, unknown>;

export interface RequestEventRequestSnapshot {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface RequestEventResponseSnapshot {
  readonly status: number;
  readonly statusText: string;
}

export interface RequestEventErrorSnapshot {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly status?: number;
  readonly scope?: TimeoutScope;
}

interface RequestEventBase {
  readonly requestId: string;
  readonly timestamp: number;
}

export interface RequestStartedEvent extends RequestEventBase {
  readonly type: "request:start";
  readonly request: RequestEventRequestSnapshot;
}

export interface AttemptStartedEvent extends RequestEventBase {
  readonly type: "attempt:start";
  readonly attempt: number;
  readonly request: RequestEventRequestSnapshot;
}

export interface AttemptResponseEvent extends RequestEventBase {
  readonly type: "attempt:response";
  readonly attempt: number;
  readonly request: RequestEventRequestSnapshot;
  readonly response: RequestEventResponseSnapshot;
  readonly source: string;
}

export interface AttemptErrorEvent extends RequestEventBase {
  readonly type: "attempt:error";
  readonly attempt: number;
  readonly request?: RequestEventRequestSnapshot;
  readonly error: RequestEventErrorSnapshot;
  readonly willRetry: boolean;
  readonly retryDelayMs?: number;
}

export interface RequestSucceededEvent extends RequestEventBase {
  readonly type: "request:success";
  readonly attempts: number;
  readonly durationMs: number;
  readonly request: RequestEventRequestSnapshot;
  readonly response: RequestEventResponseSnapshot;
  readonly source: string;
}

export interface RequestFailedEvent extends RequestEventBase {
  readonly type: "request:error";
  readonly attempts: number;
  readonly durationMs: number;
  readonly request?: RequestEventRequestSnapshot;
  readonly error: RequestEventErrorSnapshot;
}

export type RequestEvent =
  | RequestStartedEvent
  | AttemptStartedEvent
  | AttemptResponseEvent
  | AttemptErrorEvent
  | RequestSucceededEvent
  | RequestFailedEvent;

export interface ProvidedCapability {
  readonly name: string;
  readonly mode?: CapabilityMode;
}

export interface FeatureCapabilities {
  readonly provides?: readonly ProvidedCapability[];
  readonly requires?: readonly string[];
  readonly conflicts?: readonly string[];
}

export interface FeatureOrdering {
  readonly before?: readonly string[];
  readonly after?: readonly string[];
  /** Like `before`, but ignored when the target is not installed. */
  readonly optionalBefore?: readonly string[];
  /** Like `after`, but ignored when the target is not installed. */
  readonly optionalAfter?: readonly string[];
}

export interface FeatureBaseContext {
  readonly requestId: string;
  readonly metadata: Map<string, unknown>;
  readonly state: FeatureState;
}

export interface PrepareContext extends FeatureBaseContext {
  readonly draft: MutableRequestDraft;
  readonly signal: AbortSignal;
}

export interface BeforeAttemptContext extends FeatureBaseContext {
  readonly draft: MutableRequestDraft;
  readonly attempt: number;
  readonly signal: AbortSignal;
}

export interface InterceptContext extends FeatureBaseContext {
  readonly request: Request;
  readonly attempt: number;
  readonly signal: AbortSignal;
}

export interface AfterResponseContext extends FeatureBaseContext {
  readonly request: Request;
  readonly response: Response;
  readonly attempt: number;
  readonly source: string;
}

export interface AttemptErrorContext extends FeatureBaseContext {
  readonly request?: Request;
  readonly error: unknown;
  readonly attempt: number;
  readonly willRetry: boolean;
  readonly retryDelayMs?: number;
}

export interface MapErrorContext extends FeatureBaseContext {
  readonly request?: Request;
  readonly error: Error;
  readonly attempts: number;
}

export interface FeatureEventContext extends FeatureBaseContext {
  readonly event: RequestEvent;
}

export interface FinalizeContext extends FeatureBaseContext {
  readonly request?: Request;
  readonly response?: Response;
  readonly error?: unknown;
  readonly attempts: number;
  readonly source?: string;
}

export interface RequestFeatureHooks {
  prepare?(context: PrepareContext): void | Promise<void>;
  beforeAttempt?(context: BeforeAttemptContext): void | Promise<void>;
  /** Return a Response to skip Transport dispatch for this attempt. */
  intercept?(context: InterceptContext): Response | void | Promise<Response | void>;
  /** Return a Response to replace the current response for later Features. */
  afterResponse?(context: AfterResponseContext): Response | void | Promise<Response | void>;
  onAttemptError?(context: AttemptErrorContext): void | Promise<void>;
  /** Runs once for the final failure, in reverse resolved Feature order. */
  mapError?(context: MapErrorContext): Error | void | Promise<Error | void>;
  onEvent?(context: FeatureEventContext): void | Promise<void>;
  finalize?(context: FinalizeContext): void | Promise<void>;
}

export interface RequestFeature {
  readonly name: string;
  readonly capabilities?: FeatureCapabilities;
  readonly ordering?: FeatureOrdering;
  readonly hooks?: RequestFeatureHooks;
}

export interface RawExecution {
  readonly request: Request;
  readonly response: Response;
  readonly meta: RequestMeta;
}
