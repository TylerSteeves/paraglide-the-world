import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { WhistlerMountain } from './WhistlerMountain'

export type CoinRing = {
  mesh: Mesh
  position: Vector3
  radius: number
  collected: boolean
  baseRotationY: number
}

export class CoinRings {
  public rings: CoinRing[] = []
  private goldMat: StandardMaterial

  constructor(scene: Scene, mountain: WhistlerMountain) {
    this.goldMat = new StandardMaterial('coin-gold-mat', scene)
    this.goldMat.diffuseColor = new Color3(1.0, 0.82, 0.12)
    this.goldMat.emissiveColor = new Color3(0.95, 0.72, 0.1)
    this.goldMat.specularColor = new Color3(0.4, 0.4, 0.4)

    // Define 18 Flight Rings carving down Whistler Ski Run
    const ringWaypoints = [
      { x: 20, z: 120, clearance: 35 },
      { x: 80, z: 280, clearance: 28 },
      { x: 45, z: 460, clearance: 24 },
      { x: -30, z: 640, clearance: 20 },
      { x: -95, z: 820, clearance: 18 }, // Weaving near chairlift!
      { x: -40, z: 1020, clearance: 22 },
      { x: 60, z: 1220, clearance: 25 },
      { x: 140, z: 1420, clearance: 30 }, // In thermal bowl!
      { x: 110, z: 1620, clearance: 26 },
      { x: 10, z: 1820, clearance: 22 },
      { x: -80, z: 2020, clearance: 18 }, // Low proximity run
      { x: -50, z: 2220, clearance: 16 },
      { x: 10, z: 2420, clearance: 14 },
      { x: 0, z: 2600, clearance: 10 }, // Approach to village landing pad
    ]

    for (let i = 0; i < ringWaypoints.length; i++) {
      const wp = ringWaypoints[i]
      const groundY = mountain.sampleHeight(wp.x, wp.z)
      const ringY = groundY + wp.clearance
      const ringPos = new Vector3(wp.x, ringY, wp.z)

      const ringMesh = MeshBuilder.CreateTorus(
        `flight-ring-${i}`,
        { diameter: 12.0, thickness: 1.1, tessellation: 32 },
        scene,
      )
      ringMesh.position.copyFrom(ringPos)
      ringMesh.material = this.goldMat

      this.rings.push({
        mesh: ringMesh,
        position: ringPos,
        radius: 6.0,
        collected: false,
        baseRotationY: 0,
      })
    }
  }

  public update(pilotPos: Vector3, dt: number): { ringCollected: boolean; points: number } {
    let ringCollected = false
    let points = 0

    for (const ring of this.rings) {
      if (ring.collected) continue

      // Spin ring slowly
      ring.baseRotationY += dt * 1.6
      ring.mesh.rotation.y = ring.baseRotationY

      // Check distance to pilot
      const dx = pilotPos.x - ring.position.x
      const dy = pilotPos.y - ring.position.y
      const dz = pilotPos.z - ring.position.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

      if (dist < ring.radius + 2.5) {
        ring.collected = true
        ringCollected = true
        points = 250

        // Pop animation: shrink and disappear
        ring.mesh.scaling.set(0.001, 0.001, 0.001)
        ring.mesh.setEnabled(false)
      }
    }

    return { ringCollected, points }
  }
}
