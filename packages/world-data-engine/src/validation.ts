import {
  WORLD_DATA_SCHEMA_VERSION,
  type WorldDataDomain,
  type WorldDataQuery,
  type WorldDataSnapshot,
} from "./contracts.js";

const DOMAINS = new Set<WorldDataDomain>(["terrain", "atmosphere", "marine"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function assertWorldDataQuery(query: WorldDataQuery): void {
  const { latitudeDeg, longitudeDeg, elevationMslM } = query.location;
  if (!Number.isFinite(latitudeDeg) || latitudeDeg < -90 || latitudeDeg > 90) {
    throw new RangeError("latitudeDeg must be between -90 and 90");
  }
  if (!Number.isFinite(longitudeDeg) || longitudeDeg < -180 || longitudeDeg > 180) {
    throw new RangeError("longitudeDeg must be between -180 and 180");
  }
  if (elevationMslM !== undefined && !Number.isFinite(elevationMslM)) {
    throw new RangeError("elevationMslM must be finite when supplied");
  }
  if (!isIsoInstant(query.at)) throw new TypeError("query.at must be an ISO-8601 instant");
  if (query.domains.length === 0) throw new RangeError("At least one domain is required");
  if (new Set(query.domains).size !== query.domains.length || query.domains.some((d) => !DOMAINS.has(d))) {
    throw new RangeError("query.domains must contain unique supported domains");
  }
}

export function isWorldDataSnapshot(value: unknown): value is WorldDataSnapshot {
  if (!isRecord(value) || value.schemaVersion !== WORLD_DATA_SCHEMA_VERSION) return false;
  if (typeof value.id !== "string" || typeof value.deterministicFingerprint !== "string") return false;
  if (!isIsoInstant(value.capturedAt) || !isRecord(value.query) || !isRecord(value.domains)) return false;
  if (!Array.isArray(value.sources) || !isRecord(value.quality) || !isRecord(value.delivery)) return false;
  if (!isRecord(value.units)) return false;
  try {
    assertWorldDataQuery(value.query as unknown as WorldDataQuery);
    return true;
  } catch {
    return false;
  }
}

export function assertWorldDataSnapshot(value: unknown): asserts value is WorldDataSnapshot {
  if (!isWorldDataSnapshot(value)) throw new TypeError("Value is not a WorldDataSnapshot v1");
}
