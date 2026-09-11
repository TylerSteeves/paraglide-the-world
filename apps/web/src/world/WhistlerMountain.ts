import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { SpherePackingMeshBuilder } from './SpherePackingMeshBuilder'

export type ThermalZone = {
  center: Vector3
  radius: number
  strengthMps: number
}

export class WhistlerMountain {
  public terrainMesh: Mesh
  public waterMesh: Mesh | null = null
  public thermals: ThermalZone[] = []
  private scene: Scene

  constructor(scene: Scene) {
    this.scene = scene

    // 1. Build Stylized Dual-Biome Terrain (Alpine Peaks cascading to Coastal Sand Dunes)
    // Mountain size: 6400m x 6400m
    const size = 6400
    const subdivisions = 144
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

      // Stylized Palette: Alpine High Peaks -> Forest Greens -> Golden Dunes -> Shoreline
      const snowSummit = new Color3(0.96, 0.98, 1.0)
      const slateRock = new Color3(0.48, 0.52, 0.56)
      const alpineMeadow = new Color3(0.32, 0.58, 0.28)
      const lushValley = new Color3(0.18, 0.44, 0.22)
      const duneGrass = new Color3(0.62, 0.68, 0.32)
      const goldenSand = new Color3(0.92, 0.78, 0.52)
      const wetSand = new Color3(0.72, 0.61, 0.44)

      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]
        const z = positions[i + 2]

        // Calculate altitude
        const y = this.sampleHeight(x, z)
        positions[i + 1] = y

        let color: Color3

        if (z > 2200) {
          // Coastal Dune & Beach Zone (Z > 2200m) - Dune du Pilat style
          if (y < 56) {
            color = wetSand
          } else {
            // Golden sand dunes with natural marram grass patches along lee ridges
            const grassPatch = Math.sin(x * 0.05) * Math.cos(z * 0.04)
            if (grassPatch > 0.52 && y > 80 && y < 150) {
              color = duneGrass
            } else {
              const sunGlint = Math.min(1, Math.max(0, (y - 65) / 140))
              color = Color3.Lerp(goldenSand, new Color3(0.96, 0.86, 0.62), sunGlint)
            }
          }
        } else {
          // Alpine Mountain Zone (Z <= 2200m)
          // 50-400m: Lush forest/sand blend
          // 400-950m: Emerald spruce forest
          // 950-1450m: Sunlit alpine grass meadows
          // 1450-1750m: Warm granite crags & slate rock
          // 1750m+: Summit snow patches
          if (y < 400) {
            const t = Math.max(0, (y - 50) / 350)
            color = Color3.Lerp(goldenSand, lushValley, t)
          } else if (y < 950) {
            const t = (y - 400) / 550
            color = Color3.Lerp(lushValley, alpineMeadow, t)
          } else if (y < 1450) {
            const t = (y - 950) / 500
            color = Color3.Lerp(alpineMeadow, slateRock, t)
          } else if (y < 1780) {
            const t = (y - 1450) / 330
            color = Color3.Lerp(slateRock, Color3.Lerp(slateRock, snowSummit, 0.45), t)
          } else {
            const t = Math.min(1, (y - 1780) / 120)
            color = Color3.Lerp(slateRock, snowSummit, t)
          }
        }

        // Soft organic shade variation
        const noise = 0.96 + Math.sin(x * 0.035) * Math.cos(z * 0.035) * 0.04
        colors.push(color.r * noise, color.g * noise, color.b * noise, 1.0)
      }

      VertexData.ComputeNormals(positions, indices, normals)
      this.terrainMesh.updateVerticesData(VertexBuffer.PositionKind, positions)
      this.terrainMesh.setVerticesData(VertexBuffer.NormalKind, normals)
      this.terrainMesh.setVerticesData(VertexBuffer.ColorKind, colors)
      this.terrainMesh.useVertexColors = true
    }

    const terrainMat = new StandardMaterial('terrain-mat', scene)
    terrainMat.specularColor = new Color3(0.06, 0.06, 0.06)
    terrainMat.roughness = 0.85
    this.terrainMesh.material = terrainMat

    // 2. Coastal Ocean / Alpine Lake Water Plane
    const water = MeshBuilder.CreateGround('ocean-plane', { width: 6400, height: 2600 }, scene)
    water.position.set(0, 48, 3800)
    const waterMat = new StandardMaterial('water-mat', scene)
    waterMat.diffuseColor = new Color3(0.12, 0.46, 0.65)
    waterMat.specularColor = new Color3(0.85, 0.92, 1.0)
    waterMat.alpha = 0.88
    water.material = waterMat
    this.waterMesh = water

    // 3. Scatter Stylized Sphere-Packed Trees
    this.scatterSpherePackedTrees()

    // 4. Scatter Sphere-Packed Puffy Clouds
    this.scatterSpherePackedClouds()

    // 5. Scatter Boulder Outcroppings
    this.scatterBoulders()

    // 6. Define Thermal Updraft Chimneys
    this.thermals = [
      { center: new Vector3(180, 1500, 450), radius: 140, strengthMps: 4.8 },
      { center: new Vector3(-240, 1320, 850), radius: 180, strengthMps: 5.2 },
      { center: new Vector3(320, 1150, 1400), radius: 210, strengthMps: 3.9 },
      { center: new Vector3(-120, 950, 1950), radius: 160, strengthMps: 4.5 },
      // Coastal Dune Ridge Lift (ocean breeze hitting dunes)
      { center: new Vector3(0, 180, 2600), radius: 600, strengthMps: 5.5 },
    ]

    // Visual rings for thermals
    const thermalMat = new StandardMaterial('thermal-mat', scene)
    thermalMat.diffuseColor = new Color3(0.98, 0.85, 0.35)
    thermalMat.emissiveColor = new Color3(0.98, 0.85, 0.35)
    thermalMat.alpha = 0.22

    for (const t of this.thermals) {
      for (let r = 0; r < 3; r++) {
        const ring = MeshBuilder.CreateTorus(
          'thermal-ring',
          { diameter: t.radius * 0.65 + r * 28, thickness: 1.6, tessellation: 24 },
          scene,
        )
        ring.position.set(t.center.x, t.center.y - 30 + r * 70, t.center.z)
        ring.material = thermalMat
      }
    }
  }

  public sampleHeight(x: number, z: number): number {
    if (z > 2200) {
      // Sweeping Coastal Sand Dunes (Dune du Pilat style)
      const duneProgress = Math.min(1, Math.max(0, (z - 2200) / 1400))
      const mainDuneRidge = Math.sin((z - 2200) * 0.005) * 85
      const duneSwells =
        Math.sin(x * 0.01 + (z - 2200) * 0.006) * 22 +
        Math.cos(x * 0.018) * 12

      const seaDescent = (1 - duneProgress) * 90
      const height = 54 + Math.max(0, mainDuneRidge * 0.6 + duneSwells + seaDescent)
      return height
    }

    // Panoramic Alpine Valley Descent (Z <= 2200m)
    // Mountain launch ridge at (0, 0) ~ 1720m (pilot starts at 2050m with 330m clearance above the peak!)
    const valleySlope = 1720 - z * 0.72

    // Distant mountain amphitheater walls pushed out wide to |x| > 600m
    const westRidge = Math.pow(Math.max(0, -x - 580) / 75, 1.3) * 35
    const eastRidge = Math.pow(Math.max(0, x - 580) / 75, 1.3) * 35

    // Smooth wide alpine bowl
    const bowlDepth = -Math.max(0, 420 - Math.abs(x) * 0.65) * Math.sin(Math.min(Math.PI * 0.5, z * 0.0016)) * 12

    // Gentle natural mountain undulations
    const rollingHills =
      Math.sin(x * 0.004) * 45 +
      Math.cos(z * 0.0035) * 40 +
      Math.sin((x + z) * 0.008) * 22

    const height = valleySlope + westRidge + eastRidge + bowlDepth + rollingHills
    return Math.max(54, height)
  }

  public sampleUpdraft(x: number, y: number, z: number): number {
    let totalUpdraft = 0
    for (const t of this.thermals) {
      const dx = x - t.center.x
      const dz = z - t.center.z
      const distHoriz = Math.sqrt(dx * dx + dz * dz)
      if (distHoriz < t.radius && y > t.center.y - 120 && y < t.center.y + 750) {
        const coreIntensity = 1 - distHoriz / t.radius
        totalUpdraft += t.strengthMps * coreIntensity
      }
    }
    return totalUpdraft
  }

  private scatterSpherePackedTrees() {
    // 1. Stylized Tree Canopy Prototype using Sphere Packing
    const pineCanopy = SpherePackingMeshBuilder.createTreeCanopy(
      'proto-pine-canopy',
      this.scene,
      2.6,
      new Color3(0.14, 0.46, 0.22),
    )
    const deciduousCanopy = SpherePackingMeshBuilder.createTreeCanopy(
      'proto-deciduous-canopy',
      this.scene,
      3.2,
      new Color3(0.24, 0.58, 0.28),
    )

    const trunk = MeshBuilder.CreateCylinder(
      'proto-tree-trunk',
      { height: 3.5, diameterTop: 0.45, diameterBottom: 0.7, tessellation: 6 },
      this.scene,
    )
    const trunkMat = new StandardMaterial('trunk-mat', this.scene)
    trunkMat.diffuseColor = new Color3(0.32, 0.22, 0.16)
    trunk.material = trunkMat

    let seed = 77
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }

    // Scatter 120 tree clusters across the mid-mountain forest zones
    for (let i = 0; i < 120; i++) {
      const x = (random() - 0.5) * 2200
      const z = 300 + random() * 1800
      const y = this.sampleHeight(x, z)

      // Only grow in the green zone (500m to 1450m) and off the ski couloir center
      if (y > 450 && y < 1450 && Math.abs(x) > 55) {
        const scale = 0.85 + random() * 0.7
        const isPine = random() > 0.45
        const chosenCanopy = isPine ? pineCanopy : deciduousCanopy

        if (chosenCanopy) {
          const cInst = chosenCanopy.createInstance(`tree-canopy-${i}`)
          cInst.position.set(x, y + 2.8 * scale, z)
          cInst.scaling.set(scale, scale, scale)

          const tInst = trunk.createInstance(`tree-trunk-${i}`)
          tInst.position.set(x, y + 1.7 * scale, z)
          tInst.scaling.set(scale, scale, scale)
        }
      }
    }

    if (pineCanopy) pineCanopy.isVisible = false
    if (deciduousCanopy) deciduousCanopy.isVisible = false
    trunk.isVisible = false
  }

  private scatterSpherePackedClouds() {
    // 2. Stylized Volumetric Clouds drifting at alpine inversion height
    const cloud1 = SpherePackingMeshBuilder.createPuffyCloud(
      'proto-cloud-1',
      this.scene,
      95,
      new Color3(0.97, 0.98, 1.0),
    )
    const cloud2 = SpherePackingMeshBuilder.createPuffyCloud(
      'proto-cloud-2',
      this.scene,
      130,
      new Color3(0.92, 0.95, 0.98),
    )

    const cloudPositions = [
      new Vector3(-420, 1680, 250),
      new Vector3(560, 1620, 680),
      new Vector3(-680, 1540, 1200),
      new Vector3(380, 1480, 1750),
      new Vector3(-280, 1390, 2300),
      new Vector3(720, 1320, 2900),
      new Vector3(-180, 1250, 3400),
    ]

    cloudPositions.forEach((pos, idx) => {
      const chosen = idx % 2 === 0 ? cloud1 : cloud2
      if (chosen) {
        const inst = chosen.createInstance(`cloud-inst-${idx}`)
        inst.position = pos
        inst.scaling.set(1.2, 0.9, 1.2)
      }
    })

    if (cloud1) cloud1.isVisible = false
    if (cloud2) cloud2.isVisible = false
  }

  private scatterBoulders() {
    const boulder = SpherePackingMeshBuilder.createBoulderCluster(
      'proto-boulder',
      this.scene,
      5.5,
      new Color3(0.56, 0.52, 0.48),
    )

    let seed = 129
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }

    for (let i = 0; i < 45; i++) {
      const x = (random() - 0.5) * 1600
      const z = 200 + random() * 2600
      const y = this.sampleHeight(x, z)

      if (boulder && y > 180) {
        const bInst = boulder.createInstance(`boulder-inst-${i}`)
        const sc = 0.6 + random() * 0.9
        bInst.position.set(x, y - 0.5, z)
        bInst.scaling.set(sc, sc, sc)
        bInst.rotation.y = random() * Math.PI * 2
      }
    }

    if (boulder) boulder.isVisible = false
  }
}
