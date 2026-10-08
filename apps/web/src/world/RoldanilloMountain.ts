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

export type VenturiCanyon = {
  center: Vector3
  radius: number
  accelerationFactor: number
  turbulenceFactor: number
}

/**
 * Roldanillo to Lago Calima - Andean Mountain Ridge Soaring
 * Inspired by the 65km cross-country mountain flight along the Cordillera Occidental.
 *
 * Topography:
 * - Continuous knife-edge mountain spine towering from 2,050m to 2,480m
 * - 1,400m sheer vertical relief dropping to the Cauca Valley (940m)
 * - Windward western cliff faces yielding dynamic orographic ridge lift (+3.5 to +6.0 m/s)
 * - High-altitude thermal elevator cores at mountain saddles and amphitheaters
 * - Minimalist low-color alpine palette: graphite cliffs, ivory chalk crests, slate valleys
 */
export class RoldanilloMountain implements FlightWorld {
  public terrainMesh: Mesh
  public riverMesh: Mesh | null = null
  public thermals: ThermalZone[] = []
  public venturiCanyons: VenturiCanyon[] = []
  private spawnedMeshes: Mesh[] = []
  private scene: Scene

  // Launch coordinates: On the windward western slope crest at 2,395m, facing SSW (195°) with 50m+ slope clearance
  public readonly launchPosition = new Vector3(70, 2395, 10)
  public readonly launchHeadingDeg = 195.0 // SSW down the windward lift face toward Lago Calima

  constructor(scene: Scene) {
    this.scene = scene

    // 1. Build Andean Mountain Chain Terrain (9,600m x 9,600m)
    const size = 9600
    const subdivisions = 180
    this.terrainMesh = MeshBuilder.CreateGround(
      'roldanillo-terrain',
      { width: size, height: size, subdivisions, updatable: true },
      scene,
    )
    this.spawnedMeshes.push(this.terrainMesh)

    const positions = this.terrainMesh.getVerticesData(VertexBuffer.PositionKind)
    const indices = this.terrainMesh.getIndices()

    if (positions && indices) {
      const colors: number[] = []
      const normals: number[] = []

      // Low-Color Minimalist Andean Palette:
      // Graphite cliffs, dark slate couloirs, muted mist valleys, crisp ivory chalk crests
      const deepGraphiteRock = new Color3(0.16, 0.18, 0.20)
      const slateCliff = new Color3(0.24, 0.26, 0.29)
      const highAlpinePasture = new Color3(0.28, 0.32, 0.29)
      const valleyMistSlate = new Color3(0.20, 0.23, 0.25)
      const ivoryCrest = new Color3(0.85, 0.88, 0.90)

      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]
        const z = positions[i + 2]

        const y = this.sampleHeight(x, z)
        positions[i + 1] = y

        // Compute distance from knife-edge spine
        const spineX = this.sampleRidgeSpineX(z)
        const distFromSpine = Math.abs(x - spineX)

        let color: Color3

        if (y > 2240 && distFromSpine < 55) {
          // Razor knife-edge crest: crisp ivory / chalk accent
          const crestBlend = Math.min(1.0, (y - 2240) / 140) * (1.0 - distFromSpine / 55)
          color = Color3.Lerp(slateCliff, ivoryCrest, crestBlend * 0.85)
        } else if (y > 1750) {
          // Steep mountain face and rock cliffs
          const rockPattern = Math.sin(x * 0.035) * Math.cos(z * 0.035)
          color = rockPattern > 0.25 ? deepGraphiteRock : slateCliff
        } else if (y > 1250) {
          // High mountain foothills and mid-slopes
          color = Color3.Lerp(highAlpinePasture, slateCliff, 0.55)
        } else {
          // Lower valley floor
          color = valleyMistSlate
        }

        // Clean, subtle tonal variation
        const shade = 0.97 + Math.sin(x * 0.015) * Math.cos(z * 0.015) * 0.03
        colors.push(color.r * shade, color.g * shade, color.b * shade, 1.0)
      }

      VertexData.ComputeNormals(positions, indices, normals)
      this.terrainMesh.updateVerticesData(VertexBuffer.PositionKind, positions)
      this.terrainMesh.setVerticesData(VertexBuffer.NormalKind, normals)
      this.terrainMesh.setVerticesData(VertexBuffer.ColorKind, colors)
      this.terrainMesh.useVertexColors = true
    }

    const terrainMat = new StandardMaterial('roldanillo-mat', scene)
    terrainMat.specularColor = new Color3(0.04, 0.04, 0.05)
    terrainMat.roughness = 0.92
    this.terrainMesh.material = terrainMat

    // 2. Define High-Altitude Andean Thermal Triggers along the Ridge Highway
    this.thermals = [
      // A. El Águila House Thermal (Right off launch ridge crest)
      {
        name: 'El Águila Crest Thermal',
        center: new Vector3(140, 2380, 280),
        radius: 260,
        strengthMps: 5.5,
        cyclePeriodSeconds: 50,
        cyclePhaseOffset: 0,
        surfaceType: 'ridge-trigger',
        topAltitude: 2850,
        expansionRatio: 1.8,
      },
      // B. La Tulia Mountain Amphitheater (Sun-facing bowl at 1,150m Z)
      {
        name: 'La Tulia Amphitheater',
        center: new Vector3(320, 2260, 1150),
        radius: 340,
        strengthMps: 6.0,
        cyclePeriodSeconds: 60,
        cyclePhaseOffset: 15,
        surfaceType: 'ridge-trigger',
        topAltitude: 2900,
        expansionRatio: 2.0,
      },
      // C. Piedra del Sol Cliff Notch (2,100m Z)
      {
        name: 'Piedra del Sol Notch',
        center: new Vector3(-250, 2320, 2100),
        radius: 320,
        strengthMps: 5.8,
        cyclePeriodSeconds: 55,
        cyclePhaseOffset: 28,
        surfaceType: 'ridge-trigger',
        topAltitude: 2900,
        expansionRatio: 1.9,
      },
      // D. Paso de Darién Mountain Saddle (3,200m Z)
      {
        name: 'Paso de Darién Saddle',
        center: new Vector3(80, 2190, 3200),
        radius: 380,
        strengthMps: 5.4,
        cyclePeriodSeconds: 65,
        cyclePhaseOffset: 40,
        surfaceType: 'ridge-trigger',
        topAltitude: 2850,
        expansionRatio: 2.0,
      },
      // E. Calima Ridge Cloudbase Elevator (4,300m Z)
      {
        name: 'Lago Calima Ridge Elevator',
        center: new Vector3(-150, 2360, 4300),
        radius: 400,
        strengthMps: 6.2,
        cyclePeriodSeconds: 70,
        cyclePhaseOffset: 50,
        surfaceType: 'ridge-trigger',
        topAltitude: 2950,
        expansionRatio: 2.1,
      },
    ]

    // 3. Venturi Canyon Pass between ridge spurs
    this.venturiCanyons = [
      {
        center: new Vector3(-180, 2100, 1600),
        radius: 320,
        accelerationFactor: 1.85,
        turbulenceFactor: 0.65,
      },
    ]

    // 4. Subtle cumulus clouds capping thermals at high cloudbase
    this.buildWorldProps()
  }

  /**
   * Continuous Ridge Spine X coordinate as a function of Z distance
   */
  public sampleRidgeSpineX(z: number): number {
    return -120 + Math.sin(z * 0.0006) * 580 + Math.cos(z * 0.0015) * 220
  }

  /**
   * Procedural Heightmap: 1,400m Vertical Relief Andean Ridge Highway
   */
  public sampleHeight(x: number, z: number): number {
    // 1. Calculate spine center for this Z coordinate
    const spineX = this.sampleRidgeSpineX(z)
    const distFromSpine = x - spineX

    // 2. Ridge crest elevation along the mountain spine (2,050m to 2,480m)
    const crestAlt = 2190 + Math.sin(z * 0.00075) * 200 + Math.cos(z * 0.0019) * 110

    // 3. Asymmetric steep falloff (Western face is steeper windward cliff dropping to valley)
    const westSide = distFromSpine < 0
    const falloffFactor = westSide ? 380 : 470
    const falloff = Math.pow(Math.abs(distFromSpine) / falloffFactor, 1.38)
    const mountainMass = Math.max(940, crestAlt - falloff * 860)

    // 4. Razor knife-edge spine crest
    const razorEdge = Math.max(0, 1.0 - Math.abs(distFromSpine) / 95.0) * 55.0

    // 5. Secondary spurs, couloirs, and canyon gullies
    const spurs =
      Math.sin(x * 0.005 + z * 0.003) * 35.0 +
      Math.cos(x * 0.011 - z * 0.004) * 22.0 +
      Math.sin(z * 0.008) * 15.0

    // 6. Mountain saddles / passes connecting ridge segments
    const saddle1 = Math.exp(-Math.pow((z - 1100) / 380, 2)) * 140.0
    const saddle2 = Math.exp(-Math.pow((z - 3100) / 420, 2)) * 150.0

    const height = mountainMass + razorEdge + spurs - saddle1 - saddle2
    return Math.max(935, height)
  }

  /**
   * 3D Toroidal Convective Fluid Field (Hill's vortex lift)
   */
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

  /**
   * Dynamic Macro Thermal Updraft
   */
  public sampleUpdraft(
    x: number,
    y: number,
    z: number,
    timeSeconds: number = 0,
    windVector?: Vector3Like,
  ): number {
    return this.sampleThermalFluidVelocity(x, y, z, timeSeconds, windVector).velocity.y
  }

  /**
   * Orographic Ridge Lift (Dynamic Slope Lift)
   * Strong updraft generated by wind deflected up the steep mountain face
   */
  public sampleRidgeLift(
    x: number,
    y: number,
    z: number,
    windDir: { x: number; y: number; z: number },
    windSpeedMps: number,
  ): number {
    const eps = 6.0
    const hL = this.sampleHeight(x - eps, z)
    const hR = this.sampleHeight(x + eps, z)
    const hD = this.sampleHeight(x, z - eps)
    const hU = this.sampleHeight(x, z + eps)

    const dhdx = (hR - hL) / (2 * eps)
    const dhdz = (hU - hD) / (2 * eps)
    const slopeNorm = Math.sqrt(1 + dhdx * dhdx + dhdz * dhdz)

    // Air deflected upward along slope normal
    const normalUpdraft = -(windDir.x * dhdx + windDir.z * dhdz) / slopeNorm

    const groundY = this.sampleHeight(x, z)
    const clearance = y - groundY
    if (clearance < 0 || clearance > 320) return 0

    // Strongest 15m to 90m off the mountain rock face, smooth exponential decay above
    const decay = Math.exp(-clearance / 105.0)
    return Math.max(-1.5, normalUpdraft * windSpeedMps * decay * 1.30)
  }

  /**
   * Canyon Venturi Wind Modification
   */
  public sampleVenturi(
    x: number,
    _y: number,
    z: number,
    baseWind: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } {
    const windMod = { x: baseWind.x, y: baseWind.y, z: baseWind.z }

    for (const canyon of this.venturiCanyons) {
      const dist = Math.hypot(x - canyon.center.x, z - canyon.center.z)
      if (dist < canyon.radius) {
        const factor = 1 - dist / canyon.radius
        windMod.x *= 1.0 + (canyon.accelerationFactor - 1.0) * factor
        windMod.z *= 1.0 + (canyon.accelerationFactor - 1.0) * factor
        windMod.y -= 1.5 * factor
      }
    }

    return windMod
  }

  /**
   * Subtle Cumulus Clouds at Cloudbase (~2,750m - 2,900m)
   */
  private buildWorldProps() {
    for (let i = 0; i < this.thermals.length; i++) {
      const t = this.thermals[i]
      const cloud = SpherePackingMeshBuilder.createPuffyCloud(
        `cumulus-${i}`,
        this.scene,
        150 + (i % 3) * 40,
        new Color3(0.96, 0.97, 0.98),
      )
      if (cloud) {
        cloud.position.set(t.center.x, (t.topAltitude ?? 2850) + 40, t.center.z)
        this.spawnedMeshes.push(cloud)
      }
    }
  }

  public dispose() {
    for (const mesh of this.spawnedMeshes) {
      try {
        mesh.dispose(false, true)
      } catch {}
    }
    this.spawnedMeshes = []
  }
}
