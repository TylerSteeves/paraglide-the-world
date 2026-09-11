import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'

export type ThermalZone = {
  center: Vector3
  radius: number
  strengthMps: number
}

export class WhistlerMountain {
  public terrainMesh: Mesh
  public thermals: ThermalZone[] = []
  private scene: Scene

  constructor(scene: Scene) {
    this.scene = scene

    // 1. Build Low-Poly Faceted Terrain (Lonely Mountains Aesthetic)
    // Mountain size: 6000m x 6000m
    const size = 6400
    const subdivisions = 128
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

      // Palette (Lonely Mountains: Downhill)
      const lushValley = new Color3(0.18, 0.44, 0.22) // Emerald fir greens
      const alpineMeadow = new Color3(0.38, 0.58, 0.28) // Sunlit grassy slopes
      const warmGranite = new Color3(0.48, 0.44, 0.4) // Sun-baked cliff faces
      const alpinePeak = new Color3(0.68, 0.65, 0.62) // High alpine rock scree
      const snowDust = new Color3(0.92, 0.95, 0.98) // Summit snow patches

      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]
        const z = positions[i + 2]

        // Calculate altitude
        const y = this.sampleHeight(x, z)
        positions[i + 1] = y

        // Color based on elevation and slope
        const altT = Math.max(0, Math.min(1, (y - 700) / 1200))
        let color: Color3

        if (altT < 0.25) {
          color = Color3.Lerp(lushValley, alpineMeadow, altT / 0.25)
        } else if (altT < 0.65) {
          color = Color3.Lerp(alpineMeadow, warmGranite, (altT - 0.25) / 0.4)
        } else if (altT < 0.88) {
          color = Color3.Lerp(warmGranite, alpinePeak, (altT - 0.65) / 0.23)
        } else {
          color = Color3.Lerp(alpinePeak, snowDust, (altT - 0.88) / 0.12)
        }

        // Add subtle low-poly facet variation
        const noise = 0.94 + Math.sin(x * 0.04) * Math.cos(z * 0.04) * 0.06
        colors.push(color.r * noise, color.g * noise, color.b * noise, 1.0)
      }

      // Flat-shaded faceted look
      VertexData.ComputeNormals(positions, indices, normals)
      this.terrainMesh.updateVerticesData(VertexBuffer.PositionKind, positions)
      this.terrainMesh.setVerticesData(VertexBuffer.NormalKind, normals)
      this.terrainMesh.setVerticesData(VertexBuffer.ColorKind, colors)
      this.terrainMesh.useVertexColors = true
      this.terrainMesh.convertToFlatShadedMesh()
    }

    const terrainMat = new StandardMaterial('terrain-mat', scene)
    terrainMat.specularColor = new Color3(0.04, 0.04, 0.04)
    this.terrainMesh.material = terrainMat

    // 2. Scatter Low-Poly Alpine Pine Trees
    this.scatterTrees()

    // 3. Define Thermal Updraft Chimneys over Sun-Exposed Granite Slabs
    this.thermals = [
      { center: new Vector3(180, 1500, 450), radius: 140, strengthMps: 4.8 },
      { center: new Vector3(-240, 1320, 850), radius: 180, strengthMps: 5.2 },
      { center: new Vector3(320, 1150, 1400), radius: 210, strengthMps: 3.9 },
      { center: new Vector3(-120, 950, 1950), radius: 160, strengthMps: 4.5 },
    ]

    // Visual rings for thermals (subtle shimmering rising dust)
    const thermalMat = new StandardMaterial('thermal-mat', scene)
    thermalMat.diffuseColor = new Color3(0.98, 0.85, 0.35)
    thermalMat.emissiveColor = new Color3(0.98, 0.85, 0.35)
    thermalMat.alpha = 0.25

    for (const t of this.thermals) {
      for (let r = 0; r < 4; r++) {
        const ring = MeshBuilder.CreateTorus(
          'thermal-ring',
          { diameter: t.radius * 0.6 + r * 22, thickness: 1.8, tessellation: 28 },
          scene,
        )
        ring.position.set(t.center.x, t.center.y - 40 + r * 65, t.center.z)
        ring.material = thermalMat
      }
    }
  }

  public sampleHeight(x: number, z: number): number {
    // Whistler alpine bowl profile:
    // High rocky peak around (0, 0) ~ 1850m
    // Main mountain descent
    const valleySlope = 1850 - z * 0.38

    // Ridges and couloirs
    const westRidge = Math.pow(Math.max(0, -x - 200) / 45, 1.4) * 22
    const eastRidge = Math.pow(Math.max(0, x - 250) / 50, 1.4) * 24
    const couloirBowl = -Math.max(0, 140 - Math.abs(x) * 0.8) * Math.sin(z * 0.002) * 12

    // Faceted mountain roughness
    const mountainCrags =
      Math.sin(x * 0.006) * 110 +
      Math.cos(z * 0.005) * 95 +
      Math.sin((x + z) * 0.012) * 48 +
      Math.cos((x - z) * 0.02) * 18

    const height = valleySlope + westRidge + eastRidge + couloirBowl + mountainCrags
    return Math.max(650, height)
  }

  public sampleUpdraft(x: number, y: number, z: number): number {
    let totalUpdraft = 0
    for (const t of this.thermals) {
      const dx = x - t.center.x
      const dz = z - t.center.z
      const distHoriz = Math.sqrt(dx * dx + dz * dz)
      if (distHoriz < t.radius && y > t.center.y - 100 && y < t.center.y + 700) {
        const coreIntensity = 1 - distHoriz / t.radius
        totalUpdraft += t.strengthMps * coreIntensity
      }
    }
    return totalUpdraft
  }

  private scatterTrees() {
    // Low-poly cone pine tree template
    const treeTrunk = MeshBuilder.CreateCylinder(
      'tree-trunk',
      { height: 2.2, diameter: 0.45, tessellation: 5 },
      this.scene,
    )
    const trunkMat = new StandardMaterial('trunk-mat', this.scene)
    trunkMat.diffuseColor = new Color3(0.24, 0.16, 0.12)
    treeTrunk.material = trunkMat

    const treeFoliage = MeshBuilder.CreateCylinder(
      'tree-foliage',
      { height: 6.5, diameterTop: 0.1, diameterBottom: 3.2, tessellation: 6 },
      this.scene,
    )
    treeFoliage.position.y = 3.8
    const foliageMat = new StandardMaterial('foliage-mat', this.scene)
    foliageMat.diffuseColor = new Color3(0.12, 0.35, 0.18) // Rich spruce green
    treeFoliage.material = foliageMat

    // Scatter ~160 instances down the ski run flanks
    let seed = 42
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }

    for (let i = 0; i < 180; i++) {
      const x = (random() - 0.5) * 2200
      const z = 400 + random() * 2200
      const y = this.sampleHeight(x, z)

      // Only grow below treeline (~1450m) and off the main center ski run
      if (y < 1450 && Math.abs(x) > 60) {
        const trunkInstance = treeTrunk.createInstance(`tree-t-${i}`)
        trunkInstance.position.set(x, y + 1.1, z)
        const scale = 0.8 + random() * 0.6
        trunkInstance.scaling.set(scale, scale, scale)

        const foliageInstance = treeFoliage.createInstance(`tree-f-${i}`)
        foliageInstance.position.set(x, y + 3.8 * scale, z)
        foliageInstance.scaling.set(scale, scale, scale)
      }
    }

    treeTrunk.isVisible = false
    treeFoliage.isVisible = false
  }
}
