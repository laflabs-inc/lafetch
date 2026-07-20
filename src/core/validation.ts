import { HttpConfigurationError } from "./errors.js";
import type {
  BackoffType,
  CapabilityMode,
  JitterType,
  RetryOptions,
} from "./types.js";

const REQUEST_CREDENTIALS = ["omit", "same-origin", "include"] as const;
const BACKOFF_TYPES = ["fixed", "exponential"] as const;
const JITTER_TYPES = ["none", "full"] as const;
const CAPABILITY_MODES = ["exclusive", "composable", "observer"] as const;

function allowedValues(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}

function closedString<TValue extends string>(
  value: unknown,
  values: readonly TValue[],
  label: string,
): TValue {
  if (typeof value === "string" && values.includes(value as TValue)) return value as TValue;
  throw new HttpConfigurationError(`${label} must be one of ${allowedValues(values)}.`);
}

function isOptionsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateRequestCredentials(value: unknown, label: string): RequestCredentials {
  return closedString(value, REQUEST_CREDENTIALS, label);
}

export function validateBackoffType(value: unknown): BackoffType {
  return closedString(value, BACKOFF_TYPES, "retry.backoff.type");
}

export function validateJitterType(value: unknown): JitterType {
  return closedString(value, JITTER_TYPES, "retry.backoff.jitter");
}

export function validateCapabilityMode(value: unknown, label: string): CapabilityMode {
  return closedString(value, CAPABILITY_MODES, label);
}

export function validateRetryOptions(value: unknown): asserts value is RetryOptions {
  if (!isOptionsObject(value)) {
    throw new HttpConfigurationError("retry() options must be an object.");
  }

  const backoff = value.backoff;
  if (backoff === undefined) return;
  if (!isOptionsObject(backoff)) {
    throw new HttpConfigurationError("retry.backoff must be an object.");
  }
  if (backoff.type !== undefined) validateBackoffType(backoff.type);
  if (backoff.jitter !== undefined) validateJitterType(backoff.jitter);
}
