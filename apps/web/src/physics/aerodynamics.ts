import type { FlightControls } from './types'

export type WingGeometry = {
  spanMeters: number
  areaSquareMeters: number
  aspectRatio: number
  chordMeters: number
  tetherLengthMeters: number // line length to pilot (~6.6m)
  trimSpeedKmh: number
  minSpeedKmh: number
  maxSpeedKmh: number
  glideRatio: number // ~8.4:1
  massKg: number // ~9.8kg (canopy fabric + internal air mass)
  pilotMassKg: number // ~88kg pilot + harness + reserve
}

export const STANDARD_WING: WingGeometry = {
  spanMeters: 8.8, // 8.8m span for high-energy alpine speedwing
  areaSquareMeters: 17.5, // 17.5m² area
  aspectRatio: 4.42,
  chordMeters: 2.35,
  tetherLengthMeters: 5.3, // 5.3m authentic suspension lines
  trimSpeedKmh: 58.0, // 58 km/h (16.1 m/s) fast alpine trim
  minSpeedKmh: 32.0, // Clean stall threshold
  maxSpeedKmh: 105.0, // High-speed dive authority with speed bar
  glideRatio: 5.4, // Realistic speedwing glide ratio (steep descent matching mountain slope)
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
  const baseCd = 0.052 + Math.pow(Math.max(0, alphaDeg - 4) * 0.062, 2)
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
}

/**
 * First-Principles Aerodynamic Force Integration
 * Computes aerodynamics on left and right wing halves independently.
 * The canopy is the lifting body (21.0 m² area vs 0.45 m² pilot, 47:1 area ratio).
 */
export function computeAeroForces(
  airspeedKmh: number,
  alphaDeg: number,
  controls: FlightControls,
  wing: WingGeometry = STANDARD_WING,
): AeroForces {
  const airDensity = 1.225 // kg/m^3
  const vMps = Math.max(0.5, airspeedKmh / 3.6)
  const dynamicPressure = 0.5 * airDensity * vMps * vMps

  const halfArea = wing.areaSquareMeters * 0.5 // 10.5 m² per wing half
  const halfSpanArm = wing.spanMeters * 0.26 // ~2.55m moment arm to half-wing center of pressure

  // 1. Stall thresholds
  // At trim speed, critical stall brake travel is ~0.60.
  // At low airspeed (< 8.0 m/s), stall travel drops to ~0.46.
  const criticalBrake = vMps < 8.0 ? 0.46 : 0.60

  const leftBrakeRaw = controls.leftBrake
  const rightBrakeRaw = controls.rightBrake

  const leftStalled = leftBrakeRaw > criticalBrake
  const rightStalled = rightBrakeRaw > criticalBrake

  // Full Stall: When both brakes are buried simultaneously
  const isFullStall = leftBrakeRaw > 0.65 && rightBrakeRaw > 0.65

  // Asymmetric Stall: When one brake is pulled deeply while the other is significantly less pulled
  let asymmetricStallSide: 'none' | 'left' | 'right' = 'none'
  if (!isFullStall) {
    if (leftStalled && leftBrakeRaw - rightBrakeRaw > 0.22) {
      asymmetricStallSide = 'left'
    } else if (rightStalled && rightBrakeRaw - leftBrakeRaw > 0.22) {
      asymmetricStallSide = 'right'
    }
  }

  const isSpinning = asymmetricStallSide !== 'none'

  // Collapse factors: 0 = smooth inflated canopy, 1 = tucked/folded deflated cells
  let leftCollapse = 0
  let rightCollapse = 0

  if (isFullStall) {
    leftCollapse = 0.85
    rightCollapse = 0.85
  } else if (asymmetricStallSide === 'left') {
    leftCollapse = clamp((leftBrakeRaw - criticalBrake) / 0.25 + 0.35, 0.4, 1.0)
    rightCollapse = 0.0
  } else if (asymmetricStallSide === 'right') {
    leftCollapse = 0.0
    rightCollapse = clamp((rightBrakeRaw - criticalBrake) / 0.25 + 0.35, 0.4, 1.0)
  }

  // 2. Compute Left Wing Half Aerodynamics
  const leftEffectiveAlpha = alphaDeg + leftBrakeRaw * 8.0 - controls.speedBar * 6.5
  let cL_Left = getLiftCoefficient(leftEffectiveAlpha)
  let cD_Left = getDragCoefficient(leftEffectiveAlpha, leftBrakeRaw)

  // 3. Compute Right Wing Half Aerodynamics
  const rightEffectiveAlpha = alphaDeg + rightBrakeRaw * 8.0 - controls.speedBar * 6.5
  let cL_Right = getLiftCoefficient(rightEffectiveAlpha)
  let cD_Right = getDragCoefficient(rightEffectiveAlpha, rightBrakeRaw)

  // Speed bar profile drag reduction
  if (controls.speedBar > 0) {
    const sbFactor = 1.0 - controls.speedBar * 0.26
    cD_Left *= sbFactor
    cD_Right *= sbFactor
  }

  // Induced drag per half: C_di = C_L^2 / (pi * AR * e)
  const oswaldE = 0.72
  const inducedLeft = (cL_Left * cL_Left) / (Math.PI * wing.aspectRatio * oswaldE)
  const inducedRight = (cL_Right * cL_Right) / (Math.PI * wing.aspectRatio * oswaldE)
  cD_Left += inducedLeft
  cD_Right += inducedRight

  // Apply stall degradations
  if (isFullStall) {
    // Airflow detaches over entire wing: 88% lift drop, pure bluff body drag
    cL_Left *= 0.12
    cL_Right *= 0.12
    cD_Left = 0.82
    cD_Right = 0.82
  } else {
    if (asymmetricStallSide === 'left') {
      // Left wing airflow separates & collapses: 85% lift drop, high separated wake drag
      cL_Left *= 0.15
      cD_Left = 0.76
    } else if (asymmetricStallSide === 'right') {
      cL_Right *= 0.15
      cD_Right = 0.76
    }
  }

  // Aerodynamic Forces per half
  const leftLiftNewtons = dynamicPressure * halfArea * cL_Left
  const rightLiftNewtons = dynamicPressure * halfArea * cL_Right
  const leftDragNewtons = dynamicPressure * halfArea * cD_Left
  const rightDragNewtons = dynamicPressure * halfArea * cD_Right

  const totalLift = leftLiftNewtons + rightLiftNewtons
  const totalDrag = leftDragNewtons + rightDragNewtons

  // 4. Moments & Torques (The Wing Leads!)
  // Differential drag produces yaw torque on the wing:
  // Left brake pulled (Left drag > Right drag) -> Yaws left (negative yaw).
  // Right brake pulled (Right drag > Left drag) -> Yaws right (positive yaw).
  const yawFromDifferentialDrag = (rightDragNewtons - leftDragNewtons) * halfSpanArm

  // Yaw-Roll Coupling (Paraglider Dihedral & Sweep Aerodynamics):
  // When the wing yaws left, the advancing right wing moves faster through the air,
  // generating higher dynamic pressure and dihedral lift that banks the canopy INTO the turn!
  // Negative yaw -> Left bank (negative roll). Positive yaw -> Right bank (positive roll).
  const rollFromYawCoupling = (yawFromDifferentialDrag / halfSpanArm) * 0.45 * dynamicPressure * 0.12
  const weightShiftTorque = controls.weightShift * 38.0

  let rollTorque = rollFromYawCoupling + weightShiftTorque
  let yawTorque = yawFromDifferentialDrag

  if (asymmetricStallSide === 'left') {
    // Left side stalled: Outside right wing is charging forward while left is halted in massive drag!
    // Creates a violent negative flat spin towards the stalled side (left = negative yaw)
    yawTorque = -4800.0
    rollTorque = -950.0 // canopy banks toward the collapsed side
  } else if (asymmetricStallSide === 'right') {
    yawTorque = 4800.0
    rollTorque = 950.0
  }

  // 5. Pitch torque
  const symmetricPitchBrake = Math.min(leftBrakeRaw, rightBrakeRaw)
  let pitchTorque = (symmetricPitchBrake * 1.4 - controls.speedBar * 1.6) * 980.0
  if (isFullStall) {
    pitchTorque = 1550.0 // Wing falls backward behind pilot in full stall
  }

  // 6. Flare effect: Dynamic brake flare converts kinetic airspeed into upward cushion
  const flarePullRate = Math.max(0, (controls.leftBrakeRate + controls.rightBrakeRate) * 0.5)
  const symmetricBrake = (leftBrakeRaw + rightBrakeRaw) * 0.5
  const flareLift =
    !isFullStall && !isSpinning && symmetricBrake > 0.35
      ? symmetricBrake * flarePullRate * dynamicPressure * 18.0
      : 0

  return {
    liftNewtons: totalLift,
    dragNewtons: totalDrag,
    rollTorque,
    pitchTorque,
    yawTorque,
    leftLiftNewtons,
    rightLiftNewtons,
    leftDragNewtons,
    rightDragNewtons,
    leftStall: leftStalled,
    rightStall: rightStalled,
    isFullStall,
    asymmetricStallSide,
    isSpinning,
    leftCollapse,
    rightCollapse,
    flareLift,
  }
}
