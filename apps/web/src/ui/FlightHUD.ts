import type { FlightControls, FlightTelemetry, TrickState } from '../physics/types'

export class FlightHUD {
  private container: HTMLElement
  private speedEl!: HTMLElement
  private altEl!: HTMLElement
  private gEl!: HTMLElement
  private leftRingEl!: HTMLElement
  private rightRingEl!: HTMLElement
  private leftFillEl!: HTMLElement
  private rightFillEl!: HTMLElement
  private leftLabelEl!: HTMLElement
  private rightLabelEl!: HTMLElement
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

  public showRelaunch(title: string = 'PARAGLIDE THE WORLD', subtitle: string = 'Tap or press Space to fly') {
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

      <!-- Center Trick / Loop Announcement -->
      <div class="acro-banner" id="hud-trick-banner" style="display: none;">
        <div class="acro-title" id="hud-trick-text">INFINITY TUMBLE!</div>
      </div>

      <!-- Ergonomic Mobile Dual-Thumb Touch Rings -->
      <div class="thumb-rings">
        <div class="thumb-ring-container">
          <div class="thumb-ring" id="left-thumb-ring">
            <div class="thumb-ring-fill" id="left-ring-fill"></div>
            <span class="thumb-ring-label" id="left-ring-label">L</span>
          </div>
          <span class="thumb-hint">BRAKE</span>
        </div>

        <div class="thumb-ring-container">
          <div class="thumb-ring" id="right-thumb-ring">
            <div class="thumb-ring-fill" id="right-ring-fill"></div>
            <span class="thumb-ring-label" id="right-ring-label">R</span>
          </div>
          <span class="thumb-hint">BRAKE</span>
        </div>
      </div>

      <!-- Minimal Start / Relaunch Overlay -->
      <div class="relaunch-overlay" id="hud-relaunch">
        <div class="relaunch-card">
          <h2 id="relaunch-title">PARAGLIDE THE WORLD</h2>
          <p id="relaunch-sub">Drag thumbs down to brake • Drag up for speed bar</p>
        </div>
      </div>
    `

    this.speedEl = document.getElementById('hud-speed')!
    this.altEl = document.getElementById('hud-alt')!
    this.gEl = document.getElementById('hud-g')!
    this.leftRingEl = document.getElementById('left-thumb-ring')!
    this.rightRingEl = document.getElementById('right-thumb-ring')!
    this.leftFillEl = document.getElementById('left-ring-fill')!
    this.rightFillEl = document.getElementById('right-ring-fill')!
    this.leftLabelEl = document.getElementById('left-ring-label')!
    this.rightLabelEl = document.getElementById('right-ring-label')!
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

    this.relaunchOverlayEl.addEventListener('click', () => {
      this.hideRelaunch()
      this.onStartCallback()
      this.onRelaunchCallback()
    })
  }

  public update(telemetry: FlightTelemetry, controls: FlightControls, trick?: TrickState) {
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

    // Update thumb rings: brake depth
    const leftPct = Math.round(controls.leftBrake * 100)
    const rightPct = Math.round(controls.rightBrake * 100)

    if (this.leftFillEl) {
      this.leftFillEl.style.height = `${leftPct}%`
    }
    if (this.rightFillEl) {
      this.rightFillEl.style.height = `${rightPct}%`
    }

    if (this.leftRingEl) {
      if (leftPct > 10) {
        this.leftRingEl.classList.add('active')
      } else {
        this.leftRingEl.classList.remove('active')
      }
    }
    if (this.rightRingEl) {
      if (rightPct > 10) {
        this.rightRingEl.classList.add('active')
      } else {
        this.rightRingEl.classList.remove('active')
      }
    }

    if (this.leftLabelEl) {
      this.leftLabelEl.innerText = leftPct > 15 ? `${leftPct}%` : 'L'
    }
    if (this.rightLabelEl) {
      this.rightLabelEl.innerText = rightPct > 15 ? `${rightPct}%` : 'R'
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
