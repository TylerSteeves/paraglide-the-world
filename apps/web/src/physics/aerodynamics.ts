/**
 * Ram-air canopy aerodynamics, calibrated against published certification data.
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS
 * ---------------------------------------------------------------------------
 * Canopy body frame:  +x = right wingtip, +y = up through the lines, +z = forward
 *                     along the root chord. (x cross y = z.)
 * Moment vector:      +x = pitch nose-down, +y = yaw right, +z = roll left.
 * Air velocity:       `vAirBody` is the velocity of the canopy THROUGH the air
 *                     expressed in body frame, so straight-and-level flight is
 *                     roughly (0, -sink, +airspeed) and
 *                     alpha = atan2(-v_y, v_z) is positive nose-up.
 *
 * ---------------------------------------------------------------------------
 * REFERENCE AREA
 * ---------------------------------------------------------------------------
 * All coefficients here are referenced to FLAT (developed) area. The canopy's
 * arc is carried explicitly by tilting each panel's normal, so the loss of
 * vertical lift from the arc emerges from the geometry instead of being baked
 * into a projected-area coefficient. Projected area and span are therefore
 * derived quantities (see `measureProjectedGeometry`) rather than free
 * parameters, and the validation suite asserts they land on the real wing's
 * published numbers.
 *
 * ---------------------------------------------------------------------------
 * CALIBRATION (PARAGLIDER_XC_24M, 95 kg pilot, sea level)
 * ---------------------------------------------------------------------------
 * Drag budget at trim (V = 10.70 m/s, q = 70.1 Pa, W = 981 N, target 9.3:1):
 *   induced   Cl^2/(pi*AR*e) = 0.0331  ->  55.7 N
 *   profile   cd0            = 0.0206  ->  34.7 N
 *   pilot     0.18 m^2                 ->  12.6 N
 *   lines     0.035 m^2                ->   2.5 N
 *                                total   105.5 N  =>  L/D 9.30, sink 1.15 m/s
 *
 * The same constants then reproduce, without further tuning:
 *   min sink   ~1.04 m/s at ~30 km/h   (real EN-B: 1.0-1.1 m/s at 30-33 km/h)
 *   best glide ~9.3:1 at trim          (DHV: best glide at trim, brakes off)
 *   full bar   ~54 km/h at ~2.8 m/s    (real EN-B: 50-55 km/h, 2.5-3.2 m/s)
 *   min speed  ~24.5 km/h at full brake (real EN-B: 23-25 km/h)
 *   full stall ~7.5 m/s descent         (real: 8-10 m/s)
 *
 * Sources for the performance targets are listed in
 * `docs/flight-dynamics-validation.md`.
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
} from './vecmath.ts'
import type { FlightControls } from './types.ts'

// ---------------------------------------------------------------------------
// Wing geometry
// ---------------------------------------------------------------------------

export type WingGeometry = {
  name: string

  /** Flat (developed) area, the number manufacturers print. m^2 */
  flatAreaM2: number
  /** Flat (developed) span, tip to tip along the canopy. m */
  flatSpanM: number
  /** Root chord. Panel chords taper from this. m */
  rootChordM: number
  /** Local dihedral of the wingtip relative to the root, degrees. Sets the arc. */
  arcTipAngleDeg: number
  /** Geometric twist: how much less incidence the tip carries than the root, degrees. */
  washoutDeg: number

  // --- Line geometry: this is what actually sets trim, not a fudge factor. ---
  /** Vertical drop from the canopy down to the carabiners in flight. m */
  lineLengthM: number
  /** Half the carabiner separation. m */
  riserHalfWidthM: number
  /** Chordwise station of the A-line (fore) attachment, fraction of chord from LE. */
  foreAttachChordFrac: number
  /** Chordwise station of the C/D-line (aft) attachment, fraction of chord from LE. */
  aftAttachChordFrac: number
  /**
   * Chord incidence, nose-up positive, when the risers hang vertically.
   * Trim angle of attack = this + glide angle, so it is small on a real wing.
   */
  trimIncidenceDeg: number
  /** Angle of attack removed by full speed bar, via shortening the A risers. deg */
  speedBarAngleDeg: number
  /** Angle of attack added by full rear-riser (C) input. deg */
  rearRiserAngleDeg: number
  /** Trailing-edge deflection at full brake travel. deg */
  fullBrakeDeflectionDeg: number

  // --- Masses ---
  /** Canopy fabric, lines and risers. kg */
  canopyMassKg: number
  /** Air enclosed by the inflated cells, which moves with the canopy. kg */
  enclosedAirKg: number
  /** Default pilot + harness + reserve (+ motor unit for a paramotor). kg */
  pilotMassKg: number
  /** Lateral travel of the pilot's centre of mass at full weight shift. m */
  weightShiftMeters: number

  // --- Parasite drag areas (Cd * A, absolute m^2) ---
  pilotDragAreaM2: number
  lineDragAreaM2: number

  // --- Section polar ---
  /** Profile drag coefficient at low alpha, on flat area. */
  profileCd0: number
  /** Span efficiency for the induced-drag term. */
  spanEfficiency: number
  /** Zero-lift angle of attack of the clean section. deg */
  zeroLiftAlphaDeg: number
  /** Max attached Cl with brakes off. */
  clMaxClean: number
  /**
   * Extra Cl_max available at full brake.
   *
   * Set against the zero-lift shift the same deflection produces, this is what
   * decides how far the stall angle falls as brake goes on. Both ends matter.
   * Too little and the stall angle collapses faster than the wing slows down,
   * so the wing lets go at half brake travel. Too much and the stall angle
   * stops falling at all -- the wing then only ever stalls symmetrically, from
   * the glide steepening, and deep brake on one side can no longer stall that
   * side, which removes spins from the model entirely.
   *
   * Calibrated so full travel costs about four degrees of stall angle, which
   * puts the symmetric stall near the end of the brake range and still lets an
   * asymmetric input drop a wing.
   */
  clMaxBrakeGain: number
  /** Quarter-chord pitching moment, standard sign (negative = nose-down). */
  cm0: number

  // --- Powered wings ---
  hasMotor?: boolean
  maxThrustNewtons?: number
  /** Reflex profiles hold a nose-up moment at low alpha; 0 for a normal wing. */
  reflexCm?: number

  // --- Published performance, used by the HUD and asserted by the tests ---
  trimSpeedKmh: number
  minSpeedKmh: number
  maxSpeedKmh: number
  glideRatio: number
}

/**
 * Modern EN-B cross-country wing, 24 m^2 flat.
 * Performance envelope matches a mainstream EN-B at ~100 kg all-up.
 */
export const PARAGLIDER_XC_24M: WingGeometry = {
  name: 'XC 24',
  flatAreaM2: 24.0,
  flatSpanM: 11.3,
  rootChordM: 2.5,
  arcTipAngleDeg: 62.0,
  washoutDeg: 3.0,

  lineLengthM: 7.0,
  riserHalfWidthM: 0.23,
  foreAttachChordFrac: 0.09,
  aftAttachChordFrac: 0.76,
  trimIncidenceDeg: 0.4,
  speedBarAngleDeg: 5.5,
  rearRiserAngleDeg: 3.0,
  fullBrakeDeflectionDeg: 38.0,

  canopyMassKg: 5.4,
  enclosedAirKg: 8.2,
  pilotMassKg: 95.0,
  weightShiftMeters: 0.14,

  pilotDragAreaM2: 0.18,
  lineDragAreaM2: 0.035,

  profileCd0: 0.0206,
  spanEfficiency: 0.85,
  zeroLiftAlphaDeg: -2.5,
  clMaxClean: 1.45,
  clMaxBrakeGain: 0.56,
  cm0: -0.095,

  trimSpeedKmh: 38.5,
  minSpeedKmh: 24.5,
  maxSpeedKmh: 54.0,
  glideRatio: 9.3,
}

/**
 * Miniwing / speedwing, 14 m^2 flat.
 * Speeds follow the SuSi 2 size-14 figures at 105 kg: trim 51, max 66 km/h.
 * Steeper dives reach well past that, but they do so by trading height for
 * speed rather than by raising a scripted top-speed number.
 */
export const SPEEDWING_14M: WingGeometry = {
  name: 'Speedwing 14',
  flatAreaM2: 14.0,
  flatSpanM: 7.4,
  rootChordM: 2.22,
  arcTipAngleDeg: 56.0,
  washoutDeg: 2.5,

  lineLengthM: 5.0,
  riserHalfWidthM: 0.21,
  foreAttachChordFrac: 0.10,
  aftAttachChordFrac: 0.74,
  trimIncidenceDeg: -0.6,
  speedBarAngleDeg: 6.5,
  rearRiserAngleDeg: 2.5,
  fullBrakeDeflectionDeg: 34.0,

  canopyMassKg: 3.4,
  enclosedAirKg: 3.6,
  pilotMassKg: 97.0,
  weightShiftMeters: 0.16,

  pilotDragAreaM2: 0.30,
  lineDragAreaM2: 0.030,

  profileCd0: 0.0300,
  spanEfficiency: 0.82,
  zeroLiftAlphaDeg: -2.2,
  clMaxClean: 1.34,
  clMaxBrakeGain: 0.52,
  cm0: -0.085,

  trimSpeedKmh: 51.0,
  minSpeedKmh: 33.0,
  maxSpeedKmh: 66.0,
  glideRatio: 6.0,
}

/** Reflex freeride paramotor wing, 18 m^2 flat, with a ~27 kg motor unit. */
export const PARAMOTOR_FREERIDE_18M: WingGeometry = {
  name: 'Freeride 18',
  flatAreaM2: 18.0,
  flatSpanM: 9.3,
  rootChordM: 2.28,
  arcTipAngleDeg: 54.0,
  washoutDeg: 3.0,

  lineLengthM: 6.3,
  riserHalfWidthM: 0.24,
  foreAttachChordFrac: 0.09,
  aftAttachChordFrac: 0.78,
  trimIncidenceDeg: -0.2,
  speedBarAngleDeg: 6.0,
  rearRiserAngleDeg: 2.5,
  fullBrakeDeflectionDeg: 36.0,

  canopyMassKg: 5.0,
  enclosedAirKg: 6.0,
  pilotMassKg: 122.0,
  weightShiftMeters: 0.12,

  pilotDragAreaM2: 0.50,
  lineDragAreaM2: 0.055,

  profileCd0: 0.0250,
  spanEfficiency: 0.83,
  zeroLiftAlphaDeg: -2.6,
  clMaxClean: 1.40,
  clMaxBrakeGain: 0.54,
  cm0: -0.070,

  hasMotor: true,
  maxThrustNewtons: 780.0,
  reflexCm: 0.030,

  trimSpeedKmh: 50.0,
  minSpeedKmh: 30.0,
  maxSpeedKmh: 68.0,
  glideRatio: 7.0,
}

export const STANDARD_WING: WingGeometry = PARAGLIDER_XC_24M

// ---------------------------------------------------------------------------
// Atmosphere
// ---------------------------------------------------------------------------

export const AIR_DENSITY_SEA_LEVEL = 1.225

/** ISA density below the tropopause. */
export function airDensityAt(altitudeMeters: number): number {
  const t = 1 - 2.2558e-5 * Math.max(0, altitudeMeters)
  return AIR_DENSITY_SEA_LEVEL * Math.pow(t, 4.2559)
}

// ---------------------------------------------------------------------------
// Spanwise discretization
// ---------------------------------------------------------------------------

export const PANEL_COUNT = 8

export type Panel = {
  /** Spanwise station centre, -1 at the left tip to +1 at the right tip. */
  eta: number
  /** Fraction of flat area carried by this panel. */
  areaFrac: number
  /** Panel area. m^2 */
  areaM2: number
  /** Panel chord. m */
  chordM: number
  /** Quarter-chord position in body frame. m */
  positionBody: V3
  /** Outward unit normal, tilted by the local arc. */
  normalBody: V3
  /** Chordwise unit vector, tilted by washout. */
  chordBody: V3
  /** Local dihedral from the arc. deg */
  arcDeg: number
  /** Geometric incidence relative to the root chord (negative at the tips). deg */
  twistDeg: number
  /** How strongly brake travel deflects this panel's trailing edge. */
  brakeGain: number
  /** How strongly a big-ears input folds this panel. */
  earGain: number
  isLeft: boolean
}

/**
 * Builds the spanwise panel set. Chord tapers elliptically, the arc grows
 * slightly faster than linearly toward the tips, the tips carry washout, and
 * brake authority is concentrated outboard the way a real brake line fan is.
 */
export function buildPanels(wing: WingGeometry): Panel[] {
  const halfSpan = wing.flatSpanM * 0.5
  const dEta = 2 / PANEL_COUNT

  const raw: { eta: number; chord: number }[] = []
  for (let i = 0; i < PANEL_COUNT; i++) {
    const eta = -1 + dEta * (i + 0.5)
    raw.push({ eta, chord: wing.rootChordM * (1 - 0.45 * eta * eta) })
  }
  const chordSum = raw.reduce((acc, p) => acc + p.chord, 0)

  return raw.map((p) => {
    const absEta = Math.abs(p.eta)
    const areaFrac = p.chord / chordSum
    const areaM2 = wing.flatAreaM2 * areaFrac

    // Arc: local dihedral grows slightly faster than linearly out to the tip.
    const arcDeg = wing.arcTipAngleDeg * Math.pow(absEta, 1.15) * Math.sign(p.eta)
    const arcRad = arcDeg * DEG

    // Panel sits out along the arc, so the tips hang below the root.
    // Integrating the arc angle along the span gives the tip's drop.
    const spanwise = halfSpan * p.eta
    const drop = -halfSpan * absEta * (1 - Math.cos(arcRad)) * 0.65

    // Washout reduces tip incidence, which keeps the tips flying when the
    // root is near the stall. This is what stops a well-behaved wing from
    // dropping a tip and spinning the moment you load the brakes.
    const twistDeg = -wing.washoutDeg * absEta * absEta

    const twistRad = twistDeg * DEG
    // Chord direction tilts with washout about the panel's spanwise axis.
    const chordBody = vNorm(v3(0, Math.sin(twistRad) * Math.cos(arcRad), Math.cos(twistRad)))
    // Normal tilts outboard with the arc, then by washout.
    const normalBody = vNorm(
      v3(
        Math.sin(arcRad),
        Math.cos(arcRad) * Math.cos(twistRad),
        -Math.sin(twistRad),
      ),
    )

    return {
      eta: p.eta,
      areaFrac,
      areaM2,
      chordM: p.chord,
      positionBody: v3(spanwise * Math.cos(arcRad * 0.5), drop, 0),
      normalBody,
      chordBody,
      arcDeg,
      twistDeg,
      // Brakes barely move the centre cells and pull the tips hard.
      brakeGain: clamp(0.15 + 1.5 * Math.pow(absEta, 1.4), 0, 1.6),
      // Big ears fold the outermost sixth or so of each half-span.
      earGain: absEta > 0.81 ? clamp((absEta - 0.81) / 0.12, 0, 1) : 0,
      isLeft: p.eta < 0,
    }
  })
}

export type ProjectedGeometry = {
  projectedAreaM2: number
  projectedSpanM: number
  flatAspectRatio: number
  projectedAspectRatio: number
}

/**
 * Projected area and span implied by the arc. These are derived, not declared,
 * so the geometry cannot quietly disagree with the real wing's spec sheet.
 */
export function measureProjectedGeometry(
  wing: WingGeometry,
  panels: Panel[] = buildPanels(wing),
): ProjectedGeometry {
  let projectedAreaM2 = 0
  let projectedSpanM = 0
  for (const panel of panels) {
    const cosArc = Math.cos(panel.arcDeg * DEG)
    projectedAreaM2 += panel.areaM2 * cosArc
    projectedSpanM += (wing.flatSpanM / PANEL_COUNT) * cosArc
  }
  return {
    projectedAreaM2,
    projectedSpanM,
    flatAspectRatio: (wing.flatSpanM * wing.flatSpanM) / wing.flatAreaM2,
    projectedAspectRatio: (projectedSpanM * projectedSpanM) / projectedAreaM2,
  }
}

// ---------------------------------------------------------------------------
// Apparent mass
// ---------------------------------------------------------------------------

/**
 * Added mass and inertia of the air the canopy drags with it.
 *
 * A 24 m^2 canopy is only ~13 kg of fabric and trapped air but entrains tens
 * of kilograms of outside air in heave. Including it is what makes the canopy
 * feel heavy and slow in pitch rather than snapping around like a rigid plate.
 * Coefficients follow the ram-air parachute form of Lissaman & Tuckerman.
 */
export type ApparentMass = {
  surgeKg: number
  swayKg: number
  heaveKg: number
  rollKgM2: number
  pitchKgM2: number
  yawKgM2: number
}

export function computeApparentMass(rho: number, wing: WingGeometry): ApparentMass {
  const projected = measureProjectedGeometry(wing)
  const b = projected.projectedSpanM
  const c = wing.flatAreaM2 / wing.flatSpanM // mean chord
  const t = c * 0.12 // section thickness

  const heave = 0.85 * rho * (Math.PI / 4) * c * c * b
  return {
    surgeKg: 0.12 * rho * (Math.PI / 4) * t * t * b,
    swayKg: 0.35 * heave,
    heaveKg: heave,
    rollKgM2: 0.055 * rho * (Math.PI / 48) * c * c * b * b * b,
    pitchKgM2: 0.80 * rho * (Math.PI / 48) * c * c * c * c * b,
    yawKgM2: 0.030 * rho * (Math.PI / 48) * t * t * b * b * b,
  }
}

// ---------------------------------------------------------------------------
// Section polar
// ---------------------------------------------------------------------------

/** Finite-wing lift-curve slope per degree, Helmbold form. */
export function liftCurveSlopePerDeg(wing: WingGeometry): number {
  const ar = (wing.flatSpanM * wing.flatSpanM) / wing.flatAreaM2
  const a0 = 2 * Math.PI * DEG // per degree, thin-airfoil
  return a0 / (1 + (RAD * a0) / (Math.PI * wing.spanEfficiency * ar))
}

/**
 * Everything about a wing that only needs computing once: the panel set, the
 * derived projected geometry and the lift-curve slope. Built at wing-change
 * time and reused every substep.
 */
export type WingModel = {
  wing: WingGeometry
  panels: Panel[]
  projected: ProjectedGeometry
  clAlphaPerDeg: number
  /** 1/(pi * AR * e), the induced-drag factor in still air. */
  inducedK: number
  meanChordM: number
}

export function createWingModel(wing: WingGeometry): WingModel {
  const panels = buildPanels(wing)
  const projected = measureProjectedGeometry(wing, panels)
  return {
    wing,
    panels,
    projected,
    clAlphaPerDeg: liftCurveSlopePerDeg(wing),
    inducedK: 1 / (Math.PI * projected.flatAspectRatio * wing.spanEfficiency),
    meanChordM: wing.flatAreaM2 / wing.flatSpanM,
  }
}

export type SectionState = {
  /** Separated flow on this panel. Latches until alpha drops well back. */
  separated: boolean
}

export function createSectionStates(): SectionState[] {
  return Array.from({ length: PANEL_COUNT }, () => ({ separated: false }))
}

export type SectionResult = {
  cl: number
  cd: number
  /** Quarter-chord pitching moment, standard sign (negative = nose-down). */
  cm: number
  /** 0 = fully attached, 1 = fully separated. */
  separation: number
  stalled: boolean
  /** How close to the stall, 0 at trim to 1 at the break. Drives the HUD cue. */
  stallMargin: number
}

/**
 * Section lift, drag and moment with a real stall.
 *
 * Brake travel is treated as a plain flap on the rear of the chord: it shifts
 * the zero-lift angle down (more camber, more lift at a given alpha), raises
 * Cl_max, and lowers the stall angle. That combination is why burying the
 * brakes both slows the wing and eventually stalls it.
 *
 * Separation latches: once a panel has broken away it will not reattach until
 * alpha falls `REATTACH_HYSTERESIS_DEG` below the stall angle. That hysteresis
 * is what makes a parachutal or deep stall something you have to fly out of,
 * rather than something that fixes itself the instant alpha wobbles back.
 */
const REATTACH_HYSTERESIS_DEG = 2.0

export function evaluateSection(
  alphaDeg: number,
  brakeFrac: number,
  speedBarFrac: number,
  wing: WingGeometry,
  clAlphaPerDeg: number,
  state: SectionState,
  suppressSeparation = false,
): SectionResult {
  const alpha = wrapDeg180(alphaDeg)
  const brake = clamp(brakeFrac, 0, 1)

  // Trailing-edge deflection from brake travel, as an equivalent plain flap.
  const flapDeg = brake * wing.fullBrakeDeflectionDeg
  const zeroLift = wing.zeroLiftAlphaDeg - 0.30 * flapDeg

  const clMax = wing.clMaxClean + wing.clMaxBrakeGain * brake - 0.10 * speedBarFrac
  const alphaStall = zeroLift + clMax / clAlphaPerDeg

  const clAttached = clAlphaPerDeg * (alpha - zeroLift)

  // Separation state with hysteresis. While the canopy is re-pressurising
  // after a stall the flow is held attached regardless of angle of attack;
  // see `updatePressureRecovery` for why.
  if (suppressSeparation) {
    state.separated = false
  } else if (state.separated) {
    if (alpha < alphaStall - REATTACH_HYSTERESIS_DEG) state.separated = false
  } else if (alpha > alphaStall) {
    state.separated = true
  }

  let cl: number
  let separation: number

  if (!state.separated) {
    // Attached flow can never exceed the section's maximum, by definition.
    // Without this cap any excursion to a high angle of attack while the flow
    // is held attached returns a lift coefficient of several times anything
    // physical, which tears the integrator apart.
    cl = clamp(clAttached, -clMax, clMax)
    separation = 0
  } else {
    // Past the break Cl collapses over ~8 degrees toward a flat-plate value.
    const over = alpha - alphaStall
    separation = clamp(over / 8, 0, 1)
    const plateCl = 0.9 * Math.sin(2 * alpha * DEG)
    cl = clMax * (1 - 0.45 * separation) * (1 - separation) + plateCl * separation
  }

  // Negative alpha: the leading edge loses pressure and the cells start to
  // fold. Lift falls away and drag climbs, which is the front-collapse regime.
  if (alpha < -4) {
    const tuck = clamp((-4 - alpha) / 8, 0, 1)
    cl *= 1 - 0.85 * tuck
    separation = Math.max(separation, tuck)
  }

  // Drag: profile + alpha growth + flap drag + accelerated-profile penalty.
  const profile =
    wing.profileCd0 +
    0.00022 * Math.pow(alpha - 4, 2) +
    0.010 * brake +
    0.030 * brake * brake +
    0.006 * speedBarFrac +
    0.012 * speedBarFrac * speedBarFrac
  // Drag of a separated canopy depends strongly on where the trailing edge is.
  //
  // With the brakes buried, the trailing edge is hauled down into the flow and
  // the canopy is close to a flat plate. Let the brakes up and even a stalled
  // canopy is a far cleaner shape. That difference is what ends a stall: on
  // release the drag roughly halves, the wing accelerates forward and down,
  // the angle of attack falls, and the flow reattaches with a surge. Hold the
  // separated drag constant instead and releasing the brakes changes nothing,
  // so the wing stays a parachute and descends until it lands.
  const separatedCd = 0.65 + 0.90 * brake
  const cd = profile * (1 - separation) + separatedCd * separation

  // Once the flow separates, the centre of pressure walks aft from the quarter
  // chord toward mid-chord. Since the lines attach ahead of mid-chord, that
  // puts a nose-down moment on the canopy -- and that moment is what lets a
  // deep stall end. Without it a fully stalled wing descends vertically for
  // ever, because with no forward speed there is nothing to bring the angle of
  // attack back down.
  const cpShift = -0.25 * separation * Math.hypot(cl, cd)

  const reflex = wing.reflexCm ? wing.reflexCm * (1 - clamp(alpha / 12, 0, 1)) : 0
  // Control-line hinge moments are carried by the control lines, not by the
  // risers.
  //
  // Pulling a brake deflects the trailing edge, and the hinge moment that
  // creates goes straight up the brake line to the pilot's hand -- which is
  // exactly why the brakes go heavy. Pushing the bar shortens the A risers,
  // and the pilot's legs hold that load through the pulleys. Neither moment
  // reaches the canopy's own pitch balance at anything like its
  // two-dimensional value, so only a small residual belongs here.
  //
  // Getting this wrong is not a subtle tuning matter. Feed the full flap
  // moment in and the line truss has to carry it as a differential between
  // the fore and aft rows; because both rows run to the same carabiner, that
  // differential drags the risers off vertical by several degrees, which
  // cancels the control input almost exactly. Pulling brake then dives the
  // wing instead of slowing it, and the speed bar does nothing at all.
  const cm = wing.cm0 - 0.0015 * flapDeg + 0.012 * speedBarFrac + reflex + cpShift

  return {
    cl,
    cd,
    cm,
    separation,
    stalled: state.separated,
    stallMargin: clamp(1 - (alphaStall - alpha) / 10, 0, 1),
  }
}

// ---------------------------------------------------------------------------
// Whole-canopy aerodynamics
// ---------------------------------------------------------------------------

export type PanelState = {
  alphaDeg: number
  cl: number
  cd: number
  liftN: number
  dragN: number
  airspeedMps: number
  separation: number
  /** 0 = inflated, 1 = fully collapsed (folded under, no lift). */
  collapse: number
}

export type WingAeroResult = {
  /** Total aerodynamic force on the canopy, body frame. N */
  forceBody: V3
  /** Total aerodynamic moment about the canopy origin, body frame. N*m */
  momentBody: V3
  panels: PanelState[]
  leftLiftN: number
  rightLiftN: number
  /** Worst stall margin across the span, 0 clear to 1 at the break. */
  stallWarning: number
  leftSeparated: boolean
  rightSeparated: boolean
  /** Mean angle of attack weighted by panel area. deg */
  meanAlphaDeg: number
  /** Brake line tension felt at the pilot's hands. N */
  leftBrakeForceN: number
  rightBrakeForceN: number
}

export type WingAeroInput = {
  /** Canopy velocity through the air, body frame. m/s */
  vAirBody: V3
  /** Canopy angular velocity, body frame. rad/s */
  omegaBody: V3
  controls: FlightControls
  rho: number
  model: WingModel
  sectionStates: SectionState[]
  /** Per-panel collapse fraction, 0 inflated to 1 folded. */
  collapse: number[]
  /** Height of the canopy above the terrain, for ground effect. m */
  groundClearanceM: number
  /** Per-panel vertical gust, body-frame up component. m/s */
  panelGustMps?: number[]
  /** Hold the flow attached while the canopy re-pressurises after a stall. */
  suppressSeparation?: boolean
}

/**
 * Evaluates the canopy panel by panel.
 *
 * Each panel sees the local flow including the rotation term `omega x r`, which
 * is where roll, pitch and yaw damping come from: no artificial damping
 * coefficients are needed. The arc means a sideslip raises alpha on one side
 * and lowers it on the other, which produces a paraglider's characteristic
 * roll-yaw coupling and its spiral tendency as a consequence of the shape.
 */
export function evaluateWingAero(input: WingAeroInput): WingAeroResult {
  const { vAirBody, omegaBody, controls, rho, model, sectionStates, collapse } = input
  const { wing, panels, projected } = model
  const clAlpha = model.clAlphaPerDeg

  const leftBrake = clamp(controls.leftBrake, 0, 1)
  const rightBrake = clamp(controls.rightBrake, 0, 1)
  // Speed bar and A-riser pull are the same physical input; take the larger
  // rather than summing them, which would double-count a single pilot action.
  const speedBar = clamp(Math.max(controls.speedBar ?? 0, controls.pullingA ?? 0), 0, 1)
  const bStall = clamp(controls.pullingB ?? 0, 0, 1)
  const earsLeft = clamp(controls.earsLeft ?? 0, 0, 1)
  const earsRight = clamp(controls.earsRight ?? 0, 0, 1)

  // Ground effect: the mirrored vortex system cuts induced drag near the deck
  // and adds a little lift. Referenced to projected span.
  const hRatio = Math.max(0.04, input.groundClearanceM / projected.projectedSpanM)
  const groundLiftGain = hRatio < 0.5 ? 1 + (0.5 - hRatio) * 0.30 : 1
  const groundInducedFactor =
    hRatio < 0.5 ? (16 * hRatio * hRatio) / (1 + 16 * hRatio * hRatio) : 1

  const inducedK = groundInducedFactor * model.inducedK

  let forceBody = v3()
  let momentBody = v3()
  let leftLiftN = 0
  let rightLiftN = 0
  let stallWarning = 0
  let leftSeparated = false
  let rightSeparated = false
  let alphaAreaSum = 0
  let areaSum = 0
  let leftFlapQ = 0
  let rightFlapQ = 0
  let leftFlapCount = 0
  let rightFlapCount = 0

  const panelStates: PanelState[] = []

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i]
    const brakeRaw = panel.isLeft ? leftBrake : rightBrake
    const brake = clamp(brakeRaw * panel.brakeGain, 0, 1)
    const ear = panel.earGain * (panel.isLeft ? earsLeft : earsRight)
    const panelCollapse = clamp(Math.max(collapse[i] ?? 0, ear), 0, 1)

    // Local flow: translation plus the rotation of this station about the origin.
    let vLocal = vAdd(vAirBody, vCross(omegaBody, panel.positionBody))
    const gust = input.panelGustMps?.[i]
    if (gust) vLocal = vAdd(vLocal, v3(0, -gust, 0))

    const speed = vLen(vLocal)
    if (speed < 0.5) {
      panelStates.push({
        alphaDeg: 0,
        cl: 0,
        cd: 0,
        liftN: 0,
        dragN: 0,
        airspeedMps: speed,
        separation: 0,
        collapse: panelCollapse,
      })
      continue
    }

    const q = 0.5 * rho * speed * speed
    const vHat = vScale(vLocal, 1 / speed)

    // Angle of attack in the panel's own chordwise plane.
    const vNormal = vDot(vLocal, panel.normalBody)
    const vChord = vDot(vLocal, panel.chordBody)
    const geometricAlpha = Math.atan2(-vNormal, Math.max(0.1, vChord)) * RAD

    // Speed bar rotates the canopy nose-down through the A risers, and rear
    // riser input rotates it nose-up. Both are handled as incidence changes by
    // the dynamics solver through the line lengths; what remains here is the
    // local chord twist the deformation adds.
    const alpha = geometricAlpha + panel.twistDeg

    const section = evaluateSection(
      alpha,
      brake,
      speedBar,
      wing,
      clAlpha,
      sectionStates[i],
      input.suppressSeparation,
    )

    let cl = section.cl * groundLiftGain
    let cd = section.cd + inducedK * section.cl * section.cl

    // B-line pull breaks the mid-chord camber across the span: lift mostly
    // goes, drag climbs hard. Target descent is 6-10 m/s per DHV test reports.
    if (bStall > 0.05) {
      cl *= 1 - 0.85 * bStall
      cd += 0.95 * bStall
    }

    // A collapsed or folded panel carries no lift and a lot more drag. Not an
    // enormous amount more, though: a tucked tip presents a small bluff shape,
    // not a barn door. Big ears should roughly double a wing's sink, taking it
    // from about 1.2 to 2.5-3 m/s, not stop it flying.
    if (panelCollapse > 0.01) {
      cl *= 1 - panelCollapse
      cd = cd * (1 - panelCollapse) + 0.70 * panelCollapse
    }

    const liftN = cl * q * panel.areaM2
    const dragN = cd * q * panel.areaM2

    // Lift is perpendicular to the local flow, in the plane of the flow and
    // the panel normal; drag opposes the flow.
    const normalAlongFlow = vDot(panel.normalBody, vHat)
    const liftPerp = vSub(panel.normalBody, vScale(vHat, normalAlongFlow))
    const liftLen = vLen(liftPerp)
    const liftDir = liftLen > 1e-4 ? vScale(liftPerp, 1 / liftLen) : panel.normalBody
    const dragDir = vScale(vHat, -1)

    const panelForce = vAdd(vScale(liftDir, liftN), vScale(dragDir, dragN))

    // Section pitching moment, converted from standard sign (negative
    // nose-down) to this frame's +x nose-down.
    const pitchMoment = -section.cm * q * panel.areaM2 * panel.chordM

    forceBody = vAdd(forceBody, panelForce)
    momentBody = vAdd(
      momentBody,
      vAdd(vCross(panel.positionBody, panelForce), v3(pitchMoment, 0, 0)),
    )

    if (panel.isLeft) {
      leftLiftN += liftN
      if (section.stalled) leftSeparated = true
      if (panel.brakeGain > 0.4) {
        leftFlapQ += q
        leftFlapCount++
      }
    } else {
      rightLiftN += liftN
      if (section.stalled) rightSeparated = true
      if (panel.brakeGain > 0.4) {
        rightFlapQ += q
        rightFlapCount++
      }
    }

    stallWarning = Math.max(stallWarning, section.stallMargin)
    alphaAreaSum += alpha * panel.areaM2
    areaSum += panel.areaM2

    panelStates.push({
      alphaDeg: alpha,
      cl,
      cd,
      liftN,
      dragN,
      airspeedMps: speed,
      separation: section.separation,
      collapse: panelCollapse,
    })
  }

  // Keel side force: an arched canopy resists sliding sideways. Without this
  // the wing would slip through turns instead of tracking along its chord.
  const forwardSpeed = Math.max(1, vAirBody.z)
  const sideslipRad = Math.atan2(vAirBody.x, forwardSpeed)
  const qRef = 0.5 * rho * (vAirBody.x * vAirBody.x + vAirBody.z * vAirBody.z)
  const sideForce = -0.45 * qRef * projected.projectedAreaM2 * Math.sin(sideslipRad)
  forceBody = vAdd(forceBody, v3(sideForce, 0, 0))

  // Weathercock stability: the swept, arched canopy yaws into the relative wind.
  const yawStiffness =
    0.040 * qRef * projected.projectedAreaM2 * projected.projectedSpanM * sideslipRad
  momentBody = vAdd(momentBody, v3(0, yawStiffness, 0))

  // Pitch damping (Cmq).
  //
  // Roll and yaw damping both fall out of the panel layout already, because a
  // roll or yaw rate changes the local flow at stations spread along the span.
  // Pitch does not: every panel sits at the same chordwise station, so a pitch
  // rate leaves their angles of attack untouched. On a real wing the leading
  // and trailing edges swing in opposite directions and the resulting camber
  // of the flow resists the rotation. That is added back here as the standard
  // rotary derivative, which is what keeps a paraglider's pitch from
  // wallowing through enormous slow oscillations.
  const speed = Math.max(2, vLen(vAirBody))
  const meanChord = wing.flatAreaM2 / wing.flatSpanM
  const CMQ = 1.2
  const pitchDamping =
    -CMQ *
    (0.5 * rho * speed * speed) *
    wing.flatAreaM2 *
    meanChord *
    ((meanChord / (2 * speed)) * omegaBody.x)
  momentBody = vAdd(momentBody, v3(pitchDamping, 0, 0))

  // Brake line tension at the pilot's hands: spring return plus dynamic
  // pressure on the deflected trailing edge. When a side separates the
  // pressure behind the flap collapses and the brake goes soft, which is the
  // cue a real pilot feels just before a stall.
  const flapArea = wing.flatAreaM2 * 0.16
  const leftQ = leftFlapCount > 0 ? leftFlapQ / leftFlapCount : 0
  const rightQ = rightFlapCount > 0 ? rightFlapQ / rightFlapCount : 0
  const brakeForce = (brake: number, q: number, separated: boolean): number => {
    const pressure = separated ? 0.12 : 1
    return 10 * brake + q * flapArea * 0.42 * Math.pow(brake, 1.3) * pressure
  }

  return {
    forceBody,
    momentBody,
    panels: panelStates,
    leftLiftN,
    rightLiftN,
    stallWarning,
    leftSeparated,
    rightSeparated,
    meanAlphaDeg: areaSum > 0 ? alphaAreaSum / areaSum : 0,
    leftBrakeForceN: brakeForce(leftBrake, leftQ, leftSeparated),
    rightBrakeForceN: brakeForce(rightBrake, rightQ, rightSeparated),
  }
}
