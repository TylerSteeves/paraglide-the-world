/**
 * First-Principles Coupled Two-Body Paragliding & Speedwing Physics Engine.
 *
 * Models a real speedwing as two dynamically coupled physical bodies:
 * 1. Canopy: 6 Degrees of Freedom (position, velocity, quaternion orientation, angular velocity).
 *    Possesses its own small rotational inertia (I_xx ~ 60 kg*m^2) and apparent mass tensor (M_app),
 *    enabling crisp, authentic roll response (0.4-0.8s) and dynamic vortex aerodynamics.
 * 2. Pilot: Suspended pendulum mass (88 kg) connected via flexible inelastic line pyramid (5.3m).
 *    Governed by gravity, pilot parasite drag, and centrifugal line tension T.
 *
 * True emergence:
 * - The wing leads into turns; the pilot swings outward under centrifugal force (m v^2 / R).
 * - Yaw-first, roll-follows asymmetric brake polar with tip vortex shedding.
 * - Ground effect cushion (<3m) compressing tip vortices for authentic high-speed swoops.
 * - Dynamic energy conservation: potential energy (mgh) <-> kinetic energy (1/2 mv^2).
 * - Line slackening (T <= 0) and inelastic tension snap recovery.
 * - Frame-rate independent 1/240s sub-step integration.
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
  airDensityAt,
  evaluateWingAerodynamics,
  getPanelStations,
  PARAMOTOR_FREERIDE_18M,
  PARAGLIDER_XC_24M,
  SPEEDWING_13M,
  type WingGeometry,
} from './aerodynamics'
import {
  clamp,
  DEG,
  qCopy,
  qFromYawPitchRoll,
  qIntegrateBody,
  qNlerp,
  qRotate,
  qRotateInv,
  qToAttitude,
  RAD,
  v3,
  vAdd,
  vAddScaled,
  vCopy,
  vCross,
  vLen,
  vLerp,
  vNorm,
  vScale,
  vSub,
  type Quat,
  type V3,
} from './vecmath'

export type TerrainSampler = (x: number, z: number) => number

const G = 9.80665
export const SUBSTEP = 1 / 240
const MAX_FRAME_DT = 0.1

type Pose = {
  canopyPos: V3
  canopyVel: V3
  canopyQ: Quat
  pilotPos: V3
  pilotVel: V3
}

export class ParagliderSimulation {
  public canopy: CanopyState
  public pilot: PilotState
  public controls: FlightControls
  public atmosphere: AtmosphereState
  public telemetry: FlightTelemetry
  public wing: WingGeometry

  // Simulation flags
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
  private cOmega: V3 // Body-frame angular velocity (rad/s)

  private pPos: V3
  private pVel: V3

  // Pilot pendulum relative to canopy (radians and rad/s)
  private pendPitch: number = 0
  private pendPitchRate: number = 0
  private pendRoll: number = 0
  private pendRollRate: number = 0

  public currentWingType: 'speedwing' | 'paraglider' | 'paramotor' = 'paraglider'
  private launchPos: V3
  private engineRpm: number = 0
  private currentThrustNewtons: number = 0

  // Attitude & Aerodynamic State (Degrees)
  public headingDeg: number = 5.0
  public pitchDeg: number = 5.2
  public bankDeg: number = 0.0
  public airspeedKmh: number = 39.0

  // Acro State Machines
  public isLooping: boolean = false
  public loopProgress: number = 0
  public isRolling: boolean = false
  public rollProgress: number = 0
  public rollDirection: number = 1

  // Fixed-step clock & interpolation
  private accumulator = 0
  private posePrev: Pose | null = null
  private poseCurr: Pose | null = null
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
    const trimPitch = defaultWing === 'paraglider' ? 1.2 : (defaultWing === 'paramotor' ? 1.8 : 2.5)
    this.pitchDeg = trimPitch
    this.bankDeg = 0
    this.airspeedKmh = this.wing.trimSpeedKmh

    const headingRad = initialHeadingDeg * DEG
    const trimMps = this.wing.trimSpeedKmh / 3.6
    const trimSinkMps = -trimMps / this.wing.glideRatio
    const trimFwdMps = Math.sqrt(Math.max(1, trimMps * trimMps - trimSinkMps * trimSinkMps))

    // Compensate initial velocity for ambient base wind so launch relative airspeed is exactly trim speed
    const initWindRad = 190 * DEG
    const initWindMps = 12 / 3.6
    const initWind = v3(Math.sin(initWindRad) * initWindMps, 0, Math.cos(initWindRad) * initWindMps)

    this.cPos = v3(spawn.x, spawn.y, spawn.z)
    this.cVel = vAdd(v3(Math.sin(headingRad) * trimFwdMps, trimSinkMps, Math.cos(headingRad) * trimFwdMps), initWind)
    this.cQ = qFromYawPitchRoll(initialHeadingDeg, trimPitch, 0)
    this.cOmega = v3()

    const riserPos = vAdd(this.cPos, qRotate(this.cQ, v3(0, -0.35, 0)))
    this.pPos = vAdd(riserPos, v3(0, -this.wing.tetherLengthMeters, 0))
    this.pVel = v3(this.cVel.x, this.cVel.y, this.cVel.z)

    this.canopy = {
      position: { x: spawn.x, y: spawn.y, z: spawn.z },
      velocity: { x: this.cVel.x, y: this.cVel.y, z: this.cVel.z },
      quaternion: { x: this.cQ.x, y: this.cQ.y, z: this.cQ.z, w: this.cQ.w },
      rollDeg: 0,
      pitchDeg: trimPitch,
      yawDeg: initialHeadingDeg,
      airspeedKmh: this.wing.trimSpeedKmh,
      verticalSpeedMps: trimSinkMps,
      angleOfAttackDeg: 7.5,
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
      turbulence: 0.05,
      thermalUpdraftMps: 0,
      ridgeLiftMps: 0,
    }

    this.telemetry = {
      altitudeMeters: initialAltitude,
      terrainHeightMeters: 650,
      groundClearanceMeters: initialAltitude - 650,
      airspeedKmh: this.wing.trimSpeedKmh,
      groundSpeedKmh: this.wing.trimSpeedKmh,
      verticalSpeedMps: trimSinkMps,
      glideRatio: this.wing.glideRatio,
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
      pitchDeg: 4.5,
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
      pullingA: 0,
      pullingB: 0,
    }

    this.poseCurr = this.capturePose()
    this.posePrev = this.poseCurr
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

    // Adjust tether position smoothly
    const d = vSub(this.pPos, this.cPos)
    const len = vLen(d)
    if (len > 0.1) {
      const dir = vScale(d, 1 / len)
      this.pPos = vAdd(this.cPos, vScale(dir, this.wing.tetherLengthMeters))
      this.pilot.position = { x: this.pPos.x, y: this.pPos.y, z: this.pPos.z }
    }
  }

  public reset(
    initialAltitude: number = this.initialAltitude,
    initialHeadingDeg: number = this.initialHeadingDeg,
    startPos?: { x: number; y: number; z: number },
  ) {
    const headingRad = initialHeadingDeg * DEG
    const trimPitch = this.currentWingType === 'paraglider' ? 1.2 : 2.5
    const trimSpeedMps = this.wing.trimSpeedKmh / 3.6
    const trimSinkMps = -trimSpeedMps / this.wing.glideRatio
    const trimFwdMps = Math.sqrt(Math.max(1, trimSpeedMps * trimSpeedMps - trimSinkMps * trimSinkMps))
    const spawn = startPos ?? { x: 0, y: initialAltitude, z: 0 }

    const initWindRad = (this.atmosphere.windHeadingDeg ?? 190) * DEG
    const initWindMps = (this.atmosphere.windSpeedKmh ?? 12) / 3.6
    const initWind = v3(Math.sin(initWindRad) * initWindMps, 0, Math.cos(initWindRad) * initWindMps)

    this.launchPos = v3(spawn.x, spawn.y, spawn.z)
    this.cPos = v3(spawn.x, spawn.y, spawn.z)
    this.cVel = vAdd(v3(Math.sin(headingRad) * trimFwdMps, trimSinkMps, Math.cos(headingRad) * trimFwdMps), initWind)
    this.cQ = qFromYawPitchRoll(initialHeadingDeg, trimPitch, 0)
    this.cOmega = v3(0, 0, 0)

    this.headingDeg = initialHeadingDeg
    this.pitchDeg = trimPitch
    this.bankDeg = 0
    this.airspeedKmh = this.wing.trimSpeedKmh

    this.isLooping = false
    this.loopProgress = 0
    this.isRolling = false
    this.rollProgress = 0
    this.rollDirection = 1

    const riserPos = vAdd(this.cPos, qRotate(this.cQ, v3(0, -0.35, 0)))
    this.pPos = vAdd(riserPos, v3(0, -this.wing.tetherLengthMeters, 0))
    this.pVel = vCopy(this.cVel)

    this.pendPitch = 0
    this.pendPitchRate = 0
    this.pendRoll = 0
    this.pendRollRate = 0

    this.isCrashed = false
    this.isLanded = false
    this.isStalled = false
    this.isSpinning = false
    this.asymmetricStallSide = 'none'
    this.isLinesSlack = false
    this.tumbleStreak = 0
    this.cumulativePitchDeg = 0
    this.lastTumblePitchDeg = 0
    this.slackTimer = 0
    this.stallTime = 0
    this.surgeTimer = 0
    this.leftWingCollapse = 0
    this.rightWingCollapse = 0

    this.telemetry.altitudeMeters = spawn.y
    this.telemetry.maxAltitudeMeters = spawn.y
    this.telemetry.xcDistanceMeters = 0
    this.telemetry.thermalClimbMps = 0
    this.telemetry.score = 0
    this.telemetry.ringsCollected = 0
    this.telemetry.tumbleStreak = 0
    this.telemetry.flightDurationSeconds = 0
    this.telemetry.staticChargeField = 0
    this.telemetry.thermalFluidVx = 0
    this.telemetry.thermalFluidVy = 0
    this.telemetry.thermalFluidVz = 0
    this.telemetry.thermalTempAnomalyC = 0
    this.telemetry.isDraftingZone = false

    this.accumulator = 0
    this.poseCurr = this.capturePose()
    this.posePrev = this.poseCurr
    this.syncState(1.0)
  }

  public step(dt: number, sampleTerrainHeight: TerrainSampler): void {
    if (this.isCrashed) return
    const frameDt = clamp(dt, 0, MAX_FRAME_DT)
    if (frameDt <= 0) return

    this.accumulator += frameDt
    while (this.accumulator >= SUBSTEP) {
      this.accumulator -= SUBSTEP
      this.subStep(SUBSTEP, sampleTerrainHeight)
    }

    const alpha = this.accumulator / SUBSTEP
    this.syncState(alpha)
  }

  private capturePose(): Pose {
    return {
      canopyPos: vCopy(this.cPos),
      canopyVel: vCopy(this.cVel),
      canopyQ: qCopy(this.cQ),
      pilotPos: vCopy(this.pPos),
      pilotVel: vCopy(this.pVel),
    }
  }

  public getWingTipPositions(): { left: V3; right: V3; center: V3 } {
    const halfSpan = this.wing.spanMeters * 0.5
    const uRight = qRotate(this.cQ, v3(1, 0, 0))
    return {
      left: vAddScaled(this.cPos, uRight, -halfSpan),
      right: vAddScaled(this.cPos, uRight, halfSpan),
      center: vCopy(this.cPos),
    }
  }

  /**
   * First-Principles Coupled 2-Body Integration:
   * 1. 6-DOF Canopy governed by multi-station sectional aerodynamics (lift, drag, pitch moment).
   * 2. Suspended Pilot Pendulum connected via dynamic inelastic suspension line tether.
   * 3. Authentic trailing-edge brake drag -> yaw torque -> induced roll -> centrifugal outward pilot swing.
   * 4. Energy exchange: dive acceleration, high-lift flare swoop, and surge upon brake release.
   */
  private subStep(h: number, sample: TerrainSampler): void {
    this.posePrev = this.capturePose()
    this.telemetry.flightDurationSeconds += h

    const w = this.wing
    const tetherL = w.tetherLengthMeters
    const pilotMass = w.pilotMassKg
    const canopyMass = w.canopyMassKg + w.enclosedAirKg
    const rho = airDensityAt(this.cPos.y)

    // 1. Terrain Clearance & Pilot Foot Drag
    const pilotTerrainH = sample(this.pPos.x, this.pPos.z)
    const pilotClearance = this.pPos.y - pilotTerrainH
    this.groundClearanceMeters = Math.max(0, pilotClearance)
    this.telemetry.groundClearanceMeters = this.groundClearanceMeters
    this.telemetry.terrainHeightMeters = pilotTerrainH
    this.isFootDragging = pilotClearance < 1.3 && pilotClearance >= 0 && !this.isCrashed
    this.pilot.isFootDragging = this.isFootDragging

    // Crash / Landing condition
    if (this.pPos.y <= pilotTerrainH + 0.3) {
      this.pPos.y = pilotTerrainH + 0.3
      if (this.pVel.y < -6.8) {
        this.isCrashed = true
        return
      }
      this.pVel.y = Math.max(0, this.pVel.y)
      // Ground friction on touchdown
      this.pVel.x *= 0.94
      this.pVel.z *= 0.94
    }

    // 2. Control Processing (Supports 180° Reverse Stance Kiting)
    const targetReverseYaw = this.controls.reverseStance ? 180.0 : 0.0
    this.pilot.reverseStanceYawDeg +=
      (targetReverseYaw - this.pilot.reverseStanceYawDeg) * 8.0 * h

    const effLeftBrake = this.controls.reverseStance ? this.controls.rightBrake : this.controls.leftBrake
    const effRightBrake = this.controls.reverseStance ? this.controls.leftBrake : this.controls.rightBrake
    const effWeightShift = this.controls.reverseStance ? -this.controls.weightShift : this.controls.weightShift

    const activeControls: FlightControls = {
      ...this.controls,
      leftBrake: effLeftBrake,
      rightBrake: effRightBrake,
      weightShift: effWeightShift,
    }

    // 3. Multi-Station Atmosphere & Relative Wind Sampling
    const stations = getPanelStations(w)
    const stationAirVelocitiesBody: V3[] = []
    let sumUpdraft = 0

    const omegaWorld = qRotate(this.cQ, this.cOmega)

    for (let i = 0; i < stations.length; i++) {
      const cfg = stations[i]
      const rStationBody = v3(cfg.arm, cfg.height, 0)
      const rStationWorld = qRotate(this.cQ, rStationBody)
      const posStationWorld = vAdd(this.cPos, rStationWorld)

      // Sample local wind at this station's world position
      const windAtStation = this.sampleAtmosphere(posStationWorld, sample)
      sumUpdraft += windAtStation.y

      // Station velocity through air: v_station = (v_canopy + omega x r) - v_wind
      const vStationWorld = vAdd(this.cVel, vCross(omegaWorld, rStationWorld))
      const vStationAirWorld = vSub(vStationWorld, windAtStation)
      const vStationAirBody = qRotateInv(this.cQ, vStationAirWorld)
      stationAirVelocitiesBody.push(vStationAirBody)
    }

    this.atmosphere.thermalUpdraftMps = sumUpdraft / stations.length

    // Asymmetric Updraft Roll Torque:
    // When left wingtip enters thermal before right wingtip, left wing is lifted,
    // producing an authentic roll torque that nudges the glider away from the thermal!
    const leftStationUp = (stationAirVelocitiesBody[0] ? -stationAirVelocitiesBody[0].y : 0) + (stationAirVelocitiesBody[1] ? -stationAirVelocitiesBody[1].y : 0)
    const rightStationUp = (stationAirVelocitiesBody[3] ? -stationAirVelocitiesBody[3].y : 0) + (stationAirVelocitiesBody[2] ? -stationAirVelocitiesBody[2].y : 0)
    const diffUpdraft = (leftStationUp - rightStationUp) * 0.5
    const tauRollUpdraft = clamp(diffUpdraft * 42.0, -160.0, 160.0)

    // Center canopy relative air velocity
    const centerWind = this.sampleAtmosphere(this.cPos, sample)
    const vCanopyAirWorld = vSub(this.cVel, centerWind)
    const vCanopyAirBody = qRotateInv(this.cQ, vCanopyAirWorld)

    // 4. Multi-Panel Sectional Aerodynamics
    const aero = evaluateWingAerodynamics(
      vCanopyAirBody,
      this.cOmega,
      activeControls,
      this.groundClearanceMeters,
      rho,
      w,
      stationAirVelocitiesBody,
    )

    this.isStalled = aero.isFullStall
    this.leftStalled = aero.leftStalled
    this.rightStalled = aero.rightStalled
    this.asymmetricStallSide = aero.asymmetricStallSide
    this.leftBrakeForceN = aero.leftBrakeForceN
    this.rightBrakeForceN = aero.rightBrakeForceN
    this.stallWarning = aero.stallWarning
    this.isBStall = (activeControls.pullingB ?? 0) > 0.35

    // 5. Total Forces on the Paraglider System (Canopy + Pilot)
    const mTot = canopyMass + pilotMass
    const fAeroWorld = qRotate(this.cQ, aero.totalForceBody)
    const fGravWorld = v3(0, -mTot * G, 0)

    const vPilotSpeed = vLen(vCanopyAirWorld)
    const draftingBonus = this.telemetry.isDraftingZone ? 0.82 : 1.0
    const fPilotDragWorld = vScale(
      vNorm(vCanopyAirWorld),
      -0.5 * rho * vPilotSpeed * vPilotSpeed * w.pilotDragAreaM2 * draftingBonus,
    )

    // Motor / Paramotor Engine Dynamics (Ozone Freeride 2 2-Stroke Power Unit)
    let thrustMag = 0
    let fThrustWorld = v3(0, 0, 0)
    let tauPitchThrust = 0

    if (w.hasMotor) {
      const throttleInput = clamp(activeControls.throttle ?? 0, 0, 1)
      const targetRpm = 1800 + throttleInput * 6600 // 1800 RPM idle to 8400 RPM redline
      const spoolRate = targetRpm > this.engineRpm ? 4.5 : 3.2 // Crisp 2-stroke throttle spool
      this.engineRpm += (targetRpm - this.engineRpm) * spoolRate * h

      const normRpm = clamp((this.engineRpm - 1800) / 6600, 0, 1)
      const staticThrust = (w.maxThrustNewtons ?? 740.0) * Math.pow(normRpm, 1.75) // Dynamic prop thrust curve
      const speedMps = Math.max(0.1, vLen(vCanopyAirWorld))
      const propAdvanceFactor = clamp(1.0 - 0.42 * (speedMps / 24.0), 0.35, 1.0)
      thrustMag = staticThrust * propAdvanceFactor
      this.currentThrustNewtons = thrustMag

      // Thrust vector: pushes forward (+Z) and slightly upward (+Y by 2.5°) in canopy body coordinates
      const thrustAngleRad = 2.5 * DEG
      const thrustDirBody = vNorm(v3(0, Math.sin(thrustAngleRad), Math.cos(thrustAngleRad)))
      fThrustWorld = qRotate(this.cQ, vScale(thrustDirBody, thrustMag))

      // Thrust acts directly through pilot harness carabiners without artificial canopy pitching moment
      tauPitchThrust = 0
    } else {
      this.engineRpm = 0
      this.currentThrustNewtons = 0
    }
    // Buoyant Updraft Entrainment Heave:
    // Ascending thermal/ridge air column imparts upward momentum to the inflated ram-air canopy
    const updraftMps = this.atmosphere.thermalUpdraftMps ?? 0
    let fUpdraftHeaveWorld = v3(0, 0, 0)
    if (updraftMps > 0.1) {
      const entrainmentForceN = (canopyMass * 3.6) * Math.min(6.5, updraftMps)
      fUpdraftHeaveWorld = v3(0, entrainmentForceN, 0)
    }

    const fNetWorld = vAdd(vAdd(vAdd(vAdd(fAeroWorld, fGravWorld), fPilotDragWorld), fThrustWorld), fUpdraftHeaveWorld)
    const aLinWorld = vScale(fNetWorld, 1 / mTot)

    // Linear Integration of System Center of Mass
    this.cVel = vAddScaled(this.cVel, aLinWorld, h)

    // In B-Stall: forward speed decays rapidly, and sink settles at parachutal -8.5 to -10 m/s
    if (this.isBStall) {
      const bFrac = clamp(activeControls.pullingB, 0, 1)
      this.cVel.x *= (1.0 - 1.2 * h)
      this.cVel.z *= (1.0 - 1.2 * h)
      const targetSink = -(8.2 + 2.2 * bFrac)
      this.cVel.y += (targetSink - this.cVel.y) * 4.5 * h
    }

    this.cPos = vAddScaled(this.cPos, this.cVel, h)

    // 6. Apparent Gravity & Line Tension
    // Apparent down felt by the suspended pilot in the accelerating and turning reference frame:
    // When hasMotor, thrust is generated by engine mounted on pilot harness, pushing pilot forward directly.
    const aLinPilot = w.hasMotor ? vSub(aLinWorld, vScale(fThrustWorld, 1 / mTot)) : aLinWorld
    const aTurnCentripetalWorld = vCross(omegaWorld, this.cVel)
    const gAppWorld = vSub(vSub(v3(0, -G, 0), aLinPilot), aTurnCentripetalWorld)
    const gAppBody = qRotateInv(this.cQ, gAppWorld)

    // Coordinated banked turn load factor: centripetal acceleration in a banked turn naturally increases line load
    const bankRad = Math.abs(this.bankDeg * DEG)
    const coordTurnG = 1.0 / Math.cos(clamp(bankRad, 0, 75 * DEG))
    const gEff = Math.max(0.5, Math.max(vLen(gAppBody), coordTurnG * G * 0.95))

    // Centrifugal line tension from pilot swing rates
    const vCentrifugal = tetherL * (this.pendPitchRate * this.pendPitchRate + this.pendRollRate * this.pendRollRate)
    const lineTensionMag = pilotMass * (gEff + vCentrifugal)
    this.lineTensionNewtons = lineTensionMag
    this.pilot.gForce = clamp(lineTensionMag / (pilotMass * G), 0.0, 7.5)
    this.telemetry.gForce = this.pilot.gForce
    this.telemetry.lineTensionNewtons = this.lineTensionNewtons

    this.isLinesSlack = lineTensionMag < 50 && this.groundClearanceMeters > 5.0
    this.telemetry.isLinesSlack = this.isLinesSlack

    // Differential line tension
    const liftSum = aero.leftLift + aero.rightLift
    const rightRatio = liftSum > 1 ? aero.rightLift / liftSum : 0.5
    this.leftLineTensionNewtons = lineTensionMag * (1 - rightRatio)
    this.rightLineTensionNewtons = lineTensionMag * rightRatio
    this.telemetry.leftLineTensionNewtons = this.leftLineTensionNewtons
    this.telemetry.rightLineTensionNewtons = this.rightLineTensionNewtons

    // 7. Pilot Pendulum Dynamics (Fore-Aft & Lateral Swing Pivoted at Wing)
    // Equilibrium angles where suspended pilot naturally aligns with apparent gravity and physical weight shift
    const pitchTrimOffset = ((activeControls.speedBar ?? 0) * -0.22) + (Math.min(activeControls.leftBrake, activeControls.rightBrake) * 0.28)
    const targetPitchEq = Math.atan2(gAppBody.z, -gAppBody.y) + pitchTrimOffset
    const targetRollEq = Math.atan2(gAppBody.x, -gAppBody.y) + effWeightShift * 0.48

    const omegaP = Math.sqrt(gEff / tetherL)
    const dampP = 2.4 * omegaP

    const alphaPendPitch = -omegaP * omegaP * (this.pendPitch - targetPitchEq) - dampP * this.pendPitchRate
    const alphaPendRoll = -omegaP * omegaP * (this.pendRoll - targetRollEq) - dampP * this.pendRollRate

    this.pendPitchRate += alphaPendPitch * h
    this.pendPitch += this.pendPitchRate * h
    this.pendRollRate += alphaPendRoll * h
    this.pendRoll += this.pendRollRate * h

    // Pilot World Position & Velocity (Pivoted at Wing Tether Riser)
    const riserLateralOffset = effWeightShift * w.weightShiftMeters
    const rRiserBody = v3(riserLateralOffset, -0.35, 0)
    const pOffsetBody = v3(
      tetherL * Math.sin(this.pendRoll),
      -tetherL * Math.cos(this.pendRoll) * Math.cos(this.pendPitch),
      tetherL * Math.sin(this.pendPitch),
    )
    const posRiserWorld = vAdd(this.cPos, qRotate(this.cQ, rRiserBody))
    this.pPos = vAdd(posRiserWorld, qRotate(this.cQ, pOffsetBody))
    this.pVel = vAdd(this.cVel, vCross(omegaWorld, qRotate(this.cQ, vAdd(rRiserBody, pOffsetBody))))

    // 8. Canopy Rotational Dynamics & Restorative Pendulum Torques
    const isXC = w.aspectRatio > 5.5
    const Ixx = isXC ? 65.0 : 45.0
    const Iyy = isXC ? 95.0 : 75.0
    const Izz = isXC ? 75.0 : 55.0

    // Pilot pendulum restorative stiffness and matched critical damping
    const K_pend = isXC ? 2400.0 : 2000.0
    const K_roll = isXC ? 540.0 : 460.0
    const C_pitch = 2.0 * 0.95 * Math.sqrt(K_pend * Ixx)
    const C_roll = 2.0 * 0.95 * Math.sqrt(K_roll * Izz)

    // Dynamic pendulum restoring torques relative to apparent gravity equilibrium
    const deltaPendPitch = this.pendPitch - targetPitchEq
    const deltaPendRoll = this.pendRoll - targetRollEq
    const tauPitchPendulum = Math.sin(deltaPendPitch) * K_pend
    const tauRollPendulum = -Math.sin(deltaPendRoll) * K_roll

    // Aerodynamic Pitch & Roll moments
    const speed = Math.max(1.0, vLen(vCanopyAirWorld))
    const qDyn = 0.5 * rho * speed * speed
    const S = w.projectedAreaSquareMeters
    const c = w.chordMeters
    const b = w.projectedSpanMeters

    const aoaDeg = Math.atan2(-vCanopyAirBody.y, Math.max(0.1, vCanopyAirBody.z)) * RAD
    const speedSysFraction = clamp((activeControls.speedBar ?? 0) + (activeControls.pullingA ?? 0), 0, 1)
    const baseTrimAoA = isXC ? 2.0 : 1.8
    const targetAoA = baseTrimAoA - speedSysFraction * (w.speedBarAngleDeg ?? 3.5)
    const tauPitchReflex = (aoaDeg - targetAoA) * DEG * ((isXC ? 0.065 : 0.045) * qDyn * S * c)
    const tauRollWeightShift = -effWeightShift * (pilotMass * G * 0.26)

    // Authentic gravity self-righting dihedral torque:
    // Smoothly rights wings on hands-off release, but smoothly fades when pilot actively commands a turn
    const attCurrent = qToAttitude(this.cQ)
    const controlEngagement = Math.max(
      activeControls.leftBrake,
      activeControls.rightBrake,
      Math.abs(effWeightShift),
    )
    const dihedralAuthority = 1.0 - clamp(controlEngagement * 1.4, 0, 1)
    const tauSelfRighting = Math.sin(attCurrent.bankDeg * DEG) * (50.0 * dihedralAuthority)

    // Aerodynamic angular damping (standard non-dimensional stability derivatives)
    const qDynSpan = 0.25 * rho * speed * S
    const aeroRollDamping = 0.12 * qDynSpan * b * b
    const aeroPitchDamping = (isXC ? 0.85 : 0.65) * qDynSpan * c * c
    const aeroYawDamping = 0.08 * qDynSpan * b * b

    // Net body torques
    const tauNetX =
      aero.totalMomentBody.x +
      tauPitchReflex +
      tauPitchPendulum +
      tauPitchThrust -
      this.cOmega.x * (aeroPitchDamping + C_pitch)

    // Dynamic snap brake impulse:
    // A sudden yank/snap on the brake generates immediate aerodynamic roll & yaw torque,
    // making the wing bite into the air dynamically like a real competition speedwing!
    const brakeRateLeftMinusRight = (activeControls.leftBrakeRate ?? 0) - (activeControls.rightBrakeRate ?? 0)
    const tauSnapRoll = clamp(brakeRateLeftMinusRight * 24.0, -380.0, 380.0)
    const tauSnapYaw = clamp(-brakeRateLeftMinusRight * 16.0, -260.0, 260.0)

    const tauNetY =
      aero.totalMomentBody.y +
      tauSnapYaw -
      this.cOmega.y * (aeroYawDamping + 42.0)

    const tauNetZ =
      aero.totalMomentBody.z +
      tauRollWeightShift +
      tauRollPendulum +
      tauRollUpdraft +
      tauSelfRighting +
      tauSnapRoll -
      this.cOmega.z * (aeroRollDamping + C_roll)

    // Euler's rotational equations of motion
    const alphaX = (tauNetX - (Izz - Iyy) * this.cOmega.y * this.cOmega.z) / Ixx
    const alphaY = (tauNetY - (Ixx - Izz) * this.cOmega.x * this.cOmega.z) / Iyy
    const alphaZ = (tauNetZ - (Iyy - Ixx) * this.cOmega.x * this.cOmega.y) / Izz

    this.cOmega = vAddScaled(this.cOmega, v3(alphaX, alphaY, alphaZ), h)
    this.cQ = qIntegrateBody(this.cQ, this.cOmega, h)

    // 9. Attitude & Dynamic Feedback State
    const att = qToAttitude(this.cQ)
    this.headingDeg = att.yawDeg
    this.pitchDeg = att.pitchDeg
    this.bankDeg = att.bankDeg

    const horizSpeedMps = Math.hypot(this.cVel.x, this.cVel.z)
    this.airspeedKmh = speed * 3.6

    this.pilot.pendulumPitchDeg = this.pendPitch * RAD
    this.pilot.pendulumRollDeg = this.pendRoll * RAD
    this.pilot.angularVelocityPitch = this.cOmega.x * RAD
    this.pilot.angularVelocityRoll = this.cOmega.z * RAD

    this.pilot.position = { x: this.pPos.x, y: this.pPos.y, z: this.pPos.z }
    this.pilot.velocity = { x: this.pVel.x, y: this.pVel.y, z: this.pVel.z }
    this.canopy.position = { x: this.cPos.x, y: this.cPos.y, z: this.cPos.z }
    this.canopy.velocity = { x: this.cVel.x, y: this.cVel.y, z: this.cVel.z }
    this.canopy.quaternion = { x: this.cQ.x, y: this.cQ.y, z: this.cQ.z, w: this.cQ.w }
    this.canopy.rollDeg = att.bankDeg
    this.canopy.pitchDeg = att.pitchDeg
    this.canopy.yawDeg = att.yawDeg
    this.canopy.airspeedKmh = this.airspeedKmh
    this.canopy.verticalSpeedMps = this.cVel.y

    this.telemetry.altitudeMeters = this.pPos.y
    this.telemetry.maxAltitudeMeters = Math.max(this.telemetry.maxAltitudeMeters, this.pPos.y)
    this.telemetry.airspeedKmh = this.airspeedKmh
    this.telemetry.groundSpeedKmh = horizSpeedMps * 3.6
    this.telemetry.verticalSpeedMps = this.cVel.y
    this.telemetry.thermalClimbMps = this.atmosphere.thermalUpdraftMps
    this.telemetry.glideRatio = Math.abs(this.cVel.y) > 0.1 ? horizSpeedMps / Math.abs(this.cVel.y) : 9.9
    this.telemetry.bankDeg = att.bankDeg
    this.telemetry.pitchDeg = att.pitchDeg
    this.telemetry.headingDeg = att.yawDeg
    this.telemetry.xcDistanceMeters = Math.hypot(this.pPos.x - this.launchPos.x, this.pPos.z - this.launchPos.z)
    this.telemetry.leftBrakeForceN = this.leftBrakeForceN
    this.telemetry.rightBrakeForceN = this.rightBrakeForceN
    this.telemetry.stallWarning = this.stallWarning
    this.telemetry.leftStalled = this.leftStalled
    this.telemetry.rightStalled = this.rightStalled
    this.telemetry.groundClearanceMeters = this.groundClearanceMeters

    this.poseCurr = this.capturePose()
  }

  /**
   * Smoothly synchronizes the interpolated physics pose to the rendered state.
   */
  private syncState(alpha: number): void {
    if (!this.posePrev || !this.poseCurr) return

    const cPos = vLerp(this.posePrev.canopyPos, this.poseCurr.canopyPos, alpha)
    const cVel = vLerp(this.posePrev.canopyVel, this.poseCurr.canopyVel, alpha)
    const cQ = qNlerp(this.posePrev.canopyQ, this.poseCurr.canopyQ, alpha)

    const pPos = vLerp(this.posePrev.pilotPos, this.poseCurr.pilotPos, alpha)
    const pVel = vLerp(this.posePrev.pilotVel, this.poseCurr.pilotVel, alpha)

    const att = qToAttitude(cQ)

    this.canopy.position = { x: cPos.x, y: cPos.y, z: cPos.z }
    this.canopy.velocity = { x: cVel.x, y: cVel.y, z: cVel.z }
    this.canopy.quaternion = { x: cQ.x, y: cQ.y, z: cQ.z, w: cQ.w }
    this.canopy.rollDeg = att.bankDeg
    this.canopy.pitchDeg = att.pitchDeg
    this.canopy.yawDeg = att.yawDeg

    const horizSpeedMps = Math.sqrt(cVel.x * cVel.x + cVel.z * cVel.z)
    this.canopy.airspeedKmh = this.airspeedKmh
    this.canopy.verticalSpeedMps = cVel.y

    this.pilot.position = { x: pPos.x, y: pPos.y, z: pPos.z }
    this.pilot.velocity = { x: pVel.x, y: pVel.y, z: pVel.z }
    this.pilot.angularVelocityPitch = this.cOmega.x * RAD
    this.pilot.angularVelocityRoll = this.cOmega.z * RAD

    this.telemetry.altitudeMeters = pPos.y
    this.telemetry.maxAltitudeMeters = Math.max(this.telemetry.maxAltitudeMeters, pPos.y)
    this.telemetry.airspeedKmh = this.canopy.airspeedKmh
    this.telemetry.groundSpeedKmh = horizSpeedMps * 3.6
    this.telemetry.verticalSpeedMps = cVel.y
    this.telemetry.thermalClimbMps = this.atmosphere.thermalUpdraftMps
    this.telemetry.glideRatio =
      Math.abs(cVel.y) > 0.1 ? horizSpeedMps / Math.abs(cVel.y) : 9.9
    this.telemetry.gForce = this.pilot.gForce
    this.telemetry.lineTensionNewtons = this.lineTensionNewtons
    this.telemetry.leftLineTensionNewtons = this.leftLineTensionNewtons
    this.telemetry.rightLineTensionNewtons = this.rightLineTensionNewtons
    this.telemetry.isLinesSlack = this.isLinesSlack
    this.telemetry.asymmetricStallSide = this.asymmetricStallSide
    this.telemetry.isNegativeSpin = this.isSpinning
    this.telemetry.isStalled = this.isStalled
    this.telemetry.bankDeg = att.bankDeg
    this.telemetry.pitchDeg = att.pitchDeg
    this.telemetry.headingDeg = att.yawDeg
    this.telemetry.wingType = this.currentWingType
    this.telemetry.xcDistanceMeters = Math.hypot(pPos.x - this.launchPos.x, pPos.z - this.launchPos.z)
    this.telemetry.leftBrakeForceN = this.leftBrakeForceN
    this.telemetry.rightBrakeForceN = this.rightBrakeForceN
    this.telemetry.stallWarning = this.stallWarning
    this.telemetry.leftStalled = this.leftStalled
    this.telemetry.rightStalled = this.rightStalled
    this.telemetry.isBStall = this.isBStall
    this.telemetry.pullingA = this.controls.pullingA ?? this.controls.speedBar
    this.telemetry.pullingB = this.controls.pullingB ?? 0
    this.telemetry.throttlePercent = Math.round((this.controls.throttle ?? 0) * 100)
    this.telemetry.engineRpm = Math.round(this.engineRpm)
    this.telemetry.thrustNewtons = Math.round(this.currentThrustNewtons)
    this.telemetry.groundClearanceMeters = this.groundClearanceMeters
    this.canopy.isBStall = this.isBStall
  }

  /**
   * Atmosphere: slope-normalized ridge lift, thermal core with sink ring, and gusts.
   */
  private sampleAtmosphere(pos: V3, sample: TerrainSampler): V3 {
    const terrainH = sample(pos.x, pos.z)
    const clearance = Math.max(0, pos.y - terrainH)

    // Base wind from atmosphere state
    const windSpeedMps = (this.atmosphere.windSpeedKmh ?? 12) / 3.6
    const windRad = (this.atmosphere.windHeadingDeg ?? 190) * DEG
    let baseWind = v3(Math.sin(windRad) * windSpeedMps, 0, Math.cos(windRad) * windSpeedMps)

    // Check Canyon Venturi wind modification if world provides it (Reel #2)
    if (this.world && this.world.sampleVenturi) {
      const vWind = this.world.sampleVenturi(pos.x, pos.y, pos.z, { x: baseWind.x, y: baseWind.y, z: baseWind.z })
      baseWind = v3(vWind.x, vWind.y, vWind.z)
    }

    // Slope-normalized ridge lift
    let ridgeLiftMps = 0
    if (this.world && this.world.sampleRidgeLift) {
      const wDir = { x: Math.sin(windRad), y: 0, z: Math.cos(windRad) }
      ridgeLiftMps = this.world.sampleRidgeLift(pos.x, pos.y, pos.z, wDir, windSpeedMps)
    } else {
      const eps = 4.0
      const dhdx = (sample(pos.x + eps, pos.z) - sample(pos.x - eps, pos.z)) / (2 * eps)
      const dhdz = (sample(pos.x, pos.z + eps) - sample(pos.x, pos.z - eps)) / (2 * eps)
      const slopeNorm = Math.sqrt(1 + dhdx * dhdx + dhdz * dhdz)

      const normalUpdraft = -(baseWind.x * dhdx + baseWind.z * dhdz) / slopeNorm
      const decay = Math.exp(-clearance / 120.0)
      ridgeLiftMps = (normalUpdraft > 0 ? normalUpdraft : normalUpdraft * 0.4) * decay
    }
    this.atmosphere.ridgeLiftMps = ridgeLiftMps

    // 3D Toroidal Thermal Fluid Field: Updraft + Inflow/Outflow + Swirl + Cold Tail
    let fluidVx = 0
    let fluidVy = 0
    let fluidVz = 0
    let staticCharge = 0
    let tempAnomaly = 0
    let isDrafting = false

    if (this.world) {
      if (this.world.sampleThermalFluidVelocity) {
        const fluid = this.world.sampleThermalFluidVelocity(
          pos.x,
          pos.y,
          pos.z,
          this.telemetry.flightDurationSeconds,
          { x: baseWind.x, y: baseWind.y, z: baseWind.z },
        )
        fluidVx = fluid.velocity.x
        fluidVy = fluid.velocity.y
        fluidVz = fluid.velocity.z
        staticCharge = fluid.staticChargeField
        tempAnomaly = fluid.temperatureAnomalyC
        isDrafting = fluid.isDraftingZone
      } else {
        fluidVy = this.world.sampleUpdraft(
          pos.x,
          pos.y,
          pos.z,
          this.telemetry.flightDurationSeconds,
          { x: baseWind.x, y: baseWind.y, z: baseWind.z },
        )
      }
    } else {
      fluidVy = this.atmosphere.thermalUpdraftMps ?? 0
    }

    // Dynamic turbulence gusts (smooth low-frequency atmospheric eddy)
    const turb = this.atmosphere.turbulence ?? 0
    const time = this.telemetry.flightDurationSeconds
    const gustX = turb * windSpeedMps * (Math.sin(time * 0.73) * 0.6 + Math.sin(time * 1.61) * 0.4)
    const gustZ = turb * windSpeedMps * (Math.cos(time * 0.81) * 0.6 + Math.cos(time * 1.47) * 0.4)

    const totalWindX = baseWind.x + gustX + fluidVx
    const totalWindY = ridgeLiftMps + fluidVy
    const totalWindZ = baseWind.z + gustZ + fluidVz

    this.atmosphere.windVector = {
      x: totalWindX,
      y: totalWindY,
      z: totalWindZ,
    }

    // Update telemetry state when sampling near canopy center
    if (Math.abs(pos.x - this.cPos.x) < 0.6 && Math.abs(pos.z - this.cPos.z) < 0.6) {
      this.telemetry.staticChargeField = staticCharge
      this.telemetry.thermalFluidVx = fluidVx
      this.telemetry.thermalFluidVy = fluidVy
      this.telemetry.thermalFluidVz = fluidVz
      this.telemetry.thermalTempAnomalyC = tempAnomaly
      this.telemetry.isDraftingZone = isDrafting
    }

    return v3(totalWindX, totalWindY, totalWindZ)
  }
}
