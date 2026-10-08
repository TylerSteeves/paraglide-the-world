import type { FlightControls } from '../physics/types'
import { HapticManager } from './HapticManager'

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function moveToward(current: number, target: number, rate: number, dt: number): number {
  const maxDelta = rate * dt
  const diff = target - current
  if (Math.abs(diff) <= maxDelta) return target
  return current + Math.sign(diff) * maxDelta
}

// ---- Dynamic direct brake pressure model -----------------------------------
export const FULL_BRAKE_RATE = 6.0      // Smooth progressive brake pull (~0.16s for normal turns)
export const BRAKE_RELEASE_RATE = 4.5   // Smooth progressive release back to trim
export const WEIGHT_SHIFT_RATE = 3.5    // Natural anatomical harness weight shift
export const SPEEDBAR_RATE_IN = 4.0     // Smooth speedbar push
export const SPEEDBAR_RATE_OUT = 5.0    // Smooth speedbar release

export type ControlMode = 'dual_toggle' | 'flight_stick' | 'tilt_guidance'

export type HandHeightState = {
  brake: number
  bar: number
  pullingA: number
  pullingB: number
  riserZone: 'A' | 'B' | 'TRIM' | 'BRAKE' | 'STALL'
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
  zone: 'A' | 'B' | 'TRIM' | 'BRAKE' | 'STALL'
}

export interface TouchTrack {
  id: number
  startX: number
  startY: number
  currX: number
  currY: number
  side: 'left' | 'right'
  brake: number
  bar: number
  zone: 'A' | 'B' | 'TRIM' | 'BRAKE' | 'STALL'
}

/**
 * Relative Drag to Authentic Paraglider Risers:
 * - Deadband (±12px): Neutral Trim (best L/D glide, 0 brake, 0 speedbar)
 * - Dragging DOWN (12px to 125px): Progressive trailing-edge brake (0 to 85%)
 * - Dragging DOWN deep (>125px): Deep Stall (85% to 100%)
 * - Dragging UP (-12px to -80px): Pushing Speed Bar / Pulling A's (+18 km/h drive)
 */
export function relativeDragToRisers(deltaY: number, maxTravelPx: number = 125): HandHeightState {
  const deadband = 12
  if (Math.abs(deltaY) <= deadband) {
    return { brake: 0, bar: 0, pullingA: 0, pullingB: 0, riserZone: 'TRIM' }
  }
  if (deltaY > deadband) {
    const pullDist = deltaY - deadband
    const normalTravel = maxTravelPx - deadband // ~113px
    if (pullDist <= normalTravel) {
      const frac = clamp(pullDist / normalTravel, 0, 1)
      const brake = Math.pow(frac, 1.25) * 0.85
      return { brake, bar: 0, pullingA: 0, pullingB: 0, riserZone: 'BRAKE' }
    } else {
      const stallDist = pullDist - normalTravel
      const stallFrac = clamp(stallDist / 42, 0, 1)
      const brake = clamp(0.85 + stallFrac * 0.15, 0.85, 1.0)
      return { brake, bar: 0, pullingA: 0, pullingB: 0, riserZone: 'STALL' }
    }
  } else {
    const pushDist = -deltaY - deadband
    const barTravel = 75
    const barFrac = clamp(pushDist / barTravel, 0, 1)
    return { brake: 0, bar: barFrac, pullingA: barFrac, pullingB: 0, riserZone: 'A' }
  }
}

/**
 * Legacy absolute screen height mapper for backwards compatibility
 */
export function handHeightToBrakeAndBar(y: number, screenHeight: number): HandHeightState {
  const fracY = clamp(y / Math.max(1, screenHeight), 0, 1)
  if (fracY < 0.20) {
    const pullingA = clamp((0.20 - fracY) / 0.18, 0, 1)
    return { brake: 0, bar: pullingA, pullingA, pullingB: 0, riserZone: 'A' }
  } else if (fracY <= 0.32) {
    return { brake: 0, bar: 0, pullingA: 0, pullingB: 0, riserZone: 'TRIM' }
  } else if (fracY < 0.82) {
    const rawPull = clamp((fracY - 0.32) / 0.50, 0, 1)
    const brake = Math.pow(rawPull, 1.3) * 0.85
    return { brake, bar: 0, pullingA: 0, pullingB: 0, riserZone: 'BRAKE' }
  } else {
    const brake = clamp(0.85 + ((fracY - 0.82) / 0.18) * 0.15, 0.85, 1.0)
    return { brake, bar: 0, pullingA: 0, pullingB: 0, riserZone: 'STALL' }
  }
}

export class MobileInputManager {
  public controls: FlightControls
  public haptic: HapticManager = new HapticManager()
  private prevLeftBrake: number = 0
  private prevRightBrake: number = 0

  // Control Mode (Defaults to intuitive universal flight stick)
  public controlMode: ControlMode = 'flight_stick'
  public onControlModeChange: ((mode: ControlMode) => void) | null = null

  // Motion & Accelerometer Guidance System
  public tiltWeightShift: number = 0 // -1.0 (lean left) to +1.0 (lean right)
  public tiltPitch: number = 0       // -1.0 (lean forward / speedbar) to +1.0 (lean back)
  public tiltParallaxRoll: number = 0  // Normalized -1.0 (tilt left) to +1.0 (tilt right) for camera parallax
  public tiltParallaxPitch: number = 0 // Normalized -1.0 (tilt forward) to +1.0 (tilt back) for camera parallax
  public instantTwistRad: number = 0   // Instant physical twist angle in radians for AR background rotation
  public instantTwistDeg: number = 0   // Instant twist angle in degrees
  public twistVelocityDeg: number = 0  // Angular velocity of twist (deg/s)
  public snapIntensity: number = 0     // Proportional snap intensity: 0 (gentle) to 1.0 (violent flick)
  public isPortrait: boolean = false
  public dynamicPumpMomentum: number = 0 // Dynamic impulse from physical snap/jerk
  public isMotionActive: boolean = false
  public isNativeMotion: boolean = false
  public hasGyroPermission: boolean = false

  private neutralRoll: number = 0
  private neutralPitch: number = 0
  private prevTwistDeg: number = 0
  private prevMotionTime: number = 0
  private isCalibrated: boolean = false
  private lastSampleTime: number = 0
  private prevAccelX: number = 0
  private lastTouchStartTime: number = 0

  // Pseudo-haptic visual lag & touch coordinates
  public leftLagFrac: number = 0
  public rightLagFrac: number = 0
  public leftThumbYFrac: number | null = null
  public rightThumbYFrac: number | null = null

  // Relative touch tracking (Mobile dual-thumb / virtual stick)
  private leftTouch: TouchTrack | null = null
  private rightTouch: TouchTrack | null = null
  private mouseTrack: TouchTrack | null = null
  public activeTouchVisuals: ActiveTouchVisual[] = []

  private touchLeftBrake: number = 0
  private touchRightBrake: number = 0
  private touchLeftSpeedBar: number = 0
  private touchRightSpeedBar: number = 0
  private touchLeftPullingA: number = 0
  private touchRightPullingA: number = 0
  private touchLeftPullingB: number = 0
  private touchRightPullingB: number = 0
  private touchWeightShift: number = 0

  public isPullingA: boolean = false
  public isPullingB: boolean = false
  public leftRiserZone: 'A' | 'B' | 'TRIM' | 'BRAKE' | 'STALL' = 'TRIM'
  public rightRiserZone: 'A' | 'B' | 'TRIM' | 'BRAKE' | 'STALL' = 'TRIM'

  // Paramotor Engine Throttle Dynamics
  public throttle: number = 0 // 0 to 1
  public targetThrottle: number = 0 // 0 to 1
  public isCruiseLocked: boolean = false

  // Trackpad 2-gesture tracking (Up/Down + Left/Right)
  public trackpadPitch: number = 0 // -1.0 (speed bar) to +1.0 (full brake / flare / stall)
  public trackpadRoll: number = 0  // -1.0 (steer left) to +1.0 (steer right)
  public invertTrackpadY: boolean = false // Normal: pull fingers down = pull brakes down
  public trackpadActive: boolean = false
  private lastTrackpadTime: number = 0

  // Mouse drag tracking (Desktop fallback)
  private isMouseDown: boolean = false

  // Keyboard tracking
  private keysDown: Set<string> = new Set()

  // Gamepad tracking
  private gamepadIndex: number | null = null

  // Event callbacks
  public onCycleLens: (() => void) | null = null
  public onCycleVantage: (() => void) | null = null
  public onToggleReverse: (() => void) | null = null
  public onToggleWing: (() => void) | null = null
  public onSpawnHimalayas: (() => void) | null = null
  public onSpawnAlpine: (() => void) | null = null
  public onSpawnDunes: (() => void) | null = null
  public onToggleInvertTrackpad: ((inverted: boolean) => void) | null = null

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
      throttle: 0,
      reverseStance: false,
    }

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const savedMode = localStorage.getItem('ptw_control_mode') as ControlMode
        if (savedMode === 'dual_toggle' || savedMode === 'flight_stick' || savedMode === 'tilt_guidance') {
          this.controlMode = savedMode
        }
      }
    } catch {}

    this.setupTrackpadListeners()
    this.setupTouchListeners()
    this.setupMouseListeners()
    this.setupKeyboardListeners()
    this.setupGamepadListeners()
    this.setupNativeMotionBridge()
    this.setupBrowserMotionListeners()
  }

  public setThrottle(val: number) {
    this.targetThrottle = clamp(val, 0, 1)
    this.controls.throttle = this.targetThrottle
  }

  public setTargetThrottle(val: number) {
    this.targetThrottle = clamp(val, 0, 1)
  }

  public toggleCruiseLock(): boolean {
    this.isCruiseLocked = !this.isCruiseLocked
    this.haptic.trigger('notch', 0.9)
    return this.isCruiseLocked
  }

  public cutThrottle(): void {
    this.targetThrottle = 0
    this.controls.throttle = 0
    this.isCruiseLocked = false
    this.haptic.trigger('notch', 0.9)
  }

  public setControlMode(mode: ControlMode) {
    this.controlMode = mode
    try {
      localStorage.setItem('ptw_control_mode', mode)
    } catch {}
    this.onControlModeChange?.(mode)
    this.haptic.trigger('notch', 0.8)
  }

  public cycleControlMode(): ControlMode {
    const modes: ControlMode[] = ['dual_toggle', 'flight_stick', 'tilt_guidance']
    const next = modes[(modes.indexOf(this.controlMode) + 1) % modes.length]
    this.setControlMode(next)
    return next
  }

  public toggleReverseStance() {
    this.controls.reverseStance = !this.controls.reverseStance
  }

  public toggleInvertTrackpad(): boolean {
    this.invertTrackpadY = !this.invertTrackpadY
    this.onToggleInvertTrackpad?.(this.invertTrackpadY)
    return this.invertTrackpadY
  }

  public setPullingA(active: boolean) {
    this.isPullingA = active
    if (active) this.haptic.trigger('notch', 0.8)
  }

  public setPullingB(active: boolean) {
    this.isPullingB = active
    if (active) this.haptic.trigger('thermalKick', 1.0)
  }

  public async requestGyroPermission(): Promise<boolean> {
    if (typeof window === 'undefined') return false

    // Try starting native iOS CoreMotion updates inside WKWebView
    try {
      const win = window as any
      if (win.webkit?.messageHandlers?.motion?.postMessage) {
        win.webkit.messageHandlers.motion.postMessage('start')
      }
    } catch {}

    // Native iOS bridge is active
    if (this.isNativeMotion) {
      this.hasGyroPermission = true
      return true
    }

    // iOS 13+ Safari permission request
    let granted = false
    const devOrient = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>
    }
    const devMotion = window.DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>
    }

    if (typeof devOrient?.requestPermission === 'function') {
      try {
        const res = await devOrient.requestPermission()
        if (res === 'granted') granted = true
      } catch (err) {
        console.warn('Orientation permission rejected:', err)
      }
    }

    if (typeof devMotion?.requestPermission === 'function') {
      try {
        const res = await devMotion.requestPermission()
        if (res === 'granted') granted = true
      } catch (err) {
        console.warn('Motion permission rejected:', err)
      }
    }

    if (granted || 'ondeviceorientation' in window) {
      this.hasGyroPermission = true
      return true
    }
    return false
  }

  public calibrateNeutral() {
    this.isCalibrated = false
    this.neutralRoll = 0.0
    this.tiltWeightShift = 0
    this.tiltPitch = 0
    this.tiltParallaxRoll = 0
    this.tiltParallaxPitch = 0
    this.instantTwistRad = 0
    this.instantTwistDeg = 0
    this.twistVelocityDeg = 0
    this.snapIntensity = 0
    this.dynamicPumpMomentum = 0
    this.controls.weightShift = 0
  }

  private setupNativeMotionBridge() {
    if (typeof window === 'undefined') return

    // Activate native CoreMotion updates if running inside WKWebView
    try {
      const win = window as any
      if (win.webkit?.messageHandlers?.motion?.postMessage) {
        win.webkit.messageHandlers.motion.postMessage('start')
      }
    } catch {}

    const w = window as unknown as {
      onNativeMotion?: (data: {
        roll: number
        pitch: number
        yaw: number
        ax: number
        ay: number
        az: number
        rx?: number
        ry?: number
        rz?: number
        gx?: number
        gy?: number
        gz?: number
      }) => void
    }

    w.onNativeMotion = (data) => {
      this.isNativeMotion = true
      this.isMotionActive = true
      this.hasGyroPermission = true

      const isPortrait = window.innerHeight >= window.innerWidth
      this.isPortrait = isPortrait

      let rawRollDeg = 0
      let rawPitchDeg = 0

      if (isPortrait) {
        // Vertical Portrait Hold:
        // Lateral steering: data.gx directly measures gravity along horizontal axis
        if (typeof data.gx === 'number') {
          // Negative gx when tilted left, positive when tilted right
          rawRollDeg = Math.asin(clamp(data.gx, -1, 1)) * (180 / Math.PI)
        } else {
          rawRollDeg = (data.roll * 180) / Math.PI
        }

        // Forward/backward tilt:
        if (typeof data.gz === 'number' && typeof data.gy === 'number') {
          // In comfortable portrait hold (~68° elevation), gy ~ -0.92, gz ~ -0.38
          const elevationDeg = Math.atan2(-data.gy, -data.gz) * (180 / Math.PI)
          rawPitchDeg = elevationDeg - 68.0
        } else {
          rawPitchDeg = (data.pitch * 180) / Math.PI
        }
      } else {
        // Landscape orientation (fallback)
        rawRollDeg = (data.pitch * 180) / Math.PI
        rawPitchDeg = (data.roll * 180) / Math.PI
        if (typeof data.gy === 'number' && typeof data.gz === 'number') {
          rawRollDeg = Math.asin(clamp(-data.gy, -1, 1)) * (180 / Math.PI)
          rawPitchDeg = Math.asin(clamp(data.gz, -1, 1)) * (180 / Math.PI)
        }
      }

      if (!this.isCalibrated) {
        this.neutralRoll = 0.0 // Lock neutral roll to 0.0 (upright vertical)
        this.neutralPitch = rawPitchDeg // Resting elevation angle
        this.isCalibrated = true
      }

      const deltaRoll = rawRollDeg - this.neutralRoll
      const deltaPitch = rawPitchDeg - this.neutralPitch

      // Physical Tilt Tracking
      this.instantTwistDeg = deltaRoll
      this.instantTwistRad = (deltaRoll * Math.PI) / 180

      const now = performance.now()
      const dtMotion = Math.max(0.005, Math.min(0.1, (now - this.prevMotionTime) * 0.001))
      this.prevMotionTime = now

      const diffVel = (deltaRoll - this.prevTwistDeg) / dtMotion
      this.prevTwistDeg = deltaRoll
      const gyroVel = typeof data.rz === 'number' ? (data.rz * 180) / Math.PI : 0
      const effectiveAngVel = Math.abs(gyroVel) > Math.abs(diffVel) * 0.5 ? gyroVel : diffVel
      this.twistVelocityDeg = effectiveAngVel

      // Snap Intensity: 0 for gentle tilt, ramp up to 1.0 for fast wrist flick (>130°/s)
      const absVel = Math.abs(effectiveAngVel)
      if (absVel > 30.0) {
        const snap = Math.min(1.0, (absVel - 30.0) / 100.0)
        this.snapIntensity = Math.max(this.snapIntensity, snap)
      }

      // Responsive tilt steering: 2° deadband, 25° max tilt
      const DEADBAND_ROLL = 2.0
      const MAX_TILT_ROLL = 25.0
      if (Math.abs(deltaRoll) < DEADBAND_ROLL) {
        this.tiltWeightShift = 0
        this.tiltParallaxRoll = 0
      } else {
        const sign = Math.sign(deltaRoll)
        const mag = Math.min(1.0, (Math.abs(deltaRoll) - DEADBAND_ROLL) / (MAX_TILT_ROLL - DEADBAND_ROLL))
        this.tiltWeightShift = sign * Math.pow(mag, 1.1)
        this.tiltParallaxRoll = sign * mag
      }

      // Fore-aft pitch: positive = forward dive, negative = backward flare
      const DEADBAND_PITCH = 3.0
      const MAX_PITCH = 20.0
      if (Math.abs(deltaPitch) < DEADBAND_PITCH) {
        this.tiltPitch = 0
        this.tiltParallaxPitch = 0
      } else {
        const sign = Math.sign(deltaPitch)
        const mag = Math.min(1.0, (Math.abs(deltaPitch) - DEADBAND_PITCH) / (MAX_PITCH - DEADBAND_PITCH))
        this.tiltPitch = sign * mag
        this.tiltParallaxPitch = sign * mag
      }

      const jerkX = Math.abs(data.ax)
      const rotRateZ = Math.abs(data.rz ?? 0)
      if (jerkX > 1.2 || rotRateZ > 3.2 || this.snapIntensity > 0.4) {
        const pumpDir = Math.sign(deltaRoll !== 0 ? deltaRoll : (data.ax !== 0 ? data.ax : (data.rz ?? 1)))
        this.dynamicPumpMomentum = clamp(this.dynamicPumpMomentum + pumpDir * (0.35 + this.snapIntensity * 0.45), -1.0, 1.0)
      }
    }
  }

  private setupBrowserMotionListeners() {
    if (typeof window === 'undefined') return

    // 1. Device Orientation (Attitude angles)
    window.addEventListener(
      'deviceorientation',
      (e: DeviceOrientationEvent) => {
        if (this.isNativeMotion) return
        if (e.gamma === null || e.beta === null) return
        this.isMotionActive = true

        const isPortrait = window.innerHeight >= window.innerWidth
        this.isPortrait = isPortrait
        const screenAngle =
          window.screen?.orientation?.angle ??
          (typeof window.orientation === 'number' ? window.orientation : (isPortrait ? 0 : 90))

        let rawRollDeg = 0
        let rawPitchDeg = 0

        if (screenAngle === 0 || screenAngle === 180 || isPortrait) {
          // Portrait mode: gamma is left/right roll (-90 to +90)
          rawRollDeg = e.gamma
          // beta is front/back pitch (~65-75 deg when held vertically)
          rawPitchDeg = e.beta - 68.0
        } else if (screenAngle === 90) {
          rawRollDeg = -e.beta
          rawPitchDeg = e.gamma
        } else {
          rawRollDeg = e.beta
          rawPitchDeg = -e.gamma
        }

        if (!this.isCalibrated) {
          this.neutralRoll = 0.0 // Lock neutral roll to 0.0 (upright vertical)
          this.neutralPitch = rawPitchDeg // Resting elevation angle
          this.isCalibrated = true
        }

        const deltaRoll = rawRollDeg - this.neutralRoll
        const deltaPitch = rawPitchDeg - this.neutralPitch

        // Physical Tilt Tracking
        this.instantTwistDeg = deltaRoll
        this.instantTwistRad = (deltaRoll * Math.PI) / 180

        const now = performance.now()
        const dtMotion = Math.max(0.005, Math.min(0.1, (now - this.prevMotionTime) * 0.001))
        this.prevMotionTime = now

        const diffVel = (deltaRoll - this.prevTwistDeg) / dtMotion
        this.prevTwistDeg = deltaRoll
        this.twistVelocityDeg = diffVel

        const absVel = Math.abs(diffVel)
        if (absVel > 30.0) {
          const snap = Math.min(1.0, (absVel - 30.0) / 100.0)
          this.snapIntensity = Math.max(this.snapIntensity, snap)
        }

        const DEADBAND_ROLL = 2.0
        const MAX_TILT_ROLL = 25.0
        if (Math.abs(deltaRoll) < DEADBAND_ROLL) {
          this.tiltWeightShift = 0
          this.tiltParallaxRoll = 0
        } else {
          const sign = Math.sign(deltaRoll)
          const mag = Math.min(1.0, (Math.abs(deltaRoll) - DEADBAND_ROLL) / (MAX_TILT_ROLL - DEADBAND_ROLL))
          this.tiltWeightShift = sign * Math.pow(mag, 1.1)
          this.tiltParallaxRoll = sign * mag
        }

        const DEADBAND_PITCH = 3.0
        const MAX_PITCH = 20.0
        if (Math.abs(deltaPitch) < DEADBAND_PITCH) {
          this.tiltPitch = 0
          this.tiltParallaxPitch = 0
        } else {
          const sign = Math.sign(deltaPitch)
          const mag = Math.min(1.0, (Math.abs(deltaPitch) - DEADBAND_PITCH) / (MAX_PITCH - DEADBAND_PITCH))
          this.tiltPitch = sign * mag
          this.tiltParallaxPitch = sign * mag
        }
      },
      true,
    )

    // 2. Device Motion (Accelerometer & Gyroscope Jerk / Acro Pump)
    window.addEventListener(
      'devicemotion',
      (e: DeviceMotionEvent) => {
        if (this.isNativeMotion) return
        const now = performance.now()
        const dt = Math.max(0.001, (now - this.lastSampleTime) * 0.001)
        this.lastSampleTime = now

        const acc = e.acceleration || e.accelerationIncludingGravity
        if (acc && acc.x !== null && acc.y !== null) {
          const deltaX = (acc.x - this.prevAccelX) / dt
          this.prevAccelX = acc.x

          if (Math.abs(deltaX) > 35.0) {
            const snapDir = Math.sign(deltaX)
            this.dynamicPumpMomentum = clamp(this.dynamicPumpMomentum + snapDir * 0.4, -1.0, 1.0)
          }
        }

        const rot = e.rotationRate
        if (rot && rot.gamma !== null && Math.abs(rot.gamma) > 180) {
          const rotDir = Math.sign(rot.gamma)
          this.dynamicPumpMomentum = clamp(this.dynamicPumpMomentum + rotDir * 0.35, -1.0, 1.0)
        }
      },
      true,
    )

    window.addEventListener('orientationchange', () => {
      this.calibrateNeutral()
    })
  }

  private setupTrackpadListeners() {
    window.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault()

        this.lastTrackpadTime = performance.now()
        this.trackpadActive = true

        const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1
        const deltaX = e.deltaX * scale
        const deltaY = e.deltaY * scale

        const pitchSens = 0.0042
        const rollSens = 0.0042

        const effectiveDeltaY = this.invertTrackpadY ? deltaY : -deltaY
        this.trackpadPitch = clamp(this.trackpadPitch + effectiveDeltaY * pitchSens, -1.0, 1.0)
        this.trackpadRoll = clamp(this.trackpadRoll + deltaX * rollSens, -1.0, 1.0)
      },
      { passive: false },
    )
  }

  /**
   * Mobile Relative Touch Listener with Spring Return & Virtual Stick
   */
  private setupTouchListeners() {
    window.addEventListener(
      'touchstart',
      (e) => {
        const now = performance.now()
        if (e.touches.length === 2 || (now - this.lastTouchStartTime < 280 && e.touches.length === 1)) {
          this.calibrateNeutral()
          this.haptic.trigger('tick', 0.8)
        }
        this.lastTouchStartTime = now

        const screenWidth = window.innerWidth
        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i]
          if ((touch.target as HTMLElement)?.closest('button, .hud-icon-btn, .relaunch-overlay, .riser-dock-btn, .flir-overlay, .risers-guide-modal')) {
            continue
          }

          const isLeft = touch.clientX < screenWidth * 0.5
          if (isLeft && !this.leftTouch) {
            this.leftTouch = {
              id: touch.identifier,
              startX: touch.clientX,
              startY: touch.clientY,
              currX: touch.clientX,
              currY: touch.clientY,
              side: 'left',
              brake: 0,
              bar: 0,
              zone: 'TRIM',
            }
            this.leftThumbYFrac = touch.clientY / window.innerHeight
            this.haptic.trigger('tick', 0.5)
          } else if (!isLeft && !this.rightTouch) {
            this.rightTouch = {
              id: touch.identifier,
              startX: touch.clientX,
              startY: touch.clientY,
              currX: touch.clientX,
              currY: touch.clientY,
              side: 'right',
              brake: 0,
              bar: 0,
              zone: 'TRIM',
            }
            this.rightThumbYFrac = touch.clientY / window.innerHeight
            this.haptic.trigger('tick', 0.5)
          }
        }
        this.processTouchMotion()
      },
      { passive: false },
    )

    window.addEventListener(
      'touchmove',
      (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i]
          if (this.leftTouch && touch.identifier === this.leftTouch.id) {
            this.leftTouch.currX = touch.clientX
            this.leftTouch.currY = touch.clientY
            this.leftThumbYFrac = touch.clientY / window.innerHeight
          }
          if (this.rightTouch && touch.identifier === this.rightTouch.id) {
            this.rightTouch.currX = touch.clientX
            this.rightTouch.currY = touch.clientY
            this.rightThumbYFrac = touch.clientY / window.innerHeight
          }
        }
        this.processTouchMotion()
      },
      { passive: false },
    )

    const endTouch = (touch: Touch) => {
      if (this.leftTouch && touch.identifier === this.leftTouch.id) {
        this.leftTouch = null
        this.leftThumbYFrac = null
        this.leftLagFrac = 0
        this.touchLeftBrake = 0
        this.touchLeftSpeedBar = 0
        this.touchLeftPullingA = 0
        this.touchLeftPullingB = 0
        this.leftRiserZone = 'TRIM'
      }
      if (this.rightTouch && touch.identifier === this.rightTouch.id) {
        this.rightTouch = null
        this.rightThumbYFrac = null
        this.rightLagFrac = 0
        this.touchRightBrake = 0
        this.touchRightSpeedBar = 0
        this.touchRightPullingA = 0
        this.touchRightPullingB = 0
        this.rightRiserZone = 'TRIM'
      }
      this.processTouchMotion()
    }

    window.addEventListener('touchend', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) endTouch(e.changedTouches[i])
    })
    window.addEventListener('touchcancel', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) endTouch(e.changedTouches[i])
    })
  }

  /**
   * Evaluates relative drag, virtual flight stick, or tilt guidance
   */
  private processTouchMotion() {
    let wsLeft = 0
    let wsRight = 0

    if (this.controlMode === 'flight_stick') {
      // Universal Natural Flight Stick: either thumb (or mouse) drives the unified stick anywhere on screen
      const primaryTouch = this.leftTouch || this.rightTouch
      if (primaryTouch) {
        const dx = primaryTouch.currX - primaryTouch.startX
        const dy = primaryTouch.currY - primaryTouch.startY
        const deadband = 8
        const stickRadius = 80

        let lBrake = 0
        let rBrake = 0
        let bar = 0
        let ws = 0

        const absDx = Math.abs(dx)
        const isTurning = absDx > deadband
        const isPureFlare = dy > deadband && absDx <= deadband * 1.5

        if (isTurning) {
          const dirX = Math.sign(dx)
          const magX = clamp((absDx - deadband) / (stickRadius - deadband), 0, 1)
          ws = dirX * magX
          // Strictly independent carving: inside brake pulls down, outside stays at 0 (straight UP!)
          if (dirX < 0) {
            lBrake = Math.pow(magX, 1.1) * 0.75
            rBrake = 0.0 // Right hand strictly straight UP!
          } else {
            rBrake = Math.pow(magX, 1.1) * 0.75
            lBrake = 0.0 // Left hand strictly straight UP!
          }
          primaryTouch.zone = 'BRAKE'
        }

        if (dy < -deadband) {
          // Drag Up: Dive forward / Speedbar / Tuck into the hill!
          bar = clamp((-dy - deadband) / (stickRadius - deadband), 0, 1)
          primaryTouch.zone = 'A'
        } else if (isPureFlare) {
          // Drag Down (predominantly vertical): Symmetric flare / swoop!
          const flare = clamp((dy - deadband) / (stickRadius - deadband), 0, 1) * 0.95
          lBrake = flare
          rBrake = flare
          primaryTouch.zone = flare > 0.85 ? 'STALL' : 'BRAKE'
        } else if (!isTurning) {
          primaryTouch.zone = 'TRIM'
        }

        this.touchLeftBrake = lBrake
        this.touchRightBrake = rBrake
        this.touchLeftSpeedBar = bar
        this.touchWeightShift = ws
        primaryTouch.brake = Math.max(lBrake, rBrake)
        primaryTouch.bar = bar
        this.leftRiserZone = primaryTouch.zone
        this.rightRiserZone = primaryTouch.zone
      } else {
        this.touchLeftBrake = 0
        this.touchRightBrake = 0
        this.touchLeftSpeedBar = 0
        this.touchWeightShift = 0
        this.leftRiserZone = 'TRIM'
        this.rightRiserZone = 'TRIM'
      }

      // If both thumbs are down, secondary thumb can add additional flare or dive
      const secondaryTouch = this.leftTouch && this.rightTouch ? this.rightTouch : null
      if (secondaryTouch) {
        const dy2 = secondaryTouch.currY - secondaryTouch.startY
        if (dy2 > 15) {
          const extraFlare = clamp((dy2 - 15) / 65, 0, 1) * 0.95
          this.touchLeftBrake = Math.max(this.touchLeftBrake, extraFlare)
          this.touchRightBrake = Math.max(this.touchRightBrake, extraFlare)
        } else if (dy2 < -15) {
          const extraBar = clamp((-dy2 - 15) / 65, 0, 1)
          this.touchLeftSpeedBar = Math.max(this.touchLeftSpeedBar, extraBar)
        }
      }
    } else {
      // Dual Toggle Mode or Tilt Guidance Mode
      if (this.leftTouch) {
        const dy = this.leftTouch.currY - this.leftTouch.startY
        const dx = this.leftTouch.currX - this.leftTouch.startX
        const hh = relativeDragToRisers(dy)

        if (hh.riserZone === 'STALL' && this.leftRiserZone !== 'STALL') {
          this.haptic.trigger('heavy', 0.9)
        } else if (hh.riserZone === 'A' && this.leftRiserZone !== 'A') {
          this.haptic.trigger('tick', 0.6)
        }

        this.touchLeftBrake = hh.brake
        this.touchLeftSpeedBar = hh.bar
        this.touchLeftPullingA = hh.pullingA
        this.touchLeftPullingB = hh.pullingB
        this.leftRiserZone = hh.riserZone
        this.leftTouch.brake = hh.brake
        this.leftTouch.bar = hh.bar
        this.leftTouch.zone = hh.riserZone
        wsLeft = clamp(dx / 70, -1, 1)
      } else {
        this.touchLeftBrake = 0
        this.touchLeftSpeedBar = 0
        this.touchLeftPullingA = 0
        this.touchLeftPullingB = 0
        this.leftRiserZone = 'TRIM'
      }

      if (this.rightTouch) {
        const dy = this.rightTouch.currY - this.rightTouch.startY
        const dx = this.rightTouch.currX - this.rightTouch.startX
        const hh = relativeDragToRisers(dy)

        if (hh.riserZone === 'STALL' && this.rightRiserZone !== 'STALL') {
          this.haptic.trigger('heavy', 0.9)
        } else if (hh.riserZone === 'A' && this.rightRiserZone !== 'A') {
          this.haptic.trigger('tick', 0.6)
        }

        this.touchRightBrake = hh.brake
        this.touchRightSpeedBar = hh.bar
        this.touchRightPullingA = hh.pullingA
        this.touchRightPullingB = hh.pullingB
        this.rightRiserZone = hh.riserZone
        this.rightTouch.brake = hh.brake
        this.rightTouch.bar = hh.bar
        this.rightTouch.zone = hh.riserZone
        wsRight = clamp(dx / 70, -1, 1)
      } else {
        this.touchRightBrake = 0
        this.touchRightSpeedBar = 0
        this.touchRightPullingA = 0
        this.touchRightPullingB = 0
        this.rightRiserZone = 'TRIM'
      }
    }

    this.touchWeightShift = clamp(wsLeft + wsRight, -1, 1)
    this.updateVisualTouchList()
  }

  private updateVisualTouchList() {
    this.activeTouchVisuals = []
    if (this.leftTouch) {
      this.activeTouchVisuals.push({
        id: this.leftTouch.id,
        side: 'left',
        anchorX: this.leftTouch.startX,
        anchorY: this.leftTouch.startY,
        currentX: this.leftTouch.currX,
        currentY: this.leftTouch.currY,
        deltaX: this.leftTouch.currX - this.leftTouch.startX,
        deltaY: this.leftTouch.currY - this.leftTouch.startY,
        brake: this.leftTouch.brake,
        speedBar: this.leftTouch.bar,
        zone: this.leftTouch.zone,
      })
    }
    if (this.rightTouch) {
      this.activeTouchVisuals.push({
        id: this.rightTouch.id,
        side: 'right',
        anchorX: this.rightTouch.startX,
        anchorY: this.rightTouch.startY,
        currentX: this.rightTouch.currX,
        currentY: this.rightTouch.currY,
        deltaX: this.rightTouch.currX - this.rightTouch.startX,
        deltaY: this.rightTouch.currY - this.rightTouch.startY,
        brake: this.rightTouch.brake,
        speedBar: this.rightTouch.bar,
        zone: this.rightTouch.zone,
      })
    }
    if (this.isMouseDown && this.mouseTrack) {
      this.activeTouchVisuals.push({
        id: this.mouseTrack.id,
        side: this.mouseTrack.side,
        anchorX: this.mouseTrack.startX,
        anchorY: this.mouseTrack.startY,
        currentX: this.mouseTrack.currX,
        currentY: this.mouseTrack.currY,
        deltaX: this.mouseTrack.currX - this.mouseTrack.startX,
        deltaY: this.mouseTrack.currY - this.mouseTrack.startY,
        brake: this.mouseTrack.brake,
        speedBar: this.mouseTrack.bar,
        zone: this.mouseTrack.zone,
      })
    }
  }

  /**
   * Relative Mouse Drag Support for Desktop
   */
  private setupMouseListeners() {
    window.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement)?.closest('button, .hud-icon-btn, .relaunch-overlay, .riser-dock-btn, .flir-overlay, .risers-guide-modal')) {
        return
      }
      this.isMouseDown = true
      const side: 'left' | 'right' = e.clientX < window.innerWidth * 0.5 ? 'left' : 'right'
      this.mouseTrack = {
        id: 9999,
        startX: e.clientX,
        startY: e.clientY,
        currX: e.clientX,
        currY: e.clientY,
        side,
        brake: 0,
        bar: 0,
        zone: 'TRIM',
      }
      this.haptic.trigger('tick', 0.5)
      this.updateVisualTouchList()
    })

    window.addEventListener('mousemove', (e) => {
      if (!this.isMouseDown || !this.mouseTrack) return
      this.mouseTrack.currX = e.clientX
      this.mouseTrack.currY = e.clientY
      const dy = e.clientY - this.mouseTrack.startY
      const dx = e.clientX - this.mouseTrack.startX

      if (this.controlMode === 'flight_stick') {
        const deadband = 8
        const stickRadius = 80
        let lBrake = 0
        let rBrake = 0
        let bar = 0
        let ws = 0
        const absDx = Math.abs(dx)
        const isTurning = absDx > deadband
        const isPureFlare = dy > deadband && absDx <= deadband * 1.5

        if (isTurning) {
          const dirX = Math.sign(dx)
          const magX = clamp((absDx - deadband) / (stickRadius - deadband), 0, 1)
          ws = dirX * magX
          if (dirX < 0) {
            lBrake = Math.pow(magX, 1.1) * 0.75
            rBrake = 0.0 // Right hand strictly straight UP!
          } else {
            rBrake = Math.pow(magX, 1.1) * 0.75
            lBrake = 0.0 // Left hand strictly straight UP!
          }
          this.mouseTrack.zone = 'BRAKE'
        }

        if (dy < -deadband) {
          // Drag up: Dive forward / Speedbar
          bar = clamp((-dy - deadband) / (stickRadius - deadband), 0, 1)
          this.mouseTrack.zone = 'A'
        } else if (isPureFlare) {
          // Drag down: Symmetric Flare / Brake swoop
          const flare = clamp((dy - deadband) / (stickRadius - deadband), 0, 1) * 0.95
          lBrake = flare
          rBrake = flare
          this.mouseTrack.zone = flare > 0.85 ? 'STALL' : 'BRAKE'
        } else if (!isTurning) {
          this.mouseTrack.zone = 'TRIM'
        }
        this.touchLeftBrake = lBrake
        this.touchRightBrake = rBrake
        this.touchLeftSpeedBar = bar
        this.touchWeightShift = ws
        this.mouseTrack.brake = Math.max(lBrake, rBrake)
        this.mouseTrack.bar = bar
        this.leftRiserZone = this.mouseTrack.zone
        this.rightRiserZone = this.mouseTrack.zone
      } else {
        const hh = relativeDragToRisers(dy)
        this.mouseTrack.brake = hh.brake
        this.mouseTrack.bar = hh.bar
        this.mouseTrack.zone = hh.riserZone
        const ws = clamp(dx / 75, -1, 1)

        if (this.mouseTrack.side === 'left') {
          this.touchLeftBrake = hh.brake
          this.touchLeftSpeedBar = hh.bar
          this.touchLeftPullingA = hh.pullingA
          this.touchLeftPullingB = hh.pullingB
          this.leftRiserZone = hh.riserZone
          this.leftThumbYFrac = e.clientY / window.innerHeight
        } else {
          this.touchRightBrake = hh.brake
          this.touchRightSpeedBar = hh.bar
          this.touchRightPullingA = hh.pullingA
          this.touchRightPullingB = hh.pullingB
          this.rightRiserZone = hh.riserZone
          this.rightThumbYFrac = e.clientY / window.innerHeight
        }
        this.touchWeightShift = ws
      }
      this.updateVisualTouchList()
    })

    const endMouse = () => {
      if (!this.isMouseDown) return
      this.isMouseDown = false
      this.mouseTrack = null
      this.touchLeftBrake = 0
      this.touchRightBrake = 0
      this.touchLeftSpeedBar = 0
      this.touchRightSpeedBar = 0
      this.touchLeftPullingA = 0
      this.touchRightPullingA = 0
      this.touchLeftPullingB = 0
      this.touchRightPullingB = 0
      this.touchWeightShift = 0
      this.leftRiserZone = 'TRIM'
      this.rightRiserZone = 'TRIM'
      this.leftThumbYFrac = null
      this.rightThumbYFrac = null
      this.leftLagFrac = 0
      this.rightLagFrac = 0
      this.updateVisualTouchList()
    }

    window.addEventListener('mouseup', endMouse)
    window.addEventListener('mouseleave', endMouse)
  }

  private setupKeyboardListeners() {
    window.addEventListener('keydown', (e) => {
      this.keysDown.add(e.code)
      if (e.code === 'KeyC') {
        this.onCycleVantage?.()
      } else if (e.code === 'KeyL') {
        this.onCycleLens?.()
      } else if (e.code === 'KeyT') {
        this.toggleReverseStance()
        this.onToggleReverse?.()
      } else if (e.code === 'KeyI') {
        this.toggleInvertTrackpad()
      } else if (e.code === 'KeyO') {
        this.cycleControlMode()
      } else if (e.code === 'KeyG' || e.code === 'KeyK') {
        this.onToggleWing?.()
      } else if (e.code === 'KeyX') {
        this.cutThrottle()
      } else if (e.code === 'KeyZ') {
        this.toggleCruiseLock()
      } else if (e.code === 'Digit1') {
        this.onSpawnHimalayas?.()
      } else if (e.code === 'Digit2') {
        this.onSpawnAlpine?.()
      } else if (e.code === 'Digit3') {
        this.onSpawnDunes?.()
      }
    })

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code)
    })

    window.addEventListener('blur', () => this.keysDown.clear())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.keysDown.clear()
    })
  }

  private setupGamepadListeners() {
    if (typeof window === 'undefined' || !('getGamepads' in navigator)) return
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index
    })
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null
    })
  }

  private updateGamepad(dt: number): boolean {
    if (this.gamepadIndex === null || typeof navigator.getGamepads !== 'function') return false
    const pads = navigator.getGamepads()
    const gp = pads[this.gamepadIndex]
    if (!gp || !gp.connected) return false

    const lt = gp.buttons[6]?.value ?? 0
    const rt = gp.buttons[7]?.value ?? 0
    const stickX = gp.axes[0] ?? 0
    const lb = gp.buttons[4]?.pressed ?? false
    const rb = gp.buttons[5]?.pressed ?? false

    const leftTrigger = lt > 0.04 ? lt : 0
    const rightTrigger = rt > 0.04 ? rt : 0
    const stick = Math.abs(stickX) > 0.12 ? stickX : 0
    const barHeld = lb || rb

    const active = leftTrigger > 0 || rightTrigger > 0 || stick !== 0 || barHeld
    if (!active) return false

    if (rightTrigger > 0.05) {
      this.targetThrottle = rightTrigger
    }

    this.controls.leftBrake = moveToward(this.controls.leftBrake, leftTrigger, 8.0, dt)
    this.controls.rightBrake = moveToward(this.controls.rightBrake, rightTrigger, 8.0, dt)
    this.controls.weightShift = moveToward(this.controls.weightShift, stick, WEIGHT_SHIFT_RATE * 2, dt)
    this.controls.speedBar = moveToward(this.controls.speedBar, barHeld ? 1 : 0, SPEEDBAR_RATE_IN, dt)
    return true
  }

  public update(
    dt: number,
    aeroResistanceLeftN: number = 0,
    aeroResistanceRightN: number = 0,
    isStalled: boolean = false,
    stallWarning: number = 0,
    gForce: number = 1.0,
    isFootDragging: boolean = false,
    verticalWind: number = 0,
  ) {
    const gamepadDrove = this.updateGamepad(dt)
    const hasActiveTouchDrag =
      this.touchLeftBrake > 0.05 ||
      this.touchRightBrake > 0.05 ||
      this.touchLeftSpeedBar > 0.05 ||
      this.touchRightSpeedBar > 0.05 ||
      this.touchLeftPullingB > 0.05 ||
      this.touchRightPullingB > 0.05 ||
      Math.abs(this.touchWeightShift) > 0.05
    const touchActive = (this.leftTouch !== null || this.rightTouch !== null || this.isMouseDown) && hasActiveTouchDrag

    if (gamepadDrove) {
      this.leftLagFrac = 0
      this.rightLagFrac = 0
    } else if (touchActive) {
      // Touch/Mouse Dual-Thumb or Flight-Stick input
      const pullRateL =
        this.touchLeftBrake > this.controls.leftBrake
          ? FULL_BRAKE_RATE / (1.0 + Math.max(0, aeroResistanceLeftN) / 45.0)
          : BRAKE_RELEASE_RATE

      const pullRateR =
        this.touchRightBrake > this.controls.rightBrake
          ? FULL_BRAKE_RATE / (1.0 + Math.max(0, aeroResistanceRightN) / 45.0)
          : BRAKE_RELEASE_RATE

      this.controls.leftBrake = moveToward(this.controls.leftBrake, this.touchLeftBrake, pullRateL, dt)
      this.controls.rightBrake = moveToward(this.controls.rightBrake, this.touchRightBrake, pullRateR, dt)

      // Pseudo-haptic visual elastic lag
      this.leftLagFrac = clamp(this.touchLeftBrake - this.controls.leftBrake, 0, 1)
      this.rightLagFrac = clamp(this.touchRightBrake - this.controls.rightBrake, 0, 1)

      // Pitch tilt: leaning phone top forward engages speedbar dive / pulling A's
      const tiltSpeedBar = this.tiltPitch < -0.15 ? clamp((-this.tiltPitch - 0.15) / 0.45, 0, 1) : 0
      const touchPullingA = Math.max(this.touchLeftPullingA, this.touchRightPullingA, this.touchLeftSpeedBar, this.touchRightSpeedBar)
      const touchPullingB = Math.max(this.touchLeftPullingB, this.touchRightPullingB)
      const isKeyPullingA = this.keysDown.has('Space') || this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')
      const isKeyPullingB = this.keysDown.has('KeyB')

      const combinedPullingA = Math.max(touchPullingA, tiltSpeedBar, isKeyPullingA ? 1 : 0, this.isPullingA ? 1 : 0)
      const combinedPullingB = Math.max(touchPullingB, isKeyPullingB ? 1 : 0, this.isPullingB ? 1 : 0)

      this.controls.pullingA = moveToward(this.controls.pullingA, combinedPullingA, SPEEDBAR_RATE_IN, dt)
      this.controls.speedBar = this.controls.pullingA
      this.controls.pullingB = moveToward(this.controls.pullingB, combinedPullingB, 18.0, dt)

      // Weight shift blending: Touch lateral offset + Tilt roll + Dynamic Jerk pump
      const tiltContribution = this.controlMode === 'tilt_guidance' ? this.tiltWeightShift : this.tiltWeightShift * 0.45
      const targetWeightShift = clamp(this.touchWeightShift + tiltContribution + this.dynamicPumpMomentum, -1.0, 1.0)
      this.controls.weightShift = moveToward(this.controls.weightShift, targetWeightShift, WEIGHT_SHIFT_RATE, dt)
    } else if (
      this.keysDown.has('KeyA') ||
      this.keysDown.has('KeyD') ||
      this.keysDown.has('KeyW') ||
      this.keysDown.has('KeyS') ||
      this.keysDown.has('KeyB') ||
      this.keysDown.has('ArrowLeft') ||
      this.keysDown.has('ArrowRight') ||
      this.keysDown.has('ArrowUp') ||
      this.keysDown.has('ArrowDown') ||
      this.keysDown.has('KeyQ') ||
      this.keysDown.has('KeyE') ||
      this.keysDown.has('KeyF') ||
      this.keysDown.has('KeyJ') ||
      this.keysDown.has('Space') ||
      this.keysDown.has('ShiftLeft') ||
      this.keysDown.has('ShiftRight')
    ) {
      this.leftLagFrac = 0
      this.rightLagFrac = 0

      // Keyboard input: Authentic paraglider control framing
      const bothBrakes = this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')
      const leftDeepBrake = this.keysDown.has('KeyF')
      const rightDeepBrake = this.keysDown.has('KeyJ')
      const flare = this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight')

      const leftSteer =
        this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft') || this.keysDown.has('KeyQ')
      const rightSteer =
        this.keysDown.has('KeyD') ||
        this.keysDown.has('ArrowRight') ||
        this.keysDown.has('KeyE') ||
        this.keysDown.has('Semicolon')

      if (flare) {
        this.controls.leftBrake = moveToward(this.controls.leftBrake, 0.95, FULL_BRAKE_RATE * 3.0, dt)
        this.controls.rightBrake = moveToward(this.controls.rightBrake, 0.95, FULL_BRAKE_RATE * 3.0, dt)
      } else if (bothBrakes) {
        // Down Arrow / S: Pull back to flare, swoop upwards, and bleed speed
        this.controls.leftBrake = moveToward(this.controls.leftBrake, 0.88, FULL_BRAKE_RATE * 2.5, dt)
        this.controls.rightBrake = moveToward(this.controls.rightBrake, 0.88, FULL_BRAKE_RATE * 2.5, dt)
      } else {
        const targetLeft = leftDeepBrake ? 0.95 : leftSteer ? 0.72 : 0
        const targetRight = rightDeepBrake ? 0.95 : rightSteer ? 0.72 : 0
        const steerRate = 14.0 // Crisp immediate response
        this.controls.leftBrake = moveToward(this.controls.leftBrake, targetLeft, targetLeft > 0 ? steerRate : BRAKE_RELEASE_RATE * 2.0, dt)
        this.controls.rightBrake = moveToward(this.controls.rightBrake, targetRight, targetRight > 0 ? steerRate : BRAKE_RELEASE_RATE * 2.0, dt)
      }

      let kbWeightShift = 0
      if (leftDeepBrake) kbWeightShift = -1.0
      else if (leftSteer) kbWeightShift = -1.0
      if (rightDeepBrake) kbWeightShift = 1.0
      else if (rightSteer) kbWeightShift = 1.0
      this.controls.weightShift = moveToward(this.controls.weightShift, kbWeightShift, 12.0, dt)

      const barHeld =
        this.keysDown.has('Space') || this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp') || this.isPullingA
      this.controls.pullingA = moveToward(
        this.controls.pullingA,
        barHeld ? 1 : 0,
        barHeld ? 10.0 : 8.0,
        dt,
      )
      this.controls.speedBar = this.controls.pullingA

      const bHeld = this.keysDown.has('KeyB') || this.isPullingB
      this.controls.pullingB = moveToward(
        this.controls.pullingB,
        bHeld ? 1 : 0,
        18.0,
        dt,
      )

      // Paramotor throttle integration on keyboard
      const throttleHeld =
        this.keysDown.has('Space') || this.keysDown.has('KeyW') || this.keysDown.has('ShiftLeft')
      if (throttleHeld) {
        this.targetThrottle = Math.min(1.0, this.targetThrottle + 1.6 * dt)
      } else if (!this.isCruiseLocked) {
        this.targetThrottle = Math.max(0, this.targetThrottle - 1.1 * dt)
      }
    } else if (this.trackpadActive) {
      this.leftLagFrac = 0
      this.rightLagFrac = 0

      // Trackpad 2-Gesture Model (Up/Down + Left/Right)
      const timeSinceWheel = performance.now() - this.lastTrackpadTime

      if (timeSinceWheel > 70) {
        const springRateY = 5.0
        const springRateX = 6.0
        this.trackpadPitch = moveToward(this.trackpadPitch, 0, springRateY, dt)
        this.trackpadRoll = moveToward(this.trackpadRoll, 0, springRateX, dt)

        if (Math.abs(this.trackpadPitch) < 0.01 && Math.abs(this.trackpadRoll) < 0.01 && timeSinceWheel > 250) {
          this.trackpadPitch = 0
          this.trackpadRoll = 0
          this.trackpadActive = false
        }
      }

      this.controls.weightShift = moveToward(this.controls.weightShift, this.trackpadRoll, WEIGHT_SHIFT_RATE, dt)

      if (this.trackpadPitch > 0) {
        // Downward gesture: direct brake / flare / stall
        const baseBrake = this.trackpadPitch
        this.controls.speedBar = moveToward(this.controls.speedBar, 0, SPEEDBAR_RATE_OUT, dt)

        if (this.trackpadRoll < 0) {
          const steerBite = Math.abs(this.trackpadRoll) * 0.55
          const targetLeft = clamp(baseBrake + steerBite, 0, 1)
          const targetRight = clamp(baseBrake - steerBite * 0.7, 0, 1)
          this.controls.leftBrake = moveToward(this.controls.leftBrake, targetLeft, FULL_BRAKE_RATE, dt)
          this.controls.rightBrake = moveToward(this.controls.rightBrake, targetRight, FULL_BRAKE_RATE, dt)
        } else if (this.trackpadRoll > 0) {
          const steerBite = Math.abs(this.trackpadRoll) * 0.55
          const targetRight = clamp(baseBrake + steerBite, 0, 1)
          const targetLeft = clamp(baseBrake - steerBite * 0.7, 0, 1)
          this.controls.rightBrake = moveToward(this.controls.rightBrake, targetRight, FULL_BRAKE_RATE, dt)
          this.controls.leftBrake = moveToward(this.controls.leftBrake, targetLeft, FULL_BRAKE_RATE, dt)
        } else {
          this.controls.leftBrake = moveToward(this.controls.leftBrake, baseBrake, FULL_BRAKE_RATE, dt)
          this.controls.rightBrake = moveToward(this.controls.rightBrake, baseBrake, FULL_BRAKE_RATE, dt)
        }
      } else if (this.trackpadPitch < 0) {
        // Upward gesture: Speed Bar / Dive
        const targetSpeedBar = clamp(-this.trackpadPitch, 0, 1)
        this.controls.speedBar = moveToward(this.controls.speedBar, targetSpeedBar, SPEEDBAR_RATE_IN, dt)
        const leftTarget = this.trackpadRoll < 0 ? Math.abs(this.trackpadRoll) * 0.4 : 0
        const rightTarget = this.trackpadRoll > 0 ? Math.abs(this.trackpadRoll) * 0.4 : 0
        this.controls.leftBrake = moveToward(this.controls.leftBrake, leftTarget, FULL_BRAKE_RATE, dt)
        this.controls.rightBrake = moveToward(this.controls.rightBrake, rightTarget, FULL_BRAKE_RATE, dt)
      } else {
        // Neutral trim: Pure steering
        this.controls.speedBar = moveToward(this.controls.speedBar, 0, SPEEDBAR_RATE_OUT, dt)
        const leftTarget = this.trackpadRoll < 0 ? Math.abs(this.trackpadRoll) * 0.35 : 0
        const rightTarget = this.trackpadRoll > 0 ? Math.abs(this.trackpadRoll) * 0.35 : 0
        this.controls.leftBrake = moveToward(this.controls.leftBrake, leftTarget, FULL_BRAKE_RATE, dt)
        this.controls.rightBrake = moveToward(this.controls.rightBrake, rightTarget, FULL_BRAKE_RATE, dt)
      }
    } else {
      // Direct Phone Tilt-to-Steer Flight Mode:
      // Holding phone vertically in portrait mode with one hand:
      // Tilting left (negative roll) -> inside left brake pulls down to hip, right stays UP overhead, wing banks and carves left!
      // Tilting right (positive roll) -> inside right brake pulls down to hip, left stays UP overhead, wing banks and carves right!
      // Leaning forward (positive pitch) -> speedbar engages, canopy dives down the mountain slope at high speed!
      // Pulling back (negative pitch) -> both brakes pull down symmetrically into a swoop flare, bleeding speed!
      let rollDemand = this.tiltWeightShift // Already normalized -1.0 (left) to +1.0 (right)

      // Pitch demands:
      // this.tiltPitch > 0 -> tilted forward (dive / speedbar)
      // this.tiltPitch < 0 -> tilted backward (flare / swoop)
      let speedBarDemand = 0
      let flareDemand = 0

      if (this.tiltPitch > 0) {
        speedBarDemand = Math.min(1.0, Math.abs(this.tiltPitch) * 1.15)
      } else if (this.tiltPitch < 0) {
        flareDemand = Math.min(1.0, Math.abs(this.tiltPitch) * 1.15) * 0.95
      }

      let targetLeftBrake = 0
      let targetRightBrake = 0

      const snapBoost = this.snapIntensity * 0.35
      if (rollDemand < 0) {
        // Tilting LEFT
        const steerPull = clamp(Math.abs(rollDemand) + snapBoost, 0, 1.0)
        targetLeftBrake = Math.max(steerPull, flareDemand)
        targetRightBrake = flareDemand
      } else if (rollDemand > 0) {
        // Tilting RIGHT
        const steerPull = clamp(rollDemand + snapBoost, 0, 1.0)
        targetRightBrake = Math.max(steerPull, flareDemand)
        targetLeftBrake = flareDemand
      } else {
        targetLeftBrake = flareDemand
        targetRightBrake = flareDemand
      }

      // Dynamic responsive brake and weight shift rates
      const dynamicBrakeRate = 18.0 + this.snapIntensity * 22.0
      this.controls.leftBrake = moveToward(this.controls.leftBrake, targetLeftBrake, dynamicBrakeRate, dt)
      this.controls.rightBrake = moveToward(this.controls.rightBrake, targetRightBrake, dynamicBrakeRate, dt)

      const dynamicWeightRate = 14.0 + this.snapIntensity * 18.0
      const targetWeight = clamp(rollDemand + this.dynamicPumpMomentum, -1.0, 1.0)
      this.controls.weightShift = moveToward(this.controls.weightShift, targetWeight, dynamicWeightRate, dt)

      this.controls.speedBar = moveToward(this.controls.speedBar, speedBarDemand, SPEEDBAR_RATE_IN * 2.5, dt)
      this.controls.pullingA = this.controls.speedBar
    }

    // Smoothly decay snap intensity
    this.snapIntensity = moveToward(this.snapIntensity, 0, 3.2, dt)

    // Smoothly integrate throttle
    this.controls.throttle = moveToward(this.controls.throttle ?? 0, this.targetThrottle, 3.2, dt)

    // Smoothly decay dynamic acro pump momentum
    this.dynamicPumpMomentum = moveToward(this.dynamicPumpMomentum, 0, 2.5, dt)

    // Dynamic snap rate: d(brake)/dt for flare and violent dynamic maneuvers
    const safeDt = Math.max(0.001, dt)
    this.controls.leftBrakeRate = (this.controls.leftBrake - this.prevLeftBrake) / safeDt
    this.controls.rightBrakeRate = (this.controls.rightBrake - this.prevRightBrake) / safeDt

    this.prevLeftBrake = this.controls.leftBrake
    this.prevRightBrake = this.controls.rightBrake

    // Update native iOS Taptic Engine & tactile vibration feedback
    this.haptic.update(
      aeroResistanceLeftN,
      aeroResistanceRightN,
      isStalled,
      stallWarning,
      gForce,
      isFootDragging,
      dt,
      verticalWind,
    )
  }
}
