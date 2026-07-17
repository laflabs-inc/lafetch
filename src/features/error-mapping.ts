import type { MapErrorContext, RequestFeature } from "../core/types.js";

export type ErrorMapper = (error: Error, context: Omit<MapErrorContext, "error">) => Error | void | Promise<Error | void>;

export function errorMapping(mapper: ErrorMapper): RequestFeature {
  return {
    name: "error-mapping",
    capabilities: { provides: [{ name: "error-mapping", mode: "composable" }] },
    hooks: {
      mapError(context) {
        const { error, ...rest } = context;
        return mapper(error, rest);
      },
    },
  };
}
