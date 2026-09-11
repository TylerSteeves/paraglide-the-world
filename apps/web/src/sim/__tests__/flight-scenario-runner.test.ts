import { describe, expect, it } from 'vitest'
import { createInitialFlightState, type LandingRating } from '../flight-model'
import {
  createApproachScenarioSample,
  createCrosswindApproachScenarioSample,
  createFlareScenarioSample,
  createGlideTransitionScenarioSample,
  createRidgePassScenarioSample,
  createThermalClimbEdgeScenarioSample,
  createThermalClimbScenarioSample,
  makeState,
  makeStepInput,
  TEST_SITE,
} from './flight-test-fixtures'
import {
  runConstantFlightScenario,
} from './flight-scenario-runner'

function landingRatingRank(rating: LandingRating) {
  switch (rating) {
    case 'smooth':
      return 0
    case 'firm':
      return 1
    case 'hard':
      return 2
    case 'crash':
      return 3
    case 'none':
    default:
      return 4
  }
}

describe('runFlightScenario', () => {
  it('is deterministic across repeated multi-frame runs', () => {
    const scenario = createGlideTransitionScenarioSample('speed-bar')

    const first = runConstantFlightScenario(
      scenario.state,
      12,
      scenario.input,
    )
    const second = runConstantFlightScenario(
      scenario.state,
      12,
      scenario.input,
    )

    expect(first.states).toEqual(second.states)
    expect(first.summary).toEqual(second.summary)
  })
})

describe('flight scenario acceptance checks', () => {
  it('keeps ridge-pass lift higher on the windward side than the lee side', () => {
    const windward = createRidgePassScenarioSample('windward')
    const lee = createRidgePassScenarioSample('lee')

    const windwardRun = runConstantFlightScenario(
      windward.state,
      24,
      windward.input,
    )
    const leeRun = runConstantFlightScenario(lee.state, 24, lee.input)

    expect(windwardRun.summary.peakRidgeLiftMetersPerSecond).toBeGreaterThan(0)
    expect(windwardRun.summary.averageVerticalSpeedMetersPerSecond).toBeGreaterThan(
      leeRun.summary.averageVerticalSpeedMetersPerSecond,
    )
    expect(windwardRun.summary.peakRidgeLiftMetersPerSecond).toBeGreaterThan(
      leeRun.summary.peakRidgeLiftMetersPerSecond,
    )
  })

  it('gives thermal core centering more climb than flying the edge', () => {
    const centered = createThermalClimbScenarioSample()
    const edge = createThermalClimbEdgeScenarioSample()

    const centeredRun = runConstantFlightScenario(
      centered.state,
      20,
      centered.input,
    )
    const edgeRun = runConstantFlightScenario(edge.state, 20, edge.input)

    expect(centeredRun.summary.peakThermalLiftMetersPerSecond).toBeGreaterThan(
      edgeRun.summary.peakThermalLiftMetersPerSecond,
    )
    expect(centeredRun.summary.averageVerticalSpeedMetersPerSecond).toBeGreaterThan(
      edgeRun.summary.averageVerticalSpeedMetersPerSecond,
    )
    expect(centeredRun.summary.minGroundClearanceMeters).toBeGreaterThanOrEqual(
      edgeRun.summary.minGroundClearanceMeters,
    )
  })

  it('keeps glide transition modes distinct from one another', () => {
    const trim = createGlideTransitionScenarioSample('trim')
    const speedBar = createGlideTransitionScenarioSample('speed-bar')
    const deepBrake = createGlideTransitionScenarioSample('deep-brake')

    const trimRun = runConstantFlightScenario(trim.state, 16, trim.input)
    const speedBarRun = runConstantFlightScenario(speedBar.state, 16, speedBar.input)
    const deepBrakeRun = runConstantFlightScenario(
      deepBrake.state,
      16,
      deepBrake.input,
    )

    expect(speedBarRun.summary.averageAirspeedKmh).toBeGreaterThan(
      trimRun.summary.averageAirspeedKmh,
    )
    expect(deepBrakeRun.summary.averageAirspeedKmh).toBeLessThan(
      trimRun.summary.averageAirspeedKmh,
    )
    expect(deepBrakeRun.summary.peakStallWarning).toBeGreaterThanOrEqual(
      speedBarRun.summary.peakStallWarning,
    )
  })

  it('makes approach alignment matter before touchdown', () => {
    const aligned = createApproachScenarioSample()
    const crosswind = createCrosswindApproachScenarioSample()
    const alignedStart = {
      ...aligned.state,
      altitudeMeters: 1001,
      groundClearanceMeters: 1,
    }
    const crosswindStart = {
      ...crosswind.state,
      altitudeMeters: 1001,
      groundClearanceMeters: 1,
    }

    const alignedRun = runConstantFlightScenario(alignedStart, 16, aligned.input)
    const crosswindRun = runConstantFlightScenario(crosswindStart, 16, crosswind.input)

    expect(alignedRun.summary.finalLandingRating).not.toBe('none')
    expect(crosswindRun.summary.finalLandingRating).not.toBe('none')
    expect(alignedRun.summary.finalLandingApproachErrorDeg).toBeLessThanOrEqual(
      crosswindRun.summary.finalLandingApproachErrorDeg ?? Number.POSITIVE_INFINITY,
    )
    expect(
      landingRatingRank(alignedRun.summary.finalLandingRating),
    ).toBeLessThanOrEqual(
      landingRatingRank(crosswindRun.summary.finalLandingRating),
    )
  })

  it('rewards a timed flare more than a late flare', () => {
    const lateFlare = createFlareScenarioSample('late')
    const timedFlare = createFlareScenarioSample('timed')

    const lateRun = runConstantFlightScenario(lateFlare.state, 8, lateFlare.input)
    const timedRun = runConstantFlightScenario(
      timedFlare.state,
      8,
      timedFlare.input,
    )

    expect(timedRun.summary.finalLandingRating).not.toBe('none')
    expect(
      landingRatingRank(timedRun.summary.finalLandingRating),
    ).toBeLessThanOrEqual(landingRatingRank(lateRun.summary.finalLandingRating))
    expect(timedRun.summary.finalLandingZoneDistanceMeters).toBeLessThanOrEqual(
      lateRun.summary.finalLandingZoneDistanceMeters ?? Number.POSITIVE_INFINITY,
    )
  })

  it('carries near-ground lift and wind-gradient telemetry through scenario runs', () => {
    const atmosphere = {
      windHeadingDeg: 0,
      windSpeedKmh: 20,
      turbulence: 0,
    }
    const frameInput = makeStepInput({
      site: TEST_SITE,
      atmosphere,
    })
    const higherRun = runConstantFlightScenario(
      makeState({
        altitudeMeters: 1040,
        terrainHeightMeters: 1000,
        groundClearanceMeters: 40,
        airspeedKmh: 40,
        groundSpeedKmh: 40,
        verticalSpeedMetersPerSecond: -1,
        headingDeg: 0,
        pitchDeg: -6,
        elapsedSeconds: 20,
        flightPhase: 'soaring',
      }),
      1,
      frameInput,
    )
    const lowerRun = runConstantFlightScenario(
      makeState({
        altitudeMeters: 1002.6,
        terrainHeightMeters: 1000,
        groundClearanceMeters: 2.6,
        airspeedKmh: 40,
        groundSpeedKmh: 40,
        verticalSpeedMetersPerSecond: -1,
        headingDeg: 0,
        pitchDeg: -6,
        elapsedSeconds: 20,
        flightPhase: 'soaring',
      }),
      1,
      frameInput,
    )

    expect(lowerRun.states[1].debug.windGradientFactor).toBeLessThan(
      higherRun.states[1].debug.windGradientFactor,
    )
    expect(lowerRun.states[1].debug.groundEffectLiftMetersPerSecond).toBeGreaterThan(
      higherRun.states[1].debug.groundEffectLiftMetersPerSecond,
    )
    expect(lowerRun.summary.minGroundClearanceMeters).toBeLessThan(
      higherRun.summary.minGroundClearanceMeters,
    )
  })
})

describe('prototype baseline', () => {
  it('still seeds the standard flight state from the test site', () => {
    const state = createInitialFlightState(TEST_SITE)
    expect(state.flightPhase).toBe('launch')
    expect(state.airspeedKmh).toBeGreaterThan(0)
  })
})
