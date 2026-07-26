import { createClient, type LClient } from "./client.js";
import type { ClientOptions } from "./core/types.js";

export interface Lafetch {
  readonly create: (options?: ClientOptions) => LClient;
}

/**
 * Factory for explicit, isolated Lafetch clients.
 */
export const lafetch: Lafetch = Object.freeze({
  create: createClient,
});
