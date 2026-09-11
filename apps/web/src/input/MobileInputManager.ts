import type { FlightControls } from '../physics/types'

export class MobileInputManager {
  public controls: FlightControls
  private neutralGamma: number = 0
  private hasGyroPermission: boolean = false
  private prevLeftBrake: number = 0
  private prevRightBrake: number = 0
  private leftTurnHoldTime: number = 0
  private rightTurnHoldTime: number = 0

  // Touch tracking
  private leftTouchId: number | null = null
  private rightTouchId: number | null = null
  private leftStartY: number = 0
  private rightStartY: number = 0

  // Keyboard tracking
  private keysDown: Set<string> = new Set()

  public onCycleLens: (() => void) | null = null
  public onCycleVantage: (() => void) | null = null
  public onToggleReverse: (() => void) | null = null
  public onSpawnAlpine: (() => void) | null = null
  public onSpawnDunes: (() => void) | null = null

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

    this.setupTouchListeners()
    this.setupKeyboardListeners()
  }

  public toggleReverseStance() {
    this.controls.reverseStance = !this.controls.reverseStance
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
          this.controls.weightShift = 0
        } else {
          const mapped = (relGamma - Math.sign(relGamma) * 3.5) / 26.5
          this.controls.weightShift = Math.max(-1.0, Math.min(1.0, mapped))
        }
      },
      true,
    )
  }

  private setupTouchListeners() {
    const maxDragPixels = 160

    window.addEventListener(
      'touchstart',
      (e) => {
        const screenWidth = window.innerWidth
        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i]
          if (touch.clientX < screenWidth * 0.5 && this.leftTouchId === null) {
            this.leftTouchId = touch.identifier
            this.leftStartY = touch.clientY
          } else if (touch.clientX >= screenWidth * 0.5 && this.rightTouchId === null) {
            this.rightTouchId = touch.identifier
            this.rightStartY = touch.clientY
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
            const drag = Math.max(0, touch.clientY - this.leftStartY)
            this.controls.leftBrake = Math.min(1.0, drag / maxDragPixels)
          } else if (touch.identifier === this.rightTouchId) {
            const drag = Math.max(0, touch.clientY - this.rightStartY)
            this.controls.rightBrake = Math.min(1.0, drag / maxDragPixels)
          }
        }
      },
      { passive: false },
    )

    const endTouch = (touch: Touch) => {
      if (touch.identifier === this.leftTouchId) {
        this.leftTouchId = null
        this.controls.leftBrake = 0
      }
      if (touch.identifier === this.rightTouchId) {
        this.rightTouchId = null
        this.controls.rightBrake = 0
      }
    }

    window.addEventListener('touchend', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) endTouch(e.changedTouches[i])
    })
    window.addEventListener('touchcancel', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) endTouch(e.changedTouches[i])
    })
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
      } else if (e.code === 'Digit1') {
        this.onSpawnAlpine?.()
      } else if (e.code === 'Digit2') {
        this.onSpawnDunes?.()
      }
    })

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code)
    })
  }

  public update(dt: number) {
    if (this.leftTouchId === null && this.rightTouchId === null) {
      const bothBrakes = this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')
      const leftDeepBrake = this.keysDown.has('KeyF')
      const rightDeepBrake = this.keysDown.has('KeyJ')

      const leftSteer =
        this.keysDown.has('KeyA') ||
        this.keysDown.has('ArrowLeft') ||
        this.keysDown.has('KeyQ')

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

      let targetLeftBrake = 0
      if (bothBrakes) {
        targetLeftBrake = 0.95
      } else if (leftDeepBrake || (leftSteer && this.keysDown.has('KeyS'))) {
        targetLeftBrake = 0.92
      } else if (leftSteer) {
        targetLeftBrake = Math.min(0.42, 0.22 + this.leftTurnHoldTime * 0.18)
      }

      let targetRightBrake = 0
      if (bothBrakes) {
        targetRightBrake = 0.95
      } else if (rightDeepBrake || (rightSteer && this.keysDown.has('KeyS'))) {
        targetRightBrake = 0.92
      } else if (rightSteer) {
        targetRightBrake = Math.min(0.42, 0.22 + this.rightTurnHoldTime * 0.18)
      }

      const brakeRate = Math.min(1, 16 * dt)
      this.controls.leftBrake += (targetLeftBrake - this.controls.leftBrake) * brakeRate
      this.controls.rightBrake += (targetRightBrake - this.controls.rightBrake) * brakeRate

      let kbWeightShift = 0
      if ((leftSteer || leftDeepBrake) && !(rightSteer || rightDeepBrake)) kbWeightShift -= 1.0
      if ((rightSteer || rightDeepBrake) && !(leftSteer || leftDeepBrake)) kbWeightShift += 1.0

      if (kbWeightShift !== 0 || !this.hasGyroPermission) {
        this.controls.weightShift = kbWeightShift
      }

      // Speed bar / Steep Dive: Space, KeyW, ShiftLeft, or ArrowUp
      this.controls.speedBar =
        this.keysDown.has('Space') ||
        this.keysDown.has('KeyW') ||
        this.keysDown.has('ShiftLeft') ||
        this.keysDown.has('ArrowUp')
          ? 1.0
          : 0
    }

    const safeDt = Math.max(0.001, dt)
    this.controls.leftBrakeRate = (this.controls.leftBrake - this.prevLeftBrake) / safeDt
    this.controls.rightBrakeRate = (this.controls.rightBrake - this.prevRightBrake) / safeDt

    this.prevLeftBrake = this.controls.leftBrake
    this.prevRightBrake = this.controls.rightBrake
  }
}
