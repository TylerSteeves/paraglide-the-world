import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import type { TrackedFlight } from '../data/tracked-flights'

export class TrackedFlightPlayer {
  private scene: Scene
  private flight: TrackedFlight | null = null
  private ribbonLines: LinesMesh[] = []
  private ghostRoot: TransformNode
  private ghostCanopy: Mesh
  private ghostLines: LinesMesh
  private ghostPod: Mesh

  public playbackTime: number = 0
  public isGhostVisible: boolean = true
  public isRibbonVisible: boolean = true

  constructor(scene: Scene) {
    this.scene = scene

    // Build Ghost Glider Hierarchy
    this.ghostRoot = new TransformNode('ghost-glider-root', scene)
    this.ghostRoot.rotationQuaternion = new Quaternion()

    // Translucent Silver/Cyan Ghost Canopy
    const numCells = 12
    const halfSpan = 5.0
    const chord = 2.1
    const upperRibbon: Vector3[] = []
    const linePts: Vector3[] = []

    for (let c = 0; c <= numCells; c++) {
      const u = c / numCells
      const x = -halfSpan + u * halfSpan * 2
      const normX = Math.abs(x) / halfSpan

      const archY = (1 - Math.pow(normX, 1.9)) * 1.5
      const sweepZ = Math.pow(normX, 1.7) * 0.75
      const taperChord = chord * (1 - normX * 0.35)
      const leZ = sweepZ + taperChord * 0.45
      const teZ = sweepZ - taperChord * 0.55

      upperRibbon.push(new Vector3(x, archY + 0.28, leZ))
      upperRibbon.push(new Vector3(x, archY, teZ))

      if (c % 2 === 0) {
        linePts.push(new Vector3(x, archY, (leZ + teZ) * 0.5))
      }
    }

    this.ghostCanopy = MeshBuilder.CreateRibbon(
      'ghost-canopy',
      {
        pathArray: [
          upperRibbon.filter((_, idx) => idx % 2 === 0),
          upperRibbon.filter((_, idx) => idx % 2 === 1),
        ],
        updatable: false,
      },
      scene,
    )
    const ghostMat = new StandardMaterial('ghost-mat', scene)
    ghostMat.diffuseColor = new Color3(0.7, 0.9, 1.0)
    ghostMat.emissiveColor = new Color3(0.2, 0.4, 0.7)
    ghostMat.alpha = 0.55
    ghostMat.backFaceCulling = false
    this.ghostCanopy.material = ghostMat
    this.ghostCanopy.parent = this.ghostRoot

    // Lines
    const carabinerL = new Vector3(-0.25, -5.2, 0.05)
    const carabinerR = new Vector3(0.25, -5.2, 0.05)
    const linePairs: Vector3[][] = []
    for (const pt of linePts) {
      linePairs.push([pt, pt.x < 0 ? carabinerL : carabinerR])
    }
    this.ghostLines = MeshBuilder.CreateLineSystem(
      'ghost-lines',
      { lines: linePairs },
      scene,
    )
    this.ghostLines.color = new Color3(0.6, 0.8, 1.0)
    this.ghostLines.alpha = 0.4
    this.ghostLines.parent = this.ghostRoot

    // Pod
    this.ghostPod = MeshBuilder.CreateCapsule(
      'ghost-pod',
      { radius: 0.2, height: 1.1, tessellation: 6 },
      scene,
    )
    this.ghostPod.material = ghostMat
    this.ghostPod.position.set(0, -5.3, 0.1)
    this.ghostPod.rotation.x = 0.55
    this.ghostPod.parent = this.ghostRoot
  }

  public setFlight(flight: TrackedFlight) {
    this.clearRibbon()
    this.flight = flight
    this.playbackTime = 0

    if (!flight.trackpoints || flight.trackpoints.length < 2) return

    // Build 3D Vario-Colored Ribbon Path
    // Chunk trackpoints into segments of similar climb/sink for vibrant colored tracks
    const pts = flight.trackpoints
    const chunkSize = 20

    for (let i = 0; i < pts.length - 1; i += chunkSize) {
      const end = Math.min(pts.length, i + chunkSize + 1)
      const segmentPts: Vector3[] = []
      let avgVario = 0

      for (let j = i; j < end; j++) {
        segmentPts.push(new Vector3(pts[j].x, pts[j].y, pts[j].z))
        avgVario += pts[j].varioMps
      }
      avgVario /= (end - i)

      const lineMesh = MeshBuilder.CreateLines(
        `flight-path-seg-${i}`,
        { points: segmentPts, updatable: false },
        this.scene,
      )

      // Color code by climb rate:
      // Strong Climb (> 2.5 m/s): Bright Goldenrod / Lime
      // Moderate Lift (0.5 to 2.5 m/s): Yellow
      // Neutral / Trim Glide (-1.5 to 0.5 m/s): Cyan
      // Fast Sink (< -1.5 m/s): Orange / Red
      if (avgVario > 2.5) {
        lineMesh.color = new Color3(0.2, 0.95, 0.1) // Bright climb green
        lineMesh.alpha = 0.85
      } else if (avgVario > 0.5) {
        lineMesh.color = new Color3(0.95, 0.85, 0.15) // Lift yellow
        lineMesh.alpha = 0.75
      } else if (avgVario > -1.5) {
        lineMesh.color = new Color3(0.15, 0.75, 0.98) // Cruise glide cyan
        lineMesh.alpha = 0.65
      } else {
        lineMesh.color = new Color3(0.95, 0.35, 0.15) // Sink orange
        lineMesh.alpha = 0.75
      }

      this.ribbonLines.push(lineMesh)
    }
  }

  public update(dt: number) {
    if (!this.flight || !this.isGhostVisible || this.flight.trackpoints.length < 2) {
      this.ghostRoot.setEnabled(false)
      return
    }

    this.ghostRoot.setEnabled(true)
    this.playbackTime += dt

    const pts = this.flight.trackpoints
    const totalDuration = this.flight.durationSeconds
    const loopTime = this.playbackTime % totalDuration

    // Find bounding trackpoints for interpolation
    let idx = 0
    while (idx < pts.length - 2 && pts[idx + 1].t < loopTime) {
      idx++
    }

    const p0 = pts[idx]
    const p1 = pts[idx + 1]
    const dtSegment = Math.max(0.001, p1.t - p0.t)
    const frac = Math.max(0, Math.min(1, (loopTime - p0.t) / dtSegment))

    const x = p0.x + (p1.x - p0.x) * frac
    const y = p0.y + (p1.y - p0.y) * frac
    const z = p0.z + (p1.z - p0.z) * frac

    this.ghostRoot.position.set(x, y, z)

    // Heading & Banking alignment
    const dx = p1.x - p0.x
    const dz = p1.z - p0.z
    const heading = Math.atan2(dx, dz)

    // If circling (strong turn rate), bank into the turn
    const bank = p0.varioMps > 1.5 ? -0.42 : 0 // Bank 24 deg when thermalling

    const qYaw = Quaternion.RotationAxis(Vector3.Up(), heading)
    const qPitch = Quaternion.RotationAxis(Vector3.Right(), 0.1)
    const qRoll = Quaternion.RotationAxis(Vector3.Forward(), bank)

    if (this.ghostRoot.rotationQuaternion) {
      qYaw.multiplyToRef(qPitch, this.ghostRoot.rotationQuaternion)
      this.ghostRoot.rotationQuaternion.multiplyInPlace(qRoll)
    }
  }

  public toggleGhost(visible?: boolean) {
    this.isGhostVisible = visible !== undefined ? visible : !this.isGhostVisible
    this.ghostRoot.setEnabled(this.isGhostVisible)
  }

  public toggleRibbon(visible?: boolean) {
    this.isRibbonVisible = visible !== undefined ? visible : !this.isRibbonVisible
    for (const line of this.ribbonLines) {
      line.setEnabled(this.isRibbonVisible)
    }
  }

  private clearRibbon() {
    for (const line of this.ribbonLines) {
      line.dispose()
    }
    this.ribbonLines = []
  }

  public dispose() {
    this.clearRibbon()
    this.ghostCanopy.dispose()
    this.ghostLines.dispose()
    this.ghostPod.dispose()
    this.ghostRoot.dispose()
  }
}
