import { HttpConfigurationError } from "./errors.js";
import type {
  LLifecycleHandler,
  LRequestEvent,
  LResponseEvent,
} from "../lifecycle.js";
import type { LRequest } from "../request-builder.js";

export interface RequestLifecycleController<TDraft, TPrepared> {
  readonly draft: TDraft;
  readonly request: (draft: TDraft) => LRequest;
  readonly derive: (request: LRequest) => TDraft | undefined;
  readonly prepare: (draft: TDraft) => TPrepared;
}

export async function runRequestLifecycle<TDraft, TPrepared>(
  handlers: readonly LLifecycleHandler[],
  controller: RequestLifecycleController<TDraft, TPrepared>,
): Promise<TPrepared> {
  let draft = controller.draft;
  let active = true;
  const event = {} as LRequestEvent;
  Object.defineProperty(event, "type", {
    configurable: false,
    enumerable: true,
    value: "request",
    writable: false,
  });
  Object.defineProperty(event, "request", {
    configurable: false,
    enumerable: true,
    get: () => controller.request(draft),
    set: (request: LRequest) => {
      if (!active) {
        throw new HttpConfigurationError(
          "The lifecycle request event is no longer active.",
        );
      }
      const derived = controller.derive(request);
      if (derived === undefined) {
        throw new HttpConfigurationError(
          "event.request must remain a configuration derived from the current lifecycle request.",
        );
      }
      draft = derived;
    },
  });
  Object.seal(event);

  try {
    for (const handler of handlers) {
      await handler(event);
    }
  } finally {
    active = false;
  }
  return controller.prepare(draft);
}

export async function runResponseLifecycle(
  handlers: readonly LLifecycleHandler[],
  event: LResponseEvent,
): Promise<void> {
  for (const handler of handlers) {
    await handler(event);
  }
}
