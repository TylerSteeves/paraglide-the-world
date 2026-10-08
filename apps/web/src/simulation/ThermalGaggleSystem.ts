import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import type { ThermalZone, Vector3Like } from '../world/types'

export interface GagglePilotConfig {
  name: string
  canopyColor: Color3
  underColor: Color3
  pilotColor: Color3
  thermalIndex: number
  initialAltitudeOffset: number
  initialAngle: number
  circleRadius: number
  turnRate: number // rad/s
}

export class AIGlider {
  public rootNode: TransformNode
  public canopyMesh: Mesh
  public linesMesh: LinesMesh
  public harnessMesh: Mesh
  public name: string

  public state: 'thermalling' | 'gliding' = 'thermalling'
  public position: Vector3
  public heading: number = 0 // radians
  public bankAngle: number = 0 // radians
  public pitchAngle: number = 0.12 // slight glide trim pitch
  public altitude: number
  public orbitAngle: number
  public orbitRadius: number
  public turnRate: number
  public currentThermalIndex: number

  private baseAlt: number
  private ceilingAlt: number
  private glideTarget: Vector3 = new Vector3()
  private glideSpeed: number = 11.5 // m/s
  private sinkRate: number = 1.05 // m/s

  constructor(
    scene: Scene,
    config: GagglePilotConfig,
    thermals: ThermalZone[],
  ) {
    this.name = config.name
    this.currentThermalIndex = config.thermalIndex
    const th = thermals[this.currentThermalIndex] || thermals[0]

    this.baseAlt = th ? th.center.y + 80 : 1000
    this.ceilingAlt = th?.topAltitude ?? (this.baseAlt + 1650)
    this.altitude = this.baseAlt + config.initialAltitudeOffset
    this.orbitAngle = config.initialAngle
    this.orbitRadius = config.circleRadius
    this.turnRate = config.turnRate
    this.position = new Vector3(
      th.center.x + Math.cos(this.orbitAngle) * this.orbitRadius,
      this.altitude,
      th.center.z + Math.sin(this.orbitAngle) * this.orbitRadius,
    )

    this.rootNode = new TransformNode(`ai-glider-${config.name}`, scene)

    // 1. Build Canopy Ribbon
    const numCells = 16
    const halfSpan = 5.8
    const chord = 2.1
    const upperRibbon: Vector3[] = []
    const attachmentPts: Vector3[] = []

    for (let c = 0; c <= numCells; c++) {
      const u = c / numCells
      const x = -halfSpan + u * halfSpan * 2
      const normX = Math.abs(x) / halfSpan

      const archY = (1 - Math.pow(normX, 1.9)) * 1.6
      const sweepZ = Math.pow(normX, 1.7) * 0.85
      const taperChord = chord * (1 - normX * 0.35)
      const leZ = sweepZ + taperChord * 0.45
      const teZ = sweepZ - taperChord * 0.55

      upperRibbon.push(new Vector3(x, archY + 0.3, leZ))
      upperRibbon.push(new Vector3(x, archY, teZ))

      if (c % 2 === 0) {
        attachmentPts.push(new Vector3(x, archY, (leZ + teZ) * 0.5))
      }
    }

    this.canopyMesh = MeshBuilder.CreateRibbon(
      `ai-canopy-${config.name}`,
      {
        pathArray: [
          upperRibbon.filter((_, idx) => idx % 2 === 0),
          upperRibbon.filter((_, idx) => idx % 2 === 1),
        ],
        updatable: false,
      },
      scene,
    )

    const canopyMat = new StandardMaterial(`ai-canopy-mat-${config.name}`, scene)
    canopyMat.diffuseColor = config.canopyColor
    canopyMat.specularColor = new Color3(0.2, 0.2, 0.2)
    canopyMat.backFaceCulling = false
    this.canopyMesh.material = canopyMat
    this.canopyMesh.parent = this.rootNode

    // 2. Build Suspension Lines
    const carabinerL = new Vector3(-0.25, -5.5, 0.05)
    const carabinerR = new Vector3(0.25, -5.5, 0.05)
    const linePairs: Vector3[][] = []
    for (const pt of attachmentPts) {
      linePairs.push([pt, pt.x < 0 ? carabinerL : carabinerR])
    }

    this.linesMesh = MeshBuilder.CreateLineSystem(
      `ai-lines-${config.name}`,
      { lines: linePairs },
      scene,
    )
    this.linesMesh.color = new Color3(0.85, 0.85, 0.9)
    this.linesMesh.parent = this.rootNode

    // 3. Build Streamlined Pilot Pod Harness
    this.harnessMesh = MeshBuilder.CreateCapsule(
      `ai-pilot-${config.name}`,
      { radius: 0.22, height: 1.2, tessellation: 8 },
      scene,
    )
    const pilotMat = new StandardMaterial(`ai-pilot-mat-${config.name}`, scene)
    pilotMat.diffuseColor = config.pilotColor
    this.harnessMesh.material = pilotMat
    this.harnessMesh.position.set(0, -5.6, 0.1)
    this.harnessMesh.rotation.x = 0.55 // Reclined pod harness
    this.harnessMesh.parent = this.rootNode

    this.rootNode.rotationQuaternion = new Quaternion()
  }

  public update(dt: number, thermals: ThermalZone[], wind: Vector3Like) {
    const th = thermals[this.currentThermalIndex] || thermals[0]

    if (this.state === 'thermalling') {
      // Circle inside the macro thermal carousel
      this.orbitAngle += this.turnRate * dt
      const climbSpeed = th.strengthMps - this.sinkRate
      this.altitude += climbSpeed * dt

      // Conical expansion with altitude & downwind wind drift tilt
      const altDelta = this.altitude - th.center.y
      const totalH = Math.max(1, this.ceilingAlt - this.baseAlt)
      const altFrac = Math.min(1.0, Math.max(0, altDelta / totalH))
      const funnel = 1.0 + ((th.expansionRatio ?? 2.0) - 1.0) * altFrac * 0.75
      const curRadius = this.orbitRadius * funnel

      const tiltRate = 0.22
      const driftX = wind.x * tiltRate * altDelta
      const driftZ = wind.z * tiltRate * altDelta

      this.position.x = th.center.x + Math.cos(this.orbitAngle) * curRadius + driftX
      this.position.y = this.altitude
      this.position.z = th.center.z + Math.sin(this.orbitAngle) * curRadius + driftZ

      // Inward banking turn: roll into center of thermal (~24 deg bank)
      this.heading = this.orbitAngle + Math.PI * 0.5
      this.bankAngle = -0.42

      // Reached cloud base! Transition to XC cross-country glide
      if (this.altitude >= this.ceilingAlt) {
        this.state = 'gliding'
        // Target next thermal in sequence
        const nextIdx = (this.currentThermalIndex + 1) % thermals.length
        const nextTh = thermals[nextIdx]
        this.glideTarget.set(nextTh.center.x, nextTh.center.y + 500, nextTh.center.z)
      }
    } else {
      // Gliding toward next thermal waypoint
      const toTarget = this.glideTarget.subtract(this.position)
      toTarget.y = 0
      const dist = toTarget.length()

      if (dist < 180 || this.altitude <= this.baseAlt + 180) {
        // Arrived at next thermal! Transition back to thermalling spiral
        this.state = 'thermalling'
        this.currentThermalIndex = (this.currentThermalIndex + 1) % thermals.length
        this.altitude = Math.max(this.baseAlt + 140, this.altitude)
        this.orbitAngle = Math.atan2(this.position.z - th.center.z, this.position.x - th.center.x)
      } else {
        toTarget.normalize()
        this.heading = Math.atan2(toTarget.x, toTarget.z)
        this.bankAngle = 0 // Wings level glide

        // Forward glide + wind drift
        this.position.x += (toTarget.x * this.glideSpeed + wind.x) * dt
        this.position.z += (toTarget.z * this.glideSpeed + wind.z) * dt
        this.position.y -= this.sinkRate * dt
        this.altitude = this.position.y
      }
    }

    // Apply 3D Transform & Quaternions
    this.rootNode.position.copyFrom(this.position)

    const qYaw = Quaternion.RotationAxis(Vector3.Up(), this.heading)
    const qPitch = Quaternion.RotationAxis(Vector3.Right(), this.pitchAngle)
    const qRoll = Quaternion.RotationAxis(Vector3.Forward(), this.bankAngle)

    if (this.rootNode.rotationQuaternion) {
      qYaw.multiplyToRef(qPitch, this.rootNode.rotationQuaternion)
      this.rootNode.rotationQuaternion.multiplyInPlace(qRoll)
    }
  }

  public dispose() {
    this.canopyMesh.dispose()
    this.linesMesh.dispose()
    this.harnessMesh.dispose()
    this.rootNode.dispose()
  }
}

export class ThermalGaggleSystem {
  private scene: Scene
  private gliders: AIGlider[] = []
  private thermals: ThermalZone[] = []

  constructor(scene: Scene) {
    this.scene = scene
  }

  public setThermals(thermals: ThermalZone[]) {
    this.dispose()
    this.thermals = thermals
    if (!thermals || thermals.length === 0) return

    // 'El Enjambre de Pilotos' (Copa Niviuk 2025): 24 Competition & XC Pilots in Multi-Tiered Swarm
    const gaggleConfigs: GagglePilotConfig[] = [
      // Primary Swarm Carousel in Main Valley Thermal (Bodegas de Zinc / Tierra Arada)
      {
        name: 'Pilot-01 (Niviuk Neon Lime)',
        canopyColor: new Color3(0.2, 0.95, 0.15),
        underColor: new Color3(0.05, 0.35, 0.08),
        pilotColor: new Color3(0.12, 0.15, 0.2),
        thermalIndex: Math.min(2, thermals.length - 1),
        initialAltitudeOffset: 150,
        initialAngle: 0,
        circleRadius: 95,
        turnRate: 0.35,
      },
      {
        name: 'Pilot-02 (Ozone Enzo Electric Orange)',
        canopyColor: new Color3(0.98, 0.42, 0.05),
        underColor: new Color3(0.9, 0.9, 0.95),
        pilotColor: new Color3(0.2, 0.22, 0.25),
        thermalIndex: Math.min(2, thermals.length - 1),
        initialAltitudeOffset: 240,
        initialAngle: Math.PI * 0.45,
        circleRadius: 105,
        turnRate: 0.34,
      },
      {
        name: 'Pilot-03 (Gin Boomerang Solar Gold)',
        canopyColor: new Color3(0.98, 0.82, 0.08),
        underColor: new Color3(0.15, 0.35, 0.75),
        pilotColor: new Color3(0.1, 0.1, 0.12),
        thermalIndex: Math.min(2, thermals.length - 1),
        initialAltitudeOffset: 340,
        initialAngle: Math.PI * 0.95,
        circleRadius: 115,
        turnRate: 0.35,
      },
      {
        name: 'Pilot-04 (Flow XCRacer Cyber Fuchsia)',
        canopyColor: new Color3(0.92, 0.12, 0.58),
        underColor: new Color3(0.25, 0.05, 0.35),
        pilotColor: new Color3(0.15, 0.18, 0.24),
        thermalIndex: Math.min(2, thermals.length - 1),
        initialAltitudeOffset: 460,
        initialAngle: Math.PI * 1.45,
        circleRadius: 100,
        turnRate: 0.35,
      },
      {
        name: 'Pilot-05 (Advance Omega Azure Cyan)',
        canopyColor: new Color3(0.08, 0.75, 0.95),
        underColor: new Color3(0.95, 0.95, 0.98),
        pilotColor: new Color3(0.18, 0.2, 0.22),
        thermalIndex: Math.min(2, thermals.length - 1),
        initialAltitudeOffset: 570,
        initialAngle: 0.3,
        circleRadius: 120,
        turnRate: 0.34,
      },
      {
        name: 'Pilot-06 (Niviuk Crimson Racing)',
        canopyColor: new Color3(0.92, 0.15, 0.15),
        underColor: new Color3(0.1, 0.1, 0.1),
        pilotColor: new Color3(0.08, 0.08, 0.1),
        thermalIndex: Math.min(2, thermals.length - 1),
        initialAltitudeOffset: 680,
        initialAngle: 1.6,
        circleRadius: 110,
        turnRate: 0.35,
      },
      {
        name: 'Pilot-07 (UP Guru Electric Teal)',
        canopyColor: new Color3(0.05, 0.88, 0.72),
        underColor: new Color3(0.08, 0.15, 0.18),
        pilotColor: new Color3(0.15, 0.15, 0.18),
        thermalIndex: Math.min(2, thermals.length - 1),
        initialAltitudeOffset: 800,
        initialAngle: 2.9,
        circleRadius: 125,
        turnRate: 0.33,
      },
      {
        name: 'Pilot-08 (Ozone Pure White & Red)',
        canopyColor: new Color3(0.96, 0.96, 0.98),
        underColor: new Color3(0.85, 0.12, 0.12),
        pilotColor: new Color3(0.12, 0.12, 0.15),
        thermalIndex: Math.min(2, thermals.length - 1),
        initialAltitudeOffset: 920,
        initialAngle: 4.1,
        circleRadius: 105,
        turnRate: 0.35,
      },
      {
        name: 'Pilot-09 (Kortel Submarine Solar Yellow)',
        canopyColor: new Color3(1.0, 0.92, 0.15),
        underColor: new Color3(0.05, 0.05, 0.08),
        pilotColor: new Color3(0.2, 0.2, 0.05),
        thermalIndex: Math.min(2, thermals.length - 1),
        initialAltitudeOffset: 1040,
        initialAngle: 5.3,
        circleRadius: 130,
        turnRate: 0.34,
      },
      {
        name: 'Pilot-10 (Gin Royal Purple)',
        canopyColor: new Color3(0.55, 0.15, 0.85),
        underColor: new Color3(0.92, 0.92, 0.95),
        pilotColor: new Color3(0.14, 0.14, 0.18),
        thermalIndex: Math.min(2, thermals.length - 1),
        initialAltitudeOffset: 1160,
        initialAngle: 0.9,
        circleRadius: 115,
        turnRate: 0.35,
      },
      {
        name: 'Pilot-11 (Niviuk Icepeak Flame)',
        canopyColor: new Color3(0.98, 0.32, 0.05),
        underColor: new Color3(0.95, 0.78, 0.1),
        pilotColor: new Color3(0.18, 0.15, 0.12),
        thermalIndex: Math.min(2, thermals.length - 1),
        initialAltitudeOffset: 1280,
        initialAngle: 2.2,
        circleRadius: 120,
        turnRate: 0.34,
      },
      {
        name: 'Pilot-12 (Ozone Enzo Midnight Blue)',
        canopyColor: new Color3(0.08, 0.22, 0.75),
        underColor: new Color3(0.92, 0.92, 0.95),
        pilotColor: new Color3(0.1, 0.12, 0.18),
        thermalIndex: Math.min(2, thermals.length - 1),
        initialAltitudeOffset: 1400,
        initialAngle: 3.7,
        circleRadius: 125,
        turnRate: 0.35,
      },

      // Granja Solar Farm Low Save Pack (Climbing vigorously from low ground trigger)
      {
        name: 'Pilot-13 (Solar Low Save Alpha)',
        canopyColor: new Color3(0.15, 0.92, 0.45),
        underColor: new Color3(0.05, 0.2, 0.1),
        pilotColor: new Color3(0.12, 0.15, 0.15),
        thermalIndex: Math.min(3, thermals.length - 1),
        initialAltitudeOffset: 120,
        initialAngle: 0.4,
        circleRadius: 90,
        turnRate: 0.36,
      },
      {
        name: 'Pilot-14 (Solar Low Save Bravo)',
        canopyColor: new Color3(0.98, 0.55, 0.08),
        underColor: new Color3(0.9, 0.9, 0.95),
        pilotColor: new Color3(0.15, 0.18, 0.22),
        thermalIndex: Math.min(3, thermals.length - 1),
        initialAltitudeOffset: 250,
        initialAngle: 1.8,
        circleRadius: 100,
        turnRate: 0.35,
      },
      {
        name: 'Pilot-15 (Solar Low Save Charlie)',
        canopyColor: new Color3(0.08, 0.65, 0.98),
        underColor: new Color3(0.05, 0.12, 0.25),
        pilotColor: new Color3(0.1, 0.1, 0.12),
        thermalIndex: Math.min(3, thermals.length - 1),
        initialAltitudeOffset: 400,
        initialAngle: 3.2,
        circleRadius: 110,
        turnRate: 0.35,
      },
      {
        name: 'Pilot-16 (Solar Low Save Delta)',
        canopyColor: new Color3(0.92, 0.22, 0.68),
        underColor: new Color3(0.95, 0.95, 0.98),
        pilotColor: new Color3(0.18, 0.15, 0.18),
        thermalIndex: Math.min(3, thermals.length - 1),
        initialAltitudeOffset: 550,
        initialAngle: 4.6,
        circleRadius: 115,
        turnRate: 0.34,
      },
      {
        name: 'Pilot-17 (Solar Mid Pack Echo)',
        canopyColor: new Color3(0.88, 0.85, 0.12),
        underColor: new Color3(0.15, 0.25, 0.45),
        pilotColor: new Color3(0.14, 0.14, 0.16),
        thermalIndex: Math.min(3, thermals.length - 1),
        initialAltitudeOffset: 720,
        initialAngle: 5.9,
        circleRadius: 120,
        turnRate: 0.35,
      },
      {
        name: 'Pilot-18 (Solar High Pack Foxtrot)',
        canopyColor: new Color3(0.95, 0.18, 0.18),
        underColor: new Color3(0.08, 0.08, 0.1),
        pilotColor: new Color3(0.12, 0.12, 0.15),
        thermalIndex: Math.min(3, thermals.length - 1),
        initialAltitudeOffset: 900,
        initialAngle: 1.1,
        circleRadius: 125,
        turnRate: 0.34,
      },

      // House Mountain Thermal (Right off launch)
      {
        name: 'Pilot-19 (Launch Ridge Falcon)',
        canopyColor: new Color3(0.15, 0.78, 0.98),
        underColor: new Color3(0.95, 0.95, 0.98),
        pilotColor: new Color3(0.15, 0.18, 0.2),
        thermalIndex: 0,
        initialAltitudeOffset: 140,
        initialAngle: 0.7,
        circleRadius: 85,
        turnRate: 0.36,
      },
      {
        name: 'Pilot-20 (Launch Ridge Hawk)',
        canopyColor: new Color3(0.98, 0.45, 0.1),
        underColor: new Color3(0.08, 0.12, 0.22),
        pilotColor: new Color3(0.12, 0.12, 0.14),
        thermalIndex: 0,
        initialAltitudeOffset: 280,
        initialAngle: 2.8,
        circleRadius: 95,
        turnRate: 0.35,
      },
      {
        name: 'Pilot-21 (Launch Ridge Eagle)',
        canopyColor: new Color3(0.95, 0.85, 0.15),
        underColor: new Color3(0.2, 0.45, 0.15),
        pilotColor: new Color3(0.14, 0.14, 0.16),
        thermalIndex: 0,
        initialAltitudeOffset: 450,
        initialAngle: 4.9,
        circleRadius: 105,
        turnRate: 0.34,
      },

      // 65km Mountain XC Flight Squad (Roldanillo to Lago Calima Pioneers)
      {
        name: 'Oneiver Mejia (Gin Bonanza 2 - EN-C)',
        canopyColor: new Color3(0.98, 0.28, 0.15), // Coral Red & Black
        underColor: new Color3(0.95, 0.95, 0.98),
        pilotColor: new Color3(0.08, 0.08, 0.12),
        thermalIndex: Math.min(1, thermals.length - 1),
        initialAltitudeOffset: 450,
        initialAngle: 1.5,
        circleRadius: 105,
        turnRate: 0.35,
      },
      {
        name: 'Edwin Sánchez (Ozone Rush 6 - EN-B+)',
        canopyColor: new Color3(0.12, 0.55, 0.95), // Royal Blue & White
        underColor: new Color3(0.95, 0.18, 0.18),
        pilotColor: new Color3(0.12, 0.14, 0.15),
        thermalIndex: Math.min(1, thermals.length - 1),
        initialAltitudeOffset: 620,
        initialAngle: 3.4,
        circleRadius: 110,
        turnRate: 0.34,
      },
      {
        name: 'Jhon Alexander Cardona (Gin Camino - EN-C)',
        canopyColor: new Color3(0.05, 0.88, 0.75), // Turquoise & White
        underColor: new Color3(0.95, 0.95, 0.98),
        pilotColor: new Color3(0.16, 0.18, 0.22),
        thermalIndex: Math.min(1, thermals.length - 1),
        initialAltitudeOffset: 780,
        initialAngle: 5.1,
        circleRadius: 115,
        turnRate: 0.35,
      },
    ]

    for (const cfg of gaggleConfigs) {
      this.gliders.push(new AIGlider(this.scene, cfg, this.thermals))
    }
  }

  public update(dt: number, wind: Vector3Like) {
    for (const glider of this.gliders) {
      glider.update(dt, this.thermals, wind)
    }
  }

  public dispose() {
    for (const glider of this.gliders) {
      glider.dispose()
    }
    this.gliders = []
  }
}
