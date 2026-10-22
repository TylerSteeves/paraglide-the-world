/**
 * ParagliderSimulation: the game's flight model.
 *
 * This used to be a kinematic engine. Airspeed, sink rate, bank angle and turn
 * rate were each looked up from the control positions through a table of
 * targets, and the result was smoothed toward them. It was predictable and it
 * never misbehaved, but it could not be a paraglider: there was no pendulum,
 * so the canopy could not pitch back when you braked or surge when you let go;
 * no energy, so height and speed could not trade; and no stall, because stalls
 * had been switched off. The pilot was pinned rigidly under the canopy with
 * `pilotVelocity = canopyVelocity`, which is the one thing a paraglider pilot
 * never is.
 *
 * It is now a thin layer over `FlightDynamics`, which integrates a canopy and
 * a pilot joined by risers and lets the flight behaviour follow from the
 * forces. Nothing in here decides how the wing flies. This file's job is to
 * keep the rest of the game working: the same fields and methods the
 * renderers, camera, HUD, audio and trick detector already read, the air mass
 * assembled from the world's wind and thermals, and the running totals a
 * flight log needs.
 *
 * Performance targets and the data behind them are in
 * `docs/flight-dynamics-validation.md`, and
 * `src/physics/validate-flight-model.ts` checks the model against them.
 */

import type {
  AtmosphereState,
  CanopyState,
  FlightControls,
  FlightTelemetry,
  PilotState,
} from './types.ts'
import type { FlightWorld, Vector3Like } from '../world/types.ts'
import {
  PARAGLIDER_XC_24M,
  PARAMOTOR_FREERIDE_18M,
  SPEEDWING_14M,
  measureProjectedGeometry,
  type ProjectedGeometry,
  type WingGeometry,
} from './aerodynamics.ts'
import {
  FlightDynamics,
  SUBSTEP_SECONDS,
  type AirMassSample,
  type TerrainSampler,
} from './flight-dynamics.ts'
import { clamp, DEG, v3, vAdd, vAddScaled, vLen, vScale, type V3 } from './vecmath.ts'

export type { TerrainSampler }
export const SUBSTEP = SUBSTEP_SECONDS

export type WingType = 'speedwing' | 'paraglider' | 'paramotor'

const WINGS: Record<WingType, WingGeometry> = {
  speedwing: SPEEDWING_14M,
  paraglider: PARAGLIDER_XC_24M,
  paramotor: PARAMOTOR_FREERIDE_18M,
}

/** Pilot masses the in-game selector cycles through, kg. */
const PILOT_MASSES = [75, 95, 125, 145]

export class ParagliderSimulation {
  public canopy: CanopyState
  public pilot: PilotState
  public controls: FlightControls
  public atmosphere: AtmosphereState
  public telemetry: FlightTelemetry
  public wing: WingGeometry
  public world: FlightWorld | null = null

  // --- Flags the rest of the game reads ---
  public isStalled = false
  public isSpinning = false
  public asymmetricStallSide: 'none' | 'left' | 'right' = 'none'
  public leftWingCollapse = 0
  public rightWingCollapse = 0
  public isCrashed = false
  public isLanded = false
  public isLinesSlack = false
  public leftBrakeForceN = 0
  public rightBrakeForceN = 0
  public stallWarning = 0
  public leftStalled = false
  public rightStalled = false
  public isBStall = false
  public isCollapsed = false
  public collapseFrac = 0
  public tumbleStreak = 0
  public groundClearanceMeters = 100
  public isFootDragging = false
  public lineTensionNewtons = 860
  public leftLineTensionNewtons = 430
  public rightLineTensionNewtons = 430
  public thermalRollTorqueDeg = 0

  public currentWingType: WingType = 'paraglider'
  public launchPos: V3
  public engineRpm = 0
  public pilotMassKg = 95
  public isMotorActive = false
  public thrustNewtons = 0

  // --- Attitude, mirrored from the dynamics for convenience ---
  public headingDeg = 0
  public pitchDeg = 0
  public bankDeg = 0
  public airspeedKmh = 0

  /**
   * How much of a real pilot's reflexive damping to apply, 0 to 1.
   *
   * A real pilot is never a passive weight: they absorb a pitch surge and
   * check a roll without thinking about it. This stands in for that and
   * nothing else -- it adds damping torques only, so it can never create
   * lift, speed or climb, and it cannot change where the wing trims.
   */
  public pilotSkill = 0.35

  // --- Acro flags, for the trick detector ---
  public isLooping = false
  public isRolling = false

  private dynamics: FlightDynamics
  /**
   * Projected area and span for the current wing. Derived from the canopy's
   * arc, so it costs a pass over the panel set: cached here because the
   * instruments and the wingtip positions want it every frame.
   */
  private projected: ProjectedGeometry
  private loopTimer = 0
  private rollTimer = 0
  private ringLiftTimer = 0
  private ringLiftMps = 0
  private initialAltitude: number
  private initialHeadingDeg: number
  private elapsedSeconds = 0
  private travelledMeters = 0
  private lastPosition: V3

  constructor(
    initialAltitude = 2050,
    initialHeadingDeg = 5,
    defaultWing: WingType = 'paraglider',
    startPos?: Vector3Like,
  ) {
    this.initialAltitude = initialAltitude
    this.initialHeadingDeg = initialHeadingDeg
    this.currentWingType = defaultWing
    this.wing = WINGS[defaultWing]
    this.pilotMassKg = this.wing.pilotMassKg
    this.isMotorActive = this.wing.hasMotor ?? false
    this.engineRpm = this.isMotorActive ? 2200 : 0

    const spawn = startPos ?? { x: 0, y: initialAltitude, z: 0 }
    this.launchPos = v3(spawn.x, spawn.y, spawn.z)
    this.lastPosition = v3(spawn.x, spawn.y, spawn.z)

    this.dynamics = new FlightDynamics(this.wing, this.pilotMassKg)
    this.dynamics.placeTrimmed(this.launchPos, initialHeadingDeg)
    this.projected = measureProjectedGeometry(this.wing)

    this.controls = {
      leftBrake: 0,
      rightBrake: 0,
      leftBrakeRate: 0,
      rightBrakeRate: 0,
      weightShift: 0,
      speedBar: 0,
      pullingA: 0,
      pullingB: 0,
      reverseStance: false,
    }

    this.atmosphere = {
      windVector: { x: 0, y: 0, z: 0 },
      windSpeedKmh: 12,
      windHeadingDeg: 190,
      turbulence: 0.12,
      thermalUpdraftMps: 0,
      ridgeLiftMps: 0,
    }

    this.canopy = {
      position: { x: spawn.x, y: spawn.y, z: spawn.z },
      velocity: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      rollDeg: 0,
      pitchDeg: 0,
      yawDeg: initialHeadingDeg,
      airspeedKmh: 0,
      verticalSpeedMps: 0,
      angleOfAttackDeg: 0,
      leftTrailingEdgeFlex: 0,
      rightTrailingEdgeFlex: 0,
      leftWingCollapse: 0,
      rightWingCollapse: 0,
      asymmetricStallSide: 'none',
      isNegativeSpin: false,
      isBStall: false,
    }

    this.pilot = {
      position: { x: spawn.x, y: spawn.y - 7, z: spawn.z },
      velocity: { x: 0, y: 0, z: 0 },
      pendulumRollDeg: 0,
      pendulumPitchDeg: 0,
      angularVelocityRoll: 0,
      angularVelocityPitch: 0,
      gForce: 1,
      harnessWeightShift: 0,
      reverseStanceYawDeg: 0,
      isFootDragging: false,
    }

    this.telemetry = {
      altitudeMeters: initialAltitude,
      terrainHeightMeters: 0,
      groundClearanceMeters: initialAltitude,
      airspeedKmh: 0,
      groundSpeedKmh: 0,
      verticalSpeedMps: 0,
      glideRatio: this.wing.glideRatio,
      gForce: 1,
      distanceMeters: 0,
      flightDurationSeconds: 0,
      score: 0,
      ringsCollected: 0,
      lineTensionNewtons: 860,
      leftLineTensionNewtons: 430,
      rightLineTensionNewtons: 430,
      isLinesSlack: false,
      asymmetricStallSide: 'none',
      isNegativeSpin: false,
      tumbleStreak: 0,
      isReverseStance: false,
      isStalled: false,
      bankDeg: 0,
      pitchDeg: 0,
      headingDeg: initialHeadingDeg,
      wingType: defaultWing,
      xcDistanceMeters: 0,
      maxAltitudeMeters: initialAltitude,
      thermalClimbMps: 0,
      leftBrakeForceN: 0,
      rightBrakeForceN: 0,
      stallWarning: 0,
      leftStalled: false,
      rightStalled: false,
      isBStall: false,
      isCollapsed: false,
      collapseFrac: 0,
      pullingA: 0,
      pullingB: 0,
    }

    this.syncFromDynamics()
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /** The gust field is analytic and deterministic, so there is no seed. */
  public setSeed(_seed: number): void {}

  public setPilotMass(massKg: number): void {
    this.pilotMassKg = clamp(massKg, 50, 220)
    this.dynamics.rebuild(this.wing, this.pilotMassKg)
    this.dynamics.placeTrimmed(this.dynamics.state.canopyPos, this.headingDeg)
    this.syncFromDynamics()
  }

  public cyclePilotMass(): number {
    const next =
      PILOT_MASSES.find((mass) => mass > this.pilotMassKg + 1) ?? PILOT_MASSES[0]
    this.setPilotMass(next)
    return this.pilotMassKg
  }

  public setWing(wingType: WingType): void {
    this.currentWingType = wingType
    this.wing = WINGS[wingType]
    this.pilotMassKg = this.wing.pilotMassKg
    this.isMotorActive = this.wing.hasMotor ?? false
    this.engineRpm = this.isMotorActive ? 2200 : 0

    const position = this.dynamics.state.canopyPos
    this.dynamics.rebuild(this.wing, this.pilotMassKg)
    this.dynamics.placeTrimmed(position, this.headingDeg)

    this.projected = measureProjectedGeometry(this.wing)
    this.telemetry.wingType = wingType
    this.telemetry.glideRatio = this.wing.glideRatio
    this.syncFromDynamics()
  }

  public reset(
    initialAltitude: number = this.initialAltitude,
    initialHeadingDeg: number = this.initialHeadingDeg,
    startPos?: Vector3Like,
  ): void {
    let spawn = startPos ?? { x: 0, y: initialAltitude, z: 0 }
    if (this.world && typeof this.world.sampleHeight === 'function') {
      const terrain = this.world.sampleHeight(spawn.x, spawn.z)
      const minimum = terrain + this.wing.lineLengthM + 9
      if (spawn.y < minimum) spawn = { x: spawn.x, y: minimum, z: spawn.z }
    }

    this.launchPos = v3(spawn.x, spawn.y, spawn.z)
    this.lastPosition = v3(spawn.x, spawn.y, spawn.z)
    this.initialAltitude = initialAltitude
    this.initialHeadingDeg = initialHeadingDeg

    this.dynamics.placeTrimmed(this.launchPos, initialHeadingDeg)

    this.isCrashed = false
    this.isLanded = false
    this.isLooping = false
    this.isRolling = false
    this.loopTimer = 0
    this.rollTimer = 0
    this.ringLiftTimer = 0
    this.tumbleStreak = 0
    this.elapsedSeconds = 0
    this.travelledMeters = 0

    this.telemetry.flightDurationSeconds = 0
    this.telemetry.xcDistanceMeters = 0
    this.telemetry.distanceMeters = 0
    this.telemetry.maxAltitudeMeters = spawn.y
    this.syncFromDynamics()
  }

  // -------------------------------------------------------------------------
  // Boosts and acro
  // -------------------------------------------------------------------------

  /** A scripted puff of lift, for flying through a ring. */
  public applyRingLiftBoost(mps = 2.0, durationSec = 1.2): void {
    this.ringLiftMps = mps
    this.ringLiftTimer = durationSec
  }

  /**
   * Kicks the canopy into a loop.
   *
   * This hands the wing a pitch rate and then leaves it alone: where it goes
   * from there is up to the dynamics, including whether it comes round or
   * drops out halfway. Nothing is animated.
   */
  public triggerLoop(): boolean {
    if (this.isCrashed || this.isLanded || this.isLooping || this.isRolling) return false
    this.dynamics.addAngularImpulse(v3(-3.4, 0, 0))
    this.isLooping = true
    this.loopTimer = 1.6
    return true
  }

  /** Kicks the canopy into a roll, in the same spirit as `triggerLoop`. */
  public triggerRoll(direction = 1): boolean {
    if (this.isCrashed || this.isLanded || this.isLooping || this.isRolling) return false
    this.dynamics.addAngularImpulse(v3(0, 0, direction >= 0 ? -3.6 : 3.6))
    this.isRolling = true
    this.rollTimer = 1.4
    return true
  }

  // -------------------------------------------------------------------------
  // Stepping
  // -------------------------------------------------------------------------

  public step(dt: number, sampleTerrainHeight: TerrainSampler): void {
    if (this.isCrashed) return

    const frameDt = clamp(dt, 0.0001, 0.1)
    this.elapsedSeconds += frameDt

    // Engine spool, for sound and the instruments. Thrust itself is produced
    // by the dynamics from the throttle.
    const throttle = clamp(this.controls.throttle ?? 0, 0, 1)
    if (this.isMotorActive) {
      const targetRpm = 2200 + throttle * 6200
      const spoolRate = targetRpm > this.engineRpm ? 14 : 8.5
      this.engineRpm += (targetRpm - this.engineRpm) * Math.min(1, spoolRate * frameDt)
    } else {
      this.engineRpm = 0
    }

    let extraLiftMps = 0
    if (this.ringLiftTimer > 0) {
      this.ringLiftTimer -= frameDt
      extraLiftMps += this.ringLiftMps * Math.min(1, Math.max(0, this.ringLiftTimer) / 0.4)
    }

    const air = this.sampleAirMass(sampleTerrainHeight)

    this.dynamics.step({
      dt: frameDt,
      controls: this.controls,
      air,
      sampleTerrainHeight,
      timeSec: this.elapsedSeconds,
      extraLiftMps,
      throttle,
      pilotSkill: this.pilotSkill,
    })

    if (this.loopTimer > 0) {
      this.loopTimer -= frameDt
      if (this.loopTimer <= 0) {
        this.isLooping = false
        this.tumbleStreak++
      }
    }
    if (this.rollTimer > 0) {
      this.rollTimer -= frameDt
      if (this.rollTimer <= 0) {
        this.isRolling = false
        this.tumbleStreak++
      }
    }

    this.syncFromDynamics()
  }

  // -------------------------------------------------------------------------
  // Air mass
  // -------------------------------------------------------------------------

  /**
   * Builds the air the wing is flying through: the ambient wind, ridge lift
   * from the slope under it, and the thermal field sampled at the canopy and
   * at both wingtips.
   *
   * Sampling the tips separately is what lets a thermal's edge roll the wing.
   * One tip in stronger lift than the other produces a genuine rolling moment
   * through the panel model, so a thermal announces itself by nudging the wing
   * rather than by changing a number on the instruments.
   */
  private sampleAirMass(sampleTerrainHeight: TerrainSampler): AirMassSample {
    const windRad = (this.atmosphere.windHeadingDeg ?? 0) * DEG
    const windSpeed = (this.atmosphere.windSpeedKmh ?? 0) / 3.6
    const wind = v3(Math.sin(windRad) * windSpeed, 0, Math.cos(windRad) * windSpeed)
    this.atmosphere.windVector = { x: wind.x, y: wind.y, z: wind.z }

    const canopy = this.dynamics.state.canopyPos

    // Ridge lift: wind pushed up the local slope, decaying with height.
    let ridgeLift = 0
    if (sampleTerrainHeight && this.groundClearanceMeters < 180) {
      const step = 4
      const slopeX =
        (sampleTerrainHeight(canopy.x + step, canopy.z) -
          sampleTerrainHeight(canopy.x - step, canopy.z)) /
        (2 * step)
      const slopeZ =
        (sampleTerrainHeight(canopy.x, canopy.z + step) -
          sampleTerrainHeight(canopy.x, canopy.z - step)) /
        (2 * step)
      const upslope = -(wind.x * slopeX + wind.z * slopeZ)
      ridgeLift = Math.max(0, upslope) * Math.exp(-this.groundClearanceMeters / 90) * 0.7
    }
    this.atmosphere.ridgeLiftMps = ridgeLift

    // Thermals, sampled across the span.
    const tips = this.getWingTipPositions()
    let centerUp = 0
    let leftUp = 0
    let rightUp = 0
    if (this.world?.sampleUpdraft) {
      const t = this.elapsedSeconds
      const windObj = { x: wind.x, y: wind.y, z: wind.z }
      centerUp = this.world.sampleUpdraft(canopy.x, canopy.y, canopy.z, t, windObj)
      leftUp = this.world.sampleUpdraft(tips.left.x, tips.left.y, tips.left.z, t, windObj)
      rightUp = this.world.sampleUpdraft(tips.right.x, tips.right.y, tips.right.z, t, windObj)
    } else {
      centerUp = this.atmosphere.thermalUpdraftMps ?? 0
      leftUp = centerUp
      rightUp = centerUp
    }
    this.atmosphere.thermalUpdraftMps = centerUp
    this.thermalRollTorqueDeg = clamp((leftUp - rightUp) * 3.4, -16, 16)

    // Richer thermal fluid data, where the world provides it.
    if (this.world?.sampleThermalFluidVelocity) {
      const sample = this.world.sampleThermalFluidVelocity(
        canopy.x,
        canopy.y,
        canopy.z,
        this.elapsedSeconds,
        { x: wind.x, y: wind.y, z: wind.z },
      )
      this.telemetry.thermalFluidVx = sample.velocity.x
      this.telemetry.thermalFluidVy = sample.velocity.y
      this.telemetry.thermalFluidVz = sample.velocity.z
      this.telemetry.thermalTempAnomalyC = sample.temperatureAnomalyC
      this.telemetry.staticChargeField = sample.staticChargeField
      this.telemetry.isDraftingZone = sample.isDraftingZone
    }

    const vertical = ridgeLift
    return {
      centerMps: v3(wind.x, wind.y + vertical + centerUp, wind.z),
      leftTipMps: v3(wind.x, wind.y + vertical + leftUp, wind.z),
      rightTipMps: v3(wind.x, wind.y + vertical + rightUp, wind.z),
      turbulence: clamp(this.atmosphere.turbulence ?? 0, 0, 1),
    }
  }

  // -------------------------------------------------------------------------
  // Geometry helpers
  // -------------------------------------------------------------------------

  public getWingTipPositions(): { left: V3; right: V3; center: V3 } {
    const state = this.dynamics.state
    const half = this.projected.projectedSpanM * 0.5
    const q = state.canopyQuat
    // Rotate the body x-axis into the world without a quaternion import.
    const right = v3(
      1 - 2 * (q.y * q.y + q.z * q.z),
      2 * (q.x * q.y + q.z * q.w),
      2 * (q.x * q.z - q.y * q.w),
    )
    const center = v3(state.canopyPos.x, state.canopyPos.y, state.canopyPos.z)
    return {
      left: vAddScaled(center, right, -half),
      right: vAddScaled(center, right, half),
      center,
    }
  }

  // -------------------------------------------------------------------------
  // State mirroring
  // -------------------------------------------------------------------------

  private syncFromDynamics(): void {
    const s = this.dynamics.state

    this.headingDeg = s.headingDeg
    this.pitchDeg = s.pitchDeg
    this.bankDeg = s.bankDeg
    this.airspeedKmh = s.airspeedMps * 3.6

    // --- Canopy ---
    this.canopy.position = { ...s.canopyPos }
    this.canopy.velocity = { ...s.canopyVel }
    this.canopy.quaternion = { ...s.canopyQuat }
    this.canopy.rollDeg = s.bankDeg
    this.canopy.pitchDeg = s.pitchDeg
    this.canopy.yawDeg = s.headingDeg
    this.canopy.airspeedKmh = this.airspeedKmh
    this.canopy.verticalSpeedMps = s.verticalSpeedMps
    this.canopy.angleOfAttackDeg = s.alphaDeg
    this.canopy.leftTrailingEdgeFlex = clamp(this.controls.leftBrake, 0, 1)
    this.canopy.rightTrailingEdgeFlex = clamp(this.controls.rightBrake, 0, 1)
    this.canopy.leftWingCollapse = s.leftCollapse
    this.canopy.rightWingCollapse = s.rightCollapse
    this.canopy.asymmetricStallSide = s.asymmetricStallSide
    this.canopy.isNegativeSpin = s.isSpinning
    this.canopy.isBStall = (this.controls.pullingB ?? 0) > 0.35
    this.canopy.isCollapsed = Math.max(s.leftCollapse, s.rightCollapse) > 0.35
    this.canopy.collapseFrac = Math.max(s.leftCollapse, s.rightCollapse)

    // --- Pilot ---
    this.pilot.position = { ...s.pilotPos }
    this.pilot.velocity = { ...s.pilotVel }
    this.pilot.gForce = s.gForce
    this.pilot.harnessWeightShift = clamp(this.controls.weightShift, -1, 1)
    this.pilot.isFootDragging = this.isFootDragging
    this.pilot.reverseStanceYawDeg = this.controls.reverseStance ? 180 : 0
    // The pilot's swing relative to the canopy, which is what a chase camera
    // and the harness animation want.
    this.pilot.pendulumRollDeg = s.riserTwistDeg * 0.25 + s.bankDeg * 0.3
    this.pilot.pendulumPitchDeg = s.incidenceDeg - s.pitchDeg * 0.4
    this.pilot.angularVelocityRoll = s.canopyOmega.z
    this.pilot.angularVelocityPitch = s.canopyOmega.x

    // --- Flags ---
    this.isStalled = s.isStalled
    this.isSpinning = s.isSpinning
    this.asymmetricStallSide = s.asymmetricStallSide
    this.leftWingCollapse = s.leftCollapse
    this.rightWingCollapse = s.rightCollapse
    this.leftStalled = s.leftSeparated
    this.rightStalled = s.rightSeparated
    this.stallWarning = s.stallWarning
    this.isLinesSlack = s.linesSlack
    this.isBStall = this.canopy.isBStall
    this.isCollapsed = this.canopy.isCollapsed ?? false
    this.collapseFrac = this.canopy.collapseFrac ?? 0
    this.leftBrakeForceN = s.leftBrakeForceN
    this.rightBrakeForceN = s.rightBrakeForceN
    this.lineTensionNewtons = s.lineTensionN
    this.leftLineTensionNewtons = s.leftLineTensionN
    this.rightLineTensionNewtons = s.rightLineTensionN
    this.groundClearanceMeters = s.groundClearanceM
    this.thrustNewtons = s.thrustN
    this.isCrashed = s.contact === 'crashed'
    this.isLanded = s.contact === 'landed'
    this.isFootDragging =
      s.contact === 'airborne' && s.groundClearanceM < 1.8 && s.airspeedMps > 5

    // --- Distance travelled ---
    const position = v3(s.canopyPos.x, s.canopyPos.y, s.canopyPos.z)
    const movedVector = vAdd(position, vScale(this.lastPosition, -1))
    const moved = Math.hypot(movedVector.x, movedVector.z)
    if (Number.isFinite(moved)) this.travelledMeters += moved
    this.lastPosition = position

    // --- Telemetry ---
    const t = this.telemetry
    t.altitudeMeters = s.pilotPos.y
    t.terrainHeightMeters = s.pilotPos.y - s.groundClearanceM
    t.groundClearanceMeters = s.groundClearanceM
    t.airspeedKmh = this.airspeedKmh
    t.groundSpeedKmh = s.groundSpeedMps * 3.6
    t.verticalSpeedMps = s.verticalSpeedMps
    t.glideRatio = s.glideRatio
    t.gForce = s.gForce
    t.distanceMeters = this.travelledMeters
    t.flightDurationSeconds = this.elapsedSeconds
    t.lineTensionNewtons = Math.round(s.lineTensionN)
    t.leftLineTensionNewtons = Math.round(s.leftLineTensionN)
    t.rightLineTensionNewtons = Math.round(s.rightLineTensionN)
    t.isLinesSlack = s.linesSlack
    t.asymmetricStallSide = s.asymmetricStallSide
    t.isNegativeSpin = s.isSpinning
    t.tumbleStreak = this.tumbleStreak
    t.isReverseStance = this.controls.reverseStance
    t.isStalled = s.isStalled
    t.bankDeg = s.bankDeg
    t.pitchDeg = s.pitchDeg
    t.headingDeg = s.headingDeg
    t.wingType = this.currentWingType
    t.xcDistanceMeters = Math.hypot(
      s.pilotPos.x - this.launchPos.x,
      s.pilotPos.z - this.launchPos.z,
    )
    t.maxAltitudeMeters = Math.max(t.maxAltitudeMeters, s.pilotPos.y)
    t.thermalClimbMps = this.atmosphere.thermalUpdraftMps ?? 0
    t.leftBrakeForceN = Math.round(s.leftBrakeForceN)
    t.rightBrakeForceN = Math.round(s.rightBrakeForceN)
    t.stallWarning = s.stallWarning
    t.leftStalled = s.leftSeparated
    t.rightStalled = s.rightSeparated
    t.isBStall = this.isBStall
    t.isCollapsed = this.isCollapsed
    t.collapseFrac = this.collapseFrac
    t.pullingA = this.controls.pullingA ?? 0
    t.pullingB = this.controls.pullingB ?? 0
    t.engineRpm = Math.round(this.engineRpm)
    t.throttlePercent = Math.round(clamp(this.controls.throttle ?? 0, 0, 1) * 100)
    t.thrustNewtons = Math.round(s.thrustN)
    t.pilotMassKg = Math.round(this.pilotMassKg)

    t.wingLoadingKgPerM2 = +(
      (this.pilotMassKg + this.wing.canopyMassKg) /
      this.projected.projectedAreaM2
    ).toFixed(1)
  }

  /** Current airspeed corrected to sea level, which is what an ASI reads. */
  public get indicatedAirspeedKmh(): number {
    return this.dynamics.state.equivalentAirspeedMps * 3.6
  }

  /** Angle of attack, span-averaged. Useful for a HUD and for tuning. */
  public get angleOfAttackDeg(): number {
    return this.dynamics.state.alphaDeg
  }

  /** Riser twist, pilot relative to canopy. Degrees. */
  public get riserTwistDeg(): number {
    return this.dynamics.state.riserTwistDeg
  }

  /** Distance from the canopy to the pilot, for drawing the lines. */
  public get riserSpanMeters(): number {
    const s = this.dynamics.state
    return vLen(
      v3(
        s.canopyPos.x - s.pilotPos.x,
        s.canopyPos.y - s.pilotPos.y,
        s.canopyPos.z - s.pilotPos.z,
      ),
    )
  }
}
