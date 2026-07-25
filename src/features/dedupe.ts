import { HttpConfigurationError } from "../core/errors.js";
import type { RequestFeature } from "../core/types.js";
import { cancellationError } from "../core/signals.js";
import { hasSensitiveRequest, resolveRequestKey, type RequestKey } from "./request-key.js";

export interface DedupeOptions {
  readonly key?: RequestKey;
  readonly methods?: readonly string[];
}

interface SharedExecution {
  readonly promise: Promise<Response>;
  resolve(response: Response): void;
  reject(error: unknown): void;
}

const keyState = Symbol("dedupe.key");
const entryState = Symbol("dedupe.entry");
const leaderState = Symbol("dedupe.leader");

function deferred(): SharedExecution {
  let resolve!: (response: Response) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Response>((ok, fail) => { resolve = ok; reject = fail; });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(cancellationError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(cancellationError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

/** @internal */
export function createDedupeFeature(
  options: DedupeOptions = {},
  sharedExecutions: Map<string, unknown> = new Map(),
): RequestFeature {
  const executions = sharedExecutions as Map<string, SharedExecution>;
  const methods = new Set((options.methods ?? ["GET", "HEAD"]).map((method) => method.toUpperCase()));
  const configuredKey = options.key;
  return {
    name: "dedupe",
    capabilities: { provides: [{ name: "dedupe", mode: "exclusive" }] },
    hooks: {
      async intercept({ request, signal, state }) {
        const isLeader = state.get(leaderState) === true;
        if ((configuredKey === undefined && !methods.has(request.method)) || hasSensitiveRequest(request)) {
          if (isLeader) {
            throw new HttpConfigurationError("dedupe() request identity changed between retry attempts.");
          }
          return;
        }

        const key = await resolveRequestKey(configuredKey, request);
        // One entry owns the complete retry sequence. Recompute the final
        // Request key on retries, but never wait on the leader's own entry.
        if (isLeader) {
          if (state.get(keyState) !== key) {
            throw new HttpConfigurationError("dedupe() request identity changed between retry attempts.");
          }
          return;
        }
        state.set(keyState, key);
        const existing = executions.get(key);
        if (existing) {
          state.set(entryState, existing);
          try {
            return (await withAbort(existing.promise, signal)).clone();
          } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
            if (!signal.aborted && (code === "ERR_HTTP_ABORTED" || code === "ERR_HTTP_TIMEOUT")) {
              const replacement = deferred();
              executions.set(key, replacement);
              state.set(entryState, replacement);
              state.set(leaderState, true);
              return;
            }
            throw error;
          }
        }
        const entry = deferred();
        executions.set(key, entry);
        state.set(entryState, entry);
        state.set(leaderState, true);
        return;
      },
      finalize({ response, error, state }) {
        if (!state.get(leaderState)) return;
        const key = state.get(keyState);
        const entry = state.get(entryState) as SharedExecution | undefined;
        if (typeof key === "string" && executions.get(key) === entry) executions.delete(key);
        if (!entry) return;
        if (response instanceof Response && error === undefined) entry.resolve(response.clone());
        else entry.reject(error ?? new Error("Deduplicated request completed without a response."));
      },
    },
  };
}

export function dedupe(options: DedupeOptions = {}): RequestFeature {
  return createDedupeFeature(options);
}
