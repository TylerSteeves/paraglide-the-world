import type {
  AtmosphereState,
  CanopyState,
  FlightControls,
  FlightTelemetry,
  PilotState,
} from './types'
import { clamp, computeAeroForces, STANDARD_WING, type WingGeometry } from './aerodynamics'

export class ParagliderSimulation {
  public canopy: CanopyState
  public pilot: PilotState
  public controls: FlightControls
  public atmosphere: AtmosphereState
  public telemetry: FlightTelemetry
  public isStalled: boolean = false
  public isSpinning: boolean = false
  public asymmetricStallSide: 'none' | 'left' | 'right' = 'none'
  public leftWingCollapse: number = 0
  public rightWingCollapse: number = 0
  public leftLineTensionNewtons: number = 430
  public rightLineTensionNewtons: number = 430
  public isCrashed: boolean = false
  public isLinesSlack: boolean = false
  public lineTensionNewtons: number = 860
  public tumbleStreak: number = 0
  public cumulativePitchDeg: number = 0
  public lastTumblePitchDeg: number = 0
  public slackTimer: number = 0
  public stallTime: number = 0
  public surgeTimer: number = 0
  public groundClearanceMeters: number = 100
  public isFootDragging: boolean = false
  private wing: WingGeometry

  constructor(
    initialAltitude: number = 2050, // Launch high up on alpine peak
    initialHeadingDeg: number = 5, // Facing down toward the valley and coastal dunes
  ) {
    this.wing = { ...STANDARD_WING }

    const headingRad = (initialHeadingDeg * Math.PI) / 180
    const trimSpeedMps = this.wing.trimSpeedKmh / 3.6

    this.canopy = {
      position: { x: 0, y: initialAltitude, z: 0 },
      velocity: {
        x: Math.sin(headingRad) * trimSpeedMps,
        y: -2.2, // speedwing trim sink ~2.2 m/s
        z: Math.cos(headingRad) * trimSpeedMps,
      },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      rollDeg: 0,
      pitchDeg: 4.5, // slight nose-down trim dive
      yawDeg: initialHeadingDeg,
      airspeedKmh: this.wing.trimSpeedKmh,
      verticalSpeedMps: -2.2,
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
      velocity: {
        x: Math.sin(headingRad) * trimSpeedMps,
        y: -2.2,
        z: Math.cos(headingRad) * trimSpeedMps,
      },
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
      windHeadingDeg: 190, // gentle sea/valley breeze
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
      verticalSpeedMps: -2.2,
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
    }
  }

  public reset(
    initialAltitude: number = 2050,
    initialHeadingDeg: number = 5,
    startPos?: { x: number; y: number; z: number },
  ): void {
    const headingRad = (initialHeadingDeg * Math.PI) / 180
    const trimSpeedMps = this.wing.trimSpeedKmh / 3.6
    const spawn = startPos ?? { x: 0, y: initialAltitude, z: 0 }

    this.canopy.position = { ...spawn }
    this.canopy.velocity = {
      x: Math.sin(headingRad) * trimSpeedMps,
      y: -2.2,
      z: Math.cos(headingRad) * trimSpeedMps,
    }
    this.canopy.rollDeg = 0
    this.canopy.pitchDeg = 4.5
    this.canopy.yawDeg = initialHeadingDeg
    this.canopy.airspeedKmh = this.wing.trimSpeedKmh
    this.canopy.verticalSpeedMps = -2.2
    this.canopy.asymmetricStallSide = 'none'
    this.canopy.isNegativeSpin = false
    this.canopy.leftWingCollapse = 0
    this.canopy.rightWingCollapse = 0

    this.pilot.position = {
      x: spawn.x,
      y: spawn.y - this.wing.tetherLengthMeters,
      z: spawn.z,
    }
    this.pilot.velocity = { ...this.canopy.velocity }
    this.pilot.pendulumRollDeg = 0
    this.pilot.pendulumPitchDeg = 0
    this.pilot.angularVelocityRoll = 0
    this.pilot.angularVelocityPitch = 0
    this.pilot.gForce = 1.0
    this.pilot.reverseStanceYawDeg = 0
    this.pilot.isFootDragging = false

    this.isCrashed = false
    this.isStalled = false
    this.isSpinning = false
    this.asymmetricStallSide = 'none'
    this.isLinesSlack = false
    this.tumbleStreak = 0
    this.cumulativePitchDeg = 0
    this.lastTumblePitchDeg = 0

    this.telemetry.altitudeMeters = spawn.y
    this.telemetry.score = 0
    this.telemetry.ringsCollected = 0
    this.telemetry.tumbleStreak = 0
    this.telemetry.flightDurationSeconds = 0
  }

  public step(dt: number, sampleTerrainHeight: (x: number, z: number) => number): void {
    const terrainH = sampleTerrainHeight(this.pilot.position.x, this.pilot.position.z)
    this.update(dt, terrainH)
  }

  public update(dt: number, terrainHeightMeters: number = 0): void {
    if (this.isCrashed) return
    const clampedDt = Math.min(dt, 0.05)
    this.telemetry.flightDurationSeconds += clampedDt

    const totalMass = this.wing.massKg + this.wing.pilotMassKg // 96.5 kg
    const pilotMass = this.wing.pilotMassKg // 88.0 kg
    const tetherR = this.wing.tetherLengthMeters // 5.3 m
    const g = 9.80665

    // Terrain clearance
    this.groundClearanceMeters = Math.max(0, this.pilot.position.y - terrainHeightMeters)
    this.telemetry.groundClearanceMeters = this.groundClearanceMeters
    this.telemetry.terrainHeightMeters = terrainHeightMeters
    this.telemetry.altitudeMeters = this.pilot.position.y

    // Crash condition
    if (this.pilot.position.y <= terrainHeightMeters + 0.3 && this.canopy.velocity.y < -7.0) {
      this.isCrashed = true
      return
    }

    // Foot drag detection (skimming sand / grass)
    this.isFootDragging = this.groundClearanceMeters < 1.2 && !this.isCrashed
    this.pilot.isFootDragging = this.isFootDragging

    // Reverse stance transition (0° forward to 180° reverse kiting)
    const targetReverseYaw = this.controls.reverseStance ? 180.0 : 0.0
    this.pilot.reverseStanceYawDeg +=
      (targetReverseYaw - this.pilot.reverseStanceYawDeg) * 8.0 * clampedDt
    this.telemetry.isReverseStance = this.controls.reverseStance

    // Effective control mapping (crossed when in reverse stance)
    const effectiveLeftBrake = this.controls.reverseStance
      ? this.controls.rightBrake
      : this.controls.leftBrake
    const effectiveRightBrake = this.controls.reverseStance
      ? this.controls.leftBrake
      : this.controls.rightBrake
    const effectiveWeightShift = this.controls.reverseStance
      ? -this.controls.weightShift
      : this.controls.weightShift

    // 1. Airspeed and Relative Wind
    const vxRel = this.canopy.velocity.x - this.atmosphere.windVector.x
    const vyRel = this.canopy.velocity.y - this.atmosphere.windVector.y
    const vzRel = this.canopy.velocity.z - this.atmosphere.windVector.z
    const airspeedMps = Math.sqrt(vxRel * vxRel + vyRel * vyRel + vzRel * vzRel)
    this.canopy.airspeedKmh = Math.max(1.0, airspeedMps * 3.6)

    // 2. Aerodynamic Forces with Ground Effect
    const aeroControls: FlightControls = {
      ...this.controls,
      leftBrake: effectiveLeftBrake,
      rightBrake: effectiveRightBrake,
      weightShift: effectiveWeightShift,
    }
    const aero = computeAeroForces(
      this.canopy.airspeedKmh,
      this.canopy.angleOfAttackDeg,
      aeroControls,
      this.groundClearanceMeters,
      this.wing,
    )

    this.isStalled = aero.isFullStall
    this.isSpinning = aero.isSpinning
    this.asymmetricStallSide = aero.asymmetricStallSide
    this.canopy.asymmetricStallSide = aero.asymmetricStallSide
    this.canopy.isNegativeSpin = aero.isSpinning
    this.canopy.leftWingCollapse = aero.leftCollapse
    this.canopy.rightWingCollapse = aero.rightCollapse

    // 3. True Centrifugal Line Tension & Pendulum Dynamics
    // In polar pendulum coordinates:
    // pitch theta: 0 = hanging straight below, + = pitched back/up, - = swinging forward
    const pitchRad = (this.pilot.pendulumPitchDeg * Math.PI) / 180
    const rollRad = (this.canopy.rollDeg * Math.PI) / 180

    // Angular velocity in pitch and roll (rad/s)
    const omegaPitch = (this.pilot.angularVelocityPitch * Math.PI) / 180
    const omegaRoll = (this.pilot.angularVelocityRoll * Math.PI) / 180

    // Centrifugal acceleration pulling pilot outward along tether lines:
    // a_centrifugal = (omega_pitch^2 + omega_roll^2) * R + (v_tangential^2 / R)
    const vTangential = Math.abs(omegaPitch) * tetherR + (airspeedMps * 0.4)
    const aCentrifugal =
      (omegaPitch * omegaPitch + omegaRoll * omegaRoll) * tetherR +
      (vTangential * vTangential) / (tetherR * 3.5)

    // Normal line tension along tether: T = m * (g * cos(pitch) * cos(roll) + a_centrifugal)
    const effectiveGComponent = g * Math.cos(pitchRad) * Math.cos(rollRad)
    const rawTension = pilotMass * (effectiveGComponent + aCentrifugal)

    this.lineTensionNewtons = Math.max(0, rawTension)
    this.telemetry.lineTensionNewtons = this.lineTensionNewtons

    // Line slack check: If tension drops below 40N (e.g. attempting to invert without sufficient speed)
    if (this.lineTensionNewtons < 40 && Math.abs(this.pilot.pendulumPitchDeg) > 60) {
      this.isLinesSlack = true
      this.slackTimer = 0.65
    }
    if (this.slackTimer > 0) {
      this.slackTimer -= clampedDt
      if (this.slackTimer <= 0) this.isLinesSlack = false
    }
    this.telemetry.isLinesSlack = this.isLinesSlack

    // Differential line tension for asymmetric turns & stalls
    const differentialLiftRatio = aero.rightLiftNewtons / Math.max(1, aero.leftLiftNewtons + aero.rightLiftNewtons)
    this.leftLineTensionNewtons = this.lineTensionNewtons * (1 - differentialLiftRatio)
    this.rightLineTensionNewtons = this.lineTensionNewtons * differentialLiftRatio
    this.telemetry.leftLineTensionNewtons = this.leftLineTensionNewtons
    this.telemetry.rightLineTensionNewtons = this.rightLineTensionNewtons

    // 4. Pilot G-Force Calculation
    const netRadialAccel = (this.lineTensionNewtons / pilotMass)
    this.pilot.gForce = clamp(netRadialAccel / g, 0.1, 7.5)
    this.telemetry.gForce = this.pilot.gForce

    // 5. Dynamic Roll Integration (Carve Turns & Wingovers)
    const targetRollDeg =
      this.asymmetricStallSide === 'left'
        ? -82.0
        : this.asymmetricStallSide === 'right'
        ? 82.0
        : (aero.rollTorque / (totalMass * 3.2)) * 57.2958 + (effectiveWeightShift * 42.0)

    const rollSpring = (targetRollDeg - this.canopy.rollDeg) * 7.5
    const rollDamping = -this.pilot.angularVelocityRoll * 3.8
    this.pilot.angularVelocityRoll += (rollSpring + rollDamping) * clampedDt
    this.canopy.rollDeg += this.pilot.angularVelocityRoll * clampedDt
    this.canopy.rollDeg = clamp(this.canopy.rollDeg, -88.0, 88.0)
    this.pilot.pendulumRollDeg = this.canopy.rollDeg * 0.85

    // Dynamic Pitch & Infinite Tumble Somersault Dynamics
    // In real aerobatics, a tumble loop requires high kinetic energy from a steep dive (>78 km/h).
    // At trim speed (50-65 km/h), symmetrical braking causes a gentle flare (pilot swings 20°-30°) and stalls.
    const symmetricBrake = Math.min(effectiveLeftBrake, effectiveRightBrake)
    const hasAcroEntrySpeed = this.canopy.airspeedKmh > 78.0
    const acroEnergyFactor = hasAcroEntrySpeed ? Math.pow((this.canopy.airspeedKmh - 78) / 30.0, 1.8) : 0
    const brakeSurgeTorque = symmetricBrake * (acroEnergyFactor * 680.0)
    const speedBarDiveTorque = -this.controls.speedBar * 210.0 // nose-down dive acceleration

    // Restoring gravity torque on pendulum: tau_g = -g * sin(pitch)
    // When lines are slack, restoring torque is absent (free tumbling pilot)
    const gravityRestoringTorque = this.isLinesSlack
      ? 0
      : -g * Math.sin(pitchRad) * (57.2958 / tetherR)

    // Rotational damping
    const pitchDamping = this.isLinesSlack
      ? -this.pilot.angularVelocityPitch * 0.8
      : -this.pilot.angularVelocityPitch * 2.2

    // Angular acceleration in pitch:
    const pitchAlpha = gravityRestoringTorque + brakeSurgeTorque + speedBarDiveTorque + pitchDamping
    this.pilot.angularVelocityPitch += pitchAlpha * clampedDt

    // Infinite Tumble Condition:
    // If pilot has high airspeed (>75 km/h) and pulls hard brakes, angular pitch rate spikes.
    // As long as lines maintain tension (a_c > g), allow full 360° rotation!
    this.pilot.pendulumPitchDeg += this.pilot.angularVelocityPitch * clampedDt
    this.cumulativePitchDeg += this.pilot.angularVelocityPitch * clampedDt

    // Detect full 360° tumble loops
    if (Math.abs(this.cumulativePitchDeg - this.lastTumblePitchDeg) >= 360.0) {
      if (this.lineTensionNewtons > 50 && !this.isLinesSlack) {
        this.tumbleStreak++
        this.telemetry.tumbleStreak = this.tumbleStreak
      }
      this.lastTumblePitchDeg = this.cumulativePitchDeg
    }

    // Wrap continuous visual pendulum pitch to [-180°, +180°]
    if (this.pilot.pendulumPitchDeg > 180.0) this.pilot.pendulumPitchDeg -= 360.0
    if (this.pilot.pendulumPitchDeg < -180.0) this.pilot.pendulumPitchDeg += 360.0

    // If lines went slack at low speed while inverted, damp pitch aggressively back toward gravity bottom
    if (this.isLinesSlack) {
      this.pilot.angularVelocityPitch *= 0.94
      this.pilot.pendulumPitchDeg *= 0.96
    }

    // 7. Turn Rate & Yaw Integration
    let turnRateDegPerSec = 0
    if (this.asymmetricStallSide === 'left') {
      turnRateDegPerSec = -240.0 // violent negative spin left
    } else if (this.asymmetricStallSide === 'right') {
      turnRateDegPerSec = 240.0 // violent negative spin right
    } else {
      // Coordinated turn kinematics: g * tan(roll) / V + differential drag yaw
      const rollRadClamped = (clamp(this.canopy.rollDeg, -80, 80) * Math.PI) / 180
      turnRateDegPerSec =
        ((g * Math.tan(rollRadClamped)) / Math.max(3.0, airspeedMps)) * 57.2958 +
        (aero.yawTorque / (totalMass * 1.4))
    }

    this.canopy.yawDeg = (this.canopy.yawDeg + turnRateDegPerSec * clampedDt + 360) % 360
    const currentYawRad = (this.canopy.yawDeg * Math.PI) / 180

    // 8. Canopy Visual Pitch Angle
    let targetCanopyPitchDeg = 5.5
    if (this.isStalled) {
      targetCanopyPitchDeg = -26.0
    } else if (this.isLinesSlack) {
      targetCanopyPitchDeg = 32.0 // forward collapse tuck
    } else {
      targetCanopyPitchDeg = this.pilot.pendulumPitchDeg * 0.75 + (5.5 - symmetricBrake * 8.0 + this.controls.speedBar * 5.0)
    }
    this.canopy.pitchDeg += (targetCanopyPitchDeg - this.canopy.pitchDeg) * 14.0 * clampedDt

    // 9. Accelerations & Velocity Integration (First Principles Energy Dynamics)
    const fwdX = Math.sin(currentYawRad)
    const fwdZ = Math.cos(currentYawRad)

    // Current horizontal speed
    const currentHorizSpeed = Math.sqrt(
      this.canopy.velocity.x * this.canopy.velocity.x +
      this.canopy.velocity.z * this.canopy.velocity.z,
    )

    // Speedwing Glide Polar & Altitude Conservation:
    // Steeper descent converts potential energy (mgh) into kinetic energy (1/2 mv^2)
    const baseGlideRatio = this.wing.glideRatio // 5.4:1
    const speedBarDegrade = this.controls.speedBar * 1.4
    const bankDegrade = (1 - Math.cos((this.canopy.rollDeg * Math.PI) / 180)) * 2.6
    const groundCushion = this.groundClearanceMeters < 3.0 ? (3.0 - this.groundClearanceMeters) * 1.8 : 0
    const flareCushion = symmetricBrake > 0.4 ? (symmetricBrake - 0.4) * 3.5 : 0

    let targetGlideRatio = Math.max(1.6, baseGlideRatio - speedBarDegrade - bankDegrade + groundCushion + flareCushion)
    if (this.isStalled) {
      targetGlideRatio = 0.55
    } else if (this.asymmetricStallSide !== 'none') {
      targetGlideRatio = 0.85
    }

    const equilibriumSinkMps = -Math.max(1.5, currentHorizSpeed) / targetGlideRatio
    const sinkDiff = equilibriumSinkMps - this.canopy.velocity.y
    const netAy = sinkDiff * 3.5 + (this.atmosphere.thermalUpdraftMps + this.atmosphere.ridgeLiftMps) * 0.4
    this.canopy.velocity.y += netAy * clampedDt
    this.canopy.velocity.y = clamp(this.canopy.velocity.y, -36.0, 18.0)
    this.canopy.verticalSpeedMps = this.canopy.velocity.y
    this.telemetry.verticalSpeedMps = this.canopy.verticalSpeedMps

    // Target horizontal speed with energy conversion
    const baseTrimMps = this.wing.trimSpeedKmh / 3.6 // 15.0 m/s (54 km/h)
    const speedBarBoost = this.controls.speedBar * 12.5 // accelerates up to 27.5 m/s (99 km/h)
    const diveKineticBoost = Math.max(0, -this.canopy.velocity.y * 0.85) // gravity dive conversion up to 125 km/h!
    const brakeDecel = symmetricBrake * 9.5 // braking decelerates
    const footDragFriction = this.isFootDragging ? 4.5 : 0 // foot drag friction

    let targetEquilibriumSpeed = baseTrimMps + speedBarBoost + diveKineticBoost - brakeDecel - footDragFriction
    if (this.isStalled) targetEquilibriumSpeed = 2.0
    else if (this.asymmetricStallSide !== 'none') targetEquilibriumSpeed = 4.0
    targetEquilibriumSpeed = Math.max(1.0, Math.min(36.0, targetEquilibriumSpeed))

    const horizSpeedDiff = targetEquilibriumSpeed - currentHorizSpeed
    const horizAccel = horizSpeedDiff * 2.8

    this.canopy.velocity.x += fwdX * horizAccel * clampedDt
    this.canopy.velocity.z += fwdZ * horizAccel * clampedDt

    // 10. Position Updates
    this.canopy.position.x += this.canopy.velocity.x * clampedDt
    this.canopy.position.y += this.canopy.velocity.y * clampedDt
    this.canopy.position.z += this.canopy.velocity.z * clampedDt

    // Pilot suspended beneath canopy along pendulum angles:
    const swingOffsetY = -tetherR * Math.cos(pitchRad)
    const swingOffsetFwd = tetherR * Math.sin(pitchRad)
    const swingOffsetLat = tetherR * Math.sin((this.pilot.pendulumRollDeg * Math.PI) / 180)

    this.pilot.position.x = this.canopy.position.x + fwdZ * swingOffsetLat + fwdX * swingOffsetFwd
    this.pilot.position.y = this.canopy.position.y + swingOffsetY
    this.pilot.position.z = this.canopy.position.z - fwdX * swingOffsetLat + fwdZ * swingOffsetFwd

    this.pilot.velocity.x = this.canopy.velocity.x
    this.pilot.velocity.y = this.canopy.velocity.y
    this.pilot.velocity.z = this.canopy.velocity.z

    // Telemetry updates
    const groundSpeedMps = Math.sqrt(
      this.canopy.velocity.x * this.canopy.velocity.x +
      this.canopy.velocity.z * this.canopy.velocity.z,
    )
    this.telemetry.airspeedKmh = this.canopy.airspeedKmh
    this.telemetry.groundSpeedKmh = groundSpeedMps * 3.6
    this.telemetry.glideRatio =
      Math.abs(this.canopy.velocity.y) > 0.1
        ? groundSpeedMps / Math.abs(this.canopy.velocity.y)
        : 9.9
    this.telemetry.distanceMeters += groundSpeedMps * clampedDt
  }
}
