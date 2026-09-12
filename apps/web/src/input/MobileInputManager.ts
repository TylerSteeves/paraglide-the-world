import type { FlightControls } from '../physics/types'

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
export const FULL_BRAKE_RATE = 22.0     // Direct, violent dynamic application (<0.05s)
export const BRAKE_RELEASE_RATE = 16.0  // Crisp rebound
export const WEIGHT_SHIFT_RATE = 12.0
export const SPEEDBAR_RATE_IN = 8.0
export const SPEEDBAR_RATE_OUT = 10.0

// ---- Touch & Mouse drag model ----------------------------------------
const TOUCH_MAX_DRAG_PX = 140
const TOUCH_DEADZONE_PX = 8
const TOUCH_CURVE_EXPONENT = 1.4

function touchCurve(dragY: number): number {
  if (dragY <= 0) return 0
  const eff = Math.max(0, dragY - TOUCH_DEADZONE_PX)
  const range = TOUCH_MAX_DRAG_PX - TOUCH_DEADZONE_PX
  const t = clamp(eff / range, 0, 1)
  return Math.pow(t, TOUCH_CURVE_EXPONENT)
}

export class MobileInputManager {
  public controls: FlightControls
  private neutralGamma: number = 0
  private hasGyroPermission: boolean = false
  private prevLeftBrake: number = 0
  private prevRightBrake: number = 0
  private gyroTargetWeightShift: number = 0

  // Touch tracking (Mobile dual-thumb)
  private leftTouchId: number | null = null
  private rightTouchId: number | null = null
  private leftStartX: number = 0
  private leftStartY: number = 0
  private rightStartX: number = 0
  private rightStartY: number = 0
  private touchLeftBrake: number = 0
  private touchRightBrake: number = 0
  private touchLeftSpeedBar: number = 0
  private touchRightSpeedBar: number = 0
  private touchWeightShift: number = 0

  // Trackpad 2-gesture tracking (Up/Down + Left/Right)
  public trackpadPitch: number = 0 // -1.0 (speed bar) to +1.0 (full brake / flare / stall)
  public trackpadRoll: number = 0  // -1.0 (steer left) to +1.0 (steer right)
  public invertTrackpadY: boolean = false // Normal: pull fingers down = pull brakes down
  public trackpadActive: boolean = false
  private lastTrackpadTime: number = 0

  // Mouse drag tracking (Desktop fallback)
  private isMouseDown: boolean = false
  private mouseSide: 'left' | 'right' | null = null
  private mouseStartY: number = 0
  private mouseStartX: number = 0

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
      reverseStance: false,
    }

    this.setupTrackpadListeners()
    this.setupTouchListeners()
    this.setupMouseListeners()
    this.setupKeyboardListeners()
    this.setupGamepadListeners()
  }

  public toggleReverseStance() {
    this.controls.reverseStance = !this.controls.reverseStance
  }

  public toggleInvertTrackpad(): boolean {
    this.invertTrackpadY = !this.invertTrackpadY
    this.onToggleInvertTrackpad?.(this.invertTrackpadY)
    return this.invertTrackpadY
  }

  public async requestGyroPermission(): Promise<boolean> {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      // @ts-expect-error - iOS specific requestPermission
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        // @ts-expect-error - iOS specific requestPermission
        const permission = await DeviceOrientationEvent.requestPermission()
        if (permission === 'granted') {
          this.setupOrientationListener()
          this.hasGyroPermission = true
          return true
        }
      } catch (err) {
        console.warn('Gyro permission rejected:', err)
      }
    } else if (typeof window !== 'undefined' && 'ondeviceorientation' in window) {
      this.setupOrientationListener()
      this.hasGyroPermission = true
      return true
    }
    return false
  }

  public calibrateNeutral() {
    this.neutralGamma = 0
    this.gyroTargetWeightShift = 0
    this.controls.weightShift = 0
  }

  private setupOrientationListener() {
    window.addEventListener(
      'deviceorientation',
      (e) => {
        if (e.gamma === null) return
        if (this.neutralGamma === 0) {
          this.neutralGamma = e.gamma
        }
        const relGamma = e.gamma - this.neutralGamma
        if (Math.abs(relGamma) < 3.5) {
          this.gyroTargetWeightShift = 0
        } else {
          const mapped = (relGamma - Math.sign(relGamma) * 3.5) / 26.5
          this.gyroTargetWeightShift = clamp(mapped, -1.0, 1.0)
        }
      },
      true,
    )
  }

  /**
   * Trackpad 2D Gesture Model:
   * Up/Down gesture: Pulling fingers down toward pilot = pull brakes / flare / stall.
   *                  Pushing fingers up = release brakes / engage speed bar dive.
   * Left/Right gesture: Swiping left = lean left & left carve brake.
   *                     Swiping right = lean right & right carve brake.
   */
  private setupTrackpadListeners() {
    window.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        // Stop default browser page scroll, pinch zoom, or swipe navigation
        e.preventDefault()

        this.lastTrackpadTime = performance.now()
        this.trackpadActive = true

        // Trackpad sensitivity: normalized across deltaMode
        const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1
        const deltaX = e.deltaX * scale
        const deltaY = e.deltaY * scale

        // On macOS with Natural Scrolling (default):
        // Swiping fingers DOWN (pulling toggles toward pilot) produces deltaY < 0.
        // Swiping fingers UP (pushing hands forward) produces deltaY > 0.
        // With invertTrackpadY === false: downward pull = positive brake pitch (+).
        const pitchSens = 0.0038
        const rollSens = 0.0038

        const effectiveDeltaY = this.invertTrackpadY ? deltaY : -deltaY
        this.trackpadPitch = clamp(this.trackpadPitch + effectiveDeltaY * pitchSens, -1.0, 1.0)
        this.trackpadRoll = clamp(this.trackpadRoll + deltaX * rollSens, -1.0, 1.0)
      },
      { passive: false },
    )
  }

  /**
   * Mobile Dual-Thumb Touch Model:
   * Left half of screen = Left Brake & Left Weight Shift
   * Right half of screen = Right Brake & Right Weight Shift
   */
  private setupTouchListeners() {
    window.addEventListener(
      'touchstart',
      (e) => {
        const screenWidth = window.innerWidth
        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i]
          // Ignore touches on UI buttons
          if ((touch.target as HTMLElement)?.closest('button, .tool-btn, .start-modal, .quick-toolbar')) {
            continue
          }

          if (touch.clientX < screenWidth * 0.5) {
            if (this.leftTouchId === null) {
              this.leftTouchId = touch.identifier
              this.leftStartX = touch.clientX
              this.leftStartY = touch.clientY
            }
          } else {
            if (this.rightTouchId === null) {
              this.rightTouchId = touch.identifier
              this.rightStartX = touch.clientX
              this.rightStartY = touch.clientY
            }
          }
        }
      },
      { passive: false },
    )

    window.addEventListener(
      'touchmove',
      (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i]
          if (touch.identifier === this.leftTouchId) {
            const dragY = touch.clientY - this.leftStartY
            const dragX = touch.clientX - this.leftStartX

            if (dragY >= 0) {
              this.touchLeftBrake = touchCurve(dragY)
              this.touchLeftSpeedBar = 0
            } else {
              this.touchLeftBrake = 0
              this.touchLeftSpeedBar = clamp(-dragY / TOUCH_MAX_DRAG_PX, 0, 1)
            }
            this.touchWeightShift = clamp(dragX / (TOUCH_MAX_DRAG_PX * 0.8), -1.0, 1.0)
          } else if (touch.identifier === this.rightTouchId) {
            const dragY = touch.clientY - this.rightStartY
            const dragX = touch.clientX - this.rightStartX

            if (dragY >= 0) {
              this.touchRightBrake = touchCurve(dragY)
              this.touchRightSpeedBar = 0
            } else {
              this.touchRightBrake = 0
              this.touchRightSpeedBar = clamp(-dragY / TOUCH_MAX_DRAG_PX, 0, 1)
            }
            this.touchWeightShift = clamp(dragX / (TOUCH_MAX_DRAG_PX * 0.8), -1.0, 1.0)
          }
        }
      },
      { passive: false },
    )

    const endTouch = (touch: Touch) => {
      if (touch.identifier === this.leftTouchId) {
        this.leftTouchId = null
        this.touchLeftBrake = 0
        this.touchLeftSpeedBar = 0
      }
      if (touch.identifier === this.rightTouchId) {
        this.rightTouchId = null
        this.touchRightBrake = 0
        this.touchRightSpeedBar = 0
      }
      if (this.leftTouchId === null && this.rightTouchId === null) {
        this.touchWeightShift = 0
      }
    }

    window.addEventListener('touchend', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) endTouch(e.changedTouches[i])
    })
    window.addEventListener('touchcancel', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) endTouch(e.changedTouches[i])
    })
  }

  /**
   * Mouse Drag Support for Desktop
   */
  private setupMouseListeners() {
    window.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement)?.closest('button, .tool-btn, .start-modal, .quick-toolbar')) {
        return
      }
      this.isMouseDown = true
      this.mouseStartX = e.clientX
      this.mouseStartY = e.clientY
      this.mouseSide = e.clientX < window.innerWidth * 0.5 ? 'left' : 'right'
    })

    window.addEventListener('mousemove', (e) => {
      if (!this.isMouseDown || !this.mouseSide) return
      const dragY = e.clientY - this.mouseStartY
      const dragX = e.clientX - this.mouseStartX
      const brakeVal = touchCurve(dragY)
      if (this.mouseSide === 'left') {
        this.touchLeftBrake = brakeVal
      } else {
        this.touchRightBrake = brakeVal
      }
      this.touchWeightShift = clamp(dragX / (TOUCH_MAX_DRAG_PX * 0.8), -1.0, 1.0)
    })

    const endMouse = () => {
      if (!this.isMouseDown) return
      this.isMouseDown = false
      if (this.mouseSide === 'left') this.touchLeftBrake = 0
      if (this.mouseSide === 'right') this.touchRightBrake = 0
      this.touchWeightShift = 0
      this.mouseSide = null
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
      } else if (e.code === 'KeyR') {
        this.toggleReverseStance()
        this.onToggleReverse?.()
      } else if (e.code === 'KeyI') {
        this.toggleInvertTrackpad()
      } else if (e.code === 'KeyG') {
        this.onToggleWing?.()
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

    this.controls.leftBrake = moveToward(this.controls.leftBrake, leftTrigger, 8.0, dt)
    this.controls.rightBrake = moveToward(this.controls.rightBrake, rightTrigger, 8.0, dt)
    this.controls.weightShift = moveToward(this.controls.weightShift, stick, WEIGHT_SHIFT_RATE * 2, dt)
    this.controls.speedBar = moveToward(this.controls.speedBar, barHeld ? 1 : 0, SPEEDBAR_RATE_IN, dt)
    return true
  }

  public update(dt: number) {
    const gamepadDrove = this.updateGamepad(dt)
    const touchActive = this.leftTouchId !== null || this.rightTouchId !== null || this.isMouseDown

    if (gamepadDrove) {
      // Gamepad is actively controlling
    } else if (touchActive) {
      // Touch/Mouse Dual-Thumb input: direct, instant tracking
      this.controls.leftBrake = moveToward(this.controls.leftBrake, this.touchLeftBrake, FULL_BRAKE_RATE, dt)
      this.controls.rightBrake = moveToward(this.controls.rightBrake, this.touchRightBrake, FULL_BRAKE_RATE, dt)
      const combinedSpeedBar = Math.max(this.touchLeftSpeedBar, this.touchRightSpeedBar)
      this.controls.speedBar = moveToward(this.controls.speedBar, combinedSpeedBar, SPEEDBAR_RATE_IN, dt)
      const targetWeightShift =
        this.touchWeightShift !== 0 || !this.hasGyroPermission
          ? this.touchWeightShift
          : this.gyroTargetWeightShift
      this.controls.weightShift = moveToward(this.controls.weightShift, targetWeightShift, WEIGHT_SHIFT_RATE, dt)
    } else if (this.trackpadActive) {
      // Trackpad 2-Gesture Model (Up/Down + Left/Right)
      const timeSinceWheel = performance.now() - this.lastTrackpadTime

      // Spring-return to neutral trim when user pauses or lifts fingers
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
          // Left steer with inside brake bite
          const steerBite = Math.abs(this.trackpadRoll) * 0.55
          const targetLeft = clamp(baseBrake + steerBite, 0, 1)
          const targetRight = clamp(baseBrake - steerBite * 0.7, 0, 1)
          this.controls.leftBrake = moveToward(this.controls.leftBrake, targetLeft, FULL_BRAKE_RATE, dt)
          this.controls.rightBrake = moveToward(this.controls.rightBrake, targetRight, FULL_BRAKE_RATE, dt)
        } else if (this.trackpadRoll > 0) {
          // Right steer with inside brake bite
          const steerBite = Math.abs(this.trackpadRoll) * 0.55
          const targetRight = clamp(baseBrake + steerBite, 0, 1)
          const targetLeft = clamp(baseBrake - steerBite * 0.7, 0, 1)
          this.controls.rightBrake = moveToward(this.controls.rightBrake, targetRight, FULL_BRAKE_RATE, dt)
          this.controls.leftBrake = moveToward(this.controls.leftBrake, targetLeft, FULL_BRAKE_RATE, dt)
        } else {
          // Symmetrical brake / flare
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
        const leftTarget = this.trackpadRoll < 0 ? Math.abs(this.trackpadRoll) * 0.85 : 0
        const rightTarget = this.trackpadRoll > 0 ? Math.abs(this.trackpadRoll) * 0.85 : 0
        this.controls.leftBrake = moveToward(this.controls.leftBrake, leftTarget, FULL_BRAKE_RATE, dt)
        this.controls.rightBrake = moveToward(this.controls.rightBrake, rightTarget, FULL_BRAKE_RATE, dt)
      }
    } else {
      // Keyboard fallback: Direct, responsive acro authority
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

      if (bothBrakes || flare) {
        this.controls.leftBrake = moveToward(this.controls.leftBrake, 1.0, FULL_BRAKE_RATE, dt)
        this.controls.rightBrake = moveToward(this.controls.rightBrake, 1.0, FULL_BRAKE_RATE, dt)
      } else {
        const targetLeft = leftDeepBrake ? 1.0 : leftSteer ? 0.85 : 0
        const targetRight = rightDeepBrake ? 1.0 : rightSteer ? 0.85 : 0
        this.controls.leftBrake = moveToward(this.controls.leftBrake, targetLeft, targetLeft > 0 ? FULL_BRAKE_RATE : BRAKE_RELEASE_RATE, dt)
        this.controls.rightBrake = moveToward(this.controls.rightBrake, targetRight, targetRight > 0 ? FULL_BRAKE_RATE : BRAKE_RELEASE_RATE, dt)
      }

      let kbWeightShift = 0
      if ((leftSteer || leftDeepBrake) && !(rightSteer || rightDeepBrake)) kbWeightShift = -1.0
      if ((rightSteer || rightDeepBrake) && !(leftSteer || leftDeepBrake)) kbWeightShift = 1.0
      this.controls.weightShift = moveToward(this.controls.weightShift, kbWeightShift, WEIGHT_SHIFT_RATE, dt)

      const barHeld =
        this.keysDown.has('Space') || this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')
      this.controls.speedBar = moveToward(
        this.controls.speedBar,
        barHeld ? 1 : 0,
        barHeld ? SPEEDBAR_RATE_IN : SPEEDBAR_RATE_OUT,
        dt,
      )
    }

    // Dynamic snap rate: d(brake)/dt for flare and violent dynamic maneuvers
    const safeDt = Math.max(0.001, dt)
    this.controls.leftBrakeRate = (this.controls.leftBrake - this.prevLeftBrake) / safeDt
    this.controls.rightBrakeRate = (this.controls.rightBrake - this.prevRightBrake) / safeDt

    this.prevLeftBrake = this.controls.leftBrake
    this.prevRightBrake = this.controls.rightBrake
  }
}
