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
import type { WingKind } from './physics/types'
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
import {
  GoogleEarthWorld,
  GLOBAL_EARTH_SITES,
  setConfiguredGoogleMapsApiKey,
  type EarthSiteSpec,
} from './world/GoogleEarthWorld'
import { GodsEyeGlobeEngine } from './world/GodsEyeGlobeEngine'
import { ChairliftSystem } from './world/ChairliftSystem'
import { CoinRings } from './world/CoinRings'
import { flightObjective, TORONTO_POWER_WING, TORONTO_WINGSUIT_COLUMN, torontoWingsuitPickup } from './world/TorontoCourse'
import type { FlightWorld, WorldId } from './world/types'
import { MobileInputManager } from './input/MobileInputManager'
import { FlightSoundscape } from './audio/FlightSoundscape'
import { FlightHUD } from './ui/FlightHUD'
import { LineArtTerrain } from './rendering/LineArtTerrain'
import { LnStyleManager } from './rendering/LnStyleManager'
import { WindStreakSystem } from './rendering/WindStreakSystem'
import { XCMissionSystem } from './simulation/XCMissionSystem'
import { ToroidalFluidSplatSystem } from './rendering/ToroidalFluidSplatSystem'
import { GliderFlock } from './world/GliderFlock'
import { RagdollCrashSystem } from './rendering/RagdollCrashSystem'
import { WingtipTrailSystem } from './rendering/WingtipTrailSystem'
import { FlightReplayBuffer } from './rendering/FlightReplayBuffer'
import { PilotWardrobe, PILOT_SKINS, WORLD_REWARDS } from './progression/PilotWardrobe'
import { SupplyDrop } from './world/SupplyDrop'
import { PowerWingPickup } from './world/PowerWingPickup'
import { WingsuitPickup } from './world/WingsuitPickup'

function initApp() {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  if (!canvas) throw new Error('Canvas #renderCanvas not found')

  // 1. Initialize Babylon.js Engine & Scene (with alpha: true + iOS-safe 1x scaling over GodsEyeGlobeEngine!)
  const engine = new Engine(canvas, true, {
    antialias: false,
    adaptToDeviceRatio: false,
    powerPreference: 'default',
    stencil: false,
    alpha: true,
    premultipliedAlpha: false,
  })
  engine.setHardwareScalingLevel(1.0)

  const scene = new Scene(engine)
  const globeEngine = GodsEyeGlobeEngine.getInstance()
  ;(window as any).globeEngine = globeEngine

  // 1. Atmospheric Sky & Distance Horizon Fog
  const sky = new AtmosphericSky(scene, 'toronto')
  sky.setGlobeOverlayMode(true)

  // Sun & Ambient Lights
  const ambientLight = new HemisphericLight('ambient-sky', new Vector3(0.2, 1.0, 0.1), scene)
  ambientLight.diffuse = new Color3(0.85, 0.92, 1.0)
  ambientLight.groundColor = new Color3(0.25, 0.28, 0.22)
  ambientLight.intensity = 1.35

  const sunLight = new DirectionalLight('sun-dir', new Vector3(-0.45, -0.85, 0.28), scene)
  sunLight.diffuse = new Color3(1.0, 0.96, 0.88) // Crisp alpine sun
  sunLight.intensity = 2.6

  // 2. Active World Setup: Toronto is the first city course. CN Tower, then the downtown glass.
  let currentWorldId: WorldId = 'toronto'
  let chairlift: ChairliftSystem | null = null
  const initEarth = new GoogleEarthWorld(scene, GLOBAL_EARTH_SITES.toronto)
  let activeWorld: FlightWorld = initEarth
  let coinRings: CoinRings | null = new CoinRings(scene, initEarth)

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

  // 4. Multi-Glider Thermal Gaggle & Living AI Paraglider Flock
  const gaggle = new ThermalGaggleSystem(scene)
  gaggle.setThermals(activeWorld.thermals || [])
  let gliderFlock = new GliderFlock(scene, activeWorld, activeWorld.launchPosition)
  ;(window as any).gliderFlock = gliderFlock

  // 5. Real Competition Tracked GPS Flights & Ghost Pilot
  const trackedPlayer = new TrackedFlightPlayer(scene)
  trackedPlayer.setFlight((TRACKED_FLIGHTS as any)[currentWorldId] || TRACKED_FLIGHTS.whistler)

  // 5b. 65km XC Mountain Mission (Roldanillo to Lago Calima) & Aerodynamic Wind Streaks
  const xcMission = new XCMissionSystem(scene)
  const windStreaks = new WindStreakSystem(scene)
  ;(window as any).xcMission = xcMission
  ;(window as any).windStreaks = windStreaks

  // 6. Build Flight Core, Camera, and Rig
  const lPos = activeWorld.launchPosition
  const lHeading = activeWorld.launchHeadingDeg
  const sim = new ParagliderSimulation(lPos.y, lHeading, 'paraglider', { x: lPos.x, y: lPos.y, z: lPos.z })
  sim.setWing('paraglider')
  sim.world = activeWorld
  ;(window as any).sim = sim
  ;(window as any).scene = scene
  const rig = new ParagliderRig(scene)
  const wardrobe = new PilotWardrobe()
  rig.applySkin(wardrobe.equippedSkin())
  const supplyDrop = new SupplyDrop(scene)
  const powerWing = new PowerWingPickup(scene)
  const wingsuitPickup = new WingsuitPickup(scene)
  let wingsuitInHand = false
  const POWER_WING_KEY = 'ptw-powered-wing'
  let ownsPowerWing = false
  try {
    ownsPowerWing = localStorage.getItem(POWER_WING_KEY) === '1'
  } catch {
    ownsPowerWing = false
  }
  ;(window as any).rig = rig
  const ragdollCrash = new RagdollCrashSystem(scene)
  ;(window as any).ragdollCrash = ragdollCrash
  const wingtipTrails = new WingtipTrailSystem(scene)
  ;(window as any).wingtipTrails = wingtipTrails
  const replayBuffer = new FlightReplayBuffer()
  const replayLook = new Vector3()
  ;(window as any).replayBuffer = replayBuffer
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
  hud.setWorldName('🇧🇷 Rio 3D')
  hud.setTotalCoins(coinRings.totalCoins)
  initEarth.onTerrainUpdated(() => {
    if (coinRings) coinRings.reanchorToTerrain(initEarth)
    if (initEarth.statusMessage) hud.setWeatherInfo(initEarth.statusMessage)
    if (!hasStarted && activeWorld === initEarth) {
      const p = initEarth.launchPosition
      sim.reset(p.y, initEarth.launchHeadingDeg, { x: p.x, y: p.y, z: p.z })
      actionCam.snap()
    }
    placeWingsuitItem()
  })
  const getWingLabel = (w: WingKind) => {
    if (w === 'wingsuit') return 'SUIT'
    if (w === 'paraglider') return 'XC 10:1'
    if (w === 'speedwing') return 'SPEED 5:1'
    return 'POWER'
  }
  const getWingIcon = (w: WingKind) => {
    if (w === 'wingsuit') return '🪽'
    if (w === 'paramotor') return '⚡'
    if (w === 'speedwing') return '💨'
    return '🪂'
  }
  const wingBlurb = (w: WingKind) => {
    if (w === 'wingsuit') return '🪽 Wingsuit. Always descending. Look down to dive. Drag the rail down to pull the chute.'
    if (w === 'paraglider') {
      if (currentWorldId === 'toronto' && !wingsuitInHand) {
        return '🪂 Chute open. Middle holds altitude. Up is the hydrogen jet. Down slows you. The wingsuit is at the top of the harbour elevator.'
      }
      return '🪂 Chute open. Middle holds altitude. Up is the hydrogen jet. Down slows you. Climb, then the wing button drops the suit.'
    }
    if (w === 'speedwing') return '💨 Speedwing on. Faster trim, steeper dives.'
    return '⚡ Powered wing. Drag up to rip. All the way up is the speed of sound. Drag down and a sock opens behind you.'
  }
  hud.setWingLabel(getWingLabel(sim.currentWingType), getWingIcon(sim.currentWingType))
  hud.setControlMode(inputManager.controlMode)
  hud.setThrottleVisible(true)
  inputManager.isCruiseLocked = false
  inputManager.setTargetThrottle(0.5)
  inputManager.controls.throttle = 0.5
  hud.setThrottlePosition(0.5)

  // The suit is the drop. The chute is the map. Cruise only exists on the chute,
  // so a locked rail can never sit above the chute-pull.
  const SUIT_DROP_AGL_M = 200
  const equipWing = (next: WingKind, announce: boolean) => {
    const jetWing = next === 'paraglider' || next === 'paramotor'
    inputManager.cruiseAllowed = jetWing
    inputManager.isCruiseLocked = false
    if (next === 'paraglider' || next === 'wingsuit' || next === 'speedwing') {
      // Opening the chute at the bottom of the rail would arrive with the sock out.
      // Dropping into the suit with the rail buried would pull the chute again.
      inputManager.setTargetThrottle(0.5)
      inputManager.controls.throttle = 0.5
    }
    sim.setWing(next)
    hud.setWingLabel(getWingLabel(next), getWingIcon(next))
    hud.setThrottlePosition(inputManager.targetThrottle)
    if (announce) hud.setWeatherInfo(wingBlurb(next))
  }

  const toggleWing = () => {
    const cur = sim.currentWingType
    if (cur === 'wingsuit') {
      equipWing('speedwing', true)
      return
    }
    if (cur === 'speedwing') {
      equipWing('paraglider', true)
      return
    }
    // The suit is the pickup at the top of the harbour column. Until then the button cannot invent one.
    if (!wingsuitInHand) {
      hud.setWeatherInfo('🪽 The wingsuit is at the top of the harbour elevator.')
      return
    }
    // One press from the chute drops the suit, once the drop is worth it.
    if (sim.groundClearanceMeters < SUIT_DROP_AGL_M) {
      hud.setWeatherInfo(`🪽 Too low for the suit. Climb past ${SUIT_DROP_AGL_M} m. You are at ${Math.round(sim.groundClearanceMeters)} m.`)
      return
    }
    equipWing('wingsuit', true)
  }
  hud.setOnCycleWing(toggleWing)
  inputManager.onToggleWing = toggleWing

  const cyclePilotMass = () => {
    const newMass = sim.cyclePilotMass()
    hud.setWeatherInfo(`⚖️ Pilot Mass: ${newMass}kg (${sim.telemetry.wingLoadingKgPerM2 ?? 4.9} kg/m² wing loading)`)
  }
  hud.setOnCyclePilotMass(cyclePilotMass)

  hud.setOnThrottle((value) => {
    inputManager.isCruiseLocked = false
    inputManager.setTargetThrottle(value)
  })

  hud.setOnThrottleHold((holding) => {
    if (!holding) return
    inputManager.setTargetThrottle(1.0)
  })

  hud.setOnToggleCruise(() => {
    if (!inputManager.cruiseAllowed) {
      hud.setWeatherInfo('Cruise is on the chute. Drag the rail down to pull it.')
      return
    }
    const locked = inputManager.toggleCruiseLock()
    if (locked) {
      inputManager.setTargetThrottle(0.675)
      inputManager.controls.throttle = Math.max(inputManager.controls.throttle ?? 0, 0.675)
      hud.setWeatherInfo('🔒 Cruise burn locked')
    } else {
      inputManager.setTargetThrottle(0.5)
      if ((inputManager.controls.throttle ?? 0) < 0.5) inputManager.controls.throttle = 0.5
      hud.setWeatherInfo('🔓 Cruise Disengaged')
    }
  })

  hud.setOnCycleControlMode(() => {
    const next = inputManager.cycleControlMode()
    hud.setControlMode(next)
  })
  inputManager.onControlModeChange = (mode) => {
    hud.setControlMode(mode)
  }
  inputManager.onTriggerLoop = (dir) => {
    sim.triggerLoop(dir ?? 1)
  }
  inputManager.onTriggerRoll = (dir) => {
    sim.triggerRoll(dir)
  }
  hud.setOnTriggerFlip(() => {
    sim.triggerLoop()
  })
  hud.setOnTriggerRoll((dir) => {
    sim.triggerRoll(dir)
  })
  hud.setOnBailoutCollapse((active) => {
    inputManager.setBailoutCollapse(active)
  })

  xcMission.onWaypointCompleted = (_wp, _nextWp) => {
    soundscape.playCoinSound()
  }
  xcMission.onMissionFinished = () => {
    soundscape.playCoinSound()
  }

  let currentAirTempC = 24

  // Live Wind & Atmosphere Connection via Open-Meteo
  const applyLiveWeather = async (worldId: WorldId, customLat?: number, customLon?: number) => {
    const coords: Record<string, { lat: number; lon: number; name: string }> = {
      roldanillo: { lat: 4.414, lon: -76.155, name: 'Cauca Valley' },
      whistler: { lat: 50.116, lon: -122.957, name: 'Whistler Peak' },
      himalayas: { lat: 28.209, lon: 83.985, name: 'Pokhara Ridge' },
      sf: { lat: 37.8199, lon: -122.4783, name: 'Golden Gate Bridge' },
      rio: { lat: -22.9519, lon: -43.2105, name: 'Corcovado Rio' },
      manhattan: { lat: 40.7136, lon: -74.0148, name: 'Downtown NYC' },
      paris: { lat: 48.8604, lon: 2.2912, name: 'Paris' },
      egypt: { lat: 29.9825, lon: 31.1375, name: 'Giza' },
      rome: { lat: 41.8894, lon: 12.4962, name: 'Rome' },
      london: { lat: 51.5032, lon: -0.0725, name: 'London' },
      toronto: { lat: 43.6408, lon: -79.3905, name: 'Toronto' },
      matterhorn: { lat: 45.9766, lon: 7.6585, name: 'Matterhorn Zermatt' },
      chamonix: { lat: 45.8793, lon: 6.8874, name: 'Aiguille du Midi' },
      yosemite: { lat: 37.7459, lon: -119.5332, name: 'Half Dome' },
      dubai: { lat: 25.1972, lon: 55.2744, name: 'Downtown Dubai' },
    }
    const loc =
      customLat !== undefined && customLon !== undefined
        ? { lat: customLat, lon: customLon, name: 'Custom Earth GPS' }
        : coords[worldId] || coords.roldanillo

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
      const defaults: Record<string, { speed: number; deg: number; card: string; temp: number }> = {
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
  let wasCrashedLastFrame = false
  let crashRespawn: { x: number; z: number; heading: number } | null = null

  const clearanceAbove = (x: number, z: number): number => {
    let y = activeWorld.sampleHeight(x, z) + 55
    const obstacles = activeWorld.obstacles
    if (obstacles) {
      for (const obs of obstacles) {
        const halfW = (obs.halfWidth ?? obs.radius) + 12
        const halfD = (obs.halfDepth ?? obs.radius) + 12
        if (Math.abs(x - obs.x) <= halfW && Math.abs(z - obs.z) <= halfD) {
          y = Math.max(y, obs.yMax + 42)
        }
      }
    }
    const surface = GodsEyeGlobeEngine.getInstance().samplePhotorealSurfaceHeightMsl(x, z)
    if (surface !== null) y = Math.max(y, surface + 42)
    return y
  }

  const startFlight = async () => {
    // Must run before the gyro prompt. A context created after that await stays silent.
    soundscape.unlock()
    if (hasStarted) return
    hasStarted = true
    canvas.focus()
    hud.hidePortraitGuard()
    hud.hideRelaunch()

    const pos = activeWorld.launchPosition
    const heading = activeWorld.launchHeadingDeg
    sim.reset(pos.y, heading, { x: pos.x, y: pos.y, z: pos.z })
    inputManager.isCruiseLocked = false
    inputManager.setTargetThrottle(0.5)
    inputManager.controls.throttle = 0.5
    wingsuitInHand = currentWorldId !== 'toronto'
    equipWing('paraglider', false)
    placeWingsuitItem()
    actionCam.snap()
    engine.resize()

    // Gyro permission request on user tap/click
    try {
      await inputManager.requestGyroPermission()
    } catch {}

    inputManager.calibrateNeutral()
    inputManager.requestAutoCalibration()

    soundscape.unlock()
  }

  const relaunchFlight = (where: 'launch' | 'above-crash' = 'launch') => {
    const aboveCrash = where === 'above-crash' && crashRespawn !== null
    const heading = aboveCrash ? crashRespawn!.heading : activeWorld.launchHeadingDeg
    const pos = aboveCrash
      ? {
          x: crashRespawn!.x,
          y: clearanceAbove(crashRespawn!.x, crashRespawn!.z),
          z: crashRespawn!.z,
        }
      : activeWorld.launchPosition
    if (!aboveCrash) crashRespawn = null
    inputManager.setBailoutCollapse(false)
    ragdollCrash.reset()
    wingtipTrails.reset()
    replayBuffer.stopReplay()
    actionCam.replayFocus = null
    actionCam.setCrashVantage('orbit')
    hud.setCrashCamLabel('orbit')
    rig.setPilotVisible(true)
    wasCrashedLastFrame = false
    sim.reset(pos.y, heading, { x: pos.x, y: pos.y, z: pos.z })
    inputManager.isCruiseLocked = false
    inputManager.setTargetThrottle(0.5)
    inputManager.controls.throttle = 0.5
    wingsuitInHand = currentWorldId !== 'toronto'
    equipWing('paraglider', false)
    placeWingsuitItem()
    if (coinRings) coinRings.reset()
    trickDetector.reset()
    xcMission.resetTask()
    if (gliderFlock) {
      gliderFlock.dispose()
      gliderFlock = new GliderFlock(scene, activeWorld, pos)
      ;(window as any).gliderFlock = gliderFlock
    }
    actionCam.snap()
    hud.hideRelaunch()
    hud.hideWasted()
    inputManager.requestAutoCalibration()
  }

  const switchWorld = (targetId?: WorldId, customSpec?: EarthSiteSpec) => {
    const worldIds: WorldId[] = [
      'manhattan',
      'rio',
      'paris',
      'egypt',
      'rome',
      'london',
      'toronto',
      'sf',
      'dubai',
      'matterhorn',
      'chamonix',
      'yosemite',
      'whistler',
      'roldanillo',
      'himalayas',
    ]
    const nextId = targetId ?? worldIds[(worldIds.indexOf(currentWorldId) + 1) % worldIds.length]
    if (nextId === currentWorldId && !customSpec) return

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
    if (gliderFlock) {
      gliderFlock.dispose()
    }

    if (currentWorldId === 'roldanillo') {
      globeEngine.setActive(false)
      sky.setGlobeOverlayMode(false)
      activeWorld = new RoldanilloMountain(scene)
      coinRings = new CoinRings(scene, activeWorld)
      hud.setWorldName('🇨🇴 Andes')
      hud.setTotalCoins(coinRings.totalCoins)
      sim.setWing(sim.currentWingType)
      hud.setWingLabel(getWingLabel(sim.currentWingType), getWingIcon(sim.currentWingType))
    } else if (currentWorldId === 'whistler') {
      globeEngine.setActive(false)
      sky.setGlobeOverlayMode(false)
      const wm = new WhistlerMountain(scene)
      chairlift = new ChairliftSystem(scene, wm)
      coinRings = new CoinRings(scene, wm)
      activeWorld = wm
      hud.setWorldName('🇨🇦 Whistler')
      hud.setTotalCoins(coinRings.totalCoins)
      sim.setWing(sim.currentWingType)
      hud.setWingLabel(getWingLabel(sim.currentWingType), getWingIcon(sim.currentWingType))
    } else if (currentWorldId === 'himalayas') {
      globeEngine.setActive(false)
      sky.setGlobeOverlayMode(false)
      activeWorld = new HimalayasMountain(scene)
      coinRings = new CoinRings(scene, activeWorld)
      hud.setWorldName('🇳🇵 Himalayas')
      hud.setTotalCoins(coinRings.totalCoins)
      sim.setWing(sim.currentWingType)
      hud.setWingLabel(getWingLabel(sim.currentWingType), getWingIcon(sim.currentWingType))
    } else {
      // 🌍 Real-World God's Eye View 3D Globe (CesiumJS Keyless Terrain + Esri Satellite + OpenFreeMap 3D)
      sky.setGlobeOverlayMode(true)
      const spec = customSpec || GLOBAL_EARTH_SITES[currentWorldId] || GLOBAL_EARTH_SITES.rio
      const earthWorld = new GoogleEarthWorld(scene, spec, (statusMsg) => {
        hud.setWeatherInfo(statusMsg)
      })
      const cr = new CoinRings(scene, earthWorld)
      earthWorld.onTerrainUpdated(() => {
        cr.reanchorToTerrain(earthWorld)
        placeSupplyDrop()
        placePowerWing()
        placeWingsuitItem()
        if (activeWorld === earthWorld && sim.telemetry.flightDurationSeconds < 1.5) {
          const p = earthWorld.launchPosition
          sim.reset(p.y, earthWorld.launchHeadingDeg, { x: p.x, y: p.y, z: p.z })
          actionCam.snap()
        }
      })
      coinRings = cr
      activeWorld = earthWorld
      hud.setWorldName(spec.shortLabel)
      hud.setTotalCoins(coinRings.totalCoins)
      sim.setWing(sim.currentWingType)
      hud.setWingLabel(getWingLabel(sim.currentWingType), getWingIcon(sim.currentWingType))
    }

    gliderFlock = new GliderFlock(scene, activeWorld, activeWorld.launchPosition)
    ;(window as any).gliderFlock = gliderFlock

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
    trackedPlayer.setFlight((TRACKED_FLIGHTS as any)[currentWorldId] || TRACKED_FLIGHTS.whistler)
    if (customSpec) {
      applyLiveWeather(currentWorldId, customSpec.lat, customSpec.lon)
    } else {
      applyLiveWeather(currentWorldId)
    }

    sim.world = activeWorld
    ;(window as any).mountain = activeWorld
    placeSupplyDrop()
    placePowerWing()
    relaunchFlight()
  }

  const syncLocker = () => {
    const equipped = wardrobe.equippedSkin()
    hud.setSkinLabel(equipped.name)
    hud.renderLocker({
      skins: PILOT_SKINS.map((skin) => ({
        id: skin.id,
        name: skin.name,
        blurb: skin.blurb,
        priceLabel: skin.priceLabel,
        owned: wardrobe.owns(skin.id),
        equipped: skin.id === wardrobe.equippedId,
      })),
      souvenirs: wardrobe.souvenirs.map((item) => ({ name: item.name })),
    })
  }

  const placeSupplyDrop = () => {
    if (!WORLD_REWARDS[currentWorldId] || wardrobe.hasCollected(currentWorldId)) {
      supplyDrop.hide()
      return
    }
    const heading = (activeWorld.launchHeadingDeg * Math.PI) / 180
    const origin = activeWorld.launchPosition
    const ahead = 120
    const x = origin.x + Math.sin(heading) * ahead
    const z = origin.z + Math.cos(heading) * ahead
    supplyDrop.place(x, origin.y, z)
  }

  function placeWingsuitItem() {
    if (wingsuitInHand || currentWorldId !== 'toronto') {
      wingsuitPickup.hide()
      return
    }
    const col = TORONTO_WINGSUIT_COLUMN
    const spot = torontoWingsuitPickup(activeWorld.sampleHeight(col.x, col.z))
    wingsuitPickup.place(spot.x, spot.y, spot.z)
  }
  placeWingsuitItem()

  const placePowerWing = () => {
    if (ownsPowerWing || currentWorldId !== 'toronto') {
      powerWing.hide()
      return
    }
    powerWing.place(TORONTO_POWER_WING.x, TORONTO_POWER_WING.y, TORONTO_POWER_WING.z)
  }

  const grantPowerWing = () => {
    ownsPowerWing = true
    try {
      localStorage.setItem(POWER_WING_KEY, '1')
    } catch {
      /* private mode still keeps it for this flight */
    }
    powerWing.hide()
    soundscape.playCoinSound()
    hud.setWeatherInfo('⚡ The hydrogen jet is on the chute. Rail up to rip, rail down to slow.')
  }

  const grantWingsuit = () => {
    wingsuitInHand = true
    wingsuitPickup.hide()
    soundscape.playCoinSound()
    equipWing('wingsuit', true)
  }

  const cycleCamera = () => {
    const v = actionCam.cycleVantage()
    const label =
      v === 'chase-360'
        ? '🎥 CHASE 360'
        : v === 'orbit-360'
        ? '🔄 360° ORBIT CAM'
        : v === 'shoulder-chase'
        ? '🎥 OVER-SHOULDER'
        : v === 'pilot-fpv'
        ? '🎥 COCKPIT FPV'
        : v === 'front-selfie'
        ? '🎥 ACTION SELFIE'
        : '🎥 CINEMATIC TRAIL'
    hud.setWeatherInfo(label)
    const shortLabel =
      v === 'chase-360'
        ? 'Action 360'
        : v === 'orbit-360'
        ? 'Orbit 360'
        : v === 'shoulder-chase'
        ? 'Shoulder'
        : v === 'pilot-fpv'
        ? 'Cockpit FPV'
        : v === 'front-selfie'
        ? 'Selfie'
        : 'Wide Trail'
    hud.setCamVantageLabel(shortLabel)
  }

  hud.setOnCycleCamVantage(cycleCamera)
  hud.setOnCycleCrashCam(() => {
    const nextAngle = actionCam.cycleCrashVantage()
    hud.setCrashCamLabel(nextAngle)
  })
  hud.setOnReplayWipeout(() => {
    const started = replayBuffer.startReplay(0.35)
    if (started) {
      wingtipTrails.reset()
      rig.setPilotVisible(true)
      ragdollCrash.setVisible(false)
      hud.setWeatherInfo('⏪ Slow motion from the side. The pass, then the hit.')
    }
  })

  hud.setOnOpenLocker(syncLocker)
  hud.setOnSelectSkin((skinId) => {
    const skin = wardrobe.skinById(skinId)
    if (!skin) return
    if (!wardrobe.owns(skinId)) {
      const why = skin.priceLabel
        ? `${skin.name} is ${skin.priceLabel}. The shop is not open yet.`
        : `Fly the glowing ring to earn ${skin.name}.`
      hud.setWeatherInfo(why)
      return
    }
    const equipped = wardrobe.equip(skinId)
    if (!equipped) return
    rig.applySkin(equipped)
    wingtipTrails.setTrailColor(equipped.trailColor || null, equipped.emissiveTrail)
    syncLocker()
    hud.setWeatherInfo(`👕 Wearing ${equipped.name}`)
  })
  syncLocker()
  if (typeof (activeWorld as GoogleEarthWorld).onTerrainUpdated === 'function') {
    ;(activeWorld as GoogleEarthWorld).onTerrainUpdated(() => placeSupplyDrop())
  }
  placeSupplyDrop()
  placePowerWing()

  hud.setOnStart(startFlight)
  hud.setOnRelaunch(() => relaunchFlight('above-crash'))
  hud.setOnCycleCamera(cycleCamera)
  hud.setOnCycleWorld(() => switchWorld())
  hud.setOnSelectWorld((wId) => {
    switchWorld(wId as WorldId)
  })
  hud.setOnTeleportCustomGps((lat, lon, headingDeg, name) => {
    const customSpec: EarthSiteSpec = {
      id: 'custom-gps',
      name,
      shortLabel: `📍 ${name.slice(0, 12)}`,
      countryFlag: '📍',
      lat,
      lon,
      headingDeg,
      launchElevationM: 320,
      launchAglM: 320,
      verticalDropM: 280,
      archetype: 'urban-canyon',
      description: `Custom GPS (${lat.toFixed(4)}°, ${lon.toFixed(4)}°)`,
    }
    switchWorld('custom-gps', customSpec)
  })

  let earthDropName = 'Drop site'
  const rememberEarthName = (lat: number, lon: number) => {
    earthDropName = `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`
    hud.setEarthDropLabel(`${earthDropName}. Drop in, or wait for the place name.`)
    void globeEngine.reversePlace(lat, lon).then((place) => {
      if (!globeEngine.isPickingEarth()) return
      const current = globeEngine.getPickLatLon()
      if (!current || Math.abs(current.lat - lat) > 0.02 || Math.abs(current.lon - lon) > 0.02) return
      if (!place) return
      earthDropName = place
      hud.setEarthDropLabel(place)
    })
  }
  hud.setOnOpenEarthPick(() => {
    earthDropName = 'Drop site'
    hud.setEarthDropLabel('Drag to spin. Search or tap where you want to drop.')
    hud.setEarthDropVisible(true)
    globeEngine.beginWholeEarthPick(rememberEarthName)
  })
  hud.setOnEarthSearch((query) => {
    hud.setEarthDropLabel('Searching…')
    void globeEngine.searchPlace(query).then((hit) => {
      if (!globeEngine.isPickingEarth()) return
      if (!hit) {
        hud.setEarthDropLabel('No place found. Try a city or a street.')
        return
      }
      earthDropName = hit.name
      hud.setEarthDropLabel(hit.name)
      globeEngine.flyToPlace(hit.lat, hit.lon, 14000, false)
    })
  })
  hud.setOnEarthDrop(() => {
    const pick = globeEngine.getPickLatLon()
    if (!pick) {
      hud.setEarthDropLabel('Tap the planet first.')
      return
    }
    const headingDeg = globeEngine.getPickHeadingDeg()
    const sampled = globeEngine.sampleGlobeTerrainHeight(pick.lat, pick.lon)
    const launchElevationM =
      sampled !== null && Number.isFinite(sampled) ? Math.max(0, Math.round(sampled)) : 320
    const name = earthDropName
    const customSpec: EarthSiteSpec = {
      id: 'custom-gps',
      name,
      shortLabel: `📍 ${name.slice(0, 12)}`,
      countryFlag: '📍',
      lat: pick.lat,
      lon: pick.lon,
      headingDeg,
      launchElevationM,
      launchAglM: 480,
      verticalDropM: 40,
      archetype: 'urban-canyon',
      description: `Dropped in at ${pick.lat.toFixed(4)}°, ${pick.lon.toFixed(4)}°`,
    }
    globeEngine.endWholeEarthPick()
    hud.setEarthDropVisible(false)
    switchWorld('custom-gps', customSpec)
    void startFlight()
    hud.setWeatherInfo(`🪂 ${name}. Wingsuit from about 480 m. Pull the chute to roam.`)
  })
  hud.setOnEarthBack(() => {
    globeEngine.endWholeEarthPick()
    hud.setEarthDropVisible(false)
    hud.toggleWorldModal()
  })

  hud.setOnSaveGoogleApiKey((key) => {
    setConfiguredGoogleMapsApiKey(key)
    hud.setWeatherInfo(key ? '🔑 Google Maps 3D Key Saved — Reloading Map...' : '🔑 Google Maps Key Cleared')
    if (currentWorldId !== 'whistler' && currentWorldId !== 'roldanillo' && currentWorldId !== 'himalayas') {
      const spec = (activeWorld as any)?.site as EarthSiteSpec | undefined
      switchWorld(currentWorldId, spec)
    }
  })
  hud.setOnToggleGhost(() => {
    trackedPlayer.toggleGhost()
    trackedPlayer.toggleRibbon()
  })
  hud.setOnCalibrateNeutral(async () => {
    if (!inputManager.hasGyroPermission) {
      const ok = await inputManager.requestGyroPermission()
      if (ok) {
        hud.setWeatherInfo('🧭 Tilt Controls Active')
        return
      }
    }
    inputManager.calibrateNeutral(inputManager.phoneElevationDeg)
    hud.setWeatherInfo(`⚖️ Neutral Calibrated (${Math.round(inputManager.neutralElevationDeg)}°)`)
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
  const unlockAudio = () => soundscape.unlock()
  window.addEventListener('pointerdown', unlockAudio, { capture: true })
  window.addEventListener('touchend', unlockAudio, { capture: true })

  window.addEventListener('keydown', (e) => {
    unlockAudio()
    const keyTarget = e.target as HTMLElement | null
    if (
      globeEngine.isPickingEarth() ||
      keyTarget?.closest?.('input, textarea, #earth-drop-bar, #hud-world-modal')
    ) {
      return
    }
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
    } else if (e.code === 'KeyU') {
      cyclePilotMass()
    } else if (e.code === 'KeyC') {
      if (!inputManager.cruiseAllowed) {
        hud.setWeatherInfo('Cruise is on the chute. Drag the rail down to pull it.')
        return
      }
      const locked = inputManager.toggleCruiseLock()
      if (locked) {
        inputManager.setTargetThrottle(0.675)
        inputManager.controls.throttle = Math.max(inputManager.controls.throttle ?? 0, 0.675)
        hud.setWeatherInfo('🔒 Cruise burn locked')
      } else {
        inputManager.setTargetThrottle(0.5)
        if ((inputManager.controls.throttle ?? 0) < 0.5) inputManager.controls.throttle = 0.5
        hud.setWeatherInfo('🔓 Cruise Disengaged')
      }
    } else if (e.code === 'KeyO') {
      const next = inputManager.cycleControlMode()
      hud.setControlMode(next)
    } else if (e.code === 'KeyT') {
      const shown = rig.toggleSuspensionLines()
      hud.setWeatherInfo(shown ? '🧵 Suspension Lines: Visible' : '✨ Clean Screen: Lines Hidden')
    } else if (e.code === 'KeyX') {
      inputManager.setBailoutCollapse(!inputManager.isWingCollapsed)
    } else if (e.code === 'KeyR' || (e.code === 'Space' && sim.isCrashed)) {
      relaunchFlight(sim.isCrashed ? 'above-crash' : 'launch')
    }
  })

  // Global click to start flight & ensure motion permission
  const handleGlobalStart = async (e: Event) => {
    soundscape.unlock()
    if (globeEngine.isPickingEarth()) return
    const target = e.target as HTMLElement
    if (target?.closest('#btn-world, #btn-camera, #btn-ghost, #btn-gyro, #btn-ln-style, #btn-ir-goggles, #btn-risers-guide, #btn-wing, #btn-ctrl-mode, #btn-roll-left, #btn-roll-right, #btn-bailout, #btn-acro-flip, #btn-wasted-relaunch, #btn-locker, #hud-locker-modal, #hud-world-modal, #hud-throttle-slider, #cesiumContainer, #earth-drop-bar, .skin-card-btn, input, textarea')) return
    if (!inputManager.hasGyroPermission && typeof (window as any).DeviceOrientationEvent?.requestPermission === 'function') {
      await inputManager.requestGyroPermission()
    }
    if (!hasStarted) {
      await startFlight()
    }
  }

  window.addEventListener('click', handleGlobalStart)

  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      engine.resize()
      inputManager.calibrateNeutral()
    }, 150)
  })

  // Wheel / trackpad gesture start
  window.addEventListener('wheel', (e: WheelEvent) => {
    if (globeEngine.isPickingEarth()) return
    const wheelTarget = e.target as HTMLElement | null
    if (wheelTarget?.closest?.('#cesiumContainer, #earth-drop-bar, #hud-world-modal')) return
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

    if (globeEngine.isPickingEarth()) {
      // The planet covers the flight. Hold position until they drop in or go back.
    } else if (hasStarted) {
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
      if (!sim.isCrashed && sim.currentWingType === 'wingsuit') {
        const stickNow = inputManager.controls.throttle ?? inputManager.targetThrottle
        if (stickNow < 0.08) {
          equipWing('paraglider', true)
          // The copy above still has the buried stick. The chute must open at a coast.
          sim.controls = { ...inputManager.controls }
        }
      }

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

      // Check GTA-style Ragdoll & Gore Crash condition
      if (sim.isCrashed) {
        if (!wasCrashedLastFrame) {
          wasCrashedLastFrame = true
          replayBuffer.snapshotCrash()
          actionCam.setCrashVantage('orbit')
          hud.setCrashCamLabel('orbit')
          crashRespawn = {
            x: sim.pilot.position.x,
            z: sim.pilot.position.z,
            heading: sim.canopy.yawDeg,
          }
          rig.setPilotVisible(false)
          ragdollCrash.triggerCrash(
            sim.pilot.position,
            sim.pilot.velocity,
            sim.canopy.position,
            sim.crashImpactSpeedKmh || sim.telemetry.airspeedKmh,
            (x, z) => activeWorld.sampleHeight(x, z),
          )
          soundscape.playGoreCrashSound(sim.crashImpactSpeedKmh || sim.telemetry.airspeedKmh)
          hud.showWasted(
            sim.crashReason,
            sim.crashImpactSpeedKmh,
            sim.crashImpactG,
            sim.crashBonesBroken,
            sim.crashHospitalBill,
          )
        }

        // Slow-motion playback if player activated Wipeout Replay
        if (replayBuffer.isReplaying) {
          const frame = replayBuffer.step(dt)
          if (frame) {
            rig.setPilotVisible(true)
            sim.pilot.position.x = frame.pilotPos.x
            sim.pilot.position.y = frame.pilotPos.y
            sim.pilot.position.z = frame.pilotPos.z
            sim.pilot.velocity.x = frame.pilotVel.x
            sim.pilot.velocity.y = frame.pilotVel.y
            sim.pilot.velocity.z = frame.pilotVel.z
            sim.canopy.position.x = frame.canopyPos.x
            sim.canopy.position.y = frame.canopyPos.y
            sim.canopy.position.z = frame.canopyPos.z
            sim.canopy.yawDeg = frame.canopyYaw
            sim.canopy.pitchDeg = frame.canopyPitch
            sim.canopy.rollDeg = frame.canopyRoll
            sim.canopy.quaternion.x = frame.qx
            sim.canopy.quaternion.y = frame.qy
            sim.canopy.quaternion.z = frame.qz
            sim.canopy.quaternion.w = frame.qw
            sim.telemetry.airspeedKmh = frame.speedKmh
            sim.telemetry.gForce = frame.gForce
            sim.telemetry.verticalSpeedMps = frame.pilotVel.y
            sim.telemetry.collapseFrac = frame.collapse
            sim.thrustNewtons = frame.thrust
            sim.drogueOpen = frame.drogue
            sim.controls.weightShift = frame.weightShift
            sim.controls.leftBrake = frame.leftBrake
            sim.controls.rightBrake = frame.rightBrake
            sim.controls.speedBar = frame.speedBar
            sim.controls.pullingA = frame.pullingA
            sim.controls.pullingB = frame.pullingB
            sim.controls.strafe = 0
            replayLook.copyFrom(frame.pilotPos)
            actionCam.replayFocus = replayLook
            rig.update(sim, actionCam.vantage)
            const tips = rig.getWingtipPositions()
            const thrusters = rig.getThrusterPositions()
            wingtipTrails.update(sim, dt, tips.left, tips.right, thrusters?.left, thrusters?.right)
          } else {
            replayBuffer.stopReplay()
            actionCam.replayFocus = null
            rig.setPilotVisible(false)
            ragdollCrash.setVisible(true)
          }
        } else {
          wingtipTrails.sleep()
        }

        // Ragdoll keeps falling while the replay hides it, so the cut back is the body on the ground.
        ragdollCrash.update(
          dt * 0.45,
          (x, z) => activeWorld.sampleHeight(x, z),
          (impactSpd) => {
            if (!replayBuffer.isReplaying) soundscape.playRagdollBounceSound(impactSpd)
          },
        )
      } else {
        replayBuffer.record(sim)
      }

      // Step D: Detect Emergent Acrobatics & Tricks
      const trickState = trickDetector.update(sim, dt)

      if (!sim.isCrashed && supplyDrop.update(
        dt,
        sim.pilot.position,
      )) {
        const found = wardrobe.collectDrop(currentWorldId)
        soundscape.playCoinSound()
        if (found.skin) {
          rig.applySkin(found.skin)
          wingtipTrails.setTrailColor(found.skin.trailColor || null, found.skin.emissiveTrail)
          hud.setWeatherInfo(`👕 ${found.skin.name} unlocked`)
        } else if (found.souvenir) {
          hud.setWeatherInfo(`🎁 ${found.souvenir.name}`)
        }
        syncLocker()
      }

      if (!sim.isCrashed && powerWing.update(dt, sim.pilot.position)) {
        grantPowerWing()
      }

      if (!sim.isCrashed && wingsuitPickup.update(dt, sim.pilot.position)) {
        grantWingsuit()
      }

      // Step E: Coin Ring Collection (Active in Whistler)
      if (coinRings && !sim.isCrashed) {
        const { ringCollected, points, speedBonus, funnelNudge } = coinRings.update(
          new Vector3(sim.pilot.position.x, sim.pilot.position.y, sim.pilot.position.z),
          dt,
          sim.telemetry.airspeedKmh,
        )
        if (funnelNudge && (funnelNudge.x !== 0 || funnelNudge.y !== 0 || funnelNudge.z !== 0)) {
          sim.applyPositionNudge(funnelNudge.x, funnelNudge.y, funnelNudge.z)
        }
        if (ringCollected) {
          sim.telemetry.score += points
          sim.telemetry.ringsCollected++
          sim.grantLineBoost()
          soundscape.playCoinSound()
          if (speedBonus) {
            soundscape.playReinflationPop()
          }
        }
      }

      // Step F: Update Soundscape with Aeolian Singing Lines, Flutter Bass, Stall Buffet, Electrostatic RF Crackle, and 2-Stroke Paramotor
      if (!sim.isCrashed) {
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
          sim.telemetry.isCollapsed ?? false,
          sim.telemetry.collapseFrac ?? 0,
        )
      }

      // Step G: Update Visual Rig & Action Camera with AR Viewport Twist & Snap Dynamics
      if (!sim.isCrashed) {
        rig.update(sim, actionCam.vantage)
        const tips = rig.getWingtipPositions()
        const thrusters = rig.getThrusterPositions()
        wingtipTrails.update(sim, dt, tips.left, tips.right, thrusters?.left, thrusters?.right)
      }
      actionCam.update(
        sim,
        dt,
        inputManager.tiltParallaxRoll,
        inputManager.tiltParallaxPitch,
        inputManager.instantTwistRad,
        inputManager.snapIntensity,
        sim.isCrashed ? ragdollCrash.getTorsoPosition() : undefined,
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
      gliderFlock.update(dt, sim.atmosphere.windVector, sim.pilot.position)
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
        inputManager.pitchDemand,
      )
      if (coinRings) {
        const objective = flightObjective(currentWorldId, coinRings.collectedCount, coinRings.totalCoins)
        hud.setObjective(sim.ringBoostTimer > 0.08 ? `${objective}  Boost ${sim.coinCount}.` : objective)
      }
      hud.setThrottlePosition(inputManager.targetThrottle)

      hud.setGyroStatus(
        inputManager.hasGyroPermission,
        inputManager.tiltWeightShift * 20,
        inputManager.phoneElevationDeg,
        sim.telemetry.isCollapsed ?? false,
        inputManager.diveDemand,
        inputManager.flareDemand,
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
    } else if (!globeEngine.isPickingEarth()) {
      // Pre-launch preview state
      rig.update(sim, actionCam.vantage)
      actionCam.update(sim, dt)
      sky.update(new Vector3(sim.pilot.position.x, sim.pilot.position.y, sim.pilot.position.z))
      lineArtTerrain.update(actionCam.camera.position)
      thermalVortex.update(dt, sim.atmosphere.windVector, sim.pilot.position)
      fluidSplats.update(dt, sim.atmosphere.windVector, 0)
      gaggle.update(dt, sim.atmosphere.windVector)
      gliderFlock.update(dt, sim.atmosphere.windVector, sim.pilot.position)
      trackedPlayer.update(dt)

      if (lnStyle.isIrGoggles) {
        hud.updateIrSpotTemp(currentAirTempC, 'LAUNCH SITE AMBIENT')
      }
    }

    const northDeg = activeWorld instanceof GoogleEarthWorld ? activeWorld.site.headingDeg : 0
    hud.setCompass(northDeg + sim.telemetry.headingDeg)

    if (activeWorld instanceof GoogleEarthWorld && !globeEngine.isPickingEarth()) {
      const pilot = sim.pilot.position
      const here = globeEngine.localToLatLonAlt(pilot.x, pilot.y, pilot.z)
      activeWorld.refreshStreetNames(here.lat, here.lon)
    }

    // Synchronize GodsEyeGlobeEngine (CesiumJS 3D Planet) 1:1 with Babylon ActionCamera
    globeEngine.syncFromBabylonCamera(actionCam.camera)

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
