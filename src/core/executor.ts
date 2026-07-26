import { durationToMs } from "./duration.js";
import {
  HttpAbortError,
  HttpConfigurationError,
  HttpConsumptionError,
  HttpError,
  HttpFeatureConflictError,
  HttpNonReplayableBodyError,
  HttpResponseTooLargeError,
  HttpStatusError,
  HttpTimeoutError,
  HttpTransportError,
} from "./errors.js";
import { snapshotRequest } from "./request-snapshot.js";
import { FeatureRuntime, type AttemptErrorInput } from "./feature-runtime.js";
import { resolveFeatures } from "./features.js";
import { applyQuery, resolveUrl } from "./query.js";
import { cancellationError, composeSignals, createDeadlineSignal } from "./signals.js";
import {
  withStreamConvenience,
  type LStreamResponse,
} from "./stream-response.js";
import type { RequestConfiguration } from "./config.js";
import type {
  BodySource,
  MutableRequestDraft,
  ExecutionResult,
  RequestEventErrorSnapshot,
  RequestEventResponseSnapshot,
  RequestMeta,
  RequestFeature,
  RetryOptions,
} from "./types.js";

interface NormalizedRetry {
  readonly attempts: number;
  readonly methods: ReadonlySet<string>;
  readonly statuses: ReadonlySet<number>;
  readonly networkErrors: boolean;
  readonly respectRetryAfter: boolean;
  readonly backoffType: "fixed" | "exponential";
  readonly baseMs: number;
  readonly maxMs: number;
  readonly jitter: "none" | "full";
}

const DEFAULT_RETRY_METHODS = ["GET", "HEAD", "OPTIONS"];
const DEFAULT_RETRY_STATUSES = [408, 429, 500, 502, 503, 504];
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const INVALID_BODY_CHUNK = "The HTTP response body produced a non-byte chunk.";
const MISSING_EXECUTION = "The HTTP request completed without an execution result.";

type StreamingBodyErrorMapper = (
  error: Error,
  request: Request,
  response: Response,
) => Promise<never>;

function normalizeRetry(
  input: RequestConfiguration["retry"],
  method: string,
  features: readonly { capabilities?: { provides?: readonly { name: string }[] } }[],
): NormalizedRetry {
  const retries = input?.retries ?? 0;
  const options: RetryOptions = input?.options ?? {};
  const backoff = options.backoff ?? {};
  const hasIdempotency = features.some((feature) =>
    feature.capabilities?.provides?.some((capability) => capability.name === "idempotency"),
  );
  const retryMethods = options.methods ?? (hasIdempotency ? [...DEFAULT_RETRY_METHODS, method] : DEFAULT_RETRY_METHODS);
  return {
    attempts: retries + 1,
    methods: new Set(retryMethods.map((retryMethod) => retryMethod.toUpperCase())),
    statuses: new Set(options.statuses ?? DEFAULT_RETRY_STATUSES),
    networkErrors: options.networkErrors ?? true,
    respectRetryAfter: options.respectRetryAfter ?? true,
    backoffType: backoff.type ?? "exponential",
    baseMs: backoff.base === undefined ? 200 : durationToMs(backoff.base, "retry.backoff.base"),
    maxMs: backoff.max === undefined ? 10_000 : durationToMs(backoff.max, "retry.backoff.max"),
    jitter: backoff.jitter ?? "full",
  };
}

function isReadableStream(value: unknown): value is ReadableStream {
  return typeof ReadableStream !== "undefined" && value instanceof ReadableStream;
}

function isAcceptedStatus(status: number, matcher: RequestConfiguration["acceptStatus"]): boolean {
  if (!matcher) return status >= 200 && status <= 299;
  if (typeof matcher === "function") {
    try {
      const accepted = matcher(status);
      if (typeof accepted !== "boolean") {
        throw new HttpConfigurationError("acceptStatus() predicate must return a boolean.");
      }
      return accepted;
    } catch (cause) {
      throw new HttpConfigurationError("acceptStatus() failed while evaluating the response status.", { cause });
    }
  }
  return matcher.includes(status);
}

function retryAfterMs(response: Response, now: number): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

function retryDelay(
  retry: NormalizedRetry,
  failedAttempt: number,
  random: number,
  response?: Response,
  now = Date.now(),
): number {
  if (response && retry.respectRetryAfter) {
    const headerDelay = retryAfterMs(response, now);
    if (headerDelay !== undefined) return Math.min(headerDelay, retry.maxMs);
  }
  const raw = retry.backoffType === "fixed" ? retry.baseMs : retry.baseMs * 2 ** Math.max(0, failedAttempt - 1);
  const capped = Math.min(raw, retry.maxMs);
  const boundedRandom = Math.min(1, Math.max(0, random));
  return retry.jitter === "full" ? boundedRandom * capped : capped;
}

function withCancellation<T>(
  operation: () => T | PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(cancellationError(signal));
  const promise = Promise.resolve().then(operation);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(cancellationError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function bodyForAttempt(source: BodySource, signal: AbortSignal): Promise<BodyInit | null | undefined> {
  if (source.kind === "none") return undefined;
  if (source.kind === "factory") {
    return await withCancellation(() => source.create(), signal);
  }
  return source.value;
}

async function buildRequest(
  draft: MutableRequestDraft,
  signal: AbortSignal,
  requestInit: RequestConfiguration["requestInit"],
): Promise<Request> {
  let body: BodyInit | null | undefined;
  try {
    body = await bodyForAttempt(draft.body, signal);
  } catch (cause) {
    if (signal.aborted) throw cancellationError(signal, cause);
    throw new HttpConfigurationError("bodyFactory() failed to create a request body.", { cause });
  }
  const init: RequestInit & { duplex?: "half" } = {
    ...requestInit,
    method: draft.method,
    headers: draft.headers,
    signal,
    credentials: draft.credentials,
    ...(body !== undefined ? { body } : {}),
  };
  if (isReadableStream(body)) init.duplex = "half";

  try {
    return new Request(draft.url, init);
  } catch (cause) {
    throw new HttpConfigurationError("Failed to construct the HTTP Request.", { cause });
  }
}

function cloneDraft(draft: MutableRequestDraft): MutableRequestDraft {
  return {
    url: new URL(draft.url),
    method: draft.method,
    headers: new Headers(draft.headers),
    body: draft.body,
    credentials: draft.credentials,
  };
}

function canRetry(retry: NormalizedRetry, method: string, attempt: number): boolean {
  return attempt < retry.attempts && retry.methods.has(method);
}

async function bufferResponse(
  response: Response,
  signal: AbortSignal,
  maxResponseBytes: number,
  request: Request,
): Promise<Response> {
  if (response.bodyUsed || response.body?.locked) {
    throw new HttpConsumptionError(
      "The buffered response body was already consumed or locked by a Feature.",
      { request },
    );
  }
  const retained = response.clone();
  const reader = response.body?.getReader();
  if (signal.aborted) {
    void reader?.cancel().catch(() => undefined);
    void retained.body?.cancel().catch(() => undefined);
    throw cancellationError(signal);
  }
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(cancellationError(signal));
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const consume = async () => {
      if (!reader) return;
      let receivedBytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return;
        const chunkBytes = chunk.value?.byteLength;
        if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 0) {
          throw new HttpTransportError(INVALID_BODY_CHUNK, { request });
        }
        receivedBytes += chunkBytes;
        if (receivedBytes > maxResponseBytes) {
          throw new HttpResponseTooLargeError(maxResponseBytes, receivedBytes, { request });
        }
      }
    };
    await Promise.race([consume(), aborted]);
    return retained;
  } catch (error) {
    void reader?.cancel().catch(() => undefined);
    void retained.body?.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function normalizeFailure(error: unknown, signal: AbortSignal, request?: Request): HttpError {
  if (error instanceof HttpError) return error;
  if (signal.aborted) return cancellationError(signal, error);
  return new HttpTransportError("The HTTP transport failed.", {
    cause: error,
    ...(request !== undefined ? { request } : {}),
  });
}

function ensureError(error: unknown, request?: Request): Error {
  if (error instanceof Error) return error;
  return new HttpTransportError("The HTTP request failed with a non-Error value.", {
    cause: error,
    ...(request !== undefined ? { request } : {}),
  });
}

function snapshotDraft(draft: MutableRequestDraft) {
  const headers: Record<string, string> = {};
  draft.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return snapshotRequest({ method: draft.method, url: draft.url.toString(), headers });
}

function snapshotResponse(response: Response): RequestEventResponseSnapshot {
  return Object.freeze({ status: response.status, statusText: response.statusText });
}

function snapshotError(error: Error): RequestEventErrorSnapshot {
  return Object.freeze({
    name: error.name,
    message: error.message,
    ...(error instanceof HttpError ? { code: error.code } : {}),
    ...(error instanceof HttpStatusError ? { status: error.status } : {}),
    ...(error instanceof HttpTimeoutError ? { scope: error.scope } : {}),
  });
}

async function reportAttemptError(
  runtime: FeatureRuntime,
  config: RequestConfiguration,
  input: AttemptErrorInput,
): Promise<void> {
  await runtime.onAttemptError(input);
  const error = ensureError(input.error, input.request);
  await runtime.emit(Object.freeze({
    type: "attempt:error",
    requestId: runtime.requestId,
    timestamp: config.runtime.now(),
    attempt: input.attempt,
    ...(input.request !== undefined ? { request: snapshotRequest(input.request) } : {}),
    error: snapshotError(error),
    willRetry: input.willRetry,
    ...(input.retryDelayMs !== undefined ? { retryDelayMs: input.retryDelayMs } : {}),
  }));
}

function assertStreamingCompatible(features: readonly RequestFeature[]): void {
  const incompatible = features.find((feature) =>
    feature.capabilities?.provides?.some(({ name }) => name === "cache" || name === "dedupe"),
  );
  if (!incompatible) return;
  throw new HttpFeatureConflictError(
    `Feature "${incompatible.name}" is not compatible with as("stream").`,
  );
}

function responseWithBody(source: Response, body: BodyInit | null): Response;
function responseWithBody(source: Response, body: BodyInit | null, streaming: true): LStreamResponse;
function responseWithBody(
  source: Response,
  body: BodyInit | null,
  streaming = false,
): Response | LStreamResponse {
  const response = new Response(body, source);
  for (const key of ["url", "redirected", "type"] as const) {
    Object.defineProperty(response, key, { value: source[key] });
  }
  Object.defineProperty(response, "clone", {
    value: () => {
      const clonedBody = Response.prototype.clone.call(response).body;
      return streaming
        ? responseWithBody(source, clonedBody, true)
        : responseWithBody(source, clonedBody);
    },
  });
  return streaming ? withStreamConvenience(response) : response;
}

async function completeLifecycle(
  config: RequestConfiguration,
  runtime: FeatureRuntime,
  requestId: string,
  startedAt: number,
  endedAt: number,
  attempts: number,
  cleanup: () => void,
  request?: Request,
  response?: Response,
  source?: string,
  error?: Error,
  replaceAbort = false,
): Promise<void> {
  let finalError = error;

  if (finalError) {
    try {
      finalError = await runtime.mapError(finalError, attempts, request);
    } catch (mappingError) {
      finalError = ensureError(mappingError, request);
    }
  } else if (!request || !response || !source) {
    finalError = new HttpTransportError(MISSING_EXECUTION);
  }

  try {
    await runtime.finalize({
      ...(request !== undefined ? { request } : {}),
      ...(response !== undefined ? { response } : {}),
      ...(finalError !== undefined ? { error: finalError } : {}),
      attempts,
      ...(source !== undefined ? { source } : {}),
    });
  } catch (error) {
    const finalizeError = ensureError(error, request);
    if (!finalError || (replaceAbort && finalError instanceof HttpAbortError)) finalError = finalizeError;
  } finally {
    cleanup();
  }

  const durationMs = Math.max(0, endedAt - startedAt);
  if (finalError) {
    try {
      await runtime.emit(Object.freeze({
        type: "request:error",
        requestId,
        timestamp: config.runtime.now(),
        attempts,
        durationMs,
        ...(request !== undefined ? { request: snapshotRequest(request) } : {}),
        error: snapshotError(finalError),
      }));
    } catch { /* terminal observers cannot replace an already settled HTTP failure */ }
    throw finalError;
  }

  try {
    await runtime.emit(Object.freeze({
      type: "request:success",
      requestId,
      timestamp: config.runtime.now(),
      attempts,
      durationMs,
      request: snapshotRequest(request!),
      response: snapshotResponse(response!),
      source: source!,
    }));
  } catch { /* terminal observers cannot replace an already settled HTTP success */ }
}

function createStreamingResponse(
  response: Response,
  signal: AbortSignal,
  maxResponseBytes: number | undefined,
  request: Request,
  settle: (error?: Error) => Promise<void>,
  mapBodyError?: StreamingBodyErrorMapper,
): LStreamResponse {
  const body = response.body;
  if (!body) return responseWithBody(response, null, true);
  if (response.bodyUsed || body.locked) {
    throw new HttpConsumptionError(
      "The Streaming response body was already consumed or locked by a Feature.",
      { request },
    );
  }

  const reader = body.getReader();
  const responseSnapshot = responseWithBody(response, null);
  let receivedBytes = 0;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let terminal: Promise<void> | undefined;
  let onAbort: (() => void) | undefined;

  const exposeError = async (error: Error): Promise<Error> => {
    if (!mapBodyError) return error;
    try {
      await mapBodyError(error, request, responseSnapshot.clone());
      return error;
    } catch (mapped) {
      return ensureError(mapped, request);
    }
  };

  const removeAbortListener = () => {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    onAbort = undefined;
  };

  const fail = (caught: unknown): Promise<void> => {
    if (terminal) return terminal;
    terminal = (async () => {
      removeAbortListener();
      const error = normalizeFailure(caught, signal, request);
      void reader.cancel(error).catch(() => undefined);
      let failure: Error = error;
      try {
        await settle(error);
      } catch (settled) {
        failure = ensureError(settled, request);
      }
      const exposed = await exposeError(failure);
      try {
        controller.error(exposed);
      } catch { /* the consumer may have cancelled while failure settlement was running */ }
    })();
    return terminal;
  };

  const succeed = (): Promise<void> => {
    if (terminal) return terminal;
    terminal = (async () => {
      removeAbortListener();
      try {
        await settle();
      } catch (settled) {
        const exposed = await exposeError(ensureError(settled, request));
        try {
          controller.error(exposed);
        } catch { /* the consumer may have cancelled while finalization was running */ }
        return;
      }
      try {
        controller.close();
      } catch { /* the consumer may have cancelled while finalization was running */ }
    })();
    return terminal;
  };

  const wrapped = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      onAbort = () => { void fail(cancellationError(signal)); };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) void fail(cancellationError(signal));
    },
    async pull() {
      if (terminal) return await terminal;
      try {
        const chunk = await withCancellation(() => reader.read(), signal);
        if (terminal) return await terminal;
        if (chunk.done) return await succeed();

        const chunkBytes = chunk.value?.byteLength;
        if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 0) {
          throw new HttpTransportError(INVALID_BODY_CHUNK, { request });
        }
        const nextBytes = receivedBytes + chunkBytes;
        if (maxResponseBytes !== undefined && nextBytes > maxResponseBytes) {
          throw new HttpResponseTooLargeError(maxResponseBytes, nextBytes, { request });
        }
        receivedBytes = nextBytes;
        controller.enqueue(chunk.value);
      } catch (error) {
        await fail(error);
      }
    },
    async cancel(reason) {
      if (terminal) return await terminal;
      removeAbortListener();
      terminal = (async () => {
        let sourceError: Error | undefined;
        try {
          await reader.cancel(reason);
        } catch (error) {
          sourceError = normalizeFailure(error, signal, request);
        }
        const cancellation = sourceError ?? new HttpAbortError(reason, { request });
        try {
          await settle(cancellation);
        } catch (settled) {
          const failure = ensureError(settled, request);
          if (sourceError || !(failure instanceof HttpAbortError)) {
            throw await exposeError(failure);
          }
        }
      })();
      return await terminal;
    },
  });

  return responseWithBody(response, wrapped, true);
}

async function execute(
  config: RequestConfiguration,
  streaming: boolean,
  mapBodyError?: StreamingBodyErrorMapper,
): Promise<ExecutionResult | Response> {
  const startedAt = config.runtime.now();
  const requestId = config.runtime.requestId();
  const resolvedFeatures = resolveFeatures(config.features);
  if (streaming) assertStreamingCompatible(resolvedFeatures);
  const retry = normalizeRetry(config.retry, config.method, resolvedFeatures);
  const featureRuntime = new FeatureRuntime(resolvedFeatures, requestId);
  const totalDeadline = createDeadlineSignal("total", config.timeoutMs);
  const requestSignal = composeSignals([config.signal, totalDeadline.signal]);
  let attempts = 0;
  let finalRequest: Request | undefined;
  let finalResponse: Response | undefined;
  let finalSource: string | undefined;
  let finalError: Error | undefined;
  let execution: ExecutionResult | undefined;
  let endedAt: number | undefined;
  let finalAttemptCleanup: (() => void) | undefined;
  let completion: Promise<void> | undefined;
  let streamingExposed = false;

  const cleanup = () => {
    finalAttemptCleanup?.();
    finalAttemptCleanup = undefined;
    requestSignal.cleanup();
    totalDeadline.cleanup();
  };

  const settle = (error?: Error): Promise<void> => {
    completion ??= completeLifecycle(
      config,
      featureRuntime,
      requestId,
      startedAt,
      endedAt ?? config.runtime.now(),
      attempts,
      cleanup,
      finalRequest,
      finalResponse,
      finalSource,
      error,
      streamingExposed,
    );
    return completion;
  };

  const baseDraft: MutableRequestDraft = {
    url: applyQuery(resolveUrl(config.input, config.baseUrl), config.query),
    method: config.method,
    headers: new Headers(config.headers),
    body: config.body,
    credentials: config.credentials,
  };

  try {
    if (requestSignal.signal.aborted) throw cancellationError(requestSignal.signal);
    await featureRuntime.emit(Object.freeze({
      type: "request:start",
      requestId,
      timestamp: config.runtime.now(),
      request: snapshotDraft(baseDraft),
    }));
    await featureRuntime.prepare(baseDraft, requestSignal.signal);

    if (baseDraft.body.kind === "value" && isReadableStream(baseDraft.body.value) && retry.attempts > 1) {
      throw new HttpNonReplayableBodyError();
    }

    for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
      attempts = attempt;
      const attemptDeadline = createDeadlineSignal("attempt", config.attemptTimeoutMs);
      const attemptSignal = composeSignals([requestSignal.signal, attemptDeadline.signal]);
      const attemptDraft = cloneDraft(baseDraft);
      let request: Request | undefined;
      let streamingOwnsAttempt = false;
      let streamingLifecycleCompleted = false;

      try {
        if (attemptSignal.signal.aborted) throw cancellationError(attemptSignal.signal);
        await featureRuntime.beforeAttempt(attemptDraft, attempt, attemptSignal.signal);

        request = await buildRequest(attemptDraft, attemptSignal.signal, config.requestInit);
        finalRequest = request;
        if (attemptSignal.signal.aborted) throw cancellationError(attemptSignal.signal);
        await featureRuntime.emit(Object.freeze({
          type: "attempt:start",
          requestId,
          timestamp: config.runtime.now(),
          attempt,
          request: snapshotRequest(request),
        }));

        const intercepted = await featureRuntime.intercept(request, attempt, attemptSignal.signal);
        let response: Response;
        let source: string;
        if (intercepted) {
          response = intercepted.response;
          source = intercepted.source;
        } else {
          source = config.transport.name;
          response = await withCancellation(
            () => config.transport.send(request!, { requestId, attempt, signal: attemptSignal.signal }),
            attemptSignal.signal,
          );
          if (!(response instanceof Response)) {
            throw new HttpTransportError(`Transport "${config.transport.name}" returned a non-Response value.`, { request });
          }
        }

        if (attemptSignal.signal.aborted) throw cancellationError(attemptSignal.signal);
        response = await featureRuntime.afterResponse(request, response, attempt, source);
        await featureRuntime.emit(Object.freeze({
          type: "attempt:response",
          requestId,
          timestamp: config.runtime.now(),
          attempt,
          request: snapshotRequest(request),
          response: snapshotResponse(response),
          source,
        }));

        const accepted = isAcceptedStatus(response.status, config.acceptStatus);
        const willRetry = !accepted && retry.statuses.has(response.status) && canRetry(retry, attemptDraft.method, attempt);
        if (willRetry) {
          const delay = retryDelay(retry, attempt, config.runtime.random(), response, config.runtime.now());
          const statusError = new HttpStatusError(response, { request });
          await reportAttemptError(featureRuntime, config, {
            request,
            error: statusError,
            attempt,
            willRetry: true,
            retryDelayMs: delay,
          });
          await response.body?.cancel().catch(() => undefined);
          await config.runtime.sleep(delay, requestSignal.signal);
          continue;
        }

        if (streaming) {
          finalResponse = responseWithBody(response, null);
          finalSource = source;
          if (!accepted) {
            await response.body?.cancel().catch(() => undefined);
            throw new HttpStatusError(finalResponse, { request });
          }
          if (!response.body) {
            endedAt = config.runtime.now();
            streamingLifecycleCompleted = true;
            await settle();
            return responseWithBody(response, null, true);
          }

          const settleStream = async (error?: Error) => {
            let completionError = error;
            if (completionError) {
              try {
                await reportAttemptError(featureRuntime, config, {
                  request: request!,
                  error: completionError,
                  attempt,
                  willRetry: false,
                });
              } catch (reportError) {
                completionError = ensureError(reportError, request);
              }
            }
            endedAt = config.runtime.now();
            return await settle(completionError);
          };
          const streamed = createStreamingResponse(
            response,
            attemptSignal.signal,
            config.maxResponseBytes,
            request,
            settleStream,
            mapBodyError,
          );
          streamingExposed = true;
          streamingOwnsAttempt = true;
          finalAttemptCleanup = () => {
            attemptSignal.cleanup();
            attemptDeadline.cleanup();
          };
          return streamed;
        }

        const retained = await bufferResponse(
          response,
          attemptSignal.signal,
          config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
          request,
        );
        finalResponse = retained;
        finalSource = source;
        if (attemptSignal.signal.aborted) throw cancellationError(attemptSignal.signal);
        if (!accepted) throw new HttpStatusError(retained, { request });

        endedAt = config.runtime.now();
        const meta: RequestMeta = Object.freeze({
          requestId,
          attempts,
          startedAt,
          endedAt,
          durationMs: Math.max(0, endedAt - startedAt),
          transport: source,
        });
        execution = { request, response: retained, meta };
        break;
      } catch (caught) {
        if (streamingLifecycleCompleted) throw caught;
        const error = normalizeFailure(caught, attemptSignal.signal, request);
        const retryableFailure =
          (error instanceof HttpTransportError && retry.networkErrors) ||
          (error instanceof HttpTimeoutError && error.scope === "attempt");
        const willRetry = retryableFailure && canRetry(retry, attemptDraft.method, attempt);
        const delay = willRetry
          ? retryDelay(retry, attempt, config.runtime.random(), undefined, config.runtime.now())
          : undefined;
        await reportAttemptError(featureRuntime, config, {
          ...(request !== undefined ? { request } : {}),
          error,
          attempt,
          willRetry,
          ...(delay !== undefined ? { retryDelayMs: delay } : {}),
        });
        if (!willRetry || error instanceof HttpAbortError || (error instanceof HttpTimeoutError && error.scope === "total")) {
          throw error;
        }
        await config.runtime.sleep(delay!, requestSignal.signal);
      } finally {
        if (!streamingOwnsAttempt) {
          attemptSignal.cleanup();
          attemptDeadline.cleanup();
        }
      }
    }

    if (!execution) throw new HttpTransportError("The HTTP request exhausted its attempts without a result.");
  } catch (caught) {
    finalError = requestSignal.signal.aborted
      ? cancellationError(requestSignal.signal, caught)
      : ensureError(caught, finalRequest);
    endedAt ??= config.runtime.now();
  }

  await settle(finalError);
  if (!execution) throw new HttpTransportError(MISSING_EXECUTION);
  return execution;
}

export async function executeRequest(config: RequestConfiguration): Promise<ExecutionResult> {
  return await execute(config, false) as ExecutionResult;
}

export async function executeStreamingRequest(
  config: RequestConfiguration,
  mapBodyError?: StreamingBodyErrorMapper,
): Promise<LStreamResponse> {
  return await execute(config, true, mapBodyError) as LStreamResponse;
}
