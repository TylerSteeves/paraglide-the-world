/**
 * First-Principles Ram-Air Foil Aerodynamics with Vortex Shedding,
 * Apparent Mass Tensor, and 4-Station Discretization.
 *
 * Grounded in paraglider aeroacoustics & flight mechanics literature:
 * - Low aspect ratio (AR ~ 4.5) ram-air inflated foil
 * - Non-linear trailing edge brake camber & separation polar
 * - Tip vortex downwash (Biot-Savart induced drag)
 * - Ground effect vortex suppression (mirrored vortex system)
 * - True apparent mass & inertia tensor for entrained fluid volume
 */

import {
  clamp,
  DEG,
  RAD,
  v3,
  vAdd,
  vCross,
  vDot,
  vLen,
  vNorm,
  vScale,
  vSub,
  wrapDeg180,
  type V3,
} from './vecmath'
import type { FlightControls } from './types'

export type WingGeometry = {
  spanMeters: number
  projectedSpanMeters: number
  areaSquareMeters: number
  projectedAreaSquareMeters: number
  chordMeters: number
  aspectRatio: number
  arcAngleDeg: number
  tetherLengthMeters: number // line length to pilot (~5.3m)
  riggingAngleDeg: number    // baseline canopy trim incidence (~ -1.0°)
  speedBarAngleDeg: number  // incidence drop at full speedbar (~ -5.5°)
  weightShiftMeters: number // carabiner lateral shift (~0.14m)
  canopyMassKg: number      // canopy fabric mass (~4.5 kg)
  enclosedAirKg: number     // mass of air inside inflated cells (~5.5 kg)
  pilotMassKg: number       // pilot + harness + reserve (~88 kg)
  pilotDragAreaM2: number   // pilot body parasite drag area (~0.36 m²)
  lineDragAreaM2: number    // suspension lines profile drag area (~0.08 m²)
  trimSpeedKmh: number
  minSpeedKmh: number
  maxSpeedKmh: number
  glideRatio: number
}

export const SPEEDWING_13M: WingGeometry = {
  spanMeters: 8.8,
  projectedSpanMeters: 7.8,
  areaSquareMeters: 17.5,
  projectedAreaSquareMeters: 13.5,
  chordMeters: 1.73,
  aspectRatio: 4.5,
  arcAngleDeg: 22.0,
  tetherLengthMeters: 5.3,
  riggingAngleDeg: -3.3,
  speedBarAngleDeg: 3.5,
  weightShiftMeters: 0.14,
  canopyMassKg: 4.5,
  enclosedAirKg: 5.5,
  pilotMassKg: 88.0,
  pilotDragAreaM2: 0.36,
  lineDragAreaM2: 0.08,
  trimSpeedKmh: 54.0,
  minSpeedKmh: 28.0,
  maxSpeedKmh: 130.0,
  glideRatio: 5.2,
}

export const PARAGLIDER_XC_24M: WingGeometry = {
  spanMeters: 11.8,
  projectedSpanMeters: 9.8,
  areaSquareMeters: 28.0,
  projectedAreaSquareMeters: 24.0,
  chordMeters: 2.45,
  aspectRatio: 6.2,
  arcAngleDeg: 18.0,
  tetherLengthMeters: 7.2,
  riggingAngleDeg: -3.0,
  speedBarAngleDeg: 3.5,
  weightShiftMeters: 0.12,
  canopyMassKg: 5.8,
  enclosedAirKg: 11.2,
  pilotMassKg: 88.0,
  pilotDragAreaM2: 0.22, // Streamlined pod / cocoon XC harness
  lineDragAreaM2: 0.06,  // Unsheathed microline suspension lines
  trimSpeedKmh: 39.0,
  minSpeedKmh: 23.0,
  maxSpeedKmh: 62.0,
  glideRatio: 10.2,
}

export const STANDARD_WING: WingGeometry = SPEEDWING_13M

export const AIR_DENSITY_SEA_LEVEL = 1.225

export function airDensityAt(altitudeMeters: number): number {
  const t = 1 - 2.2558e-5 * Math.max(0, altitudeMeters)
  return AIR_DENSITY_SEA_LEVEL * Math.pow(t, 4.2559)
}

/**
 * Apparent Mass Tensor (Added Mass):
 * Moving a light cloth canopy accelerates the fluid volume inside and around it.
 * Values derived from Lissaman & Tuckerman ram-air parachute models.
 */
export type ApparentMassTensor = {
  mSurge: number    // x (forward)
  mSway: number     // y (lateral)
  mHeave: number    // z (vertical/lift normal)
  iRoll: number     // roll inertia
  iPitch: number    // pitch inertia
  iYaw: number      // yaw inertia
}

export function computeApparentMass(rho: number, wing: WingGeometry = STANDARD_WING): ApparentMassTensor {
  const b = wing.projectedSpanMeters
  const c = wing.chordMeters
  const rCirc = c * 0.5
  const baseVol = Math.PI * rCirc * rCirc * b

  return {
    mSurge: 0.12 * rho * baseVol,
    mSway: 0.40 * rho * baseVol,
    mHeave: 0.85 * rho * baseVol, // massive added mass in heave (air cushion)
    iRoll: 0.045 * rho * Math.PI * Math.pow(b * 0.5, 4) * c,
    iPitch: 0.080 * rho * Math.PI * Math.pow(c * 0.5, 4) * b,
    iYaw: 0.045 * rho * Math.PI * Math.pow(b * 0.5, 4) * c,
  }
}

export type Station = 'leftOuter' | 'leftInner' | 'rightInner' | 'rightOuter'

export type PanelConfig = {
  station: Station
  areaFrac: number
  arm: number         // lateral distance from centerline (m, negative for left)
  height: number      // vertical offset from root (m, arched downward at tips)
  chord: number
  arcDeg: number      // outward normal tilt (degrees)
  incidenceDeg: number // built-in rigging incidence angle (degrees) relative to keel line
  brakeGain: number   // brake concentration (outer panels have highest deflection)
}

export function getPanelStations(wing: WingGeometry = STANDARD_WING): PanelConfig[] {
  const b = wing.projectedSpanMeters
  const c = wing.chordMeters
  const arc = wing.arcAngleDeg
  // Rigging section incidence: speedwing trims with ~6.6° down-pitch relative to flight path,
  // XC paraglider with ~4.5°. Tips have 1.0° washout (lower angle of attack) for tip stall prevention.
  const baseInc = wing.aspectRatio > 5.5 ? 4.5 : 6.6
  return [
    { station: 'leftOuter', areaFrac: 0.22, arm: -b * 0.35, height: -0.25, chord: c * 0.88, arcDeg: -arc, incidenceDeg: baseInc - 1.0, brakeGain: 1.30 },
    { station: 'leftInner', areaFrac: 0.28, arm: -b * 0.12, height: 0.0, chord: c * 1.05, arcDeg: -arc * 0.4, incidenceDeg: baseInc, brakeGain: 0.70 },
    { station: 'rightInner', areaFrac: 0.28, arm: b * 0.12, height: 0.0, chord: c * 1.05, arcDeg: arc * 0.4, incidenceDeg: baseInc, brakeGain: 0.70 },
    { station: 'rightOuter', areaFrac: 0.22, arm: b * 0.35, height: -0.25, chord: c * 0.88, arcDeg: arc, incidenceDeg: baseInc - 1.0, brakeGain: 1.30 },
  ]
}

export const PANEL_STATIONS: PanelConfig[] = getPanelStations(STANDARD_WING)

export type PanelAerodynamics = {
  liftNewtons: number
  dragNewtons: number
  forceBody: V3
  momentBody: V3
  alphaDeg: number
  airspeedMps: number
  isStalled: boolean
  isCollapsed: boolean
  separation: number
}

/**
 * Sectional ram-air lift, drag, and moment polar with brake trailing-edge deflection
 * and dynamic transient brake rate-of-change (violence of brake application).
 */
export function evaluateAirfoil(
  alphaDeg: number,
  brakeDeflection: number,
  speedBar: number,
  groundEffectFactor: number,
  aspectRatio: number = 4.5,
  brakeRate: number = 0,
  symmetricBrake: number = brakeDeflection,
): { cl: number; cd: number; cm: number; separation: number; isStalled: boolean } {
  const alphaClamped = wrapDeg180(alphaDeg)

  // High aspect ratio XC wings have steeper lift curve slope and lower profile drag
  const isHighAspect = aspectRatio > 5.5
  const zeroLiftAlpha = (isHighAspect ? -4.2 : -3.5) - brakeDeflection * 4.0
  const clSlope = isHighAspect ? 0.088 : 0.076 // 2pi/rad theoretical limit
  const attachedCl = (alphaClamped - zeroLiftAlpha) * clSlope

  // Max attached Cl before separation
  const clMax = 1.65 + brakeDeflection * 0.40 - speedBar * 0.15
  const stallAlpha = (isHighAspect ? 15.5 : 16.5) + brakeDeflection * 2.5 - speedBar * 1.5

  let cl: number
  let cd: number
  let cm: number
  let separation: number
  let isStalled = false

  if (alphaClamped <= stallAlpha && alphaClamped >= -10.0) {
    // Attached flow regime: camber lift boost at moderate/deep brake
    const camberBoost = brakeDeflection < 0.65 ? brakeDeflection * 0.42 : 0.27 - (brakeDeflection - 0.65) * 0.35
    cl = clamp(attachedCl + camberBoost, -0.6, clMax) * groundEffectFactor

    // Profile & parasitic drag + authentic trailing-edge flap drag (~0.22 at full deflection)
    const baseCd = (isHighAspect ? 0.024 : 0.042) + 0.00030 * Math.pow(alphaClamped - 2.0, 2)
    const brakeCd = 0.035 * brakeDeflection + 0.18 * Math.pow(brakeDeflection, 2.0)
    cd = baseCd + brakeCd

    // Reflexed ram-air section pitching moment (body +X torque convention: + nose down, - nose up/flare):
    // Naturally pitch-stable around trim alpha (~4.0 deg).
    // Symmetrical dual brake application produces authentic nose-up flare.
    const cmAlpha = 0.010 * (alphaClamped - 4.0)
    const cmBrake = -0.18 * symmetricBrake
    cm = cmAlpha + cmBrake
    separation = brakeDeflection * 0.45
  } else {
    // Separated post-stall regime
    isStalled = true
    const aRad = alphaClamped * DEG
    separation = 1.0

    // Flat-plate separated crossflow
    cl = 1.15 * Math.sin(2 * aRad) * 0.65
    cd = 0.35 + 1.25 * Math.pow(Math.sin(aRad), 2) + brakeDeflection * 0.45
    // Post-stall recovery moment: pitches nose down if stalled at high positive alpha
    cm = 0.12 * Math.sin(aRad)
  }

  // Dynamic transient circulation & drag surge: crisp responsiveness to violent control inputs
  if (brakeRate > 0) {
    const rateFactor = Math.min(5.0, brakeRate)
    cd += Math.min(0.14, 0.018 * rateFactor)
    // Impulsive pitch torque & lift spike from the violence of brake application (circulation surge)
    cm += -0.075 * rateFactor
    cl += 0.12 * rateFactor
  } else if (brakeRate < 0) {
    // Aggressive forward canopy surge upon violent brake release
    const releaseFactor = Math.min(5.0, -brakeRate)
    cm += 0.085 * releaseFactor
  }

  return { cl, cd, cm, separation, isStalled }
}

/**
 * Evaluates full 4-station aerodynamic forces & moments on the canopy in canopy body frame.
 */
export function evaluateWingAerodynamics(
  vAirBody: V3,
  omegaBody: V3,
  controls: FlightControls,
  groundClearanceMeters: number,
  rho: number,
  wing: WingGeometry = STANDARD_WING,
): {
  totalForceBody: V3
  totalMomentBody: V3
  panelStates: Record<Station, PanelAerodynamics>
  leftLift: number
  rightLift: number
  leftDrag: number
  rightDrag: number
  isFullStall: boolean
  asymmetricStallSide: 'none' | 'left' | 'right'
  leftBrakeForceN: number
  rightBrakeForceN: number
  stallWarning: number
  leftStalled: boolean
  rightStalled: boolean
} {
  let totalForceBody = v3()
  let totalMomentBody = v3()
  let leftLift = 0
  let rightLift = 0
  let leftDrag = 0
  let rightDrag = 0
  let leftStalledCount = 0
  let rightStalledCount = 0
  let maxAlphaDeg = -999
  let leftAirspeedSum = 0
  let rightAirspeedSum = 0

  // Ground effect factor: mirrored vortex reduces induced downwash
  const span = wing.projectedSpanMeters
  const hRatio = Math.max(0.05, groundClearanceMeters / span)
  const groundEffectMultiplier = hRatio < 0.5 ? 1.0 + (0.5 - hRatio) * 0.35 : 1.0
  const inducedDragReduction = hRatio < 0.5 ? (16 * hRatio * hRatio) / (1 + 16 * hRatio * hRatio) : 1.0

  const panelStates = {} as Record<Station, PanelAerodynamics>
  const stations = getPanelStations(wing)

  for (const cfg of stations) {
    const isLeft = cfg.station === 'leftOuter' || cfg.station === 'leftInner'
    const brakeRaw = isLeft ? controls.leftBrake : controls.rightBrake
    const brakeRate = isLeft ? controls.leftBrakeRate : controls.rightBrakeRate
    const brake = clamp(brakeRaw * cfg.brakeGain, 0, 1)

    // Station arm position in body frame
    const rStation = v3(cfg.arm, cfg.height, 0)

    // Local relative airflow velocity: v_local = v_body + omega x r
    const vLocal = vAdd(vAirBody, vCross(omegaBody, rStation))
    const vLocalLen = Math.max(0.5, vLen(vLocal))
    const qLocal = 0.5 * rho * vLocalLen * vLocalLen

    // Station unit vectors
    // Normal vector tilted by anhedral arc
    const arcRad = cfg.arcDeg * DEG
    const panelNormal = vNorm(v3(Math.sin(arcRad), Math.cos(arcRad), 0))

    // Angle of attack: pitch angle between chordwise velocity (y-z plane) and chord, minus section incidence
    const vz = vLocal.z // forward airflow component
    const vy = vLocal.y // chordwise vertical airflow component
    const rawAlphaDeg = Math.atan2(-vy, Math.max(0.1, vz)) * RAD

    const alphaEffDeg = rawAlphaDeg - cfg.incidenceDeg
    if (alphaEffDeg > maxAlphaDeg) maxAlphaDeg = alphaEffDeg

    // Evaluate airfoil section with dynamic brake rate and symmetrical flare coupling
    const symmetricBrake = Math.min(controls.leftBrake, controls.rightBrake)
    const foil = evaluateAirfoil(alphaEffDeg, brake, controls.speedBar, groundEffectMultiplier, wing.aspectRatio, brakeRate, symmetricBrake)

    // Induced drag from finite aspect ratio and tip vortices
    const indK = (1.0 / (Math.PI * wing.aspectRatio * 0.82)) * inducedDragReduction
    const cdInduced = indK * Math.pow(foil.cl, 2)
    const totalCd = foil.cd + cdInduced

    // Station area
    const stationArea = wing.projectedAreaSquareMeters * cfg.areaFrac

    // Aerodynamic Lift & Drag forces
    const liftMag = Math.max(0, foil.cl * qLocal * stationArea)
    const dragMag = totalCd * qLocal * stationArea

    // Drag acts parallel to -vLocal
    const dragDir = vNorm(vScale(vLocal, -1))

    // Lift acts perpendicular to vLocal along the panel normal direction (upper surface)
    const vNormLocal = vNorm(vLocal)
    const normProj = vDot(panelNormal, vNormLocal)
    const liftPerp = vSub(panelNormal, vScale(vNormLocal, normProj))
    const liftDir = vLen(liftPerp) > 1e-4 ? vNorm(liftPerp) : vNorm(panelNormal)

    const forceBody = vAdd(vScale(liftDir, liftMag), vScale(dragDir, dragMag))
    const momentBody = vAdd(vCross(rStation, forceBody), v3(foil.cm * qLocal * stationArea * cfg.chord, 0, 0))

    totalForceBody = vAdd(totalForceBody, forceBody)
    totalMomentBody = vAdd(totalMomentBody, momentBody)

    if (isLeft) {
      leftLift += liftMag
      leftDrag += dragMag
      leftAirspeedSum += vLocalLen
      if (foil.isStalled) leftStalledCount++
    } else {
      rightLift += liftMag
      rightDrag += dragMag
      rightAirspeedSum += vLocalLen
      if (foil.isStalled) rightStalledCount++
    }

    panelStates[cfg.station] = {
      liftNewtons: liftMag,
      dragNewtons: dragMag,
      forceBody,
      momentBody,
      alphaDeg: alphaEffDeg,
      airspeedMps: vLocalLen,
      isStalled: foil.isStalled,
      isCollapsed: foil.isStalled && brake > 0.85,
      separation: foil.separation,
    }
  }

  const isFullStall = leftStalledCount >= 2 && rightStalledCount >= 2
  const leftStalled = leftStalledCount >= 1
  const rightStalled = rightStalledCount >= 1

  let asymmetricStallSide: 'none' | 'left' | 'right' = 'none'
  if (!isFullStall) {
    if (leftStalled && !rightStalled) asymmetricStallSide = 'left'
    else if (rightStalled && !leftStalled) asymmetricStallSide = 'right'
  }

  // Stall warning: boundary layer buffeting starts at 11.0° AoA up to full breakaway at 15.0°
  const stallWarning = clamp((maxAlphaDeg - 11.0) / 4.0, 0, 1)

  // Physical brake tension force (Newtons) communicated to the pilot's hands:
  // F = mechanical line spring return + dynamic pressure against the deflected trailing edge flap
  // When flow separates (stall), aerodynamic pressure collapses, leaving only loose cloth weight!
  const flapArea = wing.projectedAreaSquareMeters * 0.16
  const leftAvgSpeed = leftAirspeedSum / 2
  const rightAvgSpeed = rightAirspeedSum / 2
  const qLeft = 0.5 * rho * leftAvgSpeed * leftAvgSpeed
  const qRight = 0.5 * rho * rightAvgSpeed * rightAvgSpeed

  const leftBrakeForceN = leftStalled
    ? 2.5 * controls.leftBrake // Stall breakaway: pressure collapses!
    : 12.0 * controls.leftBrake + qLeft * flapArea * 0.42 * Math.pow(controls.leftBrake, 1.3)

  const rightBrakeForceN = rightStalled
    ? 2.5 * controls.rightBrake // Stall breakaway: pressure collapses!
    : 12.0 * controls.rightBrake + qRight * flapArea * 0.42 * Math.pow(controls.rightBrake, 1.3)

  // Directional weathercock stability: swept canopy yaws to align with relative wind (Cn_beta)
  const sideslipBeta = Math.atan2(vAirBody.x, Math.max(1.0, vAirBody.z))
  const qDynamic = 0.5 * rho * (vAirBody.z * vAirBody.z + vAirBody.x * vAirBody.x)
  const weathercockYawMoment = -0.065 * qDynamic * wing.projectedAreaSquareMeters * wing.projectedSpanMeters * sideslipBeta

  // Authentic roll-into-turn coupling from asymmetric brake deflection:
  // Deflecting the inside trailing edge slows that wing and rolls the canopy into the carve (+Z is roll left)
  const brakeRollMoment = (controls.leftBrake - controls.rightBrake) * (0.045 * qDynamic * wing.projectedAreaSquareMeters * wing.projectedSpanMeters)
  totalMomentBody = vAdd(totalMomentBody, v3(0, weathercockYawMoment, brakeRollMoment))

  // Lateral crossflow drag & keel side force on arched ram-air canopy (CY_beta):
  // Prevents unphysical lateral sliding, keeping the wing tracking cleanly along its chord
  const sideForce = -0.55 * qDynamic * wing.projectedAreaSquareMeters * Math.sin(sideslipBeta)
  totalForceBody = vAdd(totalForceBody, v3(sideForce, 0, 0))

  return {
    totalForceBody,
    totalMomentBody,
    panelStates,
    leftLift,
    rightLift,
    leftDrag,
    rightDrag,
    isFullStall,
    asymmetricStallSide,
    leftBrakeForceN,
    rightBrakeForceN,
    stallWarning,
    leftStalled,
    rightStalled,
  }
}

