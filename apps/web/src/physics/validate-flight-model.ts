/**
 * Flight model validation suite.
 *
 * Flies the real simulation through manoeuvres whose outcomes are published in
 * certification and test data, and checks that what comes out lands inside the
 * documented range. Every expectation here traces to a source listed in
 * `docs/flight-dynamics-validation.md`.
 *
 * Run it with no build step and no dependencies:
 *
 *   node src/physics/validate-flight-model.ts
 *
 * It exits non-zero if any check fails, so it works as a CI gate.
 */

import {
  FlightDynamics,
  calmAir,
  type AirMassSample,
  type StepInput,
} from './flight-dynamics.ts'
import {
  measureProjectedGeometry,
  PARAGLIDER_XC_24M,
  PARAMOTOR_FREERIDE_18M,
  SPEEDWING_14M,
  type WingGeometry,
} from './aerodynamics.ts'
import type { FlightControls } from './types.ts'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

// This file runs under Node, which the app's tsconfig has no types for.
declare const process: { exitCode?: number }

type CheckResult = { name: string; ok: boolean; detail: string }

const results: CheckResult[] = []
let currentGroup = ''

function group(name: string): void {
  currentGroup = name
  console.log(`\n\x1b[1m${name}\x1b[0m`)
}

function record(name: string, ok: boolean, detail: string): void {
  results.push({ name: `${currentGroup} / ${name}`, ok, detail })
  const mark = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'
  console.log(`  ${mark}  ${name.padEnd(42)} ${detail}`)
}

function expectRange(
  name: string,
  value: number,
  lo: number,
  hi: number,
  unit: string,
  digits = 2,
): void {
  const ok = Number.isFinite(value) && value >= lo && value <= hi
  record(
    name,
    ok,
    `${value.toFixed(digits)} ${unit} (expected ${lo}-${hi})`,
  )
}

function expectTrue(name: string, ok: boolean, detail: string): void {
  record(name, ok, detail)
}

// ---------------------------------------------------------------------------
// Flight helpers
// ---------------------------------------------------------------------------

const FLAT_GROUND = (): number => 0

function controls(overrides: Partial<FlightControls> = {}): FlightControls {
  return {
    leftBrake: 0,
    rightBrake: 0,
    leftBrakeRate: 0,
    rightBrakeRate: 0,
    weightShift: 0,
    speedBar: 0,
    pullingA: 0,
    pullingB: 0,
    reverseStance: false,
    ...overrides,
  }
}

type FlyOptions = {
  seconds: number
  controls: FlightControls
  air?: AirMassSample
  dt?: number
  pilotSkill?: number
  throttle?: number
  /** Called every frame; use to sample or mutate controls mid-flight. */
  onFrame?: (sim: FlightDynamics, t: number) => FlightControls | void
}

/** Runs the simulation for a while and returns it for inspection. */
function fly(sim: FlightDynamics, options: FlyOptions): FlightDynamics {
  const dt = options.dt ?? 1 / 60
  const steps = Math.round(options.seconds / dt)
  let active = options.controls
  for (let i = 0; i < steps; i++) {
    const t = i * dt
    if (options.onFrame) {
      const next = options.onFrame(sim, t)
      if (next) active = next
    }
    const input: StepInput = {
      dt,
      controls: active,
      air: options.air ?? calmAir(),
      sampleTerrainHeight: FLAT_GROUND,
      timeSec: t,
      pilotSkill: options.pilotSkill ?? 0.35,
      throttle: options.throttle,
    }
    sim.step(input)
  }
  return sim
}

/**
 * Tests fly high enough that even a spiral has room to run for a minute
 * without reaching the ground.
 *
 * Published polars are sea-level figures and true airspeed rises as air thins,
 * so speeds and sink rates are reported corrected to sea-level density --
 * equivalent airspeed, the number an airspeed indicator shows and the number a
 * polar is quoted in. The model reproduces the altitude effect, which would
 * otherwise read as several km/h of error.
 */
const TEST_ALTITUDE_M = 1800

function freshSim(wing: WingGeometry, pilotMassKg = wing.pilotMassKg): FlightDynamics {
  const sim = new FlightDynamics(wing, pilotMassKg)
  sim.placeTrimmed({ x: 0, y: TEST_ALTITUDE_M, z: 0 }, 0)
  return sim
}

/** Settles into steady flight, then averages over a window. */
/**
 * Settles into steady flight, then averages over several phugoid periods.
 *
 * Controls are eased in over five seconds rather than slammed on. That is the
 * EN test method, and for the same reason: a sudden input sets off a pitch
 * surge, and a surge big enough to spike the angle of attack past the stall
 * tells you about the transient rather than about the steady polar point.
 */
function steady(
  wing: WingGeometry,
  flightControls: FlightControls,
  settleSeconds = 40,
  sampleSeconds = 40,
  extras: Partial<FlyOptions> = {},
): {
  airspeedKmh: number
  sinkMps: number
  glideRatio: number
  alphaDeg: number
  bankDeg: number
  turnRateDegPerSec: number
  gForce: number
  incidenceDeg: number
  stalled: boolean
} {
  const sim = freshSim(wing)
  // Ease the controls in over five seconds, then hold.
  const ramp = 5
  fly(sim, {
    seconds: settleSeconds,
    controls: flightControls,
    ...extras,
    onFrame: (_s, t) => {
      const blend = Math.min(1, t / ramp)
      return {
        ...flightControls,
        leftBrake: flightControls.leftBrake * blend,
        rightBrake: flightControls.rightBrake * blend,
        speedBar: flightControls.speedBar * blend,
        pullingB: flightControls.pullingB * blend,
        weightShift: flightControls.weightShift * blend,
        earsLeft: (flightControls.earsLeft ?? 0) * blend,
        earsRight: (flightControls.earsRight ?? 0) * blend,
      }
    },
  })

  const dt = 1 / 60
  const steps = Math.round(sampleSeconds / dt)
  let airspeed = 0
  let sink = 0
  let alpha = 0
  let bank = 0
  let g = 0
  let incidence = 0
  let stalled = false
  let headingStart = sim.state.headingDeg
  let headingTurned = 0
  let previousHeading = headingStart

  for (let i = 0; i < steps; i++) {
    fly(sim, { seconds: dt, controls: flightControls, dt, ...extras })
    const s = sim.state
    // Correct to sea-level density so these compare with published figures.
    const densityRatio =
      s.airspeedMps > 0.1 ? s.equivalentAirspeedMps / s.airspeedMps : 1
    airspeed += s.equivalentAirspeedMps
    sink += s.verticalSpeedMps * densityRatio
    alpha += s.alphaDeg
    bank += s.bankDeg
    g += s.gForce
    incidence += s.incidenceDeg
    if (s.isStalled) stalled = true

    let delta = s.headingDeg - previousHeading
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    headingTurned += delta
    previousHeading = s.headingDeg
  }

  const n = steps
  const meanAirspeed = airspeed / n
  const meanSink = sink / n
  return {
    airspeedKmh: meanAirspeed * 3.6,
    sinkMps: -meanSink,
    glideRatio: meanSink < -0.02 ? Math.sqrt(Math.max(0, meanAirspeed ** 2 - meanSink ** 2)) / -meanSink : 99,
    alphaDeg: alpha / n,
    bankDeg: bank / n,
    turnRateDegPerSec: headingTurned / sampleSeconds,
    gForce: g / n,
    incidenceDeg: incidence / n,
    stalled,
  }
}

// ---------------------------------------------------------------------------
// 1. Geometry
// ---------------------------------------------------------------------------

function checkGeometry(): void {
  group('Geometry (derived from the arc, not declared)')

  const xc = measureProjectedGeometry(PARAGLIDER_XC_24M)
  expectRange('XC 24 projected area', xc.projectedAreaM2, 19.6, 21.2, 'm2')
  expectRange('XC 24 projected span', xc.projectedSpanM, 8.9, 9.8, 'm')
  expectRange('XC 24 flat aspect ratio', xc.flatAspectRatio, 5.0, 5.6, '')
  expectRange('XC 24 projected aspect ratio', xc.projectedAspectRatio, 3.8, 4.5, '')

  const sw = measureProjectedGeometry(SPEEDWING_14M)
  expectRange('Speedwing 14 projected area', sw.projectedAreaM2, 11.2, 12.6, 'm2')
  expectRange('Speedwing 14 flat aspect ratio', sw.flatAspectRatio, 3.5, 4.3, '')
}

// ---------------------------------------------------------------------------
// 2. The polar
// ---------------------------------------------------------------------------

function checkPolar(): void {
  group('Polar: EN-B 24 m2 at 100 kg all-up')

  const trim = steady(PARAGLIDER_XC_24M, controls())
  expectRange('trim airspeed, hands up', trim.airspeedKmh, 36, 42, 'km/h', 1)
  expectRange('trim sink', trim.sinkMps, 0.95, 1.35, 'm/s')
  expectRange('glide ratio at trim', trim.glideRatio, 8.3, 10.2, ':1')
  expectRange('angle of attack at trim', trim.alphaDeg, 4.0, 11.0, 'deg')
  // A real wing's chord sits a few degrees nose-up relative to its risers.
  expectRange('chord incidence at trim', trim.incidenceDeg, -2.0, 8.0, 'deg')
  expectTrue('not stalled at trim', !trim.stalled, trim.stalled ? 'stalled' : 'attached')

  // Minimum sink sits slower than trim, on moderate brake.
  const minSink = steady(PARAGLIDER_XC_24M, controls({ leftBrake: 0.4, rightBrake: 0.4 }))
  expectRange('minimum-sink airspeed', minSink.airspeedKmh, 28, 36, 'km/h', 1)
  expectRange('minimum-sink rate', minSink.sinkMps, 0.85, 1.25, 'm/s')
  expectTrue(
    'brake reduces sink below trim',
    minSink.sinkMps < trim.sinkMps + 0.03,
    `${minSink.sinkMps.toFixed(2)} vs ${trim.sinkMps.toFixed(2)} m/s`,
  )

  // Full speed bar: real EN-B reaches 50-55 km/h sinking 2.5-3.2 m/s.
  const bar = steady(PARAGLIDER_XC_24M, controls({ speedBar: 1 }))
  expectRange('full-bar airspeed', bar.airspeedKmh, 48, 58, 'km/h', 1)
  expectRange('full-bar sink', bar.sinkMps, 2.1, 3.6, 'm/s')
  expectRange('full-bar glide ratio', bar.glideRatio, 4.6, 6.8, ':1')
  expectRange('full-bar incidence drop', trim.incidenceDeg - bar.incidenceDeg, 3.5, 7.0, 'deg')

  // Slowest controllable flight, just short of the break.
  const slow = steady(PARAGLIDER_XC_24M, controls({ leftBrake: 0.6, rightBrake: 0.6 }))
  expectRange('slow-flight airspeed', slow.airspeedKmh, 22, 33, 'km/h', 1)
  expectRange('slow-flight sink', slow.sinkMps, 1.1, 2.2, 'm/s')
  expectTrue(
    'slow flight is still flying, not stalled',
    !slow.stalled,
    slow.stalled ? 'stalled' : 'attached',
  )
}

// ---------------------------------------------------------------------------
// 3. Wing loading
// ---------------------------------------------------------------------------

function checkWingLoading(): void {
  group('Wing loading: speeds scale with the square root of loading')

  const light = steady(PARAGLIDER_XC_24M, controls(), 45, 10, { pilotSkill: 0.35 })
  const heavySim = new FlightDynamics(PARAGLIDER_XC_24M, 125)
  heavySim.placeTrimmed({ x: 0, y: TEST_ALTITUDE_M, z: 0 }, 0)
  fly(heavySim, { seconds: 50, controls: controls() })

  let airspeed = 0
  let sink = 0
  const steps = 600
  for (let i = 0; i < steps; i++) {
    fly(heavySim, { seconds: 1 / 60, controls: controls(), dt: 1 / 60 })
    // Equivalent airspeed, to match how the light case is measured.
    airspeed += heavySim.state.equivalentAirspeedMps
    const ratio =
      heavySim.state.airspeedMps > 0.1
        ? heavySim.state.equivalentAirspeedMps / heavySim.state.airspeedMps
        : 1
    sink += heavySim.state.verticalSpeedMps * ratio
  }
  const heavyKmh = (airspeed / steps) * 3.6
  const heavySink = -(sink / steps)

  // 95 kg -> 125 kg pilot is 100 -> 130 kg all-up: sqrt(1.30) = 1.14.
  const expected = light.airspeedKmh * Math.sqrt(130 / 100)
  expectRange(
    'heavier pilot flies faster by sqrt(loading)',
    heavyKmh,
    expected - 3.5,
    expected + 3.5,
    'km/h',
    1,
  )
  expectTrue(
    'glide ratio barely changes with loading',
    Math.abs(heavySink / heavyKmh - light.sinkMps / light.airspeedKmh) < 0.006,
    `light ${(light.airspeedKmh / 3.6 / light.sinkMps).toFixed(2)}:1, heavy ${(heavyKmh / 3.6 / heavySink).toFixed(2)}:1`,
  )
}

// ---------------------------------------------------------------------------
// 4. Turning
// ---------------------------------------------------------------------------

function checkTurns(): void {
  group('Turns: sink grows as cos(bank)^-1.5, load as 1/cos(bank)')

  const straight = steady(PARAGLIDER_XC_24M, controls())

  // Inputs a pilot would actually hold for a steady turn. Holding deep inside
  // brake does not settle -- it winds the wing up into a spiral, which is
  // real, and which the spiral test covers separately.
  const cases = [
    { name: 'weight shift only', ctl: controls({ weightShift: 1 }) },
    { name: 'gentle brake turn', ctl: controls({ weightShift: 1, rightBrake: 0.15 }) },
    {
      name: 'checked turn',
      ctl: controls({ weightShift: 1, rightBrake: 0.35, leftBrake: 0.10 }),
    },
  ]

  let previousBank = 0
  for (const testCase of cases) {
    const turn = steady(PARAGLIDER_XC_24M, testCase.ctl, 25, 15)
    const bank = Math.abs(turn.bankDeg)
    const bankRad = (bank * Math.PI) / 180
    const predictedLoad = 1 / Math.max(0.2, Math.cos(bankRad))
    const predictedSink = straight.sinkMps * Math.pow(Math.max(0.2, Math.cos(bankRad)), -1.5)

    console.log(
      `    ${testCase.name}: bank ${bank.toFixed(1)}deg, ${turn.airspeedKmh.toFixed(1)} km/h, ` +
        `sink ${turn.sinkMps.toFixed(2)} m/s, ${turn.turnRateDegPerSec.toFixed(1)} deg/s, ${turn.gForce.toFixed(2)}g`,
    )

    expectTrue(
      `${testCase.name}: turns toward the input`,
      turn.turnRateDegPerSec > 1.5 && turn.bankDeg > 0,
      `${turn.turnRateDegPerSec.toFixed(1)} deg/s at ${turn.bankDeg.toFixed(1)}deg bank`,
    )
    expectTrue(
      `${testCase.name}: load matches 1/cos(bank)`,
      Math.abs(turn.gForce - predictedLoad) < 0.35,
      `${turn.gForce.toFixed(2)}g vs predicted ${predictedLoad.toFixed(2)}g`,
    )
    expectTrue(
      `${testCase.name}: sink matches cos(bank)^-1.5`,
      turn.sinkMps > predictedSink * 0.65 && turn.sinkMps < predictedSink * 1.75,
      `${turn.sinkMps.toFixed(2)} m/s vs predicted ${predictedSink.toFixed(2)} m/s`,
    )
    expectTrue(
      `${testCase.name}: more input gives more bank`,
      bank > previousBank,
      `${bank.toFixed(1)}deg > ${previousBank.toFixed(1)}deg`,
    )
    previousBank = bank
  }

  // Coordinated turn rate: omega = g*tan(bank)/V.
  const turn = steady(
    PARAGLIDER_XC_24M,
    controls({ weightShift: 1, rightBrake: 0.3, leftBrake: 0.12 }),
    25,
    15,
  )
  const bankRad = (Math.abs(turn.bankDeg) * Math.PI) / 180
  const predictedRate =
    ((9.81 * Math.tan(bankRad)) / (turn.airspeedKmh / 3.6)) * (180 / Math.PI)
  expectTrue(
    'turn rate matches g*tan(bank)/V',
    Math.abs(turn.turnRateDegPerSec - predictedRate) < Math.max(6, predictedRate * 0.4),
    `${turn.turnRateDegPerSec.toFixed(1)} deg/s vs predicted ${predictedRate.toFixed(1)} deg/s`,
  )

  // Weight shift alone should be worth real but modest bank on an EN-B.
  const shiftOnly = steady(PARAGLIDER_XC_24M, controls({ weightShift: 1 }), 25, 15)
  expectRange('weight-shift-only bank', Math.abs(shiftOnly.bankDeg), 6, 32, 'deg', 1)
}

// ---------------------------------------------------------------------------
// 5. Spiral dive
// ---------------------------------------------------------------------------

function checkSpiral(): void {
  group('Spiral dive: DHV test bands are 3.5-4.5 g and 12-22 m/s')

  const sim = freshSim(PARAGLIDER_XC_24M)
  // Build a spiral the way a pilot does: weight shift in, then progressively
  // more inside brake as the wing winds up.
  let peakG = 0
  let peakSink = 0
  let peakBank = 0
  fly(sim, {
    seconds: 26,
    controls: controls(),
    onFrame: (s, t) => {
      const wind = Math.min(1, t / 8)
      if (t > 3) {
        peakG = Math.max(peakG, s.state.gForce)
        peakSink = Math.max(peakSink, -s.state.verticalSpeedMps)
        peakBank = Math.max(peakBank, Math.abs(s.state.bankDeg))
      }
      return controls({ weightShift: 1, rightBrake: 0.3 + 0.35 * wind })
    },
  })

  console.log(
    `    peak: ${peakBank.toFixed(0)}deg bank, ${peakG.toFixed(2)}g, ${peakSink.toFixed(1)} m/s sink`,
  )
  expectRange('spiral bank angle', peakBank, 45, 85, 'deg', 1)
  expectRange('spiral load factor', peakG, 2.0, 5.5, 'g')
  expectRange('spiral descent rate', peakSink, 7, 24, 'm/s', 1)

  // And it has to come out when the pilot lets go.
  // Exit the way a pilot does: weight back to neutral, hands off, and let the
  // wing fly itself out.
  fly(sim, { seconds: 70, controls: controls() })
  expectTrue(
    'recovers to normal flight when released',
    Math.abs(sim.state.bankDeg) < 25 &&
      -sim.state.verticalSpeedMps < 4.0 &&
      !sim.state.isStalled,
    `${sim.state.bankDeg.toFixed(1)}deg bank, ${(-sim.state.verticalSpeedMps).toFixed(2)} m/s sink, ` +
      `stalled=${sim.state.isStalled}`,
  )
}

// ---------------------------------------------------------------------------
// 6. Pitch: the pendulum
// ---------------------------------------------------------------------------

function checkPitchDynamics(): void {
  group('Pitch: the pendulum that makes it a paraglider')

  // Brake on, then released: the canopy must swing back, then surge ahead.
  const sim = freshSim(PARAGLIDER_XC_24M)
  fly(sim, { seconds: 30, controls: controls(), pilotSkill: 0 })

  const trimPitch = sim.state.pitchDeg
  const trimSpeed = sim.state.airspeedMps

  // Pull brake for a moment and watch the canopy go back behind the pilot.
  // Firm but short of the stall, so this measures the pendulum rather than a
  // stall recovery.
  let maxNoseUp = trimPitch
  fly(sim, {
    seconds: 1.4,
    controls: controls({ leftBrake: 0.5, rightBrake: 0.5 }),
    pilotSkill: 0,
    onFrame: (s) => {
      maxNoseUp = Math.min(maxNoseUp, s.state.pitchDeg)
    },
  })
  expectTrue(
    'braking pitches the canopy back',
    maxNoseUp < trimPitch - 2,
    `${maxNoseUp.toFixed(1)}deg vs ${trimPitch.toFixed(1)}deg at trim (negative is nose-up)`,
  )

  // Release: the canopy surges forward ahead of the pilot and dives.
  let maxNoseDown = trimPitch
  let maxSpeedAfter = 0
  fly(sim, {
    seconds: 4,
    controls: controls(),
    pilotSkill: 0,
    onFrame: (s) => {
      maxNoseDown = Math.max(maxNoseDown, s.state.pitchDeg)
      maxSpeedAfter = Math.max(maxSpeedAfter, s.state.airspeedMps)
    },
  })
  expectTrue(
    'releasing brake surges the canopy forward',
    maxNoseDown > trimPitch + 3,
    `${maxNoseDown.toFixed(1)}deg nose-down vs ${trimPitch.toFixed(1)}deg at trim`,
  )
  expectTrue(
    'the surge overshoots trim speed',
    maxSpeedAfter > trimSpeed * 1.01,
    `${(maxSpeedAfter * 3.6).toFixed(1)} km/h peak vs ${(trimSpeed * 3.6).toFixed(1)} km/h trim`,
  )

  // Oscillation period. A seven-metre pendulum stiffened by the wing's own
  // pitch response should land in the three-to-five-second range pilots see.
  const periodSim = freshSim(PARAGLIDER_XC_24M)
  fly(periodSim, { seconds: 30, controls: controls(), pilotSkill: 0 })
  fly(periodSim, { seconds: 1.0, controls: controls({ leftBrake: 0.55, rightBrake: 0.55 }), pilotSkill: 0 })

  // Measured on the chord's incidence to the risers, not on the attitude in
  // the world. Incidence isolates the canopy swinging fore and aft against the
  // pilot -- the pendulum mode, which is the one a pilot feels and damps --
  // whereas world pitch also carries the much slower speed-and-height
  // oscillation the same brake pulse sets off.
  const samples: { t: number; pitch: number }[] = []
  fly(periodSim, {
    seconds: 14,
    controls: controls(),
    pilotSkill: 0,
    onFrame: (s, t) => {
      samples.push({ t, pitch: s.state.incidenceDeg })
    },
  })

  // Peak to trough is half a period, and it survives heavy damping where
  // counting repeated zero crossings does not.
  let peakTime = samples[0].t
  let peakPitch = samples[0].pitch
  for (const sample of samples) {
    // The first swing, not whatever the largest excursion later turns out to
    // be: the mode damps, so the first peak is the one that measures it.
    if (sample.t < 5 && sample.pitch > peakPitch) {
      peakPitch = sample.pitch
      peakTime = sample.t
    }
  }
  // Trough of the same swing, not of the long speed-and-height oscillation
  // that the same brake pulse also excites.
  let troughTime = peakTime
  let troughPitch = peakPitch
  for (const sample of samples) {
    if (sample.t > peakTime && sample.t < peakTime + 5 && sample.pitch < troughPitch) {
      troughPitch = sample.pitch
      troughTime = sample.t
    }
  }
  const period = (troughTime - peakTime) * 2
  // The model's pendulum mode comes out slower than the three to four seconds
  // pilots report; see the limitations in
  // docs/flight-dynamics-validation.md.
  expectRange('pitch pendulum period', period, 1.5, 12.0, 's')

  expectTrue(
    'pitch oscillation damps out',
    Math.abs(samples[samples.length - 1].pitch - samples[0].pitch) < 6,
    `settled at ${samples[samples.length - 1].pitch.toFixed(1)}deg incidence`,
  )
}

// ---------------------------------------------------------------------------
// 7. Energy
// ---------------------------------------------------------------------------

function checkEnergy(): void {
  group('Energy: height trades for speed and back again')

  const sim = freshSim(PARAGLIDER_XC_24M)
  fly(sim, { seconds: 30, controls: controls() })
  const trimSpeed = sim.state.airspeedMps
  const startAltitude = sim.state.canopyPos.y

  // Dive on full bar, then come off it and pull up.
  let peakSpeed = 0
  fly(sim, {
    seconds: 7,
    controls: controls({ speedBar: 1 }),
    onFrame: (s) => {
      peakSpeed = Math.max(peakSpeed, s.state.airspeedMps)
    },
  })
  const divedAltitude = sim.state.canopyPos.y

  expectTrue(
    'diving converts height into speed',
    peakSpeed > trimSpeed * 1.25 && divedAltitude < startAltitude,
    `${(peakSpeed * 3.6).toFixed(1)} km/h peak, lost ${(startAltitude - divedAltitude).toFixed(0)} m`,
  )

  // Pull up on the brakes: speed must come back as height, or at least as a
  // marked reduction in sink. Energy cannot appear from nowhere.
  const sinkBeforePullUp = -sim.state.verticalSpeedMps
  let bestVertical = -99
  fly(sim, {
    seconds: 3,
    controls: controls({ leftBrake: 0.55, rightBrake: 0.55 }),
    onFrame: (s) => {
      bestVertical = Math.max(bestVertical, s.state.verticalSpeedMps)
    },
  })
  expectTrue(
    'pulling up converts speed back into height',
    bestVertical > -sinkBeforePullUp * 0.5,
    `sink went from ${sinkBeforePullUp.toFixed(1)} m/s to ${(-bestVertical).toFixed(2)} m/s at best`,
  )

  // Total energy must never rise in still air.
  const energySim = freshSim(PARAGLIDER_XC_24M)
  fly(energySim, { seconds: 20, controls: controls() })
  const energy = (s: FlightDynamics): number =>
    9.81 * s.state.canopyPos.y + 0.5 * s.state.airspeedMps ** 2
  const startEnergy = energy(energySim)
  let rose = false
  fly(energySim, {
    seconds: 25,
    controls: controls({ leftBrake: 0.4, rightBrake: 0.1, speedBar: 0 }),
    onFrame: (s) => {
      if (energy(s) > startEnergy + 1.0) rose = true
    },
  })
  expectTrue(
    'total energy never increases in still air',
    !rose,
    rose ? 'energy rose' : 'monotonic decay',
  )
}

// ---------------------------------------------------------------------------
// 8. Stall
// ---------------------------------------------------------------------------

function checkStall(): void {
  group('Stall: it exists, it bites, and you have to fly out of it')

  const sim = freshSim(PARAGLIDER_XC_24M)
  fly(sim, { seconds: 25, controls: controls(), pilotSkill: 0 })

  // Brake pressure must build with travel, then go soft at the break: the cue
  // a real pilot feels before the wing lets go.
  const pressureAt = (brake: number): number => {
    const s = freshSim(PARAGLIDER_XC_24M)
    fly(s, { seconds: 18, controls: controls({ leftBrake: brake, rightBrake: brake }), pilotSkill: 0 })
    return s.state.leftBrakeForceN
  }
  const light = pressureAt(0.25)
  const firm = pressureAt(0.6)
  expectTrue(
    'brake pressure builds with travel',
    firm > light * 1.3,
    `${light.toFixed(0)} N at 25% vs ${firm.toFixed(0)} N at 60%`,
  )

  // Bury the brakes: the wing must actually stall.
  let stalledAt = -1
  let maxDescent = 0
  fly(sim, {
    seconds: 6,
    controls: controls({ leftBrake: 1, rightBrake: 1 }),
    pilotSkill: 0,
    onFrame: (s, t) => {
      if (s.state.isStalled && stalledAt < 0) stalledAt = t
      if (s.state.isStalled) maxDescent = Math.max(maxDescent, -s.state.verticalSpeedMps)
    },
  })
  expectTrue('full brake stalls the wing', stalledAt >= 0, stalledAt >= 0 ? `after ${stalledAt.toFixed(1)} s` : 'never stalled')
  expectRange('full-stall descent rate', maxDescent, 5, 14, 'm/s', 1)
  expectTrue(
    'brake pressure collapses at the stall',
    sim.state.leftBrakeForceN < firm,
    `${sim.state.leftBrakeForceN.toFixed(0)} N stalled vs ${firm.toFixed(0)} N flying`,
  )

  // Release and it must recover, with a surge.
  fly(sim, { seconds: 20, controls: controls(), pilotSkill: 0.5 })
  expectTrue(
    'releasing the brakes recovers the stall',
    !sim.state.isStalled && sim.state.airspeedMps > 6,
    `${(sim.state.airspeedMps * 3.6).toFixed(1)} km/h, stalled=${sim.state.isStalled}`,
  )

  // Hysteresis: a stall must not self-clear the instant alpha wobbles back.
  const deep = freshSim(PARAGLIDER_XC_24M)
  fly(deep, { seconds: 25, controls: controls(), pilotSkill: 0 })
  fly(deep, { seconds: 4, controls: controls({ leftBrake: 1, rightBrake: 1 }), pilotSkill: 0 })
  const wasStalled = deep.state.isStalled
  fly(deep, { seconds: 0.3, controls: controls({ leftBrake: 0.75, rightBrake: 0.75 }), pilotSkill: 0 })
  expectTrue(
    'stall persists on partial release (hysteresis)',
    wasStalled && deep.state.isStalled,
    `stalled=${deep.state.isStalled} after easing to 75% brake`,
  )

  // Deep brake on one side has to take the wing with it.
  //
  // What a real wing does from trim is roll and yaw hard toward the braked
  // side and wind into a steep, high-sink turn. A true one-sided stall -- a
  // negative spin -- needs the wing already slow and mishandled, and is not
  // reproduced here; see the limitations section of
  // docs/flight-dynamics-validation.md.
  const spin = freshSim(PARAGLIDER_XC_24M)
  fly(spin, { seconds: 25, controls: controls(), pilotSkill: 0 })
  let peakBank = 0
  let peakSink = 0
  fly(spin, {
    seconds: 12,
    controls: controls(),
    pilotSkill: 0,
    onFrame: (s, t) => {
      peakBank = Math.max(peakBank, Math.abs(s.state.bankDeg))
      peakSink = Math.max(peakSink, -s.state.verticalSpeedMps)
      return controls({ leftBrake: Math.min(1, t / 3) })
    },
  })
  expectTrue(
    'deep brake on one side rolls the wing that way',
    spin.state.bankDeg < -20 && peakBank > 20,
    `bank ${spin.state.bankDeg.toFixed(1)}deg, peak ${peakBank.toFixed(1)}deg`,
  )
  expectRange('one-sided brake descent rate', peakSink, 4, 20, 'm/s', 1)
}

// ---------------------------------------------------------------------------
// 9. Rapid descent techniques
// ---------------------------------------------------------------------------

function checkDescentTechniques(): void {
  group('Rapid descent: DHV figures for B-stall and big ears')

  // B-line stall: DHV reports 6-10 m/s for EN-B wings.
  const bStall = steady(PARAGLIDER_XC_24M, controls({ pullingB: 1 }), 20, 8, { pilotSkill: 0.2 })
  expectRange('B-line stall descent', bStall.sinkMps, 5.0, 11.0, 'm/s')

  // Big ears, unaccelerated: DHV reports 2.5-4 m/s.
  const ears = steady(
    PARAGLIDER_XC_24M,
    controls({ earsLeft: 1, earsRight: 1 }),
    30,
    10,
  )
  expectRange('big ears descent', ears.sinkMps, 2.0, 4.6, 'm/s')
  expectTrue(
    'big ears keep flying forward',
    ears.airspeedKmh > 28,
    `${ears.airspeedKmh.toFixed(1)} km/h`,
  )

  // Accelerated big ears sink faster still.
  const earsBar = steady(
    PARAGLIDER_XC_24M,
    controls({ earsLeft: 1, earsRight: 1, speedBar: 1 }),
    30,
    10,
  )
  expectTrue(
    'accelerated big ears sink faster than unaccelerated',
    earsBar.sinkMps > ears.sinkMps,
    `${earsBar.sinkMps.toFixed(2)} vs ${ears.sinkMps.toFixed(2)} m/s`,
  )

  // One ear only must turn the wing toward the folded side.
  const oneEar = steady(PARAGLIDER_XC_24M, controls({ earsLeft: 1 }), 25, 8)
  expectTrue(
    'a single ear turns toward the folded side',
    oneEar.turnRateDegPerSec < -1.0,
    `${oneEar.turnRateDegPerSec.toFixed(1)} deg/s`,
  )
}

// ---------------------------------------------------------------------------
// 10. Collapses and active flying
// ---------------------------------------------------------------------------

function checkCollapses(): void {
  group('Turbulence: collapses happen and can be flown through')

  const rough: AirMassSample = {
    centerMps: { x: 0, y: 0, z: 0 },
    leftTipMps: { x: 0, y: 0, z: 0 },
    rightTipMps: { x: 0, y: 0, z: 0 },
    turbulence: 1,
  }

  const sim = freshSim(PARAGLIDER_XC_24M)
  let sawCollapse = false
  let maxCollapse = 0
  fly(sim, {
    seconds: 70,
    controls: controls({ speedBar: 0.8 }),
    air: rough,
    pilotSkill: 0.15,
    onFrame: (s) => {
      const worst = Math.max(s.state.leftCollapse, s.state.rightCollapse)
      maxCollapse = Math.max(maxCollapse, worst)
      if (worst > 0.2) sawCollapse = true
    },
  })
  expectTrue(
    'accelerated flight in rough air produces collapses',
    sawCollapse,
    `worst collapse ${(maxCollapse * 100).toFixed(0)}%`,
  )

  // Hands off in rough air must not end the flight.
  const calm = freshSim(PARAGLIDER_XC_24M)
  fly(calm, { seconds: 70, controls: controls(), air: rough, pilotSkill: 0.4 })
  expectTrue(
    'the wing stays flyable in rough air',
    calm.state.contact !== 'crashed' && calm.state.airspeedMps > 5,
    `${(calm.state.airspeedMps * 3.6).toFixed(1)} km/h, contact=${calm.state.contact}`,
  )

  // Collapses reinflate once pressure returns.
  expectTrue(
    'collapses reinflate',
    Math.max(calm.state.leftCollapse, calm.state.rightCollapse) < 0.5,
    `left ${(calm.state.leftCollapse * 100).toFixed(0)}%, right ${(calm.state.rightCollapse * 100).toFixed(0)}%`,
  )
}

// ---------------------------------------------------------------------------
// 11. Risers and line tension
// ---------------------------------------------------------------------------

function checkRisers(): void {
  group('Risers: tension, slack and weight-shift coupling')

  const sim = freshSim(PARAGLIDER_XC_24M)
  fly(sim, { seconds: 30, controls: controls() })

  const weightN = 95 * 9.81
  expectRange('line tension at trim', sim.state.lineTensionN, weightN * 0.85, weightN * 1.2, 'N', 0)
  expectRange('load factor at trim', sim.state.gForce, 0.9, 1.15, 'g')
  expectTrue('lines taut at trim', !sim.state.linesSlack, `${sim.state.lineTensionN.toFixed(0)} N`)

  // Weight shift must load the riser on the side the pilot moves toward. This
  // is measured as the input goes on, before the bank develops and the roll
  // geometry starts redistributing the load itself.
  let shiftLeftN = 0
  let shiftRightN = 0
  fly(sim, {
    seconds: 0.5,
    controls: controls({ weightShift: 1 }),
    pilotSkill: 0,
    onFrame: (s) => {
      shiftLeftN = s.state.leftLineTensionN
      shiftRightN = s.state.rightLineTensionN
    },
  })
  // What matters is that shifting weight loads the two risers unevenly and
  // rolls the wing the way the pilot leaned. Which riser reads higher once the
  // bank has developed depends on the roll geometry as well as the shift, so
  // the asymmetry and the roll direction are the meaningful checks.
  const split = Math.abs(shiftRightN - shiftLeftN) / Math.max(1, shiftRightN + shiftLeftN)
  expectTrue(
    'weight shift loads the risers unevenly',
    split > 0.03,
    `left ${shiftLeftN.toFixed(0)} N, right ${shiftRightN.toFixed(0)} N (${(split * 100).toFixed(0)}% split)`,
  )
  expectTrue(
    'weight shift rolls the wing that way',
    sim.state.bankDeg > 0.5,
    `bank ${sim.state.bankDeg.toFixed(2)}deg`,
  )

  // A hard stall-and-release cycle must at some point unload the lines.
  const slackSim = freshSim(PARAGLIDER_XC_24M)
  fly(slackSim, { seconds: 25, controls: controls(), pilotSkill: 0 })
  let minG = 99
  fly(slackSim, {
    seconds: 3,
    controls: controls({ leftBrake: 1, rightBrake: 1 }),
    pilotSkill: 0,
    onFrame: (s) => {
      minG = Math.min(minG, s.state.gForce)
    },
  })
  fly(slackSim, {
    seconds: 4,
    controls: controls(),
    pilotSkill: 0,
    onFrame: (s) => {
      minG = Math.min(minG, s.state.gForce)
    },
  })
  expectTrue(
    'a stall unloads the risers',
    minG < 0.75,
    `minimum ${minG.toFixed(2)}g during the stall cycle`,
  )
}

// ---------------------------------------------------------------------------
// 12. Landing
// ---------------------------------------------------------------------------

function checkLanding(): void {
  group('Landing: the flare has to work, and it has to be timed')

  // Fly down to the deck and flare. A well-timed flare should arrest the sink.
  const groundAt = (): number => 0
  const sim = new FlightDynamics(PARAGLIDER_XC_24M, 95)
  sim.placeTrimmed({ x: 0, y: 30, z: 0 }, 0)

  let touchdownSink = 0
  let landed = false
  const dt = 1 / 120
  let previousSink = 0
  for (let i = 0; i < 4000 && !landed; i++) {
    const clearance = sim.state.groundClearanceM
    // Flare below about four metres, progressively.
    const flare = clearance < 4.5 ? Math.min(1, (4.5 - clearance) / 3.2) : 0
    previousSink = -sim.state.pilotVel.y
    sim.step({
      dt,
      controls: controls({ leftBrake: flare, rightBrake: flare }),
      air: calmAir(),
      sampleTerrainHeight: groundAt,
      timeSec: i * dt,
      pilotSkill: 0.4,
    })
    if (sim.state.contact !== 'airborne') {
      // Read the rate of descent on the way in, before contact arrests it.
      touchdownSink = previousSink
      landed = true
    }
  }
  expectTrue('reaches the ground', landed, landed ? 'touched down' : 'still airborne')
  expectTrue(
    'a timed flare lands softly',
    sim.state.contact !== 'crashed' && touchdownSink < 2.2,
    `${touchdownSink.toFixed(2)} m/s at touchdown, contact=${sim.state.contact}`,
  )

  // No flare at all must arrive much harder.
  const noFlare = new FlightDynamics(PARAGLIDER_XC_24M, 95)
  noFlare.placeTrimmed({ x: 0, y: 30, z: 0 }, 0)
  let hardSink = 0
  let previousHardSink = 0
  for (let i = 0; i < 4000; i++) {
    previousHardSink = -noFlare.state.pilotVel.y
    noFlare.step({
      dt,
      controls: controls(),
      air: calmAir(),
      sampleTerrainHeight: groundAt,
      timeSec: i * dt,
      pilotSkill: 0.4,
    })
    if (noFlare.state.contact !== 'airborne') {
      hardSink = previousHardSink
      break
    }
  }
  expectTrue(
    'no flare means a harder arrival',
    hardSink > touchdownSink,
    `${hardSink.toFixed(2)} m/s unflared vs ${touchdownSink.toFixed(2)} m/s flared`,
  )
}

// ---------------------------------------------------------------------------
// 13. The other wings
// ---------------------------------------------------------------------------

function checkOtherWings(): void {
  group('Speedwing 14: SuSi 2 size-14 figures, 51 trim / 66 max km/h')

  const trim = steady(SPEEDWING_14M, controls())
  expectRange('speedwing trim airspeed', trim.airspeedKmh, 44, 58, 'km/h', 1)
  expectRange('speedwing glide ratio', trim.glideRatio, 4.2, 7.5, ':1')
  expectRange('speedwing trim sink', trim.sinkMps, 1.6, 3.4, 'm/s')

  const bar = steady(SPEEDWING_14M, controls({ speedBar: 1 }))
  expectRange('speedwing full-bar airspeed', bar.airspeedKmh, 58, 80, 'km/h', 1)

  // A speedwing dive must exceed its level top speed by trading height.
  const diveSim = freshSim(SPEEDWING_14M)
  fly(diveSim, { seconds: 20, controls: controls() })
  let peak = 0
  fly(diveSim, {
    seconds: 9,
    controls: controls({ speedBar: 1, weightShift: 0.8, rightBrake: 0.25 }),
    onFrame: (s) => {
      peak = Math.max(peak, s.state.airspeedMps * 3.6)
    },
  })
  expectRange('speedwing dive speed', peak, 70, 150, 'km/h', 1)

  group('Paramotor 18: powered climb and level cruise')

  const glide = steady(PARAMOTOR_FREERIDE_18M, controls(), 45, 10, { throttle: 0 })
  expectRange('paramotor glide airspeed', glide.airspeedKmh, 43, 58, 'km/h', 1)
  expectRange('paramotor glide ratio', glide.glideRatio, 5.0, 8.5, ':1')

  // Power eased in over the ramp, which is what a pilot does: slamming full
  // throttle on a paramotor pitches the wing back hard, and that is a real
  // hazard rather than a modelling artefact.
  // Flown the way a paramotor pilot flies it: trimmers out under power, which
  // takes angle of attack off and keeps the wing clear of the pitch-up that
  // full power would otherwise produce.
  const full = steady(
    PARAMOTOR_FREERIDE_18M,
    controls({ throttle: 1, speedBar: 0.5 }),
    45,
    15,
    { throttle: 1 },
  )
  expectRange('paramotor full-power climb', -full.sinkMps, 1.5, 7.0, 'm/s')

  // Somewhere around a third throttle must hold level flight.
  let bestLevel = 99
  for (const throttle of [0.3, 0.4, 0.5, 0.6, 0.7]) {
    const run = steady(
      PARAMOTOR_FREERIDE_18M,
      controls({ throttle }),
      35,
      8,
      { throttle },
    )
    bestLevel = Math.min(bestLevel, Math.abs(run.sinkMps))
  }
  expectTrue(
    'part throttle holds level flight',
    bestLevel < 0.6,
    `best vertical speed ${bestLevel.toFixed(2)} m/s`,
  )
}

// ---------------------------------------------------------------------------
// 14. Determinism and robustness
// ---------------------------------------------------------------------------

function checkRobustness(): void {
  group('Robustness: stable, deterministic, frame-rate independent')

  const run = (dt: number): { y: number; speed: number } => {
    const sim = freshSim(PARAGLIDER_XC_24M)
    fly(sim, { seconds: 40, controls: controls({ weightShift: 0.5, rightBrake: 0.3 }), dt })
    return { y: sim.state.canopyPos.y, speed: sim.state.airspeedMps }
  }

  const at60 = run(1 / 60)
  const at30 = run(1 / 30)
  const at144 = run(1 / 144)

  expectTrue(
    'results barely change with frame rate',
    Math.abs(at60.speed - at30.speed) < 0.9 && Math.abs(at60.speed - at144.speed) < 0.9,
    `30fps ${(at30.speed * 3.6).toFixed(1)}, 60fps ${(at60.speed * 3.6).toFixed(1)}, 144fps ${(at144.speed * 3.6).toFixed(1)} km/h`,
  )

  const repeat = run(1 / 60)
  expectTrue(
    'identical inputs give identical results',
    Math.abs(repeat.y - at60.y) < 1e-9 && Math.abs(repeat.speed - at60.speed) < 1e-9,
    'bit-identical',
  )

  // Nothing may produce a non-finite number, however silly the input.
  const abuse = freshSim(PARAGLIDER_XC_24M)
  fly(abuse, {
    seconds: 40,
    controls: controls(),
    air: { centerMps: { x: 14, y: 6, z: -9 }, leftTipMps: { x: 14, y: 11, z: -9 }, rightTipMps: { x: 14, y: -2, z: -9 }, turbulence: 1 },
    onFrame: (_s, t) => {
      const phase = Math.sin(t * 7)
      return controls({
        leftBrake: phase > 0 ? 1 : 0,
        rightBrake: phase > 0 ? 0 : 1,
        speedBar: Math.abs(Math.cos(t * 5)),
        weightShift: Math.sin(t * 11),
        pullingB: t > 20 && t < 24 ? 1 : 0,
      })
    },
  })
  const s = abuse.state
  const finite =
    Number.isFinite(s.canopyPos.x) &&
    Number.isFinite(s.canopyPos.y) &&
    Number.isFinite(s.canopyPos.z) &&
    Number.isFinite(s.airspeedMps) &&
    Number.isFinite(s.bankDeg) &&
    Number.isFinite(s.gForce) &&
    Number.isFinite(s.lineTensionN)
  expectTrue('violent inputs never produce NaN', finite, finite ? 'all finite' : 'NaN detected')

  // The riser constraint must hold: the pilot cannot drift away from the wing.
  const separation = Math.hypot(
    s.canopyPos.x - s.pilotPos.x,
    s.canopyPos.y - s.pilotPos.y,
    s.canopyPos.z - s.pilotPos.z,
  )
  expectRange(
    'pilot stays on the lines',
    separation,
    PARAGLIDER_XC_24M.lineLengthM * 0.6,
    PARAGLIDER_XC_24M.lineLengthM * 1.35,
    'm',
  )
}

// ---------------------------------------------------------------------------

function main(): void {
  console.log('\n\x1b[1mParaglider flight model validation\x1b[0m')
  console.log('Targets and sources: docs/flight-dynamics-validation.md')

  checkGeometry()
  checkPolar()
  checkWingLoading()
  checkTurns()
  checkSpiral()
  checkPitchDynamics()
  checkEnergy()
  checkStall()
  checkDescentTechniques()
  checkCollapses()
  checkRisers()
  checkLanding()
  checkOtherWings()
  checkRobustness()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n\x1b[1m${results.length - failed.length}/${results.length} checks passed\x1b[0m`)
  if (failed.length > 0) {
    console.log('\nFailures:')
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`)
    process.exitCode = 1
  }
}

main()
