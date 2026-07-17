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
  readonly timeout?: TimeoutInput;
  readonly retry?: RetryInput;
  readonly acceptStatus?: StatusMatcher;
  readonly features?: readonly RequestFeature[];
}

export interface ClientOptions {
  readonly baseUrl?: string | URL;
  readonly headers?: HeadersInit;
  readonly transport?: Transport;
  readonly features?: readonly RequestFeature[];
  /** Intended for deterministic tests and specialized runtimes. */
  readonly runtime?: Partial<RuntimeAdapter>;
}

export interface MutableRequestDraft {
  url: URL;
  method: string;
  headers: Headers;
  body: BodySource;
}

export type BodyFactory = () => BodyInit | null | Promise<BodyInit | null>;

export type BodySource =
  | { readonly kind: "none" }
  | { readonly kind: "value"; readonly value: BodyInit | null }
  | { readonly kind: "factory"; readonly create: BodyFactory };

export type CapabilityMode = "exclusive" | "composable" | "observer";

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
}

export interface FeatureBaseContext {
  readonly requestId: string;
  readonly metadata: Map<string, unknown>;
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

export interface AfterResponseContext extends FeatureBaseContext {
  readonly request: Request;
  readonly response: Response;
  readonly attempt: number;
}

export interface AttemptErrorContext extends FeatureBaseContext {
  readonly request?: Request;
  readonly error: unknown;
  readonly attempt: number;
  readonly willRetry: boolean;
}

export interface FinalizeContext extends FeatureBaseContext {
  readonly response?: Response;
  readonly error?: unknown;
  readonly attempts: number;
}

export interface RequestFeatureHooks {
  prepare?(context: PrepareContext): void | Promise<void>;
  beforeAttempt?(context: BeforeAttemptContext): void | Promise<void>;
  afterResponse?(context: AfterResponseContext): void | Promise<void>;
  onAttemptError?(context: AttemptErrorContext): void | Promise<void>;
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

