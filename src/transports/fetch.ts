import type { Transport } from "../core/types.js";

export function fetchTransport(fetchImpl: typeof globalThis.fetch = globalThis.fetch): Transport {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("No Fetch implementation is available. Provide a custom Transport.");
  }

  return Object.freeze({
    name: "fetch",
    send(request: Request): Promise<Response> {
      return fetchImpl(request);
    },
  });
}

