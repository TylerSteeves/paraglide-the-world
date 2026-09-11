import {
  AuthoredProvider,
  OpenMeteoProvider,
  ReplayProvider,
  WebStorageSnapshotCache,
  createWorldDataEngine,
  hasValidSnapshotFingerprint,
  isWorldDataSnapshot,
  queryCacheKey,
  type WorldDataQuery,
  type WorldDataSnapshot,
} from '@wilder-future/world-data-engine'
import type { FlightSite } from '../sim/site-data'
import { createAuthoredWorldRecord } from './authored-records'

export const WORLD_DATA_REPLAY_QUERY_PARAM = 'worldSnapshot'
const CACHE_PREFIX = 'ptw:world-data:v1:'

export type SnapshotStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type ResolveWorldDataOptions = {
  apiBaseUrl?: string | null
  fetcher?: typeof fetch
  storage?: SnapshotStorage | null
  signal?: AbortSignal
  now?: () => Date
  replaySnapshotId?: string | null
  forceRefresh?: boolean
}

export type ResolvedWorldData = {
  snapshot: Readonly<WorldDataSnapshot>
  resolution: 'provider' | 'cache' | 'replay' | 'authored-fallback'
  warning: string | null
}

function siteCacheKey(siteId: string) {
  return `${CACHE_PREFIX}site:${siteId}`
}

function snapshotCacheKey(snapshotId: string) {
  return `${CACHE_PREFIX}snapshot:${snapshotId}`
}

function readSnapshot(storage: SnapshotStorage | null, key: string) {
  if (!storage) {
    return null
  }

  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? 'null')
    return isWorldDataSnapshot(value) && hasValidSnapshotFingerprint(value)
      ? value
      : null
  } catch {
    return null
  }
}

function writeLatestSnapshot(
  storage: SnapshotStorage | null,
  siteId: string,
  snapshot: Readonly<WorldDataSnapshot>,
) {
  if (!storage) {
    return
  }

  try {
    const serialized = JSON.stringify(snapshot)
    storage.setItem(siteCacheKey(siteId), serialized)
    storage.setItem(snapshotCacheKey(snapshot.id), serialized)
  } catch {
    // A full or privacy-restricted cache must never stop the simulator.
  }
}

function createQuery(site: FlightSite, now: Date): WorldDataQuery {
  // Open-Meteo current conditions are 15-minute model fields. Bucketing the
  // request instant gives the shared engine a stable cache key and replay anchor.
  const intervalMs = 15 * 60 * 1_000
  const at = new Date(Math.floor(now.getTime() / intervalMs) * intervalMs).toISOString()

  return {
    location: {
      latitudeDeg: site.latitude,
      longitudeDeg: site.longitude,
      elevationMslM: site.launchAltitudeMeters,
    },
    at,
    domains: ['terrain', 'atmosphere'],
  }
}

async function requestTransportSnapshot(
  query: WorldDataQuery,
  apiBaseUrl: string,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
) {
  const response = await fetcher(`${apiBaseUrl.replace(/\/$/, '')}/v1/snapshots`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    signal,
  })

  if (!response.ok) {
    throw new Error(`World-data transport returned HTTP ${response.status}.`)
  }

  const value: unknown = await response.json()

  if (!isWorldDataSnapshot(value) || !hasValidSnapshotFingerprint(value)) {
    throw new Error('World-data transport returned an invalid snapshot.')
  }

  return value
}

function hasNetworkProvider(snapshot: Readonly<WorldDataSnapshot>) {
  return snapshot.sources.some((source) => source.provider === 'Open-Meteo')
}

export async function resolveFlightWorldData(
  site: FlightSite,
  options: ResolveWorldDataOptions = {},
): Promise<ResolvedWorldData> {
  const now = (options.now ?? (() => new Date()))()
  const storage = options.storage ?? null

  if (options.replaySnapshotId) {
    const captured = readSnapshot(storage, snapshotCacheKey(options.replaySnapshotId))

    if (captured) {
      const replayProvider = new ReplayProvider({
        format: 'wilder-world-data-capture-v1',
        createdAt: captured.capturedAt,
        entries: [
          {
            key: queryCacheKey(captured.query),
            query: captured.query,
            snapshot: captured,
          },
        ],
      })
      const replayEngine = createWorldDataEngine({
        providers: [replayProvider],
        clock: () => new Date(captured.capturedAt),
      })
      const replay = await replayEngine.getSnapshot(captured.query)

      return {
        snapshot: replay,
        resolution: 'replay',
        warning: null,
      }
    }
  }

  const query = createQuery(site, now)
  let transportWarning: string | null = null

  if (options.apiBaseUrl) {
    try {
      const transported = await requestTransportSnapshot(
        query,
        options.apiBaseUrl,
        options.fetcher ?? fetch,
        options.signal,
      )
      writeLatestSnapshot(storage, site.id, transported)
      return {
        snapshot: transported,
        resolution: 'provider',
        warning: null,
      }
    } catch (error) {
      if (options.signal?.aborted) {
        throw error
      }

      transportWarning =
        error instanceof Error
          ? `${error.message} Loaded the direct provider path instead.`
          : 'Shared transport unavailable. Loaded the direct provider path instead.'
    }
  }

  const engine = createWorldDataEngine({
    providers: [
      new OpenMeteoProvider({ fetch: options.fetcher }),
      new AuthoredProvider({ records: [createAuthoredWorldRecord(site)] }),
    ],
    ...(storage
      ? {
          cache: new WebStorageSnapshotCache({
            storage,
            prefix: `${CACHE_PREFIX}engine:`,
          }),
        }
      : {}),
    clock: () => now,
  })
  const snapshot = await engine.getSnapshot(query, {
    allowStale: true,
    forceRefresh: options.forceRefresh,
    signal: options.signal,
  })

  if (hasNetworkProvider(snapshot)) {
    writeLatestSnapshot(storage, site.id, snapshot)
    const deliveredFromCache = snapshot.delivery.mode.includes('cache')
    return {
      snapshot,
      resolution: deliveredFromCache ? 'cache' : 'provider',
      warning:
        transportWarning ??
        (deliveredFromCache && snapshot.quality.flags.includes('provider-error')
          ? 'Current providers are unavailable. Using the last immutable snapshot.'
          : null),
    }
  }

  const cached = readSnapshot(storage, siteCacheKey(site.id))

  if (cached) {
    return {
      snapshot: cached,
      resolution: 'cache',
      warning: 'Current providers are unavailable. Using the last immutable snapshot.',
    }
  }

  return {
    snapshot,
    resolution: 'authored-fallback',
    warning: 'Current providers are unavailable. Using authored site conditions.',
  }
}
