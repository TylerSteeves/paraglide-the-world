import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { SpherePackingMeshBuilder } from './SpherePackingMeshBuilder'
import type { FlightWorld, ThermalZone, Vector3Like, ThermalFluidSample } from './types'
import { calculateToroidalThermalFluid } from './ThermalFluidDynamics'

export class WhistlerMountain implements FlightWorld {
  public terrainMesh: Mesh
  public waterMesh: Mesh | null = null
  public thermals: ThermalZone[] = []
  // Launch at Whistler Summit headwall lip (ground is at ~1770m, pilot launches at 1778m facing down the piste!)
  public readonly launchPosition = new Vector3(0, 1778, 5)
  public readonly launchHeadingDeg = 5.0 // Aim straight down the ski piste (Z+)
  private spawnedMeshes: (Mesh | any)[] = []
  private scene: Scene

  constructor(scene: Scene) {
    this.scene = scene

    // 1. Build Whistler Olympic Alpine Ski Resort Terrain
    // Size: 6400m x 6400m, 160 subdivisions for sharp, clean slope detail
    const size = 6400
    const subdivisions = 160
    this.terrainMesh = MeshBuilder.CreateGround(
      'whistler-terrain',
      { width: size, height: size, subdivisions, updatable: true },
      scene,
    )

    const positions = this.terrainMesh.getVerticesData(VertexBuffer.PositionKind)
    const indices = this.terrainMesh.getIndices()

    if (positions && indices) {
      const colors: number[] = []
      const normals: number[] = []

      // High-contrast Alpine Palette
      const corduroyPiste = new Color3(0.98, 0.99, 1.0)       // Pristine groomed corduroy snow
      const powderSnow = new Color3(0.91, 0.94, 0.98)          // Deep off-piste powder with blue ambient shadow
      const darkGranite = new Color3(0.32, 0.35, 0.40)         // Canadian shield granite crags & cliffs
      const forestSnow = new Color3(0.45, 0.55, 0.48)          // Snow-dusted subalpine forest floor
      const frozenLakeIce = new Color3(0.72, 0.85, 0.95)       // Frozen Green Lake ice sheen

      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]
        const z = positions[i + 2]

        // Sample altitude
        const y = this.sampleHeight(x, z)
        positions[i + 1] = y

        // Curving ski piste corridor
        const pisteCenter = Math.sin(z * 0.0028) * 32.0
        const distFromPiste = Math.abs(x - pisteCenter)

        let color: Color3

        if (z > 2450) {
          // Whistler Valley finish basin & frozen alpine lake
          const distToLake = Math.hypot(x, z - 2800)
          if (distToLake < 380) {
            color = frozenLakeIce
          } else {
            color = Color3.Lerp(powderSnow, forestSnow, 0.35)
          }
        } else {
          // Alpine Ski Descent (z <= 2450)
          if (distFromPiste < 26.0) {
            // Groomed ski run corduroy with high-frequency micro grooves
            const groomGroove = 1.0 + Math.sin(x * 3.5) * 0.015
            color = new Color3(
              corduroyPiste.r * groomGroove,
              corduroyPiste.g * groomGroove,
              corduroyPiste.b * groomGroove,
            )
          } else if (distFromPiste < 65.0) {
            // Off-piste powder snow flanking the run
            const t = (distFromPiste - 26.0) / 39.0
            color = Color3.Lerp(corduroyPiste, powderSnow, t)
          } else if (distFromPiste < 160.0) {
            // Subalpine spruce tree corridor snow
            const t = (distFromPiste - 65.0) / 95.0
            color = Color3.Lerp(powderSnow, forestSnow, t)
          } else {
            // Outer mountain ridges, granite cliffs, and peaks
            if (y > 1520) {
              const rockMix = Math.min(1.0, (y - 1520) / 180.0)
              color = Color3.Lerp(powderSnow, darkGranite, rockMix * 0.65)
            } else {
              color = Color3.Lerp(forestSnow, darkGranite, 0.5)
            }
          }
        }

        // Crisp lighting & natural micro-noise
        const microNoise = 0.98 + Math.sin(x * 0.08) * Math.cos(z * 0.08) * 0.02
        colors.push(color.r * microNoise, color.g * microNoise, color.b * microNoise, 1.0)
      }

      VertexData.ComputeNormals(positions, indices, normals)
      this.terrainMesh.updateVerticesData(VertexBuffer.PositionKind, positions)
      this.terrainMesh.setVerticesData(VertexBuffer.NormalKind, normals)
      this.terrainMesh.setVerticesData(VertexBuffer.ColorKind, colors)
      this.terrainMesh.useVertexColors = true
    }

    const terrainMat = new StandardMaterial('terrain-mat', scene)
    terrainMat.specularColor = new Color3(0.18, 0.22, 0.26)
    terrainMat.roughness = 0.65
    this.terrainMesh.material = terrainMat

    // 2. Frozen Green Lake / Alpine Basin at the Finish (y = 635m, z = 2800m)
    const water = MeshBuilder.CreateGround('frozen-lake-plane', { width: 1400, height: 900 }, scene)
    water.position.set(0, 636, 2800)
    const waterMat = new StandardMaterial('frozen-lake-mat', scene)
    waterMat.diffuseColor = new Color3(0.72, 0.86, 0.96)
    waterMat.specularColor = new Color3(0.95, 0.98, 1.0)
    waterMat.alpha = 0.92
    water.material = waterMat
    this.waterMesh = water
    this.spawnedMeshes.push(water)

    // 3. Scatter Dense Alpine Pine Tree Corridors Flanking the Ski Run
    this.scatterSkiRunPineTrees()

    // 4. Volumetric Alpine Cumulus
    this.scatterSpherePackedClouds()

    // 5. High Alpine Boulders along Ridge Ridges
    this.scatterBoulders()

    // 6. Updraft Thermals over Sun-Facing Headwalls
    this.thermals = [
      { center: new Vector3(80, 1580, 350), radius: 240, strengthMps: 4.5, topAltitude: 2600, expansionRatio: 1.6 },
      { center: new Vector3(-120, 1340, 850), radius: 260, strengthMps: 4.8, topAltitude: 2650, expansionRatio: 1.7 },
      { center: new Vector3(140, 1080, 1420), radius: 280, strengthMps: 4.2, topAltitude: 2550, expansionRatio: 1.6 },
      { center: new Vector3(-80, 840, 1980), radius: 250, strengthMps: 3.8, topAltitude: 2400, expansionRatio: 1.5 },
    ]
  }

  public sampleHeight(x: number, z: number): number {
    // Whistler Olympic Mountain descent
    // Summit ridge at (0, 0) ~ 1765m
    // Olympic Village & finish bowl at z = 2400m ~ 650m
    // Downhill distance: 2400m; Vertical drop: 1115m
    // Continuous ski slope (black diamond headwall 34 deg rolling into alpine bowl 25-28 deg down to village runout)
    const t = Math.max(0, Math.min(1.0, z / 2400.0))
    const valleySlope = 1765.0 - Math.pow(t, 0.88) * 1115.0

    // Curving natural ski bowl centerline
    const pisteCenter = Math.sin(z * 0.0028) * 32.0
    const distFromCenter = Math.abs(x - pisteCenter)

    // Amphitheater bowl depression channeling down the run
    const bowlDepth = -Math.max(0, 1.0 - distFromCenter / 420.0) * Math.sin(t * Math.PI) * 95.0

    // Mountain ridges framing the ski run on left and right
    const sideRidges = Math.pow(Math.max(0, (distFromCenter - 140.0) / 180.0), 1.35) * 75.0

    // Natural ski slope rollers, drops, and terrain knolls
    const rollers =
      Math.sin(z * 0.012) * 14.0 +
      Math.cos(x * 0.018) * 8.0 +
      Math.sin((x * 0.7 + z) * 0.007) * 11.0

    // Distant mountain ranges beyond 2400m (Whistler Valley & Blackcomb backdrop)
    let valleyFloor = valleySlope + bowlDepth + sideRidges + rollers
    if (z > 2400) {
      const extraZ = z - 2400
      valleyFloor = 650.0 - extraZ * 0.08 + Math.sin(x * 0.005) * 12.0
    }

    return Math.max(520.0, valleyFloor)
  }

  public sampleThermalFluidVelocity(
    x: number,
    y: number,
    z: number,
    timeSeconds: number = 0,
    windVector?: Vector3Like,
  ): ThermalFluidSample {
    return calculateToroidalThermalFluid(
      this.thermals,
      (gx, gz) => this.sampleHeight(gx, gz),
      x,
      y,
      z,
      timeSeconds,
      windVector,
    )
  }

  public sampleUpdraft(
    x: number,
    y: number,
    z: number,
    timeSeconds: number = 0,
    windVector?: Vector3Like,
  ): number {
    return this.sampleThermalFluidVelocity(x, y, z, timeSeconds, windVector).velocity.y
  }

  public sampleRidgeLift(
    x: number,
    y: number,
    z: number,
    windDir: { x: number; y: number; z: number },
    windSpeedMps: number,
  ): number {
    const eps = 4.0
    const hL = this.sampleHeight(x - eps, z)
    const hR = this.sampleHeight(x + eps, z)
    const hD = this.sampleHeight(x, z - eps)
    const hU = this.sampleHeight(x, z + eps)

    const dhdx = (hR - hL) / (2 * eps)
    const dhdz = (hU - hD) / (2 * eps)
    const slopeNorm = Math.sqrt(1 + dhdx * dhdx + dhdz * dhdz)

    const normalUpdraft = -(windDir.x * dhdx + windDir.z * dhdz) / slopeNorm

    const groundY = this.sampleHeight(x, z)
    const clearance = y - groundY
    if (clearance < 0 || clearance > 280) return 0

    const decay = Math.exp(-clearance / 95.0)
    return Math.max(-1.5, normalUpdraft * windSpeedMps * decay * 1.15)
  }

  public sampleVenturi(
    _x: number,
    _y: number,
    _z: number,
    baseWind: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } {
    return { x: baseWind.x, y: baseWind.y, z: baseWind.z }
  }

  public dispose() {
    try {
      this.terrainMesh.dispose(false, true)
      if (this.waterMesh) this.waterMesh.dispose(false, true)
      for (const m of this.spawnedMeshes) {
        if (m && m.dispose) m.dispose(false, true)
      }
    } catch {}
    this.spawnedMeshes = []
  }

  private scatterSkiRunPineTrees() {
    // Stylized Subalpine Evergreen Spruce Tree
    const pineCanopy = SpherePackingMeshBuilder.createTreeCanopy(
      'proto-whistler-pine',
      this.scene,
      3.2,
      new Color3(0.08, 0.32, 0.16),
    )
    const trunk = MeshBuilder.CreateCylinder(
      'proto-whistler-trunk',
      { height: 4.2, diameterTop: 0.5, diameterBottom: 0.85, tessellation: 6 },
      this.scene,
    )
    const trunkMat = new StandardMaterial('whistler-trunk-mat', this.scene)
    trunkMat.diffuseColor = new Color3(0.24, 0.16, 0.12)
    trunk.material = trunkMat

    this.spawnedMeshes.push(pineCanopy, trunk, trunkMat)

    let seed = 42
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }

    // Line the ski piste with 180 dense pine trees flanking left and right
    for (let i = 0; i < 180; i++) {
      const z = 80 + (i / 180) * 2320 + (random() - 0.5) * 20
      const pisteCenter = Math.sin(z * 0.0028) * 32.0

      // Alternate left and right flanks
      const isLeft = i % 2 === 0
      const flankOffset = isLeft
        ? -(34.0 + random() * 85.0)
        : +(34.0 + random() * 85.0)
      const x = pisteCenter + flankOffset
      const y = this.sampleHeight(x, z)

      const scale = 0.95 + random() * 0.75

      if (pineCanopy) {
        const cInst = pineCanopy.createInstance(`pine-canopy-${i}`)
        cInst.position.set(x, y + 3.4 * scale, z)
        cInst.scaling.set(scale, scale * 1.15, scale)
        this.spawnedMeshes.push(cInst)

        const tInst = trunk.createInstance(`pine-trunk-${i}`)
        tInst.position.set(x, y + 2.1 * scale, z)
        tInst.scaling.set(scale, scale, scale)
        this.spawnedMeshes.push(tInst)
      }
    }

    if (pineCanopy) pineCanopy.isVisible = false
    trunk.isVisible = false
  }

  private scatterSpherePackedClouds() {
    const cloud1 = SpherePackingMeshBuilder.createPuffyCloud(
      'whistler-cloud-1',
      this.scene,
      110,
      new Color3(0.96, 0.98, 1.0),
    )
    this.spawnedMeshes.push(cloud1)

    const cloudPositions = [
      new Vector3(-550, 1920, 350),
      new Vector3(620, 1850, 850),
      new Vector3(-680, 1720, 1500),
      new Vector3(580, 1580, 2100),
    ]

    cloudPositions.forEach((pos, idx) => {
      if (cloud1) {
        const inst = cloud1.createInstance(`cloud-inst-${idx}`)
        inst.position = pos
        inst.scaling.set(1.4, 0.8, 1.4)
        this.spawnedMeshes.push(inst)
      }
    })

    if (cloud1) cloud1.isVisible = false
  }

  private scatterBoulders() {
    const boulder = SpherePackingMeshBuilder.createBoulderCluster(
      'proto-whistler-boulder',
      this.scene,
      6.0,
      new Color3(0.38, 0.42, 0.46),
    )
    this.spawnedMeshes.push(boulder)

    let seed = 88
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }

    for (let i = 0; i < 35; i++) {
      const z = 150 + random() * 2100
      const pisteCenter = Math.sin(z * 0.0028) * 32.0
      const x = pisteCenter + (random() > 0.5 ? 1 : -1) * (38 + random() * 70)
      const y = this.sampleHeight(x, z)

      if (boulder) {
        const bInst = boulder.createInstance(`boulder-inst-${i}`)
        const sc = 0.7 + random() * 0.9
        bInst.position.set(x, y - 0.4, z)
        bInst.scaling.set(sc, sc, sc)
        bInst.rotation.y = random() * Math.PI * 2
        this.spawnedMeshes.push(bInst)
      }
    }

    if (boulder) boulder.isVisible = false
  }
}
