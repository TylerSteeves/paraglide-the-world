import type { WorldDataQuery, WorldDataSnapshot } from "./contracts.js";

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function normalizeJson(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("World data cannot contain non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (typeof value === "object") {
    const output: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) output[key] = normalizeJson(child);
    }
    return output;
  }
  throw new TypeError(`Unsupported value in world data: ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

/** FNV-1a 64-bit: deterministic content identity, not a security primitive. */
export function deterministicFingerprint(value: unknown): string {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function queryCacheKey(query: WorldDataQuery, timeBucketSeconds = 900): string {
  if (!Number.isFinite(timeBucketSeconds) || timeBucketSeconds <= 0) {
    throw new RangeError("timeBucketSeconds must be positive");
  }
  const bucketMs = timeBucketSeconds * 1_000;
  const bucketedAt = new Date(Math.floor(Date.parse(query.at) / bucketMs) * bucketMs).toISOString();
  return `world-data:${deterministicFingerprint({
    ...query,
    at: bucketedAt,
    domains: [...query.domains].sort(),
  })}`;
}

/** Alias for last-known-good live fallback across time-bucket boundaries. */
export function latestLocationCacheKey(query: WorldDataQuery): string {
  return `world-data-latest:${deterministicFingerprint({
    location: query.location,
    domains: [...query.domains].sort(),
  })}`;
}

export function fingerprintSnapshot(
  snapshot: Omit<WorldDataSnapshot, "id" | "deterministicFingerprint">,
): string {
  return deterministicFingerprint(snapshot);
}

export function hasValidSnapshotFingerprint(snapshot: WorldDataSnapshot): boolean {
  const { id: _id, deterministicFingerprint: _fingerprint, ...base } = snapshot;
  const expected = fingerprintSnapshot(base);
  return snapshot.deterministicFingerprint === expected && snapshot.id === `wds_${expected}`;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
