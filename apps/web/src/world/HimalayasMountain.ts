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
  name: string
}

export class HimalayasMountain {
  public terrainMesh: Mesh
  public riverMesh: Mesh | null = null
  public thermals: ThermalZone[] = []
  private scene: Scene

  constructor(scene: Scene) {
    this.scene = scene

    // 1. Build Colossal Himalayan Mountain Range
    // Dimensions: 16,000m x 16,000m (16 km across)
    const size = 16000
    const subdivisions = 160
    this.terrainMesh = MeshBuilder.CreateGround(
      'himalayas-terrain',
      { width: size, height: size, subdivisions, updatable: true },
      scene,
    )

    const positions = this.terrainMesh.getVerticesData(VertexBuffer.PositionKind)
    const indices = this.terrainMesh.getIndices()

    if (positions && indices) {
      const colors: number[] = []
      const normals: number[] = []

      // Stylized Himalayan High Altitude Palette
      const snowSpire = new Color3(0.96, 0.98, 1.0)
      const glacialIce = new Color3(0.82, 0.92, 0.98)
      const darkSlateGneiss = new Color3(0.36, 0.38, 0.44)
      const mountainScree = new Color3(0.52, 0.46, 0.38)
      const alpineJuniper = new Color3(0.28, 0.44, 0.26)
      const valleyTerraces = new Color3(0.24, 0.52, 0.28)
      const riverGravel = new Color3(0.68, 0.65, 0.58)

      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]
        const z = positions[i + 2]

        const y = this.sampleHeight(x, z)
        positions[i + 1] = y

        let color: Color3

        // Altitude coloration layers:
        // < 1500m: Subtropical valley floor & glacial river banks
        // 1500 - 3200m: Terraced hillsides and lush rhododendron forests
        // 3200 - 4500m: Subalpine juniper scrub & golden mountain scree
        // 4500 - 5800m: Jagged dark slate granite crags & moraine
        // 5800m+: Glacial seracs and snow spires
        if (y < 1500) {
          const t = Math.max(0, (y - 1100) / 400)
          color = Color3.Lerp(riverGravel, valleyTerraces, t)
        } else if (y < 3200) {
          const t = (y - 1500) / 1700
          color = Color3.Lerp(valleyTerraces, alpineJuniper, t)
        } else if (y < 4500) {
          const t = (y - 3200) / 1300
          color = Color3.Lerp(alpineJuniper, mountainScree, t)
        } else if (y < 5800) {
          const t = (y - 4500) / 1300
          color = Color3.Lerp(mountainScree, darkSlateGneiss, t)
        } else if (y < 6800) {
          const t = (y - 5800) / 1000
          color = Color3.Lerp(darkSlateGneiss, glacialIce, t)
        } else {
          const t = Math.min(1, (y - 6800) / 700)
          color = Color3.Lerp(glacialIce, snowSpire, t)
        }

        // Mountain rock strata variation
        const strata = 0.96 + Math.sin(y * 0.04) * Math.cos(x * 0.008) * 0.05
        colors.push(color.r * strata, color.g * strata, color.b * strata, 1.0)
      }

      VertexData.ComputeNormals(positions, indices, normals)
      this.terrainMesh.updateVerticesData(VertexBuffer.PositionKind, positions)
      this.terrainMesh.setVerticesData(VertexBuffer.NormalKind, normals)
      this.terrainMesh.setVerticesData(VertexBuffer.ColorKind, colors)
      this.terrainMesh.useVertexColors = true
    }

    const terrainMat = new StandardMaterial('himalayas-mat', scene)
    terrainMat.specularColor = new Color3(0.08, 0.08, 0.08)
    terrainMat.roughness = 0.88
    this.terrainMesh.material = terrainMat

    // 2. Glacial Turquoise River running through the deep valley floor
    const river = MeshBuilder.CreateGround('glacial-river', { width: 450, height: 16000 }, scene)
    river.position.set(-3500, 1140, 0)
    const riverMat = new StandardMaterial('river-mat', scene)
    riverMat.diffuseColor = new Color3(0.12, 0.68, 0.76)
    riverMat.specularColor = new Color3(0.9, 0.95, 1.0)
    riverMat.alpha = 0.9
    river.material = riverMat
    this.riverMesh = river

    // 3. Define 8 Powerful Thermal Updraft Chimneys for Long-Distance XC
    this.thermals = [
      { name: 'Sarangkot Launch Thermal', center: new Vector3(250, 4200, 350), radius: 280, strengthMps: 5.2 },
      { name: 'Sunlit West Ridge Updraft', center: new Vector3(-850, 4400, 1200), radius: 340, strengthMps: 5.8 },
      { name: 'Glacial Moraine Lift', center: new Vector3(1200, 4700, 2400), radius: 380, strengthMps: 6.2 },
      { name: 'Machapuchare Spires Ridge', center: new Vector3(2800, 5200, 4200), radius: 350, strengthMps: 6.5 },
      { name: 'Valley Floor Anabatic Column', center: new Vector3(-2800, 2400, 1800), radius: 450, strengthMps: 4.8 },
      { name: 'North Col High Pass Updraft', center: new Vector3(-400, 4800, 4800), radius: 320, strengthMps: 5.5 },
      { name: 'Cloud Street Thermal A', center: new Vector3(1600, 4600, 6800), radius: 400, strengthMps: 5.0 },
      { name: 'Cloud Street Thermal B', center: new Vector3(-1800, 4500, 7800), radius: 420, strengthMps: 4.7 },
    ]

    // Visual thermal markers and cumulus clouds capping each thermal chimney
    this.buildThermalCloudMarkers()

    // 4. Buddhist Stupa and Prayer Flag poles along the High Pass
    this.buildPrayerFlagsAndStupa()
  }

  public sampleHeight(x: number, z: number): number {
    // 1. High Pass Launch Plateau at (x=0, z=0) ~ 4,200m
    const distFromLaunch = Math.sqrt(x * x + z * z)
    const launchPlateau = Math.exp(-distFromLaunch * 0.003) * 350

    // 2. Colossal Peak: Mount Machapuchare (Fishtail) Pyramid at (x=2800, z=4200) ~ 7,450m
    const dPeak1 = Math.hypot(x - 2800, z - 4200)
    const peakMachapuchare = Math.max(0, 1 - dPeak1 / 2800) * 3600

    // 3. Annapurna Ridge Col at (x=-3200, z=5400) ~ 6,950m
    const dPeak2 = Math.hypot(x + 3200, z - 5400)
    const peakAnnapurna = Math.max(0, 1 - dPeak2 / 3200) * 3100

    // 4. South Spire at (x=1600, z=-4500) ~ 6,400m
    const dPeak3 = Math.hypot(x - 1600, z + 4500)
    const peakSouth = Math.max(0, 1 - dPeak3 / 2600) * 2600

    // 5. Deep Valley Floor Gorge towards x = -3500m
    const valleyCut = -Math.exp(-Math.pow((x + 3500) / 1400, 2)) * 2600

    // 6. Broad Himalayan Mountain Ridges and Moraine Waves
    const macroRidges =
      Math.sin(x * 0.00065 + z * 0.00045) * 850 +
      Math.cos(x * 0.00035 - z * 0.00075) * 750

    const mesoRidges =
      Math.sin(x * 0.0022 + z * 0.0018) * 220 +
      Math.cos(x * 0.0031) * 160

    const microRoughness =
      Math.sin(x * 0.009) * 45 +
      Math.cos(z * 0.009) * 45

    const baseAltitude = 3850
    const height =
      baseAltitude +
      macroRidges +
      mesoRidges +
      microRoughness +
      peakMachapuchare +
      peakAnnapurna +
      peakSouth +
      valleyCut +
      launchPlateau

    return Math.max(1120, height)
  }

  public sampleUpdraft(x: number, y: number, z: number): number {
    let totalUpdraft = 0

    // Thermal columns
    for (const t of this.thermals) {
      const dx = x - t.center.x
      const dz = z - t.center.z
      const distHoriz = Math.sqrt(dx * dx + dz * dz)

      // Thermal envelope from 1,200m up to cloudbase ~5,500m
      if (distHoriz < t.radius && y > 1200 && y < 5800) {
        const coreFactor = Math.cos((distHoriz / t.radius) * (Math.PI * 0.5))
        const altitudeGain = 0.7 + Math.min(0.5, (y - 1200) / 4000)
        totalUpdraft += t.strengthMps * coreFactor * altitudeGain
      }
    }

    // Anabatic Ridge Lift: Valley breezes pushed up against steep sunny mountain faces
    const terrainH = this.sampleHeight(x, z)
    const clearance = y - terrainH
    if (clearance > 15 && clearance < 350) {
      const slopeX = (this.sampleHeight(x + 20, z) - this.sampleHeight(x - 20, z)) / 40
      const slopeZ = (this.sampleHeight(x, z + 20) - this.sampleHeight(x, z - 20)) / 40
      const steepness = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ)
      if (steepness > 0.4) {
        const ridgeLift = Math.min(3.8, steepness * 2.5) * (1 - clearance / 350)
        totalUpdraft += ridgeLift
      }
    }

    return totalUpdraft
  }

  private buildThermalCloudMarkers() {
    const thermalRingMat = new StandardMaterial('himalayas-thermal-ring-mat', this.scene)
    thermalRingMat.diffuseColor = new Color3(0.98, 0.88, 0.35)
    thermalRingMat.emissiveColor = new Color3(0.98, 0.88, 0.35)
    thermalRingMat.alpha = 0.28

    for (const t of this.thermals) {
      // 1. Stacked ethereal rings marking the core of the thermal
      for (let r = 0; r < 4; r++) {
        const ring = MeshBuilder.CreateTorus(
          `himalayas-thermal-ring-${t.name}-${r}`,
          { diameter: t.radius * 0.7 + r * 35, thickness: 2.2, tessellation: 28 },
          this.scene,
        )
        ring.position.set(t.center.x, t.center.y - 80 + r * 140, t.center.z)
        ring.material = thermalRingMat
      }

      // 2. Majestic sphere-packed cumulus cloud topping the thermal at cloudbase (5,200m - 5,600m)
      SpherePackingMeshBuilder.createPuffyCloud(
        `cloudbase-cloud-${t.name}`,
        this.scene,
        t.radius * 1.8,
        new Color3(0.98, 0.99, 1.0),
      )
    }
  }

  private buildPrayerFlagsAndStupa() {
    // Traditional White Buddhist Stupa overlooking the valley on the launch knoll
    const stupaBase = MeshBuilder.CreateBox(
      'stupa-base',
      { width: 6.0, height: 2.2, depth: 6.0 },
      this.scene,
    )
    stupaBase.position.set(22, 4201, 14)
    const stupaMat = new StandardMaterial('stupa-mat', this.scene)
    stupaMat.diffuseColor = new Color3(0.96, 0.96, 0.98)
    stupaBase.material = stupaMat

    const stupaDome = MeshBuilder.CreateSphere(
      'stupa-dome',
      { diameter: 4.8, segments: 12 },
      this.scene,
    )
    stupaDome.position.set(22, 4203.8, 14)
    stupaDome.material = stupaMat

    const stupaSpire = MeshBuilder.CreateCylinder(
      'stupa-spire',
      { height: 3.5, diameterTop: 0.2, diameterBottom: 1.4, tessellation: 8 },
      this.scene,
    )
    stupaSpire.position.set(22, 4206.8, 14)
    const spireMat = new StandardMaterial('spire-mat', this.scene)
    spireMat.diffuseColor = new Color3(0.95, 0.78, 0.22)
    spireMat.emissiveColor = new Color3(0.3, 0.25, 0.05)
    stupaSpire.material = spireMat

    // Fluttering Prayer Flag Lines
    const flagColors = [
      new Color3(0.12, 0.42, 0.88), // Blue (Sky/Space)
      new Color3(0.95, 0.95, 0.95), // White (Air/Wind)
      new Color3(0.88, 0.18, 0.15), // Red (Fire)
      new Color3(0.18, 0.72, 0.28), // Green (Water)
      new Color3(0.95, 0.82, 0.18), // Yellow (Earth)
    ]

    for (let f = 0; f < 5; f++) {
      const pole = MeshBuilder.CreateCylinder(
        `prayer-pole-${f}`,
        { height: 6, diameter: 0.14 },
        this.scene,
      )
      const angle = (f / 5) * Math.PI * 2
      pole.position.set(22 + Math.cos(angle) * 7.5, 4203, 14 + Math.sin(angle) * 7.5)
      const poleMat = new StandardMaterial(`pole-mat-${f}`, this.scene)
      poleMat.diffuseColor = flagColors[f]
      pole.material = poleMat
    }
  }
}
