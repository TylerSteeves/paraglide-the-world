import {
  canonicalJson,
  deepFreeze,
  fingerprintSnapshot,
  hasValidSnapshotFingerprint,
  queryCacheKey,
} from "./canonical.js";
import type {
  ProviderResult,
  WorldDataQuery,
  WorldDataSnapshot,
} from "./contracts.js";
import type { ProviderContext, WorldDataProvider } from "./provider.js";
import { assertWorldDataSnapshot } from "./validation.js";

export interface CaptureEntry {
  readonly key: string;
  readonly query: WorldDataQuery;
  readonly snapshot: WorldDataSnapshot;
}

export interface CaptureLog {
  readonly format: "wilder-world-data-capture-v1";
  readonly createdAt: string;
  readonly entries: readonly CaptureEntry[];
}

export interface CaptureRecorderOptions {
  readonly clock?: () => Date;
}

export class CaptureRecorder {
  private readonly entries = new Map<string, CaptureEntry>();
  private readonly clock: () => Date;

  constructor(options: CaptureRecorderOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  record(query: WorldDataQuery, snapshot: WorldDataSnapshot): void {
    if (!hasValidSnapshotFingerprint(snapshot)) throw new TypeError("Cannot capture a snapshot with an invalid fingerprint");
    const key = queryCacheKey(query);
    this.entries.set(key, { key, query, snapshot });
  }

  toLog(): CaptureLog {
    return deepFreeze({
      format: "wilder-world-data-capture-v1" as const,
      createdAt: this.clock().toISOString(),
      entries: [...this.entries.values()].sort((a, b) => a.key.localeCompare(b.key)),
    });
  }

  serialize(): string {
    return canonicalJson(this.toLog());
  }
}

export function parseCaptureLog(serialized: string): CaptureLog {
  const parsed: unknown = JSON.parse(serialized);
  if (!parsed || typeof parsed !== "object" || (parsed as { format?: unknown }).format !== "wilder-world-data-capture-v1") {
    throw new TypeError("Unsupported world data capture format");
  }
  const entries = (parsed as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) throw new TypeError("Capture log entries must be an array");
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") throw new TypeError("Invalid capture entry");
    const snapshot = (entry as { snapshot?: unknown }).snapshot;
    assertWorldDataSnapshot(snapshot);
    if (!hasValidSnapshotFingerprint(snapshot)) throw new TypeError("Capture snapshot fingerprint mismatch");
  }
  return deepFreeze(parsed as CaptureLog);
}

function asReplaySnapshot(snapshot: WorldDataSnapshot): WorldDataSnapshot {
  const { id: _id, deterministicFingerprint: _fingerprint, ...captured } = snapshot;
  const base: Omit<WorldDataSnapshot, "id" | "deterministicFingerprint"> = {
    ...captured,
    delivery: {
      ...captured.delivery,
      mode: "replay",
      resolvedAt: captured.capturedAt,
      ageSeconds: 0,
    },
  };
  const fingerprint = fingerprintSnapshot(base);
  return deepFreeze({
    ...base,
    id: `wds_${fingerprint}`,
    deterministicFingerprint: fingerprint,
  });
}

export class ReplayProvider implements WorldDataProvider {
  readonly id = "replay";
  readonly domains = ["terrain", "atmosphere", "marine"] as const;
  private readonly entries: ReadonlyMap<string, CaptureEntry>;

  constructor(log: CaptureLog) {
    for (const entry of log.entries) {
      assertWorldDataSnapshot(entry.snapshot);
      if (!hasValidSnapshotFingerprint(entry.snapshot)) throw new TypeError("Replay snapshot fingerprint mismatch");
    }
    this.entries = new Map(log.entries.map((entry) => [entry.key, entry]));
  }

  async fetch(query: WorldDataQuery, _context: ProviderContext): Promise<ProviderResult | null> {
    const entry = this.entries.get(queryCacheKey(query));
    if (!entry) return null;
    const replaySnapshot = asReplaySnapshot(entry.snapshot);
    return {
      domains: replaySnapshot.domains,
      sources: replaySnapshot.sources,
      replaySnapshot,
    };
  }
}
