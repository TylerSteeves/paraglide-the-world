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
  public touchSteer: number = 0
  public touchLeftBrake: number = 0
  public touchRightBrake: number = 0
  public touchSpeedBar: number = 0
  public touchDive: number = 0
  public touchFlare: number = 0
  public isTouchSteering: boolean = false
  private activePointers: Map<number, { side: 'left' | 'right'; startX: number; startY: number; curX: number; curY: number }> = new Map()

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
    if (typeof forceAngle === 'number' && forceAngle >= 32.0 && forceAngle <= 82.0) {
      this.neutralElevationDeg = forceAngle
    } else if (this.phoneElevationDeg >= 32.0 && this.phoneElevationDeg <= 82.0) {
      this.neutralElevationDeg = this.phoneElevationDeg
    } else {
      this.neutralElevationDeg = 56.0
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
    this.targetThrottle = this.isCruiseLocked ? 0.35 : 0
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
      if (e.code === 'KeyF') {
        this.onTriggerLoop?.()
      } else if (e.code === 'KeyC') {
        this.toggleCruiseLock()
      } else if (e.code === 'KeyQ') {
        this.onTriggerRoll?.(-1)
      } else if (e.code === 'KeyE') {
        this.onTriggerRoll?.(1)
      }
    })
    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code)
    })

    // 3. Dual Independent Brake Toggle Multi-Touch System:
    // Left side of screen controls Left Brake Toggle.
    // Right side of screen controls Right Brake Toggle.
    // Dragging down pulls that toggle down with 100% linear, finite precision!
    // Dragging both down enters Minimum Sink float or flares!
    // Dragging up engages Speed Bar!
    let lastTapTime = 0

    window.addEventListener(
      'pointerdown',
      (e) => {
        const target = e.target as HTMLElement | null
        if (target && target.closest && target.closest('button, .hud-pill, .guide-card, a')) {
          return
        }
        const w = window.innerWidth || 400
        const side: 'left' | 'right' = e.clientX < w * 0.5 ? 'left' : 'right'
        this.activePointers.set(e.pointerId, {
          side,
          startX: e.clientX,
          startY: e.clientY,
          curX: e.clientX,
          curY: e.clientY,
        })
        this.isTouchSteering = true
        this.recomputeTouchControls()
      },
      { passive: true },
    )

    window.addEventListener(
      'pointermove',
      (e) => {
        const ptr = this.activePointers.get(e.pointerId)
        if (!ptr) return
        ptr.curX = e.clientX
        ptr.curY = e.clientY
        this.recomputeTouchControls()
      },
      { passive: true },
    )

    const onPointerEnd = (e: PointerEvent) => {
      const ptr = this.activePointers.get(e.pointerId)
      if (ptr) {
        const dx = e.clientX - ptr.startX
        const dy = e.clientY - ptr.startY
        const dist = Math.hypot(dx, dy)
        // Double-tap or quick flick gesture for aerobatics:
        const now = performance.now()
        if (dist > 45 && Math.abs(dy) > Math.abs(dx) && dy < -40) {
          this.onTriggerLoop?.()
        } else if (dist < 20) {
          if (now - lastTapTime < 350) {
            if (e.clientX < (window.innerWidth || 400) * 0.35) {
              this.onTriggerRoll?.(-1)
            } else if (e.clientX > (window.innerWidth || 400) * 0.65) {
              this.onTriggerRoll?.(1)
            } else {
              this.onTriggerLoop?.()
            }
            lastTapTime = 0
          } else {
            lastTapTime = now
          }
        }
        this.activePointers.delete(e.pointerId)
      }

      if (this.activePointers.size === 0) {
        this.isTouchSteering = false
        this.touchLeftBrake = 0
        this.touchRightBrake = 0
        this.touchSpeedBar = 0
        this.touchSteer = 0
        this.touchDive = 0
        this.touchFlare = 0
      } else {
        this.recomputeTouchControls()
      }
    }

    window.addEventListener('pointerup', onPointerEnd, { passive: true })
    window.addEventListener('pointercancel', onPointerEnd, { passive: true })
  }

  private recomputeTouchControls(): void {
    let leftBrake = 0
    let rightBrake = 0
    let maxSpeedBar = 0
    const h = window.innerHeight || 800
    const dragTravel = Math.max(90.0, Math.min(180.0, h * 0.18))

    for (const ptr of this.activePointers.values()) {
      const dy = ptr.curY - ptr.startY
      if (dy > 3.0) {
        // Dragging down: pulls brake toggle on this side!
        const pull = clamp((dy - 3.0) / dragTravel, 0.0, 1.0)
        // Smooth linear response gives direct 1:1 finger connection to the brake lines:
        if (ptr.side === 'left') {
          leftBrake = Math.max(leftBrake, pull)
        } else {
          rightBrake = Math.max(rightBrake, pull)
        }
      } else if (dy < -4.0) {
        // Dragging up: pushes speed bar / deep dive accelerator with immediate thumb flick!
        const speedBarTravel = Math.max(40.0, Math.min(65.0, h * 0.07))
        const barPull = clamp((-dy - 4.0) / speedBarTravel, 0.0, 1.0)
        maxSpeedBar = Math.max(maxSpeedBar, barPull)
      }
    }

    this.touchLeftBrake = leftBrake
    this.touchRightBrake = rightBrake
    this.leftThumbYFrac = leftBrake
    this.rightThumbYFrac = rightBrake
    this.leftLagFrac = leftBrake
    this.rightLagFrac = rightBrake
    this.touchSpeedBar = maxSpeedBar
    this.touchSteer = rightBrake - leftBrake
    this.touchDive = maxSpeedBar
    this.touchFlare = Math.min(leftBrake, rightBrake)
  }

  private processMotion(rawRoll: number, rawElev: number, dt: number) {
    // Clean low-pass filter (EMA, ~50ms tau)
    const rollFactor = 1.0 - Math.exp(-22.0 * dt)
    const elevFactor = 1.0 - Math.exp(-18.0 * dt)
    this.smoothedRollDeg += (rawRoll - this.smoothedRollDeg) * rollFactor
    this.smoothedElevationDeg += (rawElev - this.smoothedElevationDeg) * elevFactor
    this.phoneElevationDeg = this.smoothedElevationDeg

    // Capture resting neutral angle on initial steady frames after launch
    if (this.needAutoCalibration && this.smoothedElevationDeg >= 35.0 && this.smoothedElevationDeg <= 78.0) {
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
    // 1. Roll Steering: Snappy, direct response with tight center detent
    const rollDelta = this.smoothedRollDeg - this.neutralRollDeg
    const absRoll = Math.abs(rollDelta)

    const DEADBAND_ROLL = 1.2
    const MAX_ROLL = 16.0

    if (absRoll < DEADBAND_ROLL) {
      this.tiltWeightShift = 0
    } else {
      const sign = Math.sign(rollDelta)
      const norm = clamp((absRoll - DEADBAND_ROLL) / (MAX_ROLL - DEADBAND_ROLL), 0, 1)
      const mag = Math.pow(norm, 1.05) // Immediate linear-crisp bite
      const steerSign = this.invertRollSteering ? -sign : sign
      this.tiltWeightShift = steerSign * mag
    }

    this.instantTwistRad = (this.tiltWeightShift * 0.12)

    // 2. Pitch & Wing Envelope:
    // Natural tight deadband (1.8°) prevents drift in neutral posture.
    // Leaning forward just 8° from neutral reaches full deep dive effortlessly without straining hands!
    const neutral = clamp(this.neutralElevationDeg, 42.0, 72.0)
    const deadband = 1.8

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
      // Natural, ergonomic forward tilt travel:
      // A gentle 8° forward tilt reaches 100% full dive!
      const forwardLean = (neutral - deadband) - this.smoothedElevationDeg
      const fullDiveTravel = 8.0 // 8° forward tilt reaches max dive
      const norm = clamp(forwardLean / fullDiveTravel, 0, 1)
      this.diveDemand = Math.pow(norm, 1.0) // Direct 1:1 forward dive response
      this.flareDemand = 0
      this.pitchDemand = this.diveDemand
    } else if (this.smoothedElevationDeg > neutral + deadband) {
      // Looking upwards: flares, hovers and floats
      const flareTravel = 86.0 - (neutral + deadband)
      const norm = clamp((this.smoothedElevationDeg - (neutral + deadband)) / Math.max(8.0, flareTravel), 0, 1)
      this.flareDemand = Math.pow(norm, 1.1)
      this.diveDemand = 0
      this.pitchDemand = -this.flareDemand
    } else {
      // Level Trim Glide in Big Sky
      this.diveDemand = 0
      this.flareDemand = 0
      this.pitchDemand = 0
    }
  }

  public update(dt: number, ..._rest: any[]): void {
    let targetLeftBrake = this.touchLeftBrake
    let targetRightBrake = this.touchRightBrake
    let targetSpeedBar = this.touchSpeedBar
    let targetWeightShift = 0

    // 1. Desktop Keyboard Controls:
    if (this.keysDown.has('ArrowLeft') || this.keysDown.has('KeyA')) {
      targetLeftBrake = Math.max(targetLeftBrake, 0.55)
      targetWeightShift = -0.85
    }
    if (this.keysDown.has('ArrowRight') || this.keysDown.has('KeyD')) {
      targetRightBrake = Math.max(targetRightBrake, 0.55)
      targetWeightShift = 0.85
    }
    if (this.keysDown.has('ArrowDown') || this.keysDown.has('KeyS')) {
      targetLeftBrake = Math.max(targetLeftBrake, 0.70)
      targetRightBrake = Math.max(targetRightBrake, 0.70)
    }
    if (this.keysDown.has('ArrowUp') || this.keysDown.has('KeyW')) {
      targetSpeedBar = Math.max(targetSpeedBar, 1.0)
    }

    // 2. Mobile Motion (Tilt) Integration:
    if (this.isMotionActive) {
      if (this.diveDemand > 0) targetSpeedBar = Math.max(targetSpeedBar, this.diveDemand)
      if (this.flareDemand > 0) {
        targetLeftBrake = Math.max(targetLeftBrake, this.flareDemand)
        targetRightBrake = Math.max(targetRightBrake, this.flareDemand)
      }
      // If not overriding with active thumb touch, tilt provides direct weight shift + coordinated brake assist:
      if (!this.isTouchSteering) {
        targetWeightShift = this.tiltWeightShift
        if (Math.abs(this.tiltWeightShift) > 0.05) {
          if (this.tiltWeightShift < 0) {
            targetLeftBrake = Math.max(targetLeftBrake, Math.abs(this.tiltWeightShift) * 0.45)
          } else {
            targetRightBrake = Math.max(targetRightBrake, this.tiltWeightShift * 0.45)
          }
        }
      } else {
        // Subtle tilt complement during touch
        targetWeightShift = this.tiltWeightShift * 0.65
      }
    }

    // 3. Crisp Physical Control Actuation:
    const brakeFollow = 34.0
    const steerFollow = 38.0
    const barFollow = 30.0
    const throttleFollow = 16.0

    // Throttle input from keyboard (Space, Shift, or X), or touch/cruise dock:
    const isThrottleKeyDown =
      this.keysDown.has('Space') ||
      this.keysDown.has('ShiftLeft') ||
      this.keysDown.has('ShiftRight') ||
      this.keysDown.has('KeyX')
    let desiredThrottle = this.targetThrottle
    if (isThrottleKeyDown) {
      desiredThrottle = 1.0
    } else if (this.isCruiseLocked) {
      desiredThrottle = Math.max(desiredThrottle, 0.35)
    }

    this.controls.weightShift += (targetWeightShift - this.controls.weightShift) * Math.min(1.0, steerFollow * dt)
    this.controls.leftBrake += (targetLeftBrake - this.controls.leftBrake) * Math.min(1.0, brakeFollow * dt)
    this.controls.rightBrake += (targetRightBrake - this.controls.rightBrake) * Math.min(1.0, brakeFollow * dt)
    this.controls.speedBar += (targetSpeedBar - this.controls.speedBar) * Math.min(1.0, barFollow * dt)
    this.controls.pullingA = this.controls.speedBar
    const curThrottle = this.controls.throttle ?? 0
    this.controls.throttle = curThrottle + (desiredThrottle - curThrottle) * Math.min(1.0, throttleFollow * dt)
    ;(this.controls as any).isCollapsed = this.isWingCollapsed
  }

  public dispose() {
    this.keysDown.clear()
  }
}
