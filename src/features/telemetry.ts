import { HttpConfigurationError } from "../core/errors.js";
import type { FeatureEventContext, RequestEvent, RequestFeature } from "../core/types.js";

export type TelemetryHandler = (event: RequestEvent) => void | Promise<void>;

export interface TelemetryOptions {
  /** Use a custom name when installing more than one telemetry sink. */
  readonly name?: string;
}

export function telemetry(handler: TelemetryHandler, options: TelemetryOptions = {}): RequestFeature {
  if (typeof handler !== "function") {
    throw new HttpConfigurationError("telemetry() requires an event handler.");
  }
  const name = options.name ?? "lafetch.telemetry";
  if (!name.trim()) throw new HttpConfigurationError("telemetry.name cannot be empty.");

  return Object.freeze({
    name,
    capabilities: Object.freeze({
      provides: Object.freeze([{ name: "telemetry", mode: "observer" as const }]),
    }),
    hooks: Object.freeze({
      async onEvent({ event }: FeatureEventContext) {
        try {
          await handler(event);
        } catch { /* official telemetry is observation-only */ }
      },
    }),
  });
}
