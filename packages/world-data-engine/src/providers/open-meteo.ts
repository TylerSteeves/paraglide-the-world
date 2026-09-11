import { deterministicFingerprint } from "../canonical.js";
import type {
  AtmosphereData,
  DomainSnapshot,
  MarineData,
  ProviderResult,
  QualityFlag,
  QualityMetadata,
  SourceProvenance,
  TerrainData,
  WorldDataQuery,
} from "../contracts.js";
import {
  ProviderError,
  type FetchLike,
  type ProviderContext,
  type WorldDataProvider,
} from "../provider.js";

const OPEN_METEO_LICENSE = {
  name: "CC BY 4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
  requiresAttribution: true,
} as const;

const MARINE_WARNING =
  "Coastal tide and current accuracy is limited; this data is not suitable for navigation and does not replace nautical publications.";

type JsonRecord = Record<string, unknown>;

export interface OpenMeteoProviderOptions {
  readonly fetch?: FetchLike;
  readonly requestTimeoutMs?: number;
  readonly forecastTtlSeconds?: number;
  readonly weatherBaseUrl?: string;
  readonly marineBaseUrl?: string;
  readonly elevationBaseUrl?: string;
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function utcInstant(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(`${value}Z`))) return fallback;
  return /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? new Date(value).toISOString() : new Date(`${value}Z`).toISOString();
}

function addSeconds(instant: string, seconds: number): string {
  return new Date(Date.parse(instant) + seconds * 1_000).toISOString();
}

function dataCompleteness(data: object): number {
  const values = Object.values(data);
  return values.filter((value) => value !== null && value !== undefined).length / Math.max(1, values.length);
}

function quality(
  data: object,
  confidence01: number,
  flags: readonly QualityFlag[],
  spatialResolutionM: number | null,
  temporalResolutionSeconds: number | null,
): QualityMetadata {
  const completeness01 = dataCompleteness(data);
  return {
    confidence01,
    completeness01,
    freshness: "live",
    flags: [...flags, ...(completeness01 < 1 ? (["missing-field"] as const) : [])],
    spatialResolutionM,
    temporalResolutionSeconds,
  };
}

function timeMetadata(
  query: WorldDataQuery,
  context: ProviderContext,
  current: JsonRecord,
  ttlSeconds: number,
) {
  const validFrom = utcInstant(current.time, context.requestedAt);
  const interval = finite(current.interval) ?? 900;
  return {
    requestedAt: query.at,
    issuedAt: null,
    observedAt: null,
    validFrom,
    validUntil: addSeconds(validFrom, interval),
    expiresAt: addSeconds(context.requestedAt, ttlSeconds),
    nature: "forecast" as const,
    contributingNatures: ["forecast" as const],
  };
}

function source(
  provider: string,
  dataset: string,
  sourceUrl: string,
  retrievedAt: string,
  attribution: string,
  warnings: readonly string[],
): SourceProvenance {
  return {
    id: `open-meteo:${deterministicFingerprint({ dataset, sourceUrl, retrievedAt })}`,
    provider,
    dataset,
    sourceUrl,
    attribution,
    license: OPEN_METEO_LICENSE,
    retrievedAt,
    modelRunOrVersion: null,
    warnings,
  };
}

function requiredFetch(): FetchLike {
  if (typeof globalThis.fetch !== "function") {
    throw new Error("OpenMeteoProvider requires a fetch implementation");
  }
  return globalThis.fetch.bind(globalThis) as FetchLike;
}

export class OpenMeteoProvider implements WorldDataProvider {
  readonly id = "open-meteo";
  readonly domains = ["terrain", "atmosphere", "marine"] as const;
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs: number;
  private readonly forecastTtlSeconds: number;
  private readonly weatherBaseUrl: string;
  private readonly marineBaseUrl: string;
  private readonly elevationBaseUrl: string;

  constructor(options: OpenMeteoProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? requiredFetch();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 8_000;
    this.forecastTtlSeconds = options.forecastTtlSeconds ?? 3_600;
    this.weatherBaseUrl = options.weatherBaseUrl ?? "https://api.open-meteo.com/v1/forecast";
    this.marineBaseUrl = options.marineBaseUrl ?? "https://marine-api.open-meteo.com/v1/marine";
    this.elevationBaseUrl = options.elevationBaseUrl ?? "https://api.open-meteo.com/v1/elevation";
  }

  private async fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error("Open-Meteo request timed out")), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw new ProviderError(this.id, `HTTP ${response.status} for ${url}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }

  private baseUrl(url: string, query: WorldDataQuery): URL {
    const output = new URL(url);
    output.searchParams.set("latitude", String(query.location.latitudeDeg));
    output.searchParams.set("longitude", String(query.location.longitudeDeg));
    return output;
  }

  async fetch(query: WorldDataQuery, context: ProviderContext): Promise<ProviderResult | null> {
    const requests: Array<Promise<{ kind: "weather" | "marine" | "terrain"; url: string; json: unknown }>> = [];
    if (query.domains.includes("atmosphere")) {
      const url = this.baseUrl(this.weatherBaseUrl, query);
      url.searchParams.set(
        "current",
        "temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,cloud_cover",
      );
      url.searchParams.set("wind_speed_unit", "ms");
      url.searchParams.set("timezone", "UTC");
      url.searchParams.set("forecast_days", "1");
      requests.push(this.fetchJson(url.toString(), context.signal).then((json) => ({ kind: "weather", url: url.toString(), json })));
    }
    if (query.domains.includes("marine")) {
      const url = this.baseUrl(this.marineBaseUrl, query);
      url.searchParams.set(
        "current",
        "wave_height,wave_direction,wave_period,sea_surface_temperature,ocean_current_velocity,ocean_current_direction,sea_level_height_msl",
      );
      url.searchParams.set("wind_speed_unit", "ms");
      url.searchParams.set("timezone", "UTC");
      url.searchParams.set("forecast_days", "1");
      requests.push(this.fetchJson(url.toString(), context.signal).then((json) => ({ kind: "marine", url: url.toString(), json })));
    }
    if (query.domains.includes("terrain")) {
      const url = this.baseUrl(this.elevationBaseUrl, query);
      requests.push(this.fetchJson(url.toString(), context.signal).then((json) => ({ kind: "terrain", url: url.toString(), json })));
    }

    const settled = await Promise.allSettled(requests);
    if (context.signal?.aborted) throw context.signal.reason ?? new DOMException("Aborted", "AbortError");
    const successes = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    if (successes.length === 0) {
      const cause = settled.find((result) => result.status === "rejected");
      throw new ProviderError(this.id, "All requested Open-Meteo endpoints failed", cause);
    }

    const sources: SourceProvenance[] = [];
    let terrain: DomainSnapshot<TerrainData> | undefined;
    let atmosphere: DomainSnapshot<AtmosphereData> | undefined;
    let marine: DomainSnapshot<MarineData> | undefined;

    for (const response of successes) {
      const root = record(response.json);
      if (!root) continue;

      if (response.kind === "weather") {
        const current = record(root.current);
        if (!current) continue;
        const windSpeedMps = finite(current.wind_speed_10m);
        const windDirectionFromDeg = finite(current.wind_direction_10m);
        if (windSpeedMps === null || windDirectionFromDeg === null) continue;
        const windGustMps = finite(current.wind_gusts_10m);
        const temperatureC = finite(current.temperature_2m);
        const pressureHpa = finite(current.surface_pressure);
        const humidityPercent = finite(current.relative_humidity_2m);
        const cloudPercent = finite(current.cloud_cover);
        const precipitationMm = finite(current.precipitation);
        const intervalSeconds = finite(current.interval) ?? 900;
        const data: AtmosphereData = {
          windSpeedMps,
          windDirectionFromDeg,
          windGustMps,
          turbulence01:
            windGustMps === null ? null : clamp01((windGustMps - windSpeedMps) / Math.max(windGustMps, 1)),
          temperatureK: temperatureC === null ? null : temperatureC + 273.15,
          pressurePa: pressureHpa === null ? null : pressureHpa * 100,
          relativeHumidity01: humidityPercent === null ? null : clamp01(humidityPercent / 100),
          precipitationRateMmPerHour:
            precipitationMm === null ? null : precipitationMm * (3_600 / intervalSeconds),
          cloudCover01: cloudPercent === null ? null : clamp01(cloudPercent / 100),
        };
        const provenance = source(
          "Open-Meteo",
          "Best Match Weather Forecast",
          response.url,
          context.requestedAt,
          "Weather data by Open-Meteo",
          ["Current fields are model-derived estimates, not direct weather-station observations."],
        );
        sources.push(provenance);
        atmosphere = {
          data,
          time: timeMetadata(query, context, current, this.forecastTtlSeconds),
          sourceIds: [provenance.id],
          quality: quality(data, 0.78, ["estimated"], null, intervalSeconds),
        };
      }

      if (response.kind === "marine") {
        const current = record(root.current);
        if (!current) continue;
        const temperatureC = finite(current.sea_surface_temperature);
        const data: MarineData = {
          currentSpeedMps: finite(current.ocean_current_velocity),
          currentDirectionToDeg: finite(current.ocean_current_direction),
          waterLevelMslM: finite(current.sea_level_height_msl),
          tideHeightM: null,
          tidePhase: null,
          significantWaveHeightM: finite(current.wave_height),
          waveDirectionFromDeg: finite(current.wave_direction),
          meanWavePeriodS: finite(current.wave_period),
          wavePeakPeriodS: null,
          seaSurfaceTemperatureK: temperatureC === null ? null : temperatureC + 273.15,
          bathymetryDepthM: null,
        };
        const provenance = source(
          "Open-Meteo",
          "Marine Weather API Best Match",
          response.url,
          context.requestedAt,
          "Marine data by Open-Meteo",
          [MARINE_WARNING],
        );
        sources.push(provenance);
        const intervalSeconds = finite(current.interval) ?? 900;
        marine = {
          data,
          time: timeMetadata(query, context, current, this.forecastTtlSeconds),
          sourceIds: [provenance.id],
          quality: quality(
            data,
            0.62,
            ["estimated", "coarse-spatial-resolution", "coastal-accuracy-limited", "not-for-navigation"],
            8_000,
            intervalSeconds,
          ),
        };
      }

      if (response.kind === "terrain") {
        const elevations = Array.isArray(root.elevation) ? root.elevation : [];
        const elevationMslM = finite(elevations[0]);
        if (elevationMslM === null) continue;
        const data: TerrainData = {
          elevationMslM,
          slopeDeg: null,
          aspectDeg: null,
          landCover: null,
          thermalPotential01: null,
        };
        const provenance = source(
          "Open-Meteo",
          "Copernicus DEM GLO-90 (2021)",
          response.url,
          context.requestedAt,
          "Elevation data: Copernicus DEM via Open-Meteo",
          ["Approximately 90 metre grid elevation; not a terrain-clearance or obstacle source."],
        );
        sources.push(provenance);
        terrain = {
          data,
          time: {
            requestedAt: query.at,
            issuedAt: null,
            observedAt: null,
            validFrom: "2021-01-01T00:00:00.000Z",
            validUntil: "9999-12-31T23:59:59.999Z",
            expiresAt: addSeconds(context.requestedAt, 86_400 * 30),
            nature: "reference",
            contributingNatures: ["reference"],
          },
          sourceIds: [provenance.id],
          quality: quality(data, 0.85, ["coarse-spatial-resolution"], 90, null),
        };
      }
    }

    if (!terrain && !atmosphere && !marine) return null;
    return {
      domains: {
        ...(terrain ? { terrain } : {}),
        ...(atmosphere ? { atmosphere } : {}),
        ...(marine ? { marine } : {}),
      },
      sources,
    };
  }
}

export { MARINE_WARNING };
