/**
 * First-Principles Kinematic Paraglider Flight Engine.
 *
 * Implements clean, 100% predictable, responsive flight kinematics:
 * 1. Coordinated Banking & Turning:
 *    - Bank angle smoothly follows steering / roll demand.
 *    - Heading turns smoothly at standard coordinated rate proportional to bank angle.
 *    - Zero stalls, zero adverse yaw death spins, zero instability.
 * 2. Intuitive Pitch & Speed Envelope:
 *    - Neutral posture (~38°-42°): Pure trim glide at 45 km/h, sink rate -1.2 m/s, 10.4:1 glide ratio.
 *    - Tilting forward (diving): Accelerates smoothly up to 85 km/h, canopy pitches down, sink rate steepens.
 *    - Tilting backward (flaring/braking): Airspeed converts into ballooning climb (+2.5 m/s), decelerates to 25 km/h.
 *    - Overhead tilt (>= 115°): Wing collapses into a rapid plunge (-19.5 m/s) until leveled off.
 * 3. Tethered Pilot Dynamics:
 *    - Pilot hangs 5.3m below canopy with organic pendulum sway into turns.
 */

import type {
  AtmosphereState,
  CanopyState,
  FlightControls,
  FlightTelemetry,
  PilotState,
} from './types'
import type { FlightWorld } from '../world/types'
import {
  PARAMOTOR_FREERIDE_18M,
  PARAGLIDER_XC_24M,
  SPEEDWING_13M,
  type WingGeometry,
} from './aerodynamics'
import {
  clamp,
  DEG,
  qFromYawPitchRoll,
  qRotate,
  v3,
  vAdd,
  vAddScaled,
  vCopy,
  type Quat,
  type V3,
} from './vecmath'

export type TerrainSampler = (x: number, z: number) => number

export const SUBSTEP = 1 / 120
const MAX_FRAME_DT = 0.1

export class ParagliderSimulation {
  public canopy: CanopyState
  public pilot: PilotState
  public controls: FlightControls
  public atmosphere: AtmosphereState
  public telemetry: FlightTelemetry
  public wing: WingGeometry

  // Simulation flags & state
  public isStalled: boolean = false
  public isSpinning: boolean = false
  public asymmetricStallSide: 'none' | 'left' | 'right' = 'none'
  public leftWingCollapse: number = 0
  public rightWingCollapse: number = 0
  public isCrashed: boolean = false
  public isLanded: boolean = false
  public isLinesSlack: boolean = false
  public leftBrakeForceN: number = 0
  public rightBrakeForceN: number = 0
  public stallWarning: number = 0
  public leftStalled: boolean = false
  public rightStalled: boolean = false
  public isBStall: boolean = false
  public isCollapsed: boolean = false
  public collapseFrac: number = 0
  public tumbleStreak: number = 0
  public cumulativePitchDeg: number = 0
  public lastTumblePitchDeg: number = 0
  public slackTimer: number = 0
  public stallTime: number = 0
  public surgeTimer: number = 0
  public groundClearanceMeters: number = 100
  public isFootDragging: boolean = false
  public lineTensionNewtons: number = 860
  public leftLineTensionNewtons: number = 430
  public rightLineTensionNewtons: number = 430
  public world: FlightWorld | null = null
  public thermalRollTorqueDeg: number = 0

  // Two-Body State (World Frame)
  private cPos: V3
  private cVel: V3
  private cQ: Quat

  private pPos: V3
  private pVel: V3

  public currentWingType: 'speedwing' | 'paraglider' | 'paramotor' = 'paraglider'
  public launchPos: V3
  private engineRpm: number = 0

  // Attitude & Aerodynamic State (Degrees)
  public headingDeg: number = 5.0
  public pitchDeg: number = 1.2
  public bankDeg: number = 0.0
  public rollRateDegPerSec: number = 0.0
  public turnRateDegPerSec: number = 0.0
  public turnHoldTime: number = 0.0
  public whipFrac: number = 0.0
  public airspeedKmh: number = 45.0
  private currentSinkMps: number = -1.2
  public ringLiftBoostTimer: number = 0
  public ringLiftBoostMps: number = 0

  public applyRingLiftBoost(mps: number = 2.0, durationSec: number = 1.2): void {
    this.ringLiftBoostMps = mps
    this.ringLiftBoostTimer = durationSec
  }

  // Acro State Machines
  public isLooping: boolean = false
  public loopProgress: number = 0
  public isRolling: boolean = false
  public rollProgress: number = 0
  public rollDirection: number = 1

  public triggerLoop(): boolean {
    if (this.isCrashed || this.isLanded || this.isCollapsed) return false
    if (this.isLooping || this.isRolling) return false
    this.isLooping = true
    this.loopProgress = 0
    return true
  }

  public triggerRoll(direction: number = 1): boolean {
    if (this.isCrashed || this.isLanded || this.isCollapsed) return false
    if (this.isLooping || this.isRolling) return false
    this.isRolling = true
    this.rollProgress = 0
    this.rollDirection = direction >= 0 ? 1 : -1
    return true
  }

  private initialAltitude: number
  private initialHeadingDeg: number

  constructor(
    initialAltitude: number = 2050,
    initialHeadingDeg: number = 5,
    defaultWing: 'speedwing' | 'paraglider' | 'paramotor' = 'paraglider',
    startPos?: { x: number; y: number; z: number },
  ) {
    this.currentWingType = defaultWing
    if (defaultWing === 'paramotor') {
      this.wing = { ...PARAMOTOR_FREERIDE_18M }
      this.engineRpm = 2200
    } else if (defaultWing === 'paraglider') {
      this.wing = { ...PARAGLIDER_XC_24M }
      this.engineRpm = 0
    } else {
      this.wing = { ...SPEEDWING_13M }
      this.engineRpm = 0
    }
    this.initialAltitude = initialAltitude
    this.initialHeadingDeg = initialHeadingDeg
    const spawn = startPos ?? { x: 0, y: initialAltitude, z: 0 }
    this.launchPos = v3(spawn.x, spawn.y, spawn.z)
    this.headingDeg = initialHeadingDeg
    this.pitchDeg = 1.0
    this.bankDeg = 0
    this.airspeedKmh = this.wing.trimSpeedKmh || 45.0
    this.currentSinkMps = -1.2

    const headingRad = initialHeadingDeg * DEG
    const trimSpeedMps = this.airspeedKmh / 3.6
    this.cPos = v3(spawn.x, spawn.y, spawn.z)
    this.cVel = v3(Math.sin(headingRad) * trimSpeedMps, this.currentSinkMps, Math.cos(headingRad) * trimSpeedMps)
    this.cQ = qFromYawPitchRoll(initialHeadingDeg, this.pitchDeg, 0)

    const tetherL = this.wing.tetherLengthMeters || 3.8
    const pilotOffset = v3(0, -tetherL, -0.42)
    this.pPos = vAdd(this.cPos, qRotate(this.cQ, pilotOffset))
    this.pVel = vCopy(this.cVel)

    this.canopy = {
      position: { x: spawn.x, y: spawn.y, z: spawn.z },
      velocity: { x: this.cVel.x, y: this.cVel.y, z: this.cVel.z },
      quaternion: { x: this.cQ.x, y: this.cQ.y, z: this.cQ.z, w: this.cQ.w },
      rollDeg: 0,
      pitchDeg: this.pitchDeg,
      yawDeg: initialHeadingDeg,
      airspeedKmh: this.airspeedKmh,
      verticalSpeedMps: this.currentSinkMps,
      angleOfAttackDeg: 6.5,
      leftTrailingEdgeFlex: 0,
      rightTrailingEdgeFlex: 0,
      leftWingCollapse: 0,
      rightWingCollapse: 0,
      asymmetricStallSide: 'none',
      isNegativeSpin: false,
      isBStall: false,
    }

    this.pilot = {
      position: { x: this.pPos.x, y: this.pPos.y, z: this.pPos.z },
      velocity: { x: this.pVel.x, y: this.pVel.y, z: this.pVel.z },
      pendulumRollDeg: 0,
      pendulumPitchDeg: 0,
      angularVelocityRoll: 0,
      angularVelocityPitch: 0,
      gForce: 1.0,
      harnessWeightShift: 0,
      reverseStanceYawDeg: 0,
      isFootDragging: false,
    }

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
      turbulence: 0.03,
      thermalUpdraftMps: 0,
      ridgeLiftMps: 0,
    }

    this.telemetry = {
      altitudeMeters: initialAltitude,
      terrainHeightMeters: 650,
      groundClearanceMeters: initialAltitude - 650,
      airspeedKmh: this.airspeedKmh,
      groundSpeedKmh: this.airspeedKmh,
      verticalSpeedMps: this.currentSinkMps,
      glideRatio: 10.4,
      gForce: 1.0,
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
      pitchDeg: this.pitchDeg,
      headingDeg: initialHeadingDeg,
      wingType: 'speedwing',
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
  }

  public setSeed(_seed: number) {}

  public setWing(wingType: 'speedwing' | 'paraglider' | 'paramotor') {
    this.currentWingType = wingType
    if (wingType === 'paramotor') {
      this.wing = { ...PARAMOTOR_FREERIDE_18M }
      this.engineRpm = 2200
    } else if (wingType === 'paraglider') {
      this.wing = { ...PARAGLIDER_XC_24M }
      this.engineRpm = 0
    } else {
      this.wing = { ...SPEEDWING_13M }
      this.engineRpm = 0
    }
    this.telemetry.wingType = wingType
    this.telemetry.glideRatio = this.wing.glideRatio
  }

  public reset(
    initialAltitude: number = this.initialAltitude,
    initialHeadingDeg: number = this.initialHeadingDeg,
    startPos?: { x: number; y: number; z: number },
  ) {
    let spawn = startPos ?? { x: 0, y: initialAltitude, z: 0 }
    const tetherL = this.wing.tetherLengthMeters || 3.8
    if (this.world && typeof this.world.sampleHeight === 'function') {
      const terrainH = this.world.sampleHeight(spawn.x, spawn.z)
      const minCanopyY = terrainH + tetherL + 9.0 // Guaranteed 9m clean-air launch clearance
      if (spawn.y < minCanopyY) {
        spawn = { x: spawn.x, y: minCanopyY, z: spawn.z }
      }
    }

    this.launchPos = v3(spawn.x, spawn.y, spawn.z)
    this.cPos = v3(spawn.x, spawn.y, spawn.z)
    this.headingDeg = initialHeadingDeg
    this.pitchDeg = 1.0
    this.bankDeg = 0
    this.rollRateDegPerSec = 0
    this.turnRateDegPerSec = 0
    this.turnHoldTime = 0
    this.whipFrac = 0
    this.airspeedKmh = this.wing.trimSpeedKmh || 82.0
    this.currentSinkMps = -6.2

    const headingRad = initialHeadingDeg * DEG
    const trimSpeedMps = this.airspeedKmh / 3.6
    this.cVel = v3(Math.sin(headingRad) * trimSpeedMps, this.currentSinkMps, Math.cos(headingRad) * trimSpeedMps)
    this.cQ = qFromYawPitchRoll(initialHeadingDeg, this.pitchDeg, 0)

    const pilotOffset = v3(0, -tetherL, -0.42)
    this.pPos = vAdd(this.cPos, qRotate(this.cQ, pilotOffset))
    this.pVel = vCopy(this.cVel)

    this.isLooping = false
    this.loopProgress = 0
    this.isRolling = false
    this.rollProgress = 0

    this.isCrashed = false
    this.isLanded = false
    this.isStalled = false
    this.isSpinning = false
    this.isCollapsed = false
    this.collapseFrac = 0
    this.telemetry.isCollapsed = false
    this.telemetry.collapseFrac = 0
    this.telemetry.altitudeMeters = spawn.y
    this.telemetry.maxAltitudeMeters = spawn.y
    this.telemetry.xcDistanceMeters = 0
    this.telemetry.flightDurationSeconds = 0

    this.syncState()
  }

  public step(dt: number, sampleTerrainHeight: TerrainSampler): void {
    if (this.isCrashed) return
    const frameDt = clamp(dt, 0.001, MAX_FRAME_DT)

    // 1. First-Principles Independent Dual-Brake Line Aerodynamics & Finite Motor Control:
    const leftBrake = clamp(this.controls.leftBrake || 0, 0, 1)
    const rightBrake = clamp(this.controls.rightBrake || 0, 0, 1)
    const brakeDiff = rightBrake - leftBrake // [-1.0, 1.0]: Asymmetric trailing edge deflection
    const dualBrake = Math.min(leftBrake, rightBrake) // Symmetric brake [0, 1] for polar modulation & flare
    const weightShift = clamp(this.controls.weightShift || 0, -1, 1) // Harness hip shift [-1.0, 1.0]
    const speedBar = clamp((this.controls.speedBar ?? 0) + (this.controls.pullingA ?? 0), 0, 1)

    // Coordinated steering demand:
    // Trailing edge asymmetric brake drag gives immediate, finite yaw authority.
    // Harness weight shift tilts the pilot's weight in the carabiners, smoothly rolling the wing.
    // Together, they allow millimetric, finite control over heading and bank for flocking and thermal coring!
    const steerDemand = clamp(brakeDiff + weightShift * (0.65 + 0.35 * (1.0 - Math.abs(brakeDiff))), -1.0, 1.0)
    const absSteer = Math.abs(steerDemand)

    const isSpeedwing = this.currentWingType === 'speedwing'
    const isParamotor = this.currentWingType === 'paramotor'

    // Authentic Aerodynamic Flight Performance Profiles:
    // Paraglider: 38 km/h trim, -1.05 m/s sink. Minimum sink: 32 km/h, -0.92 m/s sink! Floats in any thermal!
    // Speedwing: 65 km/h trim, -1.85 m/s sink. Uncapped Dive: 188 km/h, -35.0 m/s sink, pitch up to 72°!
    const baseTrimSpeed = isSpeedwing ? 65.0 : (isParamotor ? 48.0 : 38.0)
    const baseTrimSink = isSpeedwing ? -1.85 : (isParamotor ? -1.40 : -1.05)
    const maxDiveSpeed = isSpeedwing ? 188.0 : (isParamotor ? 86.0 : 58.0)
    const maxDiveSink = isSpeedwing ? -35.0 : (isParamotor ? -12.0 : -5.2)
    const maxDivePitch = isSpeedwing ? 72.0 : 36.0
    const minFlareSpeed = isSpeedwing ? 32.0 : (isParamotor ? 24.0 : 18.0)

    const spiralFrac = isSpeedwing ? clamp(Math.min(absSteer * 1.25, speedBar * 1.25), 0, 1) : 0
    const maxBankDeg = isSpeedwing ? (48.0 + spiralFrac * 18.0) : 38.0

    // Continuous, finite bank angle:
    // Small inputs (e.g. 5% brake) smoothly command ~1.9° bank for sub-degree flocking trims.
    // Deep inputs (> 50%) command full carving banks up to 38° (or 66° in high-G speedwing spiral).
    const targetBankDeg = steerDemand * maxBankDeg + (this.thermalRollTorqueDeg || 0)

    // Dynamic Roll Response (first-principles roll damping):
    const rollError = targetBankDeg - this.bankDeg
    const isReturningRoll = Math.abs(targetBankDeg) < Math.abs(this.bankDeg) || absSteer < 0.005
    const springK = isReturningRoll ? (absSteer < 0.005 ? 38.0 : 28.0) : 22.0
    const dampC = isReturningRoll ? (absSteer < 0.005 ? 13.0 : 10.5) : 9.0

    const rollAccel = rollError * springK - this.rollRateDegPerSec * dampC
    this.rollRateDegPerSec += rollAccel * frameDt
    this.bankDeg += this.rollRateDegPerSec * frameDt

    const absBank = Math.abs(this.bankDeg)

    // Solid Heading Lock when neutral; Proportional, finite turn rate when commanding:
    if (absSteer < 0.005 && absBank < 0.45 && Math.abs(this.thermalRollTorqueDeg || 0) < 0.05) {
      this.turnRateDegPerSec = 0
      this.bankDeg = 0
      this.rollRateDegPerSec = 0
    } else {
      const speedScale = Math.min(1.35, Math.max(0.75, this.airspeedKmh / baseTrimSpeed))
      // Coordinated turn: centripetal acceleration a_c = g * tan(bank)
      const bankRad = this.bankDeg * DEG
      const centripetalTurnRate = (9.81 * Math.tan(bankRad) / Math.max(4.0, this.airspeedKmh / 3.6)) * (180.0 / Math.PI)
      // Direct aerodynamic yaw from trailing-edge brake deflection:
      const brakeYaw = brakeDiff * (isSpeedwing ? 32.0 : 22.0) * speedScale
      const spiralYaw = Math.sign(this.bankDeg) * spiralFrac * 26.0
      const targetTurnRate = centripetalTurnRate + brakeYaw + spiralYaw
      const turnFollow = isReturningRoll ? 22.0 : 16.0
      this.turnRateDegPerSec += (targetTurnRate - this.turnRateDegPerSec) * Math.min(1.0, turnFollow * frameDt)
      this.headingDeg = (this.headingDeg + this.turnRateDegPerSec * frameDt + 360) % 360
    }

    // 2. Pitch & Speed Envelope:
    // Collapse detection from controls or flag
    const wantsCollapse = (this.controls as any).isCollapsed || this.isCollapsed
    if (wantsCollapse) {
      this.collapseFrac = Math.min(1.0, this.collapseFrac + 3.5 * frameDt)
    } else {
      this.collapseFrac = Math.max(0.0, this.collapseFrac - 4.0 * frameDt)
    }
    this.isCollapsed = this.collapseFrac > 0.15

    // Authentic Polar Curve & Speed Envelope:
    const bankRad = absBank * DEG
    const bankInducedSink = (1.0 / Math.max(0.2, Math.cos(bankRad)) - 1.0) * 0.95
    let targetAirspeedKmh = baseTrimSpeed + (absBank / 45.0) * 4.0
    let targetSinkMps = baseTrimSink - bankInducedSink
    let targetPitchDeg = 1.0

    if (this.collapseFrac > 0.05) {
      // True Freefall Plunge (Wing Collapse):
      targetAirspeedKmh = 14.0
      targetSinkMps = -38.0 * Math.pow(this.collapseFrac, 0.75)
      targetPitchDeg = 65.0 * this.collapseFrac
    } else if (speedBar > 0.01) {
      // Speed Bar (accelerator system pulls A-risers, lower AoA, higher speed):
      targetAirspeedKmh = baseTrimSpeed + speedBar * (maxDiveSpeed - baseTrimSpeed)
      targetSinkMps = baseTrimSink + speedBar * (maxDiveSink - baseTrimSink) - spiralFrac * 8.0
      targetPitchDeg = 1.0 + speedBar * (maxDivePitch - 1.0)
    } else if (dualBrake > 0.02) {
      // Symmetrical Dual Brake:
      if (dualBrake <= 0.35) {
        // Minimum Sink Mode (hands at chest / ~20% brake):
        // Airfoil enters high-lift camber without excess drag.
        // Airspeed decreases to ~32 km/h; sink rate drops to floaty -0.92 m/s!
        const minSinkFrac = dualBrake / 0.35
        targetAirspeedKmh = baseTrimSpeed - minSinkFrac * 6.0
        targetSinkMps = baseTrimSink + minSinkFrac * 0.13 // -1.05 -> -0.92 m/s!
        targetPitchDeg = 1.0 - minSinkFrac * 2.0
      } else if (dualBrake <= 0.70) {
        // Half to Three-Quarter Brake (slow flight / steep descent):
        const deepFrac = (dualBrake - 0.35) / 0.35
        targetAirspeedKmh = 32.0 - deepFrac * 6.0
        targetSinkMps = -0.92 - deepFrac * 0.45 // -0.92 -> -1.37 m/s
        targetPitchDeg = -1.0 - deepFrac * 3.0
      } else {
        // Full Flare (hands buried): converts remaining kinetic energy into buoyant climb up to +2.5 m/s!
        const flareFrac = (dualBrake - 0.70) / 0.30
        const speedExcess = Math.max(0, this.airspeedKmh - 22.0) / 20.0
        const dynamicClimb = flareFrac * 3.2 * speedExcess
        targetAirspeedKmh = 26.0 - flareFrac * (26.0 - minFlareSpeed)
        targetSinkMps = -1.37 + flareFrac * 1.37 + dynamicClimb
        targetPitchDeg = -4.0 - flareFrac * 10.0
      }
    }

    // Paramotor throttle support (if active)
    if (this.currentWingType === 'paramotor' && this.engineRpm > 1000) {
      const throttleFrac = (this.engineRpm - 1000) / 4500
      targetSinkMps += throttleFrac * 4.5
      targetAirspeedKmh += throttleFrac * 12.0
    }

    // Atmospheric Updrafts & Thermals
    const wind = this.getAtmosphericWindAt(this.cPos, sampleTerrainHeight)
    targetSinkMps += (this.atmosphere.ridgeLiftMps || 0) + (this.atmosphere.thermalUpdraftMps || 0) * 0.85

    // Aerial Ring Pass-Through Updraft Boost (smooth buoyant loft):
    if (this.ringLiftBoostTimer > 0) {
      this.ringLiftBoostTimer -= frameDt
      const liftFrac = Math.min(1.0, this.ringLiftBoostTimer / 0.4)
      targetSinkMps += this.ringLiftBoostMps * liftFrac
    }

    // Forward Dive & Gravity Acceleration Dynamics:
    const isCollapsing = this.collapseFrac > 0.05
    const curPitchRad = Math.max(0, this.pitchDeg) * DEG
    const gravityComponent = Math.sin(curPitchRad) // 0 at level, ~0.75 at 49° dive

    // Pitch follows aerodynamic pendulum inertia (canopy nose dips forward progressively)
    const pitchLerp = isCollapsing ? 16.0 : (speedBar > 0.05 ? 8.5 : 12.0)
    this.pitchDeg += (targetPitchDeg - this.pitchDeg) * Math.min(1.0, pitchLerp * frameDt)

    // Airspeed acceleration & momentum retention:
    // When whipping into a turn or diving, gravity compounds acceleration down the fall-line.
    // When leveling out, aerodynamic parasite drag decelerates slowly (0.25), sustaining tremendous swoop speed!
    let speedRate = 0.25
    if (isCollapsing) {
      speedRate = 16.0
    } else if (targetAirspeedKmh > this.airspeedKmh) {
      // Compounding gravity acceleration: builds up to 12.5 as dive steepens to 72°!
      speedRate = 1.6 + Math.pow(gravityComponent, 1.15) * 11.5
    } else if (dualBrake > 0.05) {
      speedRate = 7.5
    }
    this.airspeedKmh += (targetAirspeedKmh - this.airspeedKmh) * Math.min(1.0, speedRate * frameDt)

    // Sink rate steepens in sync with dive plunge (up to -35 m/s plunge down the mountain face)
    const sinkRate = isCollapsing ? 14.0 : (speedBar > 0.05 ? (4.5 + Math.pow(gravityComponent, 1.1) * 9.5) : 8.0)
    this.currentSinkMps += (targetSinkMps - this.currentSinkMps) * Math.min(1.0, sinkRate * frameDt)

    // Aerobatics execution:
    let renderPitchDeg = this.pitchDeg
    let renderBankDeg = this.bankDeg

    if (this.isLooping) {
      this.loopProgress += frameDt / 1.15 // ~1.15s dynamic loop
      const p = Math.min(1.0, this.loopProgress)
      renderPitchDeg = this.pitchDeg + p * 360.0
      // Kinetic surge and swoop climb trajectory:
      this.currentSinkMps = -Math.sin(p * Math.PI * 2) * 11.0 - 2.0
      if (this.loopProgress >= 1.0) {
        this.isLooping = false
        this.loopProgress = 0
        this.tumbleStreak++
      }
    } else if (this.isRolling) {
      this.rollProgress += frameDt / 0.95 // ~0.95s barrel roll
      const p = Math.min(1.0, this.rollProgress)
      renderBankDeg = this.bankDeg + p * 360.0 * this.rollDirection
      if (this.rollProgress >= 1.0) {
        this.isRolling = false
        this.rollProgress = 0
        this.tumbleStreak++
      }
    }

    // 3. Trajectory & World Position Integration (Cool Boarders Edge Carving Physics)
    const headingRad = this.headingDeg * DEG

    // In true freefall (wing collapse):
    // Forward glide efficiency drops to zero, and the flyer falls straight down vertically!
    const forwardGlideEff = Math.max(0.0, 1.0 - this.collapseFrac * 1.35)

    // In a spiral dive:
    // The glider is spiraling around a tight vertical cylinder of radius 10-15m.
    // Forward translation across the map is reduced by ~75%, while vertical descent dominates!
    const spiralTransDamp = 1.0 - spiralFrac * 0.75

    // Pitch-coupled horizontal speed:
    // As the nose pitches down into a steep dive, horizontal speed is proportional to cos(pitch),
    // directing the increased kinetic energy into vertical descent down the slope,
    // rather than zooming horizontally along the map!
    const divePitchRad = Math.max(0, renderPitchDeg) * DEG
    const horizPitchFactor = Math.cos(divePitchRad)

    const rawHSpeedMps = (this.airspeedKmh / 3.6) * forwardGlideEff * horizPitchFactor * spiralTransDamp
    const hSpeedMps = Math.max(0, rawHSpeedMps)

    // Aerodynamic Edge Carving Trajectory:
    // The velocity vector curves along the turn with aerodynamic weathervane following,
    // holding an edge like a snowboard in Cool Boarders rather than snapping instantaneously!
    const targetFwdX = Math.sin(headingRad) * hSpeedMps
    const targetFwdZ = Math.cos(headingRad) * hSpeedMps

    const windHorizDamp = 1.0 - this.collapseFrac * 0.85
    const curHorizVX = this.cVel.x - wind.x * windHorizDamp
    const curHorizVZ = this.cVel.z - wind.z * windHorizDamp

    // ~80ms relaxation follow rate produces natural geometric arcs and tangible edge pressure:
    const carveFollowRate = 12.5
    const newVX = curHorizVX + (targetFwdX - curHorizVX) * Math.min(1.0, carveFollowRate * frameDt)
    const newVZ = curHorizVZ + (targetFwdZ - curHorizVZ) * Math.min(1.0, carveFollowRate * frameDt)

    this.cVel = v3(newVX + wind.x * windHorizDamp, this.currentSinkMps + wind.y, newVZ + wind.z * windHorizDamp)
    this.cPos = vAddScaled(this.cPos, this.cVel, frameDt)
    this.cQ = qFromYawPitchRoll(this.headingDeg, renderPitchDeg, renderBankDeg)

    // 4. Pilot Position: First-Principles Paraglider Flight Mechanics
    // The canopy is the aerodynamic tractor pulling the pilot.
    // The pilot hangs below in canopy body space and trails BEHIND the canopy along the flight path
    // due to body drag and inertia.
    const tetherL = this.wing.tetherLengthMeters || 3.8

    // Forward/Aft Aerodynamic Trail in canopy body space:
    // - Trim glide (82 km/h): pilot trails ~0.42m behind (-Z in body space)
    // - Speedbar dive (126 km/h): canopy surges forward; pilot trails ~0.80m behind
    // - Flare climb (38 km/h): wing decelerates, pilot gently swings forward to ~0.20m behind (never in front!)
    const trailZ = -0.42 - speedBar * 0.38 + dualBrake * 0.22

    // Centrifugal Sling Dynamic Sway in canopy body space:
    // As the flyer turns on the sling, centrifugal force pushes the pilot outward on the turn radius
    const swayX = clamp(this.controls.weightShift || 0, -1, 1) * 0.18
    const centrifugalSwing = clamp((this.bankDeg / 45.0) * (this.pilot.gForce - 0.9) * 0.28, -0.65, 0.65)
    const slingX = swayX - centrifugalSwing

    // Vertical line drop maintaining geometric line length: L_y = sqrt(L^2 - d_trail^2 - d_sling^2)
    const horizDistSq = trailZ * trailZ + slingX * slingX
    const dropY = Math.sqrt(Math.max(1.0, tetherL * tetherL - horizDistSq))

    // Rotate local offset by canopy quaternion cQ:
    // This locks pilot and carabiners 100% to canopy frame with ZERO line jumping!
    const pilotLocalOffset = v3(slingX, -dropY, trailZ)
    this.pPos = vAdd(this.cPos, qRotate(this.cQ, pilotLocalOffset))
    this.pVel = vCopy(this.cVel)

    // 5. Terrain & Ground Clearance
    const terrainH = sampleTerrainHeight ? sampleTerrainHeight(this.pPos.x, this.pPos.z) : 0
    this.groundClearanceMeters = Math.max(0, this.pPos.y - terrainH)

    if (this.groundClearanceMeters <= 0.05) {
      if (this.currentSinkMps < -4.5 || this.isCollapsed) {
        this.isCrashed = true
      } else {
        // Soft landing / ground skim
        this.pPos.y = terrainH
        this.cPos.y = terrainH + tetherL
        this.currentSinkMps = 0
        this.isLanded = true
      }
    }

    this.isFootDragging = this.groundClearanceMeters > 0.05 && this.groundClearanceMeters < 1.8 && this.airspeedKmh > 18.0

    this.syncState()
  }

  public getWingTipPositions(): { left: V3; right: V3; center: V3 } {
    const halfSpan = (this.wing.spanMeters || 10.5) * 0.5
    const uRight = qRotate(this.cQ, v3(1, 0, 0))
    return {
      left: vAddScaled(this.cPos, uRight, -halfSpan),
      right: vAddScaled(this.cPos, uRight, halfSpan),
      center: vCopy(this.cPos),
    }
  }

  private syncState(): void {
    // Sync public canopy state for renderers and cameras
    this.canopy.position = { x: this.cPos.x, y: this.cPos.y, z: this.cPos.z }
    this.canopy.velocity = { x: this.cVel.x, y: this.cVel.y, z: this.cVel.z }
    this.canopy.quaternion = { x: this.cQ.x, y: this.cQ.y, z: this.cQ.z, w: this.cQ.w }
    this.canopy.rollDeg = this.bankDeg
    this.canopy.pitchDeg = this.pitchDeg
    this.canopy.yawDeg = this.headingDeg
    this.canopy.airspeedKmh = this.airspeedKmh
    this.canopy.verticalSpeedMps = this.currentSinkMps

    // Sync pilot state
    this.pilot.position = { x: this.pPos.x, y: this.pPos.y, z: this.pPos.z }
    this.pilot.velocity = { x: this.pVel.x, y: this.pVel.y, z: this.pVel.z }
    this.pilot.pendulumRollDeg = this.bankDeg * 0.35
    this.pilot.pendulumPitchDeg = this.pitchDeg * 0.40
    this.pilot.isFootDragging = this.isFootDragging

    // Centrifugal & turn G-force
    const bankRad = Math.abs(this.bankDeg) * DEG
    const spiralFrac = clamp(Math.min(Math.abs(this.bankDeg / 45.0), (this.controls.speedBar || 0) * 1.25), 0, 1)
    let turnG = 1.0 / Math.max(0.18, Math.cos(bankRad)) + this.whipFrac * 1.4 + spiralFrac * 1.6
    if (this.isLooping) {
      turnG = 1.0 + Math.sin(this.loopProgress * Math.PI) * 2.8
    }
    this.pilot.gForce = clamp(turnG + (this.currentSinkMps > 0 ? 0.3 : 0), 0.8, 4.4)

    // Sync telemetry
    this.telemetry.altitudeMeters = this.pPos.y
    this.telemetry.terrainHeightMeters = this.pPos.y - this.groundClearanceMeters
    this.telemetry.groundClearanceMeters = this.groundClearanceMeters
    this.telemetry.airspeedKmh = this.airspeedKmh
    this.telemetry.groundSpeedKmh = Math.hypot(this.cVel.x, this.cVel.z) * 3.6
    this.telemetry.verticalSpeedMps = this.currentSinkMps
    this.telemetry.glideRatio = this.currentSinkMps < -0.05 ? Math.abs((this.airspeedKmh / 3.6) / this.currentSinkMps) : 15.0
    this.telemetry.gForce = this.pilot.gForce
    this.telemetry.bankDeg = this.bankDeg
    this.telemetry.pitchDeg = this.pitchDeg
    this.telemetry.headingDeg = this.headingDeg
    this.telemetry.isCollapsed = this.isCollapsed
    this.telemetry.collapseFrac = this.collapseFrac
    this.telemetry.isLinesSlack = this.collapseFrac > 0.15
    this.telemetry.tumbleStreak = this.tumbleStreak
    this.telemetry.engineRpm = this.engineRpm
  }

  private getAtmosphericWindAt(pos: V3, sample: TerrainSampler): V3 {
    const windRad = (this.atmosphere.windHeadingDeg ?? 190) * DEG
    const windSpeedMps = (this.atmosphere.windSpeedKmh ?? 12) / 3.6
    const baseWind = v3(Math.sin(windRad) * windSpeedMps, 0, Math.cos(windRad) * windSpeedMps)

    let ridgeLiftMps = 0
    if (sample && this.groundClearanceMeters < 150) {
      const eps = 4.0
      const dhdx = (sample(pos.x + eps, pos.z) - sample(pos.x - eps, pos.z)) / (2 * eps)
      const dhdz = (sample(pos.x, pos.z + eps) - sample(pos.x, pos.z - eps)) / (2 * eps)
      const normalUpdraft = -(baseWind.x * dhdx + baseWind.z * dhdz)
      const decay = Math.exp(-this.groundClearanceMeters / 90.0)
      ridgeLiftMps = Math.max(0, normalUpdraft) * decay * 0.7
    }
    this.atmosphere.ridgeLiftMps = ridgeLiftMps

    let thermalUpdraft = 0
    let thermalRollTorque = 0
    if (this.world && this.world.sampleUpdraft) {
      const tSec = this.telemetry.flightDurationSeconds || 0
      const windObj = { x: baseWind.x, y: baseWind.y, z: baseWind.z }
      thermalUpdraft = this.world.sampleUpdraft(
        pos.x,
        pos.y,
        pos.z,
        tSec,
        windObj,
      )
      // Spanwise thermal lift differential:
      // When one wingtip brushes against a thermal column, that wing experiences higher updraft,
      // rolling the wing away from the thermal and communicating the invisible lift current physically to the pilot!
      const tips = this.getWingTipPositions()
      const upLeft = this.world.sampleUpdraft(tips.left.x, tips.left.y, tips.left.z, tSec, windObj)
      const upRight = this.world.sampleUpdraft(tips.right.x, tips.right.y, tips.right.z, tSec, windObj)
      // Right wingtip higher updraft -> rolls left (negative bank torque away from thermal)
      thermalRollTorque = clamp((upLeft - upRight) * 1.85, -8.0, 8.0)
    }
    this.atmosphere.thermalUpdraftMps = thermalUpdraft
    this.thermalRollTorqueDeg = thermalRollTorque

    return baseWind
  }
}
