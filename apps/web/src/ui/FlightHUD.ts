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
  private stanceEl!: HTMLElement
  private leftThumbIndicator!: HTMLElement
  private rightThumbIndicator!: HTMLElement
  private startModalEl!: HTMLElement
  private lensBtnLabel!: HTMLElement
  private vantageBtnLabel!: HTMLElement

  private onStartCallback: () => void = () => {}
  private onRecenterCallback: () => void = () => {}
  private onRelaunchCallback: () => void = () => {}
  private onSpawnAlpineCallback: () => void = () => {}
  private onSpawnDunesCallback: () => void = () => {}
  private onCycleLensCallback: () => void = () => {}
  private onCycleVantageCallback: () => void = () => {}
  private onToggleReverseCallback: () => void = () => {}

  constructor(containerId: string) {
    const el = document.getElementById(containerId)
    if (!el) throw new Error(`HUD container #${containerId} not found`)
    this.container = el

    this.render()
  }

  public setOnStart(callback: () => void) {
    this.onStartCallback = callback
  }

  public setOnSpawnAlpine(callback: () => void) {
    this.onSpawnAlpineCallback = callback
  }

  public setOnSpawnDunes(callback: () => void) {
    this.onSpawnDunesCallback = callback
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

  public setOnToggleReverse(callback: () => void) {
    this.onToggleReverseCallback = callback
  }

  public updateLensLabel(mode: string) {
    if (this.lensBtnLabel) {
      if (mode === 'action-cam') {
        this.lensBtnLabel.innerText = 'LENS: [L] ACTION CAM'
      } else if (mode === 'subtle') {
        this.lensBtnLabel.innerText = 'LENS: [L] SUBTLE WIDE'
      } else {
        this.lensBtnLabel.innerText = 'LENS: [L] LINEAR'
      }
    }
  }

  public updateVantageLabel(vantage: string) {
    if (this.vantageBtnLabel) {
      if (vantage === 'pilot-fpv') {
        this.vantageBtnLabel.innerText = 'VIEW: [C] PILOT FPV'
      } else if (vantage === 'shoulder-chase') {
        this.vantageBtnLabel.innerText = 'VIEW: [C] SHOULDER CHASE'
      } else if (vantage === 'front-selfie') {
        this.vantageBtnLabel.innerText = 'VIEW: [C] SELFIE 360'
      } else {
        this.vantageBtnLabel.innerText = 'VIEW: [C] WIDE CHASE'
      }
    }
  }

  private render() {
    this.container.innerHTML = `
      <!-- Build Version Badge -->
      <div style="position: absolute; top: 12px; right: 14px; background: rgba(14, 165, 233, 0.25); border: 1px solid #0ea5e9; color: #7dd3fc; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 8px; letter-spacing: 0.5px; z-index: 25; backdrop-filter: blur(8px); box-shadow: 0 2px 10px rgba(0,0,0,0.3);">
        BUILD v3.0 • FIRST-PRINCIPLES ACRO & SPEEDWING ENGINE
      </div>

      <!-- Top Telemetry Bar -->
      <div class="telemetry-bar">
        <div class="telemetry-pill">
          <span class="telemetry-label">ALTITUDE</span>
          <span class="telemetry-value" id="hud-alt">2050m</span>
        </div>

        <div class="telemetry-pill">
          <span class="telemetry-label">AIRSPEED</span>
          <span class="telemetry-value" id="hud-speed">54 km/h</span>
        </div>

        <div class="telemetry-pill">
          <span class="telemetry-label">VERTICAL</span>
          <span class="telemetry-value" id="hud-vario">-2.2 m/s</span>
        </div>

        <div class="telemetry-pill">
          <span class="telemetry-label">G-FORCE</span>
          <span class="telemetry-value" id="hud-gforce">1.0G</span>
        </div>

        <div class="telemetry-pill">
          <span class="telemetry-label">LINE TENSION</span>
          <span class="telemetry-value" id="hud-tension">860 N</span>
        </div>

        <div class="telemetry-pill highlight">
          <span class="telemetry-label">SCORE</span>
          <span class="telemetry-value" id="hud-score">0</span>
        </div>
      </div>

      <!-- Mode & Stance Indicator -->
      <div style="position: absolute; top: 72px; left: 24px; z-index: 20; display: flex; gap: 8px;">
        <button id="hud-stance-btn" style="background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 6px 14px; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer; backdrop-filter: blur(6px);">
          STANCE: FORWARD FLIGHT [R]
        </button>
      </div>

      <!-- Center Trick Announcement Banner -->
      <div class="trick-banner" id="hud-trick-banner" style="display: none;">
        <div class="trick-title" id="hud-trick-text">INFINITE TUMBLE x1!</div>
        <div class="trick-subtitle" id="hud-trick-sub">+3000 PTS</div>
      </div>

      <!-- Touch Brake Sliders for Mobile / Visual Indicators -->
      <div class="touch-controls">
        <div class="touch-zone left-zone">
          <div class="brake-track">
            <div class="brake-fill" id="left-brake-fill"></div>
            <div class="brake-thumb" id="left-brake-thumb"></div>
          </div>
          <span class="zone-label">LEFT BRAKE [A]</span>
        </div>

        <div class="touch-zone right-zone">
          <div class="brake-track">
            <div class="brake-fill" id="right-brake-fill"></div>
            <div class="brake-thumb" id="right-brake-thumb"></div>
          </div>
          <span class="zone-label">RIGHT BRAKE [D]</span>
        </div>
      </div>

      <!-- Bottom Quick Actions Toolbar -->
      <div class="quick-toolbar">
        <button class="tool-btn" id="btn-cycle-vantage">
          <span id="vantage-btn-label">VIEW: [C] PILOT FPV</span>
        </button>
        <button class="tool-btn" id="btn-cycle-lens">
          <span id="lens-btn-label">LENS: [L] ACTION CAM</span>
        </button>
        <button class="tool-btn" id="btn-spawn-alpine" style="border-color: #38bdf8;">
          <span>🏔️ ALPINE [1]</span>
        </button>
        <button class="tool-btn" id="btn-spawn-dunes" style="border-color: #f59e0b;">
          <span>🏖️ DUNES [2]</span>
        </button>
        <button class="tool-btn" id="btn-recenter">
          <span>RECENTER</span>
        </button>
      </div>

      <!-- Launch Modal -->
      <div class="start-modal" id="hud-start-modal">
        <div class="modal-card">
          <h1>PARAGLIDE THE WORLD</h1>
          <p class="subtitle">Realistic First-Principles Speedwing & Acro Physics</p>

          <div class="controls-guide">
            <div class="guide-item">
              <span class="key-badge">A</span> / <span class="key-badge">D</span>
              <span class="guide-desc">Carve Bank Turns & Deep Wingovers</span>
            </div>
            <div class="guide-item">
              <span class="key-badge">W</span> / <span class="key-badge">SHIFT</span>
              <span class="guide-desc">Speedbar / Steep Alpine Dive (Accelerate to 115-130 km/h)</span>
            </div>
            <div class="guide-item">
              <span class="key-badge">S</span> (at high speed)
              <span class="guide-desc">Infinite Tumble / Somersault Loop over the canopy!</span>
            </div>
            <div class="guide-item">
              <span class="key-badge">R</span>
              <span class="guide-desc">180° Reverse Stance (Dune Kiting & Ground Handling)</span>
            </div>
            <div class="guide-item">
              <span class="key-badge">C</span> / <span class="key-badge">L</span>
              <span class="guide-desc">Cycle 4 Camera Angles / GoPro Fisheye Optics</span>
            </div>
          </div>

          <div style="display: flex; gap: 12px; margin-top: 14px; flex-wrap: wrap;">
            <button class="launch-btn" id="hud-launch-alpine-btn" style="flex: 1; min-width: 220px;">
              🏔️ ALPINE PEAK (2,050m) [1]
            </button>
            <button class="launch-btn" id="hud-launch-dunes-btn" style="flex: 1; min-width: 220px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);">
              🏖️ DUNE DU PILAT (208m) [2]
            </button>
          </div>
        </div>
      </div>
    `

    this.altEl = document.getElementById('hud-alt')!
    this.varioEl = document.getElementById('hud-vario')!
    this.speedEl = document.getElementById('hud-speed')!
    this.gForceEl = document.getElementById('hud-gforce')!
    this.tensionEl = document.getElementById('hud-tension')!
    this.scoreEl = document.getElementById('hud-score')!
    this.trickBannerEl = document.getElementById('hud-trick-banner')!
    this.stanceEl = document.getElementById('hud-stance-btn')!
    this.leftThumbIndicator = document.getElementById('left-brake-fill')!
    this.rightThumbIndicator = document.getElementById('right-brake-fill')!
    this.startModalEl = document.getElementById('hud-start-modal')!
    this.lensBtnLabel = document.getElementById('lens-btn-label')!
    this.vantageBtnLabel = document.getElementById('vantage-btn-label')!

    const launchAlpineBtn = document.getElementById('hud-launch-alpine-btn')
    if (launchAlpineBtn) {
      launchAlpineBtn.addEventListener('click', () => {
        this.hideStartModal()
        this.onStartCallback()
        this.onSpawnAlpineCallback()
      })
    }

    const launchDunesBtn = document.getElementById('hud-launch-dunes-btn')
    if (launchDunesBtn) {
      launchDunesBtn.addEventListener('click', () => {
        this.hideStartModal()
        this.onStartCallback()
        this.onSpawnDunesCallback()
      })
    }

    const spawnAlpineBtn = document.getElementById('btn-spawn-alpine')
    if (spawnAlpineBtn) {
      spawnAlpineBtn.addEventListener('click', () => this.onSpawnAlpineCallback())
    }

    const spawnDunesBtn = document.getElementById('btn-spawn-dunes')
    if (spawnDunesBtn) {
      spawnDunesBtn.addEventListener('click', () => this.onSpawnDunesCallback())
    }

    const recenterBtn = document.getElementById('btn-recenter')
    if (recenterBtn) {
      recenterBtn.addEventListener('click', () => this.onRecenterCallback())
    }

    const relaunchBtn = document.getElementById('btn-relaunch')
    if (relaunchBtn) {
      relaunchBtn.addEventListener('click', () => this.onRelaunchCallback())
    }

    const cycleLensBtn = document.getElementById('btn-cycle-lens')
    if (cycleLensBtn) {
      cycleLensBtn.addEventListener('click', () => this.onCycleLensCallback())
    }

    const cycleVantageBtn = document.getElementById('btn-cycle-vantage')
    if (cycleVantageBtn) {
      cycleVantageBtn.addEventListener('click', () => this.onCycleVantageCallback())
    }

    if (this.stanceEl) {
      this.stanceEl.addEventListener('click', () => this.onToggleReverseCallback())
    }
  }

  public hideStartModal() {
    if (this.startModalEl) {
      this.startModalEl.style.display = 'none'
    }
  }

  public showStartModal() {
    if (this.startModalEl) {
      this.startModalEl.style.display = 'flex'
    }
  }

  public update(telemetry: FlightTelemetry, controls: FlightControls, trick: TrickState) {
    if (this.altEl) this.altEl.innerText = `${Math.round(telemetry.altitudeMeters)}m`
    if (this.speedEl) this.speedEl.innerText = `${Math.round(telemetry.airspeedKmh)} km/h`
    if (this.varioEl) {
      const v = telemetry.verticalSpeedMps
      this.varioEl.innerText = `${v >= 0 ? '+' : ''}${v.toFixed(1)} m/s`
      this.varioEl.style.color = v > 0.5 ? '#34d399' : v < -4.5 ? '#f87171' : '#fef08a'
    }
    if (this.gForceEl) {
      this.gForceEl.innerText = `${telemetry.gForce.toFixed(1)}G`
      this.gForceEl.style.color = telemetry.gForce > 3.0 ? '#f43f5e' : '#fff'
    }
    if (this.tensionEl) {
      if (telemetry.isLinesSlack) {
        this.tensionEl.innerText = 'SLACK!'
        this.tensionEl.style.color = '#ef4444'
      } else {
        this.tensionEl.innerText = `${Math.round(telemetry.lineTensionNewtons)} N`
        this.tensionEl.style.color = '#fff'
      }
    }
    if (this.scoreEl) this.scoreEl.innerText = telemetry.score.toLocaleString()

    if (this.stanceEl) {
      this.stanceEl.innerText = telemetry.isReverseStance
        ? 'STANCE: 🪁 REVERSE KITING [R]'
        : 'STANCE: FORWARD FLIGHT [R]'
      this.stanceEl.style.borderColor = telemetry.isReverseStance ? '#38bdf8' : 'rgba(255,255,255,0.2)'
      this.stanceEl.style.color = telemetry.isReverseStance ? '#38bdf8' : '#fff'
    }

    if (this.leftThumbIndicator) {
      this.leftThumbIndicator.style.height = `${controls.leftBrake * 100}%`
    }
    if (this.rightThumbIndicator) {
      this.rightThumbIndicator.style.height = `${controls.rightBrake * 100}%`
    }

    // Trick Announcements
    if (trick.announcementText && trick.announcementTimer > 0) {
      this.trickBannerEl.style.display = 'block'
      const trickText = document.getElementById('hud-trick-text')
      const trickSub = document.getElementById('hud-trick-sub')
      if (trickText) trickText.innerText = trick.announcementText
      if (trickSub) {
        trickSub.innerText =
          trick.proximityMultiplier > 1.2
            ? `${trick.proximityMultiplier.toFixed(1)}x PROXIMITY MULTIPLIER!`
            : `COMBO x${trick.trickCombo}`
      }
    } else {
      this.trickBannerEl.style.display = 'none'
    }
  }
}
