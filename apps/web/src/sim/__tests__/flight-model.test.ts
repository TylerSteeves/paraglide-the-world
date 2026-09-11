import { describe, expect, it } from 'vitest'
import {
  createInitialFlightState,
  resetFlightStateForSite,
  stepFlightState,
} from '../flight-model'
import {
  buildControls,
  createApproachScenarioSample,
  createFlareScenarioSample,
  createGlideTransitionScenarioSample,
  createRidgePassScenarioSample,
  createThermalClimbScenarioSample,
  makeState,
  makeStepInput,
  TEST_SITE,
} from './flight-test-fixtures'

function headingDeltaDegrees(from: number, to: number) {
  return ((to - from + 540) % 360) - 180
}

describe('createInitialFlightState', () => {
  it('seeds position, altitude, and clearance from the site and terrain', () => {
    const state = createInitialFlightState(TEST_SITE, 1200)

    expect(state.latitude).toBe(TEST_SITE.latitude)
    expect(state.longitude).toBe(TEST_SITE.longitude)
    expect(state.altitudeMeters).toBe(1320)
    expect(state.terrainHeightMeters).toBe(1200)
    expect(state.groundClearanceMeters).toBe(TEST_SITE.spawnAglMeters)
    expect(state.headingDeg).toBe(TEST_SITE.prevailingWindHeadingDeg)
  })
})

describe('resetFlightStateForSite', () => {
  it('falls back to launch altitude when no terrain sample is available', () => {
    const reset = resetFlightStateForSite(TEST_SITE, null)
    const initial = createInitialFlightState(
      TEST_SITE,
      TEST_SITE.launchAltitudeMeters,
    )

    expect(reset).toEqual(initial)
  })
})

describe('stepFlightState', () => {
  it('is deterministic for the same state and input', () => {
    const state = createInitialFlightState(TEST_SITE)
    const input = makeStepInput()

    expect(stepFlightState(state, input)).toEqual(stepFlightState(state, input))
  })

  it('builds a held brake into a progressive turn instead of snapping to full bank', () => {
    const neutral = stepFlightState(
      createInitialFlightState(TEST_SITE),
      makeStepInput(),
    )
    const first = stepFlightState(
      createInitialFlightState(TEST_SITE),
      makeStepInput({
        controls: buildControls({ leftBrake: true }, 1),
      }),
    )
    const second = stepFlightState(
      first,
      makeStepInput({
        controls: buildControls({ leftBrake: true }, 2),
      }),
    )
    const third = stepFlightState(
      second,
      makeStepInput({
        controls: buildControls({ leftBrake: true }, 3),
      }),
    )

    expect(first.bankDeg).toBeLessThan(0)
    expect(Math.abs(first.bankDeg)).toBeLessThan(Math.abs(second.bankDeg))
    expect(Math.abs(second.bankDeg)).toBeLessThanOrEqual(Math.abs(third.bankDeg))
    expect(third.bankDeg).toBeLessThan(-14)
    expect(third.bankDeg).toBeGreaterThan(-30)
    expect(first.angleOfAttackDeg).toBeGreaterThan(neutral.angleOfAttackDeg)
    expect(third.loadFactor).toBeGreaterThan(1)
    expect(third.glideRatio).toBeLessThan(neutral.glideRatio)
    expect(headingDeltaDegrees(0, first.headingDeg)).toBeLessThan(0)
    expect(headingDeltaDegrees(first.headingDeg, second.headingDeg)).toBeLessThan(0)
    expect(headingDeltaDegrees(second.headingDeg, third.headingDeg)).toBeLessThan(0)
  })

  it('slows down and sinks more when the glide-transition scenario moves from trim to deep brake', () => {
    const trim = createGlideTransitionScenarioSample('trim')
    const deepBrake = createGlideTransitionScenarioSample('deep-brake')
    const neutral = stepFlightState(trim.state, trim.input)
    const symmetricBrake = stepFlightState(deepBrake.state, deepBrake.input)

    expect(symmetricBrake.bankDeg).toBeCloseTo(0, 4)
    expect(symmetricBrake.airspeedKmh).toBeLessThan(neutral.airspeedKmh)
    expect(symmetricBrake.angleOfAttackDeg).toBeGreaterThan(neutral.angleOfAttackDeg)
    expect(symmetricBrake.glideRatio).toBeLessThan(neutral.glideRatio)
    expect(symmetricBrake.verticalSpeedMetersPerSecond).toBeLessThan(
      neutral.verticalSpeedMetersPerSecond,
    )
  })

  it('lets weight shift alone roll the wing and add sink without brake input', () => {
    const neutral = stepFlightState(createInitialFlightState(TEST_SITE), makeStepInput())
    const weightShift = stepFlightState(
      createInitialFlightState(TEST_SITE),
      makeStepInput({
        controls: buildControls({
          weightRight: true,
        }),
      }),
    )

    expect(weightShift.bankDeg).toBeGreaterThan(0)
    expect(weightShift.verticalSpeedMetersPerSecond).toBeLessThan(
      neutral.verticalSpeedMetersPerSecond,
    )
  })

  it('trades speed for sink when the glide-transition scenario moves from trim to speed bar', () => {
    const trim = createGlideTransitionScenarioSample('trim')
    const speedBar = createGlideTransitionScenarioSample('speed-bar')
    const calm = stepFlightState(trim.state, trim.input)
    const boosted = stepFlightState(speedBar.state, speedBar.input)

    expect(boosted.airspeedKmh).toBeGreaterThan(calm.airspeedKmh)
    expect(boosted.pitchDeg).toBeGreaterThan(calm.pitchDeg)
    expect(boosted.verticalSpeedMetersPerSecond).toBeLessThan(
      calm.verticalSpeedMetersPerSecond,
    )
  })

  it('keeps the glider above the terrain floor on a bad approach', () => {
    const next = stepFlightState(
      makeState({
        altitudeMeters: 50,
        terrainHeightMeters: 500,
        groundClearanceMeters: -450,
      }),
      makeStepInput({
        terrainHeightMeters: 500,
      }),
    )

    expect(next.altitudeMeters).toBe(500)
    expect(next.groundClearanceMeters).toBe(0)
    expect(next.flightPhase === 'landed' || next.flightPhase === 'crashed').toBe(true)
  })

  it('gains ground effect while the wind gradient weakens closer to the terrain', () => {
    const atmosphere = {
      windHeadingDeg: 0,
      windSpeedKmh: 20,
      turbulence: 0,
    }

    const higherState = makeState({
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
    })
    const lowerState = makeState({
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
    })

    const higher = stepFlightState(
      higherState,
      makeStepInput({
        site: TEST_SITE,
        atmosphere,
      }),
    )
    const lower = stepFlightState(
      lowerState,
      makeStepInput({
        site: TEST_SITE,
        atmosphere,
      }),
    )

    expect(lower.debug.windGradientFactor).toBeLessThan(
      higher.debug.windGradientFactor,
    )
    expect(lower.debug.groundEffectLiftMetersPerSecond).toBeGreaterThan(
      higher.debug.groundEffectLiftMetersPerSecond,
    )
    expect(lower.verticalSpeedMetersPerSecond).toBeGreaterThan(
      higher.verticalSpeedMetersPerSecond,
    )
    expect(lower.groundSpeedKmh).toBeLessThan(higher.groundSpeedKmh)
  })

  it('adds thermal lift when the thermal-climb scenario centers the wing in a seeded core', () => {
    const empty = stepFlightState(createInitialFlightState(TEST_SITE), makeStepInput())
    const thermal = createThermalClimbScenarioSample()
    const climbed = stepFlightState(thermal.state, thermal.input)

    expect(climbed.thermalLiftMetersPerSecond).toBeGreaterThan(
      empty.thermalLiftMetersPerSecond,
    )
    expect(climbed.verticalSpeedMetersPerSecond).toBeGreaterThan(
      empty.verticalSpeedMetersPerSecond,
    )
  })

  it('rewards the windward side of the ridge-pass scenario and punishes the lee side', () => {
    const windward = createRidgePassScenarioSample('windward')
    const lee = createRidgePassScenarioSample('lee')
    const windwardResult = stepFlightState(windward.state, windward.input)
    const leeResult = stepFlightState(lee.state, lee.input)

    expect(windwardResult.ridgeLiftMetersPerSecond).toBeGreaterThan(0)
    expect(leeResult.airMassSinkMetersPerSecond).toBeGreaterThan(0)
    expect(windwardResult.verticalSpeedMetersPerSecond).toBeGreaterThan(
      leeResult.verticalSpeedMetersPerSecond,
    )
  })

  it('switches into approach phase and exposes landing guidance in the approach scenario', () => {
    const approach = createApproachScenarioSample()
    const next = stepFlightState(approach.state, approach.input)

    expect(next.flightPhase).toBe('approach')
    expect(next.landingZoneDistanceMeters).not.toBeNull()
    expect(next.landingApproachErrorDeg).not.toBeNull()
  })

  it('uses flare timing to improve touchdown quality in the flare scenario', () => {
    const lateFlare = createFlareScenarioSample('late')
    const timedFlare = createFlareScenarioSample('timed')
    const noFlare = stepFlightState(lateFlare.state, lateFlare.input)
    const flared = stepFlightState(timedFlare.state, timedFlare.input)

    expect(flared.flareEffectiveness).toBeGreaterThan(noFlare.flareEffectiveness)
    expect(flared.flightPhase === 'landed' || flared.flightPhase === 'crashed').toBe(true)
    expect(flared.landingRating).not.toBe('none')
    expect(flared.landingRating).not.toBe('crash')
  })
})
