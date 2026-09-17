import type { FlightControls, FlightTelemetry, TrickState } from '../physics/types'

export class FlightHUD {
  private container: HTMLElement
  private speedEl!: HTMLElement
  private altEl!: HTMLElement
  private gEl!: HTMLElement
  private leftToggleEl!: HTMLElement
  private rightToggleEl!: HTMLElement
  private leftLabelEl!: HTMLElement
  private rightLabelEl!: HTMLElement
  private leftForceEl!: HTMLElement
  private rightForceEl!: HTMLElement
  private leftRailLineEl!: HTMLElement
  private rightRailLineEl!: HTMLElement
  private leftTetherEl!: HTMLElement
  private rightTetherEl!: HTMLElement
  private trickBannerEl!: HTMLElement
  private trickTitleEl!: HTMLElement
  private relaunchOverlayEl!: HTMLElement
  private relaunchTitleEl!: HTMLElement
  private relaunchSubEl!: HTMLElement

  private onStartCallback: () => void = () => {}
  private onRelaunchCallback: () => void = () => {}
  private onCycleCameraCallback: () => void = () => {}

  constructor(containerId: string) {
    const el = document.getElementById(containerId)
    if (!el) throw new Error(`HUD container #${containerId} not found`)
    this.container = el

    this.render()
  }

  public setOnStart(callback: () => void) {
    this.onStartCallback = callback
  }

  public setOnRelaunch(callback: () => void) {
    this.onRelaunchCallback = callback
  }

  public setOnCycleCamera(callback: () => void) {
    this.onCycleCameraCallback = callback
  }

  public showRelaunch(title: string = 'PARAGLIDE THE WORLD', subtitle: string = 'Tap screen or press Space to fly') {
    if (this.relaunchTitleEl) this.relaunchTitleEl.innerText = title
    if (this.relaunchSubEl) this.relaunchSubEl.innerText = subtitle
    if (this.relaunchOverlayEl) this.relaunchOverlayEl.style.display = 'flex'
  }

  public hideRelaunch() {
    if (this.relaunchOverlayEl) this.relaunchOverlayEl.style.display = 'none'
  }

  private render() {
    this.container.innerHTML = `
      <!-- Top Minimal Bar -->
      <div class="top-bar">
        <div class="hud-pill">
          <div class="hud-metric">
            <span id="hud-speed">55</span>
            <small>KM/H</small>
          </div>
          <span class="hud-sep">•</span>
          <div class="hud-metric">
            <span id="hud-alt">2050</span>
            <small>M</small>
          </div>
          <div class="hud-g-badge" id="hud-g">1.0G</div>
        </div>

        <button class="hud-icon-btn" id="btn-camera" title="Cycle Camera [C]">
          <span>🎥</span>
        </button>
      </div>

      <!-- Center Acro / Trick Announcement -->
      <div class="acro-banner" id="hud-trick-banner" style="display: none;">
        <div class="acro-title" id="hud-trick-text">INFINITY TUMBLE!</div>
      </div>

      <!-- Left Landscape Hand-Height Rail (Left Brake / Speed Bar) -->
      <div class="hand-rail left-rail" id="left-hand-rail">
        <div class="rail-line" id="left-rail-line"></div>
        <div class="tension-tether" id="left-tension-tether" style="display: none;"></div>
        <div class="rail-notch bar-notch" style="top: 6%;">BAR</div>
        <div class="rail-notch trim-notch" style="top: 22%;">TRIM</div>
        <div class="rail-notch stall-notch" style="top: 88%;">STALL</div>
        <div class="hand-toggle" id="left-hand-toggle" style="top: 22%;">
          <div class="toggle-core"></div>
          <span class="toggle-label" id="left-toggle-label">TRIM</span>
          <span class="toggle-force" id="left-toggle-force"></span>
        </div>
      </div>

      <!-- Right Landscape Hand-Height Rail (Right Brake / Speed Bar) -->
      <div class="hand-rail right-rail" id="right-hand-rail">
        <div class="rail-line" id="right-rail-line"></div>
        <div class="tension-tether" id="right-tension-tether" style="display: none;"></div>
        <div class="rail-notch bar-notch" style="top: 6%;">BAR</div>
        <div class="rail-notch trim-notch" style="top: 22%;">TRIM</div>
        <div class="rail-notch stall-notch" style="top: 88%;">STALL</div>
        <div class="hand-toggle" id="right-hand-toggle" style="top: 22%;">
          <div class="toggle-core"></div>
          <span class="toggle-label" id="right-toggle-label">TRIM</span>
          <span class="toggle-force" id="right-toggle-force"></span>
        </div>
      </div>

      <!-- Portrait Orientation Alert (Encourages Landscape Holding) -->
      <div class="portrait-guard" id="hud-portrait-guard">
        <div class="guard-card">
          <div class="guard-icon">🔄</div>
          <h2>ROTATE IPHONE TO LANDSCAPE</h2>
          <p>Hand-height controls are mapped to your left and right thumbs for full-screen flight.</p>
        </div>
      </div>

      <!-- Minimal Start / Relaunch Overlay -->
      <div class="relaunch-overlay" id="hud-relaunch">
        <div class="relaunch-card">
          <h2 id="relaunch-title">PARAGLIDE THE WORLD</h2>
          <p id="relaunch-sub">Left & Right thumbs control hand height • Tap or press Space to fly</p>
        </div>
      </div>
    `

    this.speedEl = document.getElementById('hud-speed')!
    this.altEl = document.getElementById('hud-alt')!
    this.gEl = document.getElementById('hud-g')!
    this.leftToggleEl = document.getElementById('left-hand-toggle')!
    this.rightToggleEl = document.getElementById('right-hand-toggle')!
    this.leftLabelEl = document.getElementById('left-toggle-label')!
    this.rightLabelEl = document.getElementById('right-toggle-label')!
    this.leftForceEl = document.getElementById('left-toggle-force')!
    this.rightForceEl = document.getElementById('right-toggle-force')!
    this.leftRailLineEl = document.getElementById('left-rail-line')!
    this.rightRailLineEl = document.getElementById('right-rail-line')!
    this.leftTetherEl = document.getElementById('left-tension-tether')!
    this.rightTetherEl = document.getElementById('right-tension-tether')!
    this.trickBannerEl = document.getElementById('hud-trick-banner')!
    this.trickTitleEl = document.getElementById('hud-trick-text')!
    this.relaunchOverlayEl = document.getElementById('hud-relaunch')!
    this.relaunchTitleEl = document.getElementById('relaunch-title')!
    this.relaunchSubEl = document.getElementById('relaunch-sub')!


    const camBtn = document.getElementById('btn-camera')
    if (camBtn) {
      camBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onCycleCameraCallback()
      })
    }

    const triggerStart = (e: Event) => {
      e.stopPropagation()
      this.hideRelaunch()
      this.onStartCallback()
      this.onRelaunchCallback()
    }
    this.relaunchOverlayEl.addEventListener('click', triggerStart)
    this.relaunchOverlayEl.addEventListener('touchstart', triggerStart, { passive: true })
  }

  public update(
    telemetry: FlightTelemetry,

    controls: FlightControls,
    trick?: TrickState,
    leftLagFrac: number = 0,
    rightLagFrac: number = 0,
    leftThumbYFrac: number | null = null,
    rightThumbYFrac: number | null = null,
  ) {
    if (this.speedEl) this.speedEl.innerText = `${Math.round(telemetry.airspeedKmh)}`
    if (this.altEl) this.altEl.innerText = `${Math.round(telemetry.altitudeMeters)}`

    if (this.gEl) {
      const g = telemetry.gForce
      this.gEl.innerText = `${g.toFixed(1)}G`
      if (g > 2.5) {
        this.gEl.classList.add('high-g')
      } else {
        this.gEl.classList.remove('high-g')
      }
    }

    // Dynamic Line Tension on Landscape Rails:
    // Heavy G-loads (>1250 N) cause lines to glow electric cyan with high tension.
    // Slack lines (<250 N or zero-G float) loosen and dim.
    const isHighTension = telemetry.lineTensionNewtons > 1250
    const isSlack = telemetry.isLinesSlack || telemetry.lineTensionNewtons < 250
    const railClass = isHighTension ? 'rail-line high-tension' : isSlack ? 'rail-line slack-tension' : 'rail-line'
    if (this.leftRailLineEl) this.leftRailLineEl.className = railClass
    if (this.rightRailLineEl) this.rightRailLineEl.className = railClass

    const isBuffeting = telemetry.stallWarning > 0.6 && !telemetry.isStalled

    // Dynamic hand height position along landscape rails:
    // Speed Bar (0 to 1): 22% -> 6%
    // Neutral Trim: 22%
    // Brake (0 to 1): 22% -> 88%
    const leftBar = controls.speedBar > 0 && controls.leftBrake === 0 ? controls.speedBar : 0
    const leftPosPct = leftBar > 0 ? 22 - leftBar * 16 : 22 + controls.leftBrake * 66

    const rightBar = controls.speedBar > 0 && controls.rightBrake === 0 ? controls.speedBar : 0
    const rightPosPct = rightBar > 0 ? 22 - rightBar * 16 : 22 + controls.rightBrake * 66

    if (this.leftToggleEl) {
      this.leftToggleEl.style.top = `${leftPosPct}%`
      let baseClass = 'hand-toggle'
      if (leftBar > 0.1) {
        baseClass += ' bar-active'
        this.leftLabelEl.innerText = 'BAR'
      } else if (controls.leftBrake > 0.75 || telemetry.leftStalled) {
        baseClass += ' stall-active'
        this.leftLabelEl.innerText = 'STALL'
      } else if (controls.leftBrake > 0.1) {
        baseClass += ' brake-active'
        this.leftLabelEl.innerText = `${Math.round(controls.leftBrake * 100)}%`
      } else {
        this.leftLabelEl.innerText = 'TRIM'
      }
      if (isBuffeting && controls.leftBrake > 0.35) baseClass += ' buffet-shake'
      this.leftToggleEl.className = baseClass

      if (this.leftForceEl) {
        this.leftForceEl.innerText = telemetry.leftBrakeForceN > 8 ? `${Math.round(telemetry.leftBrakeForceN)}N` : ''
      }
    }

    if (this.rightToggleEl) {
      this.rightToggleEl.style.top = `${rightPosPct}%`
      let baseClass = 'hand-toggle'
      if (rightBar > 0.1) {
        baseClass += ' bar-active'
        this.rightLabelEl.innerText = 'BAR'
      } else if (controls.rightBrake > 0.75 || telemetry.rightStalled) {
        baseClass += ' stall-active'
        this.rightLabelEl.innerText = 'STALL'
      } else if (controls.rightBrake > 0.1) {
        baseClass += ' brake-active'
        this.rightLabelEl.innerText = `${Math.round(controls.rightBrake * 100)}%`
      } else {
        this.rightLabelEl.innerText = 'TRIM'
      }
      if (isBuffeting && controls.rightBrake > 0.35) baseClass += ' buffet-shake'
      this.rightToggleEl.className = baseClass

      if (this.rightForceEl) {
        this.rightForceEl.innerText = telemetry.rightBrakeForceN > 8 ? `${Math.round(telemetry.rightBrakeForceN)}N` : ''
      }
    }

    // Elastic Tension Tethers:
    // Render glowing tension cables stretching between user thumb contact and resisted handle toggle
    if (this.leftTetherEl) {
      if (leftLagFrac > 0.04 && leftThumbYFrac !== null) {
        const thumbPct = leftThumbYFrac * 100
        const top = Math.min(leftPosPct, thumbPct)
        const height = Math.abs(leftPosPct - thumbPct)
        this.leftTetherEl.style.display = 'block'
        this.leftTetherEl.style.top = `${top}%`
        this.leftTetherEl.style.height = `${Math.max(4, height)}%`
      } else {
        this.leftTetherEl.style.display = 'none'
      }
    }

    if (this.rightTetherEl) {
      if (rightLagFrac > 0.04 && rightThumbYFrac !== null) {
        const thumbPct = rightThumbYFrac * 100
        const top = Math.min(rightPosPct, thumbPct)
        const height = Math.abs(rightPosPct - thumbPct)
        this.rightTetherEl.style.display = 'block'
        this.rightTetherEl.style.top = `${top}%`
        this.rightTetherEl.style.height = `${Math.max(4, height)}%`
      } else {
        this.rightTetherEl.style.display = 'none'
      }
    }

    // Acro trick banner
    if (trick && trick.announcementText && trick.announcementTimer > 0) {
      this.trickBannerEl.style.display = 'flex'
      if (this.trickTitleEl) this.trickTitleEl.innerText = trick.announcementText
    } else if (telemetry.tumbleStreak > 0) {
      this.trickBannerEl.style.display = 'flex'
      if (this.trickTitleEl) this.trickTitleEl.innerText = `TUMBLE x${telemetry.tumbleStreak}!`
    } else {
      this.trickBannerEl.style.display = 'none'
    }
  }
}

