import type { FlightControls } from '../physics/types'

export class MobileInputManager {
  public controls: FlightControls
  private neutralGamma: number = 0
  private hasGyroPermission: boolean = false
  private prevLeftBrake: number = 0
  private prevRightBrake: number = 0

  // Touch tracking
  private leftTouchId: number | null = null
  private rightTouchId: number | null = null
  private leftStartY: number = 0
  private rightStartY: number = 0

  // Keyboard tracking
  private keysDown: Set<string> = new Set()

  constructor() {
    this.controls = {
      leftBrake: 0,
      rightBrake: 0,
      leftBrakeRate: 0,
      rightBrakeRate: 0,
      weightShift: 0,
      speedBar: 0,
    }

    this.setupTouchListeners()
    this.setupKeyboardListeners()
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
    // Current phone angle becomes 0 weight shift
    // Handled in deviceorientation callback
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

        // Relative roll angle
        const relGamma = e.gamma - this.neutralGamma

        // Deadzone ±3.5 degrees
        if (Math.abs(relGamma) < 3.5) {
          this.controls.weightShift = 0
        } else {
          // Map ±30 degrees tilt to -1.0 .. +1.0 weight shift
          const mapped = (relGamma - Math.sign(relGamma) * 3.5) / 26.5
          this.controls.weightShift = Math.max(-1.0, Math.min(1.0, mapped))
        }
      },
      true,
    )
  }

  private setupTouchListeners() {
    const maxDragPixels = 160 // 160px drag = 100% full brake pull

    window.addEventListener(
      'touchstart',
      (e) => {
        const screenWidth = window.innerWidth

        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i]

          if (touch.clientX < screenWidth * 0.5) {
            // Left Half -> Left Brake
            if (this.leftTouchId === null) {
              this.leftTouchId = touch.identifier
              this.leftStartY = touch.clientY
            }
          } else {
            // Right Half -> Right Brake
            if (this.rightTouchId === null) {
              this.rightTouchId = touch.identifier
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
            // Pulling DOWN increases brake travel (0 to 1)
            this.controls.leftBrake = Math.max(0, Math.min(1, dragY / maxDragPixels))
          } else if (touch.identifier === this.rightTouchId) {
            const dragY = touch.clientY - this.rightStartY
            this.controls.rightBrake = Math.max(0, Math.min(1, dragY / maxDragPixels))
          }
        }
      },
      { passive: false },
    )

    const endTouch = (touch: Touch) => {
      if (touch.identifier === this.leftTouchId) {
        this.leftTouchId = null
        this.controls.leftBrake = 0 // spring return to trim
      } else if (touch.identifier === this.rightTouchId) {
        this.rightTouchId = null
        this.controls.rightBrake = 0
      }
    }

    window.addEventListener('touchend', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        endTouch(e.changedTouches[i])
      }
    })

    window.addEventListener('touchcancel', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        endTouch(e.changedTouches[i])
      }
    })

    // Mouse drag support for desktop
    let isMouseDown = false
    let mouseSide: 'left' | 'right' | null = null
    let mouseStartY = 0

    window.addEventListener('mousedown', (e) => {
      // Ignore if clicking UI buttons
      if ((e.target as HTMLElement)?.closest('button, .glass-btn, .start-modal')) return
      isMouseDown = true
      mouseStartY = e.clientY
      mouseSide = e.clientX < window.innerWidth * 0.5 ? 'left' : 'right'
    })

    window.addEventListener('mousemove', (e) => {
      if (!isMouseDown || !mouseSide) return
      const dragY = e.clientY - mouseStartY
      const brakeVal = Math.max(0, Math.min(1, dragY / maxDragPixels))
      if (mouseSide === 'left') {
        this.controls.leftBrake = brakeVal
      } else {
        this.controls.rightBrake = brakeVal
      }
    })

    const endMouse = () => {
      if (!isMouseDown) return
      isMouseDown = false
      if (mouseSide === 'left') this.controls.leftBrake = 0
      if (mouseSide === 'right') this.controls.rightBrake = 0
      mouseSide = null
    }

    window.addEventListener('mouseup', endMouse)
    window.addEventListener('mouseleave', endMouse)
  }

  // Hold timers for progressive brake pull on steering
  private leftTurnHoldTime: number = 0
  private rightTurnHoldTime: number = 0

  public onCycleLens: (() => void) | null = null
  public onCycleVantage: (() => void) | null = null

  private setupKeyboardListeners() {
    window.addEventListener('keydown', (e) => {
      this.keysDown.add(e.code)
      if (e.code === 'KeyC') {
        this.onCycleLens?.()
      } else if (e.code === 'KeyV') {
        this.onCycleVantage?.()
      }
    })

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code)
    })
  }

  public update(dt: number) {
    // Process keyboard inputs if touch/mouse drag isn't overriding
    if (this.leftTouchId === null && this.rightTouchId === null) {
      // Both Brakes (Full Stall): KeyS or ArrowDown
      const bothBrakes = this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')

      // Dedicated Deep Brake / Stall keys: KeyF (left), KeyJ (right)
      const leftDeepBrake = this.keysDown.has('KeyF')
      const rightDeepBrake = this.keysDown.has('KeyJ')

      // Left Turn / Left Carve Steer: KeyA, ArrowLeft, KeyQ
      const leftSteer =
        this.keysDown.has('KeyA') ||
        this.keysDown.has('ArrowLeft') ||
        this.keysDown.has('KeyQ')

      // Right Turn / Right Carve Steer: KeyD, ArrowRight, KeyE, Semicolon
      const rightSteer =
        this.keysDown.has('KeyD') ||
        this.keysDown.has('ArrowRight') ||
        this.keysDown.has('KeyE') ||
        this.keysDown.has('Semicolon')

      if (leftSteer || leftDeepBrake) {
        this.leftTurnHoldTime += dt
      } else {
        this.leftTurnHoldTime = Math.max(0, this.leftTurnHoldTime - dt * 3.5)
      }

      if (rightSteer || rightDeepBrake) {
        this.rightTurnHoldTime += dt
      } else {
        this.rightTurnHoldTime = Math.max(0, this.rightTurnHoldTime - dt * 3.5)
      }

      // Compute Left Brake Target:
      let targetLeftBrake = 0
      if (bothBrakes) {
        targetLeftBrake = 0.95 // Full Stall horseshoe
      } else if (leftDeepBrake || (leftSteer && this.keysDown.has('KeyS'))) {
        targetLeftBrake = 0.88 // Bury left brake -> Asymmetric Stall & Negative Spin Plummet!
      } else if (leftSteer) {
        // Normal steering: smooth, responsive carving bank (up to 0.38 brake)
        targetLeftBrake = Math.min(0.38, 0.20 + this.leftTurnHoldTime * 0.16)
      }

      // Compute Right Brake Target:
      let targetRightBrake = 0
      if (bothBrakes) {
        targetRightBrake = 0.95 // Full Stall horseshoe
      } else if (rightDeepBrake || (rightSteer && this.keysDown.has('KeyS'))) {
        targetRightBrake = 0.88 // Bury right brake -> Asymmetric Stall & Negative Spin Plummet!
      } else if (rightSteer) {
        // Normal steering: smooth, responsive carving bank (up to 0.38 brake)
        targetRightBrake = Math.min(0.38, 0.20 + this.rightTurnHoldTime * 0.16)
      }

      const brakeRate = Math.min(1, 16 * dt)
      this.controls.leftBrake += (targetLeftBrake - this.controls.leftBrake) * brakeRate
      this.controls.rightBrake += (targetRightBrake - this.controls.rightBrake) * brakeRate

      // Weight shift naturally assists the turn
      let kbWeightShift = 0
      if ((leftSteer || leftDeepBrake) && !(rightSteer || rightDeepBrake)) kbWeightShift -= 1.0
      if ((rightSteer || rightDeepBrake) && !(leftSteer || leftDeepBrake)) kbWeightShift += 1.0

      if (kbWeightShift !== 0 || !this.hasGyroPermission) {
        this.controls.weightShift = kbWeightShift
      }

      // Speed bar: Space, KeyW, or ArrowUp
      this.controls.speedBar =
        this.keysDown.has('Space') || this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')
          ? 1.0
          : 0
    }

    // Calculate pull velocity d(brake)/dt for dynamic snaps
    const safeDt = Math.max(0.001, dt)
    this.controls.leftBrakeRate = (this.controls.leftBrake - this.prevLeftBrake) / safeDt
    this.controls.rightBrakeRate = (this.controls.rightBrake - this.prevRightBrake) / safeDt

    this.prevLeftBrake = this.controls.leftBrake
    this.prevRightBrake = this.controls.rightBrake
  }
}
