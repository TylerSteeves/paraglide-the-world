import { describe, expect, it, vi } from "vitest";
import {
  AuthoredProvider,
  CaptureRecorder,
  MemorySnapshotCache,
  OpenMeteoProvider,
  ReplayProvider,
  WebStorageSnapshotCache,
  createWorldDataEngine,
  hasValidSnapshotFingerprint,
  latestLocationCacheKey,
  queryCacheKey,
  parseCaptureLog,
  type AtmosphereData,
  type FetchLike,
  type ProviderResult,
  type WorldDataProvider,
  type WorldDataQuery,
} from "../src/index.js";

const BASE_QUERY: WorldDataQuery = {
  location: { latitudeDeg: 43.65, longitudeDeg: -79.38 },
  at: "2026-08-25T01:16:00.000Z",
  domains: ["atmosphere", "marine", "terrain"],
};

function response(json: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => json });
}

describe("OpenMeteoProvider", () => {
  it("normalizes SI units, preserves missing marine values, and carries warnings", async () => {
    const fetchMock: FetchLike = vi.fn((input: string) => {
      if (input.includes("/elevation")) return response({ elevation: [1485] });
      if (input.includes("marine-api")) {
        return response({
          current: {
            time: "2026-08-25T01:15",
            interval: 900,
            wave_height: 0.28,
            wave_direction: 240,
            wave_period: 2.7,
            sea_surface_temperature: null,
            ocean_current_velocity: null,
            ocean_current_direction: null,
            sea_level_height_msl: null,
          },
        });
      }
      return response({
        elevation: 943,
        current: {
          time: "2026-08-25T01:15",
          interval: 900,
          temperature_2m: 14.9,
          relative_humidity_2m: 94,
          surface_pressure: 907,
          wind_speed_10m: 0.36,
          wind_direction_10m: 56,
          wind_gusts_10m: 1,
          precipitation: 0.6,
          cloud_cover: 100,
        },
      });
    });
    const provider = new OpenMeteoProvider({ fetch: fetchMock });
    const result = await provider.fetch(BASE_QUERY, { requestedAt: "2026-08-25T01:16:00.000Z" });

    expect(result?.domains.atmosphere?.data.temperatureK).toBeCloseTo(288.05);
    expect(result?.domains.atmosphere?.data.pressurePa).toBe(90_700);
    expect(result?.domains.atmosphere?.time.nature).toBe("forecast");
    expect(result?.domains.terrain?.data.elevationMslM).toBe(1485);
    expect(result?.domains.marine?.data.currentSpeedMps).toBeNull();
    expect(result?.domains.marine?.data.significantWaveHeightM).toBe(0.28);
    expect(result?.domains.marine?.quality.flags).toContain("not-for-navigation");
    expect(result?.sources.find((source) => source.dataset.includes("Marine"))?.warnings[0]).toContain(
      "not suitable for navigation",
    );
  });
});

function atmosphereResult(requestedAt: string, expiresAt: string): ProviderResult {
  const data: AtmosphereData = {
    windDirectionFromDeg: 270,
    windSpeedMps: 5,
    windGustMps: 7,
    turbulence01: null,
    temperatureK: 290,
    pressurePa: 101_000,
    relativeHumidity01: 0.5,
    precipitationRateMmPerHour: 0,
    cloudCover01: 0.2,
  };
  return {
    domains: {
      atmosphere: {
        data,
        time: {
          requestedAt,
          issuedAt: null,
          observedAt: null,
          validFrom: requestedAt,
          validUntil: expiresAt,
          expiresAt,
          nature: "forecast",
          contributingNatures: ["forecast"],
        },
        sourceIds: ["fake:weather"],
        quality: {
          confidence01: 0.8,
          completeness01: 8 / 9,
          freshness: "live",
          flags: ["missing-field"],
          spatialResolutionM: null,
          temporalResolutionSeconds: 900,
        },
      },
    },
    sources: [
      {
        id: "fake:weather",
        provider: "Fake",
        dataset: "Test weather",
        sourceUrl: "https://example.test/weather",
        attribution: "Test data",
        license: { name: "Test", url: "https://example.test/license", requiresAttribution: true },
        retrievedAt: requestedAt,
        modelRunOrVersion: null,
        warnings: [],
      },
    ],
  };
}

describe("engine cache and fallback", () => {
  it("uses an order-insensitive domain cache key", () => {
    expect(queryCacheKey({ ...BASE_QUERY, domains: ["marine", "atmosphere"] })).toBe(
      queryCacheKey({ ...BASE_QUERY, domains: ["atmosphere", "marine"] }),
    );
  });

  it("reuses a 15-minute bucket while retaining the exact new query instant", async () => {
    const provider: WorldDataProvider = {
      id: "fake",
      domains: ["atmosphere"],
      fetch: vi.fn(async (_query, context) => atmosphereResult(context.requestedAt, "2026-08-25T02:00:00.000Z")),
    };
    const engine = createWorldDataEngine({
      providers: [provider],
      clock: () => new Date("2026-08-25T01:16:00.000Z"),
    });
    const firstQuery = { ...BASE_QUERY, domains: ["atmosphere"] as const };
    const secondQuery = { ...firstQuery, at: "2026-08-25T01:22:00.000Z" };
    await engine.getSnapshot(firstQuery);
    const second = await engine.getSnapshot(secondQuery);

    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect(second.delivery.mode).toBe("fresh-cache");
    expect(second.query.at).toBe(secondQuery.at);
  });

  it("labels cached-only provider failure as stale, never live", async () => {
    let now = new Date("2026-08-25T01:16:00.000Z");
    let fail = false;
    const provider: WorldDataProvider = {
      id: "flaky",
      domains: ["atmosphere"],
      fetch: vi.fn(async (_query, context) => {
        if (fail) throw new Error("offline");
        return atmosphereResult(context.requestedAt, "2026-08-25T01:16:01.000Z");
      }),
    };
    const engine = createWorldDataEngine({ providers: [provider], cache: new MemorySnapshotCache(), clock: () => now });
    const query = { ...BASE_QUERY, domains: ["atmosphere"] as const };
    await engine.getSnapshot(query);
    fail = true;
    now = new Date("2026-08-25T01:17:00.000Z");
    const stale = await engine.getSnapshot(query, { forceRefresh: true });

    expect(stale.delivery.mode).toBe("stale-cache");
    expect(stale.quality.flags).toContain("stale-data");
  });

  it("falls back to last-known-good live data across cache buckets", async () => {
    let now = new Date("2026-08-25T01:16:00.000Z");
    let fail = false;
    const provider: WorldDataProvider = {
      id: "flaky-cross-bucket",
      domains: ["atmosphere"],
      fetch: async (_query, context) => {
        if (fail) throw new Error("offline");
        return atmosphereResult(context.requestedAt, "2026-08-25T01:20:00.000Z");
      },
    };
    const engine = createWorldDataEngine({ providers: [provider], cache: new MemorySnapshotCache(), clock: () => now });
    await engine.getSnapshot({ ...BASE_QUERY, at: now.toISOString(), domains: ["atmosphere"] });
    fail = true;
    now = new Date("2026-08-25T01:31:00.000Z");
    const fallback = await engine.getSnapshot(
      { ...BASE_QUERY, at: now.toISOString(), domains: ["atmosphere"] },
      { forceRefresh: true },
    );

    expect(fallback.delivery.mode).toBe("stale-cache");
    expect(fallback.domains.atmosphere?.data.windSpeedMps).toBe(5);
  });

  it("fills missing fields from authored data and records both data natures", async () => {
    const live: WorldDataProvider = {
      id: "live",
      domains: ["atmosphere"],
      fetch: async (_query, context) => atmosphereResult(context.requestedAt, "2026-08-25T02:00:00.000Z"),
    };
    const authored = new AuthoredProvider({
      records: [
        {
          id: "toronto-harbour",
          location: BASE_QUERY.location,
          attribution: "Wilder Future scenario",
          atmosphere: {
            ...atmosphereResult(BASE_QUERY.at, BASE_QUERY.at).domains.atmosphere!.data,
            turbulence01: 0.3,
          },
        },
      ],
    });
    const engine = createWorldDataEngine({
      providers: [live, authored],
      clock: () => new Date("2026-08-25T01:16:00.000Z"),
    });
    const snapshot = await engine.getSnapshot({ ...BASE_QUERY, domains: ["atmosphere"] });

    expect(snapshot.domains.atmosphere?.data.turbulence01).toBe(0.3);
    expect(snapshot.domains.atmosphere?.time.contributingNatures).toEqual(["forecast", "authored"]);
    expect(snapshot.delivery.mode).toBe("authored-fallback");
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("keeps last-live values primary when live fails and authored fallback survives", async () => {
    let now = new Date("2026-08-25T01:16:00.000Z");
    let fail = false;
    const cache = new MemorySnapshotCache();
    const live: WorldDataProvider = {
      id: "flaky-live",
      domains: ["atmosphere"],
      fetch: async (_query, context) => {
        if (fail) throw new Error("offline");
        return atmosphereResult(context.requestedAt, "2026-08-25T01:20:00.000Z");
      },
    };
    const authored = new AuthoredProvider({
      records: [
        {
          id: "authored-weather",
          location: BASE_QUERY.location,
          attribution: "Test fallback",
          atmosphere: {
            ...atmosphereResult(BASE_QUERY.at, BASE_QUERY.at).domains.atmosphere!.data,
            windSpeedMps: 99,
            turbulence01: 0.3,
          },
        },
      ],
    });
    const engine = createWorldDataEngine({ providers: [live, authored], cache, clock: () => now });
    const firstQuery = { ...BASE_QUERY, at: now.toISOString(), domains: ["atmosphere"] as const };
    const first = await engine.getSnapshot(firstQuery);
    const firstAlias = await cache.get(latestLocationCacheKey(firstQuery));
    expect(first.domains.atmosphere?.data.windSpeedMps).toBe(5);

    fail = true;
    now = new Date("2026-08-25T01:31:00.000Z");
    const fallback = await engine.getSnapshot(
      { ...firstQuery, at: now.toISOString() },
      { forceRefresh: true },
    );
    const aliasAfterFallback = await cache.get(latestLocationCacheKey(firstQuery));

    expect(fallback.domains.atmosphere?.data.windSpeedMps).toBe(5);
    expect(fallback.delivery.mode).toBe("stale-cache-with-authored-fallback");
    expect(aliasAfterFallback?.deterministicFingerprint).toBe(firstAlias?.deterministicFingerprint);
  });
});

describe("persistent browser cache", () => {
  it("round-trips and freezes a fingerprint-validated snapshot", async () => {
    const values = new Map<string, string>();
    const cache = new WebStorageSnapshotCache({
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      },
    });
    const provider: WorldDataProvider = {
      id: "cache-source",
      domains: ["atmosphere"],
      fetch: async (_query, context) => atmosphereResult(context.requestedAt, "2026-08-25T02:00:00.000Z"),
    };
    const query = { ...BASE_QUERY, domains: ["atmosphere"] as const };
    const snapshot = await createWorldDataEngine({
      providers: [provider],
      clock: () => new Date("2026-08-25T01:16:00.000Z"),
    }).getSnapshot(query);
    await cache.set("snapshot", snapshot);
    const restored = await cache.get("snapshot");

    expect(restored).toEqual(snapshot);
    expect(Object.isFrozen(restored)).toBe(true);
  });
});

describe("deterministic capture and replay", () => {
  it("serializes canonically and replays an identical snapshot on every call", async () => {
    const provider: WorldDataProvider = {
      id: "fake",
      domains: ["atmosphere"],
      fetch: async (_query, context) => atmosphereResult(context.requestedAt, "2026-08-25T02:00:00.000Z"),
    };
    const recorder = new CaptureRecorder({ clock: () => new Date("2026-08-25T01:16:01.000Z") });
    const query = { ...BASE_QUERY, domains: ["atmosphere"] as const };
    const live = createWorldDataEngine({ providers: [provider], clock: () => new Date("2026-08-25T01:16:00.000Z") });
    await live.getSnapshot(query, { capture: recorder });
    const serialized = recorder.serialize();
    const replay = createWorldDataEngine({ providers: [new ReplayProvider(parseCaptureLog(serialized))] });
    const first = await replay.getSnapshot(query);
    const second = await replay.getSnapshot(query, { forceRefresh: true });

    expect(first).toEqual(second);
    expect(first.delivery.mode).toBe("replay");
    expect(hasValidSnapshotFingerprint(first)).toBe(true);
  });
});
