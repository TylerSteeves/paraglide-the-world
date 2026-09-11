import { useEffect, useRef } from 'react'
import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { FlightSimState } from '../../sim/flight-model'
import type { FlightSite } from '../../sim/site-data'
import { getLocalOffsetMeters } from '../../flight/geometry'

type WorldStatus = 'config-needed' | 'loading' | 'ready' | 'error'

type BabylonFlightWorldProps = {
  site: FlightSite
  flightState: FlightSimState
  onTerrainSample: (terrainHeightMeters: number | null) => void
  onWorldStatusChange: (status: WorldStatus, detail?: string) => void
}

type ScenePalette = {
  sky: Color4
  haze: Color3
  lowland: Color3
  hillside: Color3
  highland: Color3
  snow: Color3
  water: Color3
  canopy: Color3
  canopyAccent: Color3
}

declare global {
  interface Window {
    __PARAGLIDE_READY__?: boolean
    __PARAGLIDE_RENDERER__?: string
  }
}

const PALETTES: Record<string, ScenePalette> = {
  lauterbrunnen: {
    sky: new Color4(0.26, 0.58, 0.86, 1),
    haze: new Color3(0.62, 0.79, 0.9),
    lowland: new Color3(0.16, 0.46, 0.22),
    hillside: new Color3(0.3, 0.52, 0.28),
    highland: new Color3(0.4, 0.45, 0.37),
    snow: new Color3(0.88, 0.93, 0.95),
    water: new Color3(0.08, 0.43, 0.62),
    canopy: new Color3(1, 0.39, 0.08),
    canopyAccent: new Color3(1, 0.79, 0.16),
  },
  rome: {
    sky: new Color4(0.39, 0.68, 0.88, 1),
    haze: new Color3(0.82, 0.78, 0.67),
    lowland: new Color3(0.24, 0.42, 0.2),
    hillside: new Color3(0.42, 0.46, 0.23),
    highland: new Color3(0.47, 0.36, 0.25),
    snow: new Color3(0.82, 0.75, 0.61),
    water: new Color3(0.12, 0.47, 0.59),
    canopy: new Color3(0.82, 0.06, 0.13),
    canopyAccent: new Color3(0.97, 0.82, 0.31),
  },
  istanbul: {
    sky: new Color4(0.24, 0.61, 0.82, 1),
    haze: new Color3(0.72, 0.77, 0.73),
    lowland: new Color3(0.16, 0.36, 0.24),
    hillside: new Color3(0.34, 0.43, 0.27),
    highland: new Color3(0.43, 0.38, 0.3),
    snow: new Color3(0.76, 0.69, 0.56),
    water: new Color3(0.04, 0.39, 0.59),
    canopy: new Color3(0.84, 0.08, 0.26),
    canopyAccent: new Color3(0.12, 0.78, 0.77),
  },
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function lerpColor(a: Color3, b: Color3, amount: number) {
  const t = clamp(amount, 0, 1)
  return new Color3(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t,
  )
}

function getPalette(siteId: string) {
  return PALETTES[siteId] ?? PALETTES.lauterbrunnen
}

function rawTerrainHeight(siteId: string, east: number, north: number) {
  if (siteId === 'rome') {
    return (
      34 * Math.sin(east / 380) +
      24 * Math.cos(north / 510) +
      42 * Math.sin((east + north) / 760) +
      Math.max(0, Math.abs(east + 620) - 420) * 0.055
    )
  }

  if (siteId === 'istanbul') {
    const shoreDistance = Math.abs(east + 260)
    const cityHills = 75 * Math.sin(north / 520) + 45 * Math.cos(east / 330)
    const shoreShelf = Math.max(0, shoreDistance - 260) * 0.085
    return cityHills + shoreShelf
  }

  const valleyWalls = Math.pow(Math.max(0, Math.abs(east) - 230) / 16, 1.25) * 8.2
  const ridgeTexture =
    75 * Math.sin((north + east * 0.45) / 360) +
    48 * Math.cos((north - east) / 520)
  const valleySlope = -north * 0.018
  const distantMassif = Math.max(0, north - 1050) * 0.16
  return valleyWalls + ridgeTexture + valleySlope + distantMassif
}

function createTerrainHeightSampler(siteId: string) {
  const originHeight = rawTerrainHeight(siteId, 0, 0)
  return (east: number, north: number) =>
    clamp(rawTerrainHeight(siteId, east, north) - originHeight, -95, 1900)
}

function createMaterial(
  scene: Scene,
  name: string,
  color: Color3,
  options?: { emissive?: number; alpha?: number; rough?: boolean },
) {
  const material = new StandardMaterial(name, scene)
  material.diffuseColor = color
  material.specularColor = options?.rough === false ? new Color3(0.2, 0.2, 0.2) : Color3.Black()
  material.ambientColor = color.scale(0.25)
  material.emissiveColor = color.scale(options?.emissive ?? 0)
  material.alpha = options?.alpha ?? 1
  material.backFaceCulling = false
  return material
}

function createTerrain(
  scene: Scene,
  site: FlightSite,
  palette: ScenePalette,
  sampleHeight: (east: number, north: number) => number,
) {
  const size = site.id === 'lauterbrunnen' ? 7200 : 6400
  const terrain = MeshBuilder.CreateGround(
    'living-terrain',
    { width: size, height: size, subdivisions: 112, updatable: true },
    scene,
  )
  const positions = terrain.getVerticesData(VertexBuffer.PositionKind)
  const indices = terrain.getIndices()

  if (!positions || !indices) {
    return terrain
  }

  const colors: number[] = []
  const normals: number[] = []

  for (let index = 0; index < positions.length; index += 3) {
    const east = positions[index]
    const north = positions[index + 2]
    const height = sampleHeight(east, north)
    const noise = Math.sin(east * 0.021) * Math.cos(north * 0.018) * 5
    positions[index + 1] = height + noise

    const altitudeMix = clamp((height + 30) / 900, 0, 1)
    const snowMix = clamp((height - 720) / 560, 0, 1)
    const hillside = lerpColor(palette.lowland, palette.hillside, altitudeMix)
    const mountain = lerpColor(hillside, palette.highland, altitudeMix)
    const color = lerpColor(mountain, palette.snow, snowMix)
    const variation = 0.9 + Math.sin((east + north) * 0.015) * 0.045

    colors.push(color.r * variation, color.g * variation, color.b * variation, 1)
  }

  VertexData.ComputeNormals(positions, indices, normals)
  terrain.updateVerticesData(VertexBuffer.PositionKind, positions)
  terrain.setVerticesData(VertexBuffer.NormalKind, normals)
  terrain.setVerticesData(VertexBuffer.ColorKind, colors)
  terrain.useVertexColors = true
  terrain.receiveShadows = true
  terrain.isPickable = false

  const material = createMaterial(scene, 'terrain-material', Color3.White())
  material.specularColor = Color3.Black()
  terrain.material = material
  return terrain
}

function createSky(scene: Scene, palette: ScenePalette) {
  const sky = MeshBuilder.CreateSphere(
    'sky-dome',
    { diameter: 9800, segments: 24, sideOrientation: Mesh.BACKSIDE },
    scene,
  )
  const skyMaterial = createMaterial(
    scene,
    'sky-material',
    new Color3(palette.sky.r, palette.sky.g, palette.sky.b),
    { emissive: 0.9 },
  )
  skyMaterial.disableLighting = true
  skyMaterial.disableDepthWrite = true
  sky.material = skyMaterial
  sky.infiniteDistance = true
  sky.isPickable = false

  const sun = MeshBuilder.CreateSphere('sun', { diameter: 150, segments: 20 }, scene)
  sun.position.set(-1450, 1200, 2600)
  sun.material = createMaterial(scene, 'sun-material', new Color3(1, 0.79, 0.38), {
    emissive: 1,
  })
  sun.isPickable = false
}

function createClouds(scene: Scene, siteId: string) {
  const cloudMaterial = createMaterial(scene, 'cloud-material', new Color3(0.96, 0.98, 1), {
    emissive: 0.2,
    alpha: 0.52,
  })
  cloudMaterial.disableDepthWrite = true
  const cloudCount = siteId === 'rome' ? 9 : 14

  for (let index = 0; index < cloudCount; index += 1) {
    const angle = index * 2.399
    const distance = 920 + (index % 5) * 390
    const center = new Vector3(
      Math.cos(angle) * distance,
      470 + (index % 4) * 115,
      Math.sin(angle) * distance,
    )

    for (let puff = 0; puff < 3; puff += 1) {
      const cloud = MeshBuilder.CreateSphere(
        `cloud-${index}-${puff}`,
        { diameter: 150 + puff * 38, segments: 10 },
        scene,
      )
      cloud.position = center.add(new Vector3((puff - 1) * 95, puff * 16, (puff % 2) * 52))
      cloud.scaling.y = 0.46
      cloud.material = cloudMaterial
      cloud.isPickable = false
    }
  }
}

function createRiver(
  scene: Scene,
  site: FlightSite,
  palette: ScenePalette,
  sampleHeight: (east: number, north: number) => number,
) {
  const riverPath = Array.from({ length: 33 }, (_, index) => {
    const north = -3200 + index * 200
    const east = site.id === 'istanbul' ? -260 : Math.sin(north / 570) * 62 - 45
    return new Vector3(east, sampleHeight(east, north) + 4, north)
  })
  const river = MeshBuilder.CreateTube(
    'river',
    {
      path: riverPath,
      radius: site.id === 'istanbul' ? 185 : site.id === 'rome' ? 38 : 24,
      tessellation: 12,
      cap: Mesh.CAP_ALL,
    },
    scene,
  )
  river.scaling.y = 0.025
  river.material = createMaterial(scene, 'water-material', palette.water, {
    emissive: 0.15,
    alpha: 0.88,
    rough: false,
  })
  river.isPickable = false
}

function createLandmarks(
  scene: Scene,
  site: FlightSite,
  sampleHeight: (east: number, north: number) => number,
) {
  const buildingMaterial = createMaterial(
    scene,
    'building-material',
    site.id === 'lauterbrunnen' ? new Color3(0.48, 0.34, 0.22) : new Color3(0.72, 0.61, 0.47),
  )
  const roofMaterial = createMaterial(scene, 'roof-material', new Color3(0.5, 0.15, 0.08))
  const treeMaterial = createMaterial(scene, 'tree-material', new Color3(0.04, 0.34, 0.14))

  for (let index = 0; index < 30; index += 1) {
    const north = -1550 + index * 105
    const east = ((index * 173) % 460) - 230
    const ground = sampleHeight(east, north)
    const buildingHeight = 12 + (index % 5) * 4
    const building = MeshBuilder.CreateBox(
      `building-${index}`,
      { width: 14 + (index % 3) * 5, height: buildingHeight, depth: 18 + (index % 4) * 4 },
      scene,
    )
    building.position.set(east, ground + buildingHeight / 2, north)
    building.rotation.y = ((index * 47) % 90) * (Math.PI / 180)
    building.material = buildingMaterial
    building.isPickable = false

    const roof = MeshBuilder.CreateCylinder(
      `roof-${index}`,
      { diameter: 22 + (index % 3) * 4, height: 6, tessellation: 4 },
      scene,
    )
    roof.position.set(east, ground + buildingHeight + 2, north)
    roof.rotation.y = Math.PI / 4 + building.rotation.y
    roof.material = roofMaterial
    roof.isPickable = false
  }

  const treeCount = site.id === 'rome' ? 34 : 64
  for (let index = 0; index < treeCount; index += 1) {
    const angle = index * 2.19
    const distance = 370 + (index % 11) * 118
    const east = Math.cos(angle) * distance
    const north = Math.sin(angle) * distance
    const ground = sampleHeight(east, north)
    const tree = MeshBuilder.CreateCylinder(
      `tree-${index}`,
      { diameterTop: 0, diameterBottom: 18, height: 42 + (index % 4) * 7, tessellation: 7 },
      scene,
    )
    tree.position.set(east, ground + tree.getBoundingInfo().boundingBox.extendSize.y, north)
    tree.material = treeMaterial
    tree.isPickable = false
  }
}

function createRouteMarkers(
  scene: Scene,
  site: FlightSite,
  palette: ScenePalette,
  sampleHeight: (east: number, north: number) => number,
) {
  const liftMaterial = createMaterial(scene, 'lift-material', palette.canopyAccent, {
    emissive: 0.7,
    alpha: 0.28,
  })

  for (const thermal of site.thermals) {
    const offset = getLocalOffsetMeters(
      thermal.latitude,
      thermal.longitude,
      site.latitude,
      site.longitude,
    )

    for (let ringIndex = 0; ringIndex < 4; ringIndex += 1) {
      const ring = MeshBuilder.CreateTorus(
        `thermal-${thermal.id}-${ringIndex}`,
        { diameter: thermal.coreRadiusMeters ?? thermal.radiusMeters * 0.35, thickness: 3, tessellation: 48 },
        scene,
      )
      ring.position.set(
        offset.east,
        sampleHeight(offset.east, offset.north) + 60 + ringIndex * 65,
        offset.north,
      )
      ring.scaling.setAll(0.7 + ringIndex * 0.12)
      ring.material = liftMaterial
      ring.isPickable = false
    }
  }

  if (site.landingZone) {
    const offset = getLocalOffsetMeters(
      site.landingZone.latitude,
      site.landingZone.longitude,
      site.latitude,
      site.longitude,
    )
    const marker = MeshBuilder.CreateTorus(
      'landing-zone',
      { diameter: Math.min(site.landingZone.widthMeters, 96), thickness: 5, tessellation: 64 },
      scene,
    )
    marker.position.set(
      offset.east,
      sampleHeight(offset.east, offset.north) + 6,
      offset.north,
    )
    marker.scaling.z = 2.1
    marker.rotation.y = site.landingZone.headingDeg * (Math.PI / 180)
    marker.material = liftMaterial
    marker.isPickable = false
  }
}

function createGlider(scene: Scene, palette: ScenePalette) {
  const root = new TransformNode('glider-root', scene)
  const wingRoot = new TransformNode('wing-root', scene)
  wingRoot.parent = root
  const frontPath: Vector3[] = []
  const middlePath: Vector3[] = []
  const backPath: Vector3[] = []

  for (let index = 0; index <= 24; index += 1) {
    const spanT = index / 24
    const x = -10.8 + spanT * 21.6
    const normalized = Math.abs(x) / 10.8
    const arch = 7.8 + (1 - Math.pow(normalized, 1.65)) * 3.1
    const sweep = Math.pow(normalized, 1.7) * 2.25
    frontPath.push(new Vector3(x, arch, -2.7 + sweep))
    middlePath.push(new Vector3(x, arch + 0.45, 0 + sweep))
    backPath.push(new Vector3(x, arch - 0.15, 3.15 + sweep))
  }

  const canopy = MeshBuilder.CreateRibbon(
    'canopy',
    { pathArray: [frontPath, middlePath, backPath], sideOrientation: Mesh.DOUBLESIDE },
    scene,
  )
  canopy.parent = wingRoot
  canopy.material = createMaterial(scene, 'canopy-material', palette.canopy, {
    emissive: 0.08,
    rough: false,
  })

  const trim = MeshBuilder.CreateTube(
    'canopy-trim',
    { path: frontPath, radius: 0.18, tessellation: 8 },
    scene,
  )
  trim.parent = wingRoot
  trim.material = createMaterial(scene, 'canopy-accent-material', palette.canopyAccent, {
    emissive: 0.2,
  })

  const lineMaterial = createMaterial(scene, 'riser-material', new Color3(0.92, 0.95, 0.98), {
    emissive: 0.15,
  })
  const riserAnchors = [frontPath[3], frontPath[8], frontPath[16], frontPath[21]]
  for (let index = 0; index < riserAnchors.length; index += 1) {
    const anchor = riserAnchors[index]
    const pilotAnchor = new Vector3(index < 2 ? -0.55 : 0.55, 1.7, 0.45)
    const riser = MeshBuilder.CreateTube(
      `riser-${index}`,
      { path: [anchor, pilotAnchor], radius: 0.035, tessellation: 5 },
      scene,
    )
    riser.parent = root
    riser.material = lineMaterial
  }

  const harnessMaterial = createMaterial(scene, 'harness-material', new Color3(0.025, 0.04, 0.06))
  const jacketMaterial = createMaterial(scene, 'jacket-material', new Color3(0.05, 0.3, 0.42))
  const helmetMaterial = createMaterial(scene, 'helmet-material', palette.canopyAccent, {
    emissive: 0.08,
  })

  const harness = MeshBuilder.CreateCapsule('pilot-harness', { height: 3.6, radius: 0.95 }, scene)
  harness.parent = root
  harness.position.y = 0.25
  harness.rotation.x = Math.PI / 2.9
  harness.material = harnessMaterial

  const torso = MeshBuilder.CreateCylinder(
    'pilot-torso',
    { height: 2.5, diameterTop: 1.2, diameterBottom: 1.5, tessellation: 10 },
    scene,
  )
  torso.parent = root
  torso.position.set(0, 1.5, 0.15)
  torso.rotation.x = Math.PI / 8
  torso.material = jacketMaterial

  const helmet = MeshBuilder.CreateSphere('pilot-helmet', { diameter: 1.25, segments: 14 }, scene)
  helmet.parent = root
  helmet.position.set(0, 3.05, 0.44)
  helmet.material = helmetMaterial

  for (const side of [-1, 1]) {
    const leg = MeshBuilder.CreateCapsule(`pilot-leg-${side}`, { height: 3.2, radius: 0.32 }, scene)
    leg.parent = root
    leg.position.set(side * 0.42, -1.55, 1.1)
    leg.rotation.x = Math.PI / 2.7
    leg.rotation.z = side * 0.08
    leg.material = harnessMaterial
  }

  return { root, wingRoot }
}

export function BabylonFlightWorld({
  site,
  flightState,
  onTerrainSample,
  onWorldStatusChange,
}: BabylonFlightWorldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const flightStateRef = useRef(flightState)
  const callbacksRef = useRef({ onTerrainSample, onWorldStatusChange })

  useEffect(() => {
    flightStateRef.current = flightState
  }, [flightState])

  useEffect(() => {
    callbacksRef.current = { onTerrainSample, onWorldStatusChange }
  }, [onTerrainSample, onWorldStatusChange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    let engine: Engine | null = null
    let scene: Scene | null = null
    let resizeObserver: ResizeObserver | null = null
    window.__PARAGLIDE_READY__ = false
    window.__PARAGLIDE_RENDERER__ = 'Babylon.js procedural world'
    callbacksRef.current.onWorldStatusChange(
      'loading',
      `Shaping the air and terrain around ${site.name}...`,
    )

    try {
      engine = new Engine(canvas, true, {
        antialias: true,
        adaptToDeviceRatio: true,
        preserveDrawingBuffer: true,
        stencil: true,
      })
      scene = new Scene(engine)
      const activeScene = scene
      const activeEngine = engine
      const palette = getPalette(site.id)
      const sampleHeight = createTerrainHeightSampler(site.id)
      scene.clearColor = palette.sky
      scene.fogMode = Scene.FOGMODE_EXP2
      scene.fogDensity = site.id === 'lauterbrunnen' ? 0.00017 : 0.00013
      scene.fogColor = palette.haze
      scene.imageProcessingConfiguration.contrast = 1.18
      scene.imageProcessingConfiguration.exposure = 1.08
      scene.imageProcessingConfiguration.toneMappingEnabled = true

      createSky(scene, palette)
      createTerrain(scene, site, palette, sampleHeight)
      createRiver(scene, site, palette, sampleHeight)
      createClouds(scene, site.id)
      createLandmarks(scene, site, sampleHeight)
      createRouteMarkers(scene, site, palette, sampleHeight)
      const glider = createGlider(scene, palette)

      const ambientLight = new HemisphericLight('sky-light', new Vector3(0.18, 1, 0.28), scene)
      ambientLight.diffuse = new Color3(0.73, 0.85, 1)
      ambientLight.groundColor = new Color3(0.16, 0.19, 0.14)
      ambientLight.intensity = 1.6
      const sunLight = new DirectionalLight('sun-light', new Vector3(0.38, -0.82, -0.42), scene)
      sunLight.diffuse = new Color3(1, 0.78, 0.55)
      sunLight.intensity = 2.45

      const camera = new FreeCamera('chase-camera', new Vector3(0, 180, -90), scene)
      camera.minZ = 0.4
      camera.maxZ = 9000
      camera.fov = 0.78
      camera.inputs.clear()
      scene.activeCamera = camera

      let frameCount = 0
      let sampleTimer = 0
      const initialFlightState = flightStateRef.current
      const smoothedPosition = new Vector3(
        0,
        initialFlightState.altitudeMeters - site.launchAltitudeMeters,
        0,
      )
      const smoothedCamera = new Vector3(0, smoothedPosition.y + 30, -75)

      scene.onBeforeRenderObservable.add(() => {
        const state = flightStateRef.current
        const offset = getLocalOffsetMeters(
          state.latitude,
          state.longitude,
          site.latitude,
          site.longitude,
        )
        const targetPosition = new Vector3(
          offset.east,
          state.altitudeMeters - site.launchAltitudeMeters,
          offset.north,
        )
        const deltaSeconds = Math.min(activeEngine.getDeltaTime() / 1000, 0.05)
        const positionBlend = 1 - Math.exp(-deltaSeconds * 5.5)
        smoothedPosition.copyFrom(Vector3.Lerp(smoothedPosition, targetPosition, positionBlend))
        glider.root.position.copyFrom(smoothedPosition)
        glider.root.rotation.y = state.headingDeg * (Math.PI / 180)
        glider.root.rotation.z = -state.bankDeg * (Math.PI / 180)
        glider.root.rotation.x = state.pitchDeg * (Math.PI / 180)
        glider.wingRoot.scaling.y = 1 + Math.sin(state.elapsedSeconds * 1.8) * 0.018
        glider.wingRoot.rotation.z = Math.sin(state.elapsedSeconds * 1.2) * 0.012

        const heading = state.headingDeg * (Math.PI / 180)
        const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading))
        const right = new Vector3(forward.z, 0, -forward.x)
        const idealCamera = smoothedPosition
          .subtract(forward.scale(64))
          .add(right.scale(state.bankDeg * -0.24))
          .add(new Vector3(0, 18 + Math.abs(state.bankDeg) * 0.12, 0))
        const cameraBlend = 1 - Math.exp(-deltaSeconds * 2.8)
        smoothedCamera.copyFrom(Vector3.Lerp(smoothedCamera, idealCamera, cameraBlend))
        camera.position.copyFrom(smoothedCamera)
        camera.setTarget(smoothedPosition.add(new Vector3(0, 6.5, 0)).add(forward.scale(18)))

        sampleTimer += deltaSeconds
        if (sampleTimer >= 0.25) {
          sampleTimer = 0
          callbacksRef.current.onTerrainSample(
            site.launchAltitudeMeters + sampleHeight(offset.east, offset.north),
          )
        }

        frameCount += 1
        if (frameCount === 3) {
          window.__PARAGLIDE_READY__ = true
          callbacksRef.current.onWorldStatusChange(
            'ready',
            `${site.name} is live in the keyless Godogen flight world.`,
          )
        }
      })

      engine.runRenderLoop(() => {
        scene?.render()
      })

      resizeObserver = new ResizeObserver(() => engine?.resize())
      resizeObserver.observe(canvas)
      const handleResize = () => activeEngine.resize()
      window.addEventListener('resize', handleResize)

      return () => {
        window.removeEventListener('resize', handleResize)
        resizeObserver?.disconnect()
        activeEngine.stopRenderLoop()
        activeScene.dispose()
        activeEngine.dispose()
        if (window.__PARAGLIDE_RENDERER__ === 'Babylon.js procedural world') {
          window.__PARAGLIDE_READY__ = false
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Babylon.js could not initialize WebGL.'
      callbacksRef.current.onWorldStatusChange('error', detail)
      scene?.dispose()
      engine?.dispose()
    }
  }, [site])

  return (
    <canvas
      ref={canvasRef}
      aria-label={`Live 3D paragliding world over ${site.name}, ${site.country}`}
      className="sim-world sim-world--babylon"
    />
  )
}
