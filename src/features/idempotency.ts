import { HttpConfigurationError } from "../core/errors.js";
import type { RequestFeature } from "../core/types.js";
import { validateOptionsObject } from "../core/validation.js";

export interface IdempotencyOptions {
  readonly header?: string;
  readonly key?: string | (() => string | Promise<string>);
}

const keyState = Symbol("idempotency.key");

function randomKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `lafetch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function idempotency(options: IdempotencyOptions = {}): RequestFeature {
  validateOptionsObject(options, "idempotency() options");
  const header = options.header ?? "Idempotency-Key";
  const configuredKey = options.key;
  if (typeof header !== "string" || header.trim() === "") {
    throw new HttpConfigurationError("idempotency.header must be a non-empty string.");
  }
  try {
    new Headers([[header, "probe"]]);
  } catch (cause) {
    throw new HttpConfigurationError("idempotency.header must be a valid HTTP header name.", { cause });
  }
  if (
    configuredKey !== undefined
    && typeof configuredKey !== "function"
    && (typeof configuredKey !== "string" || configuredKey.trim() === "")
  ) {
    throw new HttpConfigurationError(
      "idempotency.key must be a non-empty string or a function.",
    );
  }
  return {
    name: "idempotency",
    capabilities: { provides: [{ name: "idempotency", mode: "exclusive" }] },
    hooks: {
      async beforeAttempt({ draft, state }) {
        if (draft.headers.has(header)) return;
        let key = state.get(keyState);
        if (typeof key !== "string") {
          key = typeof configuredKey === "function" ? await configuredKey() : (configuredKey ?? randomKey());
          if (typeof key !== "string" || key.trim() === "") {
            throw new HttpConfigurationError("Idempotency key must be a non-empty string.");
          }
          state.set(keyState, key);
        }
        draft.headers.set(header, key as string);
      },
    },
  };
}
