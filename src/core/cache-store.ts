import { HttpConfigurationError } from "./errors.js";

export interface CacheEntry {
  readonly response: Response;
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

  constructor(
    readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new HttpConfigurationError("MemoryCacheStore maxEntries must be a positive safe integer.");
    }
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return { ...entry, response: entry.response.clone() };
  }

  set(key: string, entry: CacheEntry): void {
    this.#entries.delete(key);
    this.#entries.set(key, { ...entry, response: entry.response.clone() });
    while (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }
}
