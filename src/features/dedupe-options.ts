import type { RequestFeature } from "../core/types.js";
import {
  validateHttpMethods,
  validateOptionalKey,
  validateOptionsObject,
} from "../core/validation.js";
import type { RequestKey } from "./request-key.js";

export interface DedupeOptions {
  readonly key?: RequestKey;
  readonly methods?: readonly string[];
}

export interface DedupeDeclaration {
  readonly key?: RequestKey;
  readonly methods: readonly string[];
}

export const dedupeFeatureDescriptor = Object.freeze<RequestFeature>({
  name: "dedupe",
  capabilities: { provides: [{ name: "dedupe", mode: "exclusive" }] },
});

export function snapshotDedupeDeclaration(
  options: DedupeOptions = {},
): DedupeDeclaration {
  validateOptionsObject(options, "dedupe() options");
  if (options.methods !== undefined) validateHttpMethods(options.methods, "dedupe.methods");
  validateOptionalKey(options.key, "dedupe.key");
  return Object.freeze({
    ...(options.key !== undefined ? { key: options.key } : {}),
    methods: Object.freeze([...(options.methods ?? ["GET", "HEAD"])]),
  });
}
