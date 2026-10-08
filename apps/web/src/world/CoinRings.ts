import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Scene } from '@babylonjs/core/scene'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { FlightWorld } from './types'

export type CoinRing = {
  mesh: Mesh
  position: Vector3
  radius: number
  collected: boolean
  baseRotationY: number
}

/**
 * Golden Coin Lift Highway
 *
 * Places 50+ golden soaring coins in the sky that trace the exact lift highway:
 * - Following knife-edge mountain ridges where dynamic slope lift is strongest
 * - Circling upward through thermal elevator cores to cloudbase
 * - Guiding the pilot through optimal cross-country mountain lines
 */
export class CoinRings {
  public rings: CoinRing[] = []
  private goldMat: StandardMaterial
  private glowMat: StandardMaterial
  private spawnedMeshes: (Mesh | any)[] = []
  public comboStreak: number = 0

  constructor(scene: Scene, world: FlightWorld) {
    this.goldMat = new StandardMaterial('coin-gold-mat', scene)
    this.goldMat.diffuseColor = new Color3(1.0, 0.84, 0.18)
    this.goldMat.emissiveColor = new Color3(0.75, 0.55, 0.10)
    this.goldMat.specularColor = new Color3(0.9, 0.85, 0.5)

    this.glowMat = new StandardMaterial('coin-glow-mat', scene)
    this.glowMat.diffuseColor = new Color3(1.0, 0.95, 0.6)
    this.glowMat.emissiveColor = new Color3(0.9, 0.75, 0.2)
    this.glowMat.alpha = 0.55

    this.spawnedMeshes.push(this.goldMat, this.glowMat)

    const waypoints: { x: number; y: number; z: number }[] = []

    // Check if world is Roldanillo (or has sampleRidgeSpineX)
    const roldanilloWorld = world as any
    const isRoldanillo = typeof roldanilloWorld.sampleRidgeSpineX === 'function'

    if (isRoldanillo) {
      // 1. Ridge Highway Coins: Along the knife-edge crest (from z = 40 to z = 4600)
      for (let z = 50; z <= 4600; z += 90) {
        const spineX = roldanilloWorld.sampleRidgeSpineX(z)
        // Windward offset: slightly to the west (-18m) where orographic lift is strongest
        const x = spineX - 18
        const groundY = world.sampleHeight(x, z)
        const clearance = 16.0 + Math.sin(z * 0.01) * 4.0
        waypoints.push({ x, y: groundY + clearance, z })

        // 2. Ascending Thermal Elevator Spirals at key thermal triggers
        // Spiral A: La Tulia Amphitheater (z around 1150)
        if (z === 1130) {
          const thermalCenter = new Vector3(320, 2260, 1150)
          const baseAlt = world.sampleHeight(thermalCenter.x, thermalCenter.z) + 20
          for (let step = 0; step < 8; step++) {
            const angle = (step / 8) * Math.PI * 2
            const r = 110
            waypoints.push({
              x: thermalCenter.x + Math.cos(angle) * r,
              y: baseAlt + step * 32, // Climbs +256m in a full circle!
              z: thermalCenter.z + Math.sin(angle) * r,
            })
          }
        }

        // Spiral B: Piedra del Sol Notch (z around 2100)
        if (z === 2120) {
          const thermalCenter = new Vector3(-250, 2320, 2100)
          const baseAlt = world.sampleHeight(thermalCenter.x, thermalCenter.z) + 25
          for (let step = 0; step < 8; step++) {
            const angle = (step / 8) * Math.PI * 2
            const r = 120
            waypoints.push({
              x: thermalCenter.x + Math.sin(angle) * r,
              y: baseAlt + step * 35, // Climbs +280m!
              z: thermalCenter.z + Math.cos(angle) * r,
            })
          }
        }

        // Spiral C: Lago Calima Final Elevator (z around 4280)
        if (z === 4280) {
          const thermalCenter = new Vector3(-150, 2360, 4300)
          const baseAlt = world.sampleHeight(thermalCenter.x, thermalCenter.z) + 30
          for (let step = 0; step < 8; step++) {
            const angle = (step / 8) * Math.PI * 2
            const r = 130
            waypoints.push({
              x: thermalCenter.x + Math.cos(angle) * r,
              y: baseAlt + step * 40, // Climbs +320m to 2,900m cloudbase!
              z: thermalCenter.z + Math.sin(angle) * r,
            })
          }
        }
      }
    } else {
      // Generic mountain descent / piste track (e.g. Whistler / Himalayas)
      for (let z = 100; z <= 2500; z += 90) {
        const x = Math.sin(z * 0.0028) * 32
        const groundY = world.sampleHeight(x, z)
        waypoints.push({ x, y: groundY + 8.0, z })
      }
    }

    // Build 3D Golden Coins at each waypoint
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i]
      const ringPos = new Vector3(wp.x, wp.y, wp.z)

      // Outer Torus Ring
      const ringMesh = MeshBuilder.CreateTorus(
        `flight-coin-${i}`,
        { diameter: 7.5, thickness: 0.65, tessellation: 24 },
        scene,
      )
      ringMesh.position.copyFrom(ringPos)
      ringMesh.material = this.goldMat

      // Inner subtle translucent shimmer disc
      const coreDisc = MeshBuilder.CreateDisc(
        `coin-disc-${i}`,
        { radius: 2.8, tessellation: 20 },
        scene,
      )
      coreDisc.parent = ringMesh
      coreDisc.rotation.x = Math.PI / 2
      coreDisc.material = this.glowMat

      this.spawnedMeshes.push(ringMesh, coreDisc)

      this.rings.push({
        mesh: ringMesh,
        position: ringPos,
        radius: 4.5,
        collected: false,
        baseRotationY: (i * 0.4) % (Math.PI * 2),
      })
    }
  }

  public get totalCoins(): number {
    return this.rings.length
  }

  public get collectedCount(): number {
    return this.rings.filter((r) => r.collected).length
  }

  public reset(): void {
    this.comboStreak = 0
    for (const ring of this.rings) {
      ring.collected = false
      ring.mesh.scaling.set(1.0, 1.0, 1.0)
      ring.mesh.setEnabled(true)
    }
  }

  public update(pilotPos: Vector3, dt: number): { ringCollected: boolean; points: number } {
    let ringCollected = false
    let points = 0

    for (const ring of this.rings) {
      if (ring.collected) continue

      // Gently rotate the golden coin
      ring.baseRotationY += dt * 2.2
      ring.mesh.rotation.y = ring.baseRotationY

      // Distance to paraglider pilot
      const dx = pilotPos.x - ring.position.x
      const dy = pilotPos.y - ring.position.y
      const dz = pilotPos.z - ring.position.z
      const distSq = dx * dx + dy * dy + dz * dz

      // Generous collection radius (7.5m)
      const collectDist = ring.radius + 3.0
      if (distSq < collectDist * collectDist) {
        ring.collected = true
        ringCollected = true
        this.comboStreak++
        points = 100 * Math.min(5, this.comboStreak)

        // Pop animation: shrink and disappear
        ring.mesh.scaling.set(0.001, 0.001, 0.001)
        ring.mesh.setEnabled(false)
      }
    }

    return { ringCollected, points }
  }

  public dispose(): void {
    for (const m of this.spawnedMeshes) {
      if (m && m.dispose) m.dispose(false, true)
    }
    this.spawnedMeshes = []
    this.rings = []
  }
}
