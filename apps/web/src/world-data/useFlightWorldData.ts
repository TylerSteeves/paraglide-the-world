import { useCallback, useEffect, useState } from 'react'
import type { WorldDataSnapshot } from '@wilder-future/world-data-engine'
import type { FlightSite } from '../sim/site-data'
import {
  resolveFlightWorldData,
  WORLD_DATA_REPLAY_QUERY_PARAM,
  type ResolvedWorldData,
} from './client'

export type FlightWorldDataState = {
  status: 'loading' | 'ready' | 'error'
  snapshot: Readonly<WorldDataSnapshot> | null
  resolution: ResolvedWorldData['resolution'] | null
  warning: string | null
}

type InternalFlightWorldDataState = FlightWorldDataState & {
  siteId: string | null
}

export function useFlightWorldData(site: FlightSite) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [state, setState] = useState<InternalFlightWorldDataState>({
    status: 'loading',
    snapshot: null,
    resolution: null,
    warning: null,
    siteId: null,
  })
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    const replaySnapshotId = new URLSearchParams(window.location.search).get(
      WORLD_DATA_REPLAY_QUERY_PARAM,
    )

    void resolveFlightWorldData(site, {
      apiBaseUrl: import.meta.env.VITE_WORLD_DATA_API_URL?.trim() || null,
      storage: window.localStorage,
      signal: controller.signal,
      replaySnapshotId,
      forceRefresh: refreshKey > 0,
    })
      .then((result) => {
        if (controller.signal.aborted) {
          return
        }

        setState({
          status: 'ready',
          snapshot: result.snapshot,
          resolution: result.resolution,
          warning: result.warning,
          siteId: site.id,
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }

        setState({
          status: 'error',
          snapshot: null,
          resolution: null,
          warning: error instanceof Error ? error.message : 'World-data load failed.',
          siteId: site.id,
        })
      })

    return () => controller.abort()
  }, [refreshKey, site])

  return state.siteId === site.id
    ? { ...state, refresh }
    : {
        status: 'loading' as const,
        snapshot: null,
        resolution: null,
        warning: null,
        refresh,
      }
}
