import type { FlightScenarioPreset } from '../../flight/scenarios'
import type { WorldDataSnapshot } from '@wilder-future/world-data-engine'
import type { FlightWorldDataState } from '../../world-data/useFlightWorldData'
import {
  getSnapshotKind,
  getSnapshotValidUntil,
} from '../../world-data/flight-adapter'
import { WORLD_DATA_REPLAY_QUERY_PARAM } from '../../world-data/client'

type WorldDataCardProps = {
  compact?: boolean
  loaded: FlightWorldDataState
  appliedSnapshot: Readonly<WorldDataSnapshot> | null
  scenario: FlightScenarioPreset | null
  onRefresh: () => void
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'not time-bound'
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value))
}

function formatFreshness(snapshot: Readonly<WorldDataSnapshot>) {
  const retrievalTimes = snapshot.sources
    .map((source) => Date.parse(source.retrievedAt))
    .filter(Number.isFinite)
  const seconds =
    retrievalTimes.length === 0
      ? snapshot.delivery.ageSeconds
      : Math.max(0, (Date.now() - Math.max(...retrievalTimes)) / 1_000)

  if (snapshot.domains.atmosphere?.time.nature === 'authored') {
    return 'authored baseline'
  }

  if (seconds < 120) {
    return 'updated just now'
  }

  if (seconds < 7_200) {
    return `updated ${Math.round(seconds / 60)} min ago`
  }

  return `updated ${Math.round(seconds / 3_600)} hr ago`
}

function getReplayUrl(snapshotId: string) {
  const replayUrl = new URL(window.location.href)
  replayUrl.searchParams.set(WORLD_DATA_REPLAY_QUERY_PARAM, snapshotId)
  return replayUrl.toString()
}

export function WorldDataCard({
  compact = false,
  loaded,
  appliedSnapshot,
  scenario,
  onRefresh,
}: WorldDataCardProps) {
  const snapshot = appliedSnapshot ?? loaded.snapshot
  const atmosphere = snapshot?.domains.atmosphere?.data
  const terrain = snapshot?.domains.terrain?.data
  const isScenarioOverride = scenario != null
  const kind = isScenarioOverride
    ? 'authored'
    : loaded.resolution === 'replay'
      ? 'replay'
    : snapshot
      ? getSnapshotKind(snapshot)
      : 'loading'
  const sources = snapshot?.sources ?? []
  const providerWarnings = [...new Set(sources.flatMap((source) => source.warnings))]
    .sort((left, right) =>
      Number(right.includes('model-derived')) - Number(left.includes('model-derived')),
    )

  return (
    <section
      className={`sim-panel sim-panel--world-data${compact ? ' sim-panel--world-data-compact' : ' sim-panel--wide'}`}
      aria-live="polite"
    >
      <div className="sim-world-data__header">
        <div>
          <p className="sim-panel__eyebrow">Living World</p>
          <h2>Real-world snapshot</h2>
        </div>
        <span className={`sim-world-data__badge sim-world-data__badge--${kind}`}>
          {isScenarioOverride ? 'authored replay' : kind}
        </span>
      </div>

      {snapshot ? (
        <>
          <div className="sim-world-data__metrics">
            <div>
              <strong>
                {atmosphere
                  ? `${(atmosphere.windSpeedMps * 3.6).toFixed(0)} km/h`
                  : '—'}
              </strong>
              <span>
                {atmosphere
                  ? `${Math.round(atmosphere.windDirectionFromDeg)}° wind from`
                  : 'atmosphere unavailable'}
              </span>
            </div>
            <div>
              <strong>{terrain?.landCover ?? 'site-authored'}</strong>
              <span>
                {terrain?.thermalPotential01 == null
                  ? 'thermal context unavailable'
                  : `${Math.round(terrain.thermalPotential01 * 100)}% thermal potential`}
              </span>
            </div>
          </div>

          <p className="sim-world-data__validity">
            {isScenarioOverride
              ? `${scenario.name} uses fixed authored air so every tuning run is replayable.`
              : `${formatFreshness(snapshot)} · valid until ${formatDateTime(
                  getSnapshotValidUntil(snapshot),
                )}`}
          </p>

          {!compact ? (
            <>
              <div className="sim-world-data__sources">
                {sources.map((source) => (
                  <span key={source.id}>
                    {source.sourceUrl !== 'about:blank' ? (
                      <a href={source.sourceUrl} rel="noreferrer" target="_blank">
                        {source.attribution}
                      </a>
                    ) : (
                      source.attribution
                    )}
                    {' · '}
                    {source.license.url !== 'about:blank' ? (
                      <a href={source.license.url} rel="noreferrer" target="_blank">
                        {source.license.name}
                      </a>
                    ) : (
                      source.license.name
                    )}
                  </span>
                ))}
              </div>
              {providerWarnings.slice(0, 2).map((warning) => (
                <p key={warning} className="sim-world-data__warning">
                  {warning}
                </p>
              ))}
              <p className="sim-world-data__replay">
                Snapshot {snapshot.id} · fingerprint {snapshot.deterministicFingerprint}
                {' · '}
                <a href={getReplayUrl(snapshot.id)}>replay this capture</a>
              </p>
            </>
          ) : null}
        </>
      ) : (
        <p className="sim-world-data__validity">
          {loaded.status === 'loading'
            ? 'Resolving a complete snapshot before it enters the simulator…'
            : loaded.warning ?? 'No snapshot is available.'}
        </p>
      )}

      {!compact && loaded.warning ? (
        <p className="sim-world-data__warning">{loaded.warning}</p>
      ) : null}

      {!compact ? (
        <div className="sim-world-data__footer">
          <p>
            Simulation and storytelling data only. Never use this display for
            launch, route, weather, terrain, or flight-safety decisions.
          </p>
          <button className="sim-button sim-button--ghost" onClick={onRefresh} type="button">
            Refresh snapshot
          </button>
        </div>
      ) : (
        <p className="sim-world-data__safety">Simulation only · not for flight safety</p>
      )}
    </section>
  )
}
