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
import {
  airDensityAt,
  computeApparentMass,
  evaluateWingAerodynamics,
  PARAGLIDER_XC_24M,
  SPEEDWING_13M,
  type WingGeometry,
} from './aerodynamics'
import {
  clamp,
  DEG,
  qCopy,
  qFromAxisAngle,
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
  vDot,
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

  // Two-Body State (World Frame)
  private cPos: V3
  private cVel: V3
  private cQ: Quat
  private cOmega: V3 // Body-frame angular velocity (rad/s)

  private pPos: V3
  private pVel: V3

  public currentWingType: 'speedwing' | 'paraglider' = 'speedwing'
  private launchPos: V3

  // Fixed-step clock & interpolation
  private accumulator = 0
  private posePrev: Pose | null = null
  private poseCurr: Pose | null = null
  private initialAltitude: number
  private initialHeadingDeg: number

  constructor(initialAltitude: number = 2050, initialHeadingDeg: number = 5) {
    this.wing = { ...SPEEDWING_13M }
    this.initialAltitude = initialAltitude
    this.initialHeadingDeg = initialHeadingDeg
    this.launchPos = v3(0, initialAltitude, 0)

    const headingRad = initialHeadingDeg * DEG
    const trimMps = this.wing.trimSpeedKmh / 3.6
    const trimSinkMps = -trimMps / this.wing.glideRatio // -2.7 m/s

    this.cPos = v3(0, initialAltitude, 0)
    this.cVel = v3(Math.sin(headingRad) * trimMps, trimSinkMps, Math.cos(headingRad) * trimMps)
    this.cQ = qFromAxisAngle(v3(0, 1, 0), headingRad)
    this.cOmega = v3()

    this.pPos = v3(0, initialAltitude - this.wing.tetherLengthMeters, 0)
    this.pVel = v3(this.cVel.x, this.cVel.y, this.cVel.z)

    this.canopy = {
      position: { x: 0, y: initialAltitude, z: 0 },
      velocity: { x: this.cVel.x, y: this.cVel.y, z: this.cVel.z },
      quaternion: { x: this.cQ.x, y: this.cQ.y, z: this.cQ.z, w: this.cQ.w },
      rollDeg: 0,
      pitchDeg: 4.5,
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
    }

    this.pilot = {
      position: { x: 0, y: initialAltitude - this.wing.tetherLengthMeters, z: 0 },
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
    }

    this.poseCurr = this.capturePose()
    this.posePrev = this.poseCurr
  }

  public setSeed(_seed: number) {}

  public setWing(wingType: 'speedwing' | 'paraglider') {
    this.currentWingType = wingType
    this.wing = wingType === 'paraglider' ? { ...PARAGLIDER_XC_24M } : { ...SPEEDWING_13M }
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
    const trimMps = this.wing.trimSpeedKmh / 3.6
    const trimSinkMps = -trimMps / this.wing.glideRatio
    const spawn = startPos ?? { x: 0, y: initialAltitude, z: 0 }

    this.launchPos = v3(spawn.x, spawn.y, spawn.z)
    this.cPos = v3(spawn.x, spawn.y, spawn.z)
    this.cVel = v3(Math.sin(headingRad) * trimMps, trimSinkMps, Math.cos(headingRad) * trimMps)
    this.cQ = qFromAxisAngle(v3(0, 1, 0), headingRad)
    this.cOmega = v3()

    this.pPos = v3(spawn.x, spawn.y - this.wing.tetherLengthMeters, spawn.z)
    this.pVel = v3(this.cVel.x, this.cVel.y, this.cVel.z)

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

  /**
   * Fixed 1/240s sub-step integration of the coupled two-body system.
   */
  private subStep(h: number, sample: TerrainSampler): void {
    this.posePrev = this.poseCurr
    this.telemetry.flightDurationSeconds += h

    const w = this.wing
    const mPilot = w.pilotMassKg
    const mCanopy = w.canopyMassKg + w.enclosedAirKg
    const tetherL = w.tetherLengthMeters

    // 1. Terrain clearance & Foot Drag
    const terrainH = sample(this.pPos.x, this.pPos.z)
    this.groundClearanceMeters = Math.max(0, this.pPos.y - terrainH)
    this.isFootDragging = this.groundClearanceMeters < 1.2 && !this.isCrashed

    // Crash condition: high impact vertical sink into terrain
    if (this.pPos.y <= terrainH + 0.3 && this.pVel.y < -6.5) {
      this.isCrashed = true
      return
    }

    // 2. Sample Air Mass (Wind, Ridge Lift, Thermal Cores)
    const rho = airDensityAt(this.cPos.y)
    const windWorld = this.sampleAtmosphere(this.cPos, sample)

    // Canopy relative velocity in world and body frames
    const vAirWorld = vSub(this.cVel, windWorld)
    const vAirBody = qRotateInv(this.cQ, vAirWorld)

    // 3. Reverse Stance & Effective Controls
    const targetReverseYaw = this.controls.reverseStance ? 180.0 : 0.0
    this.pilot.reverseStanceYawDeg +=
      (targetReverseYaw - this.pilot.reverseStanceYawDeg) * 8.0 * h

    const effLeftBrake = this.controls.reverseStance ? this.controls.rightBrake : this.controls.leftBrake
    const effRightBrake = this.controls.reverseStance ? this.controls.leftBrake : this.controls.rightBrake
    const effWeightShift = this.controls.reverseStance ? -this.controls.weightShift : this.controls.weightShift

    const aeroControls: FlightControls = {
      ...this.controls,
      leftBrake: effLeftBrake,
      rightBrake: effRightBrake,
      weightShift: effWeightShift,
    }

    // 4. Evaluate Aerodynamic Forces on Canopy (4 discrete panels)
    const aero = evaluateWingAerodynamics(
      vAirBody,
      this.cOmega,
      aeroControls,
      this.groundClearanceMeters,
      rho,
      w,
    )

    this.isStalled = aero.isFullStall
    this.asymmetricStallSide = aero.asymmetricStallSide
    this.isSpinning = aero.asymmetricStallSide !== 'none'
    this.leftWingCollapse = aero.asymmetricStallSide === 'left' ? 0.95 : aero.isFullStall ? 0.8 : 0
    this.rightWingCollapse = aero.asymmetricStallSide === 'right' ? 0.95 : aero.isFullStall ? 0.8 : 0

    // Canopy Apparent Mass Tensor
    const mApp = computeApparentMass(rho, w)
    const mCanopyEff = mCanopy + mApp.mHeave

    // 5. Line Attachment Point & Tether Constraint Mechanics
    // Riser attachment point in canopy body frame (offset laterally by weight shift)
    const wsOffset = effWeightShift * w.weightShiftMeters
    const rRiserBody = v3(wsOffset, -0.35, 0)
    const rRiserWorld = qRotate(this.cQ, rRiserBody)
    const xRiserWorld = vAdd(this.cPos, rRiserWorld)

    // Tether line vector from pilot to risers
    const lineVec = vSub(xRiserWorld, this.pPos)
    const lineDist = vLen(lineVec)
    const lineDir = lineDist > 1e-4 ? vNorm(lineVec) : v3(0, 1, 0)

    // Relative velocity of risers vs pilot
    const vRiserWorld = vAdd(this.cVel, qRotate(this.cQ, vCross(this.cOmega, rRiserBody)))
    const vRel = vSub(vRiserWorld, this.pVel)

    // Relative velocity components
    const vRelRadial = vDot(vRel, lineDir)
    const vRelTangential = vLen(vSub(vRel, vScale(lineDir, vRelRadial)))

    // Centrifugal acceleration pulling pilot outward along tether lines:
    // a_c = (v_tangential^2) / tetherL
    const aCentrifugal = (vRelTangential * vRelTangential) / tetherL

    // Aerodynamic force in world frame
    const FaeroWorld = qRotate(this.cQ, aero.totalForceBody)

    // Unconstrained accelerations
    const aCanopyFree = vAdd(vScale(FaeroWorld, 1 / mCanopyEff), v3(0, -G, 0))
    // Pilot parasite drag
    const vPilotAir = vSub(this.pVel, windWorld)
    const vPilotLen = vLen(vPilotAir)
    const FdragPilot = vScale(vPilotAir, -0.5 * rho * vPilotLen * w.pilotDragAreaM2)
    const aPilotFree = vAdd(vScale(FdragPilot, 1 / mPilot), v3(0, -G, 0))

    // Acceleration difference along line direction
    const aDiffAlongLines = vDot(vSub(aCanopyFree, aPilotFree), lineDir)

    // Dynamic tether constraint tension calculation
    const reducedMass = (mPilot * mCanopyEff) / (mPilot + mCanopyEff)
    // Taut inextensible cable constraint:
    // Tension enforces inextensibility under centrifugal acceleration and differential gravity/aero
    const dynamicTension = reducedMass * Math.max(0, aCentrifugal + aDiffAlongLines)
    const stretchDist = Math.max(0, lineDist - tetherL)
    const correctionTension = (stretchDist / h) * reducedMass * 0.35
    const rawTension = dynamicTension + correctionTension

    // Check slack condition
    if (rawTension <= 15.0 && lineDist < tetherL * 0.99) {
      this.isLinesSlack = true
      this.lineTensionNewtons = 0
      this.leftLineTensionNewtons = 0
      this.rightLineTensionNewtons = 0
    } else {
      this.isLinesSlack = false
      this.lineTensionNewtons = Math.max(0, rawTension)
      const liftSum = Math.max(1, aero.leftLift + aero.rightLift)
      this.leftLineTensionNewtons = this.lineTensionNewtons * (aero.leftLift / liftSum)
      this.rightLineTensionNewtons = this.lineTensionNewtons * (aero.rightLift / liftSum)
    }

    const tensionVec = vScale(lineDir, this.lineTensionNewtons)

    // 6. Integrate Pilot State
    const aPilotTotal = vAdd(aPilotFree, vScale(tensionVec, 1 / mPilot))
    // Foot drag friction
    if (this.isFootDragging) {
      const friction = vScale(vNorm(this.pVel), -4.5)
      aPilotTotal.x += friction.x
      aPilotTotal.z += friction.z
    }

    this.pVel = vAddScaled(this.pVel, aPilotTotal, h)
    this.pPos = vAddScaled(this.pPos, this.pVel, h)

    // Prevent pilot from penetrating ground
    if (this.pPos.y < terrainH + 0.3) {
      this.pPos.y = terrainH + 0.3
      if (this.pVel.y < 0) this.pVel.y = 0
    }

    // Pilot G-Force
    const gVal = (this.lineTensionNewtons / mPilot) / G
    this.pilot.gForce = clamp(gVal, 0.1, 7.5)

    // 7. Integrate Canopy State (6-DOF with Apparent Mass)
    const aCanopyTotal = vAdd(aCanopyFree, vScale(tensionVec, -1 / mCanopyEff))
    this.cVel = vAddScaled(this.cVel, aCanopyTotal, h)
    this.cPos = vAddScaled(this.cPos, this.cVel, h)

    // Position-Based Dynamics (PBD) Inextensible Cable Projection:
    // Guarantees line distance strictly <= tether length without spring oscillation
    const postLineVec = vSub(this.pPos, xRiserWorld)
    const postLineDist = vLen(postLineVec)
    if (postLineDist > tetherL) {
      const postLineDir = vScale(postLineVec, 1 / postLineDist)
      const overshoot = postLineDist - tetherL
      this.pPos = vAddScaled(this.pPos, postLineDir, -overshoot * (mCanopyEff / (mPilot + mCanopyEff)))
      this.cPos = vAddScaled(this.cPos, postLineDir, overshoot * (mPilot / (mPilot + mCanopyEff)))

      const vRelOut = vDot(vSub(this.pVel, this.cVel), postLineDir)
      if (vRelOut > 0) {
        this.pVel = vAddScaled(this.pVel, postLineDir, -vRelOut * (reducedMass / mPilot))
        this.cVel = vAddScaled(this.cVel, postLineDir, vRelOut * (reducedMass / mCanopyEff))
      }
    }

    // 7. Canopy Rotational Dynamics
    // Multi-row suspension line bridles (A, B, C risers) provide aerodynamic pitch stability
    // around trim incidence, allowing full 360° dynamic swings and tumbles under acro momentum.
    const lineToPilotWorld = vSub(this.pPos, this.cPos)
    const lineToPilotBody = qRotateInv(this.cQ, vNorm(lineToPilotWorld))

    // Flexible Multi-Row Line Bridle Restoring Torque:
    // Natural pendulum restoring moment: tau = -sin(delta) * kTruss.
    // Holds trim incidence during straight flight, while passing smoothly through zero
    // at 180° inversion to allow full acro tumbles and loops!
    const targetPitchRad = (w.riggingAngleDeg + this.controls.speedBar * w.speedBarAngleDeg) * DEG
    const currentPitchOffsetRad = Math.atan2(lineToPilotBody.z, -lineToPilotBody.y)
    const deltaPitchRad = currentPitchOffsetRad - targetPitchRad

    // Line tension factor: when lines go slack, bridle restoring moments unload
    const tensionFrac = clamp(this.lineTensionNewtons / (mPilot * G), 0, 3.0)

    // Dynamic bridle stiffness (N*m/rad)
    const kTrussPitch = 2600.0 * tensionFrac
    const dTrussPitch = 340.0 * tensionFrac
    const kTrussRoll = 1400.0 * tensionFrac
    const dTrussRoll = 180.0 * tensionFrac

    const trussPitchTorque = -Math.sin(deltaPitchRad) * kTrussPitch - this.cOmega.x * dTrussPitch
    const currentRollOffsetRad = Math.atan2(lineToPilotBody.x, -lineToPilotBody.y)
    const deltaRollRad = currentRollOffsetRad - (-effWeightShift * 0.45)
    const trussRollTorque = -Math.sin(deltaRollRad) * kTrussRoll - this.cOmega.z * dTrussRoll

    // Total body torques: aerodynamic torques + flexible bridle restoring moments
    const totalTorque = v3(
      aero.totalMomentBody.x + trussPitchTorque,
      aero.totalMomentBody.y,
      aero.totalMomentBody.z + trussRollTorque,
    )

    // Canopy effective rotational inertia (Canopy structural + apparent added inertia)
    const b = w.projectedSpanMeters
    const c = w.chordMeters
    const Ixx = (mCanopy * (c * c) / 12) + mApp.iPitch + 10.0 // ~22 kg*m^2 (Pitch)
    const Iyy = (mCanopy * (b * b + c * c) / 12) + mApp.iYaw + 20.0 // ~65 kg*m^2 (Yaw)
    const Izz = (mCanopy * (b * b) / 12) + mApp.iRoll + 12.0  // ~42 kg*m^2 (Roll)

    // Natural vortex aerodynamic rotational damping
    const pitchDamp = -this.cOmega.x * (Ixx * 1.5)
    const yawDamp = -this.cOmega.y * (Iyy * 1.8)
    const rollDamp = -this.cOmega.z * (Izz * 1.6)

    const alphaCanopy = v3(
      (totalTorque.x + pitchDamp) / Ixx,
      (totalTorque.y + yawDamp) / Iyy,
      (totalTorque.z + rollDamp) / Izz,
    )

    this.cOmega = vAddScaled(this.cOmega, alphaCanopy, h)
    this.cQ = qIntegrateBody(this.cQ, this.cOmega, h)

    // 8. Visual Pendulum Angles & Acro Tracking
    // Relative angle of pilot under canopy
    const relPilotVec = vSub(this.pPos, this.cPos)
    const relPilotBody = qRotateInv(this.cQ, relPilotVec)

    this.pilot.pendulumPitchDeg = Math.atan2(relPilotBody.z, -relPilotBody.y) * RAD
    this.pilot.pendulumRollDeg = Math.atan2(relPilotBody.x, -relPilotBody.y) * RAD

    // Continuous tumble loop detection
    this.cumulativePitchDeg += this.cOmega.x * RAD * h
    if (Math.abs(this.cumulativePitchDeg - this.lastTumblePitchDeg) >= 360.0) {
      if (this.lineTensionNewtons > 50 && !this.isLinesSlack) {
        this.tumbleStreak++
        this.telemetry.tumbleStreak = this.tumbleStreak
      }
      this.lastTumblePitchDeg = this.cumulativePitchDeg
    }

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
    this.canopy.airspeedKmh = vLen(cVel) * 3.6
    this.canopy.verticalSpeedMps = cVel.y

    this.pilot.position = { x: pPos.x, y: pPos.y, z: pPos.z }
    this.pilot.velocity = { x: pVel.x, y: pVel.y, z: pVel.z }

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
    const baseWind = v3(Math.sin(windRad) * windSpeedMps, 0, Math.cos(windRad) * windSpeedMps)

    // Slope-normalized ridge lift: u . grad(h) / sqrt(1 + |grad(h)|^2)
    const eps = 4.0
    const dhdx = (sample(pos.x + eps, pos.z) - sample(pos.x - eps, pos.z)) / (2 * eps)
    const dhdz = (sample(pos.x, pos.z + eps) - sample(pos.x, pos.z - eps)) / (2 * eps)
    const slopeNorm = Math.sqrt(1 + dhdx * dhdx + dhdz * dhdz)

    const normalUpdraft = (baseWind.x * dhdx + baseWind.z * dhdz) / slopeNorm
    const decay = Math.exp(-clearance / 120.0)
    const ridgeLiftMps = (normalUpdraft > 0 ? normalUpdraft : normalUpdraft * 0.4) * decay
    this.atmosphere.ridgeLiftMps = ridgeLiftMps

    // Thermal updraft from atmosphere state
    const thermalLiftMps = this.atmosphere.thermalUpdraftMps ?? 0

    // Dynamic turbulence gusts (smooth low-frequency atmospheric eddy)
    const turb = this.atmosphere.turbulence ?? 0
    const time = this.telemetry.flightDurationSeconds
    const gustX = turb * windSpeedMps * (Math.sin(time * 0.73) * 0.6 + Math.sin(time * 1.61) * 0.4)
    const gustZ = turb * windSpeedMps * (Math.cos(time * 0.81) * 0.6 + Math.cos(time * 1.47) * 0.4)

    this.atmosphere.windVector = {
      x: baseWind.x + gustX,
      y: ridgeLiftMps + thermalLiftMps,
      z: baseWind.z + gustZ,
    }

    return v3(baseWind.x + gustX, baseWind.y + ridgeLiftMps + thermalLiftMps, baseWind.z + gustZ)
  }
}
