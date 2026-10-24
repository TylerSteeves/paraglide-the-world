/**
 * First-Principles Kinematic Paraglider Flight Engine.
 *
 * Implements clean, 100% predictable, responsive flight kinematics:
 * 1. Coordinated Banking & Turning:
 *    - Bank angle smoothly follows steering / roll demand.
 *    - Heading turns smoothly at standard coordinated rate proportional to bank angle.
 *    - Zero stalls, zero adverse yaw death spins, zero instability.
 * 2. Intuitive Pitch & Speed Envelope:
 *    - Neutral posture holds altitude. Looking down is what descends.
 *    - Tilting forward dives along a flying path. Tilting back climbs.
 *    - Overhead tilt (>= 115°): Wing collapses into a rapid plunge (-19.5 m/s) until leveled off.
 * 3. Tethered Pilot Dynamics:
 *    - The wing banks and moves into the turn first. The pilot stays on the
 *      line already being flown, then is pulled across. A right bank never
 *      swings the body out to the left.
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
  vAddScaled,
  vCopy,
  type Quat,
  type V3,
} from './vecmath'
import type { WorldObstacle } from '../world/types'

/**
 * Map footprints and the photo mesh do not sit on the buildings you see.
 * Crashing on either one detonates the wing in open air, so only hand-placed
 * landmarks, trees, and mountain objects are solid.
 */
function pointHitsObstacle(px: number, py: number, pz: number, obs: WorldObstacle): boolean {
  if (obs.ring && obs.ring.length >= 3) return false

  const spanY = Math.max(0.5, obs.yMax - obs.yMin)
  const roofSkin = Math.min(obs.type === 'tree' ? 1.4 : 2.0, spanY * 0.22)
  if (py < obs.yMin || py > obs.yMax - roofSkin) return false

  const dx = Math.abs(px - obs.x)
  const dz = Math.abs(pz - obs.z)
  if (obs.halfWidth !== undefined && obs.halfDepth !== undefined) {
    // A few metres of glass, then the building is solid. The old inner-half
    // test let you fly through a facade. Grazing the outer skin still lives.
    const skinX = Math.min(3.5, obs.halfWidth * 0.28)
    const skinZ = Math.min(3.5, obs.halfDepth * 0.28)
    return dx < obs.halfWidth - skinX && dz < obs.halfDepth - skinZ
  }
  const dist = Math.hypot(dx, dz)
  const edge = Math.min(1.2, Math.max(0.4, obs.radius * 0.35))
  return obs.radius - dist > edge
}

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
  public engineRpm: number = 0
  public pilotMassKg: number = 95.0 // Pilot + harness + reserve (~95 kg; 122 kg with paramotor)
  public isMotorActive: boolean = false
  public thrustNewtons: number = 0

  public setPilotMass(massKg: number): void {
    this.pilotMassKg = clamp(massKg, 50, 220)
  }

  public cyclePilotMass(): number {
    const masses = [75, 95, 125, 145]
    let nextIdx = 0
    for (let i = 0; i < masses.length; i++) {
      if (this.pilotMassKg < masses[i] - 1) {
        nextIdx = i
        break
      }
      if (i === masses.length - 1) nextIdx = 0
    }
    this.setPilotMass(masses[nextIdx])
    return this.pilotMassKg
  }

  // Attitude & Aerodynamic State (Degrees)
  public headingDeg: number = 5.0
  public pitchDeg: number = 1.2
  public bankDeg: number = 0.0
  public rollRateDegPerSec: number = 0.0
  /** Wing up-axis used to hang the pilot last frame, so attitude moves the wing and not the body. */
  private prevWingUp: V3 = v3(0, 1, 0)
  public turnRateDegPerSec: number = 0.0
  public turnHoldTime: number = 0.0
  public whipFrac: number = 0.0
  public airspeedKmh: number = 45.0
  private currentSinkMps: number = -1.2
  private diveKineticSpeedMps: number = 0
  /** 0–1 ramp for the steep half of a dive, so that part accelerates instead of snapping in. */
  private diveBuild: number = 0
  /** Seconds the steep dive has been held. The drop keeps steepening across this. */
  private diveHoldSec: number = 0
  /** Climb still owed from speed gathered in a dive or a steep bank. Positive is up. */
  private zoomClimbMps: number = 0
  private prevAbsBankDeg: number = 0
  private currentUnloadFactor: number = 1.0
  public ringLiftBoostTimer: number = 0
  public ringLiftBoostMps: number = 0
  /** Coins held this flight, up to 10. Each one raises your speed, Mario Kart style. */
  public coinCount: number = 0
  /** Seconds left on the chain dash. Hitting rings keeps it alive. */
  public ringBoostTimer: number = 0

  // GTA-Style Crash & Carnage Telemetry
  public crashReason: string = ''
  public crashImpactSpeedKmh: number = 0
  public crashImpactG: number = 0
  public crashBonesBroken: number = 0
  public crashHospitalBill: number = 0

  public applyRingLiftBoost(mps: number = 2.0, durationSec: number = 1.2): void {
    this.ringLiftBoostMps = mps
    this.ringLiftBoostTimer = durationSec
  }

  /** A ring is a dash panel. Coins raise your speed, and a chain keeps the boost lit. */
  public grantLineBoost(): void {
    this.coinCount = Math.min(10, this.coinCount + 1)
    this.ringBoostTimer = 2.8
    const headingRad = this.headingDeg * DEG
    const kick = 3.4
    this.cVel.x += Math.sin(headingRad) * kick
    this.cVel.z += Math.cos(headingRad) * kick
    this.currentSinkMps += 1.5
  }

  public applyPositionNudge(dx: number, dy: number, dz: number): void {
    this.cPos.x += dx
    this.cPos.y += dy
    this.cPos.z += dz
    this.pPos.x += dx
    this.pPos.y += dy
    this.pPos.z += dz
    this.canopy.position.x = this.cPos.x
    this.canopy.position.y = this.cPos.y
    this.canopy.position.z = this.cPos.z
    this.pilot.position.x = this.pPos.x
    this.pilot.position.y = this.pPos.y
    this.pilot.position.z = this.pPos.z
  }

  public triggerCrash(reason: string, impactSpeedKmh?: number): void {
    if (this.isCrashed) return
    this.isCrashed = true
    const spd = Math.max(25, impactSpeedKmh ?? this.airspeedKmh)
    this.crashReason = reason
    this.crashImpactSpeedKmh = Math.round(spd)
    this.crashImpactG = +(Math.max(3.2, (spd / 16.5) + Math.abs(this.currentSinkMps) * 0.45)).toFixed(1)
    this.crashBonesBroken = Math.min(206, Math.max(2, Math.round((spd / 11.0) + Math.abs(this.currentSinkMps) * 1.4)))
    this.crashHospitalBill = Math.round((this.crashBonesBroken * 4850 + spd * 320) / 100) * 100
    this.syncState()
  }

  // Acro State Machines
  public isLooping: boolean = false
  public loopProgress: number = 0
  public loopDirection: number = 1
  public isRolling: boolean = false
  public rollProgress: number = 0
  public rollDirection: number = 1

  public triggerLoop(direction: number = 1): boolean {
    if (this.isCrashed || this.isLanded || this.isCollapsed) return false
    if (this.isLooping || this.isRolling) return false
    this.isLooping = true
    this.loopProgress = 0
    this.loopDirection = direction >= 0 ? 1 : -1
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
      this.pilotMassKg = 122.0
      this.isMotorActive = true
    } else if (defaultWing === 'paraglider') {
      this.wing = { ...PARAGLIDER_XC_24M }
      this.engineRpm = 0
      this.pilotMassKg = 95.0
      this.isMotorActive = false
    } else {
      this.wing = { ...SPEEDWING_13M }
      this.engineRpm = 0
      this.pilotMassKg = 92.0
      this.isMotorActive = false
    }
    this.initialAltitude = initialAltitude
    this.initialHeadingDeg = initialHeadingDeg
    const spawn = startPos ?? { x: 0, y: initialAltitude, z: 0 }
    this.launchPos = v3(spawn.x, spawn.y, spawn.z)
    this.headingDeg = initialHeadingDeg
    this.pitchDeg = 1.0
    this.bankDeg = 0
    this.airspeedKmh = this.wing.trimSpeedKmh || 45.0
    this.currentSinkMps = defaultWing === 'paraglider' ? 0 : -0.3
    this.diveKineticSpeedMps = 0
    this.diveBuild = 0
    this.diveHoldSec = 0

    const headingRad = initialHeadingDeg * DEG
    const trimSpeedMps = this.airspeedKmh / 3.6
    this.cPos = v3(spawn.x, spawn.y, spawn.z)
    this.cVel = v3(Math.sin(headingRad) * trimSpeedMps, this.currentSinkMps, Math.cos(headingRad) * trimSpeedMps)
    this.cQ = qFromYawPitchRoll(initialHeadingDeg, this.pitchDeg, 0)

    const tetherL = this.wing.tetherLengthMeters || 3.3
    this.prevWingUp = qRotate(this.cQ, v3(0, 1, 0))
    this.pPos = v3(
      this.cPos.x - this.prevWingUp.x * tetherL,
      this.cPos.y - this.prevWingUp.y * tetherL,
      this.cPos.z - this.prevWingUp.z * tetherL,
    )
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
      this.pilotMassKg = 122.0
      this.isMotorActive = true
    } else if (wingType === 'paraglider') {
      this.wing = { ...PARAGLIDER_XC_24M }
      this.engineRpm = 0
      this.pilotMassKg = 95.0
      this.isMotorActive = false
    } else {
      this.wing = { ...SPEEDWING_13M }
      this.engineRpm = 0
      this.pilotMassKg = 92.0
      this.isMotorActive = false
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
    const tetherL = this.wing.tetherLengthMeters || 3.3
    if (this.world && typeof this.world.sampleHeight === 'function') {
      const terrainH = this.world.sampleHeight(spawn.x, spawn.z)
      const minCanopyY = terrainH + tetherL + 16.0 // Guaranteed 16m clean-air launch clearance aligned with Stage 1 rings
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
    this.airspeedKmh = this.wing.trimSpeedKmh || 52.0
    this.currentSinkMps = this.currentWingType === 'paraglider' ? 0 : -0.3
    this.diveKineticSpeedMps = 0
    this.diveBuild = 0
    this.diveHoldSec = 0
    this.zoomClimbMps = 0
    this.coinCount = 0
    this.ringBoostTimer = 0
    this.prevAbsBankDeg = 0

    const headingRad = initialHeadingDeg * DEG
    const trimSpeedMps = this.airspeedKmh / 3.6
    this.cVel = v3(Math.sin(headingRad) * trimSpeedMps, this.currentSinkMps, Math.cos(headingRad) * trimSpeedMps)
    this.cQ = qFromYawPitchRoll(initialHeadingDeg, this.pitchDeg, 0)

    this.prevWingUp = qRotate(this.cQ, v3(0, 1, 0))
    this.pPos = v3(
      this.cPos.x - this.prevWingUp.x * tetherL,
      this.cPos.y - this.prevWingUp.y * tetherL,
      this.cPos.z - this.prevWingUp.z * tetherL,
    )
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
    this.crashReason = ''
    this.crashImpactSpeedKmh = 0
    this.crashImpactG = 0
    this.crashBonesBroken = 0
    this.crashHospitalBill = 0
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
    this.telemetry.flightDurationSeconds = (this.telemetry.flightDurationSeconds || 0) + frameDt

    // 1. First-Principles Dynamic Pilot Mass & Wing Loading Calculations:
    const leftBrake = clamp(this.controls.leftBrake || 0, 0, 1)
    const rightBrake = clamp(this.controls.rightBrake || 0, 0, 1)
    const brakeDiff = rightBrake - leftBrake // [-1.0, 1.0]: Asymmetric trailing edge deflection
    const dualBrake = Math.min(leftBrake, rightBrake) // Symmetric brake [0, 1] for polar modulation & flare
    const rawWeightShift = clamp(this.controls.weightShift || 0, -1, 1)
    const speedBar = clamp((this.controls.speedBar ?? 0) + (this.controls.pullingA ?? 0), 0, 1)

    const isSpeedwing = this.currentWingType === 'speedwing'
    const isParamotor = this.currentWingType === 'paramotor' || this.isMotorActive

    // Total System Mass (Pilot + Harness + Wing):
    const canopyMassKg = this.wing.canopyMassKg || (isSpeedwing ? 3.2 : (isParamotor ? 4.8 : 4.6))
    const totalMassKg = this.pilotMassKg + canopyMassKg
    const refMassKg = isSpeedwing ? 95.2 : (isParamotor ? 126.8 : 99.6)
    const massRatio = Math.sqrt(totalMassKg / refMassKg)

    const massRollScale = Math.min(1.4, Math.max(0.7, this.pilotMassKg / 95.0))
    const weightShift = rawWeightShift * massRollScale

    // Coordinated steering demand: combines body weight shift and gentle trailing-edge brake carve
    const steerDemand = clamp(weightShift + (1.0 - Math.abs(weightShift) * 0.5) * brakeDiff * 0.65, -1.0, 1.0)
    const absSteer = Math.abs(steerDemand)

    // Fast, Exhilarating Flight Performance Profiles:
    // Downhill momentum builds as you charge down the mountain so it NEVER feels like it slows down!
    const downhillMomentumBoost = Math.min(20.0, Math.max(0, this.cPos.z) * 0.009)
    const baseTrimSpeed = ((isSpeedwing ? 88.0 : (isParamotor ? 74.0 : 72.0)) + downhillMomentumBoost) * massRatio
    const baseTrimSink = (isSpeedwing ? -3.40 : (isParamotor ? -1.45 : -1.55)) * massRatio
    const maxDivePitch = isSpeedwing ? 72.0 : (isParamotor ? 46.0 : 68.0)
    const maxDiveSpeed = ((isSpeedwing ? 175.0 : (isParamotor ? 132.0 : 148.0)) + downhillMomentumBoost) * massRatio
    const minFlareSpeed = (isSpeedwing ? 38.0 : (isParamotor ? 28.0 : 26.0)) * massRatio

    // Looking down unlocks a real spiral. Wings-level carve stays the same.
    const diveAmt = speedBar
    const tight = clamp(diveAmt * 0.55 + diveAmt * diveAmt * 0.45, 0, 1)
    const spiralFrac = clamp(absSteer * tight, 0, 1)
    const maxBankDeg = (isSpeedwing ? 40.0 : 34.0) + tight * absSteer * (isSpeedwing ? 48.0 : 46.0)

    // Continuous, finite bank angle (zero uncommanded thermal roll fighting the player's hands!):
    const targetBankDeg = steerDemand * maxBankDeg

    // Smooth, Cushioned Roll Dynamics (over-damped so the wing never whips or snaps violently):
    const rollError = targetBankDeg - this.bankDeg
    const isReturningRoll = Math.abs(targetBankDeg) < Math.abs(this.bankDeg) || absSteer < 0.005
    // Just over critical, so the wing tilts promptly into the turn and cannot swing back through center.
    const springK = isSpeedwing ? 42.0 : 36.0
    const dampC = isSpeedwing ? 15.0 : 13.0

    const rollAccel = rollError * springK - this.rollRateDegPerSec * dampC
    this.rollRateDegPerSec += rollAccel * frameDt
    this.bankDeg += this.rollRateDegPerSec * frameDt

    const absBank = Math.abs(this.bankDeg)

    // Solid Heading Lock when neutral; Smooth, Proportional Carve Authority when steering:
    if (absSteer < 0.005 && absBank < 0.35) {
      this.turnRateDegPerSec = 0
      this.bankDeg = 0
      this.rollRateDegPerSec = 0
    } else {
      const lowSpeedBrakeBoost = 1.0 + Math.max(0, 1.0 - this.airspeedKmh / baseTrimSpeed) * 0.35
      const tightTurn = 1.0 + tight * absSteer * 1.15
      const bankCarve = this.bankDeg * (isSpeedwing ? 1.15 : 0.95) * tightTurn
      const brakeCarve = brakeDiff * (isSpeedwing ? 18.0 : 14.0) * lowSpeedBrakeBoost
      const spiralCarve = Math.sign(this.bankDeg) * spiralFrac * (isSpeedwing ? 28.0 : 22.0)
      // Same bank yaws less as speed rises, so a fast turn carves instead of sliding.
      const overspeed = clamp(this.airspeedKmh / Math.max(36, baseTrimSpeed) - 1, 0, 1.4)
      const yawGrip = 1 - overspeed * 0.24
      const spiralGrip = 1 - overspeed * 0.5
      const targetTurnRate = (bankCarve + brakeCarve) * yawGrip + spiralCarve * spiralGrip
      const turnFollow = isSpeedwing ? 16.0 : (isReturningRoll ? 16.0 : 12.0)
      this.turnRateDegPerSec += (targetTurnRate - this.turnRateDegPerSec) * Math.min(1.0, turnFollow * frameDt)

      // Gentle immediate turn response without jerking the nose:
      const microYaw = steerDemand * (isSpeedwing ? 4.5 : 3.2) * lowSpeedBrakeBoost * yawGrip * frameDt
      this.headingDeg = (this.headingDeg + microYaw + this.turnRateDegPerSec * frameDt + 360) % 360
    }

    const bankNow = Math.abs(this.bankDeg)
    const bankFrom = this.prevAbsBankDeg
    const bankDrop = bankFrom - bankNow
    this.prevAbsBankDeg = bankNow

    // 2. Pitch & Speed Envelope (with Automatic Mountain Slope-Contouring in Neutral Posture!):
    const wantsCollapse = Boolean((this.controls as any).isCollapsed)
    if (wantsCollapse) {
      this.collapseFrac = Math.min(1.0, this.collapseFrac + 4.2 * frameDt)
    } else {
      this.collapseFrac = Math.max(0.0, this.collapseFrac - 4.5 * frameDt)
    }
    this.isCollapsed = this.collapseFrac > 0.15

    // Local Terrain Slope Calculation along Current Heading:
    const tetherL = this.wing.tetherLengthMeters || 3.3
    const hHere = sampleTerrainHeight ? sampleTerrainHeight(this.cPos.x, this.cPos.z) : 0
    const lookDist = 25.0
    const headingRadNow = this.headingDeg * DEG
    const hAhead = sampleTerrainHeight
      ? sampleTerrainHeight(
          this.cPos.x + Math.sin(headingRadNow) * lookDist,
          this.cPos.z + Math.cos(headingRadNow) * lookDist,
        )
      : hHere
    const slopeGrade = clamp((hAhead - hHere) / lookDist, -0.85, 0.25) // Negative when flying downhill
    const slopeFollowSinkMps = Math.min(baseTrimSink, slopeGrade * (baseTrimSpeed / 3.6))

    const bankRad = absBank * DEG
    const bankInducedSink = (1.0 / Math.max(0.25, Math.cos(bankRad)) - 1.0) * 0.35
    let targetAirspeedKmh = baseTrimSpeed + (absBank / 45.0) * 6.0

    // A level phone holds altitude, turns included. Looking down is what descends.
    // The powered wing holds altitude too. Looking up is what climbs.
    const floatSink = (isSpeedwing ? -0.8 : 0) * massRatio
    const turnSink = isSpeedwing ? bankInducedSink : 0
    let targetSinkMps = floatSink - turnSink
    let targetPitchDeg = 3.0
    // Flight-path angle while the wing is diving. Sink and forward speed are
    // the two parts of this one speed, so the wing keeps flying instead of dropping.
    // The first half of a look-down is immediate. The steep half eases in,
    // so the deep dive accelerates instead of arriving all at once.
    const diveShallow = 0.5
    const deepTarget = speedBar <= diveShallow ? 0 : (speedBar - diveShallow) / (1 - diveShallow)
    const commitRate = deepTarget > this.diveBuild ? 0.95 : 4.5
    this.diveBuild += (deepTarget - this.diveBuild) * Math.min(1.0, commitRate * frameDt)
    const diveCurve = Math.min(speedBar, diveShallow) + this.diveBuild * (1 - diveShallow)
    // Once the steep half has started, holding the angle keeps steepening the
    // dive. The longer it is held, the faster that steepening gets. Letting go
    // drops it. A quick look down never reaches this.
    const surgeHeld = speedBar > 0.62 && this.diveBuild > 0.18 && this.collapseFrac <= 0.05
    if (surgeHeld) this.diveHoldSec = Math.min(8, this.diveHoldSec + frameDt)
    else this.diveHoldSec = Math.max(0, this.diveHoldSec - 2.4 * frameDt)
    const grow = clamp(this.diveHoldSec / 7, 0, 1)
    const surgeBend = grow * (0.72 + 0.28 * grow)
    let divePathRad = 0

    if (this.collapseFrac > 0.05) {
      // True Freefall Plunge (Wing Collapse / Bailout):
      targetAirspeedKmh = 14.0
      targetSinkMps = -38.0 * Math.pow(this.collapseFrac, 0.75)
      targetPitchDeg = 65.0 * this.collapseFrac
    } else if (speedBar > 0.01) {
      // Looking down pitches the wing onto a steeper glide. The steep half
      // builds while that angle is held, wings level. A bank only adds a little.
      const pathDeg =
        diveCurve * (isSpeedwing ? 28.0 : 20.0) +
        this.diveBuild * (isSpeedwing ? 12.0 : 10.0) +
        surgeBend * (isSpeedwing ? 32.0 : 28.0) +
        spiralFrac * (isSpeedwing ? 4.0 : 3.0)
      divePathRad = pathDeg * DEG
      const surgeKmh = surgeBend * (isSpeedwing ? 110.0 : 100.0)
      const pathMps = (baseTrimSpeed + diveCurve * (maxDiveSpeed - baseTrimSpeed) + surgeKmh) / 3.6
      targetAirspeedKmh = pathMps * 3.6
      const slopeSink = Math.min(0, slopeGrade * pathMps * Math.cos(divePathRad))
      targetSinkMps = -pathMps * Math.sin(divePathRad) + slopeSink
      targetPitchDeg = Math.min(maxDivePitch, 8.0 + pathDeg * 1.35)
    } else if (dualBrake > 0.02) {
      // Looking Up (> 90° -> 118°):
      // Disengages the 18m contour lock so tilting the phone upward floats & climbs you high above the slope!
      const flareFrac = clamp(dualBrake / 0.62, 0, 1)
      targetAirspeedKmh = baseTrimSpeed - flareFrac * (baseTrimSpeed - minFlareSpeed) * 0.18
      const climbAboveSlope = flareFrac * (isSpeedwing ? 26.0 : 38.0)
      targetSinkMps = floatSink * (1.0 - flareFrac) + climbAboveSlope
      targetPitchDeg = 1.0 - flareFrac * 40.0
    }

    // 1b. Powered wing. Throttle 0 is a normal glide. Opening it adds speed,
    // and looking up climbs in proportion to that throttle.
    const targetThrottle = clamp(this.controls.throttle ?? 0, 0, 1)
    let throttleFrac = 0
    if (isParamotor) {
      const targetRpm = 2200 + targetThrottle * 6200
      const spoolRate = targetThrottle > (this.engineRpm - 2200) / 6200 ? 14.0 : 8.5
      this.engineRpm += (targetRpm - this.engineRpm) * Math.min(1.0, spoolRate * frameDt)

      throttleFrac = clamp((this.engineRpm - 2200) / 6200, 0, 1)
      const maxThrust = this.wing.maxThrustNewtons || 740.0
      this.thrustNewtons = 35.0 + (maxThrust - 35.0) * Math.pow(throttleFrac, 1.8)

      targetAirspeedKmh += throttleFrac * 60.0
      if (dualBrake > 0.04 && throttleFrac > 0.05 && this.collapseFrac <= 0.05) {
        const flareFrac = clamp(dualBrake / 0.62, 0, 1)
        targetSinkMps = Math.max(targetSinkMps, throttleFrac * (16.0 + flareFrac * 30.0))
      }
      const thrustPitchNudge = -Math.atan2(this.thrustNewtons, totalMassKg * 9.81) * (180 / Math.PI) * 0.22
      targetPitchDeg += thrustPitchNudge
    } else {
      this.engineRpm = 0
      this.thrustNewtons = 0
    }

    // Sample atmospheric wind/thermals for HUD & FLIR telemetry (without floating you off the low proximity line!)
    this.getAtmosphericWindAt(this.cPos, sampleTerrainHeight)
    const rawUpdraft = (this.atmosphere.ridgeLiftMps || 0) + (this.atmosphere.thermalUpdraftMps || 0)
    // Horizontal gradient of a strong column, sampled so the wing is drawn into the core.
    let elevGx = 0
    let elevGz = 0
    if (rawUpdraft >= 12) {
      // City elevator. The column lifts even if you are still pointed downhill.
      targetSinkMps += rawUpdraft
      if (this.world) {
        const tSec = this.telemetry.flightDurationSeconds || 0
        const eps = 14
        const sx = this.cPos.x
        const sy = this.cPos.y
        const sz = this.cPos.z
        const probe = (x: number, z: number) => this.world!.sampleUpdraft(x, sy, z, tSec, { x: 0, y: 0, z: 0 })
        elevGx = (probe(sx + eps, sz) - probe(sx - eps, sz)) / (2 * eps)
        elevGz = (probe(sx, sz + eps) - probe(sx, sz - eps)) / (2 * eps)
      }
    } else if (rawUpdraft > 0.2 && dualBrake > 0.15) {
      // Ordinary thermals still want you to look up into them.
      targetSinkMps += rawUpdraft * 0.45
    }

    // Forward Dive & Gravity Acceleration Dynamics:
    const isCollapsing = this.collapseFrac > 0.05
    const pitchRad = Math.max(0, this.pitchDeg) * DEG

    // 1. Canopy Pitch Rotation follows aerodynamic control lines smoothly:
    const pitchLerp = isCollapsing ? 14.0 : (speedBar > 0.02 ? 12.0 : 9.0)
    this.pitchDeg += (targetPitchDeg - this.pitchDeg) * Math.min(1.0, pitchLerp * frameDt)

    // 2. Wing Aerodynamic Lift Unload Factor:
    const unloadFactor = isCollapsing
      ? 0.04
      : (speedBar > 0.01
        ? clamp(1.0 - diveCurve * 0.35 * (0.4 + 0.6 * Math.sin(pitchRad)), 0.55, 1.0)
        : (dualBrake > 0.70 ? 1.30 : 1.0))
    this.currentUnloadFactor = unloadFactor

    // 3. Vertical Acceleration & Responsive Contour Tracking:
    const massPunchFactor = Math.min(1.35, Math.max(0.75, totalMassKg / 95.0))
    if (!isCollapsing && speedBar < 0.72 && this.zoomClimbMps > 0.5) {
      const zoomCap = isSpeedwing ? 28.0 : 24.0
      targetSinkMps = Math.max(targetSinkMps, Math.min(zoomCap, this.zoomClimbMps) * (1.0 - speedBar * 0.85))
    }
    // A long dive falls faster than a level-off can erase. Fold that surplus
    // into the climb before the cruise follow cancels it.
    if (!isCollapsing && speedBar < 0.18 && this.diveHoldSec > 0.4 && this.currentSinkMps < -12) {
      const surplus = -12 - this.currentSinkMps
      const zoomCap = isSpeedwing ? 30.0 : 26.0
      const take = surplus * Math.min(1, 6.0 * frameDt)
      this.zoomClimbMps = Math.min(zoomCap, this.zoomClimbMps + take)
      this.currentSinkMps += take
    }
    const recoveringDive = speedBar < 0.18 && (this.zoomClimbMps > 1 || this.diveHoldSec > 0.4)
    const sinkFollowRate = isCollapsing ? 12.0 : (dualBrake > 0.04 ? 18.0 : speedBar > 0.01 ? 6.5 : recoveringDive ? 1.6 : 8.5)
    this.currentSinkMps += (targetSinkMps - this.currentSinkMps) * Math.min(1.0, sinkFollowRate * frameDt)

    // 4. Horizontal Speed & Potential Energy Conversion (Zero speed bleed in turns or dives!):
    const baseTrimSpeedMps = baseTrimSpeed / 3.6
    if (this.ringBoostTimer > 0) this.ringBoostTimer = Math.max(0, this.ringBoostTimer - frameDt)
    const lineBoostMps = Math.min(10, this.coinCount) * (2.4 / 3.6) + (this.ringBoostTimer > 0 ? 4.2 : 0)
    const curHSpeedMps = Math.hypot(this.cVel.x, this.cVel.z)
    let newHSpeedMps = curHSpeedMps

    if (speedBar > 0.01 && !isCollapsing) {
      const current3DAirspeed = Math.hypot(curHSpeedMps, this.currentSinkMps)
      this.diveKineticSpeedMps = Math.max(this.diveKineticSpeedMps, current3DAirspeed)

      const pathMps = (baseTrimSpeed + diveCurve * (maxDiveSpeed - baseTrimSpeed)) / 3.6
      const diveHSpeedTarget = pathMps * Math.cos(divePathRad) + throttleFrac * 8.0 + lineBoostMps

      const fwdAccRate = (isSpeedwing ? 16.0 : 12.5) * massPunchFactor
      newHSpeedMps += (diveHSpeedTarget - curHSpeedMps) * Math.min(1.0, fwdAccRate * frameDt)
    } else if (this.diveKineticSpeedMps > baseTrimSpeedMps + 1.0 || this.zoomClimbMps > 0.4) {
      const swoopEfficiency = isSpeedwing ? 0.92 : 0.88
      const pulloutFrac = Math.max(0, 1.0 - Math.min(1.0, pitchRad / 0.45))
      const swoopTargetMps = this.diveKineticSpeedMps * swoopEfficiency * (0.55 + 0.25 * pulloutFrac)

      if (newHSpeedMps < swoopTargetMps) {
        newHSpeedMps += (swoopTargetMps - newHSpeedMps) * Math.min(1.0, 8.0 * frameDt)
      }

      // Speed gathered in the fall is spent as climb once you level off.
      if (this.currentSinkMps < -6.0) {
        const take = (-6.0 - this.currentSinkMps) * Math.min(1.0, 1.8 * frameDt)
        this.currentSinkMps += take
        const zoomCap = isSpeedwing ? 30.0 : 26.0
        this.zoomClimbMps = Math.min(zoomCap, this.zoomClimbMps + take * 0.72)
        this.diveKineticSpeedMps = Math.max(baseTrimSpeedMps, this.diveKineticSpeedMps - take)
      }

      const flareBrakeDamp = dualBrake > 0.60 ? (dualBrake - 0.60) * 0.9 : 0
      const swoopBleedRate = (isSpeedwing ? 0.18 : 0.25) + flareBrakeDamp
      this.diveKineticSpeedMps += (baseTrimSpeedMps - this.diveKineticSpeedMps) * Math.min(1.0, swoopBleedRate * frameDt)
      newHSpeedMps += (baseTrimSpeedMps + lineBoostMps - newHSpeedMps) * Math.min(1.0, swoopBleedRate * 0.35 * frameDt)
    } else if (dualBrake > 0.02) {
      this.diveKineticSpeedMps = 0
      const brakeTargetMps = targetAirspeedKmh / 3.6 + lineBoostMps
      const brakeDecelRate = isSpeedwing ? 14.0 : 9.0
      newHSpeedMps += (brakeTargetMps - curHSpeedMps) * Math.min(1.0, brakeDecelRate * frameDt)
    } else {
      this.diveKineticSpeedMps = 0
      const cruiseMps = baseTrimSpeedMps + throttleFrac * (60.0 / 3.6) + lineBoostMps
      const cruiseRate = throttleFrac > 0.2 ? 9.0 : 6.5
      newHSpeedMps += (cruiseMps - curHSpeedMps) * Math.min(1.0, cruiseRate * frameDt)
    }

    // Rolling out of a steep bank hands the speed in that turn back as climb.
    // Still looking straight down keeps the fall; the zoom arrives as the gaze comes up.
    if (!isCollapsing && bankDrop > 0.02 && bankFrom > 18.0 && speedBar < 0.72) {
      const speed3d = Math.hypot(newHSpeedMps, Math.max(0, -this.currentSinkMps))
      const excess = Math.max(0, Math.max(speed3d, this.diveKineticSpeedMps) - baseTrimSpeedMps)
      const exitFrac = clamp(bankDrop / Math.max(12.0, bankFrom), 0, 1)
      const hold = clamp((bankFrom - 18.0) / 52.0, 0, 1)
      const converted = excess * exitFrac * hold * 0.85
      const zoomCap = isSpeedwing ? 22.0 : 18.0
      this.zoomClimbMps = Math.min(zoomCap, this.zoomClimbMps + converted)
      newHSpeedMps = Math.max(baseTrimSpeedMps * 0.72, newHSpeedMps - converted * 0.35)
      this.diveKineticSpeedMps = Math.max(baseTrimSpeedMps, this.diveKineticSpeedMps - converted)
    }

    if (!isCollapsing && speedBar < 0.72 && this.zoomClimbMps > 0.35) {
      const zoomCap = isSpeedwing ? 28.0 : 24.0
      const climbTarget = Math.min(zoomCap, this.zoomClimbMps)
      if (climbTarget > this.currentSinkMps) {
        this.currentSinkMps += (climbTarget - this.currentSinkMps) * Math.min(1.0, 5.5 * frameDt)
      }
      const spent = Math.max(0, this.currentSinkMps) * frameDt * 0.45 + this.zoomClimbMps * frameDt * 0.28
      this.zoomClimbMps = Math.max(0, this.zoomClimbMps - spent)
      newHSpeedMps = Math.max(baseTrimSpeedMps * 0.7, newHSpeedMps - spent * 0.2)
    } else if (this.zoomClimbMps > 0.35 && speedBar >= 0.45) {
      this.zoomClimbMps = Math.max(0, this.zoomClimbMps - this.zoomClimbMps * Math.min(1.0, 0.15 * frameDt))
    }

    // Total Airspeed derived from true 3D relative airflow:
    this.airspeedKmh = Math.sqrt(newHSpeedMps * newHSpeedMps + this.currentSinkMps * this.currentSinkMps) * 3.6

    // Aerobatics execution:
    let renderPitchDeg = this.pitchDeg
    let renderBankDeg = this.bankDeg

    if (this.isLooping) {
      this.loopProgress += frameDt / 0.95 // ~0.95s snappy dynamic backflip / frontflip
      const p = Math.min(1.0, this.loopProgress)
      renderPitchDeg = this.pitchDeg - p * 360.0 * this.loopDirection
      this.currentSinkMps = slopeFollowSinkMps - Math.sin(p * Math.PI * 2) * 8.0 * this.loopDirection
      if (this.loopProgress >= 1.0) {
        this.isLooping = false
        this.loopProgress = 0
        this.tumbleStreak++
      }
    } else if (this.isRolling) {
      this.rollProgress += frameDt / 0.88 // ~0.88s snappy barrel roll
      const p = Math.min(1.0, this.rollProgress)
      renderBankDeg = this.bankDeg + p * 360.0 * this.rollDirection
      if (this.rollProgress >= 1.0) {
        this.isRolling = false
        this.rollProgress = 0
        this.tumbleStreak++
      }
    }

    // A strong column eases the wing while you ride it. Look down or steer
    // and that hold lets go, so a dive or a turn carries you out of the column.
    const leavingColumn = speedBar > 0.12 || Math.abs(rawWeightShift) > 0.4
    if (rawUpdraft >= 12 && !isCollapsing && !leavingColumn) {
      const holdMps = 2.4
      newHSpeedMps = curHSpeedMps + (holdMps - curHSpeedMps) * Math.min(1.0, 5.0 * frameDt)
    }

    // 3. Trajectory & World Position Integration (Zero Crosswind Drift & Zero Turn Speed Penalty!)
    const headingRad = this.headingDeg * DEG
    const forwardGlideEff = Math.max(0.0, 1.0 - this.collapseFrac * 1.25)
    const hSpeedMps = Math.max(0, newHSpeedMps * forwardGlideEff)

    let centerX = 0
    let centerZ = 0
    if (rawUpdraft >= 12 && !isCollapsing && !leavingColumn) {
      const gMag = Math.hypot(elevGx, elevGz)
      if (gMag > 0.04) {
        const pull = Math.min(2.0, gMag * 2.2)
        centerX = (elevGx / gMag) * pull
        centerZ = (elevGz / gMag) * pull
      }
    }

    const targetFwdX = Math.sin(headingRad) * hSpeedMps + centerX
    const targetFwdZ = Math.cos(headingRad) * hSpeedMps + centerZ

    const carveFollowRate = isSpeedwing ? 22.0 : 18.0
    const newVX = this.cVel.x + (targetFwdX - this.cVel.x) * Math.min(1.0, carveFollowRate * frameDt)
    const newVZ = this.cVel.z + (targetFwdZ - this.cVel.z) * Math.min(1.0, carveFollowRate * frameDt)

    this.cVel = v3(newVX, this.currentSinkMps, newVZ)
    this.cPos = vAddScaled(this.cPos, this.cVel, frameDt)

    // Lateral slip is an explicit correction only (two-finger drag, comma/period).
    // A tilt turn does not use it.
    const strafe = clamp(this.controls.strafe || 0, -1, 1)
    if (Math.abs(strafe) > 0.02) {
      const slipMps = strafe * 7.4
      this.cPos.x += Math.cos(headingRad) * slipMps * frameDt
      this.cPos.z += -Math.sin(headingRad) * slipMps * frameDt
    }

    // The pilot is the weight on the lines. Attitude swings the wing around him,
    // and the line from him to the wing center is the wing's own up-axis.
    this.cQ = qFromYawPitchRoll(this.headingDeg, renderPitchDeg, renderBankDeg)
    const wingUp = qRotate(this.cQ, v3(0, 1, 0))
    const anchorX = this.cPos.x - this.prevWingUp.x * tetherL
    const anchorY = this.cPos.y - this.prevWingUp.y * tetherL
    const anchorZ = this.cPos.z - this.prevWingUp.z * tetherL
    this.pPos = v3(anchorX, anchorY, anchorZ)
    this.pVel = vCopy(this.cVel)
    this.cPos = v3(anchorX + wingUp.x * tetherL, anchorY + wingUp.y * tetherL, anchorZ + wingUp.z * tetherL)
    this.prevWingUp = wingUp

    // 5. 3D Obstacle Collision Detection (Buildings, Skyscrapers, Monuments, Trees, Chalets, Bridges)
    const obstacles = this.world?.obstacles
    if (obstacles && obstacles.length > 0 && this.telemetry.flightDurationSeconds > 0.6) {
      for (let i = 0; i < obstacles.length; i++) {
        const obs = obstacles[i]
        const maxZSpan = Math.max(32.0, (obs.halfDepth ?? obs.radius) + 12.0)
        if (Math.abs(this.pPos.z - obs.z) > maxZSpan) continue
        const maxXSpan = Math.max(32.0, (obs.halfWidth ?? obs.radius) + 12.0)
        if (Math.abs(this.pPos.x - obs.x) > maxXSpan) continue

        const hitPilot = pointHitsObstacle(this.pPos.x, this.pPos.y, this.pPos.z, obs)
        const hitCanopy = obs.type !== 'boulder' && pointHitsObstacle(this.cPos.x, this.cPos.y, this.cPos.z, obs)

        if (hitPilot || hitCanopy) {
          const epitaphs: Record<string, string[]> = {
            tree: [
              'IMPALED ON ALPINE SPRUCE',
              'SHREDDED THROUGH EVERGREEN TIMBER',
              'HUMAN ORNAMENT ON PINE TREE',
            ],
            chalet: [
              `SMASHED INTO ${obs.name.toUpperCase()}`,
              'PANCAKED ON CITY ROOFTOP',
              'UNINVITED GUEST THROUGH BUILDING WINDOW',
            ],
            boulder: [
              'PULVERIZED ON GRANITE CLIFF BOULDER',
              'SPLATTERED AGAINST CANADIAN SHIELD ROCK',
            ],
            tower: [
              `SLAMMED INTO ${obs.name.toUpperCase()}`,
              'OBLITERATED ON SKYSCRAPER CURTAIN WALL',
              'HIGH-SPEED TOWER FACADE IMPACT',
            ],
            lodge: [
              'PANCAKED INTO WHISTLER GRAND SKI LODGE',
              'APRES-SKI COCKTAIL CRASH LANDING',
            ],
            'bridge-pier': [
              'DEMOLISHED AGAINST STONE BRIDGE PIER',
              'WRAPPED AROUND BRIDGE ABUTMENT',
            ],
            'bridge-deck': [
              'CLOTHESLINED BY OLYMPIC TIMBER BRIDGE',
              'DECAPITATED AT THE SKI BRIDGE ARCH',
            ],
          }
          const list = epitaphs[obs.type] || ['OBLITERATED ON 3D BUILDING']
          const reason = list[Math.floor(Math.abs(this.pPos.x + this.pPos.z) * 7) % list.length]
          this.triggerCrash(reason, this.airspeedKmh)
          return
        }
      }
    }

    // 6. Terrain & Ground Clearance / High-Speed Ground Impact Detection
    const terrainH = sampleTerrainHeight ? sampleTerrainHeight(this.pPos.x, this.pPos.z) : 0
    this.groundClearanceMeters = Math.max(0, this.pPos.y - terrainH)

    if (this.groundClearanceMeters <= 0.20) {
      const impactSinkRelSlope = this.currentSinkMps - slopeGrade * curHSpeedMps
      if (
        this.isCollapsed ||
        impactSinkRelSlope < -4.2 ||
        (speedBar > 0.25 && this.airspeedKmh > 62.0) ||
        Math.abs(this.bankDeg) > 35.0
      ) {
        const groundReasons = this.isCollapsed
          ? ['FREEFALL TERMINAL VELOCITY SPLAT', 'ZERO-CANOPY CRATER IMPACT']
          : Math.abs(this.bankDeg) > 35.0
          ? ['HIGH-G WINGTIP CARTWHEEL WRECK', 'CENTRIFUGAL SPIRAL SLAM']
          : ['MEAT CRAYON DOWN BLACK DIAMOND', 'HIGH-SPEED ALPINE FACEPLANT']
        const reason = groundReasons[Math.floor(Math.abs(this.pPos.z)) % groundReasons.length]
        this.triggerCrash(reason, this.airspeedKmh)
        return
      } else {
        // Smooth snow skim / foot drag. Keep the wing on the same lines.
        this.pPos.y = terrainH + 0.12
        this.cPos = v3(
          this.pPos.x + this.prevWingUp.x * tetherL,
          this.pPos.y + this.prevWingUp.y * tetherL,
          this.pPos.z + this.prevWingUp.z * tetherL,
        )
        this.currentSinkMps = Math.max(this.currentSinkMps, slopeFollowSinkMps)
      }
    }

    this.isFootDragging = this.groundClearanceMeters > 0.02 && this.groundClearanceMeters < 1.9 && this.airspeedKmh > 18.0

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
    const cosBank = Math.max(0.18, Math.cos(bankRad))
    const turnCentrifugalG = (1.0 / cosBank - 1.0) + this.whipFrac * 1.4 + spiralFrac * 1.8

    const isSpeedwing = this.currentWingType === 'speedwing'
    const isParamotor = this.currentWingType === 'paramotor' || this.isMotorActive
    const baseTrimSpeed = isSpeedwing ? 74.0 : (isParamotor ? 52.0 : 38.5)
    const speedRatio = Math.max(1.0, this.airspeedKmh / baseTrimSpeed)
    const speedBarVal = this.controls.speedBar || 0
    const swoopPulloutG = (speedBarVal < 0.25 && this.currentSinkMps < -4.0)
      ? Math.min(2.5, Math.max(0, -this.currentSinkMps / 6.0) * (speedRatio - 1.0) * 1.4)
      : 0

    let baseG = this.currentUnloadFactor / cosBank + turnCentrifugalG + swoopPulloutG
    if (this.isLooping) {
      baseG = 1.0 + Math.sin(this.loopProgress * Math.PI) * 2.8
    }
    this.pilot.gForce = clamp(baseG + (this.currentSinkMps > 0 ? 0.25 : 0), 0.28, 4.4)

    // Dynamic line tension follows pilot physical weight & G-load:
    const canopyMassKg = this.wing.canopyMassKg || (isSpeedwing ? 3.2 : (isParamotor ? 4.8 : 4.6))
    const totalMassKg = this.pilotMassKg + canopyMassKg
    const projectedArea = this.wing.projectedAreaSquareMeters || (isSpeedwing ? 9.2 : (isParamotor ? 15.0 : 20.4))
    const wingLoading = totalMassKg / projectedArea

    this.lineTensionNewtons = clamp(totalMassKg * 9.81 * this.pilot.gForce, 180, 5000)
    this.leftLineTensionNewtons = this.lineTensionNewtons * 0.5
    this.rightLineTensionNewtons = this.lineTensionNewtons * 0.5

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
    this.telemetry.lineTensionNewtons = Math.round(this.lineTensionNewtons)
    this.telemetry.leftLineTensionNewtons = Math.round(this.leftLineTensionNewtons)
    this.telemetry.rightLineTensionNewtons = Math.round(this.rightLineTensionNewtons)
    this.telemetry.engineRpm = Math.round(this.engineRpm)
    this.telemetry.throttlePercent = Math.round(clamp((this.engineRpm - 2200) / 6200, 0, 1) * 100)
    this.telemetry.thrustNewtons = Math.round(this.thrustNewtons)
    this.telemetry.pilotMassKg = Math.round(this.pilotMassKg)
    this.telemetry.wingLoadingKgPerM2 = +(wingLoading).toFixed(1)
    this.telemetry.crashReason = this.crashReason
    this.telemetry.crashImpactSpeedKmh = this.crashImpactSpeedKmh
    this.telemetry.crashImpactG = this.crashImpactG
    this.telemetry.crashBonesBroken = this.crashBonesBroken
    this.telemetry.crashHospitalBill = this.crashHospitalBill
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
      // Paraglider 10.2m span gives clear, distinct roll torque (up to 16°) communicating lift directly into the harness!
      const torqueMult = this.currentWingType === 'paraglider' ? 3.4 : 1.2
      const maxTorque = this.currentWingType === 'paraglider' ? 16.0 : 6.0
      thermalRollTorque = clamp((upLeft - upRight) * torqueMult, -maxTorque, maxTorque)
      // A city elevator should lift straight. The edge roll is for ordinary thermals.
      if (thermalUpdraft >= 12) thermalRollTorque = 0
    }
    this.atmosphere.thermalUpdraftMps = thermalUpdraft
    this.thermalRollTorqueDeg = thermalRollTorque

    return baseWind
  }
}
