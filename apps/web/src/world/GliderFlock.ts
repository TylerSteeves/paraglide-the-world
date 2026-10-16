import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import type { Scene } from '@babylonjs/core/scene'
import type { FlightWorld, Vector3Like } from './types'

export type AIParaglider = {
  id: string
  name: string
  rootNode: TransformNode
  canopyMesh: Mesh
  linesMesh: LinesMesh
  leftRibbonMesh: LinesMesh
  rightRibbonMesh: LinesMesh
  leftRibbonHistory: Vector3[]
  rightRibbonHistory: Vector3[]
  color: Color3
  pos: Vector3
  vel: Vector3
  headingDeg: number
  bankDeg: number
  pitchDeg: number
  mode: 'ridge_glide' | 'thermalling' | 'formation'
  assignedThermalIndex: number
  thermalAngle: number
  thermalRadius: number
  targetAltitude: number
}

const FLOCK_CONFIGS = [
  { name: 'Sky Azure', color: new Color3(0.12, 0.65, 0.98), offset: { x: -35, y: 15, z: 45 } },
  { name: 'Sunburst Gold', color: new Color3(0.98, 0.72, 0.12), offset: { x: 42, y: -8, z: 25 } },
  { name: 'Alpine Emerald', color: new Color3(0.15, 0.88, 0.45), offset: { x: -65, y: -20, z: -15 } },
  { name: 'Crimson Falcon', color: new Color3(0.95, 0.22, 0.32), offset: { x: 55, y: 22, z: 65 } },
  { name: 'Solar White', color: new Color3(0.92, 0.94, 0.98), offset: { x: -18, y: -5, z: 85 } },
]

export class GliderFlock {
  private scene: Scene
  private world: FlightWorld
  public gliders: AIParaglider[] = []
  private spawnedNodes: (TransformNode | Mesh | LinesMesh)[] = []
  private ribbonTimer: number = 0

  constructor(scene: Scene, world: FlightWorld, playerSpawn: { x: number; y: number; z: number }) {
    this.scene = scene
    this.world = world
    this.initFlock(playerSpawn)
  }

  private initFlock(playerSpawn: { x: number; y: number; z: number }): void {
    const thermals = this.world.thermals || []

    FLOCK_CONFIGS.forEach((cfg, idx) => {
      const rootNode = new TransformNode(`ai-glider-root-${idx}`, this.scene)
      const startPos = new Vector3(
        playerSpawn.x + cfg.offset.x,
        playerSpawn.y + cfg.offset.y,
        playerSpawn.z + cfg.offset.z,
      )
      rootNode.position.copyFrom(startPos)

      // Canopy Material
      const canopyMat = new StandardMaterial(`ai-canopy-mat-${idx}`, this.scene)
      canopyMat.diffuseColor = cfg.color
      canopyMat.emissiveColor = cfg.color.scale(0.38)
      canopyMat.specularColor = new Color3(0.4, 0.4, 0.4)
      canopyMat.backFaceCulling = false

      // Elegant procedural curved paraglider canopy (arc-wing)
      const span = 9.8
      const chord = 1.85
      const cells = 12
      const upperPath: Vector3[] = []
      const lowerPath: Vector3[] = []

      for (let c = 0; c <= cells; c++) {
        const u = c / cells // 0 to 1
        const x = (u - 0.5) * span
        const arch = Math.sin(u * Math.PI) * 1.35
        const sweep = Math.pow(Math.abs(u - 0.5) * 2, 1.8) * 0.45
        upperPath.push(new Vector3(x, arch, -sweep))
        lowerPath.push(new Vector3(x, arch - 0.22, -chord - sweep))
      }

      const canopyMesh = MeshBuilder.CreateRibbon(
        `ai-canopy-mesh-${idx}`,
        { pathArray: [upperPath, lowerPath], sideOrientation: Mesh.DOUBLESIDE },
        this.scene,
      )
      canopyMesh.parent = rootNode
      canopyMesh.material = canopyMat

      // Suspension Lines
      const pilotLocal = new Vector3(0, -4.2, -0.45)
      const linePaths: Vector3[][] = []
      for (let c = 0; c <= cells; c += 2) {
        linePaths.push([upperPath[c], pilotLocal])
        linePaths.push([lowerPath[c], pilotLocal])
      }
      const linesMesh = MeshBuilder.CreateLineSystem(
        `ai-lines-${idx}`,
        { lines: linePaths },
        this.scene,
      )
      linesMesh.parent = rootNode
      linesMesh.color = new Color3(0.2, 0.25, 0.3)

      // Stylized Pilot Capsule / Pod
      const pilotPod = MeshBuilder.CreateCapsule(
        `ai-pilot-pod-${idx}`,
        { radius: 0.28, height: 1.15, tessellation: 12 },
        this.scene,
      )
      pilotPod.position.copyFrom(pilotLocal)
      pilotPod.rotation.x = Math.PI / 2.8 // reclined pod harness angle
      pilotPod.parent = rootNode
      const podMat = new StandardMaterial(`ai-pod-mat-${idx}`, this.scene)
      podMat.diffuseColor = new Color3(0.18, 0.20, 0.25)
      podMat.specularColor = new Color3(0.3, 0.3, 0.3)
      pilotPod.material = podMat

      // Wingtip Streamline Ribbons (Visualizing subtle air currents)
      const tipHistLen = 22
      const leftTipInit = startPos.add(new Vector3(-span * 0.5, 0, 0))
      const rightTipInit = startPos.add(new Vector3(span * 0.5, 0, 0))
      const leftRibbonHistory: Vector3[] = Array.from({ length: tipHistLen }, () => leftTipInit.clone())
      const rightRibbonHistory: Vector3[] = Array.from({ length: tipHistLen }, () => rightTipInit.clone())

      const leftRibbonMesh = MeshBuilder.CreateLines(
        `ai-left-ribbon-${idx}`,
        { points: leftRibbonHistory, updatable: true },
        this.scene,
      )
      leftRibbonMesh.color = cfg.color.scale(0.85)
      leftRibbonMesh.alpha = 0.45

      const rightRibbonMesh = MeshBuilder.CreateLines(
        `ai-right-ribbon-${idx}`,
        { points: rightRibbonHistory, updatable: true },
        this.scene,
      )
      rightRibbonMesh.color = cfg.color.scale(0.85)
      rightRibbonMesh.alpha = 0.45

      this.spawnedNodes.push(rootNode, canopyMesh, linesMesh, pilotPod, leftRibbonMesh, rightRibbonMesh)

      const assignedThermal = thermals.length > 0 ? idx % thermals.length : -1

      this.gliders.push({
        id: `ai-${idx}`,
        name: cfg.name,
        rootNode,
        canopyMesh,
        linesMesh,
        leftRibbonMesh,
        rightRibbonMesh,
        leftRibbonHistory,
        rightRibbonHistory,
        color: cfg.color,
        pos: startPos,
        vel: new Vector3(0, -1.05, 10.5), // ~38 km/h trim speed
        headingDeg: 5.0 + (idx - 2) * 2.5,
        bankDeg: 0,
        pitchDeg: 1.0,
        mode: 'ridge_glide',
        assignedThermalIndex: assignedThermal,
        thermalAngle: (idx / 5) * Math.PI * 2,
        thermalRadius: 36.0 + (idx % 3) * 6.0,
        targetAltitude: startPos.y,
      })
    })
  }

  public update(dt: number, windVector: Vector3Like, playerPos: Vector3Like): void {
    const frameDt = Math.max(0.001, Math.min(0.08, dt))
    const thermals = this.world.thermals || []
    this.ribbonTimer += frameDt

    this.gliders.forEach((g, idx) => {
      // 1. Atmosphere & Thermal Detection
      let thermalUpdraft = 0
      let inThermal = false
      let thermalCenter: Vector3Like | null = null

      if (thermals.length > 0) {
        for (let tIdx = 0; tIdx < thermals.length; tIdx++) {
          const t = thermals[tIdx]
          const dx = g.pos.x - t.center.x
          const dz = g.pos.z - t.center.z
          const distHoriz = Math.hypot(dx, dz)
          if (distHoriz < t.radius * 0.95 && g.pos.y < (t.topAltitude ?? 2700)) {
            inThermal = true
            thermalCenter = t.center
            const coreFrac = Math.max(0, 1.0 - distHoriz / t.radius)
            thermalUpdraft = t.strengthMps * coreFrac
            g.assignedThermalIndex = tIdx
            break
          }
        }
      }

      // 2. Flight Mode State Machine
      const trimSpeedMps = 10.5 // 38 km/h true paraglider trim
      const baseSinkMps = -1.05

      if (inThermal && thermalCenter) {
        g.mode = 'thermalling'
        // Rising spiral carousel in the thermal core!
        const turnSpeed = 0.55 // rad/sec (~31 deg/sec coordinated 360 circle)
        g.thermalAngle += turnSpeed * frameDt
        const r = g.thermalRadius
        const targetX = thermalCenter.x + Math.cos(g.thermalAngle) * r
        const targetZ = thermalCenter.z + Math.sin(g.thermalAngle) * r

        // Smooth steering toward circular orbit
        const dirX = targetX - g.pos.x
        const dirZ = targetZ - g.pos.z
        const targetHeading = (Math.atan2(dirX, dirZ) * 180 / Math.PI + 360) % 360
        const headingDiff = (targetHeading - g.headingDeg + 540) % 360 - 180

        g.headingDeg = (g.headingDeg + headingDiff * Math.min(1.0, 3.2 * frameDt) + 360) % 360
        g.bankDeg += (24.0 - g.bankDeg) * Math.min(1.0, 4.0 * frameDt) // steady 24° banked thermal circle
        g.vel.y += (thermalUpdraft + baseSinkMps - g.vel.y) * Math.min(1.0, 3.5 * frameDt)
      } else {
        g.mode = 'formation'
        // Soaring downhill alongside mountain spine and following the player in formation
        const formOffset = FLOCK_CONFIGS[idx].offset
        const targetX = playerPos.x + formOffset.x + Math.sin(idx + g.pos.z * 0.005) * 16.0

        const dirX = targetX - g.pos.x
        const targetHeading = (Math.atan2(dirX, trimSpeedMps) * 180 / Math.PI + 360) % 360
        const headingDiff = (targetHeading - g.headingDeg + 540) % 360 - 180

        g.headingDeg = (g.headingDeg + headingDiff * Math.min(1.0, 2.4 * frameDt) + 360) % 360
        const targetBank = (headingDiff / 25.0) * 22.0
        g.bankDeg += (targetBank - g.bankDeg) * Math.min(1.0, 4.5 * frameDt)

        // Float sink rate with subtle ridge lift
        const groundH = this.world.sampleHeight ? this.world.sampleHeight(g.pos.x, g.pos.z) : 1000
        const clearance = g.pos.y - groundH
        let targetSink = baseSinkMps
        if (clearance < 45.0) {
          // Terrain cushion
          targetSink = Math.max(-0.4, baseSinkMps * (clearance / 45.0))
        }
        g.vel.y += (targetSink - g.vel.y) * Math.min(1.0, 2.5 * frameDt)
      }

      // 3. Integrate Kinematics
      const headingRad = g.headingDeg * (Math.PI / 180)
      g.vel.x = Math.sin(headingRad) * trimSpeedMps + (windVector?.x ?? 0) * 0.65
      g.vel.z = Math.cos(headingRad) * trimSpeedMps + (windVector?.z ?? 0) * 0.65
      g.pos.x += g.vel.x * frameDt
      g.pos.y += g.vel.y * frameDt
      g.pos.z += g.vel.z * frameDt

      // Prevent crashing into terrain
      const minTerrainH = (this.world.sampleHeight ? this.world.sampleHeight(g.pos.x, g.pos.z) : 600) + 12.0
      if (g.pos.y < minTerrainH) {
        g.pos.y = minTerrainH
        g.vel.y = 0.5 // dynamic ridge bounce
      }

      // Loop course if reaching valley runout
      if (g.pos.z > 2850) {
        g.pos.z = 20.0 + FLOCK_CONFIGS[idx].offset.z
        g.pos.x = FLOCK_CONFIGS[idx].offset.x
        g.pos.y = 1860 + FLOCK_CONFIGS[idx].offset.y
      }

      // Update 3D root orientation & position
      g.rootNode.position.copyFrom(g.pos)
      const q = Quaternion.RotationYawPitchRoll(
        g.headingDeg * (Math.PI / 180),
        g.pitchDeg * (Math.PI / 180),
        -g.bankDeg * (Math.PI / 180),
      )
      g.rootNode.rotationQuaternion = q

      // 4. Update Wingtip Streamlines (Painting Subtle Air Currents)
      if (this.ribbonTimer > 0.045) {
        const spanHalf = 4.8
        const rightVec = new Vector3(Math.cos(headingRad), 0, -Math.sin(headingRad))
        const leftTip = g.pos.add(rightVec.scale(-spanHalf))
        const rightTip = g.pos.add(rightVec.scale(spanHalf))

        g.leftRibbonHistory.pop()
        g.leftRibbonHistory.unshift(leftTip)

        g.rightRibbonHistory.pop()
        g.rightRibbonHistory.unshift(rightTip)

        MeshBuilder.CreateLines(
          `ai-left-ribbon-${idx}`,
          { points: g.leftRibbonHistory, instance: g.leftRibbonMesh },
          this.scene,
        )
        MeshBuilder.CreateLines(
          `ai-right-ribbon-${idx}`,
          { points: g.rightRibbonHistory, instance: g.rightRibbonMesh },
          this.scene,
        )

        // Color shift in lift: ribbons glow emerald/gold when soaring in updraft!
        if (g.vel.y > 0.2) {
          g.leftRibbonMesh.color = new Color3(0.2, 0.95, 0.5)
          g.rightRibbonMesh.color = new Color3(0.2, 0.95, 0.5)
        } else {
          g.leftRibbonMesh.color = g.color.scale(0.85)
          g.rightRibbonMesh.color = g.color.scale(0.85)
        }
      }
    })

    if (this.ribbonTimer > 0.045) {
      this.ribbonTimer = 0
    }
  }

  public dispose(): void {
    for (const n of this.spawnedNodes) {
      if (n && n.dispose) n.dispose(false, true)
    }
    this.spawnedNodes = []
    this.gliders = []
  }
}
