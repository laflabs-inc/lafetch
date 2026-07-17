import type { RuntimeAdapter } from "./types.js";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function requestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export const defaultRuntime: RuntimeAdapter = Object.freeze({
  now: () => Date.now(),
  random: () => Math.random(),
  sleep,
  requestId,
});

export function createRuntime(overrides: Partial<RuntimeAdapter> = {}): RuntimeAdapter {
  return Object.freeze({ ...defaultRuntime, ...overrides });
}

