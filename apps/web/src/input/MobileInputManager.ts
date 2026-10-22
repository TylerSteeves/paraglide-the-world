import type { FlightControls } from '../physics/types'
import { HapticManager } from './HapticManager'

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Fastest the brakes can be moved, in fractions of full travel per second.
 *
 * A hand is not a switch. Full travel in a bit under half a second is a quick,
 * decisive pull; a keypress or a flick of the phone would otherwise arrive in
 * about fifty milliseconds, which is an order of magnitude faster than any arm
 * can move. That matters now that the flight model has a pendulum: an input
 * that fast spikes the angle of attack as the canopy pitches back, and stalls
 * the wing at brake settings it should fly happily at. The EN test standard
 * applies brake over about five seconds for the same reason.
 */
const MAX_BRAKE_RATE_PER_SEC = 2.2

/** Moves a brake toward its target, smoothed and then rate-limited. */
function moveBrake(current: number, target: number, follow: number, dt: number): number {
  const smoothed = current + (target - current) * Math.min(1, follow * dt)
  const maxStep = MAX_BRAKE_RATE_PER_SEC * dt
  return clamp(smoothed, current - maxStep, current + maxStep)
}

/** Backward tilt, in degrees, that reaches full brake travel. */
const FULL_BRAKE_TILT_DEG = 22.0

/** Forward tilt, in degrees, that reaches full speed bar. */
const FULL_BAR_TILT_DEG = 14.0

/** Roll, in degrees, that reaches full weight shift. */
const FULL_SHIFT_TILT_DEG = 26.0

/**
 * Shapes tilt onto brake travel.
 *
 * Two thirds of the tilt covers the first 60% of brake travel -- hands-up
 * through minimum sink to slow flight, which is where a pilot lives -- and the
 * remaining third covers the last 40%, where the wing approaches and then
 * passes the stall. Fine control where it is needed, and a deliberate reach
 * for the part that bites.
 */
function shapeBrakeTravel(norm: number): number {
  const KNEE = 2 / 3
  const USEFUL = 0.6
  if (norm <= KNEE) return (norm / KNEE) * USEFUL
  return USEFUL + ((norm - KNEE) / (1 - KNEE)) * (1 - USEFUL)
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
  public smoothedElevationDeg: number = 78.0
  public phoneElevationDeg: number = 78.0
  public neutralElevationDeg: number = 78.0
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
    if (typeof forceAngle === 'number' && forceAngle >= 25.0 && forceAngle <= 105.0) {
      this.neutralElevationDeg = forceAngle
    } else if (this.phoneElevationDeg >= 25.0 && this.phoneElevationDeg <= 105.0) {
      this.neutralElevationDeg = this.phoneElevationDeg
    } else {
      this.neutralElevationDeg = 78.0
    }

    if (typeof forceRoll === 'number') {
      this.neutralRollDeg = forceRoll
    } else if (Math.abs(this.smoothedRollDeg) < 25.0) {
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
        let rawElev = 78.0

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

    // Capture resting neutral angle on initial steady frames after launch:
    // Allows players holding phone comfortably anywhere from 30° to 105° (upright or relaxed)
    if (this.needAutoCalibration && this.smoothedElevationDeg >= 30.0 && this.smoothedElevationDeg <= 105.0) {
      this.autoCalibrateSampleCount++
      if (this.autoCalibrateSampleCount === 1) {
        this.neutralElevationDeg = this.smoothedElevationDeg
        this.neutralRollDeg = Math.abs(this.smoothedRollDeg) < 22.0 ? this.smoothedRollDeg : 0
      } else {
        this.neutralElevationDeg += (this.smoothedElevationDeg - this.neutralElevationDeg) * 0.20
        if (Math.abs(this.smoothedRollDeg) < 22.0) {
          this.neutralRollDeg += (this.smoothedRollDeg - this.neutralRollDeg) * 0.20
        }
      }
      if (this.autoCalibrateSampleCount >= 18) {
        this.needAutoCalibration = false
      }
    }

    // 1. Roll Steering & Rock-Solid Stability in Neutrality:
    // Natural human phone holding has slight resting asymmetry and tremor.
    // Roll is measured relative to calibrated neutral resting posture (neutralRollDeg).
    const rollDelta = this.smoothedRollDeg - this.neutralRollDeg
    const absRoll = Math.abs(rollDelta)

    const DEADBAND_ROLL = 1.4
    const MAX_ROLL = FULL_SHIFT_TILT_DEG

    if (absRoll < DEADBAND_ROLL) {
      this.tiltWeightShift = 0
    } else {
      const sign = Math.sign(rollDelta)
      const norm = clamp((absRoll - DEADBAND_ROLL) / (MAX_ROLL - DEADBAND_ROLL), 0, 1)
      // Smooth progressive exponential power curve (1.55):
      // Minute wrist micro-corrections give silky, surgical control around center (zero huge swings),
      // while deep intentional banking smoothly delivers full carving authority!
      const mag = Math.pow(norm, 1.55)
      const steerSign = this.invertRollSteering ? -sign : sign
      this.tiltWeightShift = steerSign * mag
    }

    this.instantTwistRad = (this.tiltWeightShift * 0.12)

    // 2. Pitch & Wing Envelope:
    // Natural, rock-solid stability in neutral posture (looking straight at screen).
    // Neutral elevation is the player's comfortable resting posture (typically 75°-85° upright).
    const neutral = clamp(this.neutralElevationDeg, 30.0, 105.0)
    const deadband = 2.0 // +/- 2.0° deadband around neutral for tremor-free resting stability

    // Looking straight at the screen or looking up at the sky must NEVER collapse the wing!
    this.isWingCollapsed = false

    const deltaElev = this.smoothedElevationDeg - neutral

    // 2b. Phone pitch maps to the speed system and the brakes.
    //
    //   tip the phone away from you  ->  speed bar
    //   tip it back toward you       ->  brakes
    //
    // The brake mapping is shaped, not linear, and the reason is that the
    // brakes can now genuinely stall the wing. Brake travel on a real glider
    // runs about three quarters of a metre from hands-up to the stall, and a
    // pilot spends almost all of their time in the first half of it. Mapping
    // a phone's small comfortable tilt range linearly onto that travel would
    // put the stall a couple of degrees of wrist movement away.
    //
    // So the first two thirds of the tilt cover the useful range, hands-up
    // through minimum sink to slow flight, with fine resolution. Reaching the
    // last of the travel, where the wing actually lets go, takes a deliberate
    // deep lean. You can still stall it. You just have to mean it.
    if (deltaElev < -deadband) {
      const forwardLean = -deltaElev - deadband
      const norm = clamp(forwardLean / FULL_BAR_TILT_DEG, 0, 1)
      this.diveDemand = norm
      this.flareDemand = 0
      this.pitchDemand = norm
      this.tiltParallaxPitch = -norm * 0.22
    } else if (deltaElev > deadband) {
      const backwardLean = deltaElev - deadband
      const norm = clamp(backwardLean / FULL_BRAKE_TILT_DEG, 0, 1)
      this.flareDemand = shapeBrakeTravel(norm)
      this.diveDemand = 0
      this.pitchDemand = -this.flareDemand
      this.tiltParallaxPitch = this.flareDemand * 0.16
    } else {
      // Neutral posture: hands up, trim glide.
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

    // 1. Desktop keyboard controls.
    //
    // Brake values stop short of the stall. An EN-B wing lets go somewhere
    // around three quarters of its brake travel, and a key is a step input: a
    // tap that buries the brakes spikes the angle of attack and stalls the
    // wing, which is correct behaviour and a miserable way to lose a flight.
    // Holding shift reaches the rest of the travel for anyone who wants it.
    const deepBrake = this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight')
    // Enough inside brake for a positive turn, short of the amount that winds
    // an EN-B up into a spiral if you simply hold it. Shift gives the rest.
    const turnBrake = deepBrake ? 0.75 : 0.38
    const bothBrake = deepBrake ? 1.0 : 0.55

    if (this.keysDown.has('ArrowLeft') || this.keysDown.has('KeyA')) {
      targetLeftBrake = Math.max(targetLeftBrake, turnBrake)
      targetWeightShift = -0.85
    }
    if (this.keysDown.has('ArrowRight') || this.keysDown.has('KeyD')) {
      targetRightBrake = Math.max(targetRightBrake, turnBrake)
      targetWeightShift = 0.85
    }
    if (this.keysDown.has('ArrowDown') || this.keysDown.has('KeyS')) {
      targetLeftBrake = Math.max(targetLeftBrake, bothBrake)
      targetRightBrake = Math.max(targetRightBrake, bothBrake)
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
      // Tilt is a coordinated turn input, not just weight shift.
      //
      // Weight shift alone is worth only seven or eight degrees of bank on an
      // EN-B wing -- that is what the validation suite measures, and it is
      // what a real one does. A pilot turns with weight shift and inside
      // brake together, so leaning the phone does both: the shift leads, and
      // inside brake comes in progressively past a quarter of the travel.
      // Without it, leaning the phone over would barely turn the glider.
      if (!this.isTouchSteering) {
        targetWeightShift = this.tiltWeightShift
        const absTilt = Math.abs(this.tiltWeightShift)
        if (absTilt > 0.25) {
          const insideBrake = ((absTilt - 0.25) / 0.75) * 0.45
          if (this.tiltWeightShift < 0) {
            targetLeftBrake = Math.max(targetLeftBrake, insideBrake)
          } else {
            targetRightBrake = Math.max(targetRightBrake, insideBrake)
          }
        }
      } else {
        // Subtle tilt complement during touch
        targetWeightShift = this.tiltWeightShift * 0.65
      }
    }

    // 3. Control actuation rates.
    //
    // These are the hand, not the wing. The lag that matters -- the canopy
    // pitching back as you brake, and surging when you release -- now comes
    // from the flight model's pendulum, so these only need to be quick enough
    // not to feel mushy and slow enough that a flick of the wrist is not a
    // step input. A step input to the brakes provokes a real pitch surge,
    // which is correct, but it should take an actual movement to cause one.
    const brakeFollow = 22.0
    const steerFollow = 38.0
    const barFollow = 30.0
    const throttleFollow = 16.0

    // Throttle input from keyboard (Space, Shift, or X), or touch/cruise dock:
    // Shift is the deep-brake modifier, so throttle keeps Space and X.
    const isThrottleKeyDown = this.keysDown.has('Space') || this.keysDown.has('KeyX')
    let desiredThrottle = this.targetThrottle
    if (isThrottleKeyDown) {
      desiredThrottle = 1.0
    } else if (this.isCruiseLocked) {
      desiredThrottle = Math.max(desiredThrottle, 0.35)
    }

    const previousLeftBrake = this.controls.leftBrake
    const previousRightBrake = this.controls.rightBrake

    this.controls.weightShift +=
      (targetWeightShift - this.controls.weightShift) * Math.min(1.0, steerFollow * dt)
    this.controls.leftBrake = moveBrake(this.controls.leftBrake, targetLeftBrake, brakeFollow, dt)
    this.controls.rightBrake = moveBrake(
      this.controls.rightBrake,
      targetRightBrake,
      brakeFollow,
      dt,
    )
    this.controls.speedBar +=
      (targetSpeedBar - this.controls.speedBar) * Math.min(1.0, barFollow * dt)

    // How fast the hands are moving, which the harness animation uses.
    const safeDt = Math.max(1e-4, dt)
    this.controls.leftBrakeRate = (this.controls.leftBrake - previousLeftBrake) / safeDt
    this.controls.rightBrakeRate = (this.controls.rightBrake - previousRightBrake) / safeDt

    // Speed bar and A-riser pull are one physical action: the bar shortens the
    // A risers through the pulleys. Mirrored here so the riser animation
    // follows the bar; the flight model treats them as the same input and
    // takes the larger rather than adding them.
    this.controls.pullingA = this.controls.speedBar
    const curThrottle = this.controls.throttle ?? 0
    this.controls.throttle = curThrottle + (desiredThrottle - curThrottle) * Math.min(1.0, throttleFollow * dt)
    ;(this.controls as any).isCollapsed = this.isWingCollapsed
  }

  public dispose() {
    this.keysDown.clear()
  }
}
