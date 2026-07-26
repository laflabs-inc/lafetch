import { HttpConfigurationError } from "./errors.js";
import type { RuntimeAdapter } from "./types.js";
import { scheduleTimer } from "./timer.js";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timer = scheduleTimer(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      timer.cancel();
      reject(signal?.reason);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function requestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

const defaultRuntime: RuntimeAdapter = Object.freeze({
  now: () => Date.now(),
  random: () => Math.random(),
  sleep,
  requestId,
});

export function createRuntime(overrides: Partial<RuntimeAdapter> = {}): RuntimeAdapter {
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
    throw new HttpConfigurationError("lafetch.create() runtime must be an object.");
  }
  for (const name of ["now", "random", "sleep", "requestId"] as const) {
    if (overrides[name] !== undefined && typeof overrides[name] !== "function") {
      throw new HttpConfigurationError(`lafetch.create() runtime.${name} must be a function.`);
    }
  }
  return Object.freeze({ ...defaultRuntime, ...overrides });
}
