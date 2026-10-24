import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { SpherePackingMeshBuilder } from './SpherePackingMeshBuilder'
import type { FlightWorld, ThermalZone, Vector3Like, ThermalFluidSample, WorldObstacle } from './types'
import { calculateToroidalThermalFluid } from './ThermalFluidDynamics'

export class WhistlerMountain implements FlightWorld {
  public terrainMesh: Mesh
  public waterMesh: Mesh | null = null
  public thermals: ThermalZone[] = []
  public obstacles: WorldObstacle[] = []
  // Launch 13.5m above the groomed snow headwall for immediate proximity speed-flying!
  public readonly launchPosition = new Vector3(0, 1748, 20)
  public readonly launchHeadingDeg = 5.0 // Aim straight down the ski piste fall-line (Z+)
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

    // 5b. Alpine Ski Chalets, Olympic Village Lodges, Clock Tower & Bridge to Deek Around
    this.scatterAlpineChaletsAndVillage()

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
    // Continuous, relentless steep downhill gradient from summit (z=0) all the way to the Village (z=2400)
    // Eliminates the previous pow(t, 0.88) + sin(t*PI) flattening that made the mountain level off after launch!
    const t = Math.max(0, Math.min(1.0, z / 2400.0))
    const valleySlope = 1765.0 - t * 1140.0

    // Curving natural ski bowl centerline
    const pisteCenter = Math.sin(z * 0.0028) * 32.0
    const distFromCenter = Math.abs(x - pisteCenter)

    // Constant-depth ski corridor channel (never climbs uphill in the second half of the run!)
    const bowlDepth = -Math.max(0, 1.0 - distFromCenter / 380.0) * 32.0

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

    // Proto Slalom Gate Flag Poles (Red and Blue racing slalom markers every 40m)
    const redPole = MeshBuilder.CreateCylinder('proto-slalom-red', { height: 3.2, diameter: 0.12 }, this.scene)
    const redMat = new StandardMaterial('slalom-red-mat', this.scene)
    redMat.diffuseColor = new Color3(0.96, 0.12, 0.12)
    redPole.material = redMat

    const bluePole = MeshBuilder.CreateCylinder('proto-slalom-blue', { height: 3.2, diameter: 0.12 }, this.scene)
    const blueMat = new StandardMaterial('slalom-blue-mat', this.scene)
    blueMat.diffuseColor = new Color3(0.12, 0.45, 0.96)
    bluePole.material = blueMat

    this.spawnedMeshes.push(redPole, redMat, bluePole, blueMat)

    // Line the ski piste with 220 dense pine trees flanking close to the run edge for intense speed parallax
    for (let i = 0; i < 220; i++) {
      const z = 40 + (i / 220) * 2360 + (random() - 0.5) * 15
      const pisteCenter = Math.sin(z * 0.0028) * 32.0

      // Alternate left and right flanks - tightly hug the groomed run (16m to 42m away)
      const isLeft = i % 2 === 0
      const flankOffset = isLeft
        ? -(16.0 + random() * 26.0)
        : +(16.0 + random() * 26.0)
      const x = pisteCenter + flankOffset
      const y = this.sampleHeight(x, z)

      const scale = 0.95 + random() * 0.85

      if (pineCanopy) {
        const cInst = pineCanopy.createInstance(`pine-canopy-${i}`)
        cInst.position.set(x, y + 3.4 * scale, z)
        cInst.scaling.set(scale, scale * 1.15, scale)
        this.spawnedMeshes.push(cInst)

        const tInst = trunk.createInstance(`pine-trunk-${i}`)
        tInst.position.set(x, y + 2.1 * scale, z)
        tInst.scaling.set(scale, scale, scale)
        this.spawnedMeshes.push(tInst)

        this.obstacles.push({
          type: 'tree',
          name: 'Alpine Spruce Tree',
          x,
          yMin: y,
          yMax: y + 6.5 * scale,
          z,
          radius: 2.3 * scale,
        })
      }

      // Add racing slalom flags every ~45m down the piste
      if (i % 3 === 0) {
        const pole = isLeft ? redPole : bluePole
        const pInst = pole.createInstance(`slalom-pole-${i}`)
        const poleOffset = isLeft ? -13.0 : 13.0
        const poleX = pisteCenter + poleOffset
        const poleY = this.sampleHeight(poleX, z)
        pInst.position.set(poleX, poleY + 1.6, z)
        this.spawnedMeshes.push(pInst)
      }
    }

    if (pineCanopy) pineCanopy.isVisible = false
    trunk.isVisible = false
    redPole.isVisible = false
    bluePole.isVisible = false
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
      const x = pisteCenter + (random() > 0.5 ? 1 : -1) * (24 + random() * 55)
      const y = this.sampleHeight(x, z)

      if (boulder) {
        const bInst = boulder.createInstance(`boulder-inst-${i}`)
        const sc = 0.7 + random() * 0.9
        bInst.position.set(x, y - 0.4, z)
        bInst.scaling.set(sc, sc, sc)
        bInst.rotation.y = random() * Math.PI * 2
        this.spawnedMeshes.push(bInst)

        this.obstacles.push({
          type: 'boulder',
          name: 'Granite Cliff Boulder',
          x,
          yMin: y - 1.0,
          yMax: y + 4.2 * sc,
          z,
          radius: 3.8 * sc,
        })
      }
    }

    if (boulder) boulder.isVisible = false
  }

  private scatterAlpineChaletsAndVillage() {
    // Materials for Alpine Resort Architecture
    const woodWallMat = new StandardMaterial('chalet-wood-mat', this.scene)
    woodWallMat.diffuseColor = new Color3(0.38, 0.28, 0.20) // Rich cedar timber logs
    woodWallMat.specularColor = new Color3(0.1, 0.1, 0.1)

    const snowRoofMat = new StandardMaterial('chalet-snow-roof-mat', this.scene)
    snowRoofMat.diffuseColor = new Color3(0.96, 0.98, 1.0) // Pristine snow-capped roof
    snowRoofMat.specularColor = new Color3(0.3, 0.35, 0.4)

    const stoneMat = new StandardMaterial('chalet-stone-mat', this.scene)
    stoneMat.diffuseColor = new Color3(0.36, 0.38, 0.42) // Mountain river stone foundation & chimney
    stoneMat.specularColor = new Color3(0.15, 0.15, 0.15)

    const windowGlowMat = new StandardMaterial('chalet-window-glow-mat', this.scene)
    windowGlowMat.diffuseColor = new Color3(1.0, 0.88, 0.45)
    windowGlowMat.emissiveColor = new Color3(0.85, 0.65, 0.20) // Warm cozy hearth glow
    windowGlowMat.specularColor = new Color3(0.8, 0.8, 0.8)

    this.spawnedMeshes.push(woodWallMat, snowRoofMat, stoneMat, windowGlowMat)

    // Helper to spawn an authentic alpine chalet
    const createChalet = (name: string, x: number, z: number, scale: number = 1.0, rotY: number = 0) => {
      const y = this.sampleHeight(x, z)
      const w = 11.0 * scale
      const h = 6.0 * scale
      const d = 14.0 * scale

      // Main Timber Log Cabin Body
      const cabin = MeshBuilder.CreateBox(`${name}-body`, { width: w, height: h, depth: d }, this.scene)
      cabin.position.set(x, y + h * 0.5, z)
      cabin.rotation.y = rotY
      cabin.material = woodWallMat
      this.spawnedMeshes.push(cabin)

      // Pitched Snow Roof (A-Frame)
      const roofH = 4.5 * scale
      const roof = MeshBuilder.CreateCylinder(
        `${name}-roof`,
        { height: d * 1.08, diameterTop: 0.2, diameterBottom: w * 1.35, tessellation: 3 },
        this.scene,
      )
      roof.position.set(x, y + h + roofH * 0.4, z)
      roof.rotation.x = Math.PI / 2
      roof.rotation.y = rotY
      roof.material = snowRoofMat
      this.spawnedMeshes.push(roof)

      // Stone Fireplace Chimney
      const chimney = MeshBuilder.CreateBox(
        `${name}-chimney`,
        { width: 1.6 * scale, height: (h + roofH + 1.8) * scale, depth: 1.6 * scale },
        this.scene,
      )
      chimney.position.set(x + w * 0.38, y + (h + roofH) * 0.5, z + d * 0.25)
      chimney.rotation.y = rotY
      chimney.material = stoneMat
      this.spawnedMeshes.push(chimney)

      // Illuminated Window Glow
      const win = MeshBuilder.CreateBox(`${name}-win`, { width: 2.4 * scale, height: 1.8 * scale, depth: 0.3 }, this.scene)
      win.position.set(x, y + h * 0.55, z + d * 0.51)
      win.rotation.y = rotY
      win.material = windowGlowMat
      this.spawnedMeshes.push(win)

      this.obstacles.push({
        type: 'chalet',
        name: 'Alpine Timber Chalet',
        x,
        yMin: y,
        yMax: y + h + roofH + 1.0,
        z,
        radius: Math.max(w, d) * 0.52,
        halfWidth: w * 0.55,
        halfDepth: d * 0.55,
      })
    }

    // A. Mid-Mountain Chalet Hamlet (z = 1040 to 1440)
    // Ski cabins flanking and weaving across the bowl that the player can buzz rooftops or smash into!
    const hamletZ = [1050, 1130, 1210, 1290, 1370, 1440]
    hamletZ.forEach((z, idx) => {
      const pc = Math.sin(z * 0.0028) * 32.0
      createChalet(`chalet-l-${idx}`, pc - (28.0 + (idx % 2) * 12.0), z - 8, 1.15 + (idx % 3) * 0.15, 0.20)
      createChalet(`chalet-r-${idx}`, pc + (28.0 + ((idx + 1) % 2) * 12.0), z + 12, 1.10 + ((idx + 1) % 3) * 0.15, -0.22)
    })

    // Additional Village Chalets lining the Olympic Village approach (z = 1980 to 2380)
    const villageChaletsZ = [2010, 2090, 2310, 2380]
    villageChaletsZ.forEach((z, idx) => {
      const pc = Math.sin(z * 0.0028) * 32.0
      createChalet(`village-chalet-l-${idx}`, pc - 26.0, z, 1.2, 0.1)
      createChalet(`village-chalet-r-${idx}`, pc + 26.0, z + 10, 1.2, -0.1)
    })

    // B. Olympic Village Complex (z = 2100 to 2420)
    // 1. Alpine Clock Tower at z = 2260
    const towerX = 18.0
    const towerZ = 2260.0
    const towerGroundY = this.sampleHeight(towerX, towerZ)
    const towerBaseH = 18.0
    const towerBase = MeshBuilder.CreateBox(
      'village-clock-base',
      { width: 6.5, height: towerBaseH, depth: 6.5 },
      this.scene,
    )
    towerBase.position.set(towerX, towerGroundY + towerBaseH * 0.5, towerZ)
    towerBase.material = stoneMat

    const spireH = 8.0
    const towerSpire = MeshBuilder.CreateCylinder(
      'village-clock-spire',
      { height: spireH, diameterTop: 0.1, diameterBottom: 7.2, tessellation: 4 },
      this.scene,
    )
    towerSpire.position.set(towerX, towerGroundY + towerBaseH + spireH * 0.5, towerZ)
    towerSpire.rotation.y = Math.PI / 4
    towerSpire.material = snowRoofMat

    this.obstacles.push({
      type: 'tower',
      name: 'Olympic Village Clock Tower',
      x: towerX,
      yMin: towerGroundY,
      yMax: towerGroundY + towerBaseH + spireH,
      z: towerZ,
      radius: 4.2,
      halfWidth: 3.6,
      halfDepth: 3.6,
    })

    // 4 Glowing Clock Faces
    for (let f = 0; f < 4; f++) {
      const clockFace = MeshBuilder.CreateDisc(`clock-face-${f}`, { radius: 1.8, tessellation: 20 }, this.scene)
      const angle = (f * Math.PI) / 2
      clockFace.position.set(
        towerX + Math.sin(angle) * 3.3,
        towerGroundY + towerBaseH - 3.2,
        towerZ + Math.cos(angle) * 3.3,
      )
      clockFace.rotation.y = angle
      clockFace.material = windowGlowMat
      this.spawnedMeshes.push(clockFace)
    }
    this.spawnedMeshes.push(towerBase, towerSpire)

    // 2. Grand Mountain Ski Lodge at z = 2210, x = -34
    const lodgeX = -34.0
    const lodgeZ = 2210.0
    const lodgeY = this.sampleHeight(lodgeX, lodgeZ)
    const lodgeBody = MeshBuilder.CreateBox(
      'village-grand-lodge',
      { width: 32.0, height: 10.0, depth: 18.0 },
      this.scene,
    )
    lodgeBody.position.set(lodgeX, lodgeY + 5.0, lodgeZ)
    lodgeBody.material = woodWallMat

    const lodgeRoof = MeshBuilder.CreateCylinder(
      'village-lodge-roof',
      { height: 20.0, diameterTop: 0.4, diameterBottom: 35.0, tessellation: 3 },
      this.scene,
    )
    lodgeRoof.position.set(lodgeX, lodgeY + 13.0, lodgeZ)
    lodgeRoof.rotation.x = Math.PI / 2
    lodgeRoof.material = snowRoofMat
    this.spawnedMeshes.push(lodgeBody, lodgeRoof)

    this.obstacles.push({
      type: 'lodge',
      name: 'Whistler Grand Ski Lodge',
      x: lodgeX,
      yMin: lodgeY,
      yMax: lodgeY + 17.5,
      z: lodgeZ,
      radius: 14.0,
      halfWidth: 16.5,
      halfDepth: 9.5,
    })

    // 3. Timber Ski Bridge spanning the course at z = 2140
    // Spans 42m across the ski piste with a 9.5m clearance arch to fly under or over!
    const bridgeZ = 2140.0
    const bridgePc = Math.sin(bridgeZ * 0.0028) * 32.0
    const bridgeY = this.sampleHeight(bridgePc, bridgeZ)
    const bridgeDeck = MeshBuilder.CreateBox(
      'village-bridge-deck',
      { width: 42.0, height: 2.2, depth: 7.0 },
      this.scene,
    )
    bridgeDeck.position.set(bridgePc, bridgeY + 10.5, bridgeZ)
    bridgeDeck.material = woodWallMat

    const bridgeRoof = MeshBuilder.CreateBox(
      'village-bridge-roof',
      { width: 44.0, height: 1.2, depth: 8.5 },
      this.scene,
    )
    bridgeRoof.position.set(bridgePc, bridgeY + 14.0, bridgeZ)
    bridgeRoof.material = snowRoofMat

    // Left and Right Stone Piers
    const pierL = MeshBuilder.CreateBox('bridge-pier-l', { width: 3.5, height: 14.0, depth: 7.0 }, this.scene)
    pierL.position.set(bridgePc - 19.0, bridgeY + 7.0, bridgeZ)
    pierL.material = stoneMat

    const pierR = MeshBuilder.CreateBox('bridge-pier-r', { width: 3.5, height: 14.0, depth: 7.0 }, this.scene)
    pierR.position.set(bridgePc + 19.0, bridgeY + 7.0, bridgeZ)
    pierR.material = stoneMat

    this.obstacles.push(
      {
        type: 'bridge-pier',
        name: 'Timber Bridge Stone Pier',
        x: bridgePc - 19.0,
        yMin: bridgeY,
        yMax: bridgeY + 14.5,
        z: bridgeZ,
        radius: 3.2,
        halfWidth: 2.2,
        halfDepth: 4.0,
      },
      {
        type: 'bridge-pier',
        name: 'Timber Bridge Stone Pier',
        x: bridgePc + 19.0,
        yMin: bridgeY,
        yMax: bridgeY + 14.5,
        z: bridgeZ,
        radius: 3.2,
        halfWidth: 2.2,
        halfDepth: 4.0,
      },
      {
        type: 'bridge-deck',
        name: 'Olympic Timber Ski Bridge',
        x: bridgePc,
        yMin: bridgeY + 9.2,
        yMax: bridgeY + 15.0,
        z: bridgeZ,
        radius: 21.0,
        halfWidth: 21.5,
        halfDepth: 4.2,
      },
    )

    this.spawnedMeshes.push(bridgeDeck, bridgeRoof, pierL, pierR)
  }
}
