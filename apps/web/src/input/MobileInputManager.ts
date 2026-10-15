import type { FlightControls } from '../physics/types'
import { HapticManager } from './HapticManager'

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export type ActiveTouchVisual = {
  id: number
  side: 'left' | 'right'
  anchorX: number
  anchorY: number
  currentX: number
  currentY: number
  deltaX: number
  deltaY: number
  brake: number
  speedBar: number
  zone: string
}

export type ControlMode = 'direct-tilt' | 'dual_toggle' | 'flight_stick'

export class MobileInputManager {
  public controls: FlightControls
  public haptics: HapticManager

  // State flags
  public isMotionActive: boolean = false
  public isNativeMotion: boolean = false
  public hasGyroPermission: boolean = false
  public isPortrait: boolean = true

  public smoothedRollDeg: number = 0
  public smoothedElevationDeg: number = 62.0
  public phoneElevationDeg: number = 62.0
  public neutralElevationDeg: number = 62.0
  public neutralRollDeg: number = 0.0
  public needAutoCalibration: boolean = true
  private autoCalibrateSampleCount: number = 0

  // Demands & Visual Telemetry
  public tiltWeightShift: number = 0 // -1.0 (left) to +1.0 (right)
  public diveDemand: number = 0       // 0 to 1.0 (pointing down = speed dive)
  public flareDemand: number = 0      // 0 to 1.0 (raising phone = flare/climb)
  public pitchDemand: number = 0      // -1 (flare) to +1 (dive)
  public isWingCollapsed: boolean = false
  public collapseFrac: number = 0
  public instantTwistRad: number = 0
  public snapIntensity: number = 0
  public tiltParallaxRoll: number = 0
  public tiltParallaxPitch: number = 0
  public leftLagFrac: number = 0
  public rightLagFrac: number = 0

  // Control mode & settings
  public controlMode: ControlMode = 'direct-tilt'
  public invertRollSteering: boolean = false // tilt left turns left, tilt right turns right
  public isCruiseLocked: boolean = false
  public targetThrottle: number = 0

  // Legacy touch visual placeholders for HUD / UI compatibility
  public leftThumbYFrac: number = 0
  public rightThumbYFrac: number = 0
  public activeTouchVisuals: ActiveTouchVisual[] = []

  // Callbacks
  public onToggleWing?: () => void
  public onCycleVantage?: () => void
  public onControlModeChange?: (mode: ControlMode) => void
  public onTriggerLoop?: () => void
  public onTriggerRoll?: (dir: number) => void

  public keysDown: Set<string> = new Set()
  private prevMotionTime: number = performance.now()

  constructor() {
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
    this.haptics = new HapticManager()
    this.setupListeners()
  }

  public async requestGyroPermission(): Promise<boolean> {
    if (typeof window === 'undefined') return false
    const DeviceOrientationEventAny = window.DeviceOrientationEvent as any

    if (typeof DeviceOrientationEventAny?.requestPermission === 'function') {
      try {
        const res = await DeviceOrientationEventAny.requestPermission()
        if (res === 'granted') {
          this.hasGyroPermission = true
          this.calibrateNeutral()
          return true
        }
      } catch (err) {
        console.warn('Gyro permission request failed:', err)
      }
      this.hasGyroPermission = false
      return false
    }

    // Android & standard desktop
    this.hasGyroPermission = true
    this.calibrateNeutral()
    return true
  }

  public calibrateNeutral(forceAngle?: number, forceRoll?: number) {
    if (typeof forceAngle === 'number' && forceAngle >= 45.0 && forceAngle <= 75.0) {
      this.neutralElevationDeg = forceAngle
    } else if (this.phoneElevationDeg >= 45.0 && this.phoneElevationDeg <= 75.0) {
      this.neutralElevationDeg = this.phoneElevationDeg
    } else {
      this.neutralElevationDeg = 62.0
    }

    if (typeof forceRoll === 'number') {
      this.neutralRollDeg = forceRoll
    } else if (Math.abs(this.smoothedRollDeg) < 22.0) {
      this.neutralRollDeg = this.smoothedRollDeg
    } else {
      this.neutralRollDeg = 0
    }

    this.smoothedElevationDeg = this.neutralElevationDeg
    this.needAutoCalibration = false
    this.autoCalibrateSampleCount = 0
    this.isWingCollapsed = false
    this.collapseFrac = 0
    this.diveDemand = 0
    this.flareDemand = 0
    this.tiltWeightShift = 0
    this.pitchDemand = 0
    this.controls.leftBrake = 0
    this.controls.rightBrake = 0
    this.controls.speedBar = 0
    this.controls.weightShift = 0
  }

  public requestAutoCalibration() {
    this.needAutoCalibration = true
    this.autoCalibrateSampleCount = 0
  }

  public setPullingA(active: boolean) {
    this.controls.pullingA = active ? 1.0 : 0
  }

  public setPullingB(active: boolean) {
    this.controls.pullingB = active ? 1.0 : 0
  }

  public setTargetThrottle(throttle: number) {
    this.targetThrottle = clamp(throttle, 0, 1)
  }

  public toggleCruiseLock(): boolean {
    this.isCruiseLocked = !this.isCruiseLocked
    return this.isCruiseLocked
  }

  public cycleControlMode(): ControlMode {
    this.controlMode = this.controlMode === 'direct-tilt' ? 'dual_toggle' : 'direct-tilt'
    this.onControlModeChange?.(this.controlMode)
    return this.controlMode
  }

  private setupListeners() {
    if (typeof window === 'undefined') return

    // 1. Device Orientation (Primary Motion Control)
    window.addEventListener(
      'deviceorientation',
      (e: DeviceOrientationEvent) => {
        if (e.gamma === null || e.beta === null) return
        this.isMotionActive = true

        const isPortrait = window.innerHeight >= window.innerWidth
        this.isPortrait = isPortrait
        const screenAngle =
          window.screen?.orientation?.angle ??
          (typeof window.orientation === 'number' ? window.orientation : (isPortrait ? 0 : 90))

        let rawRoll = 0
        let rawElev = 40.0

        if (screenAngle === 0 || screenAngle === 180 || isPortrait) {
          rawRoll = e.gamma
          rawElev = e.beta
        } else if (screenAngle === 90) {
          rawRoll = -e.beta
          rawElev = Math.abs(e.gamma)
        } else {
          rawRoll = e.beta
          rawElev = Math.abs(e.gamma)
        }

        const now = performance.now()
        const dt = Math.max(0.005, Math.min(0.08, (now - this.prevMotionTime) * 0.001))
        this.prevMotionTime = now

        this.processMotion(rawRoll, rawElev, dt)
      },
      true,
    )

    // 2. Keyboard fallback for desktop testing & aerobatics
    window.addEventListener('keydown', (e) => {
      this.keysDown.add(e.code)
      if (e.code === 'Space' || e.code === 'KeyF') {
        this.onTriggerLoop?.()
      } else if (e.code === 'KeyQ') {
        this.onTriggerRoll?.(-1)
      } else if (e.code === 'KeyE') {
        this.onTriggerRoll?.(1)
      }
    })
    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code)
    })

    // 3. Touch Screen Aerobatics: Double-tap & Quick Swipe
    let lastTapTime = 0
    let touchStartX = 0
    let touchStartY = 0
    let touchStartTime = 0

    window.addEventListener(
      'pointerdown',
      (e) => {
        touchStartX = e.clientX
        touchStartY = e.clientY
        touchStartTime = performance.now()
      },
      { passive: true },
    )

    window.addEventListener(
      'pointerup',
      (e) => {
        // Ignore if clicking on UI interactive buttons
        const target = e.target as HTMLElement | null
        if (target && target.closest && target.closest('button, .hud-pill, .guide-card, a')) {
          return
        }

        const now = performance.now()
        const dt = now - touchStartTime
        const dx = e.clientX - touchStartX
        const dy = e.clientY - touchStartY
        const dist = Math.hypot(dx, dy)

        // Fast Flick / Swipe gesture (< 350ms):
        if (dt < 350 && dist > 45) {
          if (Math.abs(dy) > Math.abs(dx) && dy < -40) {
            // Flick up -> Loop / Flip!
            this.onTriggerLoop?.()
            return
          } else if (Math.abs(dx) > Math.abs(dy)) {
            if (dx < -40) {
              this.onTriggerRoll?.(-1)
              return
            } else if (dx > 40) {
              this.onTriggerRoll?.(1)
              return
            }
          }
        }

        // Tap / Double-tap (< 250ms, < 20px movement):
        if (dt < 250 && dist < 20) {
          if (now - lastTapTime < 350) {
            // Double-tap detected!
            if (e.clientX < window.innerWidth * 0.3) {
              this.onTriggerRoll?.(-1) // Left barrel roll
            } else if (e.clientX > window.innerWidth * 0.7) {
              this.onTriggerRoll?.(1)  // Right barrel roll
            } else {
              this.onTriggerLoop?.()   // Center double-tap -> Loop / Flip!
            }
            lastTapTime = 0
          } else {
            lastTapTime = now
          }
        }
      },
      { passive: true },
    )
  }

  private processMotion(rawRoll: number, rawElev: number, dt: number) {
    // Clean low-pass filter (EMA, ~50ms tau)
    const rollFactor = 1.0 - Math.exp(-22.0 * dt)
    const elevFactor = 1.0 - Math.exp(-18.0 * dt)
    this.smoothedRollDeg += (rawRoll - this.smoothedRollDeg) * rollFactor
    this.smoothedElevationDeg += (rawElev - this.smoothedElevationDeg) * elevFactor
    this.phoneElevationDeg = this.smoothedElevationDeg

    // Capture resting neutral angle on initial steady frames after launch
    if (this.needAutoCalibration && this.smoothedElevationDeg >= 48.0 && this.smoothedElevationDeg <= 74.0) {
      this.autoCalibrateSampleCount++
      if (this.autoCalibrateSampleCount === 1) {
        this.neutralElevationDeg = this.smoothedElevationDeg
        this.neutralRollDeg = Math.abs(this.smoothedRollDeg) < 20.0 ? this.smoothedRollDeg : 0
      } else {
        this.neutralElevationDeg += (this.smoothedElevationDeg - this.neutralElevationDeg) * 0.25
        if (Math.abs(this.smoothedRollDeg) < 20.0) {
          this.neutralRollDeg += (this.smoothedRollDeg - this.neutralRollDeg) * 0.25
        }
      }
      if (this.autoCalibrateSampleCount >= 18) {
        this.needAutoCalibration = false
      }
    }

    // 1. Roll Steering & Rock-Solid Stability in Neutrality:
    // Natural human phone holding has slight resting asymmetry and tremor.
    // 1. Roll is measured relative to calibrated neutral resting posture (neutralRollDeg).
    // 2. Wide 5.5° deadband gives a firm, confident center detent (zero drift or wobble).
    // 3. Smoothstep Hermite curve (3x^2 - 2x^3) ensures zero slope discontinuity at deadband boundary.
    // 4. Subtle auto-trim slowly adapts neutralRollDeg when resting steadily in center.
    const rollDelta = this.smoothedRollDeg - this.neutralRollDeg
    const absRoll = Math.abs(rollDelta)

    if (absRoll < 3.5 && !this.needAutoCalibration) {
      // Gentle auto-trim while holding phone steady in the middle
      this.neutralRollDeg += (this.smoothedRollDeg - this.neutralRollDeg) * Math.min(1.0, 0.35 * dt)
    }

    const DEADBAND_ROLL = 5.5
    const MAX_ROLL = 26.0

    if (absRoll < DEADBAND_ROLL) {
      this.tiltWeightShift = 0
    } else {
      const sign = Math.sign(rollDelta)
      const norm = clamp((absRoll - DEADBAND_ROLL) / (MAX_ROLL - DEADBAND_ROLL), 0, 1)
      // Smoothstep curve (3x^2 - 2x^3) gives zero derivative at 0 for a velvety smooth departure from neutral
      const mag = norm * norm * (3.0 - 2.0 * norm)
      // Natural steering: tilt left turns left, tilt right turns right
      const steerSign = this.invertRollSteering ? -sign : sign
      this.tiltWeightShift = steerSign * mag
    }

    this.instantTwistRad = (this.tiltWeightShift * 0.12)

    // 2. Pitch & Wing Envelope:
    // - Upright resting angle (~62°): pure level trim glide (85 km/h down the slope)
    // - Deadband ±4.0° around neutral
    // - Tilt back / up (> neutral + deadband): flare, hover & float
    // - Point straight up (>= 90°): wing collapses into freefall plunge
    // - Lean forward (< neutral - deadband down to -25°): dive & spiral fast down to the ground!
    const neutral = clamp(this.neutralElevationDeg, 52.0, 72.0)
    const deadband = 4.0

    if (this.smoothedElevationDeg >= 90.0) {
      this.isWingCollapsed = true
    } else if (this.smoothedElevationDeg <= 84.0 && this.isWingCollapsed) {
      this.isWingCollapsed = false
    }

    if (this.isWingCollapsed) {
      this.diveDemand = 0
      this.flareDemand = 0
      this.pitchDemand = 0
    } else if (this.smoothedElevationDeg < neutral - deadband) {
      // Leaning forwards from (neutral - deadband) down through flat (0°) to -25°
      // Over 80° of pure forward lean freedom to spiral and dive fast down to the ground!
      const maxDownAngle = -25.0
      const diveTravel = (neutral - deadband) - maxDownAngle
      const norm = clamp((neutral - deadband - this.smoothedElevationDeg) / Math.max(12.0, diveTravel), 0, 1)
      this.diveDemand = Math.pow(norm, 1.15)
      this.flareDemand = 0
      this.pitchDemand = this.diveDemand
    } else if (this.smoothedElevationDeg > neutral + deadband) {
      // Looking slightly upwards: flares, hovers and floats
      const flareTravel = 88.0 - (neutral + deadband)
      const norm = clamp((this.smoothedElevationDeg - (neutral + deadband)) / Math.max(6.0, flareTravel), 0, 1)
      this.flareDemand = Math.pow(norm, 1.15)
      this.diveDemand = 0
      this.pitchDemand = -this.flareDemand
    } else {
      // Level Trim Glide
      this.diveDemand = 0
      this.flareDemand = 0
      this.pitchDemand = 0
    }
  }

  public update(dt: number, ..._rest: any[]): void {
    // 1. Steering & Roll:
    let netRoll = 0
    if (this.isMotionActive) {
      netRoll = this.tiltWeightShift
    } else {
      // Desktop keyboard fallback
      if (this.keysDown.has('ArrowLeft') || this.keysDown.has('KeyA')) netRoll -= 1.0
      if (this.keysDown.has('ArrowRight') || this.keysDown.has('KeyD')) netRoll += 1.0
    }

    // 2. Pitch / Speedbar & Flare:
    let speedBarTarget = 0
    let flareTarget = 0

    if (this.isMotionActive) {
      speedBarTarget = this.diveDemand
      flareTarget = this.flareDemand // Full buoyant hover float up to 100% flare
    } else {
      if (this.keysDown.has('ArrowUp') || this.keysDown.has('KeyW')) speedBarTarget = 1.0
      if (this.keysDown.has('ArrowDown') || this.keysDown.has('KeyS')) flareTarget = 1.0
    }

    // 3. Coordinated Brake Mixing:
    // Real paraglider pilots initiate minor trim adjustments with body weight-shift alone.
    // Brake lines are only pulled down when deliberately carving deeper (>18% weight shift),
    // eliminating brake-induced yaw snatch in the center!
    let targetLeftBrake = flareTarget
    let targetRightBrake = flareTarget

    const absRollMag = Math.abs(netRoll)
    if (absRollMag > 0.18) {
      const brakeEngagement = (absRollMag - 0.18) / 0.82
      const pull = Math.pow(brakeEngagement, 1.25) * 0.85
      if (netRoll < 0) {
        // Turning left: pull left brake, release outside right brake
        targetLeftBrake = Math.max(flareTarget, pull)
        targetRightBrake = Math.max(0, flareTarget - pull * 0.4)
      } else {
        // Turning right: pull right brake, release outside left brake
        targetRightBrake = Math.max(flareTarget, pull)
        targetLeftBrake = Math.max(0, flareTarget - pull * 0.4)
      }
    }

    // 4. Smooth Control Actuation & Positive Centering:
    // When returning to center, faster recovery (14.0) firmly locks into neutral stability.
    // When rolling into a turn, a progressive rate (5.5) feels like a physical human weight shift, not a twitch.
    const isReturningToCenter = Math.abs(netRoll) < Math.abs(this.controls.weightShift || 0)
    const steerRate = isReturningToCenter ? 14.0 : 5.5
    const brakeRate = isReturningToCenter ? 12.0 : 6.5
    const barRate = speedBarTarget > (this.controls.speedBar || 0) ? 14.0 : 10.0

    this.controls.weightShift += (netRoll - this.controls.weightShift) * Math.min(1.0, steerRate * dt)
    this.controls.leftBrake += (targetLeftBrake - this.controls.leftBrake) * Math.min(1.0, brakeRate * dt)
    this.controls.rightBrake += (targetRightBrake - this.controls.rightBrake) * Math.min(1.0, brakeRate * dt)
    this.controls.speedBar += (speedBarTarget - this.controls.speedBar) * Math.min(1.0, barRate * dt)
    this.controls.pullingA = this.controls.speedBar
    ;(this.controls as any).isCollapsed = this.isWingCollapsed
  }

  public dispose() {
    this.keysDown.clear()
  }
}
