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
  public smoothedElevationDeg: number = 86.0
  public phoneElevationDeg: number = 86.0
  public neutralElevationDeg: number = 86.0
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
  /** A planted finger or a two-finger sideways drag. Tilt then slips instead of turning. */
  public strafeHold: boolean = false
  public touchStrafe: number = 0
  private activePointers: Map<
    number,
    { side: 'left' | 'right'; startX: number; startY: number; curX: number; curY: number; startTime: number; swipeTriggered: boolean }
  > = new Map()

  // Control mode & settings
  public controlMode: ControlMode = 'direct-tilt'
  public invertRollSteering: boolean = false // tilt left turns left, tilt right turns right
  public isCruiseLocked: boolean = false
  /** False on the wingsuit, so cruise cannot hold the rail above the chute pull. */
  public cruiseAllowed: boolean = false
  public targetThrottle: number = 0

  // Legacy touch visual placeholders for HUD / UI compatibility
  public leftThumbYFrac: number = 0
  public rightThumbYFrac: number = 0
  public activeTouchVisuals: ActiveTouchVisual[] = []

  // Callbacks
  public onToggleWing?: () => void
  public onCycleVantage?: () => void
  public onControlModeChange?: (mode: ControlMode) => void
  public onTriggerLoop?: (dir?: number) => void
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
      strafe: 0,
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
    if (typeof forceAngle === 'number' && forceAngle >= 60.0 && forceAngle <= 110.0) {
      this.neutralElevationDeg = forceAngle
    } else {
      // Keep neutral anchored at vertical (~86° looking straight at phone)
      this.neutralElevationDeg = 86.0
    }

    if (typeof forceRoll === 'number') {
      this.neutralRollDeg = forceRoll
    } else if (Math.abs(this.smoothedRollDeg) < 20.0) {
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
    this.tiltParallaxPitch = 0
    this.controls.leftBrake = 0
    this.controls.rightBrake = 0
    this.controls.speedBar = 0
    this.controls.weightShift = 0
    this.controls.strafe = 0
    this.strafeHold = false
    this.touchStrafe = 0
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
    this.isWingCollapsed = active
  }

  public setBailoutCollapse(active: boolean) {
    this.isWingCollapsed = active
    ;(this.controls as any).isCollapsed = active
  }

  public setTargetThrottle(throttle: number) {
    this.targetThrottle = clamp(throttle, 0, 1)
  }

  public toggleCruiseLock(): boolean {
    if (!this.cruiseAllowed) {
      this.isCruiseLocked = false
      return false
    }
    this.isCruiseLocked = !this.isCruiseLocked
    // 0.675 is 35% prop above the coast. Unlock returns to center, not the sock.
    this.targetThrottle = this.isCruiseLocked ? 0.675 : 0.5
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
        let rawElev = 86.0

        // Reconstruct 3D gravity vector from W3C Euler angles (beta, gamma)
        // Eliminates Euler gimbal lock at 90° vertical and prevents roll sign-flips when looking up (>90°)!
        const betaRad = (e.beta * Math.PI) / 180
        const gammaRad = (e.gamma * Math.PI) / 180
        const cosB = Math.cos(betaRad)
        const sinB = Math.sin(betaRad)
        const cosG = Math.cos(gammaRad)
        const sinG = Math.sin(gammaRad)

        // Device-frame gravity components:
        // gx: lateral (+right, -left)
        // gy: longitudinal along screen (+up when vertical)
        // gz: normal to screen (+out of screen when flat, 0 when vertical, -into screen when looking up)
        const gx = cosB * sinG
        const gy = sinB
        const gz = cosB * cosG

        if (screenAngle === 0 || screenAngle === 180 || isPortrait) {
          rawRoll = Math.asin(clamp(gx, -1, 1)) * (180 / Math.PI)
          rawElev = Math.atan2(gy, gz) * (180 / Math.PI)
        } else if (screenAngle === 90) {
          rawRoll = -Math.asin(clamp(gy, -1, 1)) * (180 / Math.PI)
          rawElev = Math.atan2( Math.abs(gx), gz) * (180 / Math.PI)
        } else {
          rawRoll = Math.asin(clamp(gy, -1, 1)) * (180 / Math.PI)
          rawElev = Math.atan2(Math.abs(gx), gz) * (180 / Math.PI)
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

    // 3. Swipe-Activated Aerobatics & Multi-Touch System:
    // - Swipe UP anywhere on screen -> 360° Backflip!
    // - Swipe DOWN anywhere on screen -> 360° Frontflip / Infinity Tumble!
    // - Swipe LEFT anywhere on screen -> Left Barrel Roll!
    // - Swipe RIGHT anywhere on screen -> Right Barrel Roll!
    const checkSwipeGesture = (
      ptr: { startX: number; startY: number; curX: number; curY: number; startTime: number; swipeTriggered: boolean },
    ): boolean => {
      if (ptr.swipeTriggered) return true
      const dx = ptr.curX - ptr.startX
      const dy = ptr.curY - ptr.startY
      const elapsedMs = performance.now() - ptr.startTime
      const verticalFlick = Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) >= 64 && elapsedMs <= 420
      // A short sideways nudge must NOT barrel-roll. Rolls are a long, fast flick with one finger.
      const horizontalFlick =
        this.activePointers.size < 2 &&
        Math.abs(dx) > Math.abs(dy) &&
        Math.abs(dx) >= 128 &&
        elapsedMs <= 320
      if (verticalFlick || horizontalFlick) {
        ptr.swipeTriggered = true
        if (verticalFlick) {
          this.onTriggerLoop?.(dy < 0 ? 1 : -1)
        } else {
          this.onTriggerRoll?.(dx < 0 ? -1 : 1)
        }
        return true
      }
      return false
    }

    window.addEventListener(
      'pointerdown',
      (e) => {
        const target = e.target as HTMLElement | null
        if (target && target.closest && target.closest('button, .hud-pill, .guide-card, a, #hud-locker-modal, #hud-world-modal, #hud-wasted-overlay, #hud-throttle-slider, #cesiumContainer, #earth-drop-bar, input, textarea')) {
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
          startTime: performance.now(),
          swipeTriggered: false,
        })
        this.recomputeStrafe()
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
        // Fire flip or barrel roll the instant the thumb flick crosses 32px!
        if (!checkSwipeGesture(ptr)) {
          this.recomputeTouchControls()
        }
        this.recomputeStrafe()
      },
      { passive: true },
    )

    const onPointerEnd = (e: PointerEvent) => {
      const ptr = this.activePointers.get(e.pointerId)
      if (ptr) {
        ptr.curX = e.clientX
        ptr.curY = e.clientY
        checkSwipeGesture(ptr)
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
      this.recomputeStrafe()
    }

    window.addEventListener('pointerup', onPointerEnd, { passive: true })
    window.addEventListener('pointercancel', onPointerEnd, { passive: true })
  }

  private recomputeTouchControls(): void {
    // When motion (tilt) is active, screen touches are dedicated to clean acrobatic swipes!
    if (this.isMotionActive) return
    let leftBrake = 0
    let rightBrake = 0
    let maxSpeedBar = 0
    const h = window.innerHeight || 800
    const dragTravel = Math.max(90.0, Math.min(180.0, h * 0.18))

    for (const ptr of this.activePointers.values()) {
      if (ptr.swipeTriggered) continue
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

  /**
   * Slip sideways without starting a turn, for the whole time a finger is down.
   * Tilt sets how far. Moving, braking, or flicking does not cancel it.
   * Two fingers dragged sideways together set an explicit slip.
   */
  private recomputeStrafe(): void {
    const ptrs = [...this.activePointers.values()]
    if (ptrs.length === 0) {
      this.strafeHold = false
      this.touchStrafe = 0
      return
    }

    this.strafeHold = true
    this.touchStrafe = 0

    if (ptrs.length >= 2) {
      const dxs = ptrs.map((ptr) => ptr.curX - ptr.startX)
      const dys = ptrs.map((ptr) => ptr.curY - ptr.startY)
      const lead = dxs[0]
      const sameDir = Math.abs(lead) > 14 && dxs.every((dx) => Math.sign(dx) === Math.sign(lead) && Math.abs(dx) > 10)
      const sideways = dxs.every((dx, i) => Math.abs(dx) > Math.abs(dys[i]) * 0.8)
      if (sameDir && sideways) {
        const avg = dxs.reduce((sum, dx) => sum + dx, 0) / dxs.length
        this.touchStrafe = Math.sign(avg) * clamp(Math.abs(avg) / 88, 0, 1)
      }
    }
  }

  private processMotion(rawRoll: number, rawElev: number, dt: number) {
    // Smooth low-pass filter to cushion wrist motion and prevent sudden spikes
    const rollFactor = 1.0 - Math.exp(-14.0 * dt)
    const elevFactor = 1.0 - Math.exp(-12.0 * dt)
    this.smoothedRollDeg += (rawRoll - this.smoothedRollDeg) * rollFactor
    this.smoothedElevationDeg += (rawElev - this.smoothedElevationDeg) * elevFactor
    this.phoneElevationDeg = this.smoothedElevationDeg

    // Auto-calibrate ONLY subtle resting roll bias on initial frames;
    // Keep neutralElevationDeg anchored at vertical (86°) so vertical posture is always neutral!
    if (this.needAutoCalibration) {
      this.autoCalibrateSampleCount++
      this.neutralElevationDeg = 86.0
      if (Math.abs(this.smoothedRollDeg) < 12.0) {
        this.neutralRollDeg += (this.smoothedRollDeg - this.neutralRollDeg) * 0.15
      }
      if (this.autoCalibrateSampleCount >= 12) {
        this.needAutoCalibration = false
      }
    }

    // 1. Roll Steering & Rock-Solid Stability in Neutrality:
    // Gimbal-lock-free roll angle (degrees) relative to calibrated neutral roll.
    const rollDelta = this.smoothedRollDeg - this.neutralRollDeg
    const absRoll = Math.abs(rollDelta)

    const DEADBAND_ROLL = 2.0
    const MAX_ROLL = 26.0

    if (absRoll < DEADBAND_ROLL) {
      this.tiltWeightShift = 0
    } else {
      const sign = Math.sign(rollDelta)
      const norm = clamp((absRoll - DEADBAND_ROLL) / (MAX_ROLL - DEADBAND_ROLL), 0, 1)
      // Progressive 1.55 curve: calm, fine-grained precision for small/medium tilts
      // so you're never thrown into extreme movement, while still allowing deep carves at full tilt!
      const mag = Math.pow(norm, 1.55)
      const steerSign = this.invertRollSteering ? -sign : sign
      this.tiltWeightShift = steerSign * mag
    }

    this.instantTwistRad = (this.tiltWeightShift * 0.08)

    // 2. Full-Range Pitch & Posture Envelope (0° Straight Down -> 45° Fast Glide -> 86° Vertical Neutral -> 120° Looking Up):
    // - Holding phone VERTICAL (~80° to 92°, looking straight at screen): Neutral slope-contouring glide at 64 km/h.
    // - Looking UP (> 92° up to 118°, tilting phone back toward sky): Flare / Climb upward + camera looks UP at canopy & sky.
    // - Looking DOWN at 45° (~45° angled downward view): Fast 100+ km/h downhill speed run + camera angles down the slope.
    // - Looking STRAIGHT DOWN (< 15° down to 0° flat): Full 136+ km/h steep speed dive + camera points straight down the mountain!
    const neutral = clamp(this.neutralElevationDeg, 78.0, 92.0)
    const downDeadband = 8.0 // A small nod stays level. Looking down is a deliberate dive.
    const upDeadband = 2.0   // A small look up starts the climb.

    const deltaElev = this.smoothedElevationDeg - neutral

    if (deltaElev < -downDeadband) {
      // Tilting downward from vertical (81° -> 45° fast downhill -> 10° looking straight down full dive!)
      const forwardLean = (-deltaElev) - downDeadband
      const fullDiveTravel = 68.0 // 81° down to 13° covers the full 0% -> 100% dive range!
      const norm = clamp(forwardLean / fullDiveTravel, 0, 1)
      // Direct response: looking down dives right away. The steep dive then gathers speed in the wing.
      this.diveDemand = Math.pow(norm, 1.05)
      this.flareDemand = 0
      this.pitchDemand = this.diveDemand
      this.tiltParallaxPitch = -this.diveDemand * 0.68 // Strong downward camera tilt as you angle phone down
    } else if (deltaElev > upDeadband) {
      // Looking UP past vertical (90° -> 118°): float, slow down, climb, and look up at the sky!
      const backwardLean = deltaElev - upDeadband
      const fullFlareTravel = 14.0 // The view and the climb rise across the tilt, not in one step.
      const norm = clamp(backwardLean / fullFlareTravel, 0, 1)
      this.flareDemand = Math.pow(norm, 0.9)
      this.diveDemand = 0
      this.pitchDemand = -this.flareDemand
      this.tiltParallaxPitch = this.flareDemand * 0.62
    } else {
      // Pure Vertical Neutral Glide (~81° to 90° looking straight at screen)
      this.diveDemand = 0
      this.flareDemand = 0
      this.pitchDemand = 0
      this.tiltParallaxPitch = 0
    }
  }

  public update(dt: number, ..._rest: any[]): void {
    let targetLeftBrake = this.touchLeftBrake
    let targetRightBrake = this.touchRightBrake
    let targetSpeedBar = this.touchSpeedBar
    let targetWeightShift = 0

    // 1. Desktop Keyboard Controls:
    if (this.keysDown.has('ArrowLeft') || this.keysDown.has('KeyA')) {
      targetLeftBrake = Math.max(targetLeftBrake, 0.45)
      targetWeightShift = -0.75
    }
    if (this.keysDown.has('ArrowRight') || this.keysDown.has('KeyD')) {
      targetRightBrake = Math.max(targetRightBrake, 0.45)
      targetWeightShift = 0.75
    }
    if (this.keysDown.has('ArrowDown') || this.keysDown.has('KeyS')) {
      targetLeftBrake = Math.max(targetLeftBrake, 0.70)
      targetRightBrake = Math.max(targetRightBrake, 0.70)
    }
    if (this.keysDown.has('ArrowUp') || this.keysDown.has('KeyW')) {
      targetSpeedBar = Math.max(targetSpeedBar, 0.85)
    }
    const wantsKeyboardCollapse = this.keysDown.has('KeyB')

    // 2. Mobile Motion (Tilt) Integration:
    if (this.isMotionActive) {
      if (this.diveDemand > 0) targetSpeedBar = Math.max(targetSpeedBar, this.diveDemand)
      if (this.flareDemand > 0) {
        targetLeftBrake = Math.max(targetLeftBrake, this.flareDemand)
        targetRightBrake = Math.max(targetRightBrake, this.flareDemand)
      }
      // Tilt banks the wing. It does not slide the body sideways.
      const tilt = this.tiltWeightShift
      targetWeightShift = tilt
      const absTilt = Math.abs(tilt)
      if (absTilt > 0.72) {
        const insideBrake = ((absTilt - 0.72) / 0.28) * 0.2
        if (tilt < 0) targetLeftBrake = Math.max(targetLeftBrake, insideBrake)
        else targetRightBrake = Math.max(targetRightBrake, insideBrake)
      }
    }

    let targetStrafe = this.touchStrafe
    if (this.keysDown.has('Comma')) targetStrafe = -1
    if (this.keysDown.has('Period')) targetStrafe = 1
    if (this.keysDown.has('Comma') || this.keysDown.has('Period') || Math.abs(targetStrafe) >= 0.08) {
      targetWeightShift = 0
    }

    // 3. Smooth, Cushioned Physical Control Actuation:
    const brakeFollow = 16.0
    const steerFollow = 18.0
    const strafeFollow = 12.0
    const barFollow = 14.0
    const throttleFollow = 14.0

    // Throttle input from keyboard (Space, Shift, or X), or touch/cruise dock:
    const isThrottleKeyDown =
      this.keysDown.has('Space') ||
      this.keysDown.has('ShiftLeft') ||
      this.keysDown.has('ShiftRight') ||
      this.keysDown.has('KeyX')
    let desiredThrottle = this.targetThrottle
    if (isThrottleKeyDown) {
      desiredThrottle = 1.0
    } else if (this.cruiseAllowed && this.isCruiseLocked) {
      desiredThrottle = Math.max(desiredThrottle, 0.675)
    }

    this.controls.weightShift += (targetWeightShift - this.controls.weightShift) * Math.min(1.0, steerFollow * dt)
    const strafeNow = this.controls.strafe || 0
    this.controls.strafe = strafeNow + (targetStrafe - strafeNow) * Math.min(1.0, strafeFollow * dt)
    this.controls.leftBrake += (targetLeftBrake - this.controls.leftBrake) * Math.min(1.0, brakeFollow * dt)
    this.controls.rightBrake += (targetRightBrake - this.controls.rightBrake) * Math.min(1.0, brakeFollow * dt)
    this.controls.speedBar += (targetSpeedBar - this.controls.speedBar) * Math.min(1.0, barFollow * dt)
    this.controls.pullingA = this.controls.speedBar
    const curThrottle = this.controls.throttle ?? 0
    // A jump from the chute half up to the prop must not drag the chute open on the way.
    const from = desiredThrottle >= 0.5 && curThrottle < 0.5 ? 0.5 : curThrottle
    this.controls.throttle = from + (desiredThrottle - from) * Math.min(1.0, throttleFollow * dt)
    ;(this.controls as any).isCollapsed = this.isWingCollapsed || wantsKeyboardCollapse
  }

  public dispose() {
    this.keysDown.clear()
  }
}
