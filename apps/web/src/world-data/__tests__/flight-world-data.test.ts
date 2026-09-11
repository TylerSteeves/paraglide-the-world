import { describe, expect, it, vi } from 'vitest'
import { getFlightSite } from '../../sim/site-data'
import { resolveFlightWorldData } from '../client'
import { applySnapshotToFlightSite, snapshotToAmbientAir } from '../flight-adapter'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

function weatherResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      latitude: 46.6,
      longitude: 7.9,
      elevation: 943,
      current: {
        time: '2026-08-24T21:15',
        interval: 900,
        temperature_2m: 16,
        wind_speed_10m: 5,
        wind_direction_10m: 45,
        wind_gusts_10m: 8,
      },
    }),
  } as Response
}

function elevationResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ elevation: [943] }),
  } as Response
}

function openMeteoFetcher() {
  return vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/elevation') ? elevationResponse() : weatherResponse(),
  ) as unknown as typeof fetch
}

describe('flight world-data resolution', () => {
  it('maps current model conditions into an immutable, forecast-labeled snapshot', async () => {
    const site = getFlightSite('lauterbrunnen')
    const fetcher = openMeteoFetcher()
    const result = await resolveFlightWorldData(site, {
      fetcher,
      storage: new MemoryStorage(),
      now: () => new Date('2026-08-24T21:16:00.000Z'),
    })

    expect(result.resolution).toBe('provider')
    expect(result.snapshot.domains.atmosphere?.time.nature).toBe('forecast')
    expect(result.snapshot.domains.atmosphere?.data.windSpeedMps).toBe(5)
    expect(result.snapshot.domains.terrain?.data.elevationMslM).toBe(943)
    expect(result.snapshot.query.location.elevationMslM).toBe(1_485)
    expect(applySnapshotToFlightSite(site, result.snapshot).launchAltitudeMeters).toBe(
      1_485,
    )
    expect(Object.isFrozen(result.snapshot)).toBe(true)

    const air = snapshotToAmbientAir(result.snapshot)
    expect(air).toEqual({
      windHeadingDeg: 225,
      windSpeedKmh: 18,
      turbulence: 0.375,
    })
  })

  it('uses the cached immutable snapshot when the provider is offline', async () => {
    const site = getFlightSite('rome')
    const storage = new MemoryStorage()
    const now = () => new Date('2026-08-24T21:16:00.000Z')

    await resolveFlightWorldData(site, {
      fetcher: openMeteoFetcher(),
      storage,
      now,
    })
    const cached = await resolveFlightWorldData(site, {
      fetcher: vi.fn(async () => {
        throw new TypeError('offline')
      }) as unknown as typeof fetch,
      storage,
      now: () => new Date('2026-08-24T21:18:00.000Z'),
      forceRefresh: true,
    })

    expect(cached.resolution).toBe('cache')
    expect(cached.snapshot.deterministicFingerprint).toBeTruthy()
    expect(cached.warning).toContain('last immutable snapshot')
  })

  it('always has an authored fallback when network and cache are unavailable', async () => {
    const result = await resolveFlightWorldData(getFlightSite('istanbul'), {
      fetcher: vi.fn(async () => {
        throw new TypeError('offline')
      }) as unknown as typeof fetch,
      storage: new MemoryStorage(),
    })

    expect(result.resolution).toBe('authored-fallback')
    expect(result.snapshot.delivery.mode).toBe('authored-fallback')
    expect(result.snapshot.sources[0]?.warnings.join(' ')).toContain(
      'must not be used for real-world navigation',
    )
  })

  it('relabels a captured snapshot through the canonical replay provider', async () => {
    const site = getFlightSite('lauterbrunnen')
    const storage = new MemoryStorage()
    const captured = await resolveFlightWorldData(site, {
      fetcher: openMeteoFetcher(),
      storage,
      now: () => new Date('2026-08-24T21:16:00.000Z'),
    })
    const replay = await resolveFlightWorldData(site, {
      storage,
      replaySnapshotId: captured.snapshot.id,
    })

    expect(replay.resolution).toBe('replay')
    expect(replay.snapshot.delivery.mode).toBe('replay')
    expect(replay.snapshot.domains.atmosphere?.data).toEqual(
      captured.snapshot.domains.atmosphere?.data,
    )
  })
})
