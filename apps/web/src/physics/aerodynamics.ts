import type { FlightControls } from './types'

export type WingGeometry = {
  spanMeters: number
  areaSquareMeters: number
  aspectRatio: number
  chordMeters: number
  tetherLengthMeters: number // line length to pilot (~5.3m)
  trimSpeedKmh: number
  minSpeedKmh: number
  maxSpeedKmh: number
  glideRatio: number // ~5.4:1
  massKg: number // ~8.5kg (canopy fabric + internal air mass)
  pilotMassKg: number // ~88kg pilot + harness + reserve
}

export const STANDARD_WING: WingGeometry = {
  spanMeters: 8.8, // 8.8m span for high-energy alpine speedwing
  areaSquareMeters: 17.5, // 17.5m² area
  aspectRatio: 4.42,
  chordMeters: 2.35,
  tetherLengthMeters: 5.3, // 5.3m authentic suspension lines
  trimSpeedKmh: 54.0, // 54 km/h (15.0 m/s) fast alpine trim
  minSpeedKmh: 28.0, // Clean stall threshold
  maxSpeedKmh: 130.0, // Real high-speed dive authority in steep alpine swoops
  glideRatio: 5.4, // Realistic speedwing glide ratio
  massKg: 8.5, // 4.2kg wing + 4.3kg internal cell air
  pilotMassKg: 88.0, // Heavy pilot with harness and reserve
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function getLiftCoefficient(alphaDeg: number): number {
  // Paraglider ram-air airfoil lift curve (peaks around 13-14° AoA, stalls past 17-18°)
  if (alphaDeg < -6) return 0
  if (alphaDeg <= 13) {
    return 0.32 + (alphaDeg + 6) * 0.056
  }
  if (alphaDeg <= 18) {
    return 1.38 - (alphaDeg - 13) * 0.10
  }
  // Deep post-stall residual lift
  return Math.max(0.18, 0.88 - (alphaDeg - 18) * 0.05)
}

export function getDragCoefficient(alphaDeg: number, brakeDeflection: number): number {
  // Base parasitic airfoil drag with quadratic brake drag penalty
  const baseCd = 0.048 + Math.pow(Math.max(0, alphaDeg - 4) * 0.055, 2)
  const brakeCd = brakeDeflection * 0.14 + Math.pow(brakeDeflection, 2) * 0.36
  return baseCd + brakeCd
}

export type AeroForces = {
  liftNewtons: number
  dragNewtons: number
  rollTorque: number
  pitchTorque: number
  yawTorque: number
  leftLiftNewtons: number
  rightLiftNewtons: number
  leftDragNewtons: number
  rightDragNewtons: number
  leftStall: boolean
  rightStall: boolean
  isFullStall: boolean
  asymmetricStallSide: 'none' | 'left' | 'right'
  isSpinning: boolean
  leftCollapse: number // 0 (inflated) to 1 (collapsed / tucked)
  rightCollapse: number
  flareLift: number
  groundEffectMultiplier: number
}

/**
 * First-Principles Aerodynamic Force Integration
 * Computes aerodynamics on left and right wing halves independently,
 * with ground-effect cushion, dynamic flare surge, and centrifugal line tension.
 */
export function computeAeroForces(
  airspeedKmh: number,
  alphaDeg: number,
  controls: FlightControls,
  heightAboveGroundMeters: number = 20,
  wing: WingGeometry = STANDARD_WING,
): AeroForces {
  const airDensity = 1.225 // kg/m^3
  const vMps = Math.max(0.5, airspeedKmh / 3.6)
  const dynamicPressure = 0.5 * airDensity * vMps * vMps

  const halfArea = wing.areaSquareMeters * 0.5 // 8.75 m² per wing half
  const halfSpan = wing.spanMeters * 0.5 // 4.4m half span
  const momentArm = halfSpan * 0.52 // Lateral center of pressure for each half

  // Ground Effect: When close to ground (h / b < 0.5), induced drag drops and effective lift increases
  const spanRatio = Math.max(0.05, heightAboveGroundMeters / wing.spanMeters)
  const groundEffectMultiplier = spanRatio < 0.6
    ? 1.0 + (0.6 - spanRatio) * 0.38 // Up to +23% lift boost right above ground
    : 1.0
  const inducedDragReduction = spanRatio < 0.6
    ? (16 * spanRatio * spanRatio) / (1 + 16 * spanRatio * spanRatio)
    : 1.0

  // 1. Effective Angle of Attack per wing half
  // Brakes pull down trailing edge, increasing camber and effective AoA
  const leftAoA = alphaDeg + controls.leftBrake * 10.5 - controls.speedBar * 4.2
  const rightAoA = alphaDeg + controls.rightBrake * 10.5 - controls.speedBar * 4.2

  // 2. Stall Detection per wing half
  const stallThresholdAoA = 17.5
  const leftStall = leftAoA > stallThresholdAoA && controls.leftBrake > 0.68
  const rightStall = rightAoA > stallThresholdAoA && controls.rightBrake > 0.68

  const isFullStall = leftStall && rightStall
  let asymmetricStallSide: 'none' | 'left' | 'right' = 'none'
  if (!isFullStall) {
    if (leftStall && !rightStall) asymmetricStallSide = 'left'
    else if (rightStall && !leftStall) asymmetricStallSide = 'right'
  }
  const isSpinning = asymmetricStallSide !== 'none'

  // 3. Lift Coefficients
  let leftCl = getLiftCoefficient(leftAoA) * groundEffectMultiplier
  let rightCl = getLiftCoefficient(rightAoA) * groundEffectMultiplier

  // Collapse / Deflation factors
  let leftCollapse = 0
  let rightCollapse = 0

  if (asymmetricStallSide === 'left') {
    leftCl *= 0.12 // 88% lift loss on stalled half
    leftCollapse = 0.95 // Left wing tucks back and curls
  } else if (asymmetricStallSide === 'right') {
    rightCl *= 0.12
    rightCollapse = 0.95
  } else if (isFullStall) {
    leftCl *= 0.15
    rightCl *= 0.15
    leftCollapse = 0.85
    rightCollapse = 0.85
  }

  // 4. Drag Coefficients
  let leftCd = getDragCoefficient(leftAoA, controls.leftBrake) * (0.6 + 0.4 * inducedDragReduction)
  let rightCd = getDragCoefficient(rightAoA, controls.rightBrake) * (0.6 + 0.4 * inducedDragReduction)

  if (asymmetricStallSide === 'left') {
    leftCd *= 2.8 // Massive separation drag on stalled side pulls yaw into spin
  } else if (asymmetricStallSide === 'right') {
    rightCd *= 2.8
  } else if (isFullStall) {
    leftCd *= 2.4
    rightCd *= 2.4
  }

  // 5. Force Integration
  const leftLift = dynamicPressure * halfArea * leftCl
  const rightLift = dynamicPressure * halfArea * rightCl
  const totalLift = leftLift + rightLift

  const leftDrag = dynamicPressure * halfArea * leftCd
  const rightDrag = dynamicPressure * halfArea * rightCd
  const totalDrag = leftDrag + rightDrag

  // 6. Torques about Wing Center of Pressure
  // Roll torque from differential lift
  const rollTorque = (rightLift - leftLift) * momentArm

  // Yaw torque from differential drag
  const yawTorque = (rightDrag - leftDrag) * momentArm

  // Pitch torque: Symmetric brake pulls create trailing edge drag torque
  const symmetricBrake = Math.min(controls.leftBrake, controls.rightBrake)
  const pitchTorque =
    (symmetricBrake * 360 - controls.speedBar * 280) * (dynamicPressure / 120)

  // Flare lift surge: Rapid symmetrical flare at high speed generates powerful upward surge
  const flareLift = symmetricBrake * totalLift * 0.42

  return {
    liftNewtons: totalLift + flareLift,
    dragNewtons: totalDrag,
    rollTorque,
    pitchTorque,
    yawTorque,
    leftLiftNewtons: leftLift,
    rightLiftNewtons: rightLift,
    leftDragNewtons: leftDrag,
    rightDragNewtons: rightDrag,
    leftStall,
    rightStall,
    isFullStall,
    asymmetricStallSide,
    isSpinning,
    leftCollapse,
    rightCollapse,
    flareLift,
    groundEffectMultiplier,
  }
}
