import { HttpConfigurationError } from "./errors.js";

export interface CacheEntry {
  readonly response: Response;
  /** Actual buffered response-body bytes retained by this entry. */
  readonly sizeBytes: number;
  /** Absolute epoch milliseconds when response freshness started. */
  readonly storedAt: number;
  readonly expiresAt: number;
}

export interface CacheStore {
  /** Return a stored entry or undefined. Core owns expiration and revalidation policy. */
  get(key: string): CacheEntry | undefined | Promise<CacheEntry | undefined>;
  /** Snapshot the entry so later consumption of the input Response cannot affect the Store. */
  set(key: string, entry: CacheEntry): void | Promise<void>;
  /** Remove the key. Deleting a missing key must succeed. */
  delete(key: string): void | Promise<void>;
}

export class MemoryCacheStore implements CacheStore {
  readonly #entries = new Map<string, CacheEntry>();
  #retainedBytes = 0;

  constructor(
    readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
    readonly maxBytes = 64 * 1024 * 1024,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new HttpConfigurationError("MemoryCacheStore maxEntries must be a positive safe integer.");
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new HttpConfigurationError("MemoryCacheStore maxBytes must be a non-negative safe integer.");
    }
  }

  #remove(key: string): void {
    const entry = this.#entries.get(key);
    if (!entry) return;
    this.#entries.delete(key);
    this.#retainedBytes -= entry.sizeBytes;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (
      entry.expiresAt <= this.now()
      && !entry.response.headers.has("etag")
      && !entry.response.headers.has("last-modified")
    ) {
      this.#remove(key);
      return undefined;
    }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return { ...entry, response: entry.response.clone() };
  }

  set(key: string, entry: CacheEntry): void {
    if (
      !(entry.response instanceof Response)
      || !Number.isFinite(entry.storedAt)
      || !Number.isFinite(entry.expiresAt)
      || !Number.isSafeInteger(entry.sizeBytes)
      || entry.sizeBytes < 0
    ) {
      throw new TypeError("MemoryCacheStore.set() received an invalid CacheEntry.");
    }
    this.#remove(key);
    const stored = { ...entry, response: entry.response.clone() };
    this.#entries.set(key, stored);
    this.#retainedBytes += stored.sizeBytes;
    while (this.#entries.size > this.maxEntries || this.#retainedBytes > this.maxBytes) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#remove(oldest);
    }
  }

  delete(key: string): void {
    this.#remove(key);
  }

  clear(): void {
    this.#entries.clear();
    this.#retainedBytes = 0;
  }
}
