import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'

import '@babylonjs/core/Meshes/instancedMesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import '@babylonjs/core/Culling/ray'

import { ParagliderSimulation } from './physics/pendulum'
import { TrickDetector } from './physics/tricks'
import { ActionCamera } from './rendering/ActionCamera'
import { ParagliderRig } from './rendering/ParagliderRig'
import { WhistlerMountain } from './world/WhistlerMountain'
import { HimalayasMountain } from './world/HimalayasMountain'
import { ChairliftSystem } from './world/ChairliftSystem'
import { CoinRings } from './world/CoinRings'
import { MobileInputManager } from './input/MobileInputManager'
import { FlightSoundscape } from './audio/FlightSoundscape'
import { FlightHUD } from './ui/FlightHUD'

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

  // Lonely Mountains: Downhill Vibrant Sky & Atmospheric Depth
  const skyCobalt = new Color4(0.24, 0.58, 0.88, 1.0)
  const hazeColor = new Color3(0.68, 0.82, 0.94)

  scene.clearColor = skyCobalt
  scene.fogMode = Scene.FOGMODE_EXP2
  scene.fogDensity = 0.00018
  scene.fogColor = hazeColor

  // Sky Dome
  const skyDome = MeshBuilder.CreateSphere(
    'sky-dome',
    { diameter: 8000, segments: 16, sideOrientation: 1 },
    scene,
  )
  const skyMat = new StandardMaterial('sky-mat', scene)
  skyMat.diffuseColor = new Color3(skyCobalt.r, skyCobalt.g, skyCobalt.b)
  skyMat.emissiveColor = new Color3(skyCobalt.r * 0.9, skyCobalt.g * 0.9, skyCobalt.b * 0.9)
  skyMat.disableLighting = true
  skyDome.material = skyMat
  skyDome.infiniteDistance = true

  // Sun & Ambient Lights
  const ambientLight = new HemisphericLight('ambient-sky', new Vector3(0.2, 1.0, 0.1), scene)
  ambientLight.diffuse = new Color3(0.85, 0.92, 1.0)
  ambientLight.groundColor = new Color3(0.25, 0.28, 0.22)
  ambientLight.intensity = 1.35

  const sunLight = new DirectionalLight('sun-dir', new Vector3(-0.45, -0.85, 0.28), scene)
  sunLight.diffuse = new Color3(1.0, 0.88, 0.72) // Warm afternoon alpine sun
  sunLight.intensity = 2.6

  // 2. Build Worlds: Whistler Mountain, Himalayas Mountain, Chairlifts, Coin Rings
  const whistlerMountain = new WhistlerMountain(scene)
  const himalayasMountain = new HimalayasMountain(scene)
  // Initially show Whistler, keep Himalayas ready
  himalayasMountain.terrainMesh.setEnabled(false)
  if (himalayasMountain.riverMesh) himalayasMountain.riverMesh.setEnabled(false)

  let activeMountain: WhistlerMountain | HimalayasMountain = whistlerMountain

  new ChairliftSystem(scene, whistlerMountain)
  const coinRings = new CoinRings(scene, whistlerMountain)

  // 3. Build Flight Core, Camera, and Rig
  const sim = new ParagliderSimulation(2050, 5) // Launch off Whistler Peak facing down the bowl
  ;(window as any).sim = sim
  ;(window as any).scene = scene
  const rig = new ParagliderRig(scene)
  ;(window as any).rig = rig
  const actionCam = new ActionCamera(scene)
  ;(window as any).actionCam = actionCam
  ;(window as any).mountain = whistlerMountain
  ;(window as any).himalayas = himalayasMountain
  const trickDetector = new TrickDetector()

  // 4. Input, Audio, HUD
  const inputManager = new MobileInputManager()
  ;(window as any).inputManager = inputManager
  const soundscape = new FlightSoundscape()
  const hud = new FlightHUD('hud-container')

  let hasStarted = false

  hud.setOnStart(async () => {
    hasStarted = true
    await inputManager.requestGyroPermission()
    inputManager.calibrateNeutral()
    soundscape.init()
  })

  hud.setOnRecenter(() => {
    inputManager.calibrateNeutral()
  })

  const cycleLens = () => {
    const newMode = actionCam.cycleLensMode()
    hud.updateLensLabel(newMode)
  }
  hud.setOnCycleLens(cycleLens)
  inputManager.onCycleLens = cycleLens

  const cycleVantage = () => {
    const newVantage = actionCam.cycleVantage()
    hud.updateVantageLabel(newVantage)
  }
  hud.setOnCycleVantage(cycleVantage)
  inputManager.onCycleVantage = cycleVantage

  hud.setOnToggleReverse(() => {
    inputManager.toggleReverseStance()
  })

  hud.setOnToggleInvertTrackpad(() => {
    const inverted = inputManager.toggleInvertTrackpad()
    hud.updateTrackpadInvertLabel(inverted)
  })
  inputManager.onToggleInvertTrackpad = (inverted) => {
    hud.updateTrackpadInvertLabel(inverted)
  }

  const toggleWing = () => {
    const nextWing = sim.currentWingType === 'speedwing' ? 'paraglider' : 'speedwing'
    sim.setWing(nextWing)
    rig.buildCanopyAndLines(nextWing)
    hud.updateWingLabel(nextWing)
  }
  hud.setOnToggleWing(toggleWing)
  inputManager.onToggleWing = toggleWing

  const spawnHimalayas = () => {
    whistlerMountain.terrainMesh.setEnabled(false)
    if (whistlerMountain.waterMesh) whistlerMountain.waterMesh.setEnabled(false)
    himalayasMountain.terrainMesh.setEnabled(true)
    if (himalayasMountain.riverMesh) himalayasMountain.riverMesh.setEnabled(true)
    activeMountain = himalayasMountain
    sim.setWing('paraglider')
    rig.buildCanopyAndLines('paraglider')
    sim.reset(4200, 0, { x: 0, y: 4200, z: 0 })
    actionCam.snap()
    hud.updateWingLabel('paraglider')
  }

  const spawnAlpine = () => {
    himalayasMountain.terrainMesh.setEnabled(false)
    if (himalayasMountain.riverMesh) himalayasMountain.riverMesh.setEnabled(false)
    whistlerMountain.terrainMesh.setEnabled(true)
    if (whistlerMountain.waterMesh) whistlerMountain.waterMesh.setEnabled(true)
    activeMountain = whistlerMountain
    sim.setWing('speedwing')
    rig.buildCanopyAndLines('speedwing')
    sim.reset(2050, 5, { x: 0, y: 2050, z: 0 })
    actionCam.snap()
    hud.updateWingLabel('speedwing')
  }

  const spawnDunes = () => {
    himalayasMountain.terrainMesh.setEnabled(false)
    if (himalayasMountain.riverMesh) himalayasMountain.riverMesh.setEnabled(false)
    whistlerMountain.terrainMesh.setEnabled(true)
    if (whistlerMountain.waterMesh) whistlerMountain.waterMesh.setEnabled(true)
    activeMountain = whistlerMountain
    sim.setWing('speedwing')
    rig.buildCanopyAndLines('speedwing')
    sim.reset(208, 10, { x: 0, y: 208, z: 2550 })
    actionCam.snap()
    hud.updateWingLabel('speedwing')
  }

  hud.setOnSpawnHimalayas(spawnHimalayas)
  hud.setOnSpawnAlpine(spawnAlpine)
  hud.setOnSpawnDunes(spawnDunes)
  inputManager.onSpawnHimalayas = spawnHimalayas
  inputManager.onSpawnAlpine = spawnAlpine
  inputManager.onSpawnDunes = spawnDunes
  hud.setOnRelaunch(spawnAlpine)

  ;(window as any).spawnAlpine = spawnAlpine
  ;(window as any).spawnHimalayas = spawnHimalayas
  ;(window as any).spawnDunes = spawnDunes
  ;(window as any).toggleWing = toggleWing

  // 5. Main Simulation & Render Loop
  engine.runRenderLoop(() => {
    const dt = engine.getDeltaTime() * 0.001 // seconds

    if (hasStarted) {
      // Step A: Update Inputs (Touch & Gyro)
      inputManager.update(dt)
      sim.controls = { ...inputManager.controls }

      // Step B: Sample Atmosphere (Thermals & Updrafts)
      const updraft = activeMountain.sampleUpdraft(
        sim.pilot.position.x,
        sim.pilot.position.y,
        sim.pilot.position.z,
      )
      sim.atmosphere.thermalUpdraftMps = updraft

      // Step C: Step 2-Body Pendulum Physics
      sim.step(dt, (x, z) => activeMountain.sampleHeight(x, z))

      // Step D: Detect Emergent Acrobatics & Tricks
      const trickState = trickDetector.update(sim, dt)

      // Step E: Coin Ring Collection
      const { ringCollected, points } = coinRings.update(
        new Vector3(sim.pilot.position.x, sim.pilot.position.y, sim.pilot.position.z),
        dt,
      )
      if (ringCollected) {
        sim.telemetry.score += points
        sim.telemetry.ringsCollected++
        soundscape.playCoinSound()
      }

      // Step F: Update Soundscape
      soundscape.update(
        sim.telemetry.airspeedKmh,
        sim.telemetry.verticalSpeedMps,
        sim.telemetry.gForce,
        dt,
      )

      // Step G: Update Visual Rig & Action Camera
      rig.update(sim, actionCam.vantage)
      actionCam.update(sim, dt)

      // Step H: Update HUD
      hud.update(sim.telemetry, sim.controls, trickState, {
        active: inputManager.trackpadActive,
        pitch: inputManager.trackpadPitch,
        roll: inputManager.trackpadRoll,
      })
    } else {
      // Pre-launch preview state: Keep rig and action camera positioned
      rig.update(sim, actionCam.vantage)
      actionCam.update(sim, dt)
    }

    scene.render()
  })

  // Handle Resize
  window.addEventListener('resize', () => {
    engine.resize()
  })
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp)
} else {
  initApp()
}
