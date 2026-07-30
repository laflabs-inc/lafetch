import type { CacheStore } from "../core/cache-store.js";

interface GenerationRecord {
  current: object;
  active: number;
  tail: Promise<void>;
}

export interface CacheGenerationRegistration {
  readonly key: string;
  commit(operation: () => void | Promise<void>): Promise<void>;
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
    record = { current: {}, active: 0, tail: Promise.resolve() };
    records.set(key, record);
  }
  if (invalidate) record.current = {};
  const generation = record.current;
  record.active += 1;
  let released = false;

  return {
    key,
    commit(operation) {
      const committed = record!.tail.then(async () => {
        if (record!.current !== generation) return;
        await operation();
      });
      record!.tail = committed.catch(() => {});
      return committed;
    },
    release() {
      if (released) return;
      released = true;
      record!.active -= 1;
      if (record!.active === 0) records!.delete(key);
    },
  };
}
