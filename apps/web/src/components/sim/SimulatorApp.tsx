import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { FLIGHT_SCENARIOS } from '../../flight/scenarios'
import { HOME_ROW_CONTROL_GUIDE } from '../../sim/home-row-controls'
import { FLIGHT_SITES } from '../../sim/site-data'
import { useSimulationSession } from '../../sim/useSimulationSession'
import {
  DEFAULT_WORLD_MODE,
  WORLD_MODE_OPTIONS,
  isGoogleWorldMode,
  type WorldMode,
} from '../../sim/world-mode'
import { useFlightWorldData } from '../../world-data/useFlightWorldData'
import { WorldDataCard } from './WorldDataCard'
import '../../simulator.css'

const GooglePhotorealisticWorld = lazy(() =>
  import('./GooglePhotorealisticWorld').then((module) => ({
    default: module.GooglePhotorealisticWorld,
  })),
)

const BabylonFlightWorld = lazy(() =>
  import('./BabylonFlightWorld').then((module) => ({
    default: module.BabylonFlightWorld,
  })),
)

function getWorldSetupCopy(worldMode: WorldMode) {
  if (worldMode === 'godogen-3d') {
    return 'Shaping a keyless procedural world with Babylon.js.'
  }

  return worldMode === 'premium-3d'
    ? 'Set VITE_GOOGLE_MAPS_API_KEY to stream Google photorealistic 3D terrain.'
    : 'Set VITE_GOOGLE_MAPS_API_KEY to stream Google satellite tiles.'
}

function formatTypingKey(key: string) {
  return key === ' ' ? 'SPACE' : key.toUpperCase()
}

function formatSignedNumber(value: number, digits = 1) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}`
}

function formatInteger(value: number) {
  return `${Math.round(value)}`
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName

  return (
    target.isContentEditable ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  )
}

export function SimulatorApp() {
  const [hudMode, setHudMode] = useState<'panels' | 'flight'>('flight')
  const [worldMode, setWorldMode] = useState<WorldMode>(DEFAULT_WORLD_MODE)
  const [worldStatus, setWorldStatus] = useState<
    'config-needed' | 'loading' | 'ready' | 'error'
  >('loading')
  const [worldDetail, setWorldDetail] = useState(getWorldSetupCopy(DEFAULT_WORLD_MODE))
  const {
    activityMode,
    controls,
    flightAssist,
    flightState,
    missionView,
    resetRun,
    selectScenario,
    selectSite,
    selectedCountry,
    selectedScenario,
    selectedSite,
    terrainHeightMeters,
    typingMetrics,
    typingSession,
    worldMetrics,
    worldDataSnapshot,
    lastTypingResult,
    handleTerrainSample,
    handleWorldDataSnapshot,
  } = useSimulationSession(FLIGHT_SITES[0].id)
  const worldData = useFlightWorldData(selectedSite)
  const selectedWorldMode =
    WORLD_MODE_OPTIONS.find((option) => option.id === worldMode) ??
    WORLD_MODE_OPTIONS[0]
  const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() || null

  useEffect(() => {
    if (worldData.snapshot) {
      handleWorldDataSnapshot(worldData.snapshot)
    }
  }, [handleWorldDataSnapshot, worldData.snapshot])

  const activeFactIndex =
    selectedCountry.facts.length === 0
      ? -1
      : Math.min(
          selectedCountry.facts.length - 1,
          Math.floor(worldMetrics.travelProgress * selectedCountry.facts.length),
        )
  const activeFact =
    activeFactIndex >= 0
      ? selectedCountry.facts[activeFactIndex] ?? selectedCountry.facts[0] ?? ''
      : ''
  const tuningScenarios = FLIGHT_SCENARIOS.map((scenario) => {
    let metric = ''

    switch (scenario.id) {
      case 'ridge-pass':
        metric = `${formatSignedNumber(flightState.ridgeLiftMetersPerSecond)} m/s ridge`
        break
      case 'thermal-climb':
        metric = `${formatSignedNumber(flightState.thermalLiftMetersPerSecond)} m/s thermal`
        break
      case 'glide-transition':
        metric = `${formatInteger(flightState.airspeedKmh)} km/h · stall ${Math.round(
          flightState.stallWarning * 100,
        )}%`
        break
      case 'approach':
        metric = `${formatInteger(flightState.groundClearanceMeters)} m clear · ${Math.round(
          flightState.bankDeg,
        )}° bank`
        break
      case 'flare':
        metric = `${Math.round(flightState.flareEffectiveness * 100)}% flare · ${flightState.landingRating}`
        break
    }

    return {
      ...scenario,
      isSelected: scenario.id === selectedScenario?.id,
      metric,
    }
  })
  const tuningTelemetry = [
    {
      label: 'Scenario',
      value: selectedScenario?.name ?? 'Free Flight',
      detail:
        selectedScenario?.setup ??
        `Site-led sandbox over ${selectedSite.name}, ${selectedSite.country}.`,
    },
    {
      label: 'Energy',
      value: `${formatInteger(flightState.airspeedKmh)} / ${formatInteger(
        flightState.groundSpeedKmh,
      )} km/h`,
      detail: `${flightState.verticalSpeedMetersPerSecond.toFixed(1)} m/s vario · ${flightState.glideRatio.toFixed(1)}:1 glide`,
    },
    {
      label: 'Lift stack',
      value: `${flightState.ridgeLiftMetersPerSecond.toFixed(1)} + ${flightState.thermalLiftMetersPerSecond.toFixed(1)} m/s`,
      detail: `${flightState.debug.turbulenceLiftMetersPerSecond.toFixed(1)} m/s gust · ${flightState.debug.flareLiftMetersPerSecond.toFixed(1)} m/s flare · ${flightState.debug.groundEffectLiftMetersPerSecond.toFixed(1)} m/s ground`,
    },
    {
      label: 'Sink budget',
      value: `${flightState.debug.totalSinkMetersPerSecond.toFixed(1)} m/s`,
      detail: `base ${flightState.debug.baseSinkMetersPerSecond.toFixed(1)} · turn ${flightState.debug.inducedTurnSinkMetersPerSecond.toFixed(1)} · brake ${flightState.debug.brakeSinkMetersPerSecond.toFixed(1)} · stall ${flightState.debug.stallSinkMetersPerSecond.toFixed(1)} · air ${flightState.airMassSinkMetersPerSecond.toFixed(1)}`,
    },
    {
      label: 'Wing state',
      value: `${flightState.angleOfAttackDeg.toFixed(1)}° AoA · ${flightState.loadFactor.toFixed(2)} g`,
      detail: `${Math.round(flightState.stallWarning * 100)}% stall · ${Math.round(
        flightState.flareEffectiveness * 100,
      )}% flare`,
    },
    {
      label: 'Control',
      value: `${Math.round(flightState.bankDeg)}° bank · ${Math.round(
        flightState.turnRateDegPerSecond,
      )}°/s`,
      detail: `${Math.round(flightState.debug.windGradientFactor * 100)}% wind profile · ${flightState.debug.airDensityKgPerCubicMeter.toFixed(
        2,
      )} kg/m^3`,
    },
    {
      label: 'Landing read',
      value: `${flightState.landingRating}`,
      detail:
        flightState.landingZoneDistanceMeters == null
          ? 'no landing fix'
          : `${Math.round(flightState.landingZoneDistanceMeters)} m to zone · ${Math.round(
              flightState.landingApproachErrorDeg ?? 0,
            )}° off`,
    },
    {
      label: 'Route',
      value: `${Math.round(flightState.distanceKm * 10) / 10} km`,
      detail: `${Math.round(worldMetrics.travelProgress * 100)}% loop · ${selectedCountry.route}`,
    },
  ] as const
  const handleWorldStatusChange = useCallback(
    (status: 'config-needed' | 'loading' | 'ready' | 'error', detail?: string) => {
      setWorldStatus(status)
      setWorldDetail(detail ?? '')
    },
    [],
  )
  const toggleHudMode = () => {
    setHudMode((currentMode) => (currentMode === 'panels' ? 'flight' : 'panels'))
  }
  const handleWorldModeChange = (nextMode: WorldMode) => {
    setWorldMode(nextMode)

    if (nextMode === 'godogen-3d') {
      setWorldStatus('loading')
      setWorldDetail(getWorldSetupCopy(nextMode))
      return
    }

    if (!googleMapsApiKey) {
      setWorldStatus('config-needed')
      setWorldDetail(getWorldSetupCopy(nextMode))
      return
    }

    const nextWorldMode =
      WORLD_MODE_OPTIONS.find((option) => option.id === nextMode) ??
      WORLD_MODE_OPTIONS[0]
    setWorldStatus('loading')
    setWorldDetail(`Streaming ${selectedSite.name} through ${nextWorldMode.label}...`)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || isTextEntryTarget(event.target)) {
        return
      }

      event.preventDefault()
      toggleHudMode()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <div className={`sim-shell sim-shell--${hudMode}`}>
      <Suspense fallback={<div aria-busy="true" className="sim-world" />}>
        {isGoogleWorldMode(worldMode) ? (
          <GooglePhotorealisticWorld
            apiKey={googleMapsApiKey}
            mode={worldMode}
            site={selectedSite}
            flightState={flightState}
            onTerrainSample={handleTerrainSample}
            onWorldStatusChange={handleWorldStatusChange}
          />
        ) : (
          <BabylonFlightWorld
            site={selectedSite}
            flightState={flightState}
            onTerrainSample={handleTerrainSample}
            onWorldStatusChange={handleWorldStatusChange}
          />
        )}
      </Suspense>

      <div className="sim-shell__scrim" />

      <div className="sim-topbar">
        <button className="sim-view-toggle" onClick={toggleHudMode} type="button">
          {hudMode === 'panels' ? 'Flight View' : 'Show Panels'}
          <span>Tab</span>
        </button>
      </div>

      {hudMode === 'panels' ? (
        <>
          <header className="sim-hero">
            <div>
              <p className="sim-kicker">photorealistic typing flight simulator</p>
              <h1>Paraglide the World</h1>
              <p className="sim-copy">
                The wing is now driven by one live session. Home-row controls fly the
                glider with progressive brake travel, while typing discipline shapes
                control smoothness, stability, route progression, and mission quality.
              </p>
            </div>
            <div className={`sim-status sim-status--${worldStatus}`}>
              <strong>
                {worldStatus === 'ready'
                  ? `${selectedWorldMode.label} live`
                  : `${selectedWorldMode.label} setup`}
              </strong>
              <span>{worldDetail}</span>
            </div>
          </header>

          <section className="sim-panel sim-panel--wide sim-panel--lab">
            <div className="sim-panel__header sim-panel__header--stacked">
              <p className="sim-panel__eyebrow">Tuning Lab</p>
              <h2>Prototype flight bench</h2>
              <p className="sim-panel__body sim-panel__body--tight">
                Load named scenarios into the live simulator, then compare how the
                same model handles ridge lift, thermals, glide transitions, approach,
                and flare timing.
              </p>
            </div>

            <div className="sim-lab-meta">
              <span>{selectedScenario?.name ?? 'Free Flight'}</span>
              <span>{selectedSite.name}</span>
              <span>{selectedWorldMode.label}</span>
              <span>{flightState.flightPhase}</span>
              <span>{Math.round(worldMetrics.windSpeedKmh)} km/h wind</span>
            </div>

            <div className="sim-lab-toolbar">
              <button
                className={`sim-button sim-button--ghost${
                  selectedScenario == null ? ' is-active' : ''
                }`}
                onClick={() => selectScenario(null)}
                type="button"
              >
                Free Flight
              </button>
              <button className="sim-button" onClick={resetRun} type="button">
                {selectedScenario ? `Reload ${selectedScenario.name}` : 'Reset Run'}
              </button>
              <span>
                {selectedScenario?.recommendedInputs ??
                  'Use the launch selector for open-ended site flying.'}
              </span>
            </div>

            <div className="sim-lab-layout">
              <div className="sim-lab-scenarios">
                {tuningScenarios.map((scenario) => (
                  <button
                    key={scenario.id}
                    className={`sim-lab-card${scenario.isSelected ? ' is-active' : ''}`}
                    onClick={() => selectScenario(scenario.id)}
                    type="button"
                  >
                    <div className="sim-lab-card__header">
                      <p>{scenario.name}</p>
                      <strong>{scenario.metric}</strong>
                    </div>
                    <span>{scenario.summary}</span>
                    <span className="sim-lab-card__detail">
                      {scenario.keyOutputs.join(' · ')}
                    </span>
                  </button>
                ))}
              </div>

              <div className="sim-lab-telemetry">
                {tuningTelemetry.map((metric) => (
                  <article key={metric.label} className="sim-lab-telemetry__item">
                    <strong>{metric.value}</strong>
                    <span>{metric.label}</span>
                    <p>{metric.detail}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <main className="sim-grid">
            <WorldDataCard
              loaded={worldData}
              appliedSnapshot={worldDataSnapshot}
              scenario={selectedScenario}
              onRefresh={worldData.refresh}
            />

            <section className="sim-panel sim-panel--wide">
              <div className="sim-panel__header">
                <p className="sim-panel__eyebrow">Active Route</p>
                <h2>
                  {selectedSite.name}, {selectedSite.country}
                </h2>
              </div>
              <p className="sim-panel__body">{selectedCountry.tagline}</p>
              <p className="sim-panel__body sim-panel__body--tight">
                {selectedCountry.mission}
              </p>
              <div className="sim-choice-group">
                <p className="sim-choice-group__label">Launch Site</p>
                <div className="sim-choice-grid">
                  {FLIGHT_SITES.map((site) => {
                    const isSelected = site.id === selectedSite.id

                    return (
                      <button
                        key={site.id}
                        className={`sim-choice${isSelected ? ' is-selected' : ''}`}
                        onClick={() => selectSite(site.id)}
                        type="button"
                      >
                        <strong>{site.name}</strong>
                        <span>
                          {site.region}, {site.country}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="sim-choice-group">
                <p className="sim-choice-group__label">World Tier</p>
                <div className="sim-choice-grid sim-choice-grid--tiers">
                  {WORLD_MODE_OPTIONS.map((option) => {
                    const isSelected = option.id === worldMode

                    return (
                      <button
                        key={option.id}
                        className={`sim-choice${isSelected ? ' is-selected' : ''}`}
                        onClick={() => handleWorldModeChange(option.id)}
                        type="button"
                      >
                        <strong>{option.label}</strong>
                        <span>{option.summary}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="sim-site-meta">
                <span>{selectedCountry.route}</span>
                <span>{activityMode.name}</span>
                <span>{Math.round(flightState.distanceKm * 10) / 10} km flown</span>
                <span>{Math.round(flightState.elapsedSeconds)} s elapsed</span>
              </div>
            </section>

            <section className="sim-panel">
              <div className="sim-panel__header">
                <p className="sim-panel__eyebrow">Flight State</p>
                <h2>Wing telemetry</h2>
              </div>
              <div className="sim-stat-grid">
                <article className="sim-stat">
                  <strong>{Math.round(flightState.airspeedKmh)}</strong>
                  <span>airspeed km/h</span>
                </article>
                <article className="sim-stat">
                  <strong>{Math.round(flightState.groundSpeedKmh)}</strong>
                  <span>groundspeed km/h</span>
                </article>
                <article className="sim-stat">
                  <strong>{flightState.verticalSpeedMetersPerSecond.toFixed(1)}</strong>
                  <span>vario m/s</span>
                </article>
                <article className="sim-stat">
                  <strong>{Math.round(flightState.groundClearanceMeters)}</strong>
                  <span>ground clearance m</span>
                </article>
                <article className="sim-stat">
                  <strong>{Math.round(flightState.bankDeg)}°</strong>
                  <span>bank angle</span>
                </article>
                <article className="sim-stat">
                  <strong>{Math.round(flightState.headingDeg)}°</strong>
                  <span>heading</span>
                </article>
                <article className="sim-stat">
                  <strong>{Math.round(flightState.turnRateDegPerSecond ?? 0)}°/s</strong>
                  <span>turn rate</span>
                </article>
                <article className="sim-stat">
                  <strong>{flightState.flightPhase}</strong>
                  <span>flight phase</span>
                </article>
                <article className="sim-stat">
                  <strong>{flightState.landingRating}</strong>
                  <span>last landing</span>
                </article>
              </div>
            </section>

            <section className="sim-panel">
              <div className="sim-panel__header">
                <p className="sim-panel__eyebrow">Control Discipline</p>
                <h2>
                  {typingMetrics.activeFinger.label} on{' '}
                  {formatTypingKey(typingMetrics.currentKey)}
                </h2>
              </div>
              <div className="sim-stat-grid">
                <article className="sim-stat">
                  <strong>{typingMetrics.accuracy}%</strong>
                  <span>accuracy</span>
                </article>
                <article className="sim-stat">
                  <strong>{typingSession.streak}</strong>
                  <span>live streak</span>
                </article>
                <article className="sim-stat">
                  <strong>{Math.round(typingMetrics.progress * 100)}%</strong>
                  <span>lesson progress</span>
                </article>
              </div>
              <div className="sim-lesson">
                <span className="sim-lesson__done">{typingMetrics.completedText}</span>
                <span className="sim-lesson__current">
                  {formatTypingKey(typingMetrics.currentKey)}
                </span>
                <span className="sim-lesson__next">{typingMetrics.upcomingText}</span>
              </div>
              <p className="sim-panel__body sim-panel__body--tight">
                {typingMetrics.activeFinger.reminder}
              </p>
              <div className="sim-pill-row">
                <span className={`sim-pill sim-pill--${typingSession.lastInput}`}>
                  {typingSession.lastInput === 'idle'
                    ? 'Awaiting input'
                    : typingSession.lastInput === 'correct'
                      ? 'Clean input'
                      : 'Recovery input'}
                </span>
                <span className="sim-pill">
                  {lastTypingResult?.completedLesson
                    ? 'Lesson loop cleared'
                    : `${typingSession.mistakes} mistakes`}
                </span>
              </div>
            </section>

            <section className="sim-panel">
              <div className="sim-panel__header">
                <p className="sim-panel__eyebrow">Mission</p>
                <h2>{missionView.objectiveTitle}</h2>
              </div>
              <p className="sim-panel__body sim-panel__body--tight">
                {missionView.objectiveSummary}
              </p>
              <div className="sim-pill-row">
                <span className={`sim-pill sim-pill--${missionView.previewRating}`}>
                  {missionView.previewLabel}
                </span>
                <span className="sim-pill">
                  {missionView.clearedCount}/{missionView.totalCount} cleared
                </span>
              </div>
              <div className="sim-checkpoint-list">
                {missionView.checkpoints.map((checkpoint) => (
                  <article
                    key={checkpoint.id}
                    className={`sim-checkpoint sim-checkpoint--${checkpoint.status}`}
                  >
                    <strong>{checkpoint.label}</strong>
                    <span>
                      {checkpoint.kind === 'launch'
                        ? 'Launch'
                        : checkpoint.kind === 'landing'
                          ? 'Landing'
                          : 'Checkpoint'}
                    </span>
                  </article>
                ))}
              </div>
              {missionView.lastResult ? (
                <div
                  className={`sim-result sim-result--${missionView.lastResult.rating}`}
                >
                  <strong>{missionView.lastResult.title}</strong>
                  <span>
                    {missionView.lastResult.accuracy}% accuracy ·{' '}
                    {missionView.lastResult.mistakes} mistakes
                  </span>
                </div>
              ) : null}
            </section>

            <section className="sim-panel">
              <div className="sim-panel__header">
                <p className="sim-panel__eyebrow">Flight Trainer</p>
                <h2>Discipline shapes handling, not lift</h2>
              </div>
              <div className="sim-lift-stack">
                <div>
                  <strong>{Math.round(flightAssist.inputResponsiveness * 100)}%</strong>
                  <span>input responsiveness</span>
                </div>
                <div>
                  <strong>{worldMetrics.turbulencePercent}%</strong>
                  <span>ambient turbulence</span>
                </div>
                <div>
                  <strong>{Math.round(flightAssist.coordinationAssist * 100)}%</strong>
                  <span>coordination assist</span>
                </div>
                <div>
                  <strong>{Math.round(worldMetrics.windSpeedKmh)} km/h</strong>
                  <span>{worldMetrics.windLabel}</span>
                </div>
                <div>
                  <strong>{Math.round(flightAssist.turbulenceDamping * 100)}%</strong>
                  <span>gust damping</span>
                </div>
                <div>
                  <strong>{Math.round(flightAssist.recoveryAssist * 100)}%</strong>
                  <span>recovery assist</span>
                </div>
                <div>
                  <strong>{Math.round((flightState.stallWarning ?? 0) * 100)}%</strong>
                  <span>stall warning</span>
                </div>
                <div>
                  <strong>{flightState.ridgeLiftMetersPerSecond.toFixed(1)} m/s</strong>
                  <span>ridge lift</span>
                </div>
                <div>
                  <strong>{flightState.thermalLiftMetersPerSecond.toFixed(1)} m/s</strong>
                  <span>thermal lift</span>
                </div>
                <div>
                  <strong>{flightState.airMassSinkMetersPerSecond.toFixed(1)} m/s</strong>
                  <span>lee / edge sink</span>
                </div>
                <div>
                  <strong>{Math.round(flightState.flareEffectiveness * 100)}%</strong>
                  <span>flare timing</span>
                </div>
                <div>
                  <strong>
                    {Math.round(
                      terrainHeightMeters ?? selectedSite.launchAltitudeMeters,
                    )}{' '}
                    m
                  </strong>
                  <span>
                    {worldMode === 'premium-3d'
                      ? 'sampled terrain floor'
                      : worldMode === 'godogen-3d'
                        ? 'procedural terrain floor'
                        : 'shared launch-floor baseline'}
                  </span>
                </div>
              </div>
            </section>

            <section className="sim-panel">
              <div className="sim-panel__header">
                <p className="sim-panel__eyebrow">Route Radio</p>
                <h2>{selectedCountry.radioStation}</h2>
              </div>
              <p className="sim-panel__body sim-panel__body--tight">{activeFact}</p>
              <div className="sim-controls">
                {HOME_ROW_CONTROL_GUIDE.map((control) => {
                  const isActive =
                    (control.keyLabel === 'A' && controls.weightLeft) ||
                    (control.keyLabel === 'F' && controls.leftBrake) ||
                    (control.keyLabel === 'J' && controls.rightBrake) ||
                    (control.keyLabel === ';' && controls.weightRight) ||
                    (control.keyLabel === 'Space' && controls.speedBar)

                  return (
                    <article
                      key={control.keyLabel}
                      className={`sim-control${isActive ? ' is-active' : ''}`}
                    >
                      <strong>{control.keyLabel}</strong>
                      <span>{control.description}</span>
                    </article>
                  )
                })}
              </div>
              <div className="sim-actions">
                <button className="sim-button" onClick={resetRun} type="button">
                  {selectedScenario ? `Reload ${selectedScenario.name}` : 'Reset Run'}
                </button>
                <span>
                  {selectedScenario
                    ? 'Scenario mode keeps the launch, atmosphere, and flight state replayable.'
                    : 'Type the lesson, work the air, and tap `R` to relaunch.'}
                </span>
              </div>
            </section>
          </main>
        </>
      ) : (
        <section className="sim-flight-hud">
          <div className="sim-flight-hud__top">
            <div className="sim-flight-card sim-flight-card--hero">
              <p className="sim-kicker">Flight View</p>
              <h2>
                {selectedSite.name}, {selectedSite.country}
              </h2>
              <p>{selectedCountry.route}</p>
              <div className="sim-flight-card__meta">
                <span>{selectedScenario?.name ?? 'Free Flight'}</span>
                <span>{selectedWorldMode.label}</span>
                <span>{activityMode.name}</span>
                <span>{worldMetrics.windLabel}</span>
              </div>
            </div>
            <div className={`sim-status sim-status--${worldStatus} sim-status--compact`}>
              <strong>
                {worldStatus === 'ready'
                  ? `${selectedWorldMode.label} live`
                  : `${selectedWorldMode.label} setup`}
              </strong>
              <span>{worldDetail}</span>
            </div>
          </div>

          <div className="sim-flight-hud__strip">
            <article className="sim-flight-chip">
              <strong>{Math.round(flightState.airspeedKmh)}</strong>
              <span>airspeed</span>
            </article>
            <article className="sim-flight-chip">
              <strong>{Math.round(flightState.groundClearanceMeters)} m</strong>
              <span>clearance</span>
            </article>
            <article className="sim-flight-chip">
              <strong>{flightState.verticalSpeedMetersPerSecond.toFixed(1)} m/s</strong>
              <span>vario</span>
            </article>
            <article className="sim-flight-chip">
              <strong>{Math.round(flightState.bankDeg)}°</strong>
              <span>bank</span>
            </article>
            <article className="sim-flight-chip">
              <strong>{Math.round(flightState.turnRateDegPerSecond)}°/s</strong>
              <span>turn</span>
            </article>
            <article className="sim-flight-chip">
              <strong>{Math.round((flightState.stallWarning ?? 0) * 100)}%</strong>
              <span>stall</span>
            </article>
            <article className="sim-flight-chip">
              <strong>{flightState.flightPhase}</strong>
              <span>phase</span>
            </article>
            <article className="sim-flight-chip">
              <strong>{typingMetrics.accuracy}%</strong>
              <span>typing</span>
            </article>
          </div>

          <div className="sim-flight-hud__bottom">
            <div className="sim-flight-card sim-flight-card--wide">
              <p className="sim-kicker">Objective</p>
              <h2>{missionView.objectiveTitle}</h2>
              <p>{missionView.objectiveSummary}</p>
              <div className="sim-flight-card__meta">
                <span>{missionView.previewLabel}</span>
                <span>
                  {missionView.clearedCount}/{missionView.totalCount} cleared
                </span>
                <span>{lastTypingResult?.completedLesson ? 'Lesson cleared' : 'Live run'}</span>
              </div>
            </div>
            <div className="sim-flight-controls">
              {HOME_ROW_CONTROL_GUIDE.map((control) => {
                const isActive =
                  (control.keyLabel === 'A' && controls.weightLeft) ||
                  (control.keyLabel === 'F' && controls.leftBrake) ||
                  (control.keyLabel === 'J' && controls.rightBrake) ||
                  (control.keyLabel === ';' && controls.weightRight) ||
                  (control.keyLabel === 'Space' && controls.speedBar)

                return (
                  <article
                    key={control.keyLabel}
                    className={`sim-flight-control${isActive ? ' is-active' : ''}`}
                  >
                    <strong>{control.keyLabel}</strong>
                    <span>{control.description}</span>
                  </article>
                )
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
