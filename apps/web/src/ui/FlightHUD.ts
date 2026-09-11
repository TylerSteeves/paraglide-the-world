import type { FlightControls, FlightTelemetry, TrickState } from '../physics/types'

export class FlightHUD {
  private container: HTMLElement
  private altEl!: HTMLElement
  private varioEl!: HTMLElement
  private speedEl!: HTMLElement
  private gForceEl!: HTMLElement
  private tensionEl!: HTMLElement
  private scoreEl!: HTMLElement
  private trickBannerEl!: HTMLElement
  private leftThumbIndicator!: HTMLElement
  private rightThumbIndicator!: HTMLElement
  private startModalEl!: HTMLElement
  private lensBtnLabel!: HTMLElement
  private vantageBtnLabel!: HTMLElement

  private onStartCallback: () => void = () => {}
  private onRecenterCallback: () => void = () => {}
  private onRelaunchCallback: () => void = () => {}
  private onCycleLensCallback: () => void = () => {}
  private onCycleVantageCallback: () => void = () => {}

  constructor(containerId: string) {
    const el = document.getElementById(containerId)
    if (!el) throw new Error(`HUD container #${containerId} not found`)
    this.container = el

    this.render()
  }

  public setOnStart(callback: () => void) {
    this.onStartCallback = callback
  }

  public setOnRecenter(callback: () => void) {
    this.onRecenterCallback = callback
  }

  public setOnRelaunch(callback: () => void) {
    this.onRelaunchCallback = callback
  }

  public setOnCycleLens(callback: () => void) {
    this.onCycleLensCallback = callback
  }

  public setOnCycleVantage(callback: () => void) {
    this.onCycleVantageCallback = callback
  }

  public updateLensLabel(mode: string) {
    if (this.lensBtnLabel) {
      if (mode === 'action-cam') {
        this.lensBtnLabel.innerText = 'LENS: ACTION CAM'
      } else if (mode === 'subtle') {
        this.lensBtnLabel.innerText = 'LENS: SUBTLE'
      } else {
        this.lensBtnLabel.innerText = 'LENS: LINEAR'
      }
    }
  }

  public updateVantageLabel(vantage: string) {
    if (this.vantageBtnLabel) {
      if (vantage === 'helmet-fpv') {
        this.vantageBtnLabel.innerText = 'VIEW: HELMET FPV'
      } else if (vantage === 'wide-chase') {
        this.vantageBtnLabel.innerText = 'VIEW: CHASE CAM'
      } else {
        this.vantageBtnLabel.innerText = 'VIEW: SELFIE POLE'
      }
    }
  }

  private render() {
    this.container.innerHTML = `
      <!-- Build Version Badge -->
      <div style="position: absolute; top: 12px; right: 14px; background: rgba(16, 185, 129, 0.25); border: 1px solid #10b981; color: #a7f3d0; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 8px; letter-spacing: 0.5px; z-index: 25; backdrop-filter: blur(8px); box-shadow: 0 2px 10px rgba(0,0,0,0.3);">
        BUILD v2.6 • REAL SPEEDWING AERO & SINK
      </div>

      <!-- Top Telemetry Bar -->
      <div class="telemetry-bar">
        <div class="telemetry-pill">
          <span class="telemetry-label">ALTITUDE</span>
          <span class="telemetry-value" id="hud-alt">2050m</span>
        </div>

        <div class="telemetry-pill">
          <span class="telemetry-label">VARIO</span>
          <span class="telemetry-value vario-climb" id="hud-vario">+0.0 m/s</span>
        </div>

        <div class="telemetry-pill">
          <span class="telemetry-label">AIRSPEED</span>
          <span class="telemetry-value" id="hud-speed">46 km/h</span>
        </div>

        <div class="telemetry-pill">
          <span class="telemetry-label">G-FORCE</span>
          <span class="telemetry-value" id="hud-gforce">1.0 G</span>
        </div>

        <div class="telemetry-pill" id="hud-tension-pill">
          <span class="telemetry-label">LINE TENSION</span>
          <span class="telemetry-value" id="hud-tension">860 N</span>
        </div>
      </div>

      <!-- Center Trick Banner & Score -->
      <div class="center-banner-area">
        <div class="trick-banner" id="hud-trick-banner">WINGOVER! +500</div>
        <div class="score-counter" id="hud-score">SCORE: 0  •  RINGS: 0/14</div>
      </div>

      <!-- Action Bar (Recenter / Controls) -->
      <div class="action-bar">
        <button class="glass-btn" id="btn-recenter">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10"></circle>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          RECENTER TILT
        </button>
        <button class="glass-btn" id="btn-vantage">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M23 7l-7 5 7 5V7z"></path>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
          <span id="label-vantage">VIEW: SELFIE POLE</span>
        </button>
        <button class="glass-btn" id="btn-lens">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="9"></circle>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          <span id="label-lens">LENS: ACTION CAM</span>
        </button>
        <button class="glass-btn primary-btn" id="btn-relaunch" style="display: none; background: #dc2626;">
          CRASHED! RELAUNCH PEAK
        </button>
      </div>

      <!-- Touch Control Guides -->
      <div class="touch-controls-guide">
        <div class="thumb-handle" id="left-thumb-zone">
          <div class="thumb-indicator" id="left-thumb-indicator"></div>
          <span class="thumb-label">L BRAKE</span>
        </div>

        <div class="thumb-handle" id="right-thumb-zone">
          <div class="thumb-indicator" id="right-thumb-indicator"></div>
          <span class="thumb-label">R BRAKE</span>
        </div>
      </div>

      <!-- Start / Launch Modal -->
      <div class="start-modal" id="start-modal">
        <h1 class="start-title">Paraglide the world 3D</h1>
        <p class="start-subtitle">Whistler Mountain Summer Flight • Action-Cam Fish-Eye View</p>

        <div class="controls-preview" style="display: flex; gap: 14px; max-width: 540px; flex-wrap: wrap; justify-content: center;">
          <div class="control-card" style="width: 140px;">
            <span class="control-card-icon">⌨️</span>
            <span class="control-card-title">BRAKES</span>
            <span class="control-card-desc"><b>F</b> (Left) • <b>J</b> (Right)<br>Hold both to stall</span>
          </div>

          <div class="control-card" style="width: 140px;">
            <span class="control-card-icon">🕹️</span>
            <span class="control-card-title">STEERING</span>
            <span class="control-card-desc"><b>A / D</b> or <b>← / →</b><br>Tap to carve<br>Hold deep to stall & spin</span>
          </div>

          <div class="control-card" style="width: 140px;">
            <span class="control-card-icon">⌨️</span>
            <span class="control-card-title">BRAKES</span>
            <span class="control-card-desc"><b>F</b> (Left) • <b>J</b> (Right)<br>Burying one stalls half wing</span>
          </div>

          <div class="control-card" style="width: 140px;">
            <span class="control-card-icon">⚡</span>
            <span class="control-card-title">STALL / SPEED</span>
            <span class="control-card-desc"><b>S</b> = Full Stall Horseshoe<br><b>Space</b> = Speed Bar Surge</span>
          </div>
        </div>

        <button class="glass-btn primary-btn" id="btn-launch" style="padding: 14px 38px; font-size: 16px;">
          LAUNCH FLIGHT
        </button>
      </div>

      <!-- Desktop Controls Hints Bar -->
      <div class="desktop-hints-bar" style="position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); background: rgba(10, 20, 32, 0.85); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); padding: 7px 16px; border-radius: 12px; font-size: 11px; font-weight: 700; color: #cbd5e1; border: 1px solid rgba(255,255,255,0.15); pointer-events: none; white-space: nowrap; display: flex; gap: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.4); z-index: 10;">
        <span><kbd style="background:rgba(255,255,255,0.22); padding:2px 6px; border-radius:4px; color:#fff; font-family:monospace; font-size:12px;">A</kbd>/<kbd style="background:rgba(255,255,255,0.22); padding:2px 6px; border-radius:4px; color:#fff; font-family:monospace; font-size:12px;">D</kbd> Carve Steer</span>
        <span><kbd style="background:rgba(255,255,255,0.22); padding:2px 6px; border-radius:4px; color:#f59e0b; font-family:monospace; font-size:12px;">F</kbd>/<kbd style="background:rgba(255,255,255,0.22); padding:2px 6px; border-radius:4px; color:#f59e0b; font-family:monospace; font-size:12px;">J</kbd> Deep Asym Stall</span>
        <span><kbd style="background:rgba(255,255,255,0.22); padding:2px 6px; border-radius:4px; color:#ef4444; font-family:monospace; font-size:12px;">S</kbd> Full Stall</span>
        <span><kbd style="background:rgba(255,255,255,0.22); padding:2px 6px; border-radius:4px; color:#38bdf8; font-family:monospace; font-size:12px;">Space</kbd> Speed Bar</span>
        <span><kbd style="background:rgba(255,255,255,0.22); padding:2px 6px; border-radius:4px; color:#10b981; font-family:monospace; font-size:12px;">V</kbd> View</span>
        <span><kbd style="background:rgba(255,255,255,0.22); padding:2px 6px; border-radius:4px; color:#a855f7; font-family:monospace; font-size:12px;">C</kbd> Lens</span>
      </div>
    `

    this.altEl = document.getElementById('hud-alt')!
    this.varioEl = document.getElementById('hud-vario')!
    this.speedEl = document.getElementById('hud-speed')!
    this.gForceEl = document.getElementById('hud-gforce')!
    this.tensionEl = document.getElementById('hud-tension')!
    this.scoreEl = document.getElementById('hud-score')!
    this.trickBannerEl = document.getElementById('hud-trick-banner')!
    this.leftThumbIndicator = document.getElementById('left-thumb-indicator')!
    this.rightThumbIndicator = document.getElementById('right-thumb-indicator')!
    this.startModalEl = document.getElementById('start-modal')!
    this.lensBtnLabel = document.getElementById('label-lens')!
    this.vantageBtnLabel = document.getElementById('label-vantage')!

    const launchBtn = document.getElementById('btn-launch')!
    launchBtn.addEventListener('click', () => {
      this.startModalEl.style.display = 'none'
      this.onStartCallback()
    })

    const recenterBtn = document.getElementById('btn-recenter')!
    recenterBtn.addEventListener('click', () => {
      this.onRecenterCallback()
    })

    const vantageBtn = document.getElementById('btn-vantage')!
    vantageBtn.addEventListener('click', () => {
      this.onCycleVantageCallback()
    })

    const lensBtn = document.getElementById('btn-lens')!
    lensBtn.addEventListener('click', () => {
      this.onCycleLensCallback()
    })

    const relaunchBtn = document.getElementById('btn-relaunch')!
    relaunchBtn.addEventListener('click', () => {
      relaunchBtn.style.display = 'none'
      this.onRelaunchCallback()
    })
  }

  public update(
    telemetry: FlightTelemetry,
    controls: FlightControls,
    trick: TrickState,
    isCrashed: boolean = false,
  ) {
    // Altitude
    this.altEl.innerText = `${Math.round(telemetry.altitudeMeters)}m`

    // Vario
    const vs = telemetry.verticalSpeedMps
    const vsSign = vs >= 0 ? '+' : ''
    this.varioEl.innerText = `${vsSign}${vs.toFixed(1)} m/s`
    if (vs > 0.3) {
      this.varioEl.className = 'telemetry-value vario-climb'
    } else if (vs < -4.0) {
      this.varioEl.className = 'telemetry-value vario-sink'
      this.varioEl.style.color = '#ef4444' // bright emergency red for steep stall sink
    } else if (vs < -1.8) {
      this.varioEl.className = 'telemetry-value vario-sink'
      this.varioEl.style.color = ''
    } else {
      this.varioEl.className = 'telemetry-value'
      this.varioEl.style.color = ''
    }

    // Speed & G-Force
    this.speedEl.innerText = `${Math.round(telemetry.airspeedKmh)} km/h`
    this.gForceEl.innerText = `${telemetry.gForce.toFixed(1)} G`

    // Line Tension & Asymmetric Stall / Slack state
    if (telemetry.isLinesSlack) {
      this.tensionEl.innerText = 'LINES SLACK!'
      this.tensionEl.style.color = '#ef4444'
    } else if (telemetry.asymmetricStallSide === 'left') {
      this.tensionEl.innerText = 'L: SLACK (SPIN)'
      this.tensionEl.style.color = '#ef4444'
    } else if (telemetry.asymmetricStallSide === 'right') {
      this.tensionEl.innerText = 'R: SLACK (SPIN)'
      this.tensionEl.style.color = '#ef4444'
    } else {
      this.tensionEl.innerText = `${Math.round(telemetry.lineTensionNewtons)} N`
      this.tensionEl.style.color = telemetry.lineTensionNewtons > 1800 ? '#f59e0b' : ''
    }

    // Score, Rings & Tumble Streak
    const tumbleText = telemetry.tumbleStreak > 0 ? `  •  TUMBLE: x${telemetry.tumbleStreak} 🔥` : ''
    this.scoreEl.innerText = `SCORE: ${telemetry.score}  •  RINGS: ${telemetry.ringsCollected}/14${tumbleText}`

    // Stall Banner or Trick Banner
    if (telemetry.asymmetricStallSide !== 'none') {
      this.trickBannerEl.innerText = '⚠️ ASYMMETRIC STALL! NEGATIVE SPIN — RELEASE BRAKE'
      this.trickBannerEl.style.background = 'linear-gradient(135deg, #ef4444, #b91c1c)'
      this.trickBannerEl.classList.add('active')
    } else if (trick.announcementText && trick.announcementTimer > 0) {
      this.trickBannerEl.innerText = trick.announcementText
      this.trickBannerEl.style.background = ''
      this.trickBannerEl.classList.add('active')
    } else {
      this.trickBannerEl.style.background = ''
      this.trickBannerEl.classList.remove('active')
    }

    // Touch Indicator Positions (track thumb displacement)
    const maxTravelPx = 70
    this.leftThumbIndicator.style.transform = `translateY(${controls.leftBrake * maxTravelPx}px)`
    this.rightThumbIndicator.style.transform = `translateY(${controls.rightBrake * maxTravelPx}px)`

    // Crash button
    const relaunchBtn = document.getElementById('btn-relaunch')
    if (relaunchBtn) {
      relaunchBtn.style.display = isCrashed ? 'flex' : 'none'
    }
  }
}
