import type { RequestFeature } from "../core/types.js";

export interface IdempotencyOptions {
  readonly header?: string;
  readonly key?: string | (() => string | Promise<string>);
}

const keyState = Symbol("idempotency.key");

function randomKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `lafetch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function idempotency(options: IdempotencyOptions = {}): RequestFeature {
  const header = options.header ?? "Idempotency-Key";
  const configuredKey = options.key;
  return {
    name: "idempotency",
    capabilities: { provides: [{ name: "idempotency", mode: "exclusive" }] },
    hooks: {
      async beforeAttempt({ draft, state }) {
        if (draft.headers.has(header)) return;
        let key = state.get(keyState);
        if (typeof key !== "string") {
          key = typeof configuredKey === "function" ? await configuredKey() : (configuredKey ?? randomKey());
          state.set(keyState, key);
        }
        draft.headers.set(header, key as string);
      },
    },
  };
}
