export type HapticType =
  | 'tick'
  | 'notch'
  | 'light'
  | 'medium'
  | 'heavy'
  | 'rigid'
  | 'snap'
  | 'soft'
  | 'stallRelease'
  | 'thermalKick'

export class HapticManager {
  private hasNativeBridge: boolean = false
  private prevLeftForce: number = 0
  private prevRightForce: number = 0
  private leftNotchAccumulator: number = 0
  private rightNotchAccumulator: number = 0
  private lastHapticTime: number = 0
  private wasStalled: boolean = false
  private prevVerticalWind: number = 0

  constructor() {
    this.checkBridge()
  }

  private checkBridge(): boolean {
    if (typeof window !== 'undefined') {
      const w = window as unknown as {
        webkit?: {
          messageHandlers?: {
            haptic?: {
              postMessage: (msg: unknown) => void
            }
          }
        }
      }
      this.hasNativeBridge = Boolean(w.webkit?.messageHandlers?.haptic?.postMessage)
    }
    return this.hasNativeBridge
  }

  public trigger(type: HapticType, intensity?: number) {
    const now = performance.now()
    // Debounce high frequency triggers to 25ms
    if (now - this.lastHapticTime < 25 && type === 'tick') return
    this.lastHapticTime = now

    // 1. Native iOS Taptic Bridge (via WKScriptMessageHandler)
    if (typeof window !== 'undefined') {
      const w = window as unknown as {
        webkit?: {
          messageHandlers?: {
            haptic?: {
              postMessage: (msg: unknown) => void
            }
          }
        }
      }
      if (w.webkit?.messageHandlers?.haptic?.postMessage) {
        try {
          if (intensity !== undefined) {
            w.webkit.messageHandlers.haptic.postMessage({ type, intensity })
          } else {
            w.webkit.messageHandlers.haptic.postMessage(type)
          }
          return
        } catch {
          // Ignore
        }
      }
    }

    // 2. Web Vibration API Fallback (Supported in Android Chrome and some web contexts)
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        switch (type) {
          case 'tick':
          case 'notch':
            navigator.vibrate(8)
            break
          case 'light':
            navigator.vibrate(14)
            break
          case 'medium':
            navigator.vibrate(22)
            break
          case 'rigid':
          case 'snap':
          case 'heavy':
            navigator.vibrate([30, 15, 20])
            break
          case 'soft':
          case 'stallRelease':
            navigator.vibrate([10, 40, 10])
            break
        }
      } catch {
        // Ignore vibration exceptions
      }
    }
  }

  /**
   * Evaluates instantaneous aerodynamic brake force and triggers physical resistance ticks.
   * As the pilot pulls down against increasing air resistance, each force quantum triggers
   * a discrete mechanical Taptic tick in their thumbs.
   */
  public update(
    leftForceN: number,
    rightForceN: number,
    isStalled: boolean,
    stallWarning: number,
    gForce: number,
    isFootDragging: boolean,
    dt: number,
    verticalWind: number = 0,
  ) {
    // 1. Stall Breakaway Event: Instantaneous loss of control line pressure!
    if (isStalled && !this.wasStalled) {
      this.trigger('stallRelease')
      this.wasStalled = true
      this.leftNotchAccumulator = 0
      this.rightNotchAccumulator = 0
      return
    } else if (!isStalled && this.wasStalled) {
      // Re-inflation / flow re-attachment snap
      this.trigger('rigid')
      this.wasStalled = false
    }

    if (isStalled) return

    // 2. Pre-stall buffet flutter: as stallWarning rises, generate nervous micro-ticks
    if (stallWarning > 0.65) {
      const flutterInterval = Math.max(35, 120 - stallWarning * 80)
      if (performance.now() - this.lastHapticTime > flutterInterval) {
        this.trigger('tick')
      }
    }

    // 3. Progressive Aerodynamic Resistance Notching
    // High dynamic pressure = lines are stiff, each pull step yields a distinct notch
    const forceDeltaL = Math.abs(leftForceN - this.prevLeftForce)
    const forceDeltaR = Math.abs(rightForceN - this.prevRightForce)

    this.leftNotchAccumulator += forceDeltaL
    this.rightNotchAccumulator += forceDeltaR

    const NOTCH_THRESHOLD_NEWTONS = 18.0

    if (this.leftNotchAccumulator >= NOTCH_THRESHOLD_NEWTONS) {
      const intensity = Math.min(1.0, 0.3 + (leftForceN / 120.0) * 0.7)
      this.trigger('tick', intensity)
      this.leftNotchAccumulator %= NOTCH_THRESHOLD_NEWTONS
    }

    if (this.rightNotchAccumulator >= NOTCH_THRESHOLD_NEWTONS) {
      const intensity = Math.min(1.0, 0.3 + (rightForceN / 120.0) * 0.7)
      this.trigger('tick', intensity)
      this.rightNotchAccumulator %= NOTCH_THRESHOLD_NEWTONS
    }

    // 4. Violent Dynamic Brake Snap Bite
    const snapL = (leftForceN - this.prevLeftForce) / Math.max(0.001, dt)
    const snapR = (rightForceN - this.prevRightForce) / Math.max(0.001, dt)
    if (snapL > 450 || snapR > 450) {
      this.trigger('snap')
    }

    // 5. Foot Skimming Sand Vibration
    if (isFootDragging) {
      if (performance.now() - this.lastHapticTime > 65) {
        this.trigger('light', 0.4)
      }
    }

    // 6. High-G Centrifugal Turn Strain
    if (gForce > 2.5) {
      if (performance.now() - this.lastHapticTime > 90) {
        this.trigger('medium', Math.min(1.0, (gForce - 2.0) * 0.5))
      }
    }

    // 7. Thermal Entry Kick: Sudden thermal core entry creates a solid punch into the harness lines
    const updraftDelta = verticalWind - this.prevVerticalWind
    if (updraftDelta > 1.8 && verticalWind > 2.0) {
      this.trigger('thermalKick', Math.min(1.0, 0.6 + updraftDelta * 0.15))
    }

    this.prevLeftForce = leftForceN
    this.prevRightForce = rightForceN
    this.prevVerticalWind = verticalWind
  }
}
