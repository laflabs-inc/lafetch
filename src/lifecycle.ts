import { HttpConfigurationError } from "./core/errors.js";
import type { LResponse } from "./core/types.js";
import type { LRequest } from "./request-builder.js";

export interface LRequestEvent {
  readonly type: "request";
  request: LRequest;
}

export interface LResponseEvent {
  readonly type: "response";
  readonly response: LResponse;
}

export type LLifecycleEvent = LRequestEvent | LResponseEvent;

export type LLifecycleHandler = (
  event: LLifecycleEvent,
) => void | Promise<void>;

/** @internal */
export function validateLifecycleHandler(
  handler: unknown,
): asserts handler is LLifecycleHandler {
  if (typeof handler !== "function") {
    throw new HttpConfigurationError("on() requires a function.");
  }
}
