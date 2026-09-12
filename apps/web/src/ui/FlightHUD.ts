import type { FlightControls, FlightTelemetry, TrickState } from '../physics/types'

export class FlightHUD {
  private container: HTMLElement
  private altEl!: HTMLElement
  private varioEl!: HTMLElement
  private speedEl!: HTMLElement
  private gForceEl!: HTMLElement
  private tensionEl: HTMLElement | null = null
  private scoreEl!: HTMLElement
  private trickBannerEl!: HTMLElement
  private stanceEl!: HTMLElement
  private leftThumbIndicator!: HTMLElement
  private rightThumbIndicator!: HTMLElement
  private leftBrakeThumb!: HTMLElement
  private rightBrakeThumb!: HTMLElement
  private leftBrakePct!: HTMLElement
  private rightBrakePct!: HTMLElement
  private trackpadBadge!: HTMLElement
  private trackpadInvertBtn!: HTMLElement
  private wingBtn!: HTMLElement
  private startModalEl!: HTMLElement
  private lensBtnLabel!: HTMLElement
  private vantageBtnLabel!: HTMLElement
  private xcDistanceEl!: HTMLElement

  private onStartCallback: () => void = () => {}
  private onRecenterCallback: () => void = () => {}
  private onRelaunchCallback: () => void = () => {}
  private onSpawnHimalayasCallback: () => void = () => {}
  private onSpawnAlpineCallback: () => void = () => {}
  private onSpawnDunesCallback: () => void = () => {}
  private onToggleWingCallback: () => void = () => {}
  private onCycleLensCallback: () => void = () => {}
  private onCycleVantageCallback: () => void = () => {}
  private onToggleReverseCallback: () => void = () => {}
  private onToggleInvertTrackpadCallback: () => void = () => {}

  constructor(containerId: string) {
    const el = document.getElementById(containerId)
    if (!el) throw new Error(`HUD container #${containerId} not found`)
    this.container = el

    this.render()
  }

  public setOnStart(callback: () => void) {
    this.onStartCallback = callback
  }

  public setOnSpawnHimalayas(callback: () => void) {
    this.onSpawnHimalayasCallback = callback
  }

  public setOnSpawnAlpine(callback: () => void) {
    this.onSpawnAlpineCallback = callback
  }

  public setOnSpawnDunes(callback: () => void) {
    this.onSpawnDunesCallback = callback
  }

  public setOnToggleWing(callback: () => void) {
    this.onToggleWingCallback = callback
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

  public setOnToggleInvertTrackpad(callback: () => void) {
    this.onToggleInvertTrackpadCallback = callback
  }

  public updateWingLabel(wingType: 'speedwing' | 'paraglider') {
    if (this.wingBtn) {
      if (wingType === 'paraglider') {
        this.wingBtn.innerHTML = 'WING: 🦅 XC PARAGLIDER 24m² [G]'
        this.wingBtn.style.borderColor = '#fbbf24'
        this.wingBtn.style.color = '#fef08a'
        this.wingBtn.style.background = 'rgba(251, 191, 36, 0.2)'
      } else {
        this.wingBtn.innerHTML = 'WING: ⚡ SPEEDWING 13.5m² [G]'
        this.wingBtn.style.borderColor = '#f43f5e'
        this.wingBtn.style.color = '#fca5a5'
        this.wingBtn.style.background = 'rgba(244, 63, 94, 0.2)'
      }
    }
  }

  public updateTrackpadInvertLabel(inverted: boolean) {
    if (this.trackpadInvertBtn) {
      this.trackpadInvertBtn.innerText = inverted
        ? '↕ TRACKPAD: PUSH=BRAKE [I]'
        : '↕ TRACKPAD: PULL=BRAKE [I]'
      this.trackpadInvertBtn.style.borderColor = inverted ? '#f59e0b' : '#38bdf8'
    }
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
        BUILD v3.1 • SPEEDWING & HIMALAYAS XC
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

        <div class="telemetry-pill highlight" style="border-color: #38bdf8;">
          <span class="telemetry-label">XC DIST</span>
          <span class="telemetry-value" id="hud-xc-dist" style="color: #38bdf8;">0.00 km</span>
        </div>

        <div class="telemetry-pill">
          <span class="telemetry-label">G-FORCE</span>
          <span class="telemetry-value" id="hud-gforce">1.0G</span>
        </div>

        <div class="telemetry-pill highlight">
          <span class="telemetry-label">SCORE</span>
          <span class="telemetry-value" id="hud-score">0</span>
        </div>
      </div>

      <!-- Mode & Stance Indicator -->
      <div style="position: absolute; top: 72px; left: 24px; z-index: 20; display: flex; gap: 8px; flex-wrap: wrap;">
        <button id="hud-wing-btn" style="background: rgba(244, 63, 94, 0.2); border: 1px solid #f43f5e; color: #fca5a5; padding: 6px 14px; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer; backdrop-filter: blur(6px);">
          WING: ⚡ SPEEDWING 13.5m² [G]
        </button>
        <button id="hud-stance-btn" style="background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 6px 14px; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer; backdrop-filter: blur(6px);">
          STANCE: FORWARD FLIGHT [R]
        </button>
        <button id="hud-trackpad-invert-btn" style="background: rgba(14, 165, 233, 0.2); border: 1px solid #38bdf8; color: #7dd3fc; padding: 6px 14px; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer; backdrop-filter: blur(6px);">
          ↕ TRACKPAD: PULL=BRAKE [I]
        </button>
      </div>

      <!-- Active Trackpad Gesture Banner -->
      <div id="hud-trackpad-badge" style="position: absolute; top: 114px; left: 24px; z-index: 20; background: rgba(0,0,0,0.65); border: 1px solid rgba(56, 189, 248, 0.4); color: #e0f2fe; padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.3px; backdrop-filter: blur(6px); display: flex; align-items: center; gap: 6px;">
        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 4px; background: #38bdf8; box-shadow: 0 0 6px #38bdf8;"></span>
        <span>GESTURES: ↕ Swipe Up/Down (Brakes/Bar) • ↔ Swipe Left/Right (Steer/Lean)</span>
      </div>

      <!-- Center Trick Announcement Banner -->
      <div class="trick-banner" id="hud-trick-banner" style="display: none;">
        <div class="trick-title" id="hud-trick-text">INFINITE TUMBLE x1!</div>
        <div class="trick-subtitle" id="hud-trick-sub">+3000 PTS</div>
      </div>

      <!-- Visual Ergonomic Brake Riser Handles for Mobile Dual-Thumb & Trackpad -->
      <div class="touch-controls">
        <div class="touch-zone left-zone" id="left-touch-zone">
          <div class="brake-track">
            <div class="brake-fill" id="left-brake-fill"></div>
            <div class="brake-thumb" id="left-brake-thumb">
              <span class="brake-pct" id="left-brake-pct">0%</span>
            </div>
          </div>
          <span class="zone-label">LEFT BRAKE (L-Thumb / Trackpad Left)</span>
        </div>

        <div class="touch-zone right-zone" id="right-touch-zone">
          <div class="brake-track">
            <div class="brake-fill" id="right-brake-fill"></div>
            <div class="brake-thumb" id="right-brake-thumb">
              <span class="brake-pct" id="right-brake-pct">0%</span>
            </div>
          </div>
          <span class="zone-label">RIGHT BRAKE (R-Thumb / Trackpad Right)</span>
        </div>
      </div>

      <!-- Bottom Quick Actions Toolbar -->
      <div class="quick-toolbar">
        <button class="tool-btn" id="btn-spawn-himalayas" style="border-color: #38bdf8;">
          <span>🏔️ HIMALAYAS [1]</span>
        </button>
        <button class="tool-btn" id="btn-spawn-alpine" style="border-color: #10b981;">
          <span>🎿 DOWNHILL [2]</span>
        </button>
        <button class="tool-btn" id="btn-spawn-dunes" style="border-color: #f59e0b;">
          <span>🏖️ DUNES [3]</span>
        </button>
        <button class="tool-btn" id="btn-toggle-wing" style="border-color: #f43f5e;">
          <span id="toolbar-wing-label">WING: [G]</span>
        </button>
        <button class="tool-btn" id="btn-cycle-vantage">
          <span id="vantage-btn-label">VIEW: [C] PILOT FPV</span>
        </button>
        <button class="tool-btn" id="btn-cycle-lens">
          <span id="lens-btn-label">LENS: [L] ACTION CAM</span>
        </button>
        <button class="tool-btn" id="btn-recenter">
          <span>RECENTER</span>
        </button>
      </div>

      <!-- Launch Modal -->
      <div class="start-modal" id="hud-start-modal">
        <div class="modal-card">
          <h1>PARAGLIDE THE WORLD</h1>
          <p class="subtitle">Speedwing Downhill Proximity & Himalayan Thermal XC</p>

          <div class="controls-guide">
            <div class="guide-item" style="background: rgba(244, 63, 94, 0.15); border: 1px solid rgba(244, 63, 94, 0.35);">
              <span class="key-badge" style="background: #e11d48;">🦅 WINGS [G]</span>
              <span class="guide-desc"><b>⚡ Speedwing 13.5m²</b> (Downhill speed, swoops & tricks) ↔ <b>🦅 XC Paraglider 24m²</b> (Ride thermals to 6,000m+ & cross-country distance).</span>
            </div>
            <div class="guide-item" style="background: rgba(14, 165, 233, 0.15); border: 1px solid rgba(14, 165, 233, 0.35);">
              <span class="key-badge" style="background: #0284c7;">📱 MOBILE</span>
              <span class="guide-desc"><b>Dual-Thumb Controls</b>: Drag left thumb down for left brake, right thumb down for right brake. Both down = Flare / Stall. Drag up for Speed Bar. Tilt phone to lean.</span>
            </div>
            <div class="guide-item" style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35);">
              <span class="key-badge" style="background: #059669;">💻 TRACKPAD</span>
              <span class="guide-desc"><b>2 Gestures</b>: ↕ Swipe Up/Down (Pull down = Brakes & Snap Flare, Push up = Speed Bar). ↔ Swipe Left/Right to Steer & Lean. Press <span class="key-badge">I</span> to invert.</span>
            </div>
            <div class="guide-item">
              <span class="key-badge">A</span> / <span class="key-badge">D</span>
              <span class="guide-desc">Carve Bank Turns & Deep Wingovers</span>
            </div>
            <div class="guide-item">
              <span class="key-badge">W</span> / <span class="key-badge">SPACE</span>
              <span class="guide-desc">Speedbar / Steep Alpine Dive (Accelerate to 115-130 km/h)</span>
            </div>
            <div class="guide-item">
              <span class="key-badge">SHIFT</span> / <span class="key-badge">S</span>
              <span class="guide-desc">Snap Landing Flare (<span class="key-badge">SHIFT</span>) / Full Stall or Somersault Tumble (<span class="key-badge">S</span>)</span>
            </div>
            <div class="guide-item">
              <span class="key-badge">R</span>
              <span class="guide-desc">180° Reverse Stance (Dune Kiting & Ground Handling)</span>
            </div>
          </div>

          <div style="display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap;">
            <button class="launch-btn" id="hud-launch-himalayas-btn" style="flex: 1; min-width: 180px; background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);">
              🏔️ HIMALAYAS XC (4,200m) [1]
            </button>
            <button class="launch-btn" id="hud-launch-alpine-btn" style="flex: 1; min-width: 180px;">
              🎿 ALPINE DOWNHILL (2,050m) [2]
            </button>
            <button class="launch-btn" id="hud-launch-dunes-btn" style="flex: 1; min-width: 180px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);">
              🏖️ DUNE DU PILAT (208m) [3]
            </button>
          </div>
        </div>
      </div>
    `

    this.altEl = document.getElementById('hud-alt')!
    this.varioEl = document.getElementById('hud-vario')!
    this.speedEl = document.getElementById('hud-speed')!
    this.gForceEl = document.getElementById('hud-gforce')!
    this.tensionEl = document.getElementById('hud-tension')
    this.scoreEl = document.getElementById('hud-score')!
    this.xcDistanceEl = document.getElementById('hud-xc-dist')!
    this.trickBannerEl = document.getElementById('hud-trick-banner')!
    this.stanceEl = document.getElementById('hud-stance-btn')!
    this.wingBtn = document.getElementById('hud-wing-btn')!
    this.trackpadInvertBtn = document.getElementById('hud-trackpad-invert-btn')!
    this.trackpadBadge = document.getElementById('hud-trackpad-badge')!
    this.leftThumbIndicator = document.getElementById('left-brake-fill')!
    this.rightThumbIndicator = document.getElementById('right-brake-fill')!
    this.leftBrakeThumb = document.getElementById('left-brake-thumb')!
    this.rightBrakeThumb = document.getElementById('right-brake-thumb')!
    this.leftBrakePct = document.getElementById('left-brake-pct')!
    this.rightBrakePct = document.getElementById('right-brake-pct')!
    this.startModalEl = document.getElementById('hud-start-modal')!
    this.lensBtnLabel = document.getElementById('lens-btn-label')!
    this.vantageBtnLabel = document.getElementById('vantage-btn-label')!

    const launchHimalayasBtn = document.getElementById('hud-launch-himalayas-btn')
    if (launchHimalayasBtn) {
      launchHimalayasBtn.addEventListener('click', () => {
        this.hideStartModal()
        this.onStartCallback()
        this.onSpawnHimalayasCallback()
      })
    }

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

    const spawnHimalayasBtn = document.getElementById('btn-spawn-himalayas')
    if (spawnHimalayasBtn) {
      spawnHimalayasBtn.addEventListener('click', () => this.onSpawnHimalayasCallback())
    }

    const spawnAlpineBtn = document.getElementById('btn-spawn-alpine')
    if (spawnAlpineBtn) {
      spawnAlpineBtn.addEventListener('click', () => this.onSpawnAlpineCallback())
    }

    const spawnDunesBtn = document.getElementById('btn-spawn-dunes')
    if (spawnDunesBtn) {
      spawnDunesBtn.addEventListener('click', () => this.onSpawnDunesCallback())
    }

    const toggleWingBtn = document.getElementById('btn-toggle-wing')
    if (toggleWingBtn) {
      toggleWingBtn.addEventListener('click', () => this.onToggleWingCallback())
    }

    if (this.wingBtn) {
      this.wingBtn.addEventListener('click', () => this.onToggleWingCallback())
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

    if (this.trackpadInvertBtn) {
      this.trackpadInvertBtn.addEventListener('click', () => this.onToggleInvertTrackpadCallback())
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

  public update(
    telemetry: FlightTelemetry,
    controls: FlightControls,
    trick: TrickState,
    trackpadInfo?: { active: boolean; pitch: number; roll: number },
  ) {
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
    if (this.xcDistanceEl) {
      const km = (telemetry.xcDistanceMeters / 1000).toFixed(2)
      this.xcDistanceEl.innerText = `${km} km`
    }
    if (telemetry.wingType) {
      this.updateWingLabel(telemetry.wingType)
    }

    if (this.stanceEl) {
      this.stanceEl.innerText = telemetry.isReverseStance
        ? 'STANCE: 🪁 REVERSE KITING [R]'
        : 'STANCE: FORWARD FLIGHT [R]'
      this.stanceEl.style.borderColor = telemetry.isReverseStance ? '#38bdf8' : 'rgba(255,255,255,0.2)'
      this.stanceEl.style.color = telemetry.isReverseStance ? '#38bdf8' : '#fff'
    }

    // Live Brake percentage & Riser toggle animations
    const leftPctVal = Math.round(controls.leftBrake * 100)
    const rightPctVal = Math.round(controls.rightBrake * 100)

    if (this.leftThumbIndicator) {
      this.leftThumbIndicator.style.height = `${controls.leftBrake * 100}%`
    }
    if (this.rightThumbIndicator) {
      this.rightThumbIndicator.style.height = `${controls.rightBrake * 100}%`
    }

    if (this.leftBrakeThumb) {
      this.leftBrakeThumb.style.transform = `translateY(${controls.leftBrake * 85}px)`
      if (this.leftBrakePct) this.leftBrakePct.innerText = `${leftPctVal}%`
    }
    if (this.rightBrakeThumb) {
      this.rightBrakeThumb.style.transform = `translateY(${controls.rightBrake * 85}px)`
      if (this.rightBrakePct) this.rightBrakePct.innerText = `${rightPctVal}%`
    }

    // Dynamic trackpad gesture indicator
    if (this.trackpadBadge && trackpadInfo) {
      if (trackpadInfo.active) {
        this.trackpadBadge.style.opacity = '1.0'
        const pitchText =
          trackpadInfo.pitch > 0.05
            ? `BRAKE ${(trackpadInfo.pitch * 100).toFixed(0)}%`
            : trackpadInfo.pitch < -0.05
              ? `BAR ${(-trackpadInfo.pitch * 100).toFixed(0)}%`
              : 'TRIM'
        const rollText =
          trackpadInfo.roll < -0.05
            ? `LEFT ${(Math.abs(trackpadInfo.roll) * 100).toFixed(0)}%`
            : trackpadInfo.roll > 0.05
              ? `RIGHT ${(trackpadInfo.roll * 100).toFixed(0)}%`
              : 'CTR'
        this.trackpadBadge.innerHTML = `
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 4px; background: #22c55e; box-shadow: 0 0 8px #22c55e;"></span>
          <span>TRACKPAD ACTIVE: ↕ ${pitchText} • ↔ ${rollText}</span>
        `
      } else {
        this.trackpadBadge.style.opacity = '0.7'
        this.trackpadBadge.innerHTML = `
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 4px; background: #38bdf8; box-shadow: 0 0 6px #38bdf8;"></span>
          <span>GESTURES: ↕ Swipe Up/Down (Brakes/Bar) • ↔ Swipe Left/Right (Steer/Lean)</span>
        `
      }
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
