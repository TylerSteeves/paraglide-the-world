export const WORLD_DATA_SCHEMA_VERSION = "1.0.0" as const;

export type Iso8601 = string;
export type WorldDataDomain = "terrain" | "atmosphere" | "marine";
export type DataNature = "observed" | "forecast" | "reference" | "authored";
export type Freshness = "live" | "fresh" | "stale" | "expired" | "authored";
export type DeliveryMode =
  | "live"
  | "live-with-stale-fallback"
  | "fresh-cache-with-authored-fallback"
  | "stale-cache-with-authored-fallback"
  | "fresh-cache"
  | "stale-cache"
  | "replay"
  | "authored-fallback";

export interface GeoPoint {
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly elevationMslM?: number;
}

export interface WorldDataQuery {
  /** Geographic point in WGS84. */
  readonly location: GeoPoint;
  /** Simulation instant to resolve, expressed in UTC ISO-8601. */
  readonly at: Iso8601;
  readonly domains: readonly WorldDataDomain[];
}

export interface LicenseMetadata {
  readonly name: string;
  readonly url: string;
  readonly requiresAttribution: boolean;
}

export interface SourceProvenance {
  /** Stable identifier referenced by domain snapshots. */
  readonly id: string;
  readonly provider: string;
  readonly dataset: string;
  readonly sourceUrl: string;
  readonly attribution: string;
  readonly license: LicenseMetadata;
  readonly retrievedAt: Iso8601;
  readonly modelRunOrVersion: string | null;
  /** Limitations that must travel with data into product surfaces. */
  readonly warnings: readonly string[];
}

export type QualityFlag =
  | "coarse-spatial-resolution"
  | "coastal-accuracy-limited"
  | "estimated"
  | "interpolated"
  | "missing-domain"
  | "missing-field"
  | "not-for-navigation"
  | "outside-provider-range"
  | "provider-error"
  | "stale-data";

export interface QualityMetadata {
  readonly confidence01: number;
  readonly completeness01: number;
  readonly freshness: Freshness;
  readonly flags: readonly QualityFlag[];
  readonly spatialResolutionM: number | null;
  readonly temporalResolutionSeconds: number | null;
}

export interface DomainTimeMetadata {
  readonly requestedAt: Iso8601;
  readonly issuedAt: Iso8601 | null;
  readonly observedAt: Iso8601 | null;
  readonly validFrom: Iso8601;
  readonly validUntil: Iso8601;
  readonly expiresAt: Iso8601;
  /** Primary/highest-priority classification for backwards-simple consumers. */
  readonly nature: DataNature;
  /** All classifications present when providers fill different fields. */
  readonly contributingNatures: readonly DataNature[];
}

export interface TerrainData {
  readonly elevationMslM: number | null;
  readonly slopeDeg: number | null;
  readonly aspectDeg: number | null;
  readonly landCover: string | null;
  readonly thermalPotential01: number | null;
}

export interface AtmosphereData {
  /** Meteorological convention: direction wind originates from. */
  readonly windDirectionFromDeg: number;
  readonly windSpeedMps: number;
  readonly windGustMps: number | null;
  readonly turbulence01: number | null;
  readonly temperatureK: number | null;
  readonly pressurePa: number | null;
  readonly relativeHumidity01: number | null;
  readonly precipitationRateMmPerHour: number | null;
  readonly cloudCover01: number | null;
}

export type TidePhase = "rising" | "high" | "falling" | "low" | "unknown";

export interface MarineData {
  /** Direction the water is travelling toward. */
  readonly currentDirectionToDeg: number | null;
  readonly currentSpeedMps: number | null;
  readonly waterLevelMslM: number | null;
  readonly tideHeightM: number | null;
  readonly tidePhase: TidePhase | null;
  /** Meteorological convention: direction waves originate from. */
  readonly waveDirectionFromDeg: number | null;
  readonly significantWaveHeightM: number | null;
  readonly meanWavePeriodS: number | null;
  readonly wavePeakPeriodS: number | null;
  readonly seaSurfaceTemperatureK: number | null;
  readonly bathymetryDepthM: number | null;
}

export interface DomainSnapshot<TData> {
  readonly data: TData;
  readonly time: DomainTimeMetadata;
  readonly sourceIds: readonly string[];
  readonly quality: QualityMetadata;
}

export interface WorldDataDomains {
  readonly terrain?: DomainSnapshot<TerrainData>;
  readonly atmosphere?: DomainSnapshot<AtmosphereData>;
  readonly marine?: DomainSnapshot<MarineData>;
}

/** Explicit canonical units, included on every serialized snapshot. */
export interface WorldDataUnits {
  readonly angle: "degree";
  readonly distance: "metre";
  readonly speed: "metre-per-second";
  readonly temperature: "kelvin";
  readonly pressure: "pascal";
  readonly ratio: "unit-interval";
  readonly precipitationRate: "millimetre-per-hour";
  readonly time: "second";
}

export const WORLD_DATA_UNITS: WorldDataUnits = Object.freeze({
  angle: "degree",
  distance: "metre",
  speed: "metre-per-second",
  temperature: "kelvin",
  pressure: "pascal",
  ratio: "unit-interval",
  precipitationRate: "millimetre-per-hour",
  time: "second",
});

export interface SnapshotQuality {
  readonly confidence01: number;
  readonly missingDomains: readonly WorldDataDomain[];
  readonly flags: readonly QualityFlag[];
}

export interface SnapshotDelivery {
  readonly mode: DeliveryMode;
  readonly resolvedAt: Iso8601;
  readonly ageSeconds: number;
  readonly cacheKey: string;
}

export interface WorldDataSnapshot {
  readonly schemaVersion: typeof WORLD_DATA_SCHEMA_VERSION;
  readonly id: string;
  readonly query: WorldDataQuery;
  readonly capturedAt: Iso8601;
  readonly domains: WorldDataDomains;
  readonly sources: readonly SourceProvenance[];
  readonly units: WorldDataUnits;
  readonly quality: SnapshotQuality;
  readonly delivery: SnapshotDelivery;
  /** Stable fingerprint of the snapshot content (excluding id/fingerprint). */
  readonly deterministicFingerprint: string;
}

export interface ProviderResult {
  readonly domains: WorldDataDomains;
  readonly sources: readonly SourceProvenance[];
  /** True when authored data supplied at least one requested domain. */
  readonly authoredFallback?: boolean;
  /** Capture/replay providers may return a complete pre-fingerprinted snapshot. */
  readonly replaySnapshot?: WorldDataSnapshot;
}
