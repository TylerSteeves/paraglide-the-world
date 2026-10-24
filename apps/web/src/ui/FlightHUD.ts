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
  private descentBadgeEl: HTMLElement | null = null
  private portraitGuardEl: HTMLElement | null = null
  private varioEl!: HTMLElement
  private worldBtnEl!: HTMLElement
  private worldLabelEl!: HTMLElement
  private weatherTextEl!: HTMLElement
  private ghostBtnEl!: HTMLElement
  private gyroBtnEl!: HTMLElement
  private gyroLabelEl: HTMLElement | null = null
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
  private wingIconEl: HTMLElement | null = null
  private wingLabelEl: HTMLElement | null = null
  private objectiveEl: HTMLElement | null = null
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
  private paramotorDockEl: HTMLElement | null = null
  private rpmEl: HTMLElement | null = null
  private thrustEl: HTMLElement | null = null
  private throttleEl: HTMLElement | null = null
  private dockBtnThrottle: HTMLElement | null = null
  private dockThrottleSubEl: HTMLElement | null = null
  private dockCruiseBtn: HTMLElement | null = null
  private dockCruiseLabelEl: HTMLElement | null = null
  private hintThrottleEl: HTMLElement | null = null
  private throttleRailEl: HTMLElement | null = null
  private throttleTrackEl: HTMLElement | null = null
  private throttleFillEl: HTMLElement | null = null
  private throttleKnobEl: HTMLElement | null = null
  private throttleReadoutEl: HTMLElement | null = null
  private throttleDragging = false
  private onThrottleCallback: (value: number) => void = () => {}

  // Pilot Mass Elements
  private massEl: HTMLElement | null = null
  private massBtnEl: HTMLElement | null = null

  private onThrottleHoldCallback: (holding: boolean) => void = () => {}
  private onToggleCruiseCallback: () => void = () => {}

  private onCycleWingCallback: () => void = () => {}
  private onCyclePilotMassCallback: () => void = () => {}
  private onCycleControlModeCallback: () => void = () => {}

  private onStartCallback: () => void = () => {}
  private onRelaunchCallback: () => void = () => {}
  private onCycleCameraCallback: () => void = () => {}
  private onCycleWorldCallback: () => void = () => {}
  private onSelectWorldCallback: (worldId: string) => void = () => {}
  private onTeleportCustomGpsCallback: (lat: number, lon: number, headingDeg: number, name: string) => void = () => {}
  private onSaveGoogleApiKeyCallback: (apiKey: string) => void = () => {}
  private worldModalEl: HTMLElement | null = null
  private onToggleGhostCallback: () => void = () => {}
  private onCalibrateNeutralCallback: () => void = () => {}
  private onPullACallback: (active: boolean) => void = () => {}
  private onPullBCallback: (active: boolean) => void = () => {}
  private onCycleLnStyleCallback: () => void = () => {}
  private onToggleIrGogglesCallback: () => void = () => {}
  private onTriggerFlipCallback: () => void = () => {}
  private onTriggerRollCallback: (dir: number) => void = () => {}
  private onBailoutCollapseCallback: (active: boolean) => void = () => {}
  private onSelectSkinCallback: (skinId: string) => void = () => {}
  private onOpenLockerCallback: () => void = () => {}

  private wastedOverlayEl: HTMLElement | null = null
  private wastedReasonEl: HTMLElement | null = null
  private wastedSpeedEl: HTMLElement | null = null
  private wastedBonesEl: HTMLElement | null = null
  private wastedBillEl: HTMLElement | null = null

  public setOnTriggerFlip(cb: () => void) {
    this.onTriggerFlipCallback = cb
  }

  public setOnTriggerRoll(cb: (dir: number) => void) {
    this.onTriggerRollCallback = cb
  }

  public setOnBailoutCollapse(cb: (active: boolean) => void) {
    this.onBailoutCollapseCallback = cb
  }

  public setOnSelectSkin(cb: (skinId: string) => void) {
    this.onSelectSkinCallback = cb
  }

  public setOnOpenLocker(cb: () => void) {
    this.onOpenLockerCallback = cb
  }

  public setSkinLabel(name: string) {
    const el = document.getElementById('hud-skin-label')
    if (el) el.textContent = name
  }

  public renderLocker(state: {
    skins: Array<{ id: string; name: string; blurb: string; priceLabel: string | null; owned: boolean; equipped: boolean }>
    souvenirs: Array<{ name: string }>
  }) {
    const body = document.getElementById('locker-body')
    if (!body) return
    const cards = state.skins.map((skin) => {
      const swatch = skin.equipped ? 'rgba(56, 189, 248, 0.35)' : 'rgba(30, 41, 59, 0.9)'
      const status = skin.equipped ? 'WEARING' : skin.owned ? 'OWNED' : (skin.priceLabel || 'LOCKED')
      return `<button class="skin-card-btn" data-skin-id="${skin.id}" style="text-align: left; width: 100%; background: ${swatch}; border: 1px solid rgba(255,255,255,0.16); border-radius: 12px; padding: 10px; color: #fff; cursor: pointer; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; gap: 8px;">
          <span style="font-size: 14px; font-weight: 800;">${skin.name}</span>
          <span style="font-size: 11px; color: ${skin.owned ? '#86efac' : '#fbbf24'}; font-weight: 800;">${status}</span>
        </div>
        <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">${skin.blurb}</div>
      </button>`
    }).join('')
    const items = state.souvenirs.length
      ? state.souvenirs.map((item) => `<div style="font-size: 12px; color: #e2e8f0; padding: 4px 0;">• ${item.name}</div>`).join('')
      : `<div style="font-size: 12px; color: #64748b;">No souvenirs yet. Fly through a city's glowing ring.</div>`
    body.innerHTML = `${cards}<div style="font-size: 10px; font-weight: 800; color: #7dd3fc; letter-spacing: 1.2px; margin: 10px 0 6px;">PACK</div>${items}`
    body.querySelectorAll('.skin-card-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const id = (btn as HTMLElement).getAttribute('data-skin-id')
        if (id) this.onSelectSkinCallback(id)
      })
    })
  }

  public setOnCyclePilotMass(cb: () => void) {
    this.onCyclePilotMassCallback = cb
  }

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

  public setOnSelectWorld(callback: (worldId: string) => void) {
    this.onSelectWorldCallback = callback
  }

  public setOnTeleportCustomGps(callback: (lat: number, lon: number, headingDeg: number, name: string) => void) {
    this.onTeleportCustomGpsCallback = callback
  }

  public setOnSaveGoogleApiKey(callback: (apiKey: string) => void) {
    this.onSaveGoogleApiKeyCallback = callback
  }

  public toggleWorldModal() {
    if (!this.worldModalEl) return
    const isOpen = this.worldModalEl.style.display === 'flex'
    this.worldModalEl.style.display = isOpen ? 'none' : 'flex'
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

  public setOnThrottle(callback: (value: number) => void) {
    this.onThrottleCallback = callback
  }

  public setThrottleVisible(on: boolean) {
    if (this.throttleRailEl) this.throttleRailEl.style.display = on ? 'flex' : 'none'
  }

  public setThrottlePosition(value: number) {
    if (this.throttleDragging) return
    this.paintThrottle(value)
  }

  private paintThrottle(value: number) {
    const v = Math.max(0, Math.min(1, value))
    if (this.throttleFillEl) this.throttleFillEl.style.height = `${v * 100}%`
    if (this.throttleKnobEl) this.throttleKnobEl.style.bottom = `${v * 100}%`
    if (this.throttleReadoutEl) this.throttleReadoutEl.textContent = `${Math.round(v * 100)}`
  }

  private bindThrottleSlider() {
    const rail = this.throttleRailEl
    const track = this.throttleTrackEl
    if (!rail || !track) return
    const apply = (e: PointerEvent) => {
      const rect = track.getBoundingClientRect()
      const v = Math.max(0, Math.min(1, (rect.bottom - e.clientY) / Math.max(1, rect.height)))
      this.paintThrottle(v)
      this.onThrottleCallback(v)
    }
    rail.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      e.preventDefault()
      this.throttleDragging = true
      rail.setPointerCapture(e.pointerId)
      apply(e)
    })
    rail.addEventListener('pointermove', (e) => {
      if (!this.throttleDragging) return
      e.stopPropagation()
      e.preventDefault()
      apply(e)
    })
    const end = (e: PointerEvent) => {
      if (!this.throttleDragging) return
      this.throttleDragging = false
      e.stopPropagation()
    }
    rail.addEventListener('pointerup', end)
    rail.addEventListener('pointercancel', end)
  }

  public setOnToggleCruise(callback: () => void) {
    this.onToggleCruiseCallback = callback
  }

  public setOnCycleControlMode(callback: () => void) {
    this.onCycleControlModeCallback = callback
  }

  public setWingLabel(label: string, icon?: string) {
    if (this.wingLabelEl) {
      this.wingLabelEl.innerText = label
    }
    if (icon && this.wingIconEl) {
      this.wingIconEl.innerText = icon
    }
    if (this.wingBtnEl) {
      this.wingBtnEl.classList.toggle('power-on', label === 'POWER')
    }
  }

  public setObjective(text: string) {
    if (!this.objectiveEl || this.objectiveEl.innerText === text) return
    this.objectiveEl.innerText = text
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

  public showRelaunch(title: string = 'PARAGLIDE THE WORLD', subtitle: string = 'Tilt Left/Right to Steer • Tilt Forward to Dive • Tilt Back to Float • Rock-steady horizon') {
    if (this.relaunchTitleEl) this.relaunchTitleEl.innerText = title
    if (this.relaunchSubEl) this.relaunchSubEl.innerText = subtitle
    if (this.relaunchOverlayEl) this.relaunchOverlayEl.style.display = 'flex'
  }

  public hideRelaunch() {
    if (this.relaunchOverlayEl) this.relaunchOverlayEl.style.display = 'none'
    this.hideWasted()
  }

  public showWasted(
    reason: string,
    speedKmh: number,
    gForce: number,
    bonesBroken: number,
    hospitalBill: number,
  ) {
    if (this.wastedReasonEl) this.wastedReasonEl.innerText = reason || 'OBLITERATED ON MOUNTAIN'
    if (this.wastedSpeedEl) this.wastedSpeedEl.innerText = `${speedKmh} KM/H (${gForce}G)`
    if (this.wastedBonesEl) this.wastedBonesEl.innerText = `${bonesBroken} / 206`
    if (this.wastedBillEl) this.wastedBillEl.innerText = `$${hospitalBill.toLocaleString()}`
    if (this.wastedOverlayEl) this.wastedOverlayEl.style.display = 'flex'
  }

  public hideWasted() {
    if (this.wastedOverlayEl) this.wastedOverlayEl.style.display = 'none'
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
      <div class="hud-top-stack">
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
            <span class="hud-sep">•</span>
            <div class="hud-metric hud-descent-metric">
              <span class="hud-descent-badge descent-glide" id="hud-descent-badge">— GLIDE</span>
            </div>
            <div class="hud-g-badge" id="hud-g">1.0G</div>
          </div>

          <button class="hud-icon-btn" id="btn-world" title="Switch Location [M]" style="padding: 0 10px; font-size: 13px; font-weight: 600; width: auto;">
            <span id="hud-world-label">🇨🇦 Whistler</span>
          </button>

          <button class="hud-icon-btn btn-wing-active" id="btn-wing" title="Wing [K]" style="padding: 0 10px; font-size: 13px; font-weight: 700; width: auto; gap: 4px;">
            <span id="hud-wing-icon">🪂</span>
            <span id="hud-wing-label">XC 10:1</span>
          </button>

          <button class="hud-icon-btn" id="btn-locker" title="Pilot suits" style="padding: 0 10px; font-size: 13px; font-weight: 700; width: auto; gap: 4px;">
            <span>👕</span>
            <span id="hud-skin-label">Slate</span>
          </button>

          <div class="hud-paramotor-pill" id="hud-paramotor-pill" style="display: none; align-items: center; gap: 6px; background: rgba(245, 158, 11, 0.25); border: 1px solid rgba(245, 158, 11, 0.5); border-radius: 9999px; padding: 4px 10px; font-size: 12px; font-weight: 700; color: #fef3c7;">
            <span>🚁</span>
            <span id="hud-rpm">2200</span><small>RPM</small>
            <span class="hud-sep">•</span>
            <span id="hud-thrust">35</span><small>N</small>
            <span class="hud-sep">•</span>
            <span id="hud-throttle">0%</span>
          </div>

          <button class="hud-icon-btn" id="btn-camera" title="Cycle Camera [C]">
            <span>🎥</span>
          </button>

          <button class="hud-icon-btn" id="btn-gyro" title="Tilt Steering & Calibrate [Z]" style="padding: 0 10px; font-size: 13px; font-weight: 700; width: auto; gap: 4px;">
            <span>🧭</span>
            <span id="hud-gyro-label">TILT</span>
          </button>

          <!-- Secondary buttons hidden to keep top HUD ultra-clean on phone screens -->
          <button class="hud-icon-btn" id="btn-pilot-mass" style="display: none;"><span id="hud-mass-label">95KG</span></button>
          <button class="hud-icon-btn" id="btn-ln-style" style="display: none;"><span id="hud-ln-label">PLOTTER</span></button>
          <button class="hud-icon-btn" id="btn-risers-guide" style="display: none;"><span>ℹ️</span></button>
          <button id="btn-roll-left" style="display: none;"></button>
          <button id="btn-acro-flip" style="display: none;"></button>
          <button id="btn-bailout" style="display: none;"></button>
          <button id="btn-roll-right" style="display: none;"></button>
        </div>
      </div>
      <div id="hud-objective" class="hud-objective">Follow the rings. Grab the amber wing on the tower line.</div>
      </div>

      <!-- Pilot locker: owned suits equip now. Priced suits stay locked until a shop exists. -->
      <div id="hud-locker-modal" style="display: none; position: fixed; inset: 0; z-index: 2700; background: rgba(2, 6, 23, 0.82); backdrop-filter: blur(14px); justify-content: center; align-items: center; padding: 14px; pointer-events: auto;">
        <div style="background: rgba(15, 23, 42, 0.96); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 20px; width: min(95vw, 440px); max-height: 86vh; overflow-y: auto; padding: 18px; color: #f8fafc; box-shadow: 0 24px 60px rgba(0,0,0,0.85); font-family: system-ui, -apple-system, sans-serif;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div>
              <div style="font-size: 10px; font-weight: 800; color: #38bdf8; letter-spacing: 1.5px;">PILOT LOCKER</div>
              <div style="font-size: 18px; font-weight: 900;">Suits &amp; souvenirs</div>
            </div>
            <button id="btn-locker-close" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff; border-radius: 999px; width: 32px; height: 32px; font-size: 14px; font-weight: 800; cursor: pointer;">✕</button>
          </div>
          <p style="font-size: 12px; color: #94a3b8; margin: 0 0 12px;">Fly the glowing ring in a city to earn that suit. Priced suits are visible for later, and they do not equip yet.</p>
          <div id="locker-body"></div>
        </div>
      </div>

      <!-- GTA-Style WASTED Carnage Overlay (leaves center-top clear to watch the bloody ragdoll tumble!) -->
      <div id="hud-wasted-overlay" style="display: none; position: fixed; inset: 0; z-index: 2500; flex-direction: column; justify-content: space-between; align-items: center; padding: 28px 18px 34px; background: radial-gradient(circle at center, rgba(220, 38, 38, 0.10) 0%, rgba(153, 27, 27, 0.55) 75%, rgba(69, 10, 10, 0.85) 100%); pointer-events: auto;">
        <div style="text-align: center; margin-top: 12px; pointer-events: none;">
          <div style="font-size: clamp(46px, 11vw, 78px); font-weight: 900; letter-spacing: 6px; color: #ef4444; text-transform: uppercase; text-shadow: 0 4px 0 #450a0a, 0 0 36px rgba(239, 68, 68, 0.95); font-family: Impact, 'Arial Black', sans-serif; transform: rotate(-2deg);">
            WASTED
          </div>
          <div id="wasted-reason" style="margin-top: 6px; display: inline-block; background: rgba(15, 23, 42, 0.88); border: 1px solid rgba(248, 113, 113, 0.6); color: #fecaca; font-size: 13px; font-weight: 800; letter-spacing: 1.4px; padding: 6px 16px; border-radius: 9999px; text-transform: uppercase;">
            IMPALED ON ALPINE SPRUCE
          </div>
        </div>

        <div style="background: rgba(15, 23, 42, 0.88); backdrop-filter: blur(12px); border: 1px solid rgba(239, 68, 68, 0.5); border-radius: 18px; padding: 16px 22px; width: min(92vw, 390px); text-align: center; box-shadow: 0 12px 36px rgba(0,0,0,0.65);">
          <div style="display: flex; justify-content: space-around; gap: 10px; margin-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 12px;">
            <div>
              <div style="font-size: 10px; color: #94a3b8; font-weight: 700;">IMPACT</div>
              <div id="wasted-speed" style="font-size: 15px; color: #f8fafc; font-weight: 900;">74 KM/H (5.8G)</div>
            </div>
            <div>
              <div style="font-size: 10px; color: #94a3b8; font-weight: 700;">BONES BROKEN</div>
              <div id="wasted-bones" style="font-size: 15px; color: #f87171; font-weight: 900;">16 / 206</div>
            </div>
            <div>
              <div style="font-size: 10px; color: #94a3b8; font-weight: 700;">HOSPITAL BILL</div>
              <div id="wasted-bill" style="font-size: 15px; color: #fbbf24; font-weight: 900;">$84,200</div>
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button id="btn-wasted-relaunch" style="flex: 1; background: linear-gradient(135deg, #dc2626, #991b1b); color: #fff; border: 1px solid rgba(254, 202, 202, 0.45); border-radius: 9999px; padding: 13px 18px; font-size: 14px; font-weight: 900; letter-spacing: 0.8px; cursor: pointer; box-shadow: 0 4px 20px rgba(220, 38, 38, 0.65);">
              🪂 RESPAWN ABOVE
            </button>
            <button id="btn-wasted-world" style="background: rgba(30, 41, 59, 0.92); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.45); border-radius: 9999px; padding: 13px 16px; font-size: 13px; font-weight: 800; cursor: pointer;">
              🌍 3D MAPS
            </button>
          </div>
        </div>
      </div>

      <div id="hud-throttle-slider" class="throttle-rail" style="display: none;">
        <div class="throttle-rail-label">POWER</div>
        <div class="throttle-track" id="throttle-track">
          <div class="throttle-fill" id="throttle-fill"></div>
          <div class="throttle-knob" id="throttle-knob"></div>
        </div>
        <div class="throttle-readout" id="throttle-readout">0</div>
      </div>

      <!-- Visible Paramotor & Propeller Control Dock -->
      <div class="hud-paramotor-dock" id="hud-paramotor-dock" style="display: none; position: fixed; bottom: 24px; right: 24px; z-index: 1000; gap: 10px; align-items: center; pointer-events: auto;">
        <button id="btn-dock-throttle" class="hud-icon-btn" title="Hold to Throttle Up [Space / Shift]" style="padding: 12px 18px; font-size: 14px; font-weight: 800; background: rgba(245, 158, 11, 0.35); border: 1px solid rgba(245, 158, 11, 0.7); color: #fff; border-radius: 12px; box-shadow: 0 4px 14px rgba(0,0,0,0.4); touch-action: none; cursor: pointer; display: flex; align-items: center; gap: 6px; user-select: none;">
          <span>⚡ THROTTLE</span>
          <span id="dock-throttle-sub" style="font-size: 11px; opacity: 0.85;">[SPACE]</span>
        </button>
        <button id="btn-dock-cruise" class="hud-icon-btn" title="Toggle Level Cruise Lock [C]" style="padding: 12px 14px; font-size: 13px; font-weight: 700; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(255,255,255,0.25); color: #fff; border-radius: 12px; cursor: pointer; user-select: none;">
          <span id="dock-cruise-label">🔒 CRUISE [C]</span>
        </button>
      </div>

      <!-- Hidden Legacy DOM Elements for Compatibility -->
      <div style="display: none;" aria-hidden="true">
        <div id="hud-weather"><span id="hud-weather-text"></span></div>
        <button id="btn-ctrl-mode"><span id="hud-ctrl-icon"></span><span id="hud-ctrl-label"></span></button>
        <button id="btn-ir-goggles"><span id="hud-ir-label"></span></button>
        <button id="btn-ghost"></button>
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
          <div style="font-size: 11px; font-weight: 800; color: #38bdf8; letter-spacing: 1.5px; margin-bottom: 8px;">🪂 PARAGLIDE THE WORLD</div>
          <h2 id="relaunch-title">TRUE PARAGLIDER FLIGHT</h2>
          <p id="relaunch-sub" style="margin-bottom: 16px;">Tilt and the wing banks into the turn first, then pulls you around. A level phone holds altitude. Look up and the wing climbs. Look down and the wing dives right away. Hold the steep dive and the speed builds into it. Each ring boosts your speed, and hitting the next one keeps the boost. Drift off that line into a building and you explode. The amber ring on the tower line is a powered wing. Grab it and a throttle appears on the right — drag up to accelerate, drag down to idle.</p>
          <div style="display: flex; flex-direction: column; gap: 10px; align-items: center;">
            <button id="btn-play-portrait" style="background: linear-gradient(135deg, #0284c7, #0369a1); color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 9999px; padding: 14px 32px; font-size: 16px; font-weight: 800; box-shadow: 0 4px 24px rgba(2,132,199,0.6); pointer-events: auto; cursor: pointer; display: inline-block;">
              TAP TO FLY (DUAL TOGGLE & TILT)
            </button>
            <button id="btn-relaunch-world" style="background: rgba(15, 23, 42, 0.85); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.5); border-radius: 9999px; padding: 10px 22px; font-size: 13px; font-weight: 800; pointer-events: auto; cursor: pointer;">
              🌍 CHOOSE 3D CITY / WORLD MAP
            </button>
          </div>
          <div style="margin-top: 16px; font-size: 12px; color: #94a3b8; line-height: 1.4; max-width: 320px; margin-left: auto; margin-right: auto;">
            🔒 <b>Tip:</b> Turn on <b>Portrait Orientation Lock</b> in iPhone Control Center so your phone stays vertical when tilting!
          </div>
        </div>
      </div>

      <!-- Landscape Guidance Alert -->
      <div class="landscape-lock-alert">
        <span>🔒</span>
        <span>Turn on <b>Portrait Orientation Lock</b> in Control Center to lock screen vertical!</span>
      </div>

      <!-- 🌍 PARAGLIDE THE WORLD — Google Earth 3D & Global Teleport Modal -->
      <div id="hud-world-modal" style="display: none; position: fixed; inset: 0; z-index: 2800; background: rgba(2, 6, 23, 0.82); backdrop-filter: blur(14px); justify-content: center; align-items: center; padding: 14px; pointer-events: auto;">
        <div style="background: rgba(15, 23, 42, 0.96); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 20px; width: min(95vw, 480px); max-height: 88vh; overflow-y: auto; padding: 18px; color: #f8fafc; box-shadow: 0 24px 60px rgba(0,0,0,0.85); font-family: system-ui, -apple-system, sans-serif;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div>
              <div style="font-size: 10px; font-weight: 800; color: #38bdf8; letter-spacing: 1.5px;">🌍 GOOGLE EARTH 3D TILES + REAL DEM</div>
              <div style="font-size: 18px; font-weight: 900; color: #fff;">Paraglide the World</div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button id="btn-world-next-quick" style="background: rgba(56, 189, 248, 0.2); border: 1px solid rgba(56, 189, 248, 0.5); color: #bae6fd; border-radius: 999px; padding: 6px 12px; font-size: 12px; font-weight: 800; cursor: pointer;">⏭️ NEXT</button>
              <button id="btn-world-modal-close" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #fff; border-radius: 999px; width: 32px; height: 32px; font-size: 14px; font-weight: 800; cursor: pointer;">✕</button>
            </div>
          </div>

          <div style="font-size: 10px; font-weight: 800; color: #fdba74; letter-spacing: 1.2px; margin-bottom: 8px;">CITY RUNS · SOLID BUILDINGS</div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 12px;">
            <button class="world-card-btn" data-world-id="manhattan" style="text-align: left; background: rgba(30, 41, 59, 0.92); border: 1px solid rgba(251, 146, 60, 0.65); border-radius: 12px; padding: 10px; color: #fff; cursor: pointer;">
              <div style="font-size: 14px; font-weight: 800;">🇺🇸 Downtown NYC</div>
              <div style="font-size: 11px; color: #fdba74; margin-top: 2px;">One World Trade &amp; Wall Street</div>
            </button>
            <button class="world-card-btn" data-world-id="rio" style="text-align: left; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 12px; padding: 10px; color: #fff; cursor: pointer;">
              <div style="font-size: 14px; font-weight: 800;">🇧🇷 Rio de Janeiro</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Christ the Redeemer &amp; Sugarloaf</div>
            </button>
            <button class="world-card-btn" data-world-id="paris" style="text-align: left; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 12px; padding: 10px; color: #fff; cursor: pointer;">
              <div style="font-size: 14px; font-weight: 800;">🇫🇷 Paris</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Eiffel Tower &amp; Champ de Mars</div>
            </button>
            <button class="world-card-btn" data-world-id="egypt" style="text-align: left; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 12px; padding: 10px; color: #fff; cursor: pointer;">
              <div style="font-size: 14px; font-weight: 800;">🇪🇬 Egypt</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Giza Pyramids &amp; Sphinx</div>
            </button>
            <button class="world-card-btn" data-world-id="rome" style="text-align: left; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 12px; padding: 10px; color: #fff; cursor: pointer;">
              <div style="font-size: 14px; font-weight: 800;">🇮🇹 Rome</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Colosseum &amp; Roman Forum</div>
            </button>
            <button class="world-card-btn" data-world-id="london" style="text-align: left; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 12px; padding: 10px; color: #fff; cursor: pointer;">
              <div style="font-size: 14px; font-weight: 800;">🇬🇧 London</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Shard, Tower Bridge &amp; City</div>
            </button>
            <button class="world-card-btn" data-world-id="toronto" style="text-align: left; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 12px; padding: 10px; color: #fff; cursor: pointer;">
              <div style="font-size: 14px; font-weight: 800;">🇨🇦 Toronto</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">CN Tower &amp; Financial District</div>
            </button>
            <button class="world-card-btn" data-world-id="sf" style="text-align: left; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 12px; padding: 10px; color: #fff; cursor: pointer;">
              <div style="font-size: 14px; font-weight: 800;">🌉 San Francisco</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Golden Gate Bridge &amp; Bay</div>
            </button>
          </div>
          <div style="font-size: 10px; font-weight: 800; color: #7dd3fc; letter-spacing: 1.2px; margin-bottom: 8px;">MOUNTAINS &amp; RESORTS</div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 14px;">
            <button class="world-card-btn" data-world-id="dubai" style="text-align: left; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 12px; padding: 10px; color: #fff; cursor: pointer;">
              <div style="font-size: 14px; font-weight: 800;">🇦🇪 Dubai 3D</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Burj Khalifa (828m) &amp; Supertalls</div>
            </button>
            <button class="world-card-btn" data-world-id="matterhorn" style="text-align: left; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 12px; padding: 10px; color: #fff; cursor: pointer;">
              <div style="font-size: 14px; font-weight: 800;">🇨🇭 Matterhorn 3D</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Zermatt East Face &amp; Glacier</div>
            </button>
            <button class="world-card-btn" data-world-id="chamonix" style="text-align: left; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 12px; padding: 10px; color: #fff; cursor: pointer;">
              <div style="font-size: 14px; font-weight: 800;">🇫🇷 Chamonix 3D</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Aiguille du Midi &amp; Needles</div>
            </button>
            <button class="world-card-btn" data-world-id="yosemite" style="text-align: left; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 12px; padding: 10px; color: #fff; cursor: pointer;">
              <div style="font-size: 14px; font-weight: 800;">🇺🇸 Yosemite 3D</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Half Dome Sheer Granite Dive</div>
            </button>
            <button class="world-card-btn" data-world-id="whistler" style="text-align: left; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(255,255,255,0.16); border-radius: 12px; padding: 10px; color: #fff; cursor: pointer;">
              <div style="font-size: 14px; font-weight: 800;">🇨🇦 Whistler Resort</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Olympic Ski Run &amp; Chairlift</div>
            </button>
            <button class="world-card-btn" data-world-id="himalayas" style="text-align: left; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(255,255,255,0.16); border-radius: 12px; padding: 10px; color: #fff; cursor: pointer;">
              <div style="font-size: 14px; font-weight: 800;">🇳🇵 Himalayas</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Big-mountain XC &amp; thermals</div>
            </button>
          </div>

          <!-- Custom GPS Coordinate Teleport -->
          <div style="background: rgba(2, 6, 23, 0.65); border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 12px; margin-bottom: 12px;">
            <div style="font-size: 11px; font-weight: 800; color: #34d399; margin-bottom: 8px;">📍 FLY ANYWHERE ON EARTH (CUSTOM GPS TELEPORT)</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 0.8fr; gap: 6px; margin-bottom: 8px;">
              <input id="input-gps-lat" type="number" step="0.0001" placeholder="Lat (e.g. 37.8199)" value="37.8199" style="background: rgba(15,23,42,0.9); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 7px 8px; color: #fff; font-size: 12px; width: 100%; box-sizing: border-box;" />
              <input id="input-gps-lon" type="number" step="0.0001" placeholder="Lon (e.g. -122.4783)" value="-122.4783" style="background: rgba(15,23,42,0.9); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 7px 8px; color: #fff; font-size: 12px; width: 100%; box-sizing: border-box;" />
              <input id="input-gps-hdg" type="number" step="1" placeholder="Hdg °" value="180" style="background: rgba(15,23,42,0.9); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 7px 8px; color: #fff; font-size: 12px; width: 100%; box-sizing: border-box;" />
            </div>
            <div style="display: flex; gap: 6px;">
              <input id="input-gps-name" type="text" placeholder="Location Label" value="Golden Gate Bridge, SF" style="flex: 1; background: rgba(15,23,42,0.9); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 7px 8px; color: #fff; font-size: 12px;" />
              <button id="btn-teleport-gps" style="background: linear-gradient(135deg, #059669, #047857); border: none; color: #fff; border-radius: 8px; padding: 7px 14px; font-size: 12px; font-weight: 800; cursor: pointer;">🚀 FLY HERE</button>
            </div>
          </div>

          <!-- Google Maps Platform 3D Tiles Key Config -->
          <div style="background: rgba(2, 6, 23, 0.55); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 10px;">
            <div style="font-size: 10px; font-weight: 800; color: #fbbf24; margin-bottom: 6px;">🔑 GOOGLE MAPS PLATFORM PHOTOREALISTIC 3D TILES KEY</div>
            <div style="display: flex; gap: 6px;">
              <input id="input-gmp-api-key" type="password" placeholder="Paste Google Maps API Key (Map Tiles API enabled)" style="flex: 1; background: rgba(15,23,42,0.9); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 6px 8px; color: #fff; font-size: 11px;" />
              <button id="btn-save-gmp-key" style="background: rgba(245, 158, 11, 0.25); border: 1px solid rgba(245, 158, 11, 0.6); color: #fde68a; border-radius: 8px; padding: 6px 12px; font-size: 11px; font-weight: 800; cursor: pointer;">SAVE KEY</button>
            </div>
          </div>
        </div>
      </div>
    `

    this.speedEl = document.getElementById('hud-speed')!
    this.altEl = document.getElementById('hud-alt')!
    this.varioEl = document.getElementById('hud-vario')!
    this.descentBadgeEl = document.getElementById('hud-descent-badge')
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
    this.gyroLabelEl = document.getElementById('hud-gyro-label')

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
    this.wingIconEl = document.getElementById('hud-wing-icon')
    this.wingLabelEl = document.getElementById('hud-wing-label')
    this.objectiveEl = document.getElementById('hud-objective')
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
    this.paramotorDockEl = document.getElementById('hud-paramotor-dock')
    this.rpmEl = document.getElementById('hud-rpm')
    this.thrustEl = document.getElementById('hud-thrust')
    this.throttleEl = document.getElementById('hud-throttle')
    this.dockBtnThrottle = document.getElementById('btn-dock-throttle')
    this.dockThrottleSubEl = document.getElementById('dock-throttle-sub')
    this.dockCruiseBtn = document.getElementById('btn-dock-cruise')
    this.dockCruiseLabelEl = document.getElementById('dock-cruise-label')
    this.hintThrottleEl = document.getElementById('hint-throttle')
    this.throttleRailEl = document.getElementById('hud-throttle-slider')
    this.throttleTrackEl = document.getElementById('throttle-track')
    this.throttleFillEl = document.getElementById('throttle-fill')
    this.throttleKnobEl = document.getElementById('throttle-knob')
    this.throttleReadoutEl = document.getElementById('throttle-readout')
    this.bindThrottleSlider()

    this.massBtnEl = document.getElementById('btn-pilot-mass')
    this.massEl = document.getElementById('hud-mass-label')

    if (this.massBtnEl) {
      this.massBtnEl.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onCyclePilotMassCallback()
      })
    }

    if (this.dockCruiseBtn) {
      this.dockCruiseBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onToggleCruiseCallback()
      })
    }

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

    const lockerModal = document.getElementById('hud-locker-modal')
    document.getElementById('btn-locker')?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.onOpenLockerCallback()
      if (lockerModal) lockerModal.style.display = 'flex'
    })
    document.getElementById('btn-locker-close')?.addEventListener('click', (e) => {
      e.stopPropagation()
      if (lockerModal) lockerModal.style.display = 'none'
    })

    this.worldModalEl = document.getElementById('hud-world-modal')
    if (this.worldBtnEl) {
      this.worldBtnEl.addEventListener('click', (e) => {
        e.stopPropagation()
        this.toggleWorldModal()
      })
    }
    document.getElementById('btn-relaunch-world')?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggleWorldModal()
    })
    document.getElementById('btn-wasted-world')?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggleWorldModal()
    })

    const closeWorldModalBtn = document.getElementById('btn-world-modal-close')
    closeWorldModalBtn?.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this.worldModalEl) this.worldModalEl.style.display = 'none'
    })

    const nextWorldQuickBtn = document.getElementById('btn-world-next-quick')
    nextWorldQuickBtn?.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this.worldModalEl) this.worldModalEl.style.display = 'none'
      this.onCycleWorldCallback()
    })

    if (this.worldModalEl) {
      this.worldModalEl.addEventListener('click', (e) => {
        if (e.target === this.worldModalEl) {
          this.worldModalEl!.style.display = 'none'
        }
      })

      const cardBtns = this.worldModalEl.querySelectorAll('.world-card-btn')
      cardBtns.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          const wId = (btn as HTMLElement).getAttribute('data-world-id')
          if (this.worldModalEl) this.worldModalEl.style.display = 'none'
          if (wId) {
            this.onSelectWorldCallback(wId)
          }
        })
      })
    }

    const teleportGpsBtn = document.getElementById('btn-teleport-gps')
    teleportGpsBtn?.addEventListener('click', (e) => {
      e.stopPropagation()
      const latEl = document.getElementById('input-gps-lat') as HTMLInputElement | null
      const lonEl = document.getElementById('input-gps-lon') as HTMLInputElement | null
      const hdgEl = document.getElementById('input-gps-hdg') as HTMLInputElement | null
      const nameEl = document.getElementById('input-gps-name') as HTMLInputElement | null
      const lat = parseFloat(latEl?.value || '37.8199')
      const lon = parseFloat(lonEl?.value || '-122.4783')
      const hdg = parseFloat(hdgEl?.value || '180')
      const name = nameEl?.value?.trim() || 'Custom Earth GPS'
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        if (this.worldModalEl) this.worldModalEl.style.display = 'none'
        this.onTeleportCustomGpsCallback(lat, lon, Number.isFinite(hdg) ? hdg : 180, name)
      }
    })

    const saveGmpKeyBtn = document.getElementById('btn-save-gmp-key')
    saveGmpKeyBtn?.addEventListener('click', (e) => {
      e.stopPropagation()
      const keyEl = document.getElementById('input-gmp-api-key') as HTMLInputElement | null
      const val = keyEl?.value?.trim() || ''
      this.onSaveGoogleApiKeyCallback(val)
      if (keyEl) keyEl.value = ''
    })

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

    const flipBtn = document.getElementById('btn-acro-flip')
    if (flipBtn) {
      flipBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onTriggerFlipCallback()
      })
    }

    const rollLeftBtn = document.getElementById('btn-roll-left')
    if (rollLeftBtn) {
      rollLeftBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onTriggerRollCallback(-1)
      })
    }

    const rollRightBtn = document.getElementById('btn-roll-right')
    if (rollRightBtn) {
      rollRightBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onTriggerRollCallback(1)
      })
    }

    const bailoutBtn = document.getElementById('btn-bailout')
    if (bailoutBtn) {
      let bailToggle = false
      bailoutBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        bailToggle = !bailToggle
        this.onBailoutCollapseCallback(bailToggle)
      })
    }

    this.wastedOverlayEl = document.getElementById('hud-wasted-overlay')
    this.wastedReasonEl = document.getElementById('wasted-reason')
    this.wastedSpeedEl = document.getElementById('wasted-speed')
    this.wastedBonesEl = document.getElementById('wasted-bones')
    this.wastedBillEl = document.getElementById('wasted-bill')

    const wastedRelaunchBtn = document.getElementById('btn-wasted-relaunch')
    if (wastedRelaunchBtn) {
      wastedRelaunchBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.hideWasted()
        this.onRelaunchCallback()
      })
    }
    if (this.wastedOverlayEl) {
      this.wastedOverlayEl.addEventListener('click', (e) => {
        e.stopPropagation()
        this.hideWasted()
        this.onRelaunchCallback()
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
    }

    if (this.portraitGuardEl) {
      this.portraitGuardEl.addEventListener('click', triggerStart)
    }

    this.relaunchOverlayEl.addEventListener('click', triggerStart)
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
    pitchDemand: number = 0,
  ) {
    if (this.speedEl) this.speedEl.innerText = `${Math.round(telemetry.airspeedKmh)}`
    if (this.altEl) this.altEl.innerText = `${Math.round(telemetry.altitudeMeters)}`
    if (this.varioEl) {
      const vs = telemetry.verticalSpeedMps
      const sign = vs >= 0 ? '+' : ''
      this.varioEl.innerText = `${sign}${vs.toFixed(1)}`
      this.varioEl.style.color = vs > 0.5 ? '#34d399' : vs < -1.5 ? '#f87171' : '#e2e8f0'
    }

    if (this.descentBadgeEl) {
      const vs = telemetry.verticalSpeedMps
      const speedBar = controls.speedBar ?? 0
      const symBrake = Math.min(controls.leftBrake, controls.rightBrake)
      const isDiving = pitchDemand > 0.15 || speedBar > 0.15 || (telemetry.airspeedKmh > 55 && vs < -2.2)
      const isFlaring = pitchDemand < -0.15 || symBrake > 0.35
      const isSpiral = (isDiving || speedBar > 0.10 || vs < -4.5) && Math.abs(telemetry.bankDeg) > 35
      const isHighSpeedSwoop = (telemetry.airspeedKmh > 65.0 || controls.speedBar === 0 && symBrake > 0.4) && vs > -2.5 && telemetry.airspeedKmh > 52.0

      if (telemetry.isCollapsed) {
        this.descentBadgeEl.innerText = '⚡ FREEFALL'
        this.descentBadgeEl.className = 'hud-descent-badge descent-dive'
      } else if (isSpiral) {
        this.descentBadgeEl.innerText = '🌀 SPIRAL DIVE'
        this.descentBadgeEl.className = 'hud-descent-badge descent-dive'
      } else if (isDiving) {
        const isFastDive = telemetry.airspeedKmh > 95 || speedBar > 0.70
        this.descentBadgeEl.innerText = isFastDive ? '⚡ FAST DIVE' : '▲ DOWNHILL DIVE'
        this.descentBadgeEl.className = 'hud-descent-badge descent-dive'
      } else if (isHighSpeedSwoop) {
        this.descentBadgeEl.innerText = '⚡ SWOOP'
        this.descentBadgeEl.className = 'hud-descent-badge descent-flare'
      } else if (isFlaring) {
        this.descentBadgeEl.innerText = '▼ FLARE / FLOAT'
        this.descentBadgeEl.className = 'hud-descent-badge descent-flare'
      } else {
        this.descentBadgeEl.innerText = '— GLIDE'
        this.descentBadgeEl.className = 'hud-descent-badge descent-glide'
      }
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

    // Pilot Mass Update
    if (this.massEl) {
      this.massEl.innerText = `${telemetry.pilotMassKg ?? 95}KG`
    }

    // Paramotor HUD & Throttle Dock Update
    const isParamotor = telemetry.wingType === 'paramotor'
    if (this.paramotorPillEl) {
      this.paramotorPillEl.style.display = isParamotor ? 'inline-flex' : 'none'
    }
    if (this.paramotorDockEl) {
      this.paramotorDockEl.style.display = 'none'
    }
    if (this.dockBtnThrottle) {
      this.dockBtnThrottle.style.display = 'none'
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
      if (this.dockCruiseBtn) {
        const isCruising = Math.abs((telemetry.throttlePercent ?? 0) - 35) <= 2
        if (isCruising) {
          this.dockCruiseBtn.classList.add('active')
          if (this.dockCruiseLabelEl) this.dockCruiseLabelEl.innerText = '🔒 LEVEL CRUISE'
        } else {
          this.dockCruiseBtn.classList.remove('active')
          if (this.dockCruiseLabelEl) this.dockCruiseLabelEl.innerText = '🔒 CRUISE [C]'
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

    // Acro trick banner, Wing Collapse banner, or B-Line Stall callout
    if (this.trickBannerEl) {
      if (telemetry.isCollapsed) {
        this.trickBannerEl.style.display = 'flex'
        this.trickBannerEl.className = 'acro-banner collapse-banner'
        if (this.trickTitleEl) this.trickTitleEl.innerText = '⚠️ WING COLLAPSED • LOWER PHONE TO RECOVER'
      } else if ((controls.speedBar ?? 0) > 0.65 && pitchDemand > 0.35) {
        this.trickBannerEl.style.display = 'flex'
        this.trickBannerEl.className = 'acro-banner dive-banner'
        if (this.trickTitleEl) this.trickTitleEl.innerText = '⚡ SPEED DIVE • 85+ KM/H'
      } else if (telemetry.isBStall) {
        this.trickBannerEl.style.display = 'flex'
        this.trickBannerEl.className = 'acro-banner b-stall-banner'
        if (this.trickTitleEl) this.trickTitleEl.innerText = '⚡ B-LINE STALL (-8.8 M/S DESCENT)'
      } else if (trick && trick.announcementText && trick.announcementTimer > 0) {
        this.trickBannerEl.style.display = 'flex'
        this.trickBannerEl.className = 'acro-banner'
        if (this.trickTitleEl) this.trickTitleEl.innerText = trick.announcementText
      } else if (telemetry.tumbleStreak > 0) {
        this.trickBannerEl.style.display = 'flex'
        this.trickBannerEl.className = 'acro-banner'
        if (this.trickTitleEl) this.trickTitleEl.innerText = `TUMBLE x${telemetry.tumbleStreak}!`
      } else {
        this.trickBannerEl.style.display = 'none'
        this.trickBannerEl.className = 'acro-banner'
      }
    }
  }

  public setGyroStatus(
    active: boolean,
    steerDeg: number = 0,
    elevationDeg: number = 40,
    isCollapsed: boolean = false,
    diveInput: number | boolean = 0,
    flareFrac: number = 0,
  ) {
    if (!this.gyroLabelEl) return
    if (active) {
      const rounded = Math.round(steerDeg)
      const turnStr = Math.abs(rounded) >= 1 ? (rounded > 0 ? `TURN R ${rounded}°` : `TURN L ${Math.abs(rounded)}°`) : 'STEER 0°'
      const elevStr = `${Math.round(elevationDeg)}°`

      const isDivingBool = typeof diveInput === 'boolean' ? diveInput : diveInput > 0.05
      const divePct = typeof diveInput === 'number' ? Math.round(diveInput * 100) : 100

      let stateBadge = 'GLIDE'
      if (isCollapsed) {
        stateBadge = 'COLLAPSE'
      } else if (isDivingBool) {
        stateBadge = divePct > 0 && divePct < 100 ? `DIVE ${divePct}%` : 'DIVE'
      } else if (flareFrac > 0.05) {
        const soarPct = Math.round(flareFrac * 100)
        stateBadge = `SOAR ${soarPct}%`
      }

      this.gyroLabelEl.textContent = `${turnStr} • ELEV ${elevStr} [${stateBadge}]`
      this.gyroBtnEl?.classList.add('hud-btn-active')
      if (isCollapsed) {
        this.gyroBtnEl?.style.setProperty('color', '#ef4444')
      } else if (isDivingBool) {
        this.gyroBtnEl?.style.setProperty('color', '#38bdf8')
      } else if (flareFrac > 0.05) {
        this.gyroBtnEl?.style.setProperty('color', '#fbbf24')
      } else {
        this.gyroBtnEl?.style.setProperty('color', '#34d399')
      }
    } else {
      this.gyroLabelEl.textContent = 'ENABLE TILT'
      this.gyroBtnEl?.classList.remove('hud-btn-active')
      this.gyroBtnEl?.style.setProperty('color', '#fbbf24')
    }
  }
}
