import { createClient, type LafetchClient } from "./client.js";
import type { ClientOptions } from "./core/types.js";

export interface Lafetch extends LafetchClient {
  create(options?: ClientOptions): LafetchClient;
}

const defaultClient = createClient();

/**
 * Zero-config HTTP client with an Axios-like static surface.
 * Use create() when requests share defaults or require an isolation boundary.
 */
export const lafetch: Lafetch = Object.freeze({
  create: createClient,
  request: defaultClient.request.bind(defaultClient),
  get: defaultClient.get.bind(defaultClient),
  post: defaultClient.post.bind(defaultClient),
  put: defaultClient.put.bind(defaultClient),
  patch: defaultClient.patch.bind(defaultClient),
  delete: defaultClient.delete.bind(defaultClient),
  head: defaultClient.head.bind(defaultClient),
  extend: defaultClient.extend.bind(defaultClient),
});
