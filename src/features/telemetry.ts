import { HttpConfigurationError } from "../core/errors.js";
import type { FeatureEventContext, RequestEvent, RequestFeature } from "../core/types.js";

export type TelemetryHandler = (event: RequestEvent) => void | Promise<void>;
export type TelemetryFailureMode = "ignore" | "throw";

export interface TelemetryOptions {
  readonly onEvent: TelemetryHandler;
  /** Use a custom name when installing more than one telemetry sink. */
  readonly name?: string;
  /** Telemetry is non-fatal by default. */
  readonly failureMode?: TelemetryFailureMode;
}

export type TelemetryInput = TelemetryHandler | TelemetryOptions;

export function telemetry(input: TelemetryInput): RequestFeature {
  const options: TelemetryOptions = typeof input === "function" ? { onEvent: input } : input;
  if (typeof options?.onEvent !== "function") {
    throw new HttpConfigurationError("telemetry() requires an event handler.");
  }
  if (options.failureMode !== undefined && options.failureMode !== "ignore" && options.failureMode !== "throw") {
    throw new HttpConfigurationError('telemetry.failureMode must be either "ignore" or "throw".');
  }

  const name = options.name ?? "lafetch.telemetry";
  if (!name.trim()) throw new HttpConfigurationError("telemetry.name cannot be empty.");
  const failureMode = options.failureMode ?? "ignore";

  return Object.freeze({
    name,
    capabilities: Object.freeze({
      provides: Object.freeze([{ name: "telemetry", mode: "observer" as const }]),
    }),
    hooks: Object.freeze({
      async onEvent({ event }: FeatureEventContext) {
        try {
          await options.onEvent(event);
        } catch (error) {
          if (failureMode === "throw") throw error;
        }
      },
    }),
  });
}
