import { HttpConfigurationError } from "./errors.js";
import { durationToMs } from "./duration.js";
import type {
  AdvancedRequestInit,
  BackoffType,
  CapabilityMode,
  JitterType,
  QueryParams,
  QueryPrimitive,
  RetryOptions,
  StatusMatcher,
} from "./types.js";

const REQUEST_CACHE = ["default", "force-cache", "no-cache", "no-store", "only-if-cached", "reload"] as const;
const REQUEST_MODE = ["cors", "no-cors", "same-origin"] as const;
const REQUEST_PRIORITY = ["auto", "high", "low"] as const;
const REQUEST_REDIRECT = ["error", "follow", "manual"] as const;
const REFERRER_POLICY = [
  "",
  "no-referrer",
  "no-referrer-when-downgrade",
  "origin",
  "origin-when-cross-origin",
  "same-origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
  "unsafe-url",
] as const;
const ADVANCED_REQUEST_INIT_KEYS = new Set([
  "cache",
  "integrity",
  "keepalive",
  "mode",
  "priority",
  "redirect",
  "referrer",
  "referrerPolicy",
]);
const REQUEST_CREDENTIALS = ["omit", "same-origin", "include"] as const;
const BACKOFF_TYPES = ["fixed", "exponential"] as const;
const JITTER_TYPES = ["none", "full"] as const;
const CAPABILITY_MODES = ["exclusive", "composable", "observer"] as const;
const HTTP_METHOD = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

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

function configurationError(label: string, expected: string): never {
  throw new HttpConfigurationError(`${label} must be ${expected}.`);
}

export function validateHttpMethods(
  value: unknown,
  label: string,
): asserts value is readonly string[] {
  if (
    !Array.isArray(value)
    || value.some((method) => typeof method !== "string" || !HTTP_METHOD.test(method))
  ) {
    configurationError(label, "an array of non-empty HTTP method tokens");
  }
}

export function validateHttpStatuses(
  value: unknown,
  label: string,
): asserts value is readonly number[] {
  if (
    !Array.isArray(value)
    || value.some((status) => !Number.isSafeInteger(status) || status < 0 || status > 599)
  ) {
    configurationError(label, "an array of integer HTTP statuses between 0 and 599");
  }
}

function validateBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") configurationError(label, "a boolean");
}

function isQueryPrimitive(value: unknown): value is QueryPrimitive {
  return (
    value === null
    || value === undefined
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || typeof value === "bigint"
  );
}

export function validateRequestCredentials(value: unknown, label: string): RequestCredentials {
  return closedString(value, REQUEST_CREDENTIALS, label);
}

export function validateAdvancedRequestInit(
  value: unknown,
  validateCombination = true,
): AdvancedRequestInit {
  if (!isOptionsObject(value)) {
    configurationError("requestInit() value", "an object");
  }
  for (const key of Object.keys(value)) {
    if (!ADVANCED_REQUEST_INIT_KEYS.has(key)) {
      throw new HttpConfigurationError(
        `requestInit() does not allow "${key}". Use the dedicated Lafetch request method instead.`,
      );
    }
  }

  const cache = value.cache === undefined
    ? undefined
    : closedString(value.cache, REQUEST_CACHE, "requestInit.cache");
  const mode = value.mode === undefined
    ? undefined
    : closedString(value.mode, REQUEST_MODE, "requestInit.mode");
  const priority = value.priority === undefined
    ? undefined
    : closedString(value.priority, REQUEST_PRIORITY, "requestInit.priority");
  const redirect = value.redirect === undefined
    ? undefined
    : closedString(value.redirect, REQUEST_REDIRECT, "requestInit.redirect");
  const referrerPolicy = value.referrerPolicy === undefined
    ? undefined
    : closedString(value.referrerPolicy, REFERRER_POLICY, "requestInit.referrerPolicy");
  if (value.integrity !== undefined && typeof value.integrity !== "string") {
    configurationError("requestInit.integrity", "a string");
  }
  if (value.keepalive !== undefined) {
    validateBoolean(value.keepalive, "requestInit.keepalive");
  }
  if (value.referrer !== undefined && typeof value.referrer !== "string") {
    configurationError("requestInit.referrer", "a string");
  }
  if (validateCombination && cache === "only-if-cached" && mode !== "same-origin") {
    throw new HttpConfigurationError(
      'requestInit.cache "only-if-cached" requires requestInit.mode "same-origin".',
    );
  }

  return Object.freeze({
    ...(cache !== undefined ? { cache } : {}),
    ...(value.integrity !== undefined ? { integrity: value.integrity } : {}),
    ...(value.keepalive !== undefined ? { keepalive: value.keepalive } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(redirect !== undefined ? { redirect } : {}),
    ...(value.referrer !== undefined ? { referrer: value.referrer } : {}),
    ...(referrerPolicy !== undefined ? { referrerPolicy } : {}),
  });
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

  if (value.methods !== undefined) validateHttpMethods(value.methods, "retry.methods");
  if (value.statuses !== undefined) validateHttpStatuses(value.statuses, "retry.statuses");
  if (value.networkErrors !== undefined) validateBoolean(value.networkErrors, "retry.networkErrors");
  if (value.respectRetryAfter !== undefined) {
    validateBoolean(value.respectRetryAfter, "retry.respectRetryAfter");
  }
  if (value.maxRetryAfter !== undefined) {
    durationToMs(value.maxRetryAfter, "retry.maxRetryAfter");
  }

  const backoff = value.backoff;
  if (backoff === undefined) return;
  if (!isOptionsObject(backoff)) {
    throw new HttpConfigurationError("retry.backoff must be an object.");
  }
  if (backoff.type !== undefined) validateBackoffType(backoff.type);
  if (backoff.base !== undefined) durationToMs(backoff.base, "retry.backoff.base");
  if (backoff.max !== undefined) durationToMs(backoff.max, "retry.backoff.max");
  if (backoff.jitter !== undefined) validateJitterType(backoff.jitter);
}

export function validateStatusMatcher(value: unknown): asserts value is StatusMatcher {
  if (typeof value === "function") return;
  validateHttpStatuses(value, "acceptStatus() value");
}

export function validateAbortSignal(value: unknown): asserts value is AbortSignal {
  if (
    typeof value !== "object"
    || value === null
    || typeof (value as Partial<AbortSignal>).aborted !== "boolean"
    || typeof (value as Partial<AbortSignal>).addEventListener !== "function"
    || typeof (value as Partial<AbortSignal>).removeEventListener !== "function"
  ) {
    configurationError("signal() value", "an AbortSignal");
  }
}

export function validateQueryParams(value: unknown): asserts value is QueryParams {
  if (!isOptionsObject(value)) {
    configurationError("query() value", "an object");
  }
  for (const [name, item] of Object.entries(value)) {
    const valid = Array.isArray(item)
      ? item.every(isQueryPrimitive)
      : isQueryPrimitive(item);
    if (!valid) {
      throw new HttpConfigurationError(
        `query() value for "${name}" must be a primitive or an array of primitives.`,
      );
    }
  }
}

export function validateOptionsObject(
  value: unknown,
  label: string,
): void {
  if (!isOptionsObject(value)) {
    throw new HttpConfigurationError(`${label} must be an object.`);
  }
}

export function validateOptionalKey(value: unknown, label: string): void {
  if (
    value !== undefined
    && typeof value !== "function"
    && (typeof value !== "string" || value.trim() === "")
  ) {
    throw new HttpConfigurationError(`${label} must be a non-empty string or a function.`);
  }
}
