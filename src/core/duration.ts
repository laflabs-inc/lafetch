import { HttpConfigurationError } from "./errors.js";
import type { Duration } from "./types.js";

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m)$/;

export function durationToMs(value: Duration, label = "duration"): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new HttpConfigurationError(`${label} must be a finite, non-negative number.`);
    }
    return value;
  }

  const match = DURATION_PATTERN.exec(value);
  if (!match) {
    throw new HttpConfigurationError(`${label} must use the form "250ms", "3s", or "1m".`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "ms" ? 1 : unit === "s" ? 1_000 : 60_000;
  return amount * multiplier;
}

