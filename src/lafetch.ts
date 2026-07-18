import { createClient, type LafetchClient } from "./client.js";
import type { ClientOptions } from "./core/types.js";

export interface Lafetch {
  readonly create: (options?: ClientOptions) => LafetchClient;
}

/**
 * Factory for explicit, isolated Lafetch clients.
 */
export const lafetch: Lafetch = Object.freeze({
  create: createClient,
});
