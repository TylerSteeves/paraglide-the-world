import type { WorldDataSnapshot } from "./contracts.js";
import { deepFreeze, hasValidSnapshotFingerprint } from "./canonical.js";
import { assertWorldDataSnapshot } from "./validation.js";

export interface SnapshotCache {
  get(key: string): Promise<WorldDataSnapshot | null>;
  set(key: string, snapshot: WorldDataSnapshot): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemorySnapshotCache implements SnapshotCache {
  private readonly entries = new Map<string, WorldDataSnapshot>();

  async get(key: string): Promise<WorldDataSnapshot | null> {
    return this.entries.get(key) ?? null;
  }

  async set(key: string, snapshot: WorldDataSnapshot): Promise<void> {
    this.entries.set(key, snapshot);
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WebStorageSnapshotCacheOptions {
  readonly storage?: StorageLike;
  readonly prefix?: string;
}

/** Persistent browser cache for last-known-good snapshots across reloads. */
export class WebStorageSnapshotCache implements SnapshotCache {
  private readonly storage: StorageLike;
  private readonly prefix: string;

  constructor(options: WebStorageSnapshotCacheOptions = {}) {
    const storage = options.storage ?? globalThis.localStorage;
    if (!storage) throw new Error("WebStorageSnapshotCache requires a Storage implementation");
    this.storage = storage;
    this.prefix = options.prefix ?? "wilder-world-data:";
  }

  async get(key: string): Promise<WorldDataSnapshot | null> {
    const storageKey = this.prefix + key;
    const serialized = this.storage.getItem(storageKey);
    if (!serialized) return null;
    try {
      const parsed: unknown = JSON.parse(serialized);
      assertWorldDataSnapshot(parsed);
      if (!hasValidSnapshotFingerprint(parsed)) throw new TypeError("Cached snapshot fingerprint mismatch");
      return deepFreeze(parsed);
    } catch {
      this.storage.removeItem(storageKey);
      return null;
    }
  }

  async set(key: string, snapshot: WorldDataSnapshot): Promise<void> {
    if (!hasValidSnapshotFingerprint(snapshot)) throw new TypeError("Cannot cache snapshot with invalid fingerprint");
    this.storage.setItem(this.prefix + key, JSON.stringify(snapshot));
  }

  async delete(key: string): Promise<void> {
    this.storage.removeItem(this.prefix + key);
  }
}
