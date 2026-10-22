/**
 * Two-body paraglider flight dynamics.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO BODIES
 * ---------------------------------------------------------------------------
 * A paraglider is not an aircraft with a control surface. It is a wing with
 * roughly 90% of the system mass swinging seven metres underneath it. Almost
 * everything that makes one feel like a paraglider rather than a plane comes
 * out of that arrangement:
 *
 *   - Load the brakes and the wing slows, the pilot keeps going and swings
 *     forward, which pitches the canopy back and raises its angle of attack.
 *   - Let the brakes up and the canopy surges ahead of the pilot, angle of
 *     attack drops, and the wing dives to rebuild speed.
 *   - Shift your weight and the loaded riser pulls that side of the wing down,
 *     which banks it; the bank then turns it.
 *   - Dive, then pull up, and height comes back as speed and speed back as
 *     height, because nothing is clamped.
 *
 * So the model integrates a canopy rigid body and a pilot rigid body joined by
 * risers, and lets the flight behaviour fall out. Nothing here looks up an
 * airspeed, a sink rate, a bank angle or a turn rate from a control position.
 *
 * ---------------------------------------------------------------------------
 * THE JOINT
 * ---------------------------------------------------------------------------
 * Three couplings stand in for the line set:
 *
 *  1. Two unilateral distance constraints, left and right riser groups. They
 *     can only pull, never push, so the lines genuinely go slack at low G and
 *     the wing can fall behind the pilot.
 *  2. A pitch truss. The A, C and D line rows together hold the canopy at a
 *     fixed incidence to the risers, so the canopy cannot pivot freely. Speed
 *     bar shortens the A rows and rotates the whole wing nose-down; rear riser
 *     input rotates it nose-up. Modelled as a stiff angular spring whose
 *     commanded angle is the rigging incidence, with the line-geometry
 *     stiffness derived in `trussStiffness`.
 *  3. A torsional spring about the riser axis, which is what resists riser
 *     twist.
 *
 * ---------------------------------------------------------------------------
 * FRAMES
 * ---------------------------------------------------------------------------
 * World is y-up. Headings are measured clockwise from +z, matching the rest of
 * the project. Body frames follow `aerodynamics.ts`: +x right, +y up,
 * +z forward, with moment +x nose-down, +y yaw-right, +z roll-left.
 */

import {
  clamp,
  DEG,
  qIntegrateBody,
  qRotate,
  qRotateInv,
  v3,
  vAdd,
  vAddScaled,
  vCross,
  vDot,
  vLen,
  vNorm,
  vScale,
  vSub,
  type Quat,
  type V3,
} from './vecmath.ts'
import {
  AIR_DENSITY_SEA_LEVEL,
  airDensityAt,
  computeApparentMass,
  createSectionStates,
  createWingModel,
  evaluateWingAero,
  PANEL_COUNT,
  type ApparentMass,
  type SectionState,
  type WingAeroResult,
  type WingGeometry,
  type WingModel,
} from './aerodynamics.ts'
import type { FlightControls } from './types.ts'

const GRAVITY = 9.81

/** Physics substep. Fast enough for the stiff line truss, cheap enough for a phone. */
export const SUBSTEP_SECONDS = 1 / 240

/**
 * Axial stiffness of one riser group, N/m. A seven-metre Dyneema line set
 * stretches around 2.5 cm under one g, which is about 20 kN/m per side.
 */
const RISER_STIFFNESS_N_PER_M = 20_000

/** Axial damping of one riser group, N*s/m. Lines are not very dissipative. */
const RISER_DAMPING_NS_PER_M = 820

// ---------------------------------------------------------------------------
// Rigid bodies
// ---------------------------------------------------------------------------

type Body = {
  pos: V3
  vel: V3
  q: Quat
  omega: V3
  /** Physical mass. kg */
  massKg: number
  /** Direction-dependent added mass in body axes (x, y, z). kg */
  addedMassBody: V3
  /** Principal moments about the body axes, including added inertia. kg*m^2 */
  inertiaBody: V3
}

function makeBody(massKg: number, inertiaBody: V3, addedMassBody: V3): Body {
  return {
    pos: v3(),
    vel: v3(),
    q: { x: 0, y: 0, z: 0, w: 1 },
    omega: v3(),
    massKg,
    addedMassBody,
    inertiaBody,
  }
}

/** Applies a body-frame force over dt using the anisotropic effective mass. */
function applyForceBody(body: Body, forceBody: V3, dt: number): void {
  const aBody = v3(
    forceBody.x / (body.massKg + body.addedMassBody.x),
    forceBody.y / (body.massKg + body.addedMassBody.y),
    forceBody.z / (body.massKg + body.addedMassBody.z),
  )
  body.vel = vAdd(body.vel, vScale(qRotate(body.q, aBody), dt))
}

/** Applies a world-frame force over dt using the anisotropic effective mass. */
function applyForce(body: Body, forceWorld: V3, dt: number): void {
  applyForceBody(body, qRotateInv(body.q, forceWorld), dt)
}

/** Applies a world-frame torque to a body. */
function applyTorqueWorld(body: Body, torqueWorld: V3, dt: number): void {
  applyTorqueBody(body, qRotateInv(body.q, torqueWorld), dt)
}

/**
 * Applies a world-frame force at a world-frame offset from the body's centre
 * of mass, producing both linear and angular acceleration.
 */
function applyForceAtPoint(body: Body, forceWorld: V3, rWorld: V3, dt: number): void {
  applyForce(body, forceWorld, dt)
  const rBody = qRotateInv(body.q, rWorld)
  const fBody = qRotateInv(body.q, forceWorld)
  applyTorqueBody(body, vCross(rBody, fBody), dt)
}

/**
 * Applies an equal and opposite internal torque between two bodies, so the
 * coupling cannot create angular momentum out of nothing.
 */
function applyTorquePair(a: Body, b: Body, torqueWorldOnA: V3, dt: number): void {
  applyTorqueWorld(a, torqueWorldOnA, dt)
  applyTorqueWorld(b, vScale(torqueWorldOnA, -1), dt)
}

/** Applies a body-frame torque over dt, including the gyroscopic term. */
function applyTorqueBody(body: Body, torqueBody: V3, dt: number): void {
  const i = body.inertiaBody
  const w = body.omega
  const iw = v3(i.x * w.x, i.y * w.y, i.z * w.z)
  const gyro = vCross(w, iw)
  body.omega = vAdd(
    body.omega,
    v3(
      ((torqueBody.x - gyro.x) / i.x) * dt,
      ((torqueBody.y - gyro.y) / i.y) * dt,
      ((torqueBody.z - gyro.z) / i.z) * dt,
    ),
  )
}

/** Keeps a rotation rate finite and within a bound, replacing any NaN. */
function boundOmega(omega: V3, limit: number): V3 {
  return v3(
    Number.isFinite(omega.x) ? clamp(omega.x, -limit, limit) : 0,
    Number.isFinite(omega.y) ? clamp(omega.y, -limit, limit) : 0,
    Number.isFinite(omega.z) ? clamp(omega.z, -limit, limit) : 0,
  )
}

function pointVelocity(body: Body, rWorld: V3): V3 {
  return vAdd(body.vel, vCross(qRotate(body.q, body.omega), rWorld))
}

// ---------------------------------------------------------------------------
// Air mass
// ---------------------------------------------------------------------------

export type AirMassSample = {
  /** Air velocity at the canopy centre, world frame. m/s */
  centerMps: V3
  /** Air velocity at the left wingtip. Lets a thermal edge roll the wing. */
  leftTipMps: V3
  /** Air velocity at the right wingtip. */
  rightTipMps: V3
  /** 0 = glass, 1 = rough. Scales the analytic gust field. */
  turbulence: number
}

export function calmAir(): AirMassSample {
  return { centerMps: v3(), leftTipMps: v3(), rightTipMps: v3(), turbulence: 0 }
}

/**
 * Band-limited analytic gust field. Three octaves of drifting sine product
 * noise, sampled per panel so a gust hits one side before the other. That
 * spanwise difference is what makes air feel alive, and what sets up the
 * asymmetric collapses an active pilot has to fly through.
 */
function gustAt(x: number, y: number, z: number, t: number): number {
  // Two-factor octaves rather than three: a product of three sines spends most
  // of its time near zero, which reads as glassy air with rare spikes instead
  // of continuously moving air.
  const a = Math.sin(x * 0.055 + t * 0.9) * Math.cos(z * 0.048 - t * 0.7 + y * 0.021)
  const b = Math.sin(x * 0.148 - t * 1.9) * Math.cos(z * 0.131 + t * 1.6 + y * 0.058)
  const c = Math.sin(x * 0.37 + t * 3.6) * Math.cos(z * 0.41 - t * 3.1)
  // Scaled so the sum reaches roughly unit amplitude.
  return (a * 0.60 + b * 0.28 + c * 0.12) * 1.6
}

// ---------------------------------------------------------------------------
// Dynamics state
// ---------------------------------------------------------------------------

export type GroundContact = 'airborne' | 'touching' | 'landed' | 'crashed'

export type FlightDynamicsState = {
  canopyPos: V3
  canopyVel: V3
  canopyQuat: Quat
  canopyOmega: V3
  pilotPos: V3
  pilotVel: V3
  pilotQuat: Quat

  /** Angle of attack averaged over the span, weighted by area. deg */
  alphaDeg: number
  airspeedMps: number
  /**
   * Airspeed corrected to sea-level density. True airspeed rises as air thins,
   * so this is the number that compares with a published polar, and the number
   * an airspeed indicator would show.
   */
  equivalentAirspeedMps: number
  /** Positive up. m/s */
  verticalSpeedMps: number
  groundSpeedMps: number
  glideRatio: number

  /** Canopy attitude in the project's conventions. */
  headingDeg: number
  /** Positive nose-down. */
  pitchDeg: number
  /** Positive banked right. */
  bankDeg: number

  /** Load felt by the pilot, in g. */
  gForce: number
  /** Total riser tension. N */
  lineTensionN: number
  leftLineTensionN: number
  rightLineTensionN: number
  linesSlack: boolean
  /** Riser twist, pilot relative to canopy. deg */
  riserTwistDeg: number

  /** Per-panel collapse, 0 inflated to 1 folded. */
  collapse: number[]
  leftCollapse: number
  rightCollapse: number
  /** 0 clear of the stall, 1 at the break. */
  stallWarning: number
  leftSeparated: boolean
  rightSeparated: boolean
  isStalled: boolean
  isSpinning: boolean
  asymmetricStallSide: 'none' | 'left' | 'right'

  leftBrakeForceN: number
  rightBrakeForceN: number

  /** Current incidence of the chord relative to the risers. deg, nose-up positive. */
  incidenceDeg: number
  thrustN: number

  groundClearanceM: number
  contact: GroundContact
}

export type TerrainSampler = (x: number, z: number) => number

/** A settled equilibrium, stored heading-normalised so it can be reused. */
type TrimState = {
  canopyQ: Quat
  canopyVel: V3
  canopyOmega: V3
  pilotOffset: V3
  pilotQ: Quat
  pilotVel: V3
  pilotOmega: V3
}

export type StepInput = {
  dt: number
  controls: FlightControls
  air: AirMassSample
  sampleTerrainHeight: TerrainSampler
  timeSec: number
  /** Extra vertical air velocity applied uniformly, e.g. a scripted lift boost. m/s */
  extraLiftMps?: number
  /** Motor throttle for powered wings, 0 to 1. */
  throttle?: number
  /**
   * How much of a real pilot's reflexive damping to apply, 0 to 1.
   * A real pilot is never a passive mass: they damp pitch and roll without
   * thinking about it. This stands in for that, and nothing else. It adds
   * damping torques only, so it can never create lift, speed or climb.
   */
  pilotSkill?: number
}

// ---------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------

export class FlightDynamics {
  /**
   * Trim equilibria, keyed by wing and pilot mass. Solving one means flying
   * the model for forty simulated seconds, so it is worth doing once.
   */
  private static trimCache = new Map<string, TrimState>()

  /** Solved riser attachment stations, keyed by wing and pilot mass. */
  private static geometryCache = new Map<string, number>()

  /** Clears the cached trim equilibria. Only needed when retuning a wing. */
  public static clearTrimCache(): void {
    FlightDynamics.trimCache.clear()
    FlightDynamics.geometryCache.clear()
  }

  public state: FlightDynamicsState

  /** Diagnostics: last pitch moments, for tuning and the validation suite. */
  public lastTrussMomentNm = 0
  public lastAeroPitchMomentNm = 0

  private canopy: Body
  private pilot: Body
  private model: WingModel
  private sections: SectionState[]
  private apparent: ApparentMass

  /** Canopy centre of mass relative to the root quarter-chord, body frame. */
  private cgBody: V3
  /** Panel quarter-chord positions relative to the canopy CG. */
  private panelR: V3[]
  /** Line attachment points on the canopy, relative to the canopy CG. */
  private attachLeftBody: V3
  private attachRightBody: V3
  /** Carabiner positions relative to the pilot CG, before weight shift. */
  private riserHalfWidthM: number
  private hangDepthM: number
  /** Rest length of each riser group, the actual converging line length. m */
  private riserLengthM: number
  /** Vertical drop from the canopy attachment down to the carabiners. m */
  private riserDropM = 0
  /** Chordwise separation of the fore and aft line rows. m */
  private trussArmM: number
  private trussStiffnessNmPerRad: number
  /** Chordwise station of the fore (A) line row, relative to the canopy CG. m */
  private foreZ = 0
  /** Chordwise station of the aft (C/D) line row, relative to the canopy CG. m */
  private aftZ = 0
  /** Previous incidence, for the truss damping term. rad */
  private lastIncidenceRad: number | null = null
  /** Chordwise station of the riser attachment, relative to the canopy CG. m */
  private attachZ = 0
  /**
   * Rigging incidence of the chord relative to the risers, solved from the
   * wing's published trim speed rather than declared. rad, nose-up positive.
   */
  private designIncidenceRad = 0
  /** What the bench trim converged on. */
  private calibratedTrim: {
    incidenceRad: number
    speedMps: number
    sinkMps: number
    glideRatio: number
  } = { incidenceRad: 0, speedMps: 0, sinkMps: 0, glideRatio: 0 }

  private collapse: number[]
  private rho: number
  private wingRef: WingGeometry
  private pilotMassKg: number
  private twistRad = 0
  /** Mean flow separation across the span, 0 attached to 1 fully stalled. */
  private meanSeparation = 0
  /** Seconds the brakes have been released while the canopy still has flow. */
  private pressureRecoverySec = 0
  /** Seconds left of the post-stall re-pressurisation window. */
  private reattachGraceSec = 0

  constructor(wing: WingGeometry, pilotMassKg: number) {
    this.wingRef = wing
    this.pilotMassKg = pilotMassKg
    this.model = createWingModel(wing)
    this.sections = createSectionStates()
    this.collapse = new Array(PANEL_COUNT).fill(0)
    this.rho = 1.225
    this.apparent = computeApparentMass(this.rho, wing)

    this.cgBody = v3()
    this.panelR = []
    this.attachLeftBody = v3()
    this.attachRightBody = v3()
    this.riserHalfWidthM = wing.riserHalfWidthM
    this.hangDepthM = 0.3
    this.riserLengthM = wing.lineLengthM
    this.trussArmM = 1
    this.trussStiffnessNmPerRad = 1

    this.canopy = makeBody(1, v3(1, 1, 1), v3())
    this.pilot = makeBody(1, v3(1, 1, 1), v3())

    this.state = this.blankState()
    this.rebuild(wing, pilotMassKg)
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  /**
   * Rebuilds the rigid bodies and line geometry for a wing and pilot mass.
   *
   * Rest lengths are measured off the design pose rather than being declared,
   * so trim angle of attack is a consequence of where the lines attach and how
   * long they are, exactly as it is on a real wing.
   */
  public rebuild(wing: WingGeometry, pilotMassKg: number): void {
    this.wingRef = wing
    this.pilotMassKg = pilotMassKg
    this.model = createWingModel(wing)
    this.sections = createSectionStates()
    this.collapse = new Array(PANEL_COUNT).fill(0)
    this.apparent = computeApparentMass(this.rho, wing)

    const { panels, projected, meanChordM } = this.model

    // Canopy centre of mass: area-weighted centroid of the panels, shifted aft
    // to the fabric's chordwise centroid at about 42% of chord.
    let cg = v3()
    let areaSum = 0
    for (const panel of panels) {
      cg = vAddScaled(cg, panel.positionBody, panel.areaM2)
      areaSum += panel.areaM2
    }
    cg = vScale(cg, 1 / Math.max(1e-6, areaSum))
    this.cgBody = v3(cg.x, cg.y, cg.z - 0.17 * meanChordM)

    this.panelR = panels.map((panel) => vSub(panel.positionBody, this.cgBody))

    // Canopy mass: fabric and lines plus the air trapped inside the cells,
    // which travels with the wing.
    const canopyMass = wing.canopyMassKg + wing.enclosedAirKg
    const b = projected.projectedSpanM
    const c = meanChordM
    const inertia = v3(
      // pitch, about the lateral axis: chordwise extent plus the arc's depth
      canopyMass * (c * c / 12 + 0.02 * b * b) + this.apparent.pitchKgM2,
      // yaw, about the vertical axis
      (canopyMass * (b * b + c * c)) / 12 + this.apparent.yawKgM2,
      // roll, about the fore-aft axis: dominated by the span
      (canopyMass * b * b) / 12 + this.apparent.rollKgM2,
    )
    // Added mass by body axis: lateral is sway, up is heave, forward is surge.
    // The canopy resists being pushed along its normal far more than along its
    // chord, which is why it feels heavy in pitch yet still dives willingly.
    this.canopy = makeBody(
      canopyMass,
      inertia,
      v3(this.apparent.swayKg, this.apparent.heaveKg, this.apparent.surgeKg),
    )

    // A seated pilot in a harness. The exact values matter far less than the
    // mass, since the pendulum dominates every rotational mode.
    this.pilot = makeBody(pilotMassKg, v3(12, 10, 8), v3())

    // --- Line geometry, measured off the design pose ---
    // Chordwise stations of the fore (A) and aft (C/D) line rows, relative to
    // the canopy centre of mass.
    const foreZ = (0.25 - wing.foreAttachChordFrac) * meanChordM - this.cgBody.z
    const aftZ = (0.25 - wing.aftAttachChordFrac) * meanChordM - this.cgBody.z
    this.foreZ = foreZ
    this.aftZ = aftZ
    this.trussArmM = foreZ - aftZ

    // Each riser group carries one half-wing, so its effective attachment is
    // that half's area-weighted centroid: out along the span and down the arc.
    let halfX = 0
    let halfY = 0
    let halfArea = 0
    for (const panel of panels) {
      if (panel.isLeft) continue
      halfX += panel.positionBody.x * panel.areaM2
      halfY += panel.positionBody.y * panel.areaM2
      halfArea += panel.areaM2
    }
    const attachX = halfX / Math.max(1e-6, halfArea)
    const attachY = halfY / Math.max(1e-6, halfArea) - this.cgBody.y

    // Chordwise attachment station: the centre of pressure at trim.
    //
    // This is not a free choice. A wing's line rows are sized so their share
    // of the load matches the pressure distribution, which puts the resultant
    // line force through the centre of pressure. Put the attachment anywhere
    // else and the line truss has to carry the leftover pitching moment as a
    // differential between the fore and aft rows -- and since both rows run to
    // the same carabiner, that differential drags the risers off vertical.
    // Get it wrong by even a few centimetres and the riser tilt cancels the
    // speed bar: the canopy rotates nose-down exactly as commanded while the
    // risers lean back by the same amount, leaving the angle of attack, and so
    // the airspeed, completely unchanged.
    const quarterChordZ = -this.cgBody.z
    const trimSpeed = wing.trimSpeedKmh / 3.6
    const qTrim = 0.5 * this.rho * trimSpeed * trimSpeed
    const weightN = (pilotMassKg + canopyMass) * GRAVITY
    const clTrim = clamp(
      weightN / Math.max(1, qTrim * wing.flatAreaM2 * (projected.projectedAreaM2 / wing.flatAreaM2)),
      0.2,
      1.6,
    )
    // Centre of pressure sits aft of the quarter-chord by -Cm/Cl chords.
    this.attachZ = quarterChordZ - (Math.abs(wing.cm0) / clTrim) * meanChordM
    this.attachLeftBody = v3(-attachX, attachY, this.attachZ)
    this.attachRightBody = v3(attachX, attachY, this.attachZ)
    // Fore and aft line rows straddle the attachment station.
    this.foreZ = this.attachZ + this.trussArmM * 0.5
    this.aftZ = this.attachZ - this.trussArmM * 0.5
    // Riser group length: the lines run from the half-wing's load centroid in
    // to the carabiner, so they are a little longer than the vertical drop
    // they produce.
    this.riserDropM = wing.lineLengthM
    this.riserLengthM = Math.hypot(this.riserDropM, attachX - this.riserHalfWidthM)

    // --- Pitch truss stiffness ---
    // Rotating the canopy by d(theta) stretches one line row by
    // trussArm * d(theta) and slackens the other, so with an axial stiffness
    // k_axial per row the restoring torque is k_axial * trussArm^2 per radian.
    // A Dyneema line set stretches roughly 2.5 cm at 1 g over 7 m, which is
    // about 20 kN/m per row. For the 24 m^2 wing that gives ~40 kNm/rad: a
    // truss mode near 0.2 s, two orders faster than the 3-5 s flight modes it
    // has to hold rigid, and comfortably inside the explicit integrator's
    // stability limit of omega * dt < 1.
    const axialStiffness = 20_000
    const derived = axialStiffness * this.trussArmM * this.trussArmM
    const stabilityCap = this.canopy.inertiaBody.x * Math.pow(0.5 / SUBSTEP_SECONDS, 2)
    this.trussStiffnessNmPerRad = Math.min(derived, stabilityCap)

    // --- Trim it: find the rigging incidence that gives book trim speed ---
    this.calibrateRiggingIncidence()
  }

  public get wing(): WingGeometry {
    return this.wingRef
  }

  public get wingModel(): WingModel {
    return this.model
  }

  public get pilotMass(): number {
    return this.pilotMassKg
  }

  /**
   * The glide the bench trim settled on: the rigging incidence solved for, and
   * the speed, sink and glide ratio it produced. Useful for instruments, for
   * tuning a new wing, and for the validation suite.
   */
  public get trimReference(): {
    incidenceRad: number
    speedMps: number
    sinkMps: number
    glideRatio: number
  } {
    return { ...this.calibratedTrim }
  }

  // -------------------------------------------------------------------------
  // Placement
  // -------------------------------------------------------------------------

  /**
   * Places the system in a genuinely trimmed glide.
   *
   * The design pose is close to trim but not exactly on it, and starting even
   * slightly off trim sets off a large pitch excursion before the wing
   * settles. So the equilibrium is solved for once per wing and pilot mass by
   * flying the real dynamics in place until it stops changing, then cached.
   * Nothing is faked: the cached state is whatever the model itself settles
   * on, which is also how the validation suite reads trim performance.
   */
  public placeTrimmed(canopyPos: V3, headingDeg: number): void {
    const key = `${this.wingRef.name}|${this.pilotMassKg.toFixed(2)}`
    let trim = FlightDynamics.trimCache.get(key)
    if (!trim) {
      this.placeAtDesignPose(canopyPos, headingDeg)
      trim = this.solveTrim(canopyPos)
      FlightDynamics.trimCache.set(key, trim)
    }

    // Apply the cached trim, rotated to the requested heading.
    const heading = headingDeg * DEG
    const qYaw = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }

    this.canopy.pos = { x: canopyPos.x, y: canopyPos.y, z: canopyPos.z }
    this.canopy.q = normalizeQuat(mulQuat(qYaw, trim.canopyQ))
    this.canopy.vel = qRotate(qYaw, trim.canopyVel)
    this.canopy.omega = { ...trim.canopyOmega }

    this.pilot.pos = vAdd(canopyPos, qRotate(qYaw, trim.pilotOffset))
    this.pilot.q = normalizeQuat(mulQuat(qYaw, trim.pilotQ))
    this.pilot.vel = qRotate(qYaw, trim.pilotVel)
    this.pilot.omega = { ...trim.pilotOmega }

    this.twistRad = 0
    this.lastIncidenceRad = null
    this.collapse.fill(0)
    for (const section of this.sections) section.separated = false
    this.state = this.blankState()
    this.state.contact = 'airborne'
    // Seed the risers as loaded, so the first frames do not run with the truss
    // softened for slack lines.
    const halfWeight = this.pilotMassKg * GRAVITY * 0.5
    this.syncState(null, halfWeight, halfWeight)
  }

  // -------------------------------------------------------------------------
  // Rigging and trim
  // -------------------------------------------------------------------------

  /**
   * Pilot centre of mass, in canopy body coordinates, for a given rigging
   * incidence.
   *
   * The risers hang from the attachment station and lean by the incidence, so
   * raising the incidence swings the pilot aft along the chord. That is the
   * whole mechanism behind the speed system: shortening the A risers takes
   * incidence off, which leaves the pilot effectively further forward, which
   * lowers the angle of attack and speeds the wing up.
   */
  private pilotOffsetForIncidence(incidenceRad: number): V3 {
    return v3(
      0,
      this.attachLeftBody.y - this.riserDropM * Math.cos(incidenceRad) - this.hangDepthM,
      this.attachZ - this.riserDropM * Math.sin(incidenceRad),
    )
  }

  /**
   * Places the system in a plausible glide at the current rigging incidence:
   * canopy held at that incidence with the risers vertical, pilot hanging
   * below it on the lines, both moving along the wing's published glide path.
   *
   * This is a starting point, not an answer. It is close enough that the
   * dynamics settles from here without flying through a stall, and the trim
   * the model actually holds is then whatever the dynamics converges on.
   */
  private placeAtDesignPose(canopyPos: V3, headingDeg: number): void {
    const wing = this.wingRef
    const heading = headingDeg * DEG
    const incidence = this.designIncidenceRad

    // Chord nose-up by the rigging incidence, then yawed to heading.
    const qPitch: Quat = {
      x: Math.sin(-incidence / 2),
      y: 0,
      z: 0,
      w: Math.cos(-incidence / 2),
    }
    const qYaw: Quat = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }
    this.canopy.q = normalizeQuat(mulQuat(qYaw, qPitch))
    this.canopy.pos = { x: canopyPos.x, y: canopyPos.y, z: canopyPos.z }
    this.canopy.omega = v3()

    const speed = wing.trimSpeedKmh / 3.6
    const glide = Math.atan(1 / Math.max(2, wing.glideRatio))
    const velocity = v3(
      Math.sin(heading) * speed * Math.cos(glide),
      -speed * Math.sin(glide),
      Math.cos(heading) * speed * Math.cos(glide),
    )
    this.canopy.vel = { ...velocity }

    this.pilot.pos = vAdd(
      this.canopy.pos,
      qRotate(this.canopy.q, this.pilotOffsetForIncidence(incidence)),
    )
    this.pilot.q = this.canopy.q
    this.pilot.vel = { ...velocity }
    this.pilot.omega = v3()

    this.twistRad = 0
    this.lastIncidenceRad = null
    this.collapse.fill(0)
    for (const section of this.sections) section.separated = false
    this.state = this.blankState()
    this.state.contact = 'airborne'
    // Seed the risers as loaded, so the first frames do not run with the truss
    // softened for slack lines.
    const halfWeight = this.pilotMassKg * GRAVITY * 0.5
    this.syncState(null, halfWeight, halfWeight)
  }

  /**
   * Flies the model in place, hands off, and reports the glide it settles on.
   *
   * Flown at sea level, because published polars are quoted there. True
   * airspeed rises as air thins, so the same wing trims faster higher up, and
   * the model reproduces that.
   *
   * The canopy is translated back to the reference point after every substep,
   * which leaves the dynamics untouched because nothing in calm air depends on
   * absolute position. The average is taken over several phugoid periods: a
   * paraglider's speed-and-height oscillation is only lightly damped, which is
   * real, so a short sample would read whatever part of the cycle it caught.
   * The oscillation is centred on trim, so a long average finds it.
   */
  private measureSettledGlide(
    settleSeconds = 20,
    sampleSeconds = 45,
  ): { speedMps: number; sinkMps: number; stalled: boolean } {
    this.placeAtDesignPose(v3(0, 0, 0), 0)

    const neutral: FlightControls = {
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
    const input: StepInput = {
      dt: SUBSTEP_SECONDS,
      controls: neutral,
      air: calmAir(),
      sampleTerrainHeight: () => -4000,
      timeSec: 0,
      // Heavy reflex damping while settling: it only damps, so it cannot bias
      // the equilibrium it converges to, it just gets there sooner.
      pilotSkill: 1,
    }

    const reference = v3(0, 0, 0)
    const settleSteps = Math.round(settleSeconds / SUBSTEP_SECONDS)
    const sampleSteps = Math.round(sampleSeconds / SUBSTEP_SECONDS)
    let speedSum = 0
    let sinkSum = 0
    let stalled = false

    for (let i = 0; i < settleSteps + sampleSteps; i++) {
      this.substep(SUBSTEP_SECONDS, input)
      const drift = vSub(this.canopy.pos, reference)
      this.canopy.pos = { ...reference }
      this.pilot.pos = vSub(this.pilot.pos, drift)
      this.state.groundClearanceM = 4000
      this.state.contact = 'airborne'
      if (i >= settleSteps) {
        speedSum += vLen(this.canopy.vel)
        sinkSum += -this.canopy.vel.y
        if (this.sections.some((section) => section.separated)) stalled = true
      }
    }

    return {
      speedMps: speedSum / sampleSteps,
      sinkMps: sinkSum / sampleSteps,
      stalled,
    }
  }

  /**
   * Trims the wing on the bench.
   *
   * On a real wing the rigging incidence is set by the relative lengths of the
   * line rows, and the trim speed follows from it. So that is the one knob
   * turned here: the incidence is bisected until the model, flown for real,
   * settles at the wing's published trim speed.
   *
   * Only trim speed is matched. Sink rate, glide ratio, the shape of the whole
   * polar, the response to bar and brake, the behaviour in a turn -- all of it
   * is left free, falling out of the aerodynamics, so the validation suite is
   * checking the model against the real wing rather than against itself.
   *
   * Lower incidence means a lower angle of attack and a faster glide, so the
   * relationship is monotonic and decreasing. The solved value is cached per
   * wing and pilot mass, since each probe flies a minute of simulated time.
   */
  private calibrateRiggingIncidence(): void {
    // Keyed by wing alone. A wing's line lengths do not change when a
    // different pilot clips in, so the rigging incidence is solved once at the
    // wing's reference weight and reused. That is what makes a heavily loaded
    // wing fly faster rather than simply being re-trimmed back to book speed.
    const key = this.wingRef.name
    const cached = FlightDynamics.geometryCache.get(key)
    if (cached !== undefined) {
      this.designIncidenceRad = cached
      return
    }

    const flyingMass = this.pilotMassKg
    const referenceMass = this.wingRef.pilotMassKg
    this.pilotMassKg = referenceMass
    this.pilot.massKg = referenceMass

    const target = this.wingRef.trimSpeedKmh / 3.6
    const speedAt = (incidence: number): number => {
      this.designIncidenceRad = incidence
      // A short settle is plenty while searching; the answer is polished by
      // the final measurement below.
      const settled = this.measureSettledGlide(14, 26)
      // A probe that stalled or tucked tells us nothing about trim speed, and
      // a deep stall can descend at a deceptively high airspeed. Taking that
      // at face value destroys the monotonic relationship the search depends
      // on, so unusable probes are reported as such rather than guessed at.
      return settled.stalled ? Number.NaN : settled.speedMps
    }

    // Scan a coarse grid of rigging angles from fast to slow and bisect the
    // first interval that brackets the target with usable readings at both
    // ends. Scanning rather than assuming fixed endpoints matters: at extreme
    // rigging the wing either stalls or tucks, so an endpoint picked in
    // advance can easily land on a reading that means nothing.
    const from = -4 * DEG
    const to = 9 * DEG
    const steps = 26
    const stride = (to - from) / steps

    let lo = Number.NaN
    let hi = Number.NaN
    let previousAngle = from
    let previousSpeed = speedAt(previousAngle)

    for (let i = 1; i <= steps; i++) {
      const angle = from + stride * i
      const speed = speedAt(angle)
      if (
        Number.isFinite(previousSpeed) &&
        Number.isFinite(speed) &&
        (previousSpeed - target) * (speed - target) <= 0
      ) {
        lo = previousAngle
        hi = angle
        break
      }
      previousAngle = angle
      previousSpeed = speed
    }

    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      // Trim speed falls as rigging incidence rises.
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) * 0.5
        const speed = speedAt(mid)
        if (!Number.isFinite(speed)) {
          hi = mid
        } else if (speed > target) {
          lo = mid
        } else {
          hi = mid
        }
      }
      this.designIncidenceRad = (lo + hi) * 0.5
    } else {
      // Nothing usable bracketed the target. Fall back to a sane rigging angle
      // rather than whatever the last probe happened to leave behind.
      this.designIncidenceRad = 4 * DEG
    }

    FlightDynamics.geometryCache.set(key, this.designIncidenceRad)

    const settled = this.measureSettledGlide()
    this.pilotMassKg = flyingMass
    this.pilot.massKg = flyingMass
    this.calibratedTrim = {
      incidenceRad: this.designIncidenceRad,
      speedMps: settled.speedMps,
      sinkMps: settled.sinkMps,
      glideRatio: settled.sinkMps > 0.01 ? settled.speedMps / settled.sinkMps : 0,
    }
  }

  /**
   * Flies the model in place until it stops changing and returns the
   * equilibrium, stored heading-normalised so it can be reused at any heading.
   */
  private solveTrim(referencePos: V3): TrimState {
    this.measureSettledGlide(30, 1)

    const fwd = qRotate(this.canopy.q, v3(0, 0, 1))
    const yaw = Math.atan2(fwd.x, fwd.z)
    const qUnyaw = { x: 0, y: Math.sin(-yaw / 2), z: 0, w: Math.cos(-yaw / 2) }

    void referencePos
    return {
      canopyQ: normalizeQuat(mulQuat(qUnyaw, this.canopy.q)),
      canopyVel: qRotate(qUnyaw, this.canopy.vel),
      canopyOmega: { ...this.canopy.omega },
      pilotOffset: qRotate(qUnyaw, vSub(this.pilot.pos, this.canopy.pos)),
      pilotQ: normalizeQuat(mulQuat(qUnyaw, this.pilot.q)),
      pilotVel: qRotate(qUnyaw, this.pilot.vel),
      pilotOmega: { ...this.pilot.omega },
    }
  }

  /** Whether the flight has ended in a crash. */
  public isCrashed(): boolean {
    return this.state.contact === 'crashed'
  }

  /**
   * Adds an angular rate to the canopy, in body axes.
   *
   * This is how the game's acro buttons work: hand the wing a rotation and let
   * the dynamics take it from there, including whether it comes round or drops
   * out halfway. Nothing is animated and no outcome is guaranteed.
   */
  public addAngularImpulse(omegaBody: V3): void {
    this.canopy.omega = vAdd(this.canopy.omega, omegaBody)
  }

  // -------------------------------------------------------------------------
  // Stepping
  // -------------------------------------------------------------------------

  /** Advances the simulation, substepping internally at a fixed rate. */
  public step(input: StepInput): void {
    if (this.isCrashed()) return

    let remaining = clamp(input.dt, 0, 0.1)
    let aero: WingAeroResult | null = null
    let leftTension = 0
    let rightTension = 0

    while (remaining > 1e-6) {
      const dt = Math.min(SUBSTEP_SECONDS, remaining)
      remaining -= dt
      const result = this.substep(dt, input)
      aero = result.aero
      leftTension = result.leftTensionN
      rightTension = result.rightTensionN
      if (this.isCrashed()) break
    }

    this.syncState(aero, leftTension, rightTension)
  }

  private substep(
    dt: number,
    input: StepInput,
  ): { aero: WingAeroResult; leftTensionN: number; rightTensionN: number } {
    const { controls, air } = input
    const wing = this.wingRef
    this.rho = airDensityAt(this.canopy.pos.y)

    // --- Air velocity at the canopy and across the span ---
    const spanGust = this.sampleSpanwiseAir(air, input.timeSec, input.extraLiftMps ?? 0)

    // --- Canopy aerodynamics ---
    const vAirWorld = vSub(this.canopy.vel, spanGust.centerMps)
    const vAirBody = qRotateInv(this.canopy.q, vAirWorld)
    const omegaBody = this.canopy.omega

    const aero = evaluateWingAero({
      vAirBody,
      omegaBody,
      controls,
      rho: this.rho,
      model: this.model,
      sectionStates: this.sections,
      collapse: this.collapse,
      groundClearanceM: this.state.groundClearanceM,
      panelGustMps: spanGust.panelUpMps,
      suppressSeparation: this.reattachGraceSec > 0,
    })

    // Aero moments arrive about the root quarter-chord; shift them to the CG.
    const momentAboutCg = vAdd(
      aero.momentBody,
      vCross(vScale(this.cgBody, -1), aero.forceBody),
    )

    let separationSum = 0
    for (const panel of aero.panels) separationSum += panel.separation
    this.meanSeparation = separationSum / Math.max(1, aero.panels.length)

    this.lastAeroPitchMomentNm = momentAboutCg.x
    applyForceBody(this.canopy, aero.forceBody, dt)
    applyForce(this.canopy, v3(0, -this.canopy.massKg * GRAVITY, 0), dt)
    applyTorqueBody(this.canopy, momentAboutCg, dt)

    // --- Pilot forces ---
    const vPilotAir = vSub(this.pilot.vel, spanGust.centerMps)
    const pilotSpeed = vLen(vPilotAir)
    if (pilotSpeed > 0.1) {
      const q = 0.5 * this.rho * pilotSpeed * pilotSpeed
      const dragN = q * (wing.pilotDragAreaM2 + wing.lineDragAreaM2)
      applyForce(this.pilot, vScale(vPilotAir, -dragN / pilotSpeed), dt)
    }
    applyForce(this.pilot, v3(0, -this.pilot.massKg * GRAVITY, 0), dt)

    // --- Motor thrust ---
    //
    // The engine is strapped to the harness, not held in the pilot's hands, so
    // the thrust goes in at the harness rather than at the pilot's centre of
    // mass. That matters: thrust applied low down swings the pilot forward,
    // and because the canopy's attitude follows the risers, the wing pitches
    // back and the angle of attack climbs. Power-on pitch-up is real -- it is
    // why reflex wings and trimmers exist -- but feeding the thrust in at the
    // harness, where it actually acts, keeps it to the right size.
    let thrustN = 0
    if (wing.hasMotor) {
      const throttle = clamp(input.throttle ?? controls.throttle ?? 0, 0, 1)
      thrustN = (wing.maxThrustNewtons ?? 0) * Math.pow(throttle, 1.3)
      if (thrustN > 0) {
        const harness = this.worldPoint(this.pilot, v3(0, this.hangDepthM, 0))
        applyForceAtPoint(
          this.pilot,
          qRotate(this.pilot.q, v3(0, 0, thrustN)),
          vSub(harness, this.pilot.pos),
          dt,
        )
      }
    }
    this.state.thrustN = thrustN

    // --- Joint couplings ---
    this.applyPitchTruss(controls, dt)
    this.applyTwistSpring(dt)
    this.applyHarnessAlignment(dt)
    this.applyPilotReflexes(clamp(input.pilotSkill ?? 0.35, 0, 1), dt)

    // --- Riser constraints ---
    const tensions = this.applyRiserForces(controls, dt)

    // --- Integrate position and attitude ---
    // Both are advanced with the post-constraint velocities. Integrating
    // attitude before the solve would rotate the bodies using angular rates
    // the constraint then corrects, which quietly feeds energy into the
    // pitch and roll modes.
    this.canopy.pos = vAddScaled(this.canopy.pos, this.canopy.vel, dt)
    this.pilot.pos = vAddScaled(this.pilot.pos, this.pilot.vel, dt)

    // A real-time simulation should degrade rather than detonate, so rotation
    // rates are bounded well above anything a paraglider reaches. Nothing in
    // normal flight, or even in a tumble, comes close to these.
    this.canopy.omega = boundOmega(this.canopy.omega, 25)
    this.pilot.omega = boundOmega(this.pilot.omega, 25)

    this.canopy.q = qIntegrateBody(this.canopy.q, this.canopy.omega, dt)
    this.pilot.q = qIntegrateBody(this.pilot.q, this.pilot.omega, dt)

    // --- Collapse bookkeeping and ground ---
    this.updateCollapse(aero, dt)
    this.updatePressureRecovery(controls, dt)
    this.updateGround(input.sampleTerrainHeight)

    return { aero, leftTensionN: tensions.left, rightTensionN: tensions.right }
  }

  // -------------------------------------------------------------------------
  // Air sampling
  // -------------------------------------------------------------------------

  private sampleSpanwiseAir(
    air: AirMassSample,
    timeSec: number,
    extraLiftMps: number,
  ): { centerMps: V3; panelUpMps: number[] } {
    const centerMps = v3(
      air.centerMps.x,
      air.centerMps.y + extraLiftMps,
      air.centerMps.z,
    )

    const panelUpMps: number[] = new Array(PANEL_COUNT)
    const panels = this.model.panels
    const turbulence = air.turbulence
    // Peak gust at full turbulence, m/s. Thermic air in the middle of the day
    // moves several metres a second over a wingspan, which is what makes
    // accelerated flight in rough air the place tucks happen.
    const gustScale = turbulence * 4.5

    for (let i = 0; i < panels.length; i++) {
      const eta = panels[i].eta
      // Spanwise interpolation of the sampled tip velocities relative to the
      // centre: this is how a thermal edge rolls the wing.
      const tip = eta < 0 ? air.leftTipMps : air.rightTipMps
      const blend = Math.abs(eta)
      let up = (tip.y - air.centerMps.y) * blend

      if (gustScale > 0.001) {
        const r = vAdd(this.canopy.pos, qRotate(this.canopy.q, this.panelR[i]))
        up += gustAt(r.x, r.y, r.z, timeSec) * gustScale
      }
      panelUpMps[i] = up
    }

    return { centerMps, panelUpMps }
  }

  // -------------------------------------------------------------------------
  // Joint couplings
  // -------------------------------------------------------------------------

  /** Current riser direction, pointing from the pilot up to the canopy. */
  private riserAxisWorld(): V3 {
    const attachMid = this.worldPoint(
      this.canopy,
      v3(0, this.attachLeftBody.y, this.attachLeftBody.z),
    )
    const carabinerMid = this.worldPoint(this.pilot, v3(0, this.hangDepthM, 0))
    const d = vSub(attachMid, carabinerMid)
    return vLen(d) > 1e-4 ? vNorm(d) : qRotate(this.canopy.q, v3(0, 1, 0))
  }

  /**
   * The A/C/D line rows together hold the canopy at a commanded incidence to
   * the risers. Speed bar shortens the A rows, which rotates the whole wing
   * nose-down and takes angle of attack off; rear riser input does the
   * opposite without the drag of pulling brake.
   */
  private applyPitchTruss(controls: FlightControls, dt: number): void {
    const wing = this.wingRef
    const axis = this.riserAxisWorld()
    const axisBody = qRotateInv(this.canopy.q, axis)

    // Incidence of the chord relative to the risers, nose-up positive.
    //
    // Measured over the full circle, with the rate taken the shortest way
    // round. Clamping the denominator instead, to guard against the canopy
    // swinging level with the risers, makes the angle jump by half a turn as
    // it crosses: the numerical rate then reads in the hundreds of radians per
    // second, the damping term turns that into a moment of millions of
    // newton-metres, and the integrator detonates within a few frames of any
    // violent handling.
    const incidenceRad = Math.atan2(axisBody.z, axisBody.y)
    let incidenceRate = 0
    if (this.lastIncidenceRad !== null) {
      let delta = incidenceRad - this.lastIncidenceRad
      if (delta > Math.PI) delta -= 2 * Math.PI
      if (delta < -Math.PI) delta += 2 * Math.PI
      incidenceRate = clamp(delta / dt, -12, 12)
    }
    this.lastIncidenceRad = incidenceRad
    this.state.incidenceDeg = incidenceRad / DEG

    // The line rows have nothing to pull against once the canopy has swung
    // level with the risers or beyond, as it can in a tumble.
    if (axisBody.y <= 0.2) {
      this.lastTrussMomentNm = 0
      return
    }

    const speedBar = clamp(Math.max(controls.speedBar ?? 0, controls.pullingA ?? 0), 0, 1)
    const rearRiser = clamp(controls.rearRiser ?? 0, 0, 1)
    const commandedRad =
      this.designIncidenceRad +
      (-speedBar * wing.speedBarAngleDeg + rearRiser * wing.rearRiserAngleDeg) * DEG

    const error = commandedRad - incidenceRad
    const k = this.trussStiffnessNmPerRad
    const damping = 2 * 0.9 * Math.sqrt(k * this.canopy.inertiaBody.x)

    // Nose-down is +x, so an incidence above the commanded angle calls for a
    // nose-down moment. A nose-down moment also reduces incidence, which is
    // why the damping term carries a plus sign in this coordinate: resisting a
    // rising incidence means pitching the nose down.
    //
    // The truss holds the canopy's attitude only while the line set is loaded
    // and the canopy is flying. A slack set carries almost nothing, and a
    // stalled canopy is not much better: it has lost its internal pressure, it
    // luffs, and the rear rows go slack while the A rows stay loaded. That
    // asymmetry is why the recovery for a parachutal stall works on the A
    // risers, and why holding the attitude rigidly through a stall would leave
    // the wing descending vertically with no way out.
    const slackScale = this.state.linesSlack ? 0.15 : 1
    const stalledScale = 1 - 0.5 * clamp(this.meanSeparation, 0, 1)
    const rawMoment = (-k * error + damping * incidenceRate) * slackScale * stalledScale

    // A line set can only deliver what its tension allows. Bounding the moment
    // by the load actually in the lines stops a transient from asking the
    // truss for a force no rope could apply.
    const carryableNm =
      Math.max(this.state.lineTensionN, this.pilotMassKg * GRAVITY) * this.trussArmM * 2
    const moment = clamp(rawMoment, -carryableNm, carryableNm)
    this.lastTrussMomentNm = moment

    // The truss applies no free torque: it works by carrying more load on one
    // line row than the other. Both rows run to the same carabiner, so the
    // differential makes a couple at the canopy while the pilot feels only the
    // small force from the two rows pulling in slightly different directions,
    // which is the tug you feel in the harness when you push the bar.
    const foreCanopy = this.worldPoint(this.canopy, v3(0, this.attachLeftBody.y, this.foreZ))
    const aftCanopy = this.worldPoint(this.canopy, v3(0, this.attachLeftBody.y, this.aftZ))
    const carabiner = this.worldPoint(this.pilot, v3(0, this.hangDepthM, 0))

    const uFore = vNorm(vSub(carabiner, foreCanopy))
    const uAft = vNorm(vSub(carabiner, aftCanopy))

    // Differential tension that produces the required couple across the arm.
    const differentialN = moment / this.trussArmM
    const forceFore = vScale(uFore, differentialN)
    const forceAft = vScale(uAft, -differentialN)

    applyForceAtPoint(this.canopy, forceFore, vSub(foreCanopy, this.canopy.pos), dt)
    applyForceAtPoint(this.canopy, forceAft, vSub(aftCanopy, this.canopy.pos), dt)
    applyForceAtPoint(
      this.pilot,
      vScale(vAdd(forceFore, forceAft), -1),
      vSub(carabiner, this.pilot.pos),
      dt,
    )
  }

  /**
   * Risers resist being twisted. This is what keeps the pilot facing the same
   * way as the wing, and what makes a twist during a spin genuinely costly:
   * with the risers wound up, brake input no longer reaches the right side.
   */
  private applyTwistSpring(dt: number): void {
    const canopyFwd = qRotate(this.canopy.q, v3(0, 0, 1))
    const pilotFwd = qRotate(this.pilot.q, v3(0, 0, 1))
    const axis = this.riserAxisWorld()

    // Signed angle from canopy heading to pilot heading about the riser axis.
    const cp = vSub(canopyFwd, vScale(axis, vDot(canopyFwd, axis)))
    const pp = vSub(pilotFwd, vScale(axis, vDot(pilotFwd, axis)))
    if (vLen(cp) < 1e-3 || vLen(pp) < 1e-3) return
    const cpn = vNorm(cp)
    const ppn = vNorm(pp)
    const sin = vDot(vCross(cpn, ppn), axis)
    const cos = clamp(vDot(cpn, ppn), -1, 1)
    this.twistRad = Math.atan2(sin, cos)

    const relRate = vDot(vSub(qRotate(this.pilot.q, this.pilot.omega), qRotate(this.canopy.q, this.canopy.omega)), axis)

    // Torsional stiffness of a riser pair: soft for the first few degrees,
    // then much firmer as the risers wind onto each other.
    const k = 900 + 4200 * Math.min(1, Math.abs(this.twistRad) / 0.9)
    const c = 260
    const torqueMag = -k * this.twistRad - c * relRate
    applyTorquePair(this.pilot, this.canopy, vScale(axis, torqueMag), dt)
  }

  /** The harness hangs from the carabiners, so the pilot's up-axis follows the risers. */
  private applyHarnessAlignment(dt: number): void {
    const axis = this.riserAxisWorld()
    const pilotUp = qRotate(this.pilot.q, v3(0, 1, 0))
    const errorWorld = vCross(pilotUp, axis)
    // A harness and riser pair genuinely hold a pilot upright: you cannot tip
    // yourself over in the seat. Stiff, and damped close to critical.
    const k = 1600
    const c = 2 * 1.0 * Math.sqrt(k * 12)
    const omegaWorld = qRotate(this.pilot.q, this.pilot.omega)
    const perp = vSub(omegaWorld, vScale(axis, vDot(omegaWorld, axis)))
    const torqueWorld = vSub(vScale(errorWorld, k), vScale(perp, c))
    applyTorquePair(this.pilot, this.canopy, torqueWorld, dt)
  }

  /**
   * A real pilot damps the wing without thinking about it: they absorb a pitch
   * surge with a touch of brake and check a roll with their weight. This adds
   * only damping torques proportional to the canopy's rotation rate relative
   * to the pilot, so it can settle oscillation but can never generate lift,
   * speed or climb.
   */
  private applyPilotReflexes(skill: number, dt: number): void {
    if (skill <= 0) return
    const relPitch = this.canopy.omega.x - this.pilot.omega.x
    const relRoll = this.canopy.omega.z - this.pilot.omega.z
    const pitchDamp = 1400 * skill
    const rollDamp = 900 * skill
    const torqueWorld = qRotate(
      this.canopy.q,
      v3(-relPitch * pitchDamp, 0, -relRoll * rollDamp),
    )
    applyTorquePair(this.canopy, this.pilot, torqueWorld, dt)
  }

  // -------------------------------------------------------------------------
  // Riser constraints
  // -------------------------------------------------------------------------

  /**
   * The two riser groups, as the stiff elastic ties they actually are.
   *
   * A Dyneema line set stretches about two and a half centimetres under one g
   * over seven metres, so each group is a spring of roughly 20 kN/m. Modelling
   * that compliance rather than imposing a rigid distance does three useful
   * things: the lines sit slightly stretched in normal flight instead of
   * flickering on and off at exactly their rest length, the tension comes
   * straight out as a force for the instruments and the feel of the harness,
   * and a snatch load after a slack-line moment is a real transient.
   *
   * They pull and never push. At low or negative g they go slack, the canopy
   * is free to fall behind the pilot, and it comes taut again with a bang.
   *
   * Weight shift enters here as geometry: moving the pilot's centre of mass
   * sideways relative to the carabiners loads one group harder than the other,
   * and that asymmetry banks the canopy.
   */
  private applyRiserForces(controls: FlightControls, dt: number): { left: number; right: number } {
    const wing = this.wingRef
    const shift = clamp(controls.weightShift, -1, 1) * wing.weightShiftMeters

    // Carabiners relative to the pilot CG. Shifting the pilot's hips right is
    // the same as moving the carabiners left relative to their mass.
    const carabinerLocal = [
      v3(-this.riserHalfWidthM - shift, this.hangDepthM, 0),
      v3(this.riserHalfWidthM - shift, this.hangDepthM, 0),
    ]
    const attachLocal = [this.attachLeftBody, this.attachRightBody]

    // Big ears pull the outer A lines, not the riser group itself, so the rest
    // length is unchanged. The asymmetry of a single ear comes entirely from
    // the aerodynamics of the folded tip.

    const tension = [0, 0]

    for (let side = 0; side < 2; side++) {
      const canopyPoint = this.worldPoint(this.canopy, attachLocal[side])
      const pilotPoint = this.worldPoint(this.pilot, carabinerLocal[side])
      const rCanopy = vSub(canopyPoint, this.canopy.pos)
      const rPilot = vSub(pilotPoint, this.pilot.pos)

      const d = vSub(canopyPoint, pilotPoint)
      const dist = vLen(d)
      if (dist < 1e-4) continue
      const n = vScale(d, 1 / dist)

      const stretch = dist - this.riserLengthM
      if (stretch <= 0) continue

      // Rate of stretch, from the velocities of the two attachment points.
      const separationRate = vDot(
        vSub(pointVelocity(this.canopy, rCanopy), pointVelocity(this.pilot, rPilot)),
        n,
      )

      const force = Math.max(0, RISER_STIFFNESS_N_PER_M * stretch + RISER_DAMPING_NS_PER_M * separationRate)
      tension[side] = force

      // The group pulls the canopy down toward the pilot and the pilot up
      // toward the canopy.
      applyForceAtPoint(this.canopy, vScale(n, -force), rCanopy, dt)
      applyForceAtPoint(this.pilot, vScale(n, force), rPilot, dt)
    }

    return { left: tension[0], right: tension[1] }
  }

  private worldPoint(body: Body, localPoint: V3): V3 {
    return vAdd(body.pos, qRotate(body.q, localPoint))
  }

  // -------------------------------------------------------------------------
  // Collapse
  // -------------------------------------------------------------------------

  /**
   * Cells lose pressure when the local angle of attack goes negative, and they
   * reinflate when it comes back. A collapsed side loses its lift and gains a
   * lot of drag, which yaws and rolls the wing toward the collapse: the thing
   * a pilot actually has to catch.
   */
  private updateCollapse(aero: WingAeroResult, dt: number): void {
    const panels = aero.panels
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i]
      const q = 0.5 * this.rho * panel.airspeedMps * panel.airspeedMps

      // A ram-air canopy holds its shape with the air its inlets scoop up, so
      // it keeps that shape only while the inlets face the oncoming flow. Once
      // the local angle of attack drops below about -5 degrees the leading
      // edge gives way and the front tucks under. Accelerated flight sits
      // closer to that edge, which is why tucks happen on bar.
      const pressureMargin = panel.alphaDeg + 5
      let target = 0
      if (pressureMargin < 0 && q > 20) {
        target = clamp(-pressureMargin / 7, 0, 1)
      }
      // Low internal pressure makes a wing far easier to collapse, which is
      // why accelerated flight in rough air is where tucks happen.
      if (q < 60) target *= 0.6

      const current = this.collapse[i]
      if (target > current) {
        // Collapses happen fast.
        this.collapse[i] = Math.min(target, current + 9 * dt)
      } else {
        // Reinflation needs pressure and takes closer to a second.
        const rate = 0.6 + (q / 200) * 1.6
        this.collapse[i] = Math.max(0, current - rate * dt)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Ground
  // -------------------------------------------------------------------------

  /**
   * Lets a stalled canopy re-pressurise once the pilot releases the brakes.
   *
   * This stands in for physics the model does not carry. A ram-air canopy in a
   * deep stall has lost its internal pressure and its shape; what brings it
   * back is the cells refilling as the trailing edge comes up, and the canopy
   * regaining enough form to fly. None of that shape change is simulated
   * here -- the canopy is a rigid body with a panel polar -- and without
   * something standing in for it the model settles into a parachutal descent
   * at about seven metres a second that is a genuine equilibrium and cannot be
   * escaped: reattaching the flow needs forward speed, and gaining forward
   * speed needs the flow attached.
   *
   * Parachutal stall is a real and dangerous paraglider state, so it should
   * bite: the wing loses its glide, descends fast and stops responding. But a
   * real one usually ends when the pilot takes their hands up, and so does
   * this one. Brakes released plus enough airflow for about a second and a
   * half re-establishes attached flow, and the wing comes out with the surge
   * the stored energy deserves.
   */
  private updatePressureRecovery(controls: FlightControls, dt: number): void {
    if (this.reattachGraceSec > 0) {
      this.reattachGraceSec -= dt
      return
    }

    const brake = Math.max(clamp(controls.leftBrake, 0, 1), clamp(controls.rightBrake, 0, 1))
    const airspeed = vLen(this.canopy.vel)
    const releasedAndFlying = brake < 0.15 && airspeed > 4 && this.meanSeparation > 0.5

    if (!releasedAndFlying) {
      this.pressureRecoverySec = 0
      return
    }

    this.pressureRecoverySec += dt
    if (this.pressureRecoverySec >= 1.2) {
      // Hands have been up long enough for the cells to refill. Hold the flow
      // attached for a couple of seconds so the wing can build the speed that
      // brings its angle of attack back down on its own.
      this.reattachGraceSec = 2.0
      this.pressureRecoverySec = 0
      for (const section of this.sections) section.separated = false
      // Cells refilling also means the canopy regains its shape.
      for (let i = 0; i < this.collapse.length; i++) this.collapse[i] = 0
    }
  }

  private updateGround(sampleTerrainHeight: TerrainSampler): void {
    const terrainY = sampleTerrainHeight ? sampleTerrainHeight(this.pilot.pos.x, this.pilot.pos.z) : 0
    const clearance = this.pilot.pos.y - terrainY
    this.state.groundClearanceM = Math.max(0, clearance)

    if (clearance > 0.35) {
      if (this.state.contact !== 'crashed') this.state.contact = 'airborne'
      return
    }

    const descentMps = -this.pilot.vel.y
    const horizontalMps = Math.hypot(this.pilot.vel.x, this.pilot.vel.z)

    // A paraglider landing is survivable up to a surprisingly firm touchdown;
    // beyond that it is a crash.
    if (descentMps > 6.5 || horizontalMps > 24) {
      this.state.contact = 'crashed'
      return
    }

    // Plant the pilot on the surface and bleed off speed through the feet.
    this.pilot.pos = v3(this.pilot.pos.x, terrainY + 0.35, this.pilot.pos.z)
    if (this.pilot.vel.y < 0) this.pilot.vel = v3(this.pilot.vel.x, 0, this.pilot.vel.z)
    const friction = 0.86
    this.pilot.vel = v3(this.pilot.vel.x * friction, this.pilot.vel.y, this.pilot.vel.z * friction)

    this.state.contact = horizontalMps < 2.5 ? 'landed' : 'touching'
  }

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  private blankState(): FlightDynamicsState {
    return {
      canopyPos: v3(),
      canopyVel: v3(),
      canopyQuat: { x: 0, y: 0, z: 0, w: 1 },
      canopyOmega: v3(),
      pilotPos: v3(),
      pilotVel: v3(),
      pilotQuat: { x: 0, y: 0, z: 0, w: 1 },
      alphaDeg: 0,
      airspeedMps: 0,
      equivalentAirspeedMps: 0,
      verticalSpeedMps: 0,
      groundSpeedMps: 0,
      glideRatio: 0,
      headingDeg: 0,
      pitchDeg: 0,
      bankDeg: 0,
      gForce: 1,
      lineTensionN: 0,
      leftLineTensionN: 0,
      rightLineTensionN: 0,
      linesSlack: false,
      riserTwistDeg: 0,
      collapse: new Array(PANEL_COUNT).fill(0),
      leftCollapse: 0,
      rightCollapse: 0,
      stallWarning: 0,
      leftSeparated: false,
      rightSeparated: false,
      isStalled: false,
      isSpinning: false,
      asymmetricStallSide: 'none',
      leftBrakeForceN: 0,
      rightBrakeForceN: 0,
      incidenceDeg: 0,
      thrustN: 0,
      groundClearanceM: 1000,
      contact: 'airborne',
    }
  }

  private syncState(
    aero: WingAeroResult | null,
    leftTensionN: number,
    rightTensionN: number,
  ): void {
    const s = this.state
    s.canopyPos = { ...this.canopy.pos }
    s.canopyVel = { ...this.canopy.vel }
    s.canopyQuat = { ...this.canopy.q }
    s.canopyOmega = { ...this.canopy.omega }
    s.pilotPos = { ...this.pilot.pos }
    s.pilotVel = { ...this.pilot.vel }
    s.pilotQuat = { ...this.pilot.q }

    const fwd = qRotate(this.canopy.q, v3(0, 0, 1))
    const right = qRotate(this.canopy.q, v3(1, 0, 0))
    const up = qRotate(this.canopy.q, v3(0, 1, 0))
    s.headingDeg = (Math.atan2(fwd.x, fwd.z) / DEG + 360) % 360
    s.pitchDeg = -Math.asin(clamp(fwd.y, -1, 1)) / DEG
    s.bankDeg = Math.atan2(-right.y, up.y) / DEG

    s.airspeedMps = vLen(this.canopy.vel)
    s.equivalentAirspeedMps = s.airspeedMps * Math.sqrt(this.rho / AIR_DENSITY_SEA_LEVEL)
    s.verticalSpeedMps = this.canopy.vel.y
    s.groundSpeedMps = Math.hypot(this.canopy.vel.x, this.canopy.vel.z)
    s.glideRatio =
      this.canopy.vel.y < -0.05 ? s.groundSpeedMps / -this.canopy.vel.y : 99

    s.leftLineTensionN = leftTensionN
    s.rightLineTensionN = rightTensionN
    s.lineTensionN = leftTensionN + rightTensionN
    const weightN = this.pilot.massKg * GRAVITY
    s.linesSlack = s.lineTensionN < weightN * 0.25
    s.riserTwistDeg = this.twistRad / DEG

    // Felt load: the riser pull plus thrust and body drag, over weight.
    s.gForce = clamp(s.lineTensionN / Math.max(1, weightN), 0, 8)

    s.collapse = this.collapse.slice()
    let leftCollapse = 0
    let rightCollapse = 0
    for (let i = 0; i < this.collapse.length; i++) {
      if (this.model.panels[i].isLeft) leftCollapse = Math.max(leftCollapse, this.collapse[i])
      else rightCollapse = Math.max(rightCollapse, this.collapse[i])
    }
    s.leftCollapse = leftCollapse
    s.rightCollapse = rightCollapse

    if (aero) {
      s.alphaDeg = aero.meanAlphaDeg
      s.stallWarning = aero.stallWarning
      s.leftSeparated = aero.leftSeparated
      s.rightSeparated = aero.rightSeparated
      s.isStalled = aero.leftSeparated && aero.rightSeparated
      s.leftBrakeForceN = aero.leftBrakeForceN
      s.rightBrakeForceN = aero.rightBrakeForceN
      s.asymmetricStallSide =
        aero.leftSeparated && !aero.rightSeparated
          ? 'left'
          : aero.rightSeparated && !aero.leftSeparated
            ? 'right'
            : 'none'
      // A spin is an asymmetric stall with the wing rotating about its own axis.
      s.isSpinning = s.asymmetricStallSide !== 'none' && Math.abs(this.canopy.omega.y) > 0.5
    }
  }
}

// ---------------------------------------------------------------------------
// Small quaternion helpers used only for placement
// ---------------------------------------------------------------------------

function mulQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

function normalizeQuat(q: Quat): Quat {
  const len = Math.hypot(q.x, q.y, q.z, q.w) || 1
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len }
}
