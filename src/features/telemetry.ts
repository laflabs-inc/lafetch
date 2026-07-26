import { HttpConfigurationError } from "../core/errors.js";
import type { FeatureEventContext, RequestEvent, RequestFeature } from "../core/types.js";
import { validateOptionsObject } from "../core/validation.js";

export type TelemetryHandler = (event: RequestEvent) => void | Promise<void>;

export interface TelemetryOptions {
  /** Use a custom name when installing more than one telemetry sink. */
  readonly name?: string;
}

export function telemetry(handler: TelemetryHandler, options: TelemetryOptions = {}): RequestFeature {
  if (typeof handler !== "function") {
    throw new HttpConfigurationError("telemetry() requires an event handler.");
  }
  validateOptionsObject(options, "telemetry() options");
  const name = options.name ?? "lafetch.telemetry";
  if (typeof name !== "string" || !name.trim()) {
    throw new HttpConfigurationError("telemetry.name must be a non-empty string.");
  }

  return Object.freeze({
    name,
    capabilities: Object.freeze({
      provides: Object.freeze([{ name: "telemetry", mode: "observer" as const }]),
    }),
    hooks: Object.freeze({
      onEvent({ event }: FeatureEventContext) {
        void Promise.resolve()
          .then(() => handler(event))
          .catch(() => undefined);
      },
    }),
  });
}
