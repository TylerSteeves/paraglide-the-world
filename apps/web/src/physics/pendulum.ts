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
  private wing: WingGeometry

  constructor(
    initialAltitude: number = 2050, // Launch high up on Whistler Peak
    initialHeadingDeg: number = 5, // Facing straight down the valley toward village
  ) {
    this.wing = { ...STANDARD_WING }

    const headingRad = (initialHeadingDeg * Math.PI) / 180
    const trimSpeedMps = this.wing.trimSpeedKmh / 3.6

    this.canopy = {
      position: { x: 0, y: initialAltitude, z: 0 },
      velocity: {
        x: Math.sin(headingRad) * trimSpeedMps,
        y: -1.5, // acro trim sink rate ~1.5 m/s
        z: Math.cos(headingRad) * trimSpeedMps,
      },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      rollDeg: 0,
      pitchDeg: -4, // slight nose-down trim pitch
      yawDeg: initialHeadingDeg,
      airspeedKmh: this.wing.trimSpeedKmh,
      verticalSpeedMps: -1.5,
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
      velocity: { ...this.canopy.velocity },
      pendulumRollDeg: 0,
      pendulumPitchDeg: 0,
      angularVelocityRoll: 0,
      angularVelocityPitch: 0,
      gForce: 1.0,
      harnessWeightShift: 0,
    }

    this.controls = {
      leftBrake: 0,
      rightBrake: 0,
      leftBrakeRate: 0,
      rightBrakeRate: 0,
      weightShift: 0,
      speedBar: 0,
    }

    this.atmosphere = {
      windVector: { x: -2.0, y: 0, z: 3.5 },
      windSpeedKmh: 14.0,
      windHeadingDeg: 300,
      turbulence: 0.15,
      thermalUpdraftMps: 0,
      ridgeLiftMps: 0,
    }

    this.telemetry = {
      altitudeMeters: initialAltitude,
      terrainHeightMeters: 0,
      groundClearanceMeters: initialAltitude,
      airspeedKmh: this.wing.trimSpeedKmh,
      groundSpeedKmh: this.wing.trimSpeedKmh,
      verticalSpeedMps: -1.5,
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
    }
  }

  public step(dt: number, sampleTerrainHeight: (x: number, z: number) => number) {
    const clampedDt = clamp(dt, 0.001, 0.05) // prevent physics explosions on frame spikes
    const totalMass = this.wing.massKg + this.wing.pilotMassKg
    const g = 9.81

    // 1. Current airspeed relative to wind
    const relVx = this.canopy.velocity.x - this.atmosphere.windVector.x
    const relVy = this.canopy.velocity.y - this.atmosphere.windVector.y
    const relVz = this.canopy.velocity.z - this.atmosphere.windVector.z
    const airspeedMps = Math.sqrt(relVx * relVx + relVy * relVy + relVz * relVz)
    this.canopy.airspeedKmh = airspeedMps * 3.6

    // 2. Flight path and Angle of Attack
    const horizSpeed = Math.sqrt(relVx * relVx + relVz * relVz)
    const flightPathAngleDeg = (Math.atan2(relVy, Math.max(0.1, horizSpeed)) * 180) / Math.PI
    this.canopy.angleOfAttackDeg = this.canopy.pitchDeg - flightPathAngleDeg

    // 3. Compute aerodynamic forces on canopy
    const aero = computeAeroForces(
      this.canopy.airspeedKmh,
      this.canopy.angleOfAttackDeg,
      this.controls,
      this.wing,
    )

    // Visual trailing edge deformation follows brake position with slight spring lag
    this.canopy.leftTrailingEdgeFlex +=
      (this.controls.leftBrake - this.canopy.leftTrailingEdgeFlex) * 18 * clampedDt
    this.canopy.rightTrailingEdgeFlex +=
      (this.controls.rightBrake - this.canopy.rightTrailingEdgeFlex) * 18 * clampedDt

    this.isStalled = aero.isFullStall
    this.isSpinning = aero.isSpinning
    this.asymmetricStallSide = aero.asymmetricStallSide
    this.leftWingCollapse = aero.leftCollapse
    this.rightWingCollapse = aero.rightCollapse
    this.canopy.leftWingCollapse = aero.leftCollapse
    this.canopy.rightWingCollapse = aero.rightCollapse
    this.canopy.asymmetricStallSide = aero.asymmetricStallSide
    this.canopy.isNegativeSpin = aero.isSpinning

    const nowStalled = this.isStalled || this.asymmetricStallSide !== 'none'
    if (nowStalled) {
      this.stallTime += clampedDt
    } else {
      if (this.stallTime > 0.25) {
        // Just released brakes from stall: Arm forward surge dive!
        this.surgeTimer = 1.3
      }
      this.stallTime = 0
      if (this.surgeTimer > 0) {
        this.surgeTimer -= clampedDt
      }
    }

    // 4. Two-Body Pendulum Coupling & Cable Tension (T)
    const pilotTether = this.wing.tetherLengthMeters
    const pilotPitchRad = (this.pilot.pendulumPitchDeg * Math.PI) / 180
    const omegaPitch = (this.pilot.angularVelocityPitch * Math.PI) / 180 // rad/s

    // Cable Tension: Centrifugal + Normal Gravity + Aero Lift
    const aCentrifugal = pilotTether * (omegaPitch * omegaPitch)
    const aGravityRadial = g * Math.cos(pilotPitchRad)
    const aAeroLift = ((aero.liftNewtons + aero.flareLift) / totalMass) * Math.max(0, Math.cos(pilotPitchRad))

    const aTensionTotal = aCentrifugal + aGravityRadial + aAeroLift
    this.lineTensionNewtons = Math.max(0, this.wing.pilotMassKg * aTensionTotal)

    // Slack Line Threshold: Lines go slack if tension falls below ~35N or in full stall
    if (aTensionTotal < 0.25 || this.lineTensionNewtons < 35 || this.isStalled) {
      this.isLinesSlack = true
      this.slackTimer += clampedDt
      this.tumbleStreak = 0
    } else {
      this.isLinesSlack = false
      this.slackTimer = Math.max(0, this.slackTimer - clampedDt * 2.5)
    }

    // Differential line tension per side (Asymmetric stall slacks inside lines!)
    if (this.isLinesSlack || this.isStalled) {
      this.leftLineTensionNewtons = 0
      this.rightLineTensionNewtons = 0
    } else if (this.asymmetricStallSide === 'left') {
      this.leftLineTensionNewtons = 0 // Left lines go completely slack!
      this.rightLineTensionNewtons = Math.max(25, this.lineTensionNewtons * 0.85)
    } else if (this.asymmetricStallSide === 'right') {
      this.rightLineTensionNewtons = 0 // Right lines go completely slack!
      this.leftLineTensionNewtons = Math.max(25, this.lineTensionNewtons * 0.85)
    } else {
      const wsBias =
        this.controls.weightShift * 0.16 +
        (this.controls.rightBrake - this.controls.leftBrake) * 0.12
      this.leftLineTensionNewtons = this.lineTensionNewtons * clamp(0.5 - wsBias, 0.2, 0.8)
      this.rightLineTensionNewtons = this.lineTensionNewtons * clamp(0.5 + wsBias, 0.2, 0.8)
    }

    // 5. ROLL DYNAMICS: "THE WING LEADS, THE BODY FOLLOWS"
    // The canopy is the aerodynamic lifting surface.
    // Differential brake creates yaw and dihedral bank into the turn.
    let targetCanopyRollDeg = 0
    if (this.asymmetricStallSide === 'left') {
      targetCanopyRollDeg = -38.0
    } else if (this.asymmetricStallSide === 'right') {
      targetCanopyRollDeg = 38.0
    } else {
      // Coordinated carving bank: driven by aerodynamic roll & yaw moments
      const aeroBankTarget = (aero.rollTorque / 18.0) + (aero.yawTorque / 85.0)
      targetCanopyRollDeg = clamp(aeroBankTarget, -60.0, 60.0)
    }

    // Aerodynamic roll response of the canopy
    const canopyRollRate =
      (targetCanopyRollDeg - this.canopy.rollDeg) * (this.isSpinning ? 10.0 : 7.2)
    this.canopy.rollDeg += canopyRollRate * clampedDt
    this.canopy.rollDeg = clamp(this.canopy.rollDeg, -62.0, 62.0)

    // The pilot is rigidly suspended by the cross-span line triangulation!
    // The pilot banks locked with the canopy, with subtle hip weight-shift (+/- 5.5 deg):
    this.pilot.pendulumRollDeg = this.controls.weightShift * 5.5
    this.pilot.angularVelocityRoll = canopyRollRate

    // 6. True Pendulum Pitch Dynamics (Heavy 88kg Pilot Plumb Bob, No Inversions)
    const symmetricPitchPump = Math.min(this.controls.leftBrake, this.controls.rightBrake)
    const speedBarInput = this.controls.speedBar

    // Gravity restoring acceleration: pulls 88kg pilot straight down beneath carabiners
    const gravityRestoring = -Math.sin(pilotPitchRad) * (g / pilotTether) * 1.8

    // Inertial response from canopy acceleration / deceleration
    // Flare/brakes: canopy decelerates -> pilot pendulum swings forward (+pitch)
    // Speed bar/dive: canopy accelerates -> pilot lags slightly behind (-pitch)
    const brakeSurgeSwing = symmetricPitchPump * 14.0
    const speedBarLagSwing = -speedBarInput * 6.0
    const targetPendulumDeg = brakeSurgeSwing + speedBarLagSwing

    // Heavy damping: Line tension and pilot body drag damp out pendulum oscillations quickly
    const damping = -this.pilot.angularVelocityPitch * 3.4
    const pitchSpring = (targetPendulumDeg - this.pilot.pendulumPitchDeg) * 8.5

    const pitchAlpha = gravityRestoring + pitchSpring + damping
    this.pilot.angularVelocityPitch += pitchAlpha * clampedDt
    this.pilot.pendulumPitchDeg += this.pilot.angularVelocityPitch * clampedDt

    // Hard physical constraint: A human seated in a paraglider harness CANNOT invert
    // Pendulum pitch is strictly bounded to realistic operational envelope [-16°, +18°]
    this.pilot.pendulumPitchDeg = clamp(this.pilot.pendulumPitchDeg, -16.0, 18.0)

    // 7. Turn Rate & Yaw Integration (Negative Spin on Asymmetric Stall)
    let turnRateDegPerSec = 0
    if (this.asymmetricStallSide === 'left') {
      // Violent negative flat spin to the left (stalled side)
      turnRateDegPerSec = -260.0
    } else if (this.asymmetricStallSide === 'right') {
      // Violent negative flat spin to the right (stalled side)
      turnRateDegPerSec = 260.0
    } else {
      // Coordinated turn kinematics: g * tan(roll) / V + differential drag yaw
      const rollRad = (this.canopy.rollDeg * Math.PI) / 180
      turnRateDegPerSec =
        ((g * Math.tan(clamp(rollRad, -1.35, 1.35))) / Math.max(2.5, airspeedMps)) * 57.2958 +
        (aero.yawTorque / (totalMass * 1.25))
    }

    this.canopy.yawDeg = (this.canopy.yawDeg + turnRateDegPerSec * clampedDt + 360) % 360
    const currentYawRad = (this.canopy.yawDeg * Math.PI) / 180

    // 8. Canopy Pitch Angle
    // In Babylon coordinate frame (+Z forward, +Y up, +X right):
    // Positive pitch around X rotates +Z downward (dive towards terrain)
    // Negative pitch around X rotates +Z upward (flare / stall back)
    let targetPitchDeg = 5.5 // Trim dive angle (glide ratio ~5.4:1)
    if (this.isStalled) {
      targetPitchDeg = -28.0 // Wing pitches back behind pilot in stall
    } else if (this.isLinesSlack) {
      targetPitchDeg = 24.0 // Canopy tucks forward and down in slack
    } else if (this.surgeTimer > 0) {
      targetPitchDeg = 34.0 // Forward surge dive
    } else {
      const trimAoAPitch = 5.5 - symmetricPitchPump * 7.5 + this.controls.speedBar * 4.5
      targetPitchDeg = this.pilot.pendulumPitchDeg + trimAoAPitch
    }
    this.canopy.pitchDeg += (targetPitchDeg - this.canopy.pitchDeg) * 16.0 * clampedDt

    // 9. Accelerations & Velocity Integration (First Principles 2-Body Dynamics)
    const fwdX = Math.sin(currentYawRad)
    const fwdZ = Math.cos(currentYawRad)
    const rollRad = (this.canopy.rollDeg * Math.PI) / 180

    // G-Force
    const bankG = 1 / Math.max(0.2, Math.cos(rollRad))
    let verticalAccelG = (aero.liftNewtons / (totalMass * g)) * Math.cos(rollRad)
    if (this.isStalled || this.isLinesSlack || this.isSpinning) {
      verticalAccelG = 0.3 // low G in stall / flat spin
    }
    this.pilot.gForce = clamp(
      bankG * 0.45 + verticalAccelG * 0.45 + (aCentrifugal / g) * 0.3,
      0.1,
      5.5,
    )

    // Updrafts
    const totalUpdraft =
      this.isStalled || this.isSpinning || this.isLinesSlack
        ? 0
        : (this.atmosphere.thermalUpdraftMps + this.atmosphere.ridgeLiftMps) * 0.3

    // Current horizontal airspeed
    const currentHorizSpeed = Math.sqrt(
      this.canopy.velocity.x * this.canopy.velocity.x +
        this.canopy.velocity.z * this.canopy.velocity.z,
    )

    // Realistic speedwing polar sink rate target (descending with mountain slope):
    const baseGlideRatio = this.wing.glideRatio // 5.4:1
    const speedBarDegrade = this.controls.speedBar * 1.1 // steeper dive on speed bar
    const flareCushion = symmetricPitchPump > 0.35 ? (symmetricPitchPump - 0.35) * 2.4 : 0
    const bankDegrade = (1 - Math.cos(rollRad)) * 2.8 // banked carving turns lose altitude faster

    let targetGlideRatio = Math.max(1.8, baseGlideRatio - speedBarDegrade - bankDegrade + flareCushion)
    if (this.isStalled) {
      targetGlideRatio = 0.5 // 88% lift drop -> freefall plummet
    } else if (this.asymmetricStallSide !== 'none') {
      targetGlideRatio = 0.9 // 70% lift drop -> spinning plummet
    }

    const equilibriumSinkMps = -Math.max(1.5, currentHorizSpeed) / targetGlideRatio
    const sinkDiff = equilibriumSinkMps - this.canopy.velocity.y
    const netAy = sinkDiff * 3.8 + totalUpdraft
    this.canopy.velocity.y += netAy * clampedDt
    this.canopy.velocity.y = clamp(this.canopy.velocity.y, -32.0, 16.0)

    // Equilibrium target horizontal speed
    const baseTrimMps = this.wing.trimSpeedKmh / 3.6 // 16.1 m/s (58.0 km/h)
    const speedBarBoost = this.controls.speedBar * 7.5 // up to 23.6 m/s (85 km/h)
    const brakeDecel = symmetricPitchPump * 7.2
    let targetEquilibriumSpeed = baseTrimMps + speedBarBoost - brakeDecel
    if (this.isStalled) {
      targetEquilibriumSpeed = 1.2
    } else if (this.asymmetricStallSide !== 'none') {
      targetEquilibriumSpeed = 3.5 // pivoting in place in negative flat spin
    }
    targetEquilibriumSpeed = Math.max(0.8, targetEquilibriumSpeed)

    // Forward drive from gravity dive
    const totalSpeed = Math.max(1.0, Math.sqrt(
      this.canopy.velocity.x * this.canopy.velocity.x +
      this.canopy.velocity.y * this.canopy.velocity.y +
      this.canopy.velocity.z * this.canopy.velocity.z
    ))
    const diveSin = Math.max(0, Math.min(1, -this.canopy.velocity.y / totalSpeed))
    const diveGravityAccel = this.isStalled || this.isSpinning ? 0 : g * diveSin * 1.65

    const speedDiff = targetEquilibriumSpeed - currentHorizSpeed
    const trimThrust = this.isStalled || this.isSpinning ? -12.0 : speedDiff * 2.5
    const netForwardAccel = trimThrust + diveGravityAccel

    this.canopy.velocity.x += (fwdX * netForwardAccel) * clampedDt
    this.canopy.velocity.z += (fwdZ * netForwardAccel) * clampedDt

    const minHorizMps = this.isStalled || this.isSpinning ? 0.3 : (this.wing.minSpeedKmh / 3.6) * 0.65
    const maxHorizMps = (this.wing.maxSpeedKmh / 3.6) + 4.0
    const clampedHoriz = clamp(currentHorizSpeed, minHorizMps, maxHorizMps)
    if (currentHorizSpeed > 0.01) {
      const scale = clampedHoriz / currentHorizSpeed
      this.canopy.velocity.x *= scale
      this.canopy.velocity.z *= scale
    }

    // Update positions
    this.canopy.position.x += this.canopy.velocity.x * clampedDt
    this.canopy.position.y += this.canopy.velocity.y * clampedDt
    this.canopy.position.z += this.canopy.velocity.z * clampedDt

    // 3D Rigid Truss Line Kinematics:
    // The suspension lines form a rigid cross-span triangle (9.8m span down to 0.44m carabiners).
    // The pilot hangs in the canopy's local reference frame, transformed to world space via the canopy orientation:
    const currentTether = pilotTether * (this.isLinesSlack ? Math.max(0.65, 1.0 - this.slackTimer * 0.45) : 1.0)
    const canopyPitchRad = (this.canopy.pitchDeg * Math.PI) / 180
    const canopyRollRad = (this.canopy.rollDeg * Math.PI) / 180
    const pilotRelPitchRad = (this.pilot.pendulumPitchDeg * Math.PI) / 180
    const weightShiftOffset = this.controls.weightShift * 0.16 // +/- 16cm hip weight-shift

    // Local pilot position in canopy reference frame:
    // lx: lateral weight shift (+Right, -Left)
    // ly: tether distance downward along line axis
    // lz: longitudinal pendulum swing (+Forward, -Aft)
    const lx = weightShiftOffset
    const ly = -currentTether * Math.cos(pilotRelPitchRad)
    const lz = currentTether * Math.sin(pilotRelPitchRad)

    // Euler YXZ rotation matching Babylon.js (yaw, pitch, -roll):
    const cYaw = Math.cos(currentYawRad)
    const sYaw = Math.sin(currentYawRad)
    const cPitch = Math.cos(canopyPitchRad)
    const sPitch = Math.sin(canopyPitchRad)
    const cRoll = Math.cos(-canopyRollRad)
    const sRoll = Math.sin(-canopyRollRad)

    // 1. Roll around Z (-canopyRollRad):
    const x1 = lx * cRoll - ly * sRoll
    const y1 = lx * sRoll + ly * cRoll
    const z1 = lz

    // 2. Pitch around X (canopyPitchRad):
    const x2 = x1
    const y2 = y1 * cPitch - z1 * sPitch
    const z2 = y1 * sPitch + z1 * cPitch

    // 3. Yaw around Y (currentYawRad):
    const wx = x2 * cYaw + z2 * sYaw
    const wy = y2
    const wz = -x2 * sYaw + z2 * cYaw

    this.pilot.position.x = this.canopy.position.x + wx
    this.pilot.position.y = this.canopy.position.y + wy
    this.pilot.position.z = this.canopy.position.z + wz

    // Terrain sampling & Ground Clearance
    const terrainHeight = sampleTerrainHeight(this.pilot.position.x, this.pilot.position.z)
    const clearance = this.pilot.position.y - terrainHeight

    // Telemetry updates
    this.telemetry.altitudeMeters = this.pilot.position.y
    this.telemetry.terrainHeightMeters = terrainHeight
    this.telemetry.groundClearanceMeters = Math.max(0, clearance)
    this.telemetry.airspeedKmh = this.canopy.airspeedKmh
    this.telemetry.groundSpeedKmh =
      Math.sqrt(
        this.canopy.velocity.x * this.canopy.velocity.x +
          this.canopy.velocity.z * this.canopy.velocity.z,
      ) * 3.6
    this.telemetry.verticalSpeedMps = this.canopy.velocity.y
    this.telemetry.glideRatio =
      this.canopy.velocity.y < -0.05
        ? this.telemetry.groundSpeedKmh / 3.6 / -this.canopy.velocity.y
        : 0
    this.telemetry.gForce = this.pilot.gForce
    this.telemetry.flightDurationSeconds += clampedDt
    this.telemetry.distanceMeters +=
      Math.sqrt(
        this.canopy.velocity.x * this.canopy.velocity.x +
          this.canopy.velocity.z * this.canopy.velocity.z,
      ) * clampedDt
    this.telemetry.lineTensionNewtons = Math.round(this.lineTensionNewtons)
    this.telemetry.leftLineTensionNewtons = Math.round(this.leftLineTensionNewtons)
    this.telemetry.rightLineTensionNewtons = Math.round(this.rightLineTensionNewtons)
    this.telemetry.isLinesSlack = this.isLinesSlack
    this.telemetry.asymmetricStallSide = this.asymmetricStallSide
    this.telemetry.isNegativeSpin = this.isSpinning
    this.telemetry.tumbleStreak = this.tumbleStreak

    // Crash detection upon hitting terrain
    if (clearance <= 0.9) {
      if (this.canopy.velocity.y < -3.6 || this.isStalled || Math.abs(this.canopy.rollDeg) > 65) {
        this.isCrashed = true
      }
    }
  }

  public reset(initialAltitude: number = 2050, initialHeadingDeg: number = 5) {
    this.isCrashed = false
    this.isStalled = false
    this.isSpinning = false
    this.asymmetricStallSide = 'none'
    this.leftWingCollapse = 0
    this.rightWingCollapse = 0
    this.leftLineTensionNewtons = 430
    this.rightLineTensionNewtons = 430
    this.isLinesSlack = false
    this.lineTensionNewtons = 860
    this.tumbleStreak = 0
    this.cumulativePitchDeg = 0
    this.lastTumblePitchDeg = 0
    this.slackTimer = 0
    this.stallTime = 0
    this.surgeTimer = 0

    const headingRad = (initialHeadingDeg * Math.PI) / 180
    const trimSpeedMps = this.wing.trimSpeedKmh / 3.6

    this.canopy.position = { x: 0, y: initialAltitude, z: 0 }
    this.canopy.velocity = {
      x: Math.sin(headingRad) * trimSpeedMps,
      y: -1.5,
      z: Math.cos(headingRad) * trimSpeedMps,
    }
    this.canopy.rollDeg = 0
    this.canopy.pitchDeg = -4
    this.canopy.yawDeg = initialHeadingDeg
    this.canopy.leftTrailingEdgeFlex = 0
    this.canopy.rightTrailingEdgeFlex = 0
    this.canopy.leftWingCollapse = 0
    this.canopy.rightWingCollapse = 0
    this.canopy.asymmetricStallSide = 'none'
    this.canopy.isNegativeSpin = false

    this.pilot.position = { x: 0, y: initialAltitude - this.wing.tetherLengthMeters, z: 0 }
    this.pilot.velocity = { ...this.canopy.velocity }
    this.pilot.pendulumRollDeg = 0
    this.pilot.pendulumPitchDeg = 0
    this.pilot.angularVelocityRoll = 0
    this.pilot.angularVelocityPitch = 0
    this.pilot.gForce = 1.0

    this.controls.leftBrake = 0
    this.controls.rightBrake = 0
    this.controls.weightShift = 0
  }
}
