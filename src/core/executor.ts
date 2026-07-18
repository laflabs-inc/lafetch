import { durationToMs } from "./duration.js";
import {
  HttpAbortError,
  HttpConfigurationError,
  HttpError,
  HttpNonReplayableBodyError,
  HttpStatusError,
  HttpTimeoutError,
  HttpTransportError,
  snapshotRequest,
} from "./errors.js";
import { FeatureRuntime, type AttemptErrorInput } from "./feature-runtime.js";
import { resolveFeatures } from "./features.js";
import { applyQuery, resolveUrl } from "./query.js";
import { cancellationError, composeSignals, createDeadlineSignal } from "./signals.js";
import type { RequestConfiguration } from "./config.js";
import type {
  BodySource,
  MutableRequestDraft,
  RawExecution,
  RequestEventErrorSnapshot,
  RequestEventResponseSnapshot,
  RequestMeta,
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

function normalizeTimeout(config: RequestConfiguration): { totalMs?: number; attemptMs?: number } {
  return {
    ...(config.timeout !== undefined ? { totalMs: durationToMs(config.timeout, "timeout") } : {}),
    ...(config.attemptTimeout !== undefined
      ? { attemptMs: durationToMs(config.attemptTimeout, "attemptTimeout") }
      : {}),
  };
}

function normalizeRetry(
  input: RequestConfiguration["retry"],
  method: string,
  features: readonly { capabilities?: { provides?: readonly { name: string }[] } }[],
): NormalizedRetry {
  const retries = input?.retries ?? 0;
  const options: RetryOptions = input?.options ?? {};
  if (!Number.isInteger(retries) || retries < 0) {
    throw new HttpConfigurationError("retry() requires a non-negative integer retry count.");
  }

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
      return matcher(status);
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

async function bodyForAttempt(source: BodySource): Promise<BodyInit | null | undefined> {
  if (source.kind === "none") return undefined;
  if (source.kind === "factory") return await source.create();
  return source.value;
}

async function buildRequest(draft: MutableRequestDraft, signal: AbortSignal): Promise<Request> {
  let body: BodyInit | null | undefined;
  try {
    body = await bodyForAttempt(draft.body);
  } catch (cause) {
    throw new HttpConfigurationError("bodyFactory() failed to create a request body.", { cause });
  }
  const init: RequestInit & { duplex?: "half" } = {
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

async function bufferResponse(response: Response, signal: AbortSignal): Promise<Response> {
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
      while (!(await reader.read()).done) { /* drain the body into the retained clone */ }
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

export async function executeRequest(config: RequestConfiguration): Promise<RawExecution> {
  const startedAt = config.runtime.now();
  const requestId = config.runtime.requestId();
  const timeout = normalizeTimeout(config);
  const resolvedFeatures = resolveFeatures(config.features);
  const retry = normalizeRetry(config.retry, config.method, resolvedFeatures);
  const featureRuntime = new FeatureRuntime(resolvedFeatures, requestId);
  const totalDeadline = createDeadlineSignal("total", timeout.totalMs);
  const requestSignal = composeSignals([config.signal, totalDeadline.signal]);
  let attempts = 0;
  let finalRequest: Request | undefined;
  let finalResponse: Response | undefined;
  let finalSource: string | undefined;
  let finalError: Error | undefined;
  let execution: RawExecution | undefined;
  let endedAt: number | undefined;

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
      const attemptDeadline = createDeadlineSignal("attempt", timeout.attemptMs);
      const attemptSignal = composeSignals([requestSignal.signal, attemptDeadline.signal]);
      const attemptDraft = cloneDraft(baseDraft);
      let request: Request | undefined;

      try {
        if (attemptSignal.signal.aborted) throw cancellationError(attemptSignal.signal);
        await featureRuntime.beforeAttempt(attemptDraft, attempt, attemptSignal.signal);

        request = await buildRequest(attemptDraft, attemptSignal.signal);
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
          response = await config.transport.send(request, { requestId, attempt, signal: attemptSignal.signal });
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

        const retained = await bufferResponse(response, attemptSignal.signal);
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
        attemptSignal.cleanup();
        attemptDeadline.cleanup();
      }
    }

    if (!execution) throw new HttpTransportError("The HTTP request exhausted its attempts without a result.");
  } catch (caught) {
    const error = requestSignal.signal.aborted
      ? cancellationError(requestSignal.signal, caught)
      : ensureError(caught, finalRequest);
    try {
      finalError = await featureRuntime.mapError(error, attempts, finalRequest);
    } catch (mappingError) {
      finalError = ensureError(mappingError, finalRequest);
    }
    endedAt ??= config.runtime.now();
  }

  try {
    await featureRuntime.finalize({
      ...(finalRequest !== undefined ? { request: finalRequest } : {}),
      ...(finalResponse !== undefined ? { response: finalResponse } : {}),
      ...(finalError !== undefined ? { error: finalError } : {}),
      attempts,
      ...(finalSource !== undefined ? { source: finalSource } : {}),
    });
  } catch (finalizeError) {
    finalError ??= ensureError(finalizeError, finalRequest);
    endedAt ??= config.runtime.now();
  } finally {
    requestSignal.cleanup();
    totalDeadline.cleanup();
  }

  const completedAt = endedAt ?? config.runtime.now();
  const durationMs = Math.max(0, completedAt - startedAt);

  if (finalError) {
    try {
      await featureRuntime.emit(Object.freeze({
        type: "request:error",
        requestId,
        timestamp: config.runtime.now(),
        attempts,
        durationMs,
        ...(finalRequest !== undefined ? { request: snapshotRequest(finalRequest) } : {}),
        error: snapshotError(finalError),
      }));
    } catch { /* terminal observers cannot replace an already settled HTTP failure */ }
    throw finalError;
  }

  if (!execution || !finalRequest || !finalResponse || !finalSource) {
    throw new HttpTransportError("The HTTP request completed without an execution result.");
  }

  try {
    await featureRuntime.emit(Object.freeze({
      type: "request:success",
      requestId,
      timestamp: config.runtime.now(),
      attempts,
      durationMs,
      request: snapshotRequest(finalRequest),
      response: snapshotResponse(finalResponse),
      source: finalSource,
    }));
  } catch { /* terminal observers cannot replace an already settled HTTP success */ }
  return execution;
}
