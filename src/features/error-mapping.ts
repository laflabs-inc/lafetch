import type { MapErrorContext, RequestFeature } from "../core/types.js";

export type ErrorMapper = (error: Error, context: Omit<MapErrorContext, "error">) => Error | void | Promise<Error | void>;

export interface ErrorMappingOptions {
  /** Stable name for diagnostics and explicit ordering. */
  readonly name?: string;
}

let mappingSequence = 0;

export function errorMapping(mapper: ErrorMapper, options: ErrorMappingOptions = {}): RequestFeature {
  const name = options.name ?? `lafetch.error-mapping.${mappingSequence++}`;
  return {
    name,
    capabilities: { provides: [{ name: "error-mapping", mode: "composable" }] },
    hooks: {
      mapError(context) {
        const { error, ...rest } = context;
        return mapper(error, rest);
      },
    },
  };
}
