import { ACTIVITY_MODES, type ActivityMode, type ActivityModeId } from '../data'
import {
  advanceMissionSession,
  createInitialMissionSession,
  type MissionSessionState,
} from '../lib/mission-engine'
import {
  createInitialTypingSession,
  deriveTypingMetrics,
  processTypingKey,
  type TypingKeyResult,
  type TypingSessionState,
} from '../lib/typing-engine'
import { COUNTRIES, type CountryId } from '../lib/typing-content'
import {
  createInitialWorldSession,
  deriveWorldMetrics,
  tickWorldSession,
  type WorldSessionState,
} from '../lib/world-engine'
import { deriveFlightAssistProfile } from './flight-assist'
import {
  createFlightScenarioSession,
  getFlightScenario,
  type FlightScenarioId,
} from '../flight/scenarios'
import {
  createInitialFlightState,
  resetFlightStateForSite,
  stepFlightState,
  type FlightSimState,
} from './flight-model'
import {
  applyHomeRowControlKey,
  DEFAULT_HOME_ROW_CONTROLS,
  resolveHomeRowControlKey,
  stepHomeRowControls,
  type HomeRowControlState,
} from './home-row-controls'
import { getFlightSite, type FlightSiteId } from './site-data'
import type { AmbientAirState } from '../flight/types'
import type { WorldDataSnapshot } from '@wilder-future/world-data-engine'
import {
  applySnapshotToFlightSite,
  snapshotToAmbientAir,
} from '../world-data/flight-adapter'

export const FIXED_SIMULATION_STEP_MS = 20
export const MAX_SIMULATION_STEPS_PER_FRAME = 6
export const MAX_SIMULATION_FRAME_DELTA_MS =
  FIXED_SIMULATION_STEP_MS * MAX_SIMULATION_STEPS_PER_FRAME

export type SimulationSessionState = {
  siteId: FlightSiteId
  scenarioId: FlightScenarioId | null
  scenarioAtmosphere: AmbientAirState | null
  worldDataSnapshot: Readonly<WorldDataSnapshot> | null
  activityModeId: ActivityModeId
  launchTerrainHeightMeters: number
  terrainHeightMeters: number
  controls: HomeRowControlState
  flightState: FlightSimState
  typingSession: TypingSessionState
  worldSession: WorldSessionState
  missionSession: MissionSessionState
  lastTypingResult: TypingKeyResult | null
}

export type CreateSimulationSessionOptions = {
  siteId: FlightSiteId
  launchTerrainHeightMeters?: number
  scenarioId?: FlightScenarioId | null
  worldDataSnapshot?: Readonly<WorldDataSnapshot> | null
}

export type SimulationKeyChangeResult = {
  handled: boolean
  state: SimulationSessionState
}

export type TerrainSampleResult = {
  didBootstrapLaunchTerrain: boolean
  state: SimulationSessionState
}

export type WorldDataSnapshotResult = {
  didBootstrapLaunchTerrain: boolean
  state: SimulationSessionState
}

export type SimulationFrameStep = {
  clampedFrameDeltaMs: number
  remainingAccumulatorMs: number
  stepCount: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getActivityMode(activityModeId: ActivityModeId) {
  return ACTIVITY_MODES.find((mode) => mode.id === activityModeId) ?? ACTIVITY_MODES[0]
}

function getTypingCountryId(countryId: string): CountryId {
  const matchedCountry = COUNTRIES.find((country) => country.id === countryId)
  return matchedCountry?.id ?? COUNTRIES[0].id
}

function getRouteProgress(distanceKm: number, routeLengthKm: number) {
  if (routeLengthKm <= 0) {
    return 0
  }

  return (distanceKm / routeLengthKm) % 1
}

function createWorldSession(
  activityMode: ActivityMode,
  countryId: CountryId,
  scenarioAtmosphere: AmbientAirState | null,
) {
  return {
    ...createInitialWorldSession(activityMode.id, countryId),
    ...(scenarioAtmosphere
      ? {
          windHeading: scenarioAtmosphere.windHeadingDeg,
          windSpeedKmh: scenarioAtmosphere.windSpeedKmh,
          turbulence: scenarioAtmosphere.turbulence,
        }
      : {}),
  }
}

export function createSimulationSessionState(
  options: CreateSimulationSessionOptions,
): SimulationSessionState {
  const scenarioId = options.scenarioId ?? null
  const worldDataSnapshot = options.worldDataSnapshot ?? null
  const baseSite = getFlightSite(options.siteId)
  const snapshotSite = applySnapshotToFlightSite(baseSite, worldDataSnapshot)
  const launchTerrainHeightMeters =
    options.launchTerrainHeightMeters ?? snapshotSite.launchAltitudeMeters
  const scenarioSession =
    scenarioId == null
      ? null
      : createFlightScenarioSession(scenarioId, launchTerrainHeightMeters)
  const site = scenarioSession?.site ?? snapshotSite
  const countryId = getTypingCountryId(site.countryId)
  const activityModeId: ActivityModeId = 'paragliding'
  const resolvedLaunchTerrainHeightMeters =
    scenarioSession?.terrainHeightMeters ?? launchTerrainHeightMeters
  const scenarioAtmosphere = scenarioSession?.atmosphere ?? null
  const activityMode = getActivityMode(activityModeId)

  return {
    siteId: site.id,
    scenarioId,
    scenarioAtmosphere,
    worldDataSnapshot,
    activityModeId,
    launchTerrainHeightMeters: resolvedLaunchTerrainHeightMeters,
    terrainHeightMeters: resolvedLaunchTerrainHeightMeters,
    controls: DEFAULT_HOME_ROW_CONTROLS,
    flightState:
      scenarioSession?.flightState ??
      createInitialFlightState(site, resolvedLaunchTerrainHeightMeters),
    typingSession: createInitialTypingSession(countryId),
    worldSession: createWorldSession(activityMode, countryId, scenarioAtmosphere),
    missionSession: createInitialMissionSession(activityModeId, countryId),
    lastTypingResult: null,
  }
}

export function selectSimulationSite(
  siteId: FlightSiteId,
): SimulationSessionState {
  return createSimulationSessionState({
    siteId,
    scenarioId: null,
  })
}

export function selectSimulationScenario(
  currentSession: SimulationSessionState,
  scenarioId: FlightScenarioId | null,
): SimulationSessionState {
  const scenario = getFlightScenario(scenarioId)
  const canReuseSnapshot =
    scenario == null || scenario.siteId === currentSession.siteId

  return createSimulationSessionState({
    siteId: scenario?.siteId ?? currentSession.siteId,
    launchTerrainHeightMeters:
      scenario == null || scenario.siteId === currentSession.siteId
        ? currentSession.launchTerrainHeightMeters
        : undefined,
    scenarioId,
    worldDataSnapshot: canReuseSnapshot ? currentSession.worldDataSnapshot : null,
  })
}

export function resetSimulationSession(
  currentSession: SimulationSessionState,
): SimulationSessionState {
  return createSimulationSessionState({
    siteId: currentSession.siteId,
    launchTerrainHeightMeters: currentSession.launchTerrainHeightMeters,
    scenarioId: currentSession.scenarioId,
    worldDataSnapshot: currentSession.worldDataSnapshot,
  })
}

export function applySimulationWorldDataSnapshot(
  currentSession: SimulationSessionState,
  snapshot: Readonly<WorldDataSnapshot>,
  hasBootstrappedLaunchTerrain: boolean,
): WorldDataSnapshotResult {
  if (
    currentSession.worldDataSnapshot?.deterministicFingerprint ===
    snapshot.deterministicFingerprint
  ) {
    return {
      didBootstrapLaunchTerrain: false,
      state: currentSession,
    }
  }

  const atmosphere = snapshotToAmbientAir(snapshot)
  const terrainHeightMeters = snapshot.domains.terrain?.data.elevationMslM
  const shouldBootstrapTerrain =
    currentSession.scenarioId == null &&
    !hasBootstrappedLaunchTerrain &&
    // A provider's gridded elevation is context, not a safe launch surface.
    // Cesium or the authored flight-site baseline owns terrain bootstrapping.
    snapshot.domains.terrain?.time.nature === 'authored' &&
    terrainHeightMeters != null &&
    Number.isFinite(terrainHeightMeters)
  const snapshotSite = applySnapshotToFlightSite(
    getFlightSite(currentSession.siteId),
    snapshot,
  )

  return {
    didBootstrapLaunchTerrain: shouldBootstrapTerrain,
    state: {
      ...currentSession,
      worldDataSnapshot: snapshot,
      ...(shouldBootstrapTerrain
        ? {
            launchTerrainHeightMeters: terrainHeightMeters,
            terrainHeightMeters,
            flightState: resetFlightStateForSite(snapshotSite, terrainHeightMeters),
          }
        : {}),
      worldSession:
        currentSession.scenarioId == null && atmosphere
          ? {
              ...currentSession.worldSession,
              windHeading: atmosphere.windHeadingDeg,
              windSpeedKmh: atmosphere.windSpeedKmh,
              turbulence: atmosphere.turbulence,
            }
          : currentSession.worldSession,
    },
  }
}

export function applySimulationTerrainSample(
  currentSession: SimulationSessionState,
  nextTerrainHeightMeters: number | null,
  hasBootstrappedLaunchTerrain: boolean,
): TerrainSampleResult {
  if (nextTerrainHeightMeters == null) {
    return {
      didBootstrapLaunchTerrain: false,
      state: currentSession,
    }
  }

  if (!hasBootstrappedLaunchTerrain) {
    if (currentSession.scenarioId) {
      const scenarioSession = createFlightScenarioSession(
        currentSession.scenarioId,
        nextTerrainHeightMeters,
      )

      return {
        didBootstrapLaunchTerrain: true,
        state: {
          ...currentSession,
          siteId: scenarioSession.site.id,
          launchTerrainHeightMeters: nextTerrainHeightMeters,
          terrainHeightMeters: nextTerrainHeightMeters,
          scenarioAtmosphere: scenarioSession.atmosphere,
          flightState: scenarioSession.flightState,
          worldSession: {
            ...currentSession.worldSession,
            windHeading: scenarioSession.atmosphere.windHeadingDeg,
            windSpeedKmh: scenarioSession.atmosphere.windSpeedKmh,
            turbulence: scenarioSession.atmosphere.turbulence,
          },
        },
      }
    }

    return {
      didBootstrapLaunchTerrain: true,
      state: {
        ...currentSession,
        launchTerrainHeightMeters: nextTerrainHeightMeters,
        terrainHeightMeters: nextTerrainHeightMeters,
        flightState: resetFlightStateForSite(
          getFlightSite(currentSession.siteId),
          nextTerrainHeightMeters,
        ),
      },
    }
  }

  if (currentSession.terrainHeightMeters === nextTerrainHeightMeters) {
    return {
      didBootstrapLaunchTerrain: false,
      state: currentSession,
    }
  }

  return {
    didBootstrapLaunchTerrain: false,
    state: {
      ...currentSession,
      terrainHeightMeters: nextTerrainHeightMeters,
    },
  }
}

export function applySimulationKey(
  currentSession: SimulationSessionState,
  key: string,
  isPressed: boolean,
  code?: string,
): SimulationKeyChangeResult {
  let handled = false
  let nextSession = currentSession

  const controlKey = resolveHomeRowControlKey(key, code)

  if (controlKey != null) {
    const nextControls = applyHomeRowControlKey(
      currentSession.controls,
      controlKey,
      isPressed,
    )

    if (nextControls !== currentSession.controls) {
      nextSession = {
        ...nextSession,
        controls: nextControls,
      }
    }

    handled = true
  }

  if (!isPressed) {
    return {
      handled,
      state: nextSession,
    }
  }

  const typingResult = processTypingKey(nextSession.typingSession, key)

  if (typingResult.ignored) {
    return {
      handled,
      state: nextSession,
    }
  }

  return {
    handled: true,
    state: {
      ...nextSession,
      typingSession: typingResult.state,
      lastTypingResult: typingResult,
    },
  }
}

export function stepSimulationSession(
  currentSession: SimulationSessionState,
  deltaMs: number,
): SimulationSessionState {
  const site = applySnapshotToFlightSite(
    getFlightSite(currentSession.siteId),
    currentSession.scenarioId == null ? currentSession.worldDataSnapshot : null,
  )
  const countryId = getTypingCountryId(site.countryId)
  const country = COUNTRIES.find((entry) => entry.id === countryId) ?? COUNTRIES[0]
  const activityMode = getActivityMode(currentSession.activityModeId)
  const nextTypingMetrics = deriveTypingMetrics(currentSession.typingSession)
  const tickedWorldSession = tickWorldSession(currentSession.worldSession, {
    deltaMs,
    activityMode,
    countryId: country.id,
    accuracy: nextTypingMetrics.accuracy,
    streak: currentSession.typingSession.streak,
    mistakes: currentSession.typingSession.mistakes,
  })
  const effectiveAtmosphere = currentSession.scenarioAtmosphere
    ? {
        windHeadingDeg: currentSession.scenarioAtmosphere.windHeadingDeg,
        windSpeedKmh: currentSession.scenarioAtmosphere.windSpeedKmh,
        turbulence: currentSession.scenarioAtmosphere.turbulence,
      }
    : snapshotToAmbientAir(currentSession.worldDataSnapshot) ?? {
        windHeadingDeg: tickedWorldSession.windHeading,
        windSpeedKmh: tickedWorldSession.windSpeedKmh,
        turbulence: tickedWorldSession.turbulence,
      }
  const atmosphereAlignedWorldSession = currentSession.scenarioAtmosphere
    ? {
        ...tickedWorldSession,
        windHeading: currentSession.scenarioAtmosphere.windHeadingDeg,
        windSpeedKmh: currentSession.scenarioAtmosphere.windSpeedKmh,
        turbulence: currentSession.scenarioAtmosphere.turbulence,
      }
    : currentSession.worldDataSnapshot
      ? {
          ...tickedWorldSession,
          windHeading: effectiveAtmosphere.windHeadingDeg,
          windSpeedKmh: effectiveAtmosphere.windSpeedKmh,
          turbulence: effectiveAtmosphere.turbulence,
        }
      : tickedWorldSession
  const nextControls = stepHomeRowControls(currentSession.controls, deltaMs / 1000)
  const nextWorldMetrics = deriveWorldMetrics(atmosphereAlignedWorldSession, activityMode)
  const nextFlightAssist = deriveFlightAssistProfile({
    activityMode,
    typingMetrics: nextTypingMetrics,
    worldMetrics: nextWorldMetrics,
    lastInput: currentSession.typingSession.lastInput,
  })
  const nextFlightState = stepFlightState(currentSession.flightState, {
    deltaSeconds: deltaMs / 1000,
    controls: nextControls,
    site,
    terrainHeightMeters: currentSession.terrainHeightMeters,
    atmosphere: effectiveAtmosphere,
    assist: nextFlightAssist,
  })
  const routeProgress = getRouteProgress(nextFlightState.distanceKm, site.routeLengthKm)
  const nextWorldSession = {
    ...atmosphereAlignedWorldSession,
    distanceKm: nextFlightState.distanceKm,
    travelProgress: routeProgress,
  }
  const nextMissionSession = advanceMissionSession(currentSession.missionSession, {
    activityMode,
    country,
    progress: routeProgress,
    distanceKm: Number(nextFlightState.distanceKm.toFixed(1)),
    accuracy: nextTypingMetrics.accuracy,
    mistakes: currentSession.typingSession.mistakes,
  })

  return {
    ...currentSession,
    controls: nextControls,
    worldSession: nextWorldSession,
    flightState: nextFlightState,
    missionSession: nextMissionSession,
  }
}

export function consumeSimulationFrame(
  accumulatorMs: number,
  frameDeltaMs: number,
): SimulationFrameStep {
  const clampedFrameDeltaMs = clamp(
    Number.isFinite(frameDeltaMs) ? frameDeltaMs : 0,
    0,
    MAX_SIMULATION_FRAME_DELTA_MS,
  )
  const bufferedMs = accumulatorMs + clampedFrameDeltaMs
  const stepCount = Math.min(
    Math.floor(bufferedMs / FIXED_SIMULATION_STEP_MS),
    MAX_SIMULATION_STEPS_PER_FRAME,
  )
  const consumedMs = stepCount * FIXED_SIMULATION_STEP_MS
  const overflowMs = bufferedMs - consumedMs

  return {
    clampedFrameDeltaMs,
    remainingAccumulatorMs:
      stepCount === MAX_SIMULATION_STEPS_PER_FRAME
        ? Math.min(overflowMs, FIXED_SIMULATION_STEP_MS - 0.001)
        : overflowMs,
    stepCount,
  }
}
