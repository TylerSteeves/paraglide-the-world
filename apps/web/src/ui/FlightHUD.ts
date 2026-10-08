import type { FlightControls, FlightTelemetry, TrickState } from '../physics/types'
import type { XCTaskStatus } from '../simulation/XCMissionSystem'
import type { ActiveTouchVisual, ControlMode } from '../input/MobileInputManager'

export class FlightHUD {
  private container: HTMLElement
  private speedEl!: HTMLElement
  private altEl!: HTMLElement
  private gEl!: HTMLElement
  private scoreEl!: HTMLElement
  private ringsEl!: HTMLElement
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
  private portraitGuardEl: HTMLElement | null = null
  private varioEl!: HTMLElement
  private worldBtnEl!: HTMLElement
  private worldLabelEl!: HTMLElement
  private weatherTextEl!: HTMLElement
  private ghostBtnEl!: HTMLElement
  private gyroBtnEl!: HTMLElement
  private risersGuideBtn: HTMLElement | null = null
  private risersGuideModal: HTMLElement | null = null
  private dockBtnA: HTMLElement | null = null
  private dockBtnB: HTMLElement | null = null
  private lnStyleBtnEl: HTMLElement | null = null
  private lnLabelEl: HTMLElement | null = null
  private irGogglesBtnEl: HTMLElement | null = null
  private irGogglesLabelEl: HTMLElement | null = null
  private irOverlayEl: HTMLElement | null = null
  private irSpotTempEl: HTMLElement | null = null
  private irSpotStatusEl: HTMLElement | null = null

  private wingBtnEl: HTMLElement | null = null
  private wingLabelEl: HTMLElement | null = null
  private ctrlModeBtnEl: HTMLElement | null = null
  private ctrlModeIconEl: HTMLElement | null = null
  private ctrlModeLabelEl: HTMLElement | null = null
  private touchLayerEl: HTMLElement | null = null

  private xcTaskBarEl: HTMLElement | null = null
  private xcTaskNameEl: HTMLElement | null = null
  private xcTaskDistEl: HTMLElement | null = null
  private xcGlideRatioEl: HTMLElement | null = null
  private xcGlideBadgeEl: HTMLElement | null = null
  private xcProgressBarEl: HTMLElement | null = null
  private xcProgressPctEl: HTMLElement | null = null

  // Paramotor HUD Elements
  private paramotorPillEl: HTMLElement | null = null
  private rpmEl: HTMLElement | null = null
  private thrustEl: HTMLElement | null = null
  private throttleEl: HTMLElement | null = null
  private dockBtnThrottle: HTMLElement | null = null
  private dockThrottleSubEl: HTMLElement | null = null
  private hintThrottleEl: HTMLElement | null = null

  private onThrottleHoldCallback: (holding: boolean) => void = () => {}
  private onToggleCruiseCallback: () => void = () => {}

  private onCycleWingCallback: () => void = () => {}
  private onCycleControlModeCallback: () => void = () => {}

  private onStartCallback: () => void = () => {}
  private onRelaunchCallback: () => void = () => {}
  private onCycleCameraCallback: () => void = () => {}
  private onCycleWorldCallback: () => void = () => {}
  private onToggleGhostCallback: () => void = () => {}
  private onCalibrateNeutralCallback: () => void = () => {}
  private onPullACallback: (active: boolean) => void = () => {}
  private onPullBCallback: (active: boolean) => void = () => {}
  private onCycleLnStyleCallback: () => void = () => {}
  private onToggleIrGogglesCallback: () => void = () => {}

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

  public setOnCycleWorld(callback: () => void) {
    this.onCycleWorldCallback = callback
  }

  public setOnToggleGhost(callback: () => void) {
    this.onToggleGhostCallback = callback
  }

  public setOnCalibrateNeutral(callback: () => void) {
    this.onCalibrateNeutralCallback = callback
  }

  public setOnPullA(callback: (active: boolean) => void) {
    this.onPullACallback = callback
  }

  public setOnPullB(callback: (active: boolean) => void) {
    this.onPullBCallback = callback
  }

  public setOnCycleLnStyle(callback: () => void) {
    this.onCycleLnStyleCallback = callback
  }

  public setOnCycleWing(callback: () => void) {
    this.onCycleWingCallback = callback
  }

  public setOnThrottleHold(callback: (holding: boolean) => void) {
    this.onThrottleHoldCallback = callback
  }

  public setOnToggleCruise(callback: () => void) {
    this.onToggleCruiseCallback = callback
  }

  public setOnCycleControlMode(callback: () => void) {
    this.onCycleControlModeCallback = callback
  }

  public setWingLabel(label: string) {
    if (this.wingLabelEl) {
      this.wingLabelEl.innerText = label
    }
  }

  public setControlMode(mode: ControlMode) {
    if (this.ctrlModeLabelEl) {
      if (mode === 'dual_toggle') {
        if (this.ctrlModeIconEl) this.ctrlModeIconEl.innerText = '🕹️'
        this.ctrlModeLabelEl.innerText = 'DUAL'
      } else if (mode === 'flight_stick') {
        if (this.ctrlModeIconEl) this.ctrlModeIconEl.innerText = '🎮'
        this.ctrlModeLabelEl.innerText = 'STICK'
      } else {
        if (this.ctrlModeIconEl) this.ctrlModeIconEl.innerText = '🧭'
        this.ctrlModeLabelEl.innerText = 'TILT'
      }
    }
  }

  public updateXCTask(task: XCTaskStatus) {
    if (this.xcTaskBarEl) {
      this.xcTaskBarEl.style.display = 'flex'
    }
    if (this.xcTaskNameEl) {
      this.xcTaskNameEl.innerText = task.isTaskComplete ? '🏆 GOAL REACHED!' : task.activeWaypoint.name
    }
    if (this.xcTaskDistEl) {
      this.xcTaskDistEl.innerText = task.isTaskComplete ? '65.0 KM FLOWN' : `${task.distanceToActiveKm} KM`
    }
    if (this.xcGlideRatioEl) {
      this.xcGlideRatioEl.innerText = task.requiredGlideRatio > 50 ? 'CLIMB REQ' : `${task.requiredGlideRatio}:1`
    }
    if (this.xcGlideBadgeEl) {
      if (task.canReachOnGlide) {
        this.xcGlideBadgeEl.className = 'xc-glide-badge badge-reach'
        this.xcGlideBadgeEl.innerText = 'IN REACH'
      } else {
        this.xcGlideBadgeEl.className = 'xc-glide-badge badge-sink'
        this.xcGlideBadgeEl.innerText = 'NEED LIFT'
      }
    }
    if (this.xcProgressBarEl) {
      this.xcProgressBarEl.style.width = `${task.taskProgressPercent}%`
    }
    if (this.xcProgressPctEl) {
      this.xcProgressPctEl.innerText = `${task.taskProgressPercent}%`
    }
  }

  public setOnToggleIrGoggles(callback: () => void) {
    this.onToggleIrGogglesCallback = callback
  }

  public setIrGogglesState(active: boolean) {
    if (this.irGogglesBtnEl) {
      if (active) {
        this.irGogglesBtnEl.classList.add('ir-btn-active')
      } else {
        this.irGogglesBtnEl.classList.remove('ir-btn-active')
      }
    }
    if (this.irGogglesLabelEl) {
      this.irGogglesLabelEl.innerText = active ? 'IR ON' : 'IR'
    }
    if (this.irOverlayEl) {
      this.irOverlayEl.style.display = active ? 'block' : 'none'
    }
  }

  public updateIrSpotTemp(tempC: number, status: string) {
    if (this.irSpotTempEl) {
      this.irSpotTempEl.innerText = `${tempC > 0 ? '+' : ''}${tempC.toFixed(1)}°C`
    }
    if (this.irSpotStatusEl) {
      this.irSpotStatusEl.innerText = status
    }
  }

  public setLnStyleLabel(label: string) {
    if (this.lnLabelEl) {
      this.lnLabelEl.innerText = label
    }
  }

  public toggleRisersGuide() {
    if (this.risersGuideModal) {
      const isVisible = this.risersGuideModal.style.display === 'flex'
      this.risersGuideModal.style.display = isVisible ? 'none' : 'flex'
    }
  }

  public setWeatherInfo(info: string) {
    if (this.weatherTextEl) {
      this.weatherTextEl.innerText = info
    }
  }

  public setWorldName(name: string) {
    if (this.worldLabelEl) {
      this.worldLabelEl.innerText = name
    }
  }

  public setTotalCoins(total: number) {
    const el = document.getElementById('hud-total-coins')
    if (el) {
      el.innerText = `${total}`
    }
  }

  public showRelaunch(title: string = 'PARAGLIDE THE WORLD', subtitle: string = 'Tilt phone to steer • Lean forward to dive • One-handed vertical play') {
    if (this.relaunchTitleEl) this.relaunchTitleEl.innerText = title
    if (this.relaunchSubEl) this.relaunchSubEl.innerText = subtitle
    if (this.relaunchOverlayEl) this.relaunchOverlayEl.style.display = 'flex'
  }

  public hideRelaunch() {
    if (this.relaunchOverlayEl) this.relaunchOverlayEl.style.display = 'none'
  }

  public hidePortraitGuard() {
    if (this.portraitGuardEl) {
      this.portraitGuardEl.classList.add('dismissed')
      this.portraitGuardEl.style.display = 'none'
    }
  }

  private render() {
    this.container.innerHTML = `
      <!-- Clean Minimalist Top Bar -->
      <div class="top-bar">
        <div class="top-bar-left">
          <div class="hud-pill hud-coin-pill">
            <span style="font-size: 15px;">🪙</span>
            <span id="hud-rings">0</span><small>/<span id="hud-total-coins">52</span></small>
            <span class="hud-sep">•</span>
            <span id="hud-score">0</span><small>PTS</small>
          </div>
        </div>

        <div class="top-bar-right">
          <div class="hud-pill hud-flight-pill">
            <div class="hud-metric">
              <small>ALT</small>
              <span id="hud-alt">2378</span><small>M</small>
            </div>
            <span class="hud-sep">•</span>
            <div class="hud-metric">
              <small>SPD</small>
              <span id="hud-speed">48</span><small>KM/H</small>
            </div>
            <span class="hud-sep">•</span>
            <div class="hud-metric">
              <small>VARIO</small>
              <span id="hud-vario" style="color: #34d399;">+0.0</span><small>M/S</small>
            </div>
            <div class="hud-g-badge" id="hud-g">1.0G</div>
          </div>

          <button class="hud-icon-btn" id="btn-world" title="Switch Location [M]" style="padding: 0 10px; font-size: 13px; font-weight: 600; width: auto;">
            <span id="hud-world-label">🇨🇴 Andes</span>
          </button>

          <button class="hud-icon-btn btn-wing-active" id="btn-wing" title="Switch Wing [K]" style="padding: 0 10px; font-size: 13px; font-weight: 700; width: auto; gap: 4px;">
            <span>🪂</span>
            <span id="hud-wing-label">XC 10:1</span>
          </button>

          <button class="hud-icon-btn" id="btn-ln-style" title="Switch Style [L]">
            <span>📐</span>
            <span id="hud-ln-label" style="display: none;">PLOTTER</span>
          </button>

          <button class="hud-icon-btn" id="btn-camera" title="Cycle Camera [C]">
            <span>🎥</span>
          </button>

          <button class="hud-icon-btn" id="btn-risers-guide" title="Controls Guide [H]">
            <span>ℹ️</span>
          </button>
        </div>
      </div>

      <!-- Hidden Legacy DOM Elements for Compatibility -->
      <div style="display: none;" aria-hidden="true">
        <div id="hud-weather"><span id="hud-weather-text"></span></div>
        <div id="hud-paramotor-pill">
          <span id="hud-rpm"></span><span id="hud-thrust"></span><span id="hud-throttle"></span>
        </div>
        <button id="btn-ctrl-mode"><span id="hud-ctrl-icon"></span><span id="hud-ctrl-label"></span></button>
        <button id="btn-ir-goggles"><span id="hud-ir-label"></span></button>
        <button id="btn-ghost"></button>
        <button id="btn-gyro"></button>
        <div id="hud-xc-task-bar">
          <span id="xc-task-name"></span><span id="xc-task-dist"></span>
          <span id="xc-glide-ratio"></span><span id="xc-glide-badge"></span>
          <div id="xc-task-progress-bar"></div><span id="xc-task-pct"></span>
        </div>
        <div id="hud-flir-overlay">
          <span id="flir-spot-temp"></span><span id="flir-spot-status"></span>
        </div>
        <div id="left-hand-rail">
          <div id="left-rail-line"></div><div id="left-tension-tether"></div>
          <div id="left-hand-toggle"><span id="left-toggle-label"></span><span id="left-toggle-force"></span></div>
        </div>
        <div id="right-hand-rail">
          <div id="right-rail-line"></div><div id="right-tension-tether"></div>
          <div id="right-hand-toggle"><span id="right-toggle-label"></span><span id="right-toggle-force"></span></div>
        </div>
        <div id="hud-touch-layer"></div>
        <div id="hud-riser-dock">
          <button id="btn-dock-a"></button><button id="btn-dock-b"></button>
          <button id="btn-dock-throttle"><span id="dock-throttle-sub"></span></button>
        </div>
        <div id="hud-bottom-hints"><span id="hint-throttle"></span></div>
      </div>

      <!-- Center Acro / Trick Announcement Banner -->
      <div class="acro-banner" id="hud-trick-banner" style="display: none;">
        <div class="acro-title" id="hud-trick-text">INFINITY TUMBLE!</div>
      </div>

      <!-- Risers Guide & Anatomy Modal -->
      <div class="risers-guide-modal" id="hud-risers-guide" style="display: none;">
        <div class="guide-card">
          <div class="guide-header">
            <div class="guide-title-row">
              <span class="guide-badge">PARAGLIDER LINE ANATOMY</span>
              <h2>How A & B Risers Work</h2>
            </div>
            <button class="guide-close-btn" id="btn-close-guide" aria-label="Close Guide">✕</button>
          </div>

          <div class="guide-diagram">
            <div class="diagram-section a-section">
              <div class="section-tag red">▲ RED A-RISERS (Leading Edge)</div>
              <div class="section-desc">Attached to the front cells. Pulling forward flattens angle of attack, inflates wing during launch, and accelerates into high-speed glide (+18 to +25 km/h).</div>
              <div class="section-keys"><b>Controls:</b> Drag thumbs up • Hold <b>[▲ PULL A's]</b> • Key <b>[W]</b> / <b>[Space]</b> • Phone tilt forward</div>
            </div>

            <div class="diagram-section b-section">
              <div class="section-tag gold">● GOLD B-RISERS (Mid-Chord)</div>
              <div class="section-desc">Attached to center chord. Pulling down 15–20 cm induces a <b>B-Line Stall</b>: chord creases, dumping forward speed to 0 while maintaining a stable parachutal sink at -8.5 to -10 m/s without spin risk. Used to escape cloud suck!</div>
              <div class="section-keys"><b>Controls:</b> Hold <b>[● PULL B's]</b> • Key <b>[B]</b></div>
            </div>

            <div class="diagram-section trim-section">
              <div class="section-tag cyan">— CYAN TRIM SPEED (Best Glide)</div>
              <div class="section-desc">Hands at pulleys. 10.2:1 best glide ratio, minimal parasitic drag, optimal thermal search speed.</div>
              <div class="section-keys"><b>Controls:</b> Hands neutral (release thumb drags) • Level flight</div>
            </div>

            <div class="diagram-section brake-section">
              <div class="section-tag orange">▼ ORANGE BRAKES (Trailing Edge)</div>
              <div class="section-desc">Attached to rear edge. Deflects cloth downwards to bank into tight thermal spirals, flare landing, or dynamic swoops.</div>
              <div class="section-keys"><b>Controls:</b> Drag thumbs down • Keys <b>[A]/[D]</b> to steer • <b>[S]</b> to flare</div>
            </div>

            <div class="diagram-section ppg-section">
              <div class="section-tag cyan">⚡ OZONE FREERIDE 2 PARAMOTOR (Reflex Slalom)</div>
              <div class="section-desc">Powered reflex paramotor wing. Full throttle unleashes 740N forward thrust (+5.5 m/s zoom climb, 80+ km/h terrain skimming). Reflex airfoil resists collapses at high speeds.</div>
              <div class="section-keys"><b>Controls:</b> Hold <b>[Space]</b> / <b>[W]</b> to power up • <b>[X]</b> cut power • <b>[Z]</b> lock level cruise • <b>[K]</b> switch wing</div>
            </div>
          </div>

          <button class="guide-gotit-btn" id="btn-guide-gotit">GOT IT • LET'S FLY 🪂</button>
        </div>
      </div>

      <!-- Portrait Orientation Card (Suppressed for Vertical Play) -->
      <div class="portrait-guard" id="hud-portrait-guard" style="display: none !important;">
      </div>

      <!-- Minimal Start / Relaunch Overlay -->
      <div class="relaunch-overlay" id="hud-relaunch">
        <div class="relaunch-card">
          <h2 id="relaunch-title">PARAGLIDE THE WORLD</h2>
          <p id="relaunch-sub">Tilt phone to steer • Lean forward to dive • One-handed vertical play</p>
        </div>
      </div>
    `

    this.speedEl = document.getElementById('hud-speed')!
    this.altEl = document.getElementById('hud-alt')!
    this.varioEl = document.getElementById('hud-vario')!
    this.worldBtnEl = document.getElementById('btn-world')!
    this.worldLabelEl = document.getElementById('hud-world-label')!
    this.gEl = document.getElementById('hud-g')!
    this.scoreEl = document.getElementById('hud-score')!
    this.ringsEl = document.getElementById('hud-rings')!
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
    this.portraitGuardEl = document.getElementById('hud-portrait-guard')
    this.relaunchOverlayEl = document.getElementById('hud-relaunch')!
    this.relaunchTitleEl = document.getElementById('relaunch-title')!
    this.relaunchSubEl = document.getElementById('relaunch-sub')!

    this.weatherTextEl = document.getElementById('hud-weather-text')!
    this.ghostBtnEl = document.getElementById('btn-ghost')!
    this.lnStyleBtnEl = document.getElementById('btn-ln-style')
    this.lnLabelEl = document.getElementById('hud-ln-label')
    this.irGogglesBtnEl = document.getElementById('btn-ir-goggles')
    this.irGogglesLabelEl = document.getElementById('hud-ir-label')
    this.irOverlayEl = document.getElementById('hud-flir-overlay')
    this.irSpotTempEl = document.getElementById('flir-spot-temp')
    this.irSpotStatusEl = document.getElementById('flir-spot-status')
    this.dockBtnA = document.getElementById('btn-dock-a')
    this.dockBtnB = document.getElementById('btn-dock-b')
    this.risersGuideBtn = document.getElementById('btn-risers-guide')
    this.risersGuideModal = document.getElementById('hud-risers-guide')

    this.wingBtnEl = document.getElementById('btn-wing')
    this.wingLabelEl = document.getElementById('hud-wing-label')
    this.ctrlModeBtnEl = document.getElementById('btn-ctrl-mode')
    this.ctrlModeIconEl = document.getElementById('hud-ctrl-icon')
    this.ctrlModeLabelEl = document.getElementById('hud-ctrl-label')
    this.touchLayerEl = document.getElementById('hud-touch-layer')

    this.xcTaskBarEl = document.getElementById('hud-xc-task-bar')
    this.xcTaskNameEl = document.getElementById('xc-task-name')
    this.xcTaskDistEl = document.getElementById('xc-task-dist')
    this.xcGlideRatioEl = document.getElementById('xc-glide-ratio')
    this.xcGlideBadgeEl = document.getElementById('xc-glide-badge')
    this.xcProgressBarEl = document.getElementById('xc-task-progress-bar')
    this.xcProgressPctEl = document.getElementById('xc-task-pct')

    this.paramotorPillEl = document.getElementById('hud-paramotor-pill')
    this.rpmEl = document.getElementById('hud-rpm')
    this.thrustEl = document.getElementById('hud-thrust')
    this.throttleEl = document.getElementById('hud-throttle')
    this.dockBtnThrottle = document.getElementById('btn-dock-throttle')
    this.dockThrottleSubEl = document.getElementById('dock-throttle-sub')
    this.hintThrottleEl = document.getElementById('hint-throttle')

    if (this.wingBtnEl) {
      this.wingBtnEl.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onCycleWingCallback()
      })
    }

    if (this.ctrlModeBtnEl) {
      this.ctrlModeBtnEl.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onCycleControlModeCallback()
      })
    }

    if (this.lnStyleBtnEl) {
      this.lnStyleBtnEl.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onCycleLnStyleCallback()
      })
    }

    if (this.irGogglesBtnEl) {
      this.irGogglesBtnEl.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onToggleIrGogglesCallback()
      })
    }

    if (this.worldBtnEl) {
      this.worldBtnEl.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onCycleWorldCallback()
      })
    }

    if (this.ghostBtnEl) {
      this.ghostBtnEl.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onToggleGhostCallback()
      })
    }

    this.gyroBtnEl = document.getElementById('btn-gyro')!
    if (this.gyroBtnEl) {
      this.gyroBtnEl.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onCalibrateNeutralCallback()
      })
    }

    if (this.risersGuideBtn) {
      this.risersGuideBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.toggleRisersGuide()
      })
    }

    const closeGuideBtn = document.getElementById('btn-close-guide')
    const gotItGuideBtn = document.getElementById('btn-guide-gotit')
    const closeGuide = (e: Event) => {
      e.stopPropagation()
      if (this.risersGuideModal) this.risersGuideModal.style.display = 'none'
    }
    closeGuideBtn?.addEventListener('click', closeGuide)
    gotItGuideBtn?.addEventListener('click', closeGuide)
    if (this.risersGuideModal) {
      this.risersGuideModal.addEventListener('click', (e) => {
        if (e.target === this.risersGuideModal) closeGuide(e)
      })
    }

    // Dock quick-action buttons for A and B risers
    if (this.dockBtnA) {
      const startPullA = (e: Event) => {
        e.stopPropagation()
        e.preventDefault()
        this.onPullACallback(true)
      }
      const endPullA = (e: Event) => {
        e.stopPropagation()
        e.preventDefault()
        this.onPullACallback(false)
      }
      this.dockBtnA.addEventListener('pointerdown', startPullA)
      this.dockBtnA.addEventListener('pointerup', endPullA)
      this.dockBtnA.addEventListener('pointercancel', endPullA)
      this.dockBtnA.addEventListener('pointerleave', endPullA)
    }

    if (this.dockBtnB) {
      const startPullB = (e: Event) => {
        e.stopPropagation()
        e.preventDefault()
        this.onPullBCallback(true)
      }
      const endPullB = (e: Event) => {
        e.stopPropagation()
        e.preventDefault()
        this.onPullBCallback(false)
      }
      this.dockBtnB.addEventListener('pointerdown', startPullB)
      this.dockBtnB.addEventListener('pointerup', endPullB)
      this.dockBtnB.addEventListener('pointercancel', endPullB)
      this.dockBtnB.addEventListener('pointerleave', endPullB)
    }

    if (this.dockBtnThrottle) {
      const startThrottle = (e: Event) => {
        e.stopPropagation()
        e.preventDefault()
        this.onThrottleHoldCallback(true)
      }
      const endThrottle = (e: Event) => {
        e.stopPropagation()
        e.preventDefault()
        this.onThrottleHoldCallback(false)
      }
      this.dockBtnThrottle.addEventListener('pointerdown', startThrottle)
      this.dockBtnThrottle.addEventListener('pointerup', endThrottle)
      this.dockBtnThrottle.addEventListener('pointercancel', endThrottle)
      this.dockBtnThrottle.addEventListener('pointerleave', endThrottle)
      this.dockBtnThrottle.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onToggleCruiseCallback()
      })
    }

    const camBtn = document.getElementById('btn-camera')
    if (camBtn) {
      camBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onCycleCameraCallback()
      })
    }

    const triggerStart = (e: Event) => {
      e.stopPropagation()
      this.hidePortraitGuard()
      this.hideRelaunch()
      this.onStartCallback()
      this.onRelaunchCallback()
    }

    const playPortraitBtn = document.getElementById('btn-play-portrait')
    if (playPortraitBtn) {
      playPortraitBtn.addEventListener('click', triggerStart)
      playPortraitBtn.addEventListener('pointerdown', triggerStart)
      playPortraitBtn.addEventListener('touchstart', triggerStart, { passive: true })
    }

    if (this.portraitGuardEl) {
      this.portraitGuardEl.addEventListener('click', triggerStart)
      this.portraitGuardEl.addEventListener('pointerdown', triggerStart)
      this.portraitGuardEl.addEventListener('touchstart', triggerStart, { passive: true })
    }

    this.relaunchOverlayEl.addEventListener('click', triggerStart)
    this.relaunchOverlayEl.addEventListener('pointerdown', triggerStart)
    this.relaunchOverlayEl.addEventListener('touchstart', triggerStart, { passive: true })
  }

  public updateTouchVisuals(visuals: ActiveTouchVisual[] = [], controlMode: ControlMode = 'dual_toggle') {
    if (!this.touchLayerEl) return
    if (!visuals || visuals.length === 0) {
      if (this.touchLayerEl.style.display !== 'none') {
        this.touchLayerEl.style.display = 'none'
        this.touchLayerEl.innerHTML = ''
      }
      return
    }

    this.touchLayerEl.style.display = 'block'
    let html = ''
    for (let i = 0; i < visuals.length; i++) {
      const v = visuals[i]
      const dx = v.deltaX
      const dy = v.deltaY
      const isStick = controlMode === 'flight_stick' && v.side === 'left'

      let badgeText = 'TRIM'
      let badgeClass = 'badge-trim'
      if (v.zone === 'A') {
        badgeText = "▲ SPEED (+18)"
        badgeClass = 'badge-speed'
      } else if (v.zone === 'BRAKE') {
        badgeText = `▼ BRAKE ${Math.round(v.brake * 100)}%`
        badgeClass = 'badge-brake'
      } else if (v.zone === 'STALL') {
        badgeText = `▼ STALL!`
        badgeClass = 'badge-stall'
      }

      const tetherAngle = Math.atan2(dy, dx) * (180 / Math.PI)
      const tetherDist = Math.hypot(dx, dy)

      html += `
        <div class="touch-anchor ${isStick ? 'stick-mode' : ''}" style="left: ${v.anchorX}px; top: ${v.anchorY}px;">
          ${isStick ? '<div class="stick-boundary"></div><div class="stick-crosshair-h"></div><div class="stick-crosshair-v"></div>' : ''}
          <div class="anchor-ring"></div>
          ${tetherDist > 8 ? `
            <div class="touch-tether" style="width: ${tetherDist}px; transform: rotate(${tetherAngle}deg);"></div>
          ` : ''}
        </div>
        <div class="touch-puck puck-${v.zone.toLowerCase()}" style="left: ${v.currentX}px; top: ${v.currentY}px;">
          <div class="puck-ring"></div>
          <div class="touch-badge ${badgeClass}">${badgeText}</div>
        </div>
      `
    }
    this.touchLayerEl.innerHTML = html
  }

  public update(
    telemetry: FlightTelemetry,
    controls: FlightControls,
    trick?: TrickState,
    leftLagFrac: number = 0,
    rightLagFrac: number = 0,
    leftThumbYFrac: number | null = null,
    rightThumbYFrac: number | null = null,
    activeTouches: ActiveTouchVisual[] = [],
    controlMode: ControlMode = 'dual_toggle',
  ) {
    if (this.speedEl) this.speedEl.innerText = `${Math.round(telemetry.airspeedKmh)}`
    if (this.altEl) this.altEl.innerText = `${Math.round(telemetry.altitudeMeters)}`
    if (this.varioEl) {
      const vs = telemetry.verticalSpeedMps
      const sign = vs >= 0 ? '+' : ''
      this.varioEl.innerText = `${sign}${vs.toFixed(1)}`
      this.varioEl.style.color = vs > 0.5 ? '#34d399' : vs < -1.5 ? '#f87171' : '#e2e8f0'
    }
    if (this.scoreEl) this.scoreEl.innerText = `${Math.round(telemetry.score)}`
    if (this.ringsEl) this.ringsEl.innerText = `${telemetry.ringsCollected}`

    if (this.gEl) {
      const g = telemetry.gForce
      this.gEl.innerText = `${g.toFixed(1)}G`
      if (g > 1.8) {
        this.gEl.style.color = '#ef4444' // Crimson high-G load
        this.gEl.style.borderColor = 'rgba(239, 68, 68, 0.7)'
        this.gEl.style.textShadow = '0 0 10px rgba(239, 68, 68, 0.8)'
      } else if (g > 1.3) {
        this.gEl.style.color = '#f59e0b' // Amber carve
        this.gEl.style.borderColor = 'rgba(245, 158, 11, 0.6)'
        this.gEl.style.textShadow = 'none'
      } else if (g < 0.75) {
        this.gEl.style.color = '#38bdf8' // Weightless zero-G float
        this.gEl.style.borderColor = 'rgba(56, 189, 248, 0.6)'
        this.gEl.style.textShadow = '0 0 8px rgba(56, 189, 248, 0.6)'
      } else {
        this.gEl.style.color = '#e2e8f0'
        this.gEl.style.borderColor = 'rgba(255, 255, 255, 0.2)'
        this.gEl.style.textShadow = 'none'
      }
    }

    const isHighTension = telemetry.lineTensionNewtons > 1250
    const isSlack = telemetry.isLinesSlack || telemetry.lineTensionNewtons < 250
    const railClass = isHighTension ? 'rail-line high-tension' : isSlack ? 'rail-line slack-tension' : 'rail-line'
    if (this.leftRailLineEl) this.leftRailLineEl.className = railClass
    if (this.rightRailLineEl) this.rightRailLineEl.className = railClass

    const isBuffeting = telemetry.stallWarning > 0.6 && !telemetry.isStalled

    const pullingA = Math.max(controls.pullingA ?? 0, controls.speedBar ?? 0)
    const pullingB = controls.pullingB ?? 0

    let leftPosPct = 25
    if (pullingA > 0.05 && controls.leftBrake < 0.1) {
      leftPosPct = 25 - pullingA * 18
    } else if (pullingB > 0.05 && controls.leftBrake < 0.1) {
      leftPosPct = 25 - pullingB * 7
    } else {
      leftPosPct = 25 + controls.leftBrake * 63
    }

    let rightPosPct = 25
    if (pullingA > 0.05 && controls.rightBrake < 0.1) {
      rightPosPct = 25 - pullingA * 18
    } else if (pullingB > 0.05 && controls.rightBrake < 0.1) {
      rightPosPct = 25 - pullingB * 7
    } else {
      rightPosPct = 25 + controls.rightBrake * 63
    }

    if (this.leftToggleEl) {
      this.leftToggleEl.style.top = `${leftPosPct}%`
      let baseClass = 'hand-toggle'
      if (pullingA > 0.08 && controls.leftBrake < 0.1) {
        baseClass += ' a-active'
        this.leftLabelEl.innerText = "▲ A's"
        if (this.leftForceEl) this.leftForceEl.innerText = '+18 KM/H'
      } else if (pullingB > 0.08 && controls.leftBrake < 0.1) {
        baseClass += ' b-active'
        this.leftLabelEl.innerText = '● B-STALL'
        if (this.leftForceEl) this.leftForceEl.innerText = '-8.8 M/S'
      } else if (controls.leftBrake > 0.75 || telemetry.leftStalled) {
        baseClass += ' stall-active'
        this.leftLabelEl.innerText = 'STALL'
        if (this.leftForceEl) this.leftForceEl.innerText = 'COLLAPSE'
      } else if (controls.leftBrake > 0.05) {
        baseClass += ' brake-active'
        this.leftLabelEl.innerText = `${Math.round(controls.leftBrake * 100)}%`
        if (this.leftForceEl) {
          this.leftForceEl.innerText = telemetry.leftBrakeForceN > 8 ? `${Math.round(telemetry.leftBrakeForceN)}N` : ''
        }
      } else {
        this.leftLabelEl.innerText = 'TRIM'
        if (this.leftForceEl) this.leftForceEl.innerText = '10:1'
      }
      if (isBuffeting && controls.leftBrake > 0.35) baseClass += ' buffet-shake'
      this.leftToggleEl.className = baseClass
    }

    if (this.rightToggleEl) {
      this.rightToggleEl.style.top = `${rightPosPct}%`
      let baseClass = 'hand-toggle'
      if (pullingA > 0.08 && controls.rightBrake < 0.1) {
        baseClass += ' a-active'
        this.rightLabelEl.innerText = "▲ A's"
        if (this.rightForceEl) this.rightForceEl.innerText = '+18 KM/H'
      } else if (pullingB > 0.08 && controls.rightBrake < 0.1) {
        baseClass += ' b-active'
        this.rightLabelEl.innerText = '● B-STALL'
        if (this.rightForceEl) this.rightForceEl.innerText = '-8.8 M/S'
      } else if (controls.rightBrake > 0.75 || telemetry.rightStalled) {
        baseClass += ' stall-active'
        this.rightLabelEl.innerText = 'STALL'
        if (this.rightForceEl) this.rightForceEl.innerText = 'COLLAPSE'
      } else if (controls.rightBrake > 0.05) {
        baseClass += ' brake-active'
        this.rightLabelEl.innerText = `${Math.round(controls.rightBrake * 100)}%`
        if (this.rightForceEl) {
          this.rightForceEl.innerText = telemetry.rightBrakeForceN > 8 ? `${Math.round(telemetry.rightBrakeForceN)}N` : ''
        }
      } else {
        this.rightLabelEl.innerText = 'TRIM'
        if (this.rightForceEl) this.rightForceEl.innerText = '10:1'
      }
      if (isBuffeting && controls.rightBrake > 0.35) baseClass += ' buffet-shake'
      this.rightToggleEl.className = baseClass
    }

    // Update Dock Buttons active state
    if (this.dockBtnA) {
      if (pullingA > 0.15) {
        this.dockBtnA.classList.add('active')
      } else {
        this.dockBtnA.classList.remove('active')
      }
    }
    if (this.dockBtnB) {
      if (pullingB > 0.15 || telemetry.isBStall) {
        this.dockBtnB.classList.add('active')
      } else {
        this.dockBtnB.classList.remove('active')
      }
    }

    // Paramotor HUD & Throttle Dock Update
    const isParamotor = telemetry.wingType === 'paramotor'
    if (this.paramotorPillEl) {
      this.paramotorPillEl.style.display = isParamotor ? 'inline-flex' : 'none'
    }
    if (this.dockBtnThrottle) {
      this.dockBtnThrottle.style.display = isParamotor ? 'flex' : 'none'
    }
    if (this.hintThrottleEl) {
      this.hintThrottleEl.style.display = isParamotor ? 'inline-block' : 'none'
    }

    if (isParamotor) {
      if (this.rpmEl) this.rpmEl.innerText = `${telemetry.engineRpm ?? 0}`
      if (this.thrustEl) this.thrustEl.innerText = `${telemetry.thrustNewtons ?? 0}`
      if (this.throttleEl) this.throttleEl.innerText = `${telemetry.throttlePercent ?? 0}%`
      if (this.dockThrottleSubEl) {
        this.dockThrottleSubEl.innerText = `${telemetry.throttlePercent ?? 0}% [SPACE]`
      }
      if (this.dockBtnThrottle) {
        if ((telemetry.throttlePercent ?? 0) > 10) {
          this.dockBtnThrottle.classList.add('active')
        } else {
          this.dockBtnThrottle.classList.remove('active')
        }
      }
    }

    // Elastic Tension Tethers on edge rails
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

    // Render floating on-screen touches
    this.updateTouchVisuals(activeTouches, controlMode)

    // Acro trick banner or B-Line Stall callout
    if (this.trickBannerEl) {
      if (telemetry.isBStall) {
        this.trickBannerEl.style.display = 'flex'
        this.trickBannerEl.classList.add('b-stall-banner')
        if (this.trickTitleEl) this.trickTitleEl.innerText = '⚡ B-LINE STALL (-8.8 M/S DESCENT)'
      } else if (trick && trick.announcementText && trick.announcementTimer > 0) {
        this.trickBannerEl.style.display = 'flex'
        this.trickBannerEl.classList.remove('b-stall-banner')
        if (this.trickTitleEl) this.trickTitleEl.innerText = trick.announcementText
      } else if (telemetry.tumbleStreak > 0) {
        this.trickBannerEl.style.display = 'flex'
        this.trickBannerEl.classList.remove('b-stall-banner')
        if (this.trickTitleEl) this.trickTitleEl.innerText = `TUMBLE x${telemetry.tumbleStreak}!`
      } else {
        this.trickBannerEl.style.display = 'none'
        this.trickBannerEl.classList.remove('b-stall-banner')
      }
    }
  }
}
