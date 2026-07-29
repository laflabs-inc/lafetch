import { HttpConfigurationError } from "../core/errors.js";
import type { ClientPolicyScope } from "../core/config.js";
import type { RequestFeature } from "../core/types.js";
import { cancellationError } from "../core/signals.js";
import type { DedupeDeclaration } from "./dedupe-options.js";
import { cacheInvalidationMetadata } from "./policy-metadata.js";
import { hasSensitiveRequest, resolveRequestKey } from "./request-key.js";

interface SharedExecution {
  readonly promise: Promise<Response>;
  resolve(response: Response): void;
  reject(error: unknown): void;
}

const keyState = Symbol("dedupe.key");
const entryState = Symbol("dedupe.entry");
const leaderState = Symbol("dedupe.leader");
const sharedExecutionsState = Symbol("dedupe.sharedExecutions");

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
  declaration: DedupeDeclaration,
  scope: ClientPolicyScope,
): RequestFeature {
  const executions = scope.get(
    sharedExecutionsState,
    () => new Map<string, SharedExecution>(),
  );
  const methods = new Set(declaration.methods.map((method) => method.toUpperCase()));
  const configuredKey = declaration.key;
  return {
    name: "dedupe",
    hooks: {
      async intercept({ request, signal, state, metadata }) {
        if (metadata.get(cacheInvalidationMetadata) === true) return;
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
        while (true) {
          const existing = executions.get(key);
          if (!existing) {
            const entry = deferred();
            executions.set(key, entry);
            state.set(entryState, entry);
            state.set(leaderState, true);
            return;
          }
          state.set(entryState, existing);
          try {
            return (await withAbort(existing.promise, signal)).clone();
          } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
            if (signal.aborted || (code !== "ERR_HTTP_ABORTED" && code !== "ERR_HTTP_TIMEOUT")) {
              throw error;
            }
            if (executions.get(key) === existing) {
              const replacement = deferred();
              executions.set(key, replacement);
              state.set(entryState, replacement);
              state.set(leaderState, true);
              return;
            }
          }
        }
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
