import { HttpAbortError, HttpTimeoutError } from "./errors.js";
import type { TimeoutScope } from "./types.js";

export interface TimeoutReason {
  readonly type: "lafetch.timeout";
  readonly scope: TimeoutScope;
  readonly timeoutMs: number;
}

export interface DeadlineSignal {
  readonly signal?: AbortSignal;
  cleanup(): void;
}

export function createDeadlineSignal(scope: TimeoutScope, timeoutMs?: number): DeadlineSignal {
  if (timeoutMs === undefined) return { cleanup() {} };

  const controller = new AbortController();
  const reason: TimeoutReason = Object.freeze({ type: "lafetch.timeout", scope, timeoutMs });
  if (timeoutMs === 0) {
    controller.abort(reason);
    return { signal: controller.signal, cleanup() {} };
  }
  const timer = setTimeout(() => controller.abort(reason), timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
    },
  };
}

export interface ComposedSignal {
  readonly signal: AbortSignal;
  cleanup(): void;
}

export function composeSignals(signals: readonly (AbortSignal | undefined)[]): ComposedSignal {
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];

  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }

    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    cleanups.push(() => signal.removeEventListener("abort", onAbort));
  }

  return {
    signal: controller.signal,
    cleanup() {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

function isTimeoutReason(value: unknown): value is TimeoutReason {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "lafetch.timeout" &&
    "scope" in value &&
    "timeoutMs" in value
  );
}

export function cancellationError(signal: AbortSignal, cause?: unknown): HttpAbortError | HttpTimeoutError {
  const reason: unknown = signal.reason;
  if (isTimeoutReason(reason)) {
    return new HttpTimeoutError(reason.scope, reason.timeoutMs, { cause });
  }
  return new HttpAbortError(reason, { cause });
}
