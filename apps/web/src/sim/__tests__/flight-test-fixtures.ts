import {
  type AmbientAirState,
  createInitialFlightState,
  type FlightSimState,
  type FlightStepInput,
} from '../flight-model'
import { offsetPositionByMeters } from '../../flight/geometry'
import {
  DEFAULT_HOME_ROW_CONTROLS,
  stepHomeRowControls,
  type HomeRowControlState,
} from '../home-row-controls'
import type { FlightSite } from '../site-data'

export const TEST_SITE: FlightSite = {
  id: 'test-site',
  name: 'Test Site',
  countryId: 'italy',
  region: 'Test Range',
  country: 'Testland',
  description: 'Deterministic fixture used to exercise the flight model.',
  latitude: 46,
  longitude: 7,
  launchAltitudeMeters: 1000,
  spawnAglMeters: 120,
  prevailingWindHeadingDeg: 0,
  windSpeedKmh: 0,
  baseRidgeLiftMetersPerSecond: 0,
  routeLengthKm: 10,
  thermals: [],
}

export const THERMAL_CLIMB_SITE: FlightSite = {
  ...TEST_SITE,
  thermals: [
    {
      id: 'core',
      latitude: 46,
      longitude: 7,
      radiusMeters: 1500,
      liftMetersPerSecond: 2.5,
    },
  ],
}

export const RIDGE_PASS_SITE: FlightSite = {
  ...TEST_SITE,
  ridge: {
    latitude: TEST_SITE.latitude,
    longitude: TEST_SITE.longitude,
    axisHeadingDeg: 0,
    lengthMeters: 2200,
    windwardDepthMeters: 420,
    leeDepthMeters: 520,
    peakLiftMetersPerSecond: 1.8,
    leeSinkMetersPerSecond: 1,
  },
}

export const LANDING_SITE: FlightSite = {
  ...TEST_SITE,
  landingZone: {
    latitude: TEST_SITE.latitude,
    longitude: TEST_SITE.longitude,
    headingDeg: 0,
    lengthMeters: 240,
    widthMeters: 80,
  },
}

export type FlightScenarioSample = {
  state: FlightSimState
  input: FlightStepInput
}

export function makeStepInput(
  overrides: Partial<{
    deltaSeconds: number
    controls: HomeRowControlState
    site: FlightSite
    terrainHeightMeters: number | null
    atmosphere: AmbientAirState | null
  }> = {},
): FlightStepInput {
  return {
    deltaSeconds: 0.2,
    controls: DEFAULT_HOME_ROW_CONTROLS,
    site: TEST_SITE,
    terrainHeightMeters: TEST_SITE.launchAltitudeMeters,
    atmosphere: null,
    ...overrides,
  }
}

export function makeState(
  overrides: Partial<FlightSimState> = {},
): FlightSimState {
  return {
    latitude: TEST_SITE.latitude,
    longitude: TEST_SITE.longitude,
    altitudeMeters: 1120,
    terrainHeightMeters: TEST_SITE.launchAltitudeMeters,
    headingDeg: 0,
    bankDeg: 0,
    pitchDeg: -6,
    airspeedKmh: 36,
    groundSpeedKmh: 36,
    verticalSpeedMetersPerSecond: 0,
    angleOfAttackDeg: 5.8,
    loadFactor: 1,
    glideRatio: 9,
    ridgeLiftMetersPerSecond: 0,
    thermalLiftMetersPerSecond: 0,
    airMassSinkMetersPerSecond: 0,
    groundClearanceMeters: 120,
    distanceKm: 0,
    elapsedSeconds: 0,
    turnRateDegPerSecond: 0,
    stallWarning: 0,
    flareEffectiveness: 0,
    landingZoneDistanceMeters: null,
    landingApproachErrorDeg: null,
    landingRating: 'none',
    flightPhase: 'soaring',
    debug: {
      airDensityKgPerCubicMeter: 1.225,
      windGradientFactor: 1,
      groundEffectLiftMetersPerSecond: 0,
      baseSinkMetersPerSecond: 0,
      inducedTurnSinkMetersPerSecond: 0,
      brakeSinkMetersPerSecond: 0,
      stallSinkMetersPerSecond: 0,
      turbulenceLiftMetersPerSecond: 0,
      flareLiftMetersPerSecond: 0,
      totalSinkMetersPerSecond: 0,
    },
    ...overrides,
  }
}

function makeOffsetState(
  baseState: FlightSimState,
  eastMeters: number,
  northMeters: number,
  overrides: Partial<FlightSimState> = {},
): FlightSimState {
  const position = offsetPositionByMeters(
    baseState.latitude,
    baseState.longitude,
    eastMeters,
    northMeters,
  )

  return {
    ...baseState,
    ...position,
    ...overrides,
  }
}

export function buildControls(
  overrides: Partial<HomeRowControlState> = {},
  steps = 1,
  deltaSeconds = 0.2,
) {
  let controls: HomeRowControlState = {
    ...DEFAULT_HOME_ROW_CONTROLS,
    ...overrides,
  }

  for (let index = 0; index < steps; index += 1) {
    controls = stepHomeRowControls(controls, deltaSeconds)
  }

  return controls
}

export function createRidgePassScenarioSample(
  side: 'windward' | 'lee',
): FlightScenarioSample {
  const atmosphere = {
    windHeadingDeg: 90,
    windSpeedKmh: 24,
    turbulence: 0,
  }
  const longitudeOffset = (side === 'windward' ? -280 : 280) / 77_000

  return {
    state: makeState({
      longitude: RIDGE_PASS_SITE.longitude + longitudeOffset,
    }),
    input: makeStepInput({
      site: RIDGE_PASS_SITE,
      atmosphere,
    }),
  }
}

export function createThermalClimbScenarioSample(): FlightScenarioSample {
  return {
    state: createInitialFlightState(THERMAL_CLIMB_SITE),
    input: makeStepInput({
      site: THERMAL_CLIMB_SITE,
    }),
  }
}

export function createThermalClimbEdgeScenarioSample(): FlightScenarioSample {
  const centered = createInitialFlightState(THERMAL_CLIMB_SITE)

  return {
    state: makeOffsetState(centered, 680, 0),
    input: makeStepInput({
      site: THERMAL_CLIMB_SITE,
    }),
  }
}

export function createGlideTransitionScenarioSample(
  mode: 'trim' | 'speed-bar' | 'deep-brake',
): FlightScenarioSample {
  const controls =
    mode === 'speed-bar'
      ? buildControls({ speedBar: true })
      : mode === 'deep-brake'
        ? buildControls({ leftBrake: true, rightBrake: true })
        : DEFAULT_HOME_ROW_CONTROLS

  return {
    state: createInitialFlightState(TEST_SITE),
    input: makeStepInput({ controls }),
  }
}

export function createApproachScenarioSample(): FlightScenarioSample {
  return {
    state: makeState({
      altitudeMeters: 1004,
      terrainHeightMeters: 1000,
      groundClearanceMeters: 4,
      airspeedKmh: 29,
      groundSpeedKmh: 26,
      verticalSpeedMetersPerSecond: -1.2,
      headingDeg: 18,
      elapsedSeconds: 32,
      flightPhase: 'soaring',
    }),
    input: makeStepInput({
      site: LANDING_SITE,
      terrainHeightMeters: 1000,
      atmosphere: {
        windHeadingDeg: 0,
        windSpeedKmh: 12,
        turbulence: 0.05,
      },
    }),
  }
}

export function createCrosswindApproachScenarioSample(): FlightScenarioSample {
  return {
    state: makeState({
      altitudeMeters: 1004,
      terrainHeightMeters: 1000,
      groundClearanceMeters: 4,
      airspeedKmh: 29,
      groundSpeedKmh: 26,
      verticalSpeedMetersPerSecond: -1.2,
      headingDeg: 58,
      elapsedSeconds: 32,
      flightPhase: 'soaring',
    }),
    input: makeStepInput({
      site: LANDING_SITE,
      terrainHeightMeters: 1000,
      atmosphere: {
        windHeadingDeg: 90,
        windSpeedKmh: 12,
        turbulence: 0.05,
      },
    }),
  }
}

export function createFlareScenarioSample(
  mode: 'late' | 'timed',
): FlightScenarioSample {
  return {
    state: makeState({
      altitudeMeters: 1000.35,
      terrainHeightMeters: 1000,
      groundClearanceMeters: 0.35,
      airspeedKmh: 28,
      groundSpeedKmh: 28,
      elapsedSeconds: 36,
      flightPhase: 'approach',
    }),
    input: makeStepInput({
      site: LANDING_SITE,
      controls:
        mode === 'timed'
          ? buildControls({ leftBrake: true, rightBrake: true }, 2)
          : DEFAULT_HOME_ROW_CONTROLS,
    }),
  }
}
