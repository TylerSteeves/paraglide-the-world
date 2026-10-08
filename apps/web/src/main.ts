import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'

import '@babylonjs/core/Meshes/instancedMesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import '@babylonjs/core/Culling/ray'
import '@babylonjs/core/Rendering/edgesRenderer'

import { ParagliderSimulation } from './physics/pendulum'
import { TrickDetector } from './physics/tricks'
import { ActionCamera } from './rendering/ActionCamera'
import { ParagliderRig } from './rendering/ParagliderRig'
import { AtmosphericSky } from './rendering/AtmosphericSky'
import { ThermalVortexSystem } from './rendering/ThermalVortexSystem'
import { ThermalGaggleSystem } from './simulation/ThermalGaggleSystem'
import { TrackedFlightPlayer } from './simulation/TrackedFlightPlayer'
import { TRACKED_FLIGHTS } from './data/tracked-flights'
import { RoldanilloMountain } from './world/RoldanilloMountain'
import { WhistlerMountain } from './world/WhistlerMountain'
import { HimalayasMountain } from './world/HimalayasMountain'
import { ChairliftSystem } from './world/ChairliftSystem'
import { CoinRings } from './world/CoinRings'
import type { FlightWorld, WorldId } from './world/types'
import { MobileInputManager } from './input/MobileInputManager'
import { FlightSoundscape } from './audio/FlightSoundscape'
import { FlightHUD } from './ui/FlightHUD'
import { LineArtTerrain } from './rendering/LineArtTerrain'
import { LnStyleManager } from './rendering/LnStyleManager'
import { WindStreakSystem } from './rendering/WindStreakSystem'
import { XCMissionSystem } from './simulation/XCMissionSystem'
import { ToroidalFluidSplatSystem } from './rendering/ToroidalFluidSplatSystem'

function initApp() {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  if (!canvas) throw new Error('Canvas #renderCanvas not found')

  // 1. Initialize Babylon.js Engine & Scene
  const engine = new Engine(canvas, true, {
    antialias: true,
    adaptToDeviceRatio: true,
    powerPreference: 'high-performance',
    stencil: false,
  })

  const scene = new Scene(engine)

  // 1. Atmospheric Sky & Distance Horizon Fog
  const sky = new AtmosphericSky(scene, 'roldanillo')

  // Sun & Ambient Lights
  const ambientLight = new HemisphericLight('ambient-sky', new Vector3(0.2, 1.0, 0.1), scene)
  ambientLight.diffuse = new Color3(0.85, 0.92, 1.0)
  ambientLight.groundColor = new Color3(0.25, 0.28, 0.22)
  ambientLight.intensity = 1.35

  const sunLight = new DirectionalLight('sun-dir', new Vector3(-0.45, -0.85, 0.28), scene)
  sunLight.diffuse = new Color3(1.0, 0.96, 0.88) // Crisp alpine sun
  sunLight.intensity = 2.6

  // 2. Active World Setup: Default to 🇨🇦 Whistler Olympic Alpine Ski Resort (Cool Boarders 2 Downhill Descent)
  let currentWorldId: WorldId = 'whistler'
  const initWhistler = new WhistlerMountain(scene)
  let activeWorld: FlightWorld = initWhistler
  let chairlift: ChairliftSystem | null = new ChairliftSystem(scene, initWhistler)
  let coinRings: CoinRings | null = new CoinRings(scene, initWhistler)

  // 2b. Vector Line-Art Topographic Engine (fogleman/ln vector aesthetic)
  const lnStyle = LnStyleManager.getInstance()
  let lineArtTerrain = new LineArtTerrain(scene, (activeWorld as any).terrainMesh, currentWorldId)

  lnStyle.subscribe((palette) => {
    if (palette.isLineMode) {
      ambientLight.intensity = 0.85
      sunLight.intensity = 0.6
    } else {
      ambientLight.intensity = 1.35
      sunLight.intensity = 2.6
    }
  })

  // 3. Visual Thermal Vortex Columns & Soaring Raptors
  const thermalVortex = new ThermalVortexSystem(scene)
  thermalVortex.setThermals(activeWorld.thermals || [])

  // 4. Multi-Glider Thermal Gaggle (Autonomous AI pilots sharing thermal spirals)
  const gaggle = new ThermalGaggleSystem(scene)
  gaggle.setThermals(activeWorld.thermals || [])

  // 5. Real Competition Tracked GPS Flights & Ghost Pilot
  const trackedPlayer = new TrackedFlightPlayer(scene)
  trackedPlayer.setFlight(TRACKED_FLIGHTS[currentWorldId])

  // 5b. 65km XC Mountain Mission (Roldanillo to Lago Calima) & Aerodynamic Wind Streaks
  const xcMission = new XCMissionSystem(scene)
  const windStreaks = new WindStreakSystem(scene)
  ;(window as any).xcMission = xcMission
  ;(window as any).windStreaks = windStreaks

  // 6. Build Flight Core, Camera, and Rig
  const lPos = activeWorld.launchPosition
  const lHeading = activeWorld.launchHeadingDeg
  const sim = new ParagliderSimulation(lPos.y, lHeading, 'speedwing', { x: lPos.x, y: lPos.y, z: lPos.z })
  sim.setWing('speedwing') // High-speed downhill speedwing (4.8:1 slope carver)!
  sim.world = activeWorld
  ;(window as any).sim = sim
  ;(window as any).scene = scene
  const rig = new ParagliderRig(scene)
  ;(window as any).rig = rig
  const actionCam = new ActionCamera(scene)
  ;(window as any).actionCam = actionCam
  actionCam.update(sim, 0.016)
  actionCam.snap()
  ;(window as any).mountain = activeWorld
  const trickDetector = new TrickDetector()

  // 6b. 3D Toroidal Gaussian Splat Fluid Dynamics & Electrostatic Arcs
  let fluidSplats = new ToroidalFluidSplatSystem(
    scene,
    () => activeWorld.thermals || [],
    (x, z) => activeWorld.sampleHeight(x, z),
  )
  ;(window as any).fluidSplats = fluidSplats

  // 7. Input, Audio, HUD
  const inputManager = new MobileInputManager()
  ;(window as any).inputManager = inputManager
  const soundscape = new FlightSoundscape()
  const hud = new FlightHUD('hud-container')
  hud.setWorldName('🇨🇦 Whistler')
  hud.setTotalCoins(coinRings.totalCoins)
  const getWingLabel = (w: 'paraglider' | 'speedwing' | 'paramotor') => {
    if (w === 'paraglider') return 'XC 10:1'
    if (w === 'speedwing') return 'SPEED 5:1'
    return 'FREERIDE 2'
  }
  hud.setWingLabel(getWingLabel(sim.currentWingType))
  hud.setControlMode(inputManager.controlMode)

  const toggleWing = () => {
    let nextWing: 'paraglider' | 'speedwing' | 'paramotor' = 'paraglider'
    if (sim.currentWingType === 'paraglider') nextWing = 'speedwing'
    else if (sim.currentWingType === 'speedwing') nextWing = 'paramotor'
    else nextWing = 'paraglider'

    sim.setWing(nextWing)
    hud.setWingLabel(getWingLabel(nextWing))
  }
  hud.setOnCycleWing(toggleWing)
  inputManager.onToggleWing = toggleWing

  hud.setOnThrottleHold((holding) => {
    if (holding) {
      inputManager.setTargetThrottle(1.0)
    } else {
      inputManager.setTargetThrottle(inputManager.isCruiseLocked ? 0.55 : 0)
    }
  })

  hud.setOnToggleCruise(() => {
    const locked = inputManager.toggleCruiseLock()
    if (locked) {
      inputManager.setTargetThrottle(0.55)
    } else {
      inputManager.setTargetThrottle(0)
    }
  })

  hud.setOnCycleControlMode(() => {
    const next = inputManager.cycleControlMode()
    hud.setControlMode(next)
  })
  inputManager.onControlModeChange = (mode) => {
    hud.setControlMode(mode)
  }

  xcMission.onWaypointCompleted = (_wp, _nextWp) => {
    soundscape.playCoinSound()
  }
  xcMission.onMissionFinished = () => {
    soundscape.playCoinSound()
  }

  let currentAirTempC = 24

  // Live Wind & Atmosphere Connection via Open-Meteo
  const applyLiveWeather = async (worldId: WorldId) => {
    const coords: Record<WorldId, { lat: number; lon: number; name: string }> = {
      roldanillo: { lat: 4.414, lon: -76.155, name: 'Cauca Valley' },
      whistler: { lat: 50.116, lon: -122.957, name: 'Whistler Peak' },
      himalayas: { lat: 28.209, lon: 83.985, name: 'Pokhara Ridge' },
    }
    const loc = coords[worldId] || coords.roldanillo

    let speedKmh = 14
    let headingDeg = 315
    let summary = `💨 Wind: 14 km/h NW`

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kmh`
      const res = await fetch(url, { signal: AbortSignal.timeout(3500) })
      if (res.ok) {
        const data = await res.json()
        const cur = data.current
        if (cur) {
          speedKmh = cur.wind_speed_10m ?? 14
          headingDeg = cur.wind_direction_10m ?? 315
          const gusts = cur.wind_gusts_10m ?? Math.round(speedKmh * 1.3)
          const temp = Math.round(cur.temperature_2m ?? 24)
          currentAirTempC = temp
          const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
          const card = cardinals[Math.round(headingDeg / 45) % 8]
          summary = `⛅ LIVE: ${Math.round(speedKmh)}km/h ${card} (G${Math.round(gusts)}) • ${temp}°C`
        }
      }
    } catch {
      const defaults: Record<WorldId, { speed: number; deg: number; card: string; temp: number }> = {
        roldanillo: { speed: 14, deg: 315, card: 'NW', temp: 28 },
        whistler: { speed: 20, deg: 240, card: 'WSW', temp: 8 },
        himalayas: { speed: 15, deg: 180, card: 'S', temp: 16 },
      }
      const d = defaults[worldId] || defaults.roldanillo
      summary = `⛅ MET: ${d.speed}km/h ${d.card} • ${d.temp}°C`
      speedKmh = d.speed
      headingDeg = d.deg
      currentAirTempC = d.temp
    }

    sim.atmosphere.windSpeedKmh = speedKmh
    sim.atmosphere.windHeadingDeg = headingDeg
    const rad = (headingDeg * Math.PI) / 180
    const mps = speedKmh / 3.6
    sim.atmosphere.windVector = {
      x: -Math.sin(rad) * mps,
      y: 0,
      z: -Math.cos(rad) * mps,
    }
    hud.setWeatherInfo(summary)
  }

  // Trigger initial live weather load
  applyLiveWeather(currentWorldId)

  let hasStarted = false

  const startFlight = async () => {
    if (hasStarted) return
    hasStarted = true
    canvas.focus()
    hud.hidePortraitGuard()
    hud.hideRelaunch()

    const pos = activeWorld.launchPosition
    const heading = activeWorld.launchHeadingDeg
    sim.reset(pos.y, heading, { x: pos.x, y: pos.y, z: pos.z })
    actionCam.snap()
    engine.resize()

    // Non-blocking gyro permission with safety timeout
    try {
      await Promise.race([
        inputManager.requestGyroPermission(),
        new Promise((resolve) => setTimeout(resolve, 800)),
      ])
    } catch {}

    inputManager.calibrateNeutral()

    try {
      soundscape.init()
    } catch {}
  }

  const relaunchFlight = () => {
    const pos = activeWorld.launchPosition
    const heading = activeWorld.launchHeadingDeg
    sim.reset(pos.y, heading, { x: pos.x, y: pos.y, z: pos.z })
    if (coinRings) coinRings.reset()
    trickDetector.reset()
    xcMission.resetTask()
    actionCam.snap()
    hud.hideRelaunch()
  }

  const switchWorld = (targetId?: WorldId) => {
    const worldIds: WorldId[] = ['whistler', 'roldanillo', 'himalayas']
    const nextId = targetId ?? worldIds[(worldIds.indexOf(currentWorldId) + 1) % worldIds.length]
    if (nextId === currentWorldId) return

    currentWorldId = nextId
    activeWorld.dispose()
    if (chairlift) {
      chairlift.dispose()
      chairlift = null
    }
    if (coinRings) {
      coinRings.dispose()
      coinRings = null
    }
    if (lineArtTerrain) {
      lineArtTerrain.dispose()
    }

    if (currentWorldId === 'roldanillo') {
      activeWorld = new RoldanilloMountain(scene)
      coinRings = new CoinRings(scene, activeWorld)
      hud.setWorldName('🇨🇴 Andes')
      hud.setTotalCoins(coinRings.totalCoins)
      sim.setWing('paraglider')
      hud.setWingLabel(getWingLabel('paraglider'))
    } else if (currentWorldId === 'whistler') {
      const wm = new WhistlerMountain(scene)
      chairlift = new ChairliftSystem(scene, wm)
      coinRings = new CoinRings(scene, wm)
      activeWorld = wm
      hud.setWorldName('🇨🇦 Whistler')
      hud.setTotalCoins(coinRings.totalCoins)
      sim.setWing('speedwing')
      hud.setWingLabel(getWingLabel('speedwing'))
    } else {
      activeWorld = new HimalayasMountain(scene)
      coinRings = new CoinRings(scene, activeWorld)
      hud.setWorldName('🇳🇵 Himalayas')
      hud.setTotalCoins(coinRings.totalCoins)
      sim.setWing('speedwing')
      hud.setWingLabel(getWingLabel('speedwing'))
    }

    if (fluidSplats) {
      fluidSplats.dispose()
    }
    fluidSplats = new ToroidalFluidSplatSystem(
      scene,
      () => activeWorld.thermals || [],
      (x, z) => activeWorld.sampleHeight(x, z),
    )
    ;(window as any).fluidSplats = fluidSplats

    lineArtTerrain = new LineArtTerrain(scene, (activeWorld as any).terrainMesh, currentWorldId)
    sky.applyWorld(currentWorldId)
    thermalVortex.setThermals(activeWorld.thermals || [])
    gaggle.setThermals(activeWorld.thermals || [])
    trackedPlayer.setFlight(TRACKED_FLIGHTS[currentWorldId])
    applyLiveWeather(currentWorldId)

    sim.world = activeWorld
    ;(window as any).mountain = activeWorld
    relaunchFlight()
  }

  const cycleCamera = () => {
    const v = actionCam.cycleVantage()
    const label =
      v === 'chase-360'
        ? '🎥 FORWARD DRIVER'
        : v === 'shoulder-chase'
        ? '🎥 OVER-SHOULDER'
        : v === 'pilot-fpv'
        ? '🎥 COCKPIT FPV'
        : v === 'front-selfie'
        ? '🎥 ACTION SELFIE'
        : '🎥 CINEMATIC TRAIL'
    hud.setWeatherInfo(label)
  }

  hud.setOnStart(startFlight)
  hud.setOnRelaunch(relaunchFlight)
  hud.setOnCycleCamera(cycleCamera)
  hud.setOnCycleWorld(() => switchWorld())
  hud.setOnToggleGhost(() => {
    trackedPlayer.toggleGhost()
    trackedPlayer.toggleRibbon()
  })
  hud.setOnCalibrateNeutral(() => {
    inputManager.calibrateNeutral()
    hud.setWeatherInfo('⚖️ Neutral Calibrated')
  })
  hud.setOnPullA((active) => {
    inputManager.setPullingA(active)
  })
  hud.setOnPullB((active) => {
    inputManager.setPullingB(active)
  })

  const cycleLnStyle = () => {
    const pal = lnStyle.cycleStyle()
    hud.setIrGogglesState(lnStyle.isIrGoggles)
    hud.setLnStyleLabel(pal.shortLabel)
  }
  hud.setOnCycleLnStyle(cycleLnStyle)

  const toggleIrGoggles = () => {
    const isNowIr = lnStyle.toggleIrGoggles()
    hud.setIrGogglesState(isNowIr)
    hud.setLnStyleLabel(lnStyle.palette.shortLabel)
  }
  hud.setOnToggleIrGoggles(toggleIrGoggles)

  inputManager.onCycleVantage = cycleCamera

  // Canvas focus support
  canvas.tabIndex = 1

  // Global keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (!hasStarted) {
      startFlight()
    }

    if (e.code === 'KeyM') {
      switchWorld()
    } else if (e.code === 'KeyL') {
      cycleLnStyle()
    } else if (e.code === 'KeyI') {
      toggleIrGoggles()
    } else if (e.code === 'KeyP') {
      trackedPlayer.toggleGhost()
      trackedPlayer.toggleRibbon()
    } else if (e.code === 'KeyZ') {
      inputManager.calibrateNeutral()
      hud.setWeatherInfo('⚖️ Neutral Calibrated')
    } else if (e.code === 'KeyH') {
      hud.toggleRisersGuide()
    } else if (e.code === 'KeyK') {
      toggleWing()
    } else if (e.code === 'KeyO') {
      const next = inputManager.cycleControlMode()
      hud.setControlMode(next)
    } else if (e.code === 'KeyR' || (e.code === 'Space' && sim.isCrashed)) {
      relaunchFlight()
    }
  })

  // Global click / tap / pointer to start
  const handleGlobalStart = (e: Event) => {
    if (!hasStarted) {
      const target = e.target as HTMLElement
      if (target?.closest('#btn-world, #btn-camera, #btn-ghost, #btn-gyro, #btn-ln-style, #btn-ir-goggles, #btn-risers-guide, #btn-wing, #btn-ctrl-mode')) return
      startFlight()
    }
  }

  window.addEventListener('pointerdown', handleGlobalStart)
  window.addEventListener('touchstart', handleGlobalStart, { passive: true })
  window.addEventListener('click', handleGlobalStart)

  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      engine.resize()
      inputManager.calibrateNeutral()
    }, 150)
  })

  // Wheel / trackpad gesture start
  window.addEventListener('wheel', () => {
    if (!hasStarted) {
      startFlight()
    }
  }, { passive: true })

  ;(window as any).relaunchFlight = relaunchFlight
  ;(window as any).startFlight = startFlight
  ;(window as any).sim = sim
  ;(window as any).inputManager = inputManager

  // 5. Main Simulation & Render Loop
  engine.runRenderLoop(() => {
    const dt = engine.getDeltaTime() * 0.001 // seconds

    if (hasStarted) {
      // Step A: Update Inputs (Touch, Trackpad, Keys with Aerodynamic Resistance & Haptics)
      inputManager.update(
        dt,
        sim.telemetry.leftBrakeForceN,
        sim.telemetry.rightBrakeForceN,
        sim.telemetry.isStalled,
        sim.telemetry.stallWarning,
        sim.telemetry.gForce,
        sim.isFootDragging,
        sim.atmosphere.thermalUpdraftMps,
      )
      sim.controls = { ...inputManager.controls }

      // Step B: Sample Atmosphere (Thermals & Ridge Lift with pulse cycles & wind-drift lockstep)
      const updraft = activeWorld.sampleUpdraft(
        sim.pilot.position.x,
        sim.pilot.position.y,
        sim.pilot.position.z,
        sim.telemetry.flightDurationSeconds,
        sim.atmosphere.windVector,
      )
      sim.atmosphere.thermalUpdraftMps = updraft

      // Step C: Step 2-Body Pendulum Physics
      sim.step(dt, (x, z) => activeWorld.sampleHeight(x, z))

      // Check crash condition
      if (sim.isCrashed) {
        hud.showRelaunch('TOUCHDOWN', 'Tap screen or press Space to fly again')
      }

      // Step D: Detect Emergent Acrobatics & Tricks
      const trickState = trickDetector.update(sim, dt)

      // Step E: Coin Ring Collection (Active in Whistler)
      if (coinRings) {
        const { ringCollected, points } = coinRings.update(
          new Vector3(sim.pilot.position.x, sim.pilot.position.y, sim.pilot.position.z),
          dt,
        )
        if (ringCollected) {
          sim.telemetry.score += points
          sim.telemetry.ringsCollected++
          soundscape.playCoinSound()
        }
      }

      // Step F: Update Soundscape with Aeolian Singing Lines, Flutter Bass, Stall Buffet, Electrostatic RF Crackle, and 2-Stroke Paramotor
      soundscape.update(
        sim.telemetry.airspeedKmh,
        sim.telemetry.verticalSpeedMps,
        sim.telemetry.gForce,
        sim.telemetry.lineTensionNewtons,
        sim.telemetry.leftBrakeForceN,
        sim.telemetry.rightBrakeForceN,
        sim.telemetry.stallWarning,
        sim.telemetry.isStalled,
        dt,
        sim.telemetry.staticChargeField ?? 0,
        sim.telemetry.engineRpm ?? 0,
        sim.telemetry.throttlePercent ?? 0,
        sim.currentWingType,
      )

      // Step G: Update Visual Rig & Action Camera with AR Viewport Twist & Snap Dynamics
      rig.update(sim, actionCam.vantage)
      actionCam.update(
        sim,
        dt,
        inputManager.tiltParallaxRoll,
        inputManager.tiltParallaxPitch,
        inputManager.instantTwistRad,
        inputManager.snapIntensity,
      )

      // Step G2: Update Aerodynamic Wind Streaks & 65km XC Mountain Mission
      windStreaks.update(sim, dt)
      const xcStatus = xcMission.update(sim, dt)
      hud.updateXCTask(xcStatus)

      // Step H: Update Atmospheric Environment & Multi-Glider Gaggle Systems
      sky.update(new Vector3(sim.pilot.position.x, sim.pilot.position.y, sim.pilot.position.z))
      lineArtTerrain.update(actionCam.camera.position)
      thermalVortex.update(dt, sim.atmosphere.windVector, sim.pilot.position)
      fluidSplats.update(dt, sim.atmosphere.windVector, sim.telemetry.staticChargeField ?? 0)
      gaggle.update(dt, sim.atmosphere.windVector)
      trackedPlayer.update(dt)

      // Step I: Update Minimal HUD with Pseudo-Haptic Lag & Tension Tethers
      hud.update(
        sim.telemetry,
        sim.controls,
        trickState,
        inputManager.leftLagFrac,
        inputManager.rightLagFrac,
        inputManager.leftThumbYFrac,
        inputManager.rightThumbYFrac,
        inputManager.activeTouchVisuals,
        inputManager.controlMode,
      )

      // Step J: Radiometric Infrared Spot Temperature (FLIR thermal vision)
      if (lnStyle.isIrGoggles) {
        const px = sim.pilot.position.x
        const py = sim.pilot.position.y
        const pz = sim.pilot.position.z
        const groundY = activeWorld.sampleHeight(px, pz)
        const agl = Math.max(0, py - groundY)
        const lapse = (py / 1000) * 8.0 // 8.0°C adiabatic lapse per km
        const ambient = currentAirTempC - lapse

        // Ground thermal triggers (radiant hotspots modeled in TopographicLineMaterial)
        const distSolar = Math.hypot(px - (-500), pz - 2400)
        const solarBoost = Math.max(0, 1 - distSolar / 360) * 16.0

        const distRoofs = Math.hypot(px - 300, pz - 1400)
        const roofsBoost = Math.max(0, 1 - distRoofs / 280) * 12.0

        const distRiver = Math.abs(px - 1200)
        const riverCool = Math.max(0, 1 - distRiver / 220) * 5.0

        const groundRad = (solarBoost + roofsBoost - riverCool) * Math.max(0, 1 - agl / 1200)
        const updraft = sim.atmosphere.thermalUpdraftMps
        const tempAnom = sim.telemetry.thermalTempAnomalyC ?? 0
        const charge = sim.telemetry.staticChargeField ?? 0

        const spotTemp = ambient + groundRad + tempAnom

        let status = 'AMBIENT AIR'
        if (charge > 0.42) {
          status = '⚡ IONIZED SHEAR MARGIN'
        } else if (tempAnom > 3.2 || updraft > 3.0) {
          status = 'HOT THERMAL CORE (+54°C)'
        } else if (tempAnom > 1.0 || updraft > 0.8) {
          status = 'CONVECTIVE CAROUSEL (+42°C)'
        } else if (tempAnom < -0.8 || updraft < -1.5) {
          status = 'COLD TAIL SINK (-4°C)'
        } else if (solarBoost > 3.0) {
          status = 'SOLAR FARM TRIGGER'
        } else if (roofsBoost > 3.0) {
          status = 'TIN ROOF TRIGGER'
        } else if (riverCool > 2.0) {
          status = 'COOL WATER BASIN'
        }

        hud.updateIrSpotTemp(spotTemp, status)
      }
    } else {
      // Pre-launch preview state
      rig.update(sim, actionCam.vantage)
      actionCam.update(sim, dt)
      sky.update(new Vector3(sim.pilot.position.x, sim.pilot.position.y, sim.pilot.position.z))
      lineArtTerrain.update(actionCam.camera.position)
      thermalVortex.update(dt, sim.atmosphere.windVector, sim.pilot.position)
      fluidSplats.update(dt, sim.atmosphere.windVector, 0)
      gaggle.update(dt, sim.atmosphere.windVector)
      trackedPlayer.update(dt)

      if (lnStyle.isIrGoggles) {
        hud.updateIrSpotTemp(currentAirTempC, 'LAUNCH SITE AMBIENT')
      }
    }

    scene.render()
  })

  // Handle Resize
  window.addEventListener('resize', () => {
    engine.resize()
  })
}

const safeInit = () => {
  try {
    initApp()
  } catch (err: any) {
    console.error('Fatal initialization error:', err)
    const errBox = document.createElement('div')
    errBox.style.cssText =
      'position:fixed;top:10px;left:10px;right:10px;background:rgba(220,38,38,0.92);color:white;padding:16px;border-radius:12px;z-index:999999;font-family:sans-serif;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.4);'
    errBox.innerText = `Startup error: ${err?.message || err}`
    document.body.appendChild(errBox)
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', safeInit)
} else {
  safeInit()
}
