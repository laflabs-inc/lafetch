import type { CacheStore } from "../core/cache-store.js";

interface GenerationRecord {
  current: object;
  active: number;
}

export interface CacheGenerationRegistration {
  readonly key: string;
  isCurrent(): boolean;
  release(): void;
}

const storeRecords = new WeakMap<CacheStore, Map<string, GenerationRecord>>();

export function acquireCacheGeneration(
  store: CacheStore,
  key: string,
  invalidate: boolean,
): CacheGenerationRegistration {
  let records = storeRecords.get(store);
  if (records === undefined) {
    records = new Map();
    storeRecords.set(store, records);
  }
  let record = records.get(key);
  if (record === undefined) {
    record = { current: {}, active: 0 };
    records.set(key, record);
  }
  if (invalidate) record.current = {};
  const generation = record.current;
  record.active += 1;
  let released = false;

  return {
    key,
    isCurrent: () => record!.current === generation,
    release() {
      if (released) return;
      released = true;
      record!.active -= 1;
      if (record!.active === 0) records!.delete(key);
    },
  };
}
