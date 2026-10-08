import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import type { Scene } from '@babylonjs/core/scene'
import type { ThermalZone, Vector3Like } from '../world/types'
import { LnPalette, LnStyleManager } from './LnStyleManager'

interface SoaringBird {
  mesh: Mesh
  thermalIndex: number
  altitude: number
  angle: number
  radius: number
  climbRate: number
  turnRate: number
  baseAltitude: number
  ceilingAltitude: number
}

interface VortexStream {
  thermal: ThermalZone
  // Tier 1: Core Streamlines Bundle (Fastest climb >+4.5 m/s)
  coreSpineMesh: LinesMesh
  corePoints: Vector3[]
  coreCompanionMesh: LinesMesh
  coreCompanionPoints: Vector3[]

  // Tier 2: Mid-Envelope Carousel Helices (Turn carousel for paraglider constellation)
  mainSpiralMesh: LinesMesh
  mainPoints: Vector3[]
  mainCompanionMesh: LinesMesh
  mainCompanionPoints: Vector3[]
  mainThirdMesh: LinesMesh
  mainThirdPoints: Vector3[]

  // Tier 3: Outer Shear & Entrainment Margin (Mixing with ambient cool air)
  shearOuterMesh: LinesMesh
  shearPoints: Vector3[]
  shearCounterMesh: LinesMesh
  shearCounterPoints: Vector3[]

  // Tier 4: Ascending Toroidal Pulse Rings (Horizontally stacked convective bubbles)
  toroidMeshes: LinesMesh[]
  toroidPointsArray: Vector3[][]
  toroidFracs: number[]

  // Volumetric Convective Chimney Shroud
  shroudMesh: Mesh
  shroudMaterial: StandardMaterial
  phase: number
  totalHeight: number
}

export class ThermalVortexSystem {
  private scene: Scene
  private streams: VortexStream[] = []
  private birds: SoaringBird[] = []
  private birdMaterial: StandardMaterial
  private thermals: ThermalZone[] = []
  private unsubscribeStyle: () => void

  constructor(scene: Scene) {
    this.scene = scene

    // Soaring Bird Material (Golden Eagle / Andean Condor dark plumage; warms up in FLIR)
    this.birdMaterial = new StandardMaterial('bird-mat', scene)
    this.birdMaterial.diffuseColor = new Color3(0.14, 0.11, 0.08)
    this.birdMaterial.specularColor = new Color3(0.1, 0.1, 0.1)
    this.birdMaterial.backFaceCulling = false

    // Subscribe to style & IR goggles changes
    this.unsubscribeStyle = LnStyleManager.getInstance().subscribe((palette) => {
      this.applyPalette(palette)
    })
  }

  public applyPalette(pal: LnPalette): void {
    const isIr = pal.isIrVision === true
    const isLine = pal.isLineMode

    for (const stream of this.streams) {
      // Wireframe streamlines and shroud meshes are hidden in normal modes to keep the panoramic sky completely clear
      const showMeshes = isIr
      stream.shroudMesh.isVisible = showMeshes
      stream.coreSpineMesh.isVisible = showMeshes
      stream.coreCompanionMesh.isVisible = showMeshes
      stream.mainSpiralMesh.isVisible = showMeshes
      stream.mainCompanionMesh.isVisible = showMeshes
      stream.mainThirdMesh.isVisible = showMeshes
      stream.shearOuterMesh.isVisible = showMeshes
      stream.shearCounterMesh.isVisible = showMeshes
      for (const ring of stream.toroidMeshes) {
        ring.isVisible = showMeshes
      }

      if (isIr) {
        // Infrared FLIR Ironbow spectrum:
        // Core: Incandescent White-Hot / Solar Gold (54°C)
        const coreCol = new Color3(1.0, 0.98, 0.70)
        stream.coreSpineMesh.color = coreCol
        stream.coreSpineMesh.alpha = 0.98
        stream.coreCompanionMesh.color = coreCol
        stream.coreCompanionMesh.alpha = 0.92

        // Main Carousel Helices: Radiant Flame Amber (42°C)
        const mainCol = new Color3(0.98, 0.55, 0.12)
        stream.mainSpiralMesh.color = mainCol
        stream.mainSpiralMesh.alpha = 0.92
        stream.mainCompanionMesh.color = mainCol
        stream.mainCompanionMesh.alpha = 0.88
        stream.mainThirdMesh.color = new Color3(1.0, 0.68, 0.18)
        stream.mainThirdMesh.alpha = 0.86

        // Outer Shear: Deep Magenta / Crimson (30°C)
        const shearCol = new Color3(0.85, 0.15, 0.55)
        stream.shearOuterMesh.color = shearCol
        stream.shearOuterMesh.alpha = 0.82
        stream.shearCounterMesh.color = new Color3(0.75, 0.12, 0.48)
        stream.shearCounterMesh.alpha = 0.76

        // Toroid Rings: Solar Amber
        for (const ring of stream.toroidMeshes) {
          ring.color = new Color3(1.0, 0.72, 0.20)
          ring.alpha = 0.75
        }

        // Volumetric Shroud: Warm radiant infrared chimney
        stream.shroudMaterial.alpha = 0.22
        stream.shroudMaterial.emissiveColor = new Color3(0.95, 0.42, 0.10)
      }
    }

    if (isIr) {
      // Raptors radiate bright avian body heat (39°C - 41°C) in infrared
      this.birdMaterial.diffuseColor = new Color3(1.0, 0.82, 0.25)
      this.birdMaterial.emissiveColor = new Color3(0.95, 0.70, 0.15)
    } else {
      this.birdMaterial.diffuseColor = isLine ? pal.minorContourRgb : new Color3(0.14, 0.11, 0.08)
      this.birdMaterial.emissiveColor = new Color3(0, 0, 0)
    }
  }

  public setThermals(thermals: ThermalZone[]) {
    this.dispose()
    this.thermals = thermals

    thermals.forEach((th, idx) => {
      // 1. Build Macro Convective Vortices & Cloudbase Chimney
      this.createVortexStream(th)

      // 2. Spawn 2-3 Soaring Eagles / Condors circling in the broad thermal core
      const birdCount = th.strengthMps > 5.0 ? 3 : 2
      for (let b = 0; b < birdCount; b++) {
        this.spawnSoaringBird(idx, th, b)
      }
    })

    this.applyPalette(LnStyleManager.getInstance().palette)
  }

  private createVortexStream(thermal: ThermalZone) {
    const numPoints = 80
    const baseAlt = thermal.center.y
    const topAlt = thermal.topAltitude ?? (baseAlt + 1750) // Rises directly into cloudbase (~2,650m - 2,800m)
    const totalHeight = topAlt - baseAlt
    const heightStep = totalHeight / numPoints
    const expansionRatio = thermal.expansionRatio ?? 2.0

    const corePoints: Vector3[] = []
    const coreCompanionPoints: Vector3[] = []
    const mainPoints: Vector3[] = []
    const mainCompanionPoints: Vector3[] = []
    const mainThirdPoints: Vector3[] = []
    const shearPoints: Vector3[] = []
    const shearCounterPoints: Vector3[] = []

    for (let i = 0; i < numPoints; i++) {
      const y = baseAlt + i * heightStep
      const altFrac = i / numPoints
      // Convective plume flare expanding with altitude
      const funnel = 1.0 + (expansionRatio - 1.0) * altFrac

      // Tier 1: Core Streamlines Bundle (r = 0.25 R, fast steep 4.5 turns)
      const rCore = thermal.radius * 0.25 * funnel
      const aCore1 = (i / numPoints) * Math.PI * 9
      const aCore2 = aCore1 + Math.PI // Opposite side pair
      corePoints.push(new Vector3(
        thermal.center.x + Math.cos(aCore1) * rCore,
        y,
        thermal.center.z + Math.sin(aCore1) * rCore,
      ))
      coreCompanionPoints.push(new Vector3(
        thermal.center.x + Math.cos(aCore2) * rCore,
        y,
        thermal.center.z + Math.sin(aCore2) * rCore,
      ))

      // Tier 2: Mid-Envelope Carousel Helices (r = 0.55 R, 6 sweeping turns)
      // Wide 200m-400m carousel where paraglider constellation turns
      const rMain = thermal.radius * 0.55 * funnel
      const aMain1 = (i / numPoints) * Math.PI * 12
      const aMain2 = aMain1 + (Math.PI * 2) / 3
      const aMain3 = aMain1 + (Math.PI * 4) / 3
      mainPoints.push(new Vector3(
        thermal.center.x + Math.cos(aMain1) * rMain,
        y,
        thermal.center.z + Math.sin(aMain1) * rMain,
      ))
      mainCompanionPoints.push(new Vector3(
        thermal.center.x + Math.cos(aMain2) * rMain,
        y,
        thermal.center.z + Math.sin(aMain2) * rMain,
      ))
      mainThirdPoints.push(new Vector3(
        thermal.center.x + Math.cos(aMain3) * rMain,
        y,
        thermal.center.z + Math.sin(aMain3) * rMain,
      ))

      // Tier 3: Outer Shear & Entrainment Margin (r = 0.88 R, counter 3.5 turns)
      const rShear = thermal.radius * 0.88 * funnel
      const aShear1 = -(i / numPoints) * Math.PI * 7
      const aShear2 = aShear1 + Math.PI
      shearPoints.push(new Vector3(
        thermal.center.x + Math.cos(aShear1) * rShear,
        y,
        thermal.center.z + Math.sin(aShear1) * rShear,
      ))
      shearCounterPoints.push(new Vector3(
        thermal.center.x + Math.cos(aShear2) * rShear,
        y,
        thermal.center.z + Math.sin(aShear2) * rShear,
      ))
    }

    const coreSpineMesh = MeshBuilder.CreateLines(
      `vortex-core-${thermal.name}`,
      { points: corePoints, updatable: true },
      this.scene,
    )
    const coreCompanionMesh = MeshBuilder.CreateLines(
      `vortex-core2-${thermal.name}`,
      { points: coreCompanionPoints, updatable: true },
      this.scene,
    )

    const mainSpiralMesh = MeshBuilder.CreateLines(
      `vortex-main-${thermal.name}`,
      { points: mainPoints, updatable: true },
      this.scene,
    )
    const mainCompanionMesh = MeshBuilder.CreateLines(
      `vortex-main2-${thermal.name}`,
      { points: mainCompanionPoints, updatable: true },
      this.scene,
    )
    const mainThirdMesh = MeshBuilder.CreateLines(
      `vortex-main3-${thermal.name}`,
      { points: mainThirdPoints, updatable: true },
      this.scene,
    )

    const shearOuterMesh = MeshBuilder.CreateLines(
      `vortex-shear-${thermal.name}`,
      { points: shearPoints, updatable: true },
      this.scene,
    )
    const shearCounterMesh = MeshBuilder.CreateLines(
      `vortex-shear2-${thermal.name}`,
      { points: shearCounterPoints, updatable: true },
      this.scene,
    )

    // Tier 4: Stacked Toroidal Convective Pulse Rings
    const toroidFracs = [0.22, 0.46, 0.70, 0.92]
    const toroidMeshes: LinesMesh[] = []
    const toroidPointsArray: Vector3[][] = []
    const ringSegments = 32

    for (let k = 0; k < toroidFracs.length; k++) {
      const frac = toroidFracs[k]
      const ringY = baseAlt + totalHeight * frac
      const ringR = thermal.radius * 0.60 * (1.0 + (expansionRatio - 1.0) * frac)
      const ringPts: Vector3[] = []
      for (let s = 0; s <= ringSegments; s++) {
        const theta = (s / ringSegments) * Math.PI * 2
        ringPts.push(new Vector3(
          thermal.center.x + Math.cos(theta) * ringR,
          ringY,
          thermal.center.z + Math.sin(theta) * ringR,
        ))
      }
      const ringMesh = MeshBuilder.CreateLines(
        `vortex-ring-${thermal.name}-${k}`,
        { points: ringPts, updatable: true },
        this.scene,
      )
      toroidMeshes.push(ringMesh)
      toroidPointsArray.push(ringPts)
    }

    // Volumetric Convective Chimney Shroud (Inverted expanding cone)
    const shroudMesh = MeshBuilder.CreateCylinder(
      `vortex-shroud-${thermal.name}`,
      {
        height: totalHeight,
        diameterBottom: thermal.radius * 2.0,
        diameterTop: thermal.radius * 2.0 * expansionRatio,
        tessellation: 28,
      },
      this.scene,
    )
    shroudMesh.position.set(thermal.center.x, baseAlt + totalHeight * 0.5, thermal.center.z)

    const shroudMaterial = new StandardMaterial(`vortex-shroud-mat-${thermal.name}`, this.scene)
    shroudMaterial.disableLighting = true
    shroudMaterial.backFaceCulling = false
    shroudMaterial.alpha = 0.16
    shroudMaterial.emissiveColor = new Color3(0.98, 0.65, 0.2)
    shroudMesh.material = shroudMaterial

    this.streams.push({
      thermal,
      coreSpineMesh,
      corePoints,
      coreCompanionMesh,
      coreCompanionPoints,
      mainSpiralMesh,
      mainPoints,
      mainCompanionMesh,
      mainCompanionPoints,
      mainThirdMesh,
      mainThirdPoints,
      shearOuterMesh,
      shearPoints,
      shearCounterMesh,
      shearCounterPoints,
      toroidMeshes,
      toroidPointsArray,
      toroidFracs,
      shroudMesh,
      shroudMaterial,
      phase: Math.random() * Math.PI * 2,
      totalHeight,
    })
  }

  private spawnSoaringBird(thermalIndex: number, thermal: ThermalZone, birdSubIndex: number) {
    const bird = MeshBuilder.CreatePlane(`soaring-bird-${thermal.name}-${birdSubIndex}`, { width: 2.8, height: 0.9 }, this.scene)
    bird.material = this.birdMaterial
    bird.billboardMode = Mesh.BILLBOARDMODE_NONE

    const baseAltitude = thermal.center.y + 150 + birdSubIndex * 140
    const ceilingAltitude = (thermal.topAltitude ?? (thermal.center.y + 1750)) - 100

    this.birds.push({
      mesh: bird,
      thermalIndex,
      altitude: baseAltitude,
      angle: birdSubIndex * (Math.PI * 0.65) + Math.random(),
      // Circle inside the sweet spot carousel radius (85m - 160m)
      radius: thermal.radius * (0.32 + Math.random() * 0.22),
      climbRate: thermal.strengthMps * 0.72 - 0.7,
      turnRate: 0.36,
      baseAltitude,
      ceilingAltitude,
    })
  }

  public update(
    dt: number,
    wind: Vector3Like = { x: 3.5, y: 0, z: 1.0 },
    pilotPos?: { x: number; y: number; z: number },
  ) {
    const tiltRate = 0.22 // Exact match with sampleUpdraft
    const isIr = LnStyleManager.getInstance().isIrGoggles

    // 1. Animate Helical Vortex Spirals, Toroid Rings and Volumetric Thermal Shroud
    for (const stream of this.streams) {
      stream.phase += dt * (stream.thermal.strengthMps * 0.35)
      const th = stream.thermal

      // Subtle Proximity Weather Connection:
      // Wisps fade into view organically within 220m of the thermal core, keeping panoramic views clear
      let proximityAlpha = 0
      if (pilotPos) {
        const dx = pilotPos.x - th.center.x
        const dz = pilotPos.z - th.center.z
        const distHoriz = Math.hypot(dx, dz)
        if (distHoriz < 220.0) {
          proximityAlpha = Math.max(0, 1.0 - (distHoriz - 60.0) / 160.0)
        }
      }

      if (!isIr) {
        const show = proximityAlpha > 0.02
        stream.coreSpineMesh.isVisible = show
        stream.coreCompanionMesh.isVisible = show
        stream.mainSpiralMesh.isVisible = show
        stream.mainCompanionMesh.isVisible = show
        stream.mainThirdMesh.isVisible = false
        stream.shearOuterMesh.isVisible = false
        stream.shearCounterMesh.isVisible = false
        stream.shroudMesh.isVisible = false

        if (show) {
          // Warm shimmering golden solar wisps when near the updraft
          const subtleCol = new Color3(1.0, 0.94, 0.82)
          stream.coreSpineMesh.color = subtleCol
          stream.coreSpineMesh.alpha = proximityAlpha * 0.42
          stream.coreCompanionMesh.color = subtleCol
          stream.coreCompanionMesh.alpha = proximityAlpha * 0.35
          stream.mainSpiralMesh.color = new Color3(1.0, 0.88, 0.65)
          stream.mainSpiralMesh.alpha = proximityAlpha * 0.30
          stream.mainCompanionMesh.color = new Color3(1.0, 0.88, 0.65)
          stream.mainCompanionMesh.alpha = proximityAlpha * 0.25

          for (const ring of stream.toroidMeshes) {
            ring.isVisible = true
            ring.color = new Color3(1.0, 0.92, 0.70)
            ring.alpha = proximityAlpha * 0.32
          }
        } else {
          for (const ring of stream.toroidMeshes) {
            ring.isVisible = false
          }
        }
      }
      const numPoints = stream.corePoints.length
      const baseAlt = th.center.y
      const totalHeight = stream.totalHeight
      const heightStep = totalHeight / numPoints
      const expansionRatio = th.expansionRatio ?? 2.0

      const tiltX = wind.x * tiltRate
      const tiltZ = wind.z * tiltRate

      for (let i = 0; i < numPoints; i++) {
        const y = baseAlt + i * heightStep
        const altFrac = i / numPoints
        const funnel = 1.0 + (expansionRatio - 1.0) * altFrac
        const hOffset = y - baseAlt
        const driftX = tiltX * hOffset
        const driftZ = tiltZ * hOffset

        // Core spine bundle (swirls at 1.4x speed)
        const rCore = th.radius * 0.25 * funnel
        const aCore1 = (i / numPoints) * Math.PI * 9 + stream.phase * 1.4
        const aCore2 = aCore1 + Math.PI

        stream.corePoints[i].x = th.center.x + Math.cos(aCore1) * rCore + driftX
        stream.corePoints[i].y = y
        stream.corePoints[i].z = th.center.z + Math.sin(aCore1) * rCore + driftZ

        stream.coreCompanionPoints[i].x = th.center.x + Math.cos(aCore2) * rCore + driftX
        stream.coreCompanionPoints[i].y = y
        stream.coreCompanionPoints[i].z = th.center.z + Math.sin(aCore2) * rCore + driftZ

        // Main carousel helices (3 interwoven strands)
        const rMain = th.radius * 0.55 * funnel
        const aMain1 = (i / numPoints) * Math.PI * 12 + stream.phase
        const aMain2 = aMain1 + (Math.PI * 2) / 3
        const aMain3 = aMain1 + (Math.PI * 4) / 3

        stream.mainPoints[i].x = th.center.x + Math.cos(aMain1) * rMain + driftX
        stream.mainPoints[i].y = y
        stream.mainPoints[i].z = th.center.z + Math.sin(aMain1) * rMain + driftZ

        stream.mainCompanionPoints[i].x = th.center.x + Math.cos(aMain2) * rMain + driftX
        stream.mainCompanionPoints[i].y = y
        stream.mainCompanionPoints[i].z = th.center.z + Math.sin(aMain2) * rMain + driftZ

        stream.mainThirdPoints[i].x = th.center.x + Math.cos(aMain3) * rMain + driftX
        stream.mainThirdPoints[i].y = y
        stream.mainThirdPoints[i].z = th.center.z + Math.sin(aMain3) * rMain + driftZ

        // Outer shear strands (counter-rotational)
        const rShear = th.radius * 0.88 * funnel
        const aShear1 = -(i / numPoints) * Math.PI * 7 - stream.phase * 0.75
        const aShear2 = aShear1 + Math.PI

        stream.shearPoints[i].x = th.center.x + Math.cos(aShear1) * rShear + driftX
        stream.shearPoints[i].y = y
        stream.shearPoints[i].z = th.center.z + Math.sin(aShear1) * rShear + driftZ

        stream.shearCounterPoints[i].x = th.center.x + Math.cos(aShear2) * rShear + driftX
        stream.shearCounterPoints[i].y = y
        stream.shearCounterPoints[i].z = th.center.z + Math.sin(aShear2) * rShear + driftZ
      }

      MeshBuilder.CreateLines(
        `vortex-core-${th.name}`,
        { points: stream.corePoints, instance: stream.coreSpineMesh },
        this.scene,
      )
      MeshBuilder.CreateLines(
        `vortex-core2-${th.name}`,
        { points: stream.coreCompanionPoints, instance: stream.coreCompanionMesh },
        this.scene,
      )

      MeshBuilder.CreateLines(
        `vortex-main-${th.name}`,
        { points: stream.mainPoints, instance: stream.mainSpiralMesh },
        this.scene,
      )
      MeshBuilder.CreateLines(
        `vortex-main2-${th.name}`,
        { points: stream.mainCompanionPoints, instance: stream.mainCompanionMesh },
        this.scene,
      )
      MeshBuilder.CreateLines(
        `vortex-main3-${th.name}`,
        { points: stream.mainThirdPoints, instance: stream.mainThirdMesh },
        this.scene,
      )

      MeshBuilder.CreateLines(
        `vortex-shear-${th.name}`,
        { points: stream.shearPoints, instance: stream.shearOuterMesh },
        this.scene,
      )
      MeshBuilder.CreateLines(
        `vortex-shear2-${th.name}`,
        { points: stream.shearCounterPoints, instance: stream.shearCounterMesh },
        this.scene,
      )

      // Update Toroid Pulse Rings (Pulsing and drifting with altitude)
      const ringSegments = 32
      for (let k = 0; k < stream.toroidMeshes.length; k++) {
        const ringFrac = (stream.toroidFracs[k] + (stream.phase * 0.05)) % 1.0
        const ringY = baseAlt + totalHeight * ringFrac
        const hOffset = ringY - baseAlt
        const ringDriftX = tiltX * hOffset
        const ringDriftZ = tiltZ * hOffset
        const ringR = th.radius * 0.60 * (1.0 + (expansionRatio - 1.0) * ringFrac)
        const pts = stream.toroidPointsArray[k]

        for (let s = 0; s <= ringSegments; s++) {
          const theta = (s / ringSegments) * Math.PI * 2
          pts[s].x = th.center.x + Math.cos(theta) * ringR + ringDriftX
          pts[s].y = ringY
          pts[s].z = th.center.z + Math.sin(theta) * ringR + ringDriftZ
        }

        MeshBuilder.CreateLines(
          `vortex-ring-${th.name}-${k}`,
          { points: pts, instance: stream.toroidMeshes[k] },
          this.scene,
        )
      }

      // Update Volumetric Shroud position, rotation, and tilt
      const midH = totalHeight * 0.5
      stream.shroudMesh.position.x = th.center.x + tiltX * midH
      stream.shroudMesh.position.y = baseAlt + midH
      stream.shroudMesh.position.z = th.center.z + tiltZ * midH
      stream.shroudMesh.rotation.z = -Math.atan2(tiltX * totalHeight, totalHeight)
      stream.shroudMesh.rotation.x = Math.atan2(tiltZ * totalHeight, totalHeight)

      // Convective breathing pulse
      const pulse = 1.0 + Math.sin(stream.phase * 0.75) * 0.04
      stream.shroudMesh.scaling.set(pulse, 1.0, pulse)
    }

    // 2. Animate Circling Soaring Birds in Macro Core
    for (const bird of this.birds) {
      const th = this.thermals[bird.thermalIndex]
      if (!th) continue

      bird.angle += bird.turnRate * dt
      bird.altitude += bird.climbRate * dt

      if (bird.altitude > bird.ceilingAltitude) {
        bird.altitude = bird.baseAltitude
      }

      const altDelta = bird.altitude - th.center.y
      const driftX = wind.x * tiltRate * altDelta
      const driftZ = wind.z * tiltRate * altDelta

      const x = th.center.x + Math.cos(bird.angle) * bird.radius + driftX
      const z = th.center.z + Math.sin(bird.angle) * bird.radius + driftZ

      bird.mesh.position.set(x, bird.altitude, z)

      const heading = bird.angle + Math.PI * 0.5
      bird.mesh.rotation.y = -heading
      bird.mesh.rotation.z = -0.38
      bird.mesh.rotation.x = Math.sin(bird.angle * 2.0) * 0.06
    }
  }

  public dispose() {
    this.unsubscribeStyle?.()
    for (const stream of this.streams) {
      stream.coreSpineMesh.dispose()
      stream.coreCompanionMesh.dispose()
      stream.mainSpiralMesh.dispose()
      stream.mainCompanionMesh.dispose()
      stream.mainThirdMesh.dispose()
      stream.shearOuterMesh.dispose()
      stream.shearCounterMesh.dispose()
      for (const ring of stream.toroidMeshes) {
        ring.dispose()
      }
      stream.shroudMesh.dispose()
      stream.shroudMaterial.dispose()
    }
    this.streams = []

    for (const bird of this.birds) {
      bird.mesh.dispose()
    }
    this.birds = []
  }
}
